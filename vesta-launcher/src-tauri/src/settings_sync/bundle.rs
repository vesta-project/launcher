//! Shared file-backed category operations. Both categories serialize through
//! one mutex because they patch the same physical document. Lock order: play, SERIAL.
use super::{Category, Preferences, SharedBundle, SharedValue, Snapshot};
use crate::tasks::manager::{instance_play_conflict_key, TaskManager};
use crate::utils::db::get_config_conn;
use crate::{
    game_options::catalog,
    game_options_file::{self, Patch},
};
use diesel::{prelude::*, sql_types::Text};
use std::{collections::BTreeMap, path::Path};
use tauri::Manager;

pub(super) static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
type Values = BTreeMap<String, String>;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Text)]
    state: String,
}
fn table(category: Category) -> &'static str {
    match category {
        Category::GameOptions => "shared_game_options",
        Category::Keybinds => "shared_keybinds",
        _ => unreachable!(),
    }
}
pub(super) fn load(
    conn: &mut SqliteConnection,
    category: Category,
) -> Result<SharedBundle, String> {
    diesel::sql_query(format!(
        "SELECT state FROM {} WHERE id = 1",
        table(category)
    ))
    .get_result::<Row>(conn)
    .optional()
    .map_err(|e| e.to_string())?
    .map(|row| serde_json::from_str(&row.state).map_err(|e| e.to_string()))
    .unwrap_or_else(|| Ok(SharedBundle::default()))
}
pub(super) fn store(
    conn: &mut SqliteConnection,
    category: Category,
    shared: &SharedBundle,
) -> Result<(), String> {
    diesel::sql_query(format!(
        "INSERT INTO {} (id,state) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
        table(category)
    ))
    .bind::<Text, _>(serde_json::to_string(shared).map_err(|e| e.to_string())?)
    .execute(conn)
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn eligible(category: Category, key: &str, version: &str) -> bool {
    match category {
        Category::GameOptions => {
            catalog::is_syncable_key(key)
                && catalog::definition(key)
                    .is_none_or(|s| catalog::setting_available_for_version(s, version))
        }
        Category::Keybinds => catalog::is_syncable_keybind(key),
        _ => false,
    }
}
fn valid(category: Category, key: &str, value: &str) -> bool {
    match category {
        Category::GameOptions => catalog::validate(key, value).is_ok(),
        Category::Keybinds => catalog::validate_keybind(key, value).is_ok(),
        _ => false,
    }
}
pub(super) fn seed(category: Category, values: &Values, version: &str) -> SharedBundle {
    SharedBundle {
        values: values
            .iter()
            .filter(|(k, v)| {
                eligible(category, k, version)
                    && match category {
                        Category::GameOptions => catalog::validate_observed(k, v).is_ok(),
                        Category::Keybinds => valid(category, k, v),
                        _ => false,
                    }
            })
            .map(|(k, v)| {
                (
                    k.clone(),
                    SharedValue {
                        key: k.clone(),
                        value: v.clone(),
                    },
                )
            })
            .collect(),
        ..Default::default()
    }
}
fn selected(prefs: &Preferences, key: &str) -> bool {
    prefs
        .selected_keys
        .as_ref()
        .is_none_or(|keys| keys.iter().any(|k| k == key))
}
fn target_key<'a>(entry: &'a SharedValue, current: &'a Values) -> Option<&'a str> {
    if current.contains_key(&entry.key) {
        return Some(&entry.key);
    }
    catalog::definition(&entry.key)?
        .keys
        .iter()
        .find(|key| current.contains_key(**key))
        .copied()
}
fn representation(value: &str) -> u8 {
    if value.starts_with('"') && value.ends_with('"') {
        0
    } else if matches!(value, "true" | "false") {
        1
    } else if value.parse::<f64>().is_ok() {
        2
    } else {
        3
    }
}
pub(super) fn patch(
    category: Category,
    shared: &SharedBundle,
    prefs: &Preferences,
    version: &str,
    current: &Values,
) -> Values {
    shared
        .values
        .iter()
        .filter_map(|(id, entry)| {
            if !selected(prefs, id) || !eligible(category, &entry.key, version) {
                return None;
            }
            let key = target_key(entry, current)?;
            // No guessed migration between historical boolean/numeric/quoted representations.
            if representation(&current[key]) != representation(&entry.value)
                || !valid(category, key, &entry.value)
            {
                return None;
            }
            Some((key.to_owned(), entry.value.clone()))
        })
        .collect()
}
pub(super) fn capture(
    category: Category,
    shared: &mut SharedBundle,
    prefs: &Preferences,
    id: i32,
    version: &str,
    current: &Values,
) {
    let Some(baseline) = shared.applied.get(&id) else {
        return;
    };
    for (setting_id, entry) in &mut shared.values {
        if !selected(prefs, setting_id) || !eligible(category, &entry.key, version) {
            continue;
        }
        let Some(key) = target_key(entry, current) else {
            continue;
        };
        if baseline
            .get(setting_id)
            .is_some_and(|previous| previous != &current[key])
            && valid(category, key, &current[key])
        {
            entry.value = current[key].clone();
        }
    }
}
fn baseline(shared: &SharedBundle, applied: &Values) -> Values {
    shared
        .values
        .iter()
        .filter_map(|(id, entry)| {
            target_key(entry, applied).map(|key| (id.clone(), applied[key].clone()))
        })
        .collect()
}
pub(super) fn persist(
    conn: &mut SqliteConnection,
    category: Category,
    revision: i64,
    mut prefs: Preferences,
    mut shared: SharedBundle,
) -> Result<Snapshot, String> {
    prefs.source_instance_id = None;
    shared
        .applied
        .retain(|id, _| prefs.enabled && prefs.instance_ids.contains(id));
    for values in shared.applied.values_mut() {
        values.retain(|key, _| selected(&prefs, key));
    }
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        let snapshot = super::save_preferences(conn, category, revision, prefs)
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        store(conn, category, &shared)
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        Ok(snapshot)
    })
    .map_err(|e| e.to_string())
}
pub(super) fn populate(conn: &mut SqliteConnection, snapshot: &mut Snapshot) -> Result<(), String> {
    let shared = load(conn, snapshot.category)?;
    snapshot.initialized = !shared.values.is_empty();
    snapshot.shared_values = shared.exposed_values();
    if snapshot.category == Category::GameOptions {
        for (key, value) in &mut snapshot.shared_values {
            if let Ok(decoded) = catalog::decode_for_editor(key, value) {
                *value = decoded;
            }
        }
        snapshot.catalog = catalog::editor_metadata();
    }
    Ok(())
}
async fn instance(id: i32) -> Result<(String, std::path::PathBuf), String> {
    let instance = crate::commands::instances::get_instance(id)?;
    if instance.installation_status.as_deref() != Some("installed")
        || piston_lib::game::launcher::is_instance_running(&instance.slug())
            .await
            .map_err(|e| e.to_string())?
    {
        return Err("Instance is busy; sync will retry after exit or before launch.".into());
    }
    Ok((
        instance.minecraft_version.clone(),
        crate::commands::game_options::directory(&instance)?,
    ))
}
async fn read_file(dir: &Path) -> Result<game_options_file::Snapshot, String> {
    let dir = dir.to_owned();
    tauri::async_runtime::spawn_blocking(move || game_options_file::load(&dir))
        .await
        .map_err(|e| e.to_string())?
}

