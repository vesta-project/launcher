//! User-owned settings synchronisation.
//!
//! This module owns the settings bundles persisted by the launcher. The
//! modpack synchroniser only classifies `options.txt` as an Options file and
//! hands it here; it must not merge or replace this state itself.
pub(crate) mod game_options;
pub(crate) mod keybinds;

use crate::utils::db::{get_config_conn, get_vesta_conn};
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Text};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A category is independently enabled and has its own following list.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Category {
    GameOptions,
    Keybinds,
    Servers,
    ResourcePacks,
}

impl Category {
    pub(crate) const ALL: [Self; 4] = [
        Self::GameOptions,
        Self::Keybinds,
        Self::Servers,
        Self::ResourcePacks,
    ];

    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::GameOptions => "gameOptions",
            Self::Keybinds => "keybinds",
            Self::Servers => "servers",
            Self::ResourcePacks => "resourcePacks",
        }
    }
}

/// `selectedKeys` is intentionally generic: game-options uses stable setting
/// ids (with `extra:` ids for unknown safe keys), while keybinds can use the
/// physical `key_*` names. `None` means every value in the bundle, which also
/// keeps old preference rows readable.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Preferences {
    pub enabled: bool,
    pub source_instance_id: Option<i32>,
    pub instance_ids: Vec<i32>,
    #[serde(default, alias = "gameOptionKeys", alias = "selectedGameOptions")]
    pub selected_keys: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub category: Category,
    pub revision: i64,
    pub preferences: Preferences,
    pub pending: Vec<String>,
    pub initialized: bool,
    pub shared_values: BTreeMap<String, String>,
    /// Metadata is populated by the game-options catalog. Keeping it on the
    /// command response avoids a second, divergent catalog in the frontend.
    pub catalog: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct SharedBundle {
    /// The key is a stable setting id when the catalog provides one and the
    /// physical options key for an unknown extra. Values remain raw strings so
    /// a version adapter can decide how to encode them on write.
    pub values: BTreeMap<String, SharedValue>,
    /// Last values written to each instance. A missing entry means the
    /// instance has never followed this bundle and therefore must not be
    /// imported when it is re-added.
    pub applied: BTreeMap<i32, BTreeMap<String, String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SharedValue {
    pub key: String,
    pub value: String,
}

impl SharedBundle {
    pub(crate) fn exposed_values(&self) -> BTreeMap<String, String> {
        self.values
            .iter()
            .map(|(id, value)| (id.clone(), value.value.clone()))
            .collect()
    }
}

#[derive(Debug, QueryableByName)]
struct PreferenceRow {
    #[diesel(sql_type = BigInt)]
    revision: i64,
    #[diesel(sql_type = Text)]
    state: String,
}

pub(crate) fn empty_snapshot(category: Category) -> Snapshot {
    Snapshot {
        category,
        revision: 0,
        preferences: Preferences::default(),
        pending: Vec::new(),
        initialized: false,
        shared_values: BTreeMap::new(),
        catalog: Vec::new(),
    }
}

pub(crate) fn read(
    conn: &mut SqliteConnection,
    category: Category,
) -> Result<Snapshot, String> {
    let row = diesel::sql_query("SELECT revision, state FROM settings_sync WHERE category = ?")
        .bind::<Text, _>(category.key())
        .get_result::<PreferenceRow>(conn)
        .optional()
        .map_err(|error| error.to_string())?;

    match row {
        Some(row) => Ok(Snapshot {
            category,
            revision: row.revision,
            preferences: serde_json::from_str(&row.state).map_err(|error| error.to_string())?,
            pending: Vec::new(),
            initialized: false,
            shared_values: BTreeMap::new(),
            catalog: Vec::new(),
        }),
        None => Ok(empty_snapshot(category)),
    }
}

pub(crate) fn save_preferences(
    conn: &mut SqliteConnection,
    category: Category,
    revision: i64,
    preferences: Preferences,
) -> Result<Snapshot, String> {
    let state = serde_json::to_string(&preferences).map_err(|error| error.to_string())?;
    let changed = diesel::sql_query(
        "INSERT INTO settings_sync (category, revision, state)
         SELECT ?, 1, ? WHERE ? = 0
         ON CONFLICT(category) DO UPDATE SET
             state = excluded.state, revision = settings_sync.revision + 1
         WHERE settings_sync.revision = ?",
    )
    .bind::<Text, _>(category.key())
    .bind::<Text, _>(&state)
    .bind::<BigInt, _>(revision)
    .bind::<BigInt, _>(revision)
    .execute(conn)
    .map_err(|error| error.to_string())?;
    let changed = if changed == 0 && revision > 0 {
        diesel::sql_query(
            "UPDATE settings_sync
             SET state = ?, revision = revision + 1
             WHERE category = ? AND revision = ?",
        )
        .bind::<Text, _>(&state)
        .bind::<Text, _>(category.key())
        .bind::<BigInt, _>(revision)
        .execute(conn)
        .map_err(|error| error.to_string())?
    } else {
        changed
    };
    if changed != 1 {
        return Err("Sync preferences changed elsewhere. Reload before saving.".into());
    }
    Ok(Snapshot {
        category,
        revision: revision + 1,
        preferences,
        pending: Vec::new(),
        initialized: false,
        shared_values: BTreeMap::new(),
        catalog: Vec::new(),
    })
}

pub(crate) fn validate_preferences(
    category: Category,
    previous: &Preferences,
    next: &Preferences,
    available: &[i32],
) -> Result<(), String> {
    if next.instance_ids.len() > 10_000 {
        return Err("Too many participating instances.".into());
    }
    if next.instance_ids.iter().any(|id| !available.contains(id)) {
        return Err("An instance no longer exists. Refresh and choose again.".into());
    }
    let mut ids = next.instance_ids.clone();
    ids.sort_unstable();
    ids.dedup();
    if ids.len() != next.instance_ids.len() {
        return Err("Duplicate instance membership.".into());
    }

    // Membership and per-setting selection are frozen while the category is
    // off. The one exception is the off -> on setup transition, where the
    // owner and initial followers arrive in the same request.
    if !previous.enabled && !next.enabled
        && (previous.instance_ids != next.instance_ids
            || previous.selected_keys != next.selected_keys)
    {
        return Err("Enable this sync category before changing membership.".into());
    }
    if next.enabled && !previous.enabled {
        let source = next
            .source_instance_id
            .ok_or("Choose a source instance before enabling sync.")?;
        if !next.instance_ids.contains(&source) {
            return Err("The source instance must follow this category.".into());
        }
    }
    if next
        .source_instance_id
        .is_some_and(|source| next.enabled && !next.instance_ids.contains(&source))
    {
        return Err("The source instance must follow this category.".into());
    }
    if !matches!(category, Category::GameOptions)
        && next.selected_keys.as_ref().is_some_and(|keys| !keys.is_empty())
    {
        return Err("This sync category does not support per-setting selection.".into());
    }
    if next
        .selected_keys
        .as_ref()
        .is_some_and(|keys| keys.len() > 100_000)
    {
        return Err("Too many selected settings.".into());
    }
    if let Some(keys) = &next.selected_keys {
        if keys.iter().any(|key| key.trim().is_empty() || key.len() > 512) {
            return Err("Selected setting names must be non-empty and bounded.".into());
        }
        let mut unique = keys.clone();
        unique.sort_unstable();
        unique.dedup();
        if unique.len() != keys.len() {
            return Err("Duplicate selected settings.".into());
        }
    }
    Ok(())
}

fn available_instance_ids() -> Result<Vec<i32>, String> {
    use crate::schema::instance::dsl as instances;
    let mut conn = get_vesta_conn().map_err(|error| error.to_string())?;
    instances::instance
        .select(instances::id)
        .load::<i32>(&mut conn)
        .map_err(|error| error.to_string())
}

fn populate_snapshot(snapshot: &mut Snapshot) -> Result<(), String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    match snapshot.category {
        Category::GameOptions => game_options::populate(&mut conn, snapshot),
        Category::Keybinds => keybinds::populate(&mut conn, snapshot),
        Category::Servers | Category::ResourcePacks => Ok(()),
    }
}

