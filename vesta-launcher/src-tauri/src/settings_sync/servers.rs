//! Shared multiplayer server list and bounded `servers.dat` adapter.
use super::{bundle::SERIAL, Category, Preferences, Snapshot};
use crate::tasks::manager::{instance_play_conflict_key, TaskManager};
use crate::utils::db::get_config_conn;
use diesel::{prelude::*, sql_types::Text};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{btree_map::Entry, BTreeMap, BTreeSet, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_DECOMPRESSED_BYTES: usize = 4 * 1024 * 1024;
const MAX_SERVERS: usize = 10_000;
const MAX_BUNDLE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncedServer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ServerBundle {
    servers: BTreeMap<String, SyncedServer>,
    applied: BTreeMap<i32, BTreeMap<String, SyncedServer>>,
    known_instances: BTreeSet<i32>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
struct ServerDat {
    #[serde(default)]
    servers: Vec<ServerEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct ServerEntry {
    name: String,
    ip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(
        default,
        rename = "acceptTextures",
        skip_serializing_if = "Option::is_none"
    )]
    accept_textures: Option<i8>,
    #[serde(flatten)]
    extra: HashMap<String, fastnbt::Value>,
}

#[derive(Clone, Debug)]
struct FileSnapshot {
    bytes: Option<Vec<u8>>,
    compressed: bool,
    document: ServerDat,
}

#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Text)]
    state: String,
}

fn normalize_address(address: &str) -> String {
    address.trim().to_lowercase()
}

fn server_id(address: &str) -> String {
    hex::encode(Sha256::digest(normalize_address(address).as_bytes()))
}

fn validate_server(name: &str, address: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.len() > 256 || name.contains(['\r', '\n']) {
        return Err("Server name must be between 1 and 256 characters.".into());
    }
    if address.trim().is_empty() || address.len() > 512 || address.contains(['\r', '\n']) {
        return Err("Server address must be between 1 and 512 characters.".into());
    }
    Ok(())
}

const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";

fn visible_icon(icon: Option<String>) -> Option<String> {
    icon.and_then(|value| {
        let encoded = value.strip_prefix(PNG_DATA_URL_PREFIX).unwrap_or(&value);
        (!encoded.is_empty() && encoded.len() <= 512 * 1024)
            .then(|| format!("{PNG_DATA_URL_PREFIX}{encoded}"))
    })
}

fn synced(entry: &ServerEntry) -> Result<SyncedServer, String> {
    validate_server(&entry.name, &entry.ip)?;
    Ok(SyncedServer {
        id: server_id(&entry.ip),
        name: entry.name.trim().to_owned(),
        address: entry.ip.trim().to_owned(),
        icon: visible_icon(entry.icon.clone()),
    })
}

fn entry(server: &SyncedServer) -> ServerEntry {
    ServerEntry {
        name: server.name.clone(),
        ip: server.address.clone(),
        icon: server.icon.as_ref().map(|icon| {
            icon.strip_prefix(PNG_DATA_URL_PREFIX)
                .unwrap_or(icon)
                .to_owned()
        }),
        accept_textures: None,
        extra: HashMap::new(),
    }
}

fn load_bundle(conn: &mut SqliteConnection) -> Result<ServerBundle, String> {
    diesel::sql_query("SELECT state FROM shared_servers WHERE id = 1")
        .get_result::<Row>(conn)
        .optional()
        .map_err(|error| error.to_string())?
        .map(|row| {
            if row.state.len() > MAX_BUNDLE_BYTES {
                return Err("The shared server list exceeds the size limit.".into());
            }
            serde_json::from_str(&row.state).map_err(|error| error.to_string())
        })
        .unwrap_or_else(|| Ok(ServerBundle::default()))
}

fn store_bundle(conn: &mut SqliteConnection, bundle: &ServerBundle) -> Result<(), String> {
    let state = serde_json::to_string(bundle).map_err(|error| error.to_string())?;
    if state.len() > MAX_BUNDLE_BYTES {
        return Err("The shared server list exceeds the size limit.".into());
    }
    diesel::sql_query(
        "INSERT INTO shared_servers (id, state) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state",
    )
    .bind::<Text, _>(state)
    .execute(conn)
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn save_bundle_revision(
    conn: &mut SqliteConnection,
    snapshot: Snapshot,
    bundle: &ServerBundle,
) -> Result<Snapshot, String> {
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        let next = super::save_preferences(
            conn,
            Category::Servers,
            snapshot.revision,
            snapshot.preferences,
        )
        .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
        store_bundle(conn, bundle)
            .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
        Ok(next)
    })
    .map_err(|error| error.to_string())
}

