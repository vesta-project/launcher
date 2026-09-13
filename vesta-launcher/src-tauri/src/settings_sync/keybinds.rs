//! Separate keybinding bundle.
//!
//! Keybindings share the same `options.txt` document as game options but are
//! deliberately owned by a different category. This module filters every
//! read/write through `key_*`, so enabling one category cannot modify the
//! other category's values.

use super::{Category, Preferences, SharedBundle, SharedValue, Snapshot};
use crate::game_options::catalog;
use crate::game_options_file::{self, Patch};
use crate::tasks::manager::{instance_play_conflict_key, TaskManager};
use crate::utils::db::get_config_conn;
use diesel::prelude::*;
use diesel::sql_types::Text;
use std::collections::BTreeMap;
use tauri::Manager;

static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const TABLE: &str = "shared_keybinds";

#[derive(QueryableByName)]
struct StateRow {
    #[diesel(sql_type = Text)]
    state: String,
}

fn load(conn: &mut SqliteConnection) -> Result<SharedBundle, String> {
    diesel::sql_query(format!("SELECT state FROM {TABLE} WHERE id = 1"))
        .get_result::<StateRow>(conn)
        .optional()
        .map_err(|error| error.to_string())?
        .map(|row| serde_json::from_str(&row.state).map_err(|error| error.to_string()))
        .unwrap_or_else(|| Ok(SharedBundle::default()))
}

fn store(conn: &mut SqliteConnection, shared: &SharedBundle) -> Result<(), String> {
    let state = serde_json::to_string(shared).map_err(|error| error.to_string())?;
    diesel::sql_query(format!(
        "INSERT INTO {TABLE} (id, state) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state"
    ))
    .bind::<Text, _>(state)
    .execute(conn)
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn is_syncable_keybind(key: &str) -> bool {
    key.starts_with("key_")
        && !key.is_empty()
        && !key.contains(':')
        && !key.chars().any(char::is_control)
}

fn valid_value(value: &str) -> bool {
    value.len() <= 64 * 1024
        && !value
            .chars()
            .any(|character| character == '\r' || character == '\n' || character == '\0')
}

fn seed_values(values: &BTreeMap<String, String>) -> SharedBundle {
    let mut shared = SharedBundle::default();
    for (key, value) in values {
        if !is_syncable_keybind(key) || !valid_value(value) {
            continue;
        }
        // Minecraft has used both numeric key codes and names such as
        // key.keyboard.space. Keep either representation losslessly; the
        // existing keybinding editor can display/record the named form.
        shared.values.insert(
            key.clone(),
            SharedValue {
                key: key.clone(),
                value: value.clone(),
            },
        );
    }
    shared
}

fn selected(shared: &SharedBundle, preferences: &Preferences, id: &str) -> bool {
    preferences
        .selected_keys
        .as_ref()
        .is_none_or(|keys| keys.iter().any(|key| key == id))
        && shared
            .values
            .get(id)
            .is_some_and(|entry| is_syncable_keybind(&entry.key))
}

fn selected_values(
    shared: &SharedBundle,
    preferences: &Preferences,
) -> BTreeMap<String, String> {
    shared
        .values
        .iter()
        .filter(|(id, _)| selected(shared, preferences, id))
        .map(|(_, value)| (value.key.clone(), value.value.clone()))
        .collect()
}

fn import_changes(shared: &mut SharedBundle, id: i32, current: &BTreeMap<String, String>) {
    let Some(baseline) = shared.applied.get(&id) else {
        return;
    };
    for (setting_id, entry) in &mut shared.values {
        let Some(current_value) = current.get(&entry.key) else {
            continue;
        };
        if baseline
            .get(setting_id)
            .is_some_and(|previous| previous != current_value)
            && is_syncable_keybind(&entry.key)
            && valid_value(current_value)
        {
            entry.value = current_value.clone();
        }
    }
}

fn selected_baseline(
    shared: &SharedBundle,
    preferences: &Preferences,
    values: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    shared
        .values
        .iter()
        .filter(|(id, entry)| selected(shared, preferences, id) && values.contains_key(&entry.key))
        .map(|(id, entry)| (id.clone(), values[&entry.key].clone()))
        .collect()
}

pub(crate) fn populate(
    conn: &mut SqliteConnection,
    snapshot: &mut Snapshot,
) -> Result<(), String> {
    let shared = load(conn)?;
    snapshot.initialized = !shared.values.is_empty();
    snapshot.shared_values = shared.exposed_values();
    Ok(())
}

async fn idle(instance: &crate::models::instance::Instance) -> Result<(), String> {
    if instance.installation_status.as_deref() != Some("installed") {
        return Err("Instance is not installed and idle".into());
    }
    if piston_lib::game::launcher::is_instance_running(&instance.slug())
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("Game is running; sync will resume after exit".into());
    }
    Ok(())
}

pub(crate) async fn apply_under_play_guard(id: i32) -> Result<(), String> {
    reconcile_one(id, true).await
}

pub(crate) async fn restore_after_pack_update(id: i32) -> Result<(), String> {
    reconcile_one(id, false).await
}

async fn reconcile_one(id: i32, import: bool) -> Result<(), String> {
    let _serial = SERIAL.lock().await;
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let preferences = super::read(&mut conn, Category::Keybinds)?.preferences;
    if !preferences.enabled || !preferences.instance_ids.contains(&id) {
        return Ok(());
    }
    let mut shared = load(&mut conn)?;
    if shared.values.is_empty() {
        return Err("Choose a keybinding source to initialize the shared bundle.".into());
    }
    let instance = crate::commands::instances::get_instance(id)?;
    idle(&instance).await?;
    let directory = crate::commands::game_options::directory(&instance)?;
    let current = game_options_file::load(&directory)?;
    if !current.exists {
        return Err("options.txt is missing; sync will resume after the game creates it.".into());
    }
    if import {
        import_changes(&mut shared, id, &current.values);
        store(&mut conn, &shared)?;
    }
    let selected = selected_values(&shared, &preferences);
    if selected.is_empty() {
        return Ok(());
    }
    let saved = game_options_file::save(
        &directory,
        Patch {
            revision: current.revision,
            changes: selected.clone(),
        },
    )?;
    shared.applied.insert(id, selected_baseline(&shared, &preferences, &saved.values));
    store(&mut conn, &shared)
}