// Keep blocking file and database writes off the async worker. Callers retain
// the play guard and SERIAL until this operation completes.
async fn apply_file(
    category: Category,
    id: i32,
    dir: std::path::PathBuf,
    version: String,
    prefs: Preferences,
    shared: SharedBundle,
    current: game_options_file::Snapshot,
) -> Result<SharedBundle, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_config_conn().map_err(|e| e.to_string())?;
        let mut shared = shared;
        apply(
            &mut conn,
            category,
            id,
            &dir,
            &version,
            &prefs,
            &mut shared,
            current,
        )?;
        Ok(shared)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) async fn reconcile(category: Category, id: i32, import: bool) -> Result<(), String> {
    let _serial = SERIAL.lock().await;
    let mut conn = get_config_conn().map_err(|e| e.to_string())?;
    let prefs = super::read(&mut conn, category)?.preferences;
    if !prefs.enabled || !prefs.instance_ids.contains(&id) {
        return Ok(());
    }
    let (version, dir) = instance(id).await?;
    let current = read_file(&dir).await?;
    let mut shared = load(&mut conn, category)?;
    if import {
        capture(category, &mut shared, &prefs, id, &version, &current.values);
        store(&mut conn, category, &shared)?;
    }
    drop(conn);
    apply_file(category, id, dir, version, prefs, shared, current)
        .await
        .map(|_| ())
}
fn apply(
    conn: &mut SqliteConnection,
    category: Category,
    id: i32,
    dir: &Path,
    version: &str,
    prefs: &Preferences,
    shared: &mut SharedBundle,
    current: game_options_file::Snapshot,
) -> Result<(), String> {
    let changes = patch(category, shared, prefs, version, &current.values);
    if changes.is_empty() {
        return Ok(());
    }
    game_options_file::save(
        dir,
        Patch {
            revision: current.revision,
            changes: changes.clone(),
        },
    )?;
    shared.applied.insert(id, baseline(shared, &changes));
    store(conn, category, shared)
}
async fn propagate(app: &tauri::AppHandle, category: Category) -> Vec<String> {
    let mut pending = Vec::new();
    let result = async {
        let ids = super::read(
            &mut *get_config_conn().map_err(|e| e.to_string())?,
            category,
        )?
        .preferences
        .instance_ids;
        let manager = app.state::<TaskManager>();
        let mut guards = Vec::new();
        let mut ready = Vec::new();
        for id in ids {
            match tokio::time::timeout(
                std::time::Duration::from_millis(1),
                manager.acquire_conflicts([instance_play_conflict_key(id)]),
            )
            .await
            {
                Ok(guard) => {
                    guards.push(guard);
                    ready.push(id);
                }
                Err(_) => pending.push(format!("Instance {id} is busy; sync pending.")),
            }
        }
        let _serial = SERIAL.lock().await;
        let mut conn = get_config_conn().map_err(|e| e.to_string())?;
        let prefs = super::read(&mut conn, category)?.preferences;
        if !prefs.enabled {
            return Ok::<(), String>(());
        }
        let mut shared = load(&mut conn, category)?;
        let mut captured = Vec::new();
        for id in ready
            .into_iter()
            .filter(|id| prefs.instance_ids.contains(id))
        {
            let result = async {
                let (version, dir) = instance(id).await?;
                let current = read_file(&dir).await?;
                Ok::<_, String>((version, dir, current))
            }
            .await;
            match result {
                Ok((version, dir, current)) => {
                    capture(category, &mut shared, &prefs, id, &version, &current.values);
                    captured.push((id, version, dir, current));
                }
                Err(e) => pending.push(format!("Instance {id}: {e}")),
            }
        }
        store(&mut conn, category, &shared)?;
        drop(conn);
        for (id, version, dir, current) in captured {
            match apply_file(
                category,
                id,
                dir,
                version,
                prefs.clone(),
                shared.clone(),
                current,
            )
            .await
            {
                Ok(updated) => shared = updated,
                Err(e) => pending.push(format!("Instance {id}: {e}")),
            }
        }
        Ok(())
    }
    .await;
    if let Err(e) = result {
        pending.push(e);
    }
    pending
}
fn edit_shared(
    category: Category,
    shared: &mut SharedBundle,
    changes: Values,
) -> Result<(), String> {
    for (key, value) in changes {
        let entry = shared
            .values
            .get_mut(&key)
            .ok_or("Setting is not in the seeded bundle")?;
        let raw = if category == Category::GameOptions && catalog::definition(&key).is_some() {
            catalog::encode_for_existing(&key, &value, &entry.value).map_err(str::to_owned)?
        } else {
            value
        };
        if !valid(category, &entry.key, &raw) {
            return Err("Invalid shared value".into());
        }
        entry.value = raw;
        // An explicit edit wins over changes made against older applied values,
        // including followers that are busy now and reconcile after exit.
        for baseline in shared.applied.values_mut() {
            baseline.remove(&key);
        }
    }
    Ok(())
}
fn seed_owner(prefs: &Preferences, shared: &SharedBundle) -> Result<Option<i32>, String> {
    if prefs.enabled && shared.values.is_empty() {
        prefs
            .source_instance_id
            .map(Some)
            .ok_or_else(|| "Choose an owner instance to initialize this category".into())
    } else {
        Ok(None)
    }
}
pub(super) async fn configure(
    app: &tauri::AppHandle,
    category: Category,
    revision: i64,
    _previous: Preferences,
    prefs: Preferences,
    changes: Values,
) -> Result<Snapshot, String> {
    let manager = app.state::<TaskManager>();
    let source_guard = if let Some(id) = prefs.source_instance_id.filter(|_| prefs.enabled) {
        Some(
            tokio::time::timeout(
                std::time::Duration::from_millis(1),
                manager.acquire_conflicts([instance_play_conflict_key(id)]),
            )
            .await
            .map_err(|_| "Source instance is busy")?,
        )
    } else {
        None
    };
    let mut snapshot = {
        let _serial = SERIAL.lock().await;
        let mut conn = get_config_conn().map_err(|e| e.to_string())?;
        let mut shared = load(&mut conn, category)?;
        if !prefs.enabled && !changes.is_empty() {
            return Err("Enable sync before editing shared values".into());
        }
        if let Some(id) = seed_owner(&prefs, &shared)? {
            let (version, dir) = instance(id).await?;
            shared = seed(category, &read_file(&dir).await?.values, &version);
            if shared.values.is_empty() {
                return Err("Owner has no supported settings; launch it once first".into());
            }
        }
        if prefs
            .selected_keys
            .as_ref()
            .is_some_and(|keys| keys.iter().any(|key| !shared.values.contains_key(key)))
        {
            return Err("Selected setting is not in the seeded bundle".into());
        }
        edit_shared(category, &mut shared, changes)?;
        persist(&mut conn, category, revision, prefs, shared)?
    };
    drop(source_guard);
    snapshot.pending = propagate(app, category).await;
    populate(
        &mut *get_config_conn().map_err(|e| e.to_string())?,
        &mut snapshot,
    )?;
    Ok(snapshot)
}
pub(super) async fn after_exit(app: tauri::AppHandle, _slug: String) {
    for category in [Category::GameOptions, Category::Keybinds] {
        for error in propagate(&app, category).await {
            log::warn!("Settings sync pending: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    fn connection() -> SqliteConnection {
        let mut c = SqliteConnection::establish(":memory:").unwrap();
        c.batch_execute(include_str!(
            "../../migrations/config/2026-09-13-000000_settings_sync/up.sql"
        ))
        .unwrap();
        c.batch_execute(include_str!(
            "../../migrations/config/2026-09-13-000001_shared_settings/up.sql"
        ))
        .unwrap();
        c
    }
    #[test]
    fn seed_keeps_observed_catalog_outliers_visible_without_writing_them() {
        let values = Values::from([
            ("renderDistance".into(), "81".into()),
            ("fov".into(), "0.75".into()),
            ("extraFlag".into(), "true".into()),
        ]);
        let shared = seed(Category::GameOptions, &values, "1.21.1");
        assert_eq!(shared.values.len(), 3);
        let target = Values::from([
            ("renderDistance".into(), "12".into()),
            ("fov".into(), "0".into()),
        ]);
        let changes = patch(
            Category::GameOptions,
            &shared,
            &Preferences::default(),
            "1.21.1",
            &target,
        );
        assert!(!changes.contains_key("renderDistance"));
        assert_eq!(changes["fov"], "0.75");
    }

    #[test]
    fn explicit_edits_win_over_stale_followers_including_busy_instances() {
        for (category, key, old, local, edited) in [
            (Category::GameOptions, "renderDistance", "12", "16", "20"),
            (
                Category::Keybinds,
                "key_key.forward",
                "key.keyboard.w",
                "key.keyboard.e",
                "key.keyboard.q",
            ),
        ] {
            let initial = Values::from([(key.into(), old.into())]);
            let mut shared = seed(category, &initial, "1.21.1");
            shared.applied.insert(1, initial.clone());
            shared.applied.insert(2, initial);
            edit_shared(
                category,
                &mut shared,
                Values::from([(key.into(), edited.into())]),
            )
            .unwrap();
            let mut conn = connection();
            store(&mut conn, category, &shared).unwrap();
            let mut shared = load(&mut conn, category).unwrap();
            let prefs = Preferences {
                enabled: true,
                instance_ids: vec![1, 2],
                ..Default::default()
            };
            let stale = Values::from([(key.into(), local.into())]);
            // First propagation and the later exit of a previously busy follower.
            for id in [1, 2] {
                capture(category, &mut shared, &prefs, id, "1.21.1", &stale);
                assert_eq!(shared.values[key].value, edited);
                assert_eq!(
                    patch(category, &shared, &prefs, "1.21.1", &stale)[key],
                    edited
                );
            }
        }
    }

    #[test]
    fn first_enable_requires_owner_but_reenable_keeps_existing_bundle() {
        let mut prefs = Preferences {
            enabled: true,
            ..Default::default()
        };
        assert!(seed_owner(&prefs, &SharedBundle::default()).is_err());
        prefs.source_instance_id = Some(7);
        assert_eq!(
            seed_owner(&prefs, &SharedBundle::default()).unwrap(),
            Some(7)
        );
        prefs.source_instance_id = None;
        let shared = seed(
            Category::Keybinds,
            &Values::from([("key_key.forward".into(), "key.keyboard.w".into())]),
            "1.21.1",
        );
        assert_eq!(seed_owner(&prefs, &shared).unwrap(), None);
    }
    #[test]
    fn files_capture_only_selected_values_and_readd_applies_shared() {
        let dir = tempfile::tempdir().unwrap();
        let dir = dir.path().canonicalize().unwrap();
        std::fs::write(dir.join("options.txt"),"version:4903\r\nrenderDistance:12\r\nfov:0\r\nkey_key.forward:key.keyboard.w\r\nextra:keep").unwrap();
        let owner = game_options_file::load(&dir).unwrap();
        let mut shared = seed(Category::GameOptions, &owner.values, "1.21.1");
        assert!(shared.values.contains_key("renderDistance"));
        assert!(!shared.values.contains_key("key_key.forward"));
        let mut conn = connection();
        let mut prefs = Preferences {
            enabled: true,
            instance_ids: vec![1],
            selected_keys: Some(vec!["renderDistance".into()]),
            ..Default::default()
        };
        apply(
            &mut conn,
            Category::GameOptions,
            1,
            &dir,
            "1.21.1",
            &prefs,
            &mut shared,
            owner,
        )
        .unwrap();
        std::fs::write(dir.join("options.txt"),"version:4903\r\nrenderDistance:16\r\nfov:0.5\r\nkey_key.forward:key.keyboard.q\r\nextra:local").unwrap();
        let current = game_options_file::load(&dir).unwrap();
        capture(
            Category::GameOptions,
            &mut shared,
            &prefs,
            1,
            "1.21.1",
            &current.values,
        );
        assert_eq!(shared.values["renderDistance"].value, "16");
        assert_eq!(shared.values["fov"].value, "0");
        prefs.instance_ids.clear();
        persist(&mut conn, Category::GameOptions, 0, prefs.clone(), shared).unwrap();
        prefs.instance_ids.push(1);
        let shared = load(&mut conn, Category::GameOptions).unwrap();
        persist(&mut conn, Category::GameOptions, 1, prefs.clone(), shared).unwrap();
        let mut shared = load(&mut conn, Category::GameOptions).unwrap();
        std::fs::write(
            dir.join("options.txt"),
            "renderDistance:32\r\nfov:0.5\r\nkey_key.forward:key.keyboard.q",
        )
        .unwrap();
        let current = game_options_file::load(&dir).unwrap();
        capture(
            Category::GameOptions,
            &mut shared,
            &prefs,
            1,
            "1.21.1",
            &current.values,
        );
        apply(
            &mut conn,
            Category::GameOptions,
            1,
            &dir,
            "1.21.1",
            &prefs,
            &mut shared,
            current,
        )
        .unwrap();
        let result = game_options_file::load(&dir).unwrap();
        assert_eq!(result.values["renderDistance"], "16");
        assert_eq!(result.values["fov"], "0.5");
        assert_eq!(result.values["key_key.forward"], "key.keyboard.q");
    }
    #[test]
    fn pack_commit_reapplies_only_the_enabled_category() {
        for category in [Category::GameOptions, Category::Keybinds] {
            let dir = tempfile::tempdir().unwrap();
            let dir = dir.path().canonicalize().unwrap();
            let owner = Values::from([
                ("fov".into(), "0".into()),
                ("key_key.forward".into(), "key.keyboard.w".into()),
            ]);
            let mut shared = seed(category, &owner, "1.21.1");
            let local = b"fov:0.5\nkey_key.forward:key.keyboard.q\nextra:local\nversion:1";
            let incoming = b"fov:1\nkey_key.forward:key.keyboard.e\nextra:pack\nversion:2";
            let merged = super::super::pack_update::merge(local, incoming).unwrap();
            std::fs::write(dir.join("options.txt"), merged).unwrap();
            let prefs = Preferences {
                enabled: true,
                instance_ids: vec![1],
                ..Default::default()
            };
            let current = game_options_file::load(&dir).unwrap();
            apply(
                &mut connection(),
                category,
                1,
                &dir,
                "1.21.1",
                &prefs,
                &mut shared,
                current,
            )
            .unwrap();
            let result = game_options_file::load(&dir).unwrap();
            assert_eq!(result.values["extra"], "local");
            assert_eq!(result.values["version"], "2");
            assert_eq!(
                result.values["fov"],
                if category == Category::GameOptions {
                    "0"
                } else {
                    "0.5"
                }
            );
            assert_eq!(
                result.values["key_key.forward"],
                if category == Category::Keybinds {
                    "key.keyboard.w"
                } else {
                    "key.keyboard.q"
                }
            );
        }
    }
    #[test]
    fn version_and_keybind_categories_are_isolated() {
        let values = Values::from([
            ("renderDistance".into(), "12".into()),
            ("fov".into(), "0".into()),
            ("key_key.forward".into(), "key.keyboard.w".into()),
        ]);
        let options = seed(Category::GameOptions, &values, "1.21.1");
        let old = patch(
            Category::GameOptions,
            &options,
            &Preferences::default(),
            "1.6.4",
            &values,
        );
        assert!(!old.contains_key("renderDistance"));
        assert!(old.contains_key("fov"));
        assert!(!old.contains_key("key_key.forward"));
        let bindings = seed(Category::Keybinds, &values, "1.21.1");
        let keys = patch(
            Category::Keybinds,
            &bindings,
            &Preferences::default(),
            "1.21.1",
            &values,
        );
        assert_eq!(keys.len(), 1);
        assert!(keys.contains_key("key_key.forward"));
        let dir = tempfile::tempdir().unwrap();
        let dir = dir.path().canonicalize().unwrap();
        std::fs::write(
            dir.join("options.txt"),
            "fov:0.5\nkey_key.forward:key.keyboard.q",
        )
        .unwrap();
        let current = game_options_file::load(&dir).unwrap();
        game_options_file::save(
            &dir,
            Patch {
                revision: current.revision,
                changes: keys,
            },
        )
        .unwrap();
        assert_eq!(game_options_file::load(&dir).unwrap().values["fov"], "0.5");
    }
}
