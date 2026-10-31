//! Profile-local metadata only. Credentials and confirmation tokens never enter this file.
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::{Mutex, OwnedMutexGuard};
use vesta_server_client::{model::ServerSnapshot, Error, ErrorCode, Result};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub snapshot: ServerSnapshot,
    pub device_id: String,
    pub key_reference: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn reauthentication_preserves_connection_and_retires_credentials_only_after_commit() {
        let root = tempfile::tempdir().unwrap();
        let mut old = persistent_record();
        old.snapshot.connection.name = "My server".into();
        old.snapshot.connection.pinned = true;
        old.snapshot.connection.auth_revision = Some("old-auth".into());
        let old_key = old.key_reference.clone();
        let old_snapshot = old.snapshot.clone();
        let mut store = Store::default();
        store.connections.push(old.clone());
        let shared = Arc::new(Mutex::new(store));
        let mut new = persistent_record();
        new.snapshot.connection.id = "throwaway-id".into();
        new.snapshot.connection.role = Some("owner".into());
        new.snapshot.connection.auth_revision = Some("new-auth".into());
        new.device_id = "new-device".into();
        let new_key = new.key_reference.clone();
        let blocked = root.path().join("file-not-directory");
        std::fs::write(&blocked, b"blocked").unwrap();
        assert!(Store::edit(&shared, &blocked, |s| s.enroll(new.clone(), Some("one"))).await.is_err());
        assert_eq!(shared.lock().await.connections[0].key_reference, old_key);
        assert!(shared.lock().await.pending_credential_deletions.is_empty());
        let saved = Store::edit(&shared, root.path(), |s| s.enroll(new, Some("one"))).await.unwrap();
        assert_eq!(saved.connection.id, "one");
        assert_eq!(saved.connection.name, "My server");
        assert!(saved.connection.pinned);
        let reloaded = Store::load(root.path()).unwrap();
        assert_eq!(reloaded.connections.len(), 1);
        assert_eq!(reloaded.connections[0].key_reference, new_key);
        assert_eq!(reloaded.pending_credential_deletions, [old_key]);
        let (observation, changed) = Store::observe(&shared, root.path(), old_snapshot).await.unwrap();
        assert_eq!(observation.connection.auth_revision.as_deref(), Some("new-auth"));
        assert!(!changed);
        old.snapshot.connection.fingerprint = "cd".repeat(32);
        assert_eq!(Store::edit(&shared, root.path(), |s| s.enroll(old, Some("one"))).await.unwrap_err().code, ErrorCode::FingerprintMismatch);
    }

    #[test]
    fn an_old_action_intent_cannot_be_replayed_using_new_authentication() {
        let mut store = Store::default();
        let mut record = persistent_record();
        record.snapshot.connection.auth_revision = Some("old".into());
        store.connections.push(record);
        let pending = PendingIntent { connection_id: "one".into(), key: "intent".into(), key_version: 2, auth_revision: None,
            action: "console.command".into(), payload_hash: "hash".into(), operation_id: None, created_at_ms: 1, terminal: false, uncertain: true };
        store.reserve_management_intent(pending.clone(), false).unwrap();
        store.connections[0].snapshot.connection.auth_revision = Some("new".into());
        assert_eq!(store.reserve_management_intent(pending, false).unwrap_err().code, ErrorCode::Conflict);
    }
    fn persistent_record() -> Record {
        let snapshot: ServerSnapshot = serde_json::from_value(serde_json::json!({
            "connection":{"id":"one","name":"Server","endpoint":"localhost:8443","serverId":"server","fingerprint":"ab".repeat(32),"role":null,"signInMethod":"pairing_code","memoryOnly":false,"pinned":false,"addedAtMs":0,"lastConnectedAtMs":null},
            "state":{"phase":"online","access":"paired","retryAtMs":null,"rateLimitedUntilMs":null,"lastError":null},
            "info":null,"status":null,"statusObservedAtMs":null,"pack":null,
            "capabilities":{"source":"unknown","granted":[],"refused":[]},"restartRequired":false
        })).unwrap();
        Record {
            snapshot,
            device_id: "device".into(),
            key_reference: uuid::Uuid::new_v4().to_string(),
        }
    }
    #[tokio::test]
    async fn cleanup_drains_concurrent_removals_and_retains_transient_vault_failures() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let root = tempfile::tempdir().unwrap();
        let shared = Arc::new(Mutex::new(Store::default()));
        shared
            .lock()
            .await
            .pending_credential_deletions
            .push("first".into());
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let cleaned = Arc::new(std::sync::Mutex::new(Vec::new()));
        let task = tokio::spawn({
            let shared = shared.clone();
            let root = root.path().to_owned();
            let started = started.clone();
            let release = release.clone();
            let cleaned = cleaned.clone();
            async move {
                Store::cleanup_keys(&shared, &root, |key| {
                    let started = started.clone();
                    let release = release.clone();
                    let cleaned = cleaned.clone();
                    async move {
                        if key == "first" {
                            started.notify_one();
                            release.notified().await;
                        }
                        cleaned.lock().unwrap().push(key);
                        Ok(())
                    }
                })
                .await
            }
        });
        started.notified().await;
        Store::edit(&shared, root.path(), |s| {
            s.pending_credential_deletions.push("second".into());
            Ok(())
        })
        .await
        .unwrap();
        release.notify_one();
        task.await.unwrap().unwrap();
        assert_eq!(*cleaned.lock().unwrap(), ["first", "second"]);
        assert!(shared.lock().await.pending_credential_deletions.is_empty());
        Store::edit(&shared, root.path(), |s| {
            s.pending_credential_deletions.push("retry".into());
            Ok(())
        })
        .await
        .unwrap();
        let fail = AtomicBool::new(true);
        let delete = |_| async {
            if fail.swap(false, Ordering::SeqCst) {
                Err(Error::new(ErrorCode::CredentialsUnavailable))
            } else {
                Ok(())
            }
        };
        assert!(Store::cleanup_keys(&shared, root.path(), delete)
            .await
            .is_err());
        assert_eq!(
            Store::load(root.path())
                .unwrap()
                .pending_credential_deletions,
            ["retry"]
        );
        Store::cleanup_keys(&shared, root.path(), delete)
            .await
            .unwrap();
        assert!(Store::load(root.path())
            .unwrap()
            .pending_credential_deletions
            .is_empty());
    }
    #[tokio::test]
    async fn live_observations_do_not_write_the_profile_or_lose_connection_edits() {
        let root = tempfile::tempdir().unwrap();
        let mut original = Store::default();
        original.connections.push(persistent_record());
        original.save(root.path()).unwrap();
        let before = std::fs::read(root.path().join(FILE)).unwrap();
        let shared = Arc::new(Mutex::new(original));
        for observation in 1..=60 {
            let mut snapshot = shared.lock().await.connections[0].snapshot.clone();
            snapshot.status_observed_at_ms = Some(observation);
            snapshot.connection.name = "stale remote name".into();
            let (snapshot, changed) = Store::observe(&shared, root.path(), snapshot)
                .await
                .unwrap();
            assert!(!changed);
            assert_eq!(snapshot.connection.name, "Server");
        }
        assert_eq!(std::fs::read(root.path().join(FILE)).unwrap(), before);
        assert_eq!(
            shared.lock().await.connections[0]
                .snapshot
                .status_observed_at_ms,
            Some(60)
        );
        let mut snapshot = shared.lock().await.connections[0].snapshot.clone();
        snapshot.state.phase = "disconnected".into();
        assert!(
            Store::observe(&shared, root.path(), snapshot)
                .await
                .unwrap()
                .1
        );
        assert_ne!(std::fs::read(root.path().join(FILE)).unwrap(), before);
    }
    #[tokio::test]
    async fn restart_notice_survives_stop_and_clears_on_the_next_generation() {
        let root = tempfile::tempdir().unwrap();
        let mut record = persistent_record();
        let status = |generation: Option<&str>, state: &str| {
            serde_json::from_value(serde_json::json!({
                "state":state,"generation":generation,"lifecycle":null,"playerCount":null,
                "playerCountKnown":false,"playerCountObservedAtMs":null,"uptimeSeconds":null,
                "readiness":"ready","readinessReason":null,"readinessEvidence":"log_only",
                "supervision":"in_process","supervisor":null
            }))
            .unwrap()
        };
        record.snapshot.status = Some(status(Some("first"), "running"));
        record.snapshot.restart_required = true;
        let mut store = Store::default();
        store.connections.push(record);
        let shared = Arc::new(Mutex::new(store));
        let mut incoming = shared.lock().await.connections[0].snapshot.clone();
        incoming.restart_required = false;
        assert!(
            Store::observe(&shared, root.path(), incoming.clone())
                .await
                .unwrap()
                .0
                .restart_required
        );
        incoming.status = Some(status(None, "stopped"));
        assert!(
            Store::observe(&shared, root.path(), incoming.clone())
                .await
                .unwrap()
                .0
                .restart_required
        );
        incoming.status = Some(status(Some("second"), "running"));
        assert!(
            !Store::observe(&shared, root.path(), incoming)
                .await
                .unwrap()
                .0
                .restart_required
        );
    }
    #[tokio::test]
    async fn failed_removal_preserves_connection_and_success_journals_vault_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let blocked = root.path().join("file-not-directory");
        std::fs::write(&blocked, b"fixture").unwrap();
        let mut store = Store::default();
        store.connections.push(persistent_record());
        let key = store.connections[0].key_reference.clone();
        let shared = Arc::new(Mutex::new(store));
        assert!(
            Store::edit(&shared, &blocked, |s| s.remove_connection("one"))
                .await
                .is_err()
        );
        assert_eq!(shared.lock().await.connections[0].key_reference, key);
        assert!(shared.lock().await.pending_credential_deletions.is_empty());
        Store::edit(&shared, root.path(), |s| s.remove_connection("one"))
            .await
            .unwrap();
        let restarted = Store::load(root.path()).unwrap();
        assert!(restarted.connections.is_empty());
        assert_eq!(restarted.pending_credential_deletions, [key]);
    }
    #[test]
    fn cancelled_save_waiter_cannot_split_disk_and_memory_or_let_a_writer_overtake() {
        use std::{
            future::{poll_fn, Future},
            task::Poll,
            time::Duration,
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            let root = tempfile::tempdir().unwrap();
            let shared = Arc::new(Mutex::new(Store::default()));
            let (started, waiting) = std::sync::mpsc::channel();
            let (release, blocked) = std::sync::mpsc::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            waiting.recv_timeout(Duration::from_secs(2)).unwrap();
            let mut edit = Box::pin(Store::edit(&shared, root.path(), |s| {
                s.pending_enrollment_keys.push("first".into());
                Ok(())
            }));
            poll_fn(|cx| {
                assert!(edit.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(edit); // Disk work is queued, but its owned transaction remains alive.
            assert!(shared.try_lock().is_err());
            release.send(()).unwrap();
            blocker.await.unwrap();
            Store::edit(&shared, root.path(), |s| {
                assert_eq!(s.pending_enrollment_keys, ["first"]);
                s.pending_enrollment_keys.push("second".into());
                Ok(())
            })
            .await
            .unwrap();
            assert_eq!(
                Store::load(root.path()).unwrap().pending_enrollment_keys,
                ["first", "second"]
            );
        });
    }
    #[test]
    fn management_prepare_is_not_replayable_after_restart_and_journal_is_payload_free() {
        let root = tempfile::tempdir().unwrap();
        let pending = PendingIntent {
            connection_id: "connection".into(),
            key: "intent-hash".into(),
            key_version: 2,
            auth_revision: None,
            action: "backups/restore-in-place".into(),
            payload_hash: "payload-hash".into(),
            operation_id: None,
            created_at_ms: 1,
            terminal: false,
            uncertain: true,
        };
        let mut store = Store::default();
        store
            .reserve_management_intent(pending.clone(), true)
            .unwrap();
        store.save(root.path()).unwrap();
        let mut restarted = Store::load(root.path()).unwrap();
        assert_eq!(
            restarted
                .reserve_management_intent(pending.clone(), true)
                .unwrap_err()
                .code,
            ErrorCode::OutcomeUnknown
        );
        let mut changed = pending.clone();
        changed.payload_hash = "different".into();
        assert_eq!(
            restarted
                .reserve_management_intent(changed, true)
                .unwrap_err()
                .code,
            ErrorCode::Conflict
        );
        let mut replayable = pending;
        replayable.key = "other-intent".into();
        replayable.action = "pack/publish".into();
        restarted
            .reserve_management_intent(replayable.clone(), false)
            .unwrap();
        restarted
            .reserve_management_intent(replayable, false)
            .unwrap();
        let bytes = std::fs::read_to_string(root.path().join(FILE)).unwrap();
        for forbidden in ["confirmation", "token", "snapshot", "paths", "code"] {
            assert!(!bytes.contains(forbidden));
        }
    }
    #[test]
    fn session_only_connections_and_journals_never_survive_restart() {
        let root = tempfile::tempdir().unwrap();
        let snapshot: ServerSnapshot = serde_json::from_value(serde_json::json!({
            "connection": {"id":"session-only", "name":"temporary", "endpoint":"localhost:8443", "serverId":"server", "fingerprint":"ab".repeat(32), "role":null, "signInMethod":"pairing_code", "memoryOnly":true, "pinned":false, "addedAtMs":0, "lastConnectedAtMs":null},
            "state":{"phase":"online", "access":"paired", "retryAtMs":null, "rateLimitedUntilMs":null, "lastError":null},
            "info":null, "status":null, "statusObservedAtMs":null, "pack":null,
            "capabilities":{"source":"unknown", "granted":[], "refused":[]}, "restartRequired":false
        })).unwrap();
        let mut store = Store::default();
        store.connections.push(Record {
            snapshot,
            device_id: "temporary-device".into(),
            key_reference: "temporary-key".into(),
        });
        store.intents.push(PendingIntent {
            connection_id: "session-only".into(),
            key: "temporary-intent".into(),
            key_version: 2,
            auth_revision: None,
            action: "lifecycle.start".into(),
            payload_hash: "hash".into(),
            operation_id: None,
            created_at_ms: 0,
            terminal: false,
            uncertain: true,
        });
        store.save(root.path()).unwrap();
        let bytes = std::fs::read(root.path().join(FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("temporary"));
        assert!(Store::load(root.path()).unwrap().connections.is_empty());
        // A profile written by an older launcher must also drop temporary entries.
        std::fs::write(root.path().join(FILE), serde_json::to_vec(&store).unwrap()).unwrap();
        let restarted = Store::load(root.path()).unwrap();
        assert!(restarted.connections.is_empty());
        assert!(restarted.intents.is_empty());
    }
    #[test]
    fn metadata_is_atomic_profile_isolated_and_does_not_store_mutation_payloads() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        store.intents.push(PendingIntent {
            connection_id: "connection".into(),
            key: "launcher-hash".into(),
            key_version: 2,
            auth_revision: None,
            action: "console.command".into(),
            payload_hash: "payload-hash".into(),
            operation_id: Some("operation".into()),
            created_at_ms: 1,
            terminal: false,
            uncertain: true,
        });
        store
            .pending_enrollment_keys
            .push(uuid::Uuid::new_v4().to_string());
        store.save(a.path()).unwrap();
        store.save(a.path()).unwrap();
        assert_eq!(Store::load(a.path()).unwrap().intents.len(), 1);
        assert!(Store::load(b.path()).unwrap().intents.is_empty());
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(a.path().join(FILE)).unwrap()).unwrap();
        let intent = value["intents"][0].as_object().unwrap();
        assert!(!intent.contains_key("body"));
        assert!(!intent.contains_key("token"));
        assert!(!intent.contains_key("line"));
        assert!(!intent.contains_key("privateKey"));
        std::fs::write(b.path().join(FILE), b"invalid store").unwrap();
        assert!(Store::load(b.path()).is_err());
        assert_eq!(
            std::fs::read(b.path().join(FILE)).unwrap(),
            b"invalid store"
        );
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingIntent {
    pub connection_id: String,
    pub key: String,
    /// Missing on pre-followup journals, whose wire key must survive upgrade.
    #[serde(default)]
    pub key_version: u8,
    #[serde(default)]
    pub auth_revision: Option<String>,
    pub action: String,
    pub payload_hash: String,
    pub operation_id: Option<String>,
    pub created_at_ms: i64,
    #[serde(default)]
    pub terminal: bool,
    #[serde(default)]
    pub uncertain: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub connections: Vec<Record>,
    pub intents: Vec<PendingIntent>,
    // Retain keys for enrollment with an uncertain response. No pairing code.
    #[serde(default)]
    pub pending_enrollment_keys: Vec<String>,
    /// Connection removal is committed before vault deletion. Failed cleanup
    /// survives restart and never leaves a listed connection without its key.
    #[serde(default)]
    pub pending_credential_deletions: Vec<String>,
}
const FILE: &str = "server-connections-v1.json";
const MAX_BYTES: u64 = 4 * 1024 * 1024;
fn failed(_: impl std::fmt::Display) -> Error {
    Error::new(ErrorCode::Internal)
}
impl Store {
    pub fn intent_uses_current_auth(&self, intent: &PendingIntent) -> bool {
        self.connections.iter().any(|record| record.snapshot.connection.id == intent.connection_id
            && record.snapshot.connection.auth_revision == intent.auth_revision)
    }
    /// Called by a serialized maintenance owner. Re-read after each deletion so
    /// concurrent removals cannot get stranded behind a stale queue snapshot.
    pub async fn cleanup_keys<F, Fut>(
        shared: &Arc<Mutex<Self>>,
        root: &Path,
        delete: F,
    ) -> Result<()>
    where
        F: Fn(String) -> Fut,
        Fut: std::future::Future<Output = Result<()>>,
    {
        loop {
            let key = shared
                .lock()
                .await
                .pending_credential_deletions
                .first()
                .cloned();
            let Some(key) = key else {
                return Ok(());
            };
            delete(key.clone()).await?;
            Self::edit(shared, root, |s| {
                s.pending_credential_deletions
                    .retain(|pending| pending != &key);
                Ok(())
            })
            .await?;
        }
    }
    pub async fn edit<T>(
        shared: &Arc<Mutex<Self>>,
        root: &Path,
        edit: impl FnOnce(&mut Self) -> Result<T>,
    ) -> Result<T> {
        let current = shared.clone().lock_owned().await;
        let mut next = current.clone();
        let result = edit(&mut next)?;
        Self::commit(current, next, root.to_owned()).await?;
        Ok(result)
    }
    async fn commit(mut current: OwnedMutexGuard<Self>, next: Self, root: PathBuf) -> Result<()> {
        // The blocking owner commits both disk and memory even if the command
        // future is dropped. Other writers cannot overtake an abandoned save.
        tokio::task::spawn_blocking(move || {
            next.save(&root)?;
            *current = next;
            Ok(())
        })
        .await
        .map_err(failed)?
    }
    pub async fn observe(
        shared: &Arc<Mutex<Self>>,
        root: &Path,
        mut snapshot: ServerSnapshot,
    ) -> Result<(ServerSnapshot, bool)> {
        let mut current = shared.clone().lock_owned().await;
        let record = current
            .connections
            .iter_mut()
            .find(|r| r.snapshot.connection.id == snapshot.connection.id)
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        // An observation started before reauthentication belongs to the retired
        // device. It must not restore its capabilities or private data.
        if snapshot.connection.auth_revision != record.snapshot.connection.auth_revision {
            return Ok((record.snapshot.clone(), false));
        }
        // HTTP, stream and failure observations all pass through this merge.
        // Keep pending settings through stop; clear only on observing a new run.
        let old = record
            .snapshot
            .status
            .as_ref()
            .and_then(|s| s.generation.as_ref());
        let new = snapshot.status.as_ref().and_then(|s| s.generation.as_ref());
        snapshot.restart_required =
            record.snapshot.restart_required && !(new.is_some() && new != old);
        let connected = snapshot.connection.last_connected_at_ms;
        let reported_name = snapshot.connection.name.clone();
        snapshot.connection = record.snapshot.connection.clone();
        snapshot.connection.last_connected_at_ms =
            connected.or(snapshot.connection.last_connected_at_ms);
        if snapshot.connection.name == snapshot.connection.endpoint {
            snapshot.connection.name = reported_name;
        }
        let changed = coarse_state(&record.snapshot) != coarse_state(&snapshot)
            || record.snapshot.connection.name != snapshot.connection.name;
        if changed {
            let mut next = current.clone();
            let record = next
                .connections
                .iter_mut()
                .find(|r| r.snapshot.connection.id == snapshot.connection.id)
                .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
            record.snapshot = snapshot.clone();
            Self::commit(current, next, root.to_owned()).await?;
        } else {
            // High-frequency telemetry is volatile. No profile clone, JSON
            // serialization, file replacement or fsync for an ordinary sample.
            record.snapshot = snapshot.clone();
        }
        Ok((snapshot, changed))
    }
    pub fn remove_connection(&mut self, id: &str) -> Result<()> {
        let record = self
            .connections
            .iter()
            .find(|r| r.snapshot.connection.id == id)
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        if !record.snapshot.connection.memory_only {
            if self.pending_credential_deletions.len() >= 256 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            self.pending_credential_deletions
                .push(record.key_reference.clone());
        }
        self.connections.retain(|r| r.snapshot.connection.id != id);
        self.intents.retain(|i| i.connection_id != id);
        Ok(())
    }
    pub fn enroll(&mut self, mut record: Record, existing: Option<&str>) -> Result<ServerSnapshot> {
        if let Some(id) = existing {
            let index = self.connections.iter().position(|r| r.snapshot.connection.id == id)
                .ok_or_else(|| Error::new(ErrorCode::Conflict))?;
            let old = &self.connections[index];
            let before = &old.snapshot.connection;
            let after = &mut record.snapshot.connection;
            if before.server_id != after.server_id || before.fingerprint != after.fingerprint {
                return Err(Error::new(ErrorCode::FingerprintMismatch));
            }
            if !before.memory_only {
                if self.pending_credential_deletions.len() >= 256 { return Err(Error::new(ErrorCode::ServerBusy)); }
                self.pending_credential_deletions.push(old.key_reference.clone());
            }
            after.id = before.id.clone();
            after.name = before.name.clone();
            after.pinned = before.pinned;
            after.added_at_ms = before.added_at_ms;
            self.pending_enrollment_keys.retain(|key| key != &record.key_reference);
            let snapshot = record.snapshot.clone();
            self.connections[index] = record;
            Ok(snapshot)
        } else {
            if self.connections.len() >= 100 { return Err(Error::new(ErrorCode::ServerBusy)); }
            if self.connections.iter().any(|r| r.snapshot.connection.server_id == record.snapshot.connection.server_id) {
                return Err(Error::new(ErrorCode::Conflict));
            }
            let snapshot = record.snapshot.clone();
            self.pending_enrollment_keys.retain(|key| key != &record.key_reference);
            self.connections.push(record);
            Ok(snapshot)
        }
    }
    /// Reserve before sending. One-shot routes bypass agent replay caches, so even
    /// an identical intent must not be submitted again after a launcher restart.
    pub fn reserve_management_intent(&mut self, mut pending: PendingIntent, once: bool) -> Result<()> {
        pending.auth_revision = self.connections.iter().find(|r| r.snapshot.connection.id == pending.connection_id)
            .and_then(|r| r.snapshot.connection.auth_revision.clone());
        if let Some(old) = self
            .intents
            .iter()
            .find(|i| i.connection_id == pending.connection_id && i.key == pending.key)
        {
            if old.action != pending.action || old.payload_hash != pending.payload_hash || old.auth_revision != pending.auth_revision {
                return Err(Error::new(ErrorCode::Conflict));
            }
            return if once {
                Err(Error::new(ErrorCode::OutcomeUnknown))
            } else {
                Ok(())
            };
        }
        if self.intents.len() >= 4096 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        self.intents.push(pending);
        Ok(())
    }
    pub fn load(root: &Path) -> Result<Self> {
        let file = match std::fs::File::open(root.join(FILE)) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(failed(e)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(failed)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(Error::new(ErrorCode::Internal));
        }
        let mut store: Self = serde_json::from_slice(&bytes).map_err(failed)?;
        if store.connections.len() > 100
            || store.intents.len() > 4096
            || store.pending_enrollment_keys.len() > 32
            || store.pending_credential_deletions.len() > 256
        {
            return Err(Error::new(ErrorCode::Internal));
        }
        // Session-only entries, including metadata from older versions, are dropped.
        let dropped: Vec<_> = store
            .connections
            .iter()
            .filter(|r| r.snapshot.connection.memory_only)
            .map(|r| r.snapshot.connection.id.clone())
            .collect();
        store
            .connections
            .retain(|r| !r.snapshot.connection.memory_only);
        store
            .intents
            .retain(|i| !dropped.contains(&i.connection_id));
        for record in &mut store.connections {
            record.snapshot.state = Default::default();
        }
        Ok(store)
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        // Memory-only devices and their intent journals never enter profile storage.
        let mut persisted = self.clone();
        persisted
            .connections
            .retain(|r| !r.snapshot.connection.memory_only);
        persisted.intents.retain(|i| {
            !self.connections.iter().any(|r| {
                r.snapshot.connection.id == i.connection_id && r.snapshot.connection.memory_only
            })
        });
        let bytes = serde_json::to_vec(&persisted).map_err(failed)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        std::fs::create_dir_all(root).map_err(failed)?;
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(failed)?;
        file.write_all(&bytes).map_err(failed)?;
        file.as_file().sync_all().map_err(failed)?;
        file.persist(root.join(FILE)).map_err(failed)?;
        Ok(())
    }
}

type CoarseGameState<'a> = (&'a str, Option<&'a str>, Option<&'a str>, &'a str);
type CoarseConnectionState<'a> = (&'a str, &'a str, Option<CoarseGameState<'a>>);
fn coarse_state(snapshot: &ServerSnapshot) -> CoarseConnectionState<'_> {
    (
        &snapshot.state.phase,
        &snapshot.state.access,
        snapshot.status.as_ref().map(|s| {
            (
                s.state.as_str(),
                s.lifecycle.as_deref(),
                s.generation.as_deref(),
                s.readiness.as_str(),
            )
        }),
    )
}
