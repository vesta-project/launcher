use crate::game_options::catalog::{self, ValueKind};
use crate::game_options_file::{self, Patch, Snapshot};
use crate::tasks::manager::{instance_play_conflict_key, TaskManager};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    key: &'static str,
    category: &'static str,
    label_id: &'static str,
    kind: &'static str,
    min: Option<f64>,
    max: Option<f64>,
    default: Option<&'static str>,
    version_hint: Option<&'static str>,
}

#[tauri::command]
pub fn get_game_options_catalog() -> Vec<CatalogEntry> {
    catalog::CATALOG
        .iter()
        .map(|entry| {
            let (kind, min, max) = match entry.kind {
                ValueKind::Boolean => ("boolean", None, None),
                ValueKind::Text => ("text", None, None),
                ValueKind::Number { min, max } => ("number", Some(min), Some(max)),
            };
            CatalogEntry {
                key: entry.key,
                category: entry.category,
                label_id: entry.label_id,
                kind,
                min,
                max,
                default: entry.default,
                version_hint: entry.version_hint,
            }
        })
        .collect()
}

fn directory(instance: &crate::models::instance::Instance) -> Result<std::path::PathBuf, String> {
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
) -> Result<Snapshot, String> {
    let _guard = manager
        .acquire_conflicts([instance_play_conflict_key(instance_id)])
        .await;
    let path = directory(&crate::commands::instances::get_instance(instance_id)?)?;
    tauri::async_runtime::spawn_blocking(move || game_options_file::load(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_instance_game_options(
    manager: State<'_, TaskManager>,
    instance_id: i32,
    patch: Patch,
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
    tauri::async_runtime::spawn_blocking(move || game_options_file::save(&path, patch))
        .await
        .map_err(|e| e.to_string())?
}