fn read_file(directory: &Path) -> Result<FileSnapshot, String> {
    let path = crate::instance_file::checked_path(directory, "servers.dat")?;
    let bytes = crate::instance_file::read(&path, MAX_FILE_BYTES, "Server list")?;
    let compressed = bytes
        .as_deref()
        .is_some_and(|bytes| bytes.starts_with(&[0x1f, 0x8b]));
    let document = match bytes.as_deref() {
        None => ServerDat::default(),
        Some(bytes) => {
            let data = if compressed {
                let mut decoder = GzDecoder::new(bytes);
                let mut decoded = Vec::new();
                decoder
                    .by_ref()
                    .take(MAX_DECOMPRESSED_BYTES as u64 + 1)
                    .read_to_end(&mut decoded)
                    .map_err(|error| error.to_string())?;
                if decoded.len() > MAX_DECOMPRESSED_BYTES {
                    return Err("Server list exceeds the decompressed size limit".into());
                }
                decoded
            } else {
                bytes.to_vec()
            };
            fastnbt::from_bytes(&data).map_err(|error| error.to_string())?
        }
    };
    if document.servers.len() > MAX_SERVERS {
        return Err("Server list contains too many entries".into());
    }
    Ok(FileSnapshot {
        bytes,
        compressed,
        document,
    })
}

fn write_file(directory: &Path, before: &FileSnapshot, document: &ServerDat) -> Result<(), String> {
    let raw = fastnbt::to_bytes(document).map_err(|error| error.to_string())?;
    // Minecraft expects servers.dat to use uncompressed NBT. Compressed input
    // is still accepted so an older preview file is repaired on the next sync.
    let updated = raw;
    let path = crate::instance_file::checked_path(directory, "servers.dat")?;
    crate::instance_file::replace(
        directory,
        &path,
        before.bytes.as_deref(),
        &updated,
        MAX_FILE_BYTES,
        "Server list",
    )
}

fn capture(bundle: &mut ServerBundle, instance_id: i32, current: &ServerDat) {
    let current = current
        .servers
        .iter()
        .filter_map(|entry| synced(entry).ok())
        .map(|server| (server.id.clone(), server))
        .collect::<BTreeMap<_, _>>();
    if let Some(applied) = bundle.applied.get(&instance_id) {
        for (id, baseline) in applied {
            match current.get(id) {
                None => {
                    bundle.servers.remove(id);
                }
                Some(server) if server != baseline => {
                    bundle.servers.insert(id.clone(), server.clone());
                }
                _ => {}
            }
        }
    }
    for server in current.into_values() {
        match bundle.servers.entry(server.id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(server);
            }
            Entry::Occupied(mut entry) if entry.get().icon.is_none() && server.icon.is_some() => {
                entry.get_mut().icon = server.icon;
            }
            Entry::Occupied(_) => {}
        }
    }
}

fn enrich_icons(bundle: &mut ServerBundle, current: &ServerDat) {
    for server in current
        .servers
        .iter()
        .filter_map(|entry| synced(entry).ok())
        .filter(|server| server.icon.is_some())
    {
        if let Some(shared) = bundle.servers.get_mut(&server.id) {
            if shared.icon.is_none() {
                shared.icon = server.icon;
            }
        }
    }
}

