use crate::game_options::catalog;
use crate::game_options_file::{self, Patch, Snapshot};
use crate::tasks::manager::{instance_play_conflict_key, TaskManager};
use tauri::State;

#[tauri::command]
pub fn get_game_options_catalog() -> Vec<serde_json::Value> {
    catalog::editor_metadata()
}

fn editor_snapshot(mut snapshot: Snapshot) -> Snapshot {
    // Keybinds have a separate editor. Everything else in options.txt stays
    // visible here — including machine-local keys that sync must never copy.
    snapshot.values.retain(|key, _| !key.starts_with("key_"));
    for (key, value) in &mut snapshot.values {
        if let Ok(decoded) = catalog::decode_for_editor(key, value) {
            *value = decoded;
        }
    }
    snapshot
}

fn save_editor(directory: &std::path::Path, mut patch: Patch) -> Result<Snapshot, String> {
    let current = game_options_file::load(directory)?;
    if current.revision != patch.revision {
        return Err("Options changed on disk. Reload before saving.".into());
    }
    for (key, value) in &mut patch.changes {
        if key.starts_with("key_") || key.is_empty() {
            return Err(format!("Cannot edit option {key} here"));
        }
        if value.is_empty() || value.chars().any(|c| matches!(c, '\n' | '\r' | '\0')) {
            return Err("Option values must be a non-empty single line".into());
        }
        if catalog::definition(key).is_some() {
            *value = match current.values.get(key) {
                Some(previous) => catalog::encode_for_existing(key, value, previous)?.to_owned(),
                None => catalog::encode_from_editor(key, value)?.to_owned(),
            };
        }
    }
    game_options_file::save(directory, patch).map(editor_snapshot)
}

pub(crate) fn directory(
    instance: &crate::models::instance::Instance,
) -> Result<std::path::PathBuf, String> {
    let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
    let data = crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
    let root = crate::utils::instance_helpers::resolve_instances_root(
        &data,
        config.default_game_dir.as_deref(),
    );
    Ok(crate::utils::instance_helpers::resolve_instance_game_directory(instance, &root, &data))
}

#[tauri::command]
pub async fn get_instance_game_options(
    manager: State<'_, TaskManager>,
    instance_id: i32,
    editor_values: Option<bool>,
) -> Result<Snapshot, String> {
    let _guard = manager
        .acquire_conflicts([instance_play_conflict_key(instance_id)])
        .await;
    let path = directory(&crate::commands::instances::get_instance(instance_id)?)?;
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = game_options_file::load(&path)?;
        Ok(if editor_values.unwrap_or(false) {
            editor_snapshot(snapshot)
        } else {
            snapshot
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_instance_game_options(
    manager: State<'_, TaskManager>,
    instance_id: i32,
    patch: Patch,
    editor_values: Option<bool>,
) -> Result<Snapshot, String> {
    let _guard = manager
        .acquire_conflicts([instance_play_conflict_key(instance_id)])
        .await;
    let instance = crate::commands::instances::get_instance(instance_id)?;
    if instance.installation_status.as_deref() != Some("installed") {
        return Err("Game options can only be saved for an installed, idle instance".into());
    }
    if piston_lib::game::launcher::is_instance_running(&instance.slug())
        .await
        .map_err(|e| e.to_string())?
    {
        return Err("Close the game before saving game options".into());
    }
    let path = directory(&instance)?;
    tauri::async_runtime::spawn_blocking(move || {
        if editor_values.unwrap_or(false) {
            save_editor(&path, patch)
        } else {
            game_options_file::save(&path, patch)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[test]
    fn editor_round_trip_preserves_encoding_and_rejects_stale_edits() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        let path = dir.join("options.txt");
        std::fs::write(
            &path,
            "fov:0.75\nrenderClouds:\"true\"\nkey_key.forward:key.keyboard.w\n",
        )
        .unwrap();
        let snapshot = editor_snapshot(game_options_file::load(&dir).unwrap());
        assert_eq!(snapshot.values["fov"], "100");
        assert_eq!(snapshot.values["renderClouds"], "true");
        let old_revision = snapshot.revision.clone();
        let saved = save_editor(
            &dir,
            Patch {
                revision: snapshot.revision,
                changes: BTreeMap::from([
                    ("fov".into(), "90".into()),
                    ("renderClouds".into(), "fast".into()),
                ]),
            },
        )
        .unwrap();
        assert_eq!(saved.values["fov"], "90");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "fov:0.5\nrenderClouds:\"fast\"\nkey_key.forward:key.keyboard.w\n"
        );
        assert!(save_editor(
            &dir,
            Patch {
                revision: old_revision,
                changes: BTreeMap::from([("fov".into(), "80".into())])
            }
        )
        .is_err());
        // Absent catalogued keys can be appended from the instance editor.
        let with_gamma = save_editor(
            &dir,
            Patch {
                revision: saved.revision,
                changes: BTreeMap::from([("gamma".into(), "0.5".into())]),
            },
        )
        .unwrap();
        assert_eq!(with_gamma.values["gamma"], "0.5");
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("gamma:0.5"));
        assert!(save_editor(
            &dir,
            Patch {
                revision: with_gamma.revision,
                changes: BTreeMap::from([("key_key.forward".into(), "key.keyboard.w".into())]),
            }
        )
        .is_err());
    }
}
