//! Published-version details share the resource metadata table under a separate source
//! namespace. No schema change is needed, and ResourceManager::clear_cache deletes them.
use anyhow::{anyhow, Result};
use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use futures::future::{BoxFuture, FutureExt, Shared};
use std::{collections::HashMap, future::Future, sync::Arc};
use tokio::sync::Mutex;

use crate::models::resource::{
    ResourceChangelogStatus, ResourceMetadataCacheRecord, ResourceVersionDetails, SourcePlatform,
};
use crate::schema::vesta::resource_metadata_cache::dsl as cache;
use crate::utils::db::get_vesta_conn;

const MAX_ENTRIES: usize = 128;
const TTL_DAYS: i64 = 30;
type Key = (SourcePlatform, String, String);
type Flight = Shared<BoxFuture<'static, Result<Entry, Arc<String>>>>;

#[derive(Clone)]
struct Entry {
    details: ResourceVersionDetails,
    expires_at: NaiveDateTime,
}

impl Entry {
    fn new(details: ResourceVersionDetails) -> Self {
        // A provider may return file metadata while its changelog endpoint is down.
        let ttl = if details.changelog_status == ResourceChangelogStatus::Unavailable {
            chrono::Duration::minutes(5)
        } else {
            chrono::Duration::days(TTL_DAYS)
        };
        Self {
            details,
            expires_at: Utc::now().naive_utc() + ttl,
        }
    }
}

#[derive(Default)]
pub(super) struct VersionDetailsCache {
    entries: HashMap<Key, (Entry, u64)>,
    flights: HashMap<(Key, bool), Flight>,
    clock: u64,
    generation: u64,
}

impl VersionDetailsCache {
    pub fn clear(&mut self) {
        self.entries.clear();
        self.flights.clear();
        self.generation = self.generation.wrapping_add(1);
    }

    fn peek(&mut self, key: &Key) -> Option<ResourceVersionDetails> {
        self.clock = self.clock.wrapping_add(1);
        if self
            .entries
            .get(key)
            .is_some_and(|(entry, _)| entry.expires_at <= Utc::now().naive_utc())
        {
            self.entries.remove(key);
        }
        let (entry, used) = self.entries.get_mut(key)?;
        *used = self.clock;
        Some(entry.details.clone())
    }

    fn insert(&mut self, key: Key, entry: Entry) {
        self.clock = self.clock.wrapping_add(1);
        self.entries.insert(key, (entry, self.clock));
        while self.entries.len() > MAX_ENTRIES {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, (_, used))| used)
                .map(|(key, _)| key.clone())
                .unwrap();
            self.entries.remove(&oldest);
        }
    }

    /// Shared futures survive a cancelled waiter; the next caller can finish the same
    /// request. Bypass requests join each other but never read or write either cache,
    /// matching get_versions' ignore_cache convention.
    pub async fn get<F, Fut>(
        state: &Arc<Mutex<Self>>,
        key: Key,
        ignore_cache: bool,
        fetch: F,
    ) -> Result<ResourceVersionDetails>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<ResourceVersionDetails>> + Send + 'static,
    {
        let flight_key = (key.clone(), ignore_cache);
        let (flight, generation) = {
            let mut state = state.lock().await;
            if !ignore_cache {
                if let Some(details) = state.peek(&key) {
                    return Ok(details);
                }
            }
            let flight = state
                .flights
                .entry(flight_key.clone())
                .or_insert_with(|| {
                    let key = key.clone();
                    async move {
                        if !ignore_cache {
                            match read_from_db(&key) {
                                Ok(Some(entry)) => return Ok(entry),
                                Ok(None) => {}
                                Err(error) => log::warn!(
                                    "[ResourceManager] Failed to read version details cache: {}",
                                    error
                                ),
                            }
                        }
                        fetch()
                            .await
                            .map(Entry::new)
                            .map_err(|error| Arc::new(error.to_string()))
                    }
                    .boxed()
                    .shared()
                })
                .clone();
            (flight, state.generation)
        };
        let result = flight.clone().await;
        let mut state = state.lock().await;
        // A clear must not let older requests repopulate memory or SQLite. Only the
        // first waiter publishes; the others simply receive the shared result.
        if state.generation == generation
            && state
                .flights
                .get(&flight_key)
                .is_some_and(|current| current.ptr_eq(&flight))
        {
            state.flights.remove(&flight_key);
            if !ignore_cache {
                if let Ok(entry) = &result {
                    if let Err(error) = write_to_db(&key, entry) {
                        log::warn!(
                            "[ResourceManager] Failed to persist version details cache: {}",
                            error
                        );
                    }
                    state.insert(key, entry.clone());
                }
            }
        }
        result
            .map(|entry| entry.details)
            .map_err(|error| anyhow!(error.to_string()))
    }
}