fn merge(
    bundle: &ServerBundle,
    instance_id: i32,
    current: &ServerDat,
) -> (ServerDat, BTreeMap<String, SyncedServer>) {
    let mut updated = current.clone();
    let previous = bundle
        .applied
        .get(&instance_id)
        .cloned()
        .unwrap_or_default();
    updated.servers.retain(|entry| {
        let Ok(server) = synced(entry) else {
            return true;
        };
        !previous
            .get(&server.id)
            .is_some_and(|baseline| baseline == &server && !bundle.servers.contains_key(&server.id))
    });
    let mut applied = BTreeMap::new();
    for (id, shared) in &bundle.servers {
        match updated
            .servers
            .iter_mut()
            .find(|entry| server_id(&entry.ip) == *id)
        {
            Some(existing) if previous.contains_key(id) => {
                existing.name = shared.name.clone();
                existing.ip = shared.address.clone();
                existing.icon = entry(shared).icon;
                applied.insert(id.clone(), shared.clone());
            }
            Some(_) => {}
            None => {
                updated.servers.push(entry(shared));
                applied.insert(id.clone(), shared.clone());
            }
        }
    }
    (updated, applied)
}

async fn instance_directory(id: i32) -> Result<PathBuf, String> {
    let instance =
        tauri::async_runtime::spawn_blocking(move || crate::commands::instances::get_instance(id))
            .await
            .map_err(|error| error.to_string())??;
    if instance.installation_status.as_deref() != Some("installed") {
        return Err("Instance is not ready for server sync.".into());
    }
    if piston_lib::game::launcher::is_instance_running(&instance.slug())
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("Instance is running.".into());
    }
    crate::commands::game_options::directory(&instance)
}

