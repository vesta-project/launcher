use std::path::Path;
use tauri::{AppHandle, State};

use crate::launcher_import::types::{
    DetectedLauncher, ExternalInstanceCandidate, ImportExternalInstanceRequest,
    ImportExternalInstanceResponse,
};
use crate::launcher_import::ImportManager;
use crate::models::instance::Instance;
use crate::resources::ResourceWatcher;
use crate::tasks::installers::external_import::ImportExternalInstanceTask;
use crate::tasks::manager::TaskManager;

fn launcher_kind_key(kind: &crate::launcher_import::types::LauncherKind) -> &'static str {
    match kind {
        crate::launcher_import::types::LauncherKind::CurseforgeFlame => "curseforgeFlame",
        crate::launcher_import::types::LauncherKind::GDLauncher => "gdlauncher",
        crate::launcher_import::types::LauncherKind::Prism => "prism",
        crate::launcher_import::types::LauncherKind::MultiMC => "multimc",
        crate::launcher_import::types::LauncherKind::ATLauncher => "atlauncher",
        crate::launcher_import::types::LauncherKind::Ftb => "ftb",
        crate::launcher_import::types::LauncherKind::ModrinthApp => "modrinthApp",
        crate::launcher_import::types::LauncherKind::Technic => "technic",
    }
}

#[tauri::command]
pub async fn detect_external_launchers(
    import_manager: State<'_, ImportManager>,
) -> Result<Vec<DetectedLauncher>, String> {
    log::info!("[launcher_import] command detect_external_launchers");
    let manager = import_manager.inner().clone();
    manager.detect_launchers().await
}

#[tauri::command]
pub async fn list_external_instances(
    import_manager: State<'_, ImportManager>,
    launcher: crate::launcher_import::types::LauncherKind,
    base_path_override: Option<String>,
) -> Result<Vec<ExternalInstanceCandidate>, String> {
    log::info!(
        "[launcher_import] command list_external_instances launcher={:?} override={}",
        launcher,
        base_path_override.as_deref().unwrap_or("")
    );
    let manager = import_manager.inner().clone();
    let launcher_kind = launcher;
    let base_override = base_path_override;

    crate::launcher_import::scan::blocking(std::time::Duration::from_secs(15), move || {
        manager
            .list_instances(&launcher_kind, base_override.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn import_external_instance(
    app_handle: AppHandle,
    import_manager: State<'_, ImportManager>,
    task_manager: State<'_, TaskManager>,
    resource_watcher: State<'_, ResourceWatcher>,
    request: ImportExternalInstanceRequest,
) -> Result<ImportExternalInstanceResponse, String> {
    let started = std::time::Instant::now();
    log::info!(
        "[launcher_import] import-enqueue-start launcher={:?} instance_path={} override={}",
        request.launcher,
        request.instance_path,
        request.instance_name_override.as_deref().unwrap_or("")
    );
    let selected = if let Some(candidate) = request.selected_instance.clone() {
        if candidate.instance_path != request.instance_path {
            return Err("Selected instance payload does not match instance path".to_string());
        }
        let instance_root = Path::new(&candidate.instance_path);
        let source_game_dir = Path::new(&candidate.game_directory);
        if !instance_root.exists() || !instance_root.is_dir() {
            return Err("Selected instance path no longer exists".to_string());
        }
        if !source_game_dir.exists() || !source_game_dir.is_dir() {
            return Err("Selected game directory no longer exists".to_string());
        }
        if !source_game_dir.starts_with(instance_root) {
            return Err("Selected game directory is outside selected instance path".to_string());
        }
        candidate
    } else {
        // Backward compatibility fallback for older frontend payloads.
        let manager = import_manager.inner().clone();
        let launcher = request.launcher.clone();
        let root = request.base_path_override.clone();
        let candidates =
            crate::launcher_import::scan::blocking(std::time::Duration::from_secs(15), move || {
                manager
                    .list_instances(&launcher, root.as_deref())
                    .map_err(|error| error.to_string())
            })
            .await?;
        candidates
            .into_iter()
            .find(|candidate| candidate.instance_path == request.instance_path)
            .ok_or_else(|| "Instance not found for selected launcher/path".to_string())?
    };

    let minecraft_version = selected
        .minecraft_version
        .ok_or_else(|| {
            format!(
                "Unable to determine the Minecraft version for '{}'. Please rescan the launcher or select an instance with a detected version.",
                selected.name
            )
        })?;

    // Defer watcher startup to the import task to avoid blocking enqueue.
    let instance = Instance {
        name: request
            .instance_name_override
            .unwrap_or_else(|| selected.name.clone()),
        minecraft_version,
        modloader: selected.modloader,
        modloader_version: selected.modloader_version,
        icon_path: selected.icon_path,
        modpack_platform: selected.modpack_platform,
        modpack_id: selected.modpack_id,
        modpack_version_id: selected.modpack_version_id,
        last_operation: Some("external-import".to_string()),
        import_source_game_directory: Some(selected.game_directory.clone()),
        import_launcher_kind: Some(launcher_kind_key(&request.launcher).to_string()),
        import_instance_path: Some(selected.instance_path.clone()),
        installation_status: Some("skip-initial-watch".to_string()),
        ..Default::default()
    };

    let instance_id =
        crate::commands::instances::create_instance(app_handle.clone(), instance, resource_watcher)
            .await?;

    let task = ImportExternalInstanceTask::new(instance_id, selected.name, selected.game_directory);
    task_manager.submit(Box::new(task)).await?;
    log::info!(
        "[launcher_import] import-enqueue-end instance_id={} launcher={:?} elapsed_ms={}",
        instance_id,
        request.launcher,
        started.elapsed().as_millis()
    );

    Ok(ImportExternalInstanceResponse { instance_id })
}

/// Import identity projection: no icon processing, game-directory reads or UI-thread IO.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOrigin {
    import_launcher_kind: Option<String>,
    import_instance_path: Option<String>,
}

#[tauri::command]
pub async fn list_external_import_origins() -> Result<Vec<ImportOrigin>, String> {
    crate::launcher_import::scan::blocking(std::time::Duration::from_secs(15), || {
        use crate::schema::instance::dsl::*;
        use diesel::prelude::*;
        let mut connection =
            crate::utils::db::get_vesta_conn().map_err(|error| error.to_string())?;
        instance
            .select((import_launcher_kind, import_instance_path))
            .load::<(Option<String>, Option<String>)>(&mut connection)
            .map(|rows| {
                rows.into_iter()
                    .map(|(kind, path)| ImportOrigin {
                        import_launcher_kind: kind,
                        import_instance_path: path,
                    })
                    .collect()
            })
            .map_err(|error| error.to_string())
    })
    .await
}

/// Detailed preview statistics are opt-in for one selected candidate, never listing.
#[tauri::command]
pub async fn get_external_instance_details(
    import_manager: State<'_, ImportManager>,
    launcher: crate::launcher_import::types::LauncherKind,
    instance_path: String,
    base_path_override: Option<String>,
) -> Result<ExternalInstanceCandidate, String> {
    let manager = import_manager.inner().clone();
    crate::launcher_import::scan::blocking(std::time::Duration::from_secs(15), move || {
        manager
            .instance_details(&launcher, &instance_path, base_path_override.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
}