fn database_key(key: &Key) -> (String, String) {
    // Separate from project/version-list rows, with collision-free project/version IDs.
    (
        format!("version-details:{}", key.0.as_str()),
        serde_json::to_string(&(&key.1, &key.2)).expect("string tuple serializes"),
    )
}

fn read_from_db(key: &Key) -> Result<Option<Entry>> {
    let mut conn = get_vesta_conn().map_err(|error| anyhow!(error.to_string()))?;
    read_record(&mut conn, key)
}

fn read_record(conn: &mut SqliteConnection, key: &Key) -> Result<Option<Entry>> {
    let (source, remote_id) = database_key(key);
    let record = cache::resource_metadata_cache
        .filter(cache::source.eq(source))
        .filter(cache::remote_id.eq(remote_id))
        .first::<ResourceMetadataCacheRecord>(conn)
        .optional()?;
    let Some(record) = record else {
        return Ok(None);
    };
    let Ok(expires_at) = NaiveDateTime::parse_from_str(&record.expires_at, "%Y-%m-%d %H:%M:%S")
    else {
        return Ok(None);
    };
    if expires_at <= Utc::now().naive_utc() {
        return Ok(None);
    }
    let details = serde_json::from_str(&record.project_data)?;
    Ok(Some(Entry {
        details,
        expires_at,
    }))
}

fn write_to_db(key: &Key, entry: &Entry) -> Result<()> {
    let mut conn = get_vesta_conn().map_err(|error| anyhow!(error.to_string()))?;
    write_record(&mut conn, key, entry)
}