async fn preferences() -> Result<Preferences, String> {
    tauri::async_runtime::spawn_blocking(|| {
        super::read(
            &mut *get_config_conn().map_err(|error| error.to_string())?,
            Category::Servers,
        )
        .map(|snapshot| snapshot.preferences)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn apply_one(
    conn: &mut SqliteConnection,
    bundle: &mut ServerBundle,
    id: i32,
    directory: &Path,
    current: FileSnapshot,
) -> Result<(), String> {
    let (updated, applied) = merge(bundle, id, &current.document);
    if current.compressed || updated != current.document {
        write_file(directory, &current, &updated)?;
    }
    bundle.applied.insert(id, applied);
    store_bundle(conn, bundle)
}

fn reconcile_files(
    prefs: Preferences,
    ready: Vec<(i32, PathBuf)>,
    capture_id: Option<i32>,
    import_new_followers: bool,
) -> Result<Vec<String>, String> {
    let mut pending = Vec::new();
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let mut bundle = load_bundle(&mut conn)?;
    bundle
        .applied
        .retain(|id, _| prefs.instance_ids.contains(id));
    let mut files = Vec::new();
    for (id, directory) in ready {
        match read_file(&directory) {
            Ok(current) => {
                let first_follow = !bundle.known_instances.contains(&id);
                enrich_icons(&mut bundle, &current.document);
                if capture_id == Some(id) || (import_new_followers && first_follow) {
                    capture(&mut bundle, id, &current.document);
                }
                bundle.known_instances.insert(id);
                files.push((id, directory, current));
            }
            Err(error) => pending.push(format!("Instance {id}: {error}")),
        }
    }
    store_bundle(&mut conn, &bundle)?;
    for (id, directory, current) in files {
        if let Err(error) = apply_one(&mut conn, &mut bundle, id, &directory, current) {
            pending.push(format!("Instance {id}: {error}"));
        }
    }
    Ok(pending)
}

async fn reconcile_all(
    app: &tauri::AppHandle,
    capture_id: Option<i32>,
    import_new_followers: bool,
) -> Vec<String> {
    let mut pending = Vec::new();
    let result = async {
        let prefs = preferences().await?;
        if !prefs.enabled {
            return Ok::<(), String>(());
        }
        let manager = app.state::<TaskManager>();
        let mut guards = Vec::new();
        let mut ready = Vec::new();
        for id in &prefs.instance_ids {
            match tokio::time::timeout(
                std::time::Duration::from_millis(1),
                manager.acquire_conflicts([instance_play_conflict_key(*id)]),
            )
            .await
            {
                Ok(guard) => {
                    guards.push(guard);
                    ready.push(*id);
                }
                Err(_) => pending.push(format!("Instance {id} is busy; sync pending.")),
            }
        }
        let _serial = SERIAL.lock().await;
        let prefs = preferences().await?;
        if !prefs.enabled {
            return Ok::<(), String>(());
        }
        ready.retain(|id| prefs.instance_ids.contains(id));
        let mut directories = Vec::new();
        for id in ready {
            match instance_directory(id).await {
                Ok(directory) => directories.push((id, directory)),
                Err(error) => {
                    pending.push(format!("Instance {id}: {error}"));
                }
            }
        }
        let file_pending = tauri::async_runtime::spawn_blocking(move || {
            reconcile_files(prefs, directories, capture_id, import_new_followers)
        })
        .await
        .map_err(|error| error.to_string())??;
        pending.extend(file_pending);
        drop(guards);
        Ok(())
    }
    .await;
    if let Err(error) = result {
        pending.push(error);
    }
    pending
}

pub(crate) async fn refresh(app: &tauri::AppHandle) -> Vec<String> {
    reconcile_all(app, None, false).await
}

pub(crate) fn populate(conn: &mut SqliteConnection, snapshot: &mut Snapshot) -> Result<(), String> {
    let bundle = load_bundle(conn)?;
    snapshot.initialized = !bundle.servers.is_empty();
    snapshot.servers = bundle.servers.into_values().collect();
    Ok(())
}

pub(crate) async fn configure(
    app: &tauri::AppHandle,
    revision: i64,
    preferences: Preferences,
) -> Result<Snapshot, String> {
    let serial = SERIAL.lock().await;
    let mut snapshot = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_config_conn().map_err(|error| error.to_string())?;
        let snapshot =
            super::save_preferences(&mut conn, Category::Servers, revision, preferences)?;
        if !snapshot.preferences.enabled {
            let mut bundle = load_bundle(&mut conn)?;
            bundle.applied.clear();
            store_bundle(&mut conn, &bundle)?;
        }
        Ok::<_, String>(snapshot)
    })
    .await
    .map_err(|error| error.to_string())??;
    drop(serial);
    snapshot.pending = reconcile_all(app, None, true).await;
    populate(
        &mut *get_config_conn().map_err(|error| error.to_string())?,
        &mut snapshot,
    )?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn add_synced_server(
    app: tauri::AppHandle,
    revision: i64,
    name: String,
    address: String,
) -> Result<Snapshot, String> {
    validate_server(&name, &address)?;
    let _serial = SERIAL.lock().await;
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let snapshot = super::read(&mut conn, Category::Servers)?;
    if snapshot.revision != revision {
        return Err("Sync settings changed elsewhere. Reload before saving.".into());
    }
    if !snapshot.preferences.enabled {
        return Err("Enable server sync before adding a server.".into());
    }
    let server = SyncedServer {
        id: server_id(&address),
        name: name.trim().to_owned(),
        address: address.trim().to_owned(),
        icon: None,
    };
    let mut bundle = load_bundle(&mut conn)?;
    if !bundle.servers.contains_key(&server.id) && bundle.servers.len() >= MAX_SERVERS {
        return Err("The shared server list is full.".into());
    }
    bundle.servers.insert(server.id.clone(), server);
    let mut snapshot = save_bundle_revision(&mut conn, snapshot, &bundle)?;
    drop(conn);
    drop(_serial);
    snapshot.pending = reconcile_all(&app, None, false).await;
    populate(
        &mut *get_config_conn().map_err(|error| error.to_string())?,
        &mut snapshot,
    )?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn remove_synced_server(
    app: tauri::AppHandle,
    revision: i64,
    server_id: String,
) -> Result<Snapshot, String> {
    let _serial = SERIAL.lock().await;
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let snapshot = super::read(&mut conn, Category::Servers)?;
    if snapshot.revision != revision {
        return Err("Sync settings changed elsewhere. Reload before saving.".into());
    }
    if !snapshot.preferences.enabled {
        return Err("Enable server sync before removing a server.".into());
    }
    let mut bundle = load_bundle(&mut conn)?;
    if bundle.servers.remove(&server_id).is_none() {
        return Err("Server is no longer in the shared list.".into());
    }
    let mut snapshot = save_bundle_revision(&mut conn, snapshot, &bundle)?;
    drop(conn);
    drop(_serial);
    snapshot.pending = reconcile_all(&app, None, false).await;
    populate(
        &mut *get_config_conn().map_err(|error| error.to_string())?,
        &mut snapshot,
    )?;
    Ok(snapshot)
}

pub(crate) async fn apply_under_play_guard(id: i32) -> Result<(), String> {
    let _serial = SERIAL.lock().await;
    let prefs = preferences().await?;
    if !prefs.enabled || !prefs.instance_ids.contains(&id) {
        return Ok(());
    }
    let directory = instance_directory(id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_config_conn().map_err(|error| error.to_string())?;
        let current = read_file(&directory)?;
        let mut bundle = load_bundle(&mut conn)?;
        capture(&mut bundle, id, &current.document);
        apply_one(&mut conn, &mut bundle, id, &directory, current)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) async fn after_exit(app: &tauri::AppHandle, slug: String) {
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::instances::get_instance_by_slug(slug)
    })
    .await;
    let id = match resolved {
        Ok(Ok(instance)) => instance.id,
        Ok(Err(error)) => {
            log::warn!("Server sync could not resolve exited instance: {error}");
            return;
        }
        Err(error) => {
            log::warn!("Server sync task failed: {error}");
            return;
        }
    };
    for error in reconcile_all(app, Some(id), false).await {
        log::warn!("Server sync pending: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;

    fn server(name: &str, address: &str) -> SyncedServer {
        SyncedServer {
            id: server_id(address),
            name: name.into(),
            address: address.into(),
            icon: None,
        }
    }

    #[test]
    fn server_file_round_trip_preserves_local_fields() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().canonicalize().unwrap();
        let mut extra = HashMap::new();
        extra.insert("hidden".into(), fastnbt::Value::Byte(1));
        let document = ServerDat {
            servers: vec![ServerEntry {
                name: "Local".into(),
                ip: "localhost".into(),
                icon: None,
                accept_textures: Some(1),
                extra,
            }],
        };
        let missing = read_file(&directory).unwrap();
        write_file(&directory, &missing, &document).unwrap();
        assert_eq!(std::fs::read(directory.join("servers.dat")).unwrap()[0], 10);
        assert_eq!(read_file(&directory).unwrap().document, document);
    }

    #[test]
    fn server_icons_are_exposed_as_data_urls_and_stored_as_raw_base64() {
        let raw_icon = "iVBORw0KGgo=";
        let source = ServerEntry {
            name: "Icon server".into(),
            ip: "icon.example.test".into(),
            icon: Some(raw_icon.into()),
            accept_textures: None,
            extra: HashMap::new(),
        };
        let synced = synced(&source).unwrap();
        assert_eq!(
            synced.icon.as_deref(),
            Some("data:image/png;base64,iVBORw0KGgo=")
        );
        assert_eq!(entry(&synced).icon.as_deref(), Some(raw_icon));
    }

    #[test]
    fn merge_keeps_local_duplicates_and_removes_only_applied_entries() {
        let shared = server("Shared", "play.example.test");
        let local = server("Local name", "play.example.test");
        let current = ServerDat {
            servers: vec![entry(&local)],
        };
        let mut bundle = ServerBundle {
            servers: BTreeMap::from([(shared.id.clone(), shared.clone())]),
            ..Default::default()
        };
        let (unchanged, applied) = merge(&bundle, 1, &current);
        assert_eq!(unchanged, current);
        assert!(applied.is_empty());

        let empty = ServerDat::default();
        let (written, applied) = merge(&bundle, 2, &empty);
        assert_eq!(written.servers, vec![entry(&shared)]);
        bundle.applied.insert(2, applied);
        bundle.servers.clear();
        let (removed, _) = merge(&bundle, 2, &written);
        assert!(removed.servers.is_empty());
    }

    #[test]
    fn merge_preserves_instance_owned_server_fields() {
        let before = server("Before", "play.example.test");
        let after = server("After", "play.example.test");
        let mut local = entry(&before);
        local.accept_textures = Some(1);
        local.extra.insert("hidden".into(), fastnbt::Value::Byte(1));
        let bundle = ServerBundle {
            servers: BTreeMap::from([(after.id.clone(), after.clone())]),
            applied: BTreeMap::from([(1, BTreeMap::from([(before.id.clone(), before)]))]),
            ..Default::default()
        };

        let (updated, _) = merge(
            &bundle,
            1,
            &ServerDat {
                servers: vec![local],
            },
        );

        assert_eq!(updated.servers[0].name, "After");
        assert_eq!(updated.servers[0].accept_textures, Some(1));
        assert_eq!(
            updated.servers[0].extra.get("hidden"),
            Some(&fastnbt::Value::Byte(1))
        );
    }

    #[test]
    fn store_rejects_an_oversized_shared_bundle() {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/config/2026-09-22-000000_shared_servers/up.sql"
        ))
        .unwrap();
        let oversized = ServerBundle {
            servers: BTreeMap::from([(
                "large".into(),
                SyncedServer {
                    id: "large".into(),
                    name: "Large".into(),
                    address: "large.example.test".into(),
                    icon: Some("x".repeat(MAX_BUNDLE_BYTES)),
                },
            )]),
            ..Default::default()
        };

        assert_eq!(
            store_bundle(&mut conn, &oversized).unwrap_err(),
            "The shared server list exceeds the size limit."
        );
    }

    #[test]
    fn capture_unions_new_servers_and_propagates_synced_removals() {
        let first = server("First", "one.example.test");
        let second = server("Second", "two.example.test");
        let mut bundle = ServerBundle {
            servers: BTreeMap::from([(first.id.clone(), first.clone())]),
            applied: BTreeMap::from([(1, BTreeMap::from([(first.id.clone(), first.clone())]))]),
            ..Default::default()
        };
        capture(
            &mut bundle,
            1,
            &ServerDat {
                servers: vec![entry(&second)],
            },
        );
        assert!(!bundle.servers.contains_key(&first.id));
        assert_eq!(bundle.servers[&second.id], second);
    }

    #[test]
    fn capture_adds_an_icon_discovered_on_another_follower() {
        let mut shared = server("Shared", "play.example.test");
        let mut with_icon = shared.clone();
        with_icon.icon = Some("data:image/png;base64,iVBORw0KGgo=".into());
        let mut bundle = ServerBundle {
            servers: BTreeMap::from([(shared.id.clone(), shared.clone())]),
            ..Default::default()
        };

        capture(
            &mut bundle,
            2,
            &ServerDat {
                servers: vec![entry(&with_icon)],
            },
        );

        shared.icon = with_icon.icon;
        assert_eq!(bundle.servers[&shared.id], shared);
    }

    #[test]
    fn snapshot_exposes_persisted_servers() {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/config/2026-09-13-000000_settings_sync/up.sql"
        ))
        .unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/config/2026-09-22-000000_shared_servers/up.sql"
        ))
        .unwrap();
        let expected = server("Test", "test.example.test");
        store_bundle(
            &mut conn,
            &ServerBundle {
                servers: BTreeMap::from([(expected.id.clone(), expected.clone())]),
                ..Default::default()
            },
        )
        .unwrap();
        let mut snapshot = super::super::empty_snapshot(Category::Servers);
        populate(&mut conn, &mut snapshot).unwrap();
        assert_eq!(snapshot.servers, vec![expected]);
    }
}