#[tauri::command]
pub fn get_settings_sync() -> Result<Vec<Snapshot>, String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    Category::ALL
        .into_iter()
        .map(|category| {
            let mut snapshot = read(&mut conn, category)?;
            populate_snapshot(&mut snapshot)?;
            Ok(snapshot)
        })
        .collect()
}

/// Save settings and (for file-backed categories) update the shared bundle in
/// one guarded operation. The optional names keep the command compatible with
/// the staged UI while it moves from the old game-only name to `changes`.
#[tauri::command]
pub async fn save_settings_sync(
    app: tauri::AppHandle,
    category: Category,
    revision: i64,
    preferences: Preferences,
    changes: Option<BTreeMap<String, String>>,
    shared_changes: Option<BTreeMap<String, String>>,
    game_option_changes: Option<BTreeMap<String, String>>,
) -> Result<Snapshot, String> {
    let available = available_instance_ids()?;
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let previous = read(&mut conn, category)?.preferences;
    validate_preferences(category, &previous, &preferences, &available)?;
    drop(conn);
    let values = changes
        .or(shared_changes)
        .or(game_option_changes)
        .unwrap_or_default();

    let mut snapshot = match category {
        Category::GameOptions => {
            game_options::configure(&app, revision, previous, preferences, values).await?
        }
        Category::Keybinds => {
            keybinds::configure(&app, revision, previous, preferences, values).await?
        }
        Category::Servers | Category::ResourcePacks => {
            let mut conn = get_config_conn().map_err(|error| error.to_string())?;
            save_preferences(&mut conn, category, revision, preferences)?
        }
    };
    populate_snapshot(&mut snapshot)?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;

    #[test]
    fn categories_default_off_and_membership_is_frozen_while_off() {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(include_str!(
            "../migrations/config/2026-09-13-000000_settings_sync/up.sql"
        ))
        .unwrap();
        for category in Category::ALL {
            assert!(!read(&mut conn, category).unwrap().preferences.enabled);
        }
        let previous = Preferences::default();
        let mut next = Preferences {
            instance_ids: vec![1],
            ..Preferences::default()
        };
        assert!(validate_preferences(Category::GameOptions, &previous, &next, &[1]).is_err());
        next.enabled = true;
        next.source_instance_id = Some(1);
        validate_preferences(Category::GameOptions, &previous, &next, &[1]).unwrap();
    }

    #[test]
    fn stale_preference_revision_is_rejected() {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(include_str!(
            "../migrations/config/2026-09-13-000000_settings_sync/up.sql"
        ))
        .unwrap();
        let prefs = Preferences::default();
        save_preferences(&mut conn, Category::Servers, 0, prefs.clone()).unwrap();
        assert!(save_preferences(&mut conn, Category::Servers, 0, prefs).is_err());
    }
}