fn write_record(conn: &mut SqliteConnection, key: &Key, entry: &Entry) -> Result<()> {
    let (source, remote_id) = database_key(key);
    let record = ResourceMetadataCacheRecord {
        id: None,
        source,
        remote_id,
        project_data: serde_json::to_string(&entry.details)?,
        versions_data: None,
        last_updated: crate::resources::update_cache::now_datetime_str(),
        expires_at: entry.expires_at.format("%Y-%m-%d %H:%M:%S").to_string(),
    };
    diesel::insert_into(cache::resource_metadata_cache)
        .values(&record)
        .on_conflict((cache::source, cache::remote_id))
        .do_update()
        .set((
            cache::project_data.eq(&record.project_data),
            cache::last_updated.eq(&record.last_updated),
            cache::expires_at.eq(&record.expires_at),
        ))
        .execute(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::resource::{ReleaseType, ResourceChangelogFormat, ResourceVersion};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn key(version: &str) -> Key {
        (SourcePlatform::Modrinth, "project".into(), version.into())
    }

    fn details() -> ResourceVersionDetails {
        ResourceVersionDetails {
            version: ResourceVersion {
                id: "version".into(),
                project_id: "project".into(),
                version_number: "1.0".into(),
                game_versions: vec!["1.21".into()],
                loaders: vec!["fabric".into()],
                download_url: "https://example.com/file.jar".into(),
                file_name: "file.jar".into(),
                release_type: ReleaseType::Release,
                hash: "sha1".into(),
                dependencies: vec![],
                published_at: None,
                download_count: None,
                file_size: None,
                files: vec![],
            },
            changelog: Some("Release notes".into()),
            changelog_format: ResourceChangelogFormat::Markdown,
            changelog_status: ResourceChangelogStatus::Available,
        }
    }

    #[test]
    fn memory_is_lru_bounded_and_expires() {
        let mut state = VersionDetailsCache::default();
        for index in 0..MAX_ENTRIES {
            state.insert(key(&index.to_string()), Entry::new(details()));
        }
        assert!(state.peek(&key("0")).is_some());
        state.insert(key("new"), Entry::new(details()));
        assert_eq!(state.entries.len(), MAX_ENTRIES);
        assert!(state.peek(&key("0")).is_some());
        assert!(state.peek(&key("1")).is_none());
        state.entries.get_mut(&key("0")).unwrap().0.expires_at =
            Utc::now().naive_utc() - chrono::Duration::seconds(1);
        assert!(state.peek(&key("0")).is_none());
        let mut partial = details();
        partial.changelog_status = ResourceChangelogStatus::Unavailable;
        assert!(
            Entry::new(partial).expires_at < Utc::now().naive_utc() + chrono::Duration::minutes(6)
        );
    }

    #[test]
    fn sqlite_roundtrip_is_namespaced_and_respects_expiry_and_clear() {
        use diesel::connection::SimpleConnection;
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/vesta/2026-01-12-170903-0000_create_resource_metadata_cache/up.sql"
        ))
        .unwrap();
        let key = key("version");
        let entry = Entry::new(details());
        write_record(&mut conn, &key, &entry).unwrap();
        assert_eq!(
            read_record(&mut conn, &key)
                .unwrap()
                .unwrap()
                .details
                .changelog,
            entry.details.changelog
        );
        assert!(read_record(
            &mut conn,
            &(SourcePlatform::CurseForge, key.1.clone(), key.2.clone())
        )
        .unwrap()
        .is_none());
        assert!(
            read_record(&mut conn, &(key.0, "other".into(), key.2.clone()))
                .unwrap()
                .is_none()
        );
        assert_ne!(
            database_key(&(key.0, "a:b".into(), "c".into())),
            database_key(&(key.0, "a".into(), "b:c".into()))
        );
        let mut expired = entry.clone();
        expired.expires_at = Utc::now().naive_utc() - chrono::Duration::seconds(1);
        write_record(&mut conn, &key, &expired).unwrap();
        assert!(read_record(&mut conn, &key).unwrap().is_none());
        write_record(&mut conn, &key, &entry).unwrap();
        diesel::delete(cache::resource_metadata_cache)
            .execute(&mut conn)
            .unwrap();
        assert!(read_record(&mut conn, &key).unwrap().is_none());
    }

    #[tokio::test]
    async fn concurrent_misses_join_and_success_is_reused() {
        let state = Arc::new(Mutex::new(VersionDetailsCache::default()));
        let calls = Arc::new(AtomicUsize::new(0));
        let fetch = || {
            let calls = calls.clone();
            move || async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                Ok(details())
            }
        };
        let (first, second) = tokio::join!(
            VersionDetailsCache::get(&state, key("version"), false, fetch()),
            VersionDetailsCache::get(&state, key("version"), false, fetch()),
        );
        assert!(first.is_ok() && second.is_ok());
        VersionDetailsCache::get(&state, key("version"), false, || async {
            panic!("memory hit must not fetch")
        })
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(state.lock().await.flights.is_empty());
    }

    #[tokio::test]
    async fn bypass_skips_memory_and_does_not_replace_it() {
        let state = Arc::new(Mutex::new(VersionDetailsCache::default()));
        state
            .lock()
            .await
            .insert(key("version"), Entry::new(details()));
        let result = VersionDetailsCache::get(&state, key("version"), true, || async {
            let mut fresh = details();
            fresh.changelog = Some("Fresh".into());
            Ok(fresh)
        })
        .await
        .unwrap();
        assert_eq!(result.changelog.as_deref(), Some("Fresh"));
        assert_eq!(
            state
                .lock()
                .await
                .peek(&key("version"))
                .unwrap()
                .changelog
                .as_deref(),
            Some("Release notes")
        );
    }

    #[tokio::test]
    async fn failures_are_shared_and_can_retry() {
        let state = Arc::new(Mutex::new(VersionDetailsCache::default()));
        let calls = Arc::new(AtomicUsize::new(0));
        let fetch = || {
            let calls = calls.clone();
            move || async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                Err(anyhow!("provider unavailable"))
            }
        };
        let (first, second) = tokio::join!(
            VersionDetailsCache::get(&state, key("version"), true, fetch()),
            VersionDetailsCache::get(&state, key("version"), true, fetch()),
        );
        assert!(first.is_err() && second.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(state.lock().await.flights.is_empty());
        VersionDetailsCache::get(&state, key("version"), true, || async { Ok(details()) })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn clear_during_fetch_prevents_repopulation() {
        let state = Arc::new(Mutex::new(VersionDetailsCache::default()));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
        let task_state = state.clone();
        let task = tokio::spawn(async move {
            VersionDetailsCache::get(&task_state, key("version"), false, || async {
                started_tx.send(()).unwrap();
                finish_rx.await.unwrap();
                Ok(details())
            })
            .await
        });
        started_rx.await.unwrap();
        state.lock().await.clear();
        finish_tx.send(()).unwrap();
        assert!(task.await.unwrap().is_ok());
        let state = state.lock().await;
        assert!(state.entries.is_empty() && state.flights.is_empty());
    }

    #[tokio::test]
    async fn cancelled_waiter_leaves_a_joinable_request() {
        let state = Arc::new(Mutex::new(VersionDetailsCache::default()));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
        let task_state = state.clone();
        let task = tokio::spawn(async move {
            VersionDetailsCache::get(&task_state, key("version"), true, || async {
                started_tx.send(()).unwrap();
                finish_rx.await.unwrap();
                Ok(details())
            })
            .await
        });
        started_rx.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        finish_tx.send(()).unwrap();
        VersionDetailsCache::get(&state, key("version"), true, || async {
            panic!("must join original request")
        })
        .await
        .unwrap();
        assert!(state.lock().await.flights.is_empty());
    }
}