async fn propagate(app: &tauri::AppHandle) -> Vec<String> {
    let ids = match get_config_conn()
        .map_err(|error| error.to_string())
        .and_then(|mut conn| super::read(&mut conn, Category::Keybinds))
    {
        Ok(snapshot) if snapshot.preferences.enabled => snapshot.preferences.instance_ids,
        Ok(_) => return Vec::new(),
        Err(error) => return vec![error],
    };
    let manager = app.state::<TaskManager>();
    let mut pending = Vec::new();
    for id in ids {
        let _play = manager
            .acquire_conflicts([instance_play_conflict_key(id)])
            .await;
        if let Err(error) = reconcile_one(id, true).await {
            let name = crate::commands::instances::get_instance(id)
                .map(|instance| instance.name)
                .unwrap_or_else(|_| id.to_string());
            pending.push(format!("{name}: {error}"));
        }
    }
    pending
}

pub(crate) async fn after_exit(app: tauri::AppHandle, slug: String) {
    let result = async {
        let instance = crate::commands::instances::get_instance_by_slug(slug)?;
        {
            let manager = app.state::<TaskManager>();
            let _play = manager
                .acquire_conflicts([instance_play_conflict_key(instance.id)])
                .await;
            reconcile_one(instance.id, true).await?;
        }
        for pending in propagate(&app).await {
            log::warn!("Keybindings sync pending: {pending}");
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        log::warn!("Keybindings sync after exit: {error}");
    }
}

fn apply_changes(shared: &mut SharedBundle, changes: BTreeMap<String, String>) -> Result<(), String> {
    for (id, value) in changes {
        let entry = shared
            .values
            .get_mut(&id)
            .ok_or_else(|| format!("Keybinding is not in the shared bundle: {id}"))?;
        if !is_syncable_keybind(&entry.key) || !valid_value(&value) {
            return Err(format!("Invalid shared keybinding value for {}", entry.key));
        }
        entry.value = value;
    }
    Ok(())
}

fn save_configuration(
    conn: &mut SqliteConnection,
    revision: i64,
    mut preferences: Preferences,
    mut shared: SharedBundle,
) -> Result<Snapshot, String> {
    if !preferences.enabled {
        shared.applied.clear();
    }
    preferences.source_instance_id = None;
    shared
        .applied
        .retain(|id, _| preferences.instance_ids.contains(id));
    for baseline in shared.applied.values_mut() {
        baseline.retain(|id, _| {
            preferences
                .selected_keys
                .as_ref()
                .is_none_or(|keys| keys.iter().any(|key| key == id))
        });
    }
    conn.transaction::<Snapshot, diesel::result::Error, _>(|conn| {
        let snapshot = super::save_preferences(conn, Category::Keybinds, revision, preferences)
            .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
        store(conn, &shared)
            .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
        Ok(snapshot)
    })
    .map_err(|error| error.to_string())
}

pub(crate) async fn configure(
    app: &tauri::AppHandle,
    revision: i64,
    previous: Preferences,
    preferences: Preferences,
    changes: BTreeMap<String, String>,
) -> Result<Snapshot, String> {
    let manager = app.state::<TaskManager>();
    let source_guard = if preferences.enabled {
        preferences
            .source_instance_id
            .map(|id| async { manager.acquire_conflicts([instance_play_conflict_key(id)]).await })
    } else {
        None
    };
    let source_guard = match source_guard {
        Some(future) => Some(future.await),
        None => None,
    };
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let mut shared = load(&mut conn)?;
    if !preferences.enabled && (!changes.is_empty() || previous.selected_keys != preferences.selected_keys) {
        return Err("Enable keybindings sync before editing shared keybindings.".into());
    }
    if preferences.enabled && shared.values.is_empty() {
        let source = preferences
            .source_instance_id
            .ok_or("Choose a source instance before enabling keybindings sync.")?;
        let instance = crate::commands::instances::get_instance(source)?;
        idle(&instance).await?;
        let source_snapshot = game_options_file::load(
            &crate::commands::game_options::directory(&instance)?,
        )?;
        if !source_snapshot.exists {
            return Err("The source instance has no options.txt to seed yet.".into());
        }
        shared = seed_values(&source_snapshot.values);
        if shared.values.is_empty() {
            return Err("The source has no keybindings to sync.".into());
        }
        let baseline = shared
            .values
            .iter()
            .map(|(id, value)| (id.clone(), value.value.clone()))
            .collect();
        shared.applied.insert(source, baseline);
    }
    apply_changes(&mut shared, changes)?;
    let snapshot = save_configuration(&mut conn, revision, preferences, shared)?;
    drop(source_guard);
    let mut snapshot = snapshot;
    snapshot.pending = propagate(app).await;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keybind_filter_accepts_named_and_legacy_numeric_values() {
        let shared = seed_values(&BTreeMap::from([
            ("key_key.forward".into(), "key.keyboard.w".into()),
            ("key_key.jump".into(), "32".into()),
            ("fov".into(), "0".into()),
        ]));
        assert!(shared.values.contains_key("key_key.forward"));
        assert_eq!(shared.values["key_key.jump"].value, "32");
        assert!(!shared.values.contains_key("fov"));
    }
}
