use tauri::{AppHandle, State};
use std::path::Path;

use crate::launcher_import::ImportManager;
use crate::launcher_import::types::{
    DetectedLauncher, ExternalInstanceCandidate, ImportExternalInstanceRequest,
    ImportExternalInstanceResponse,
};
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
pub fn detect_external_launchers(
    import_manager: State<'_, ImportManager>,
) -> Result<Vec<DetectedLauncher>, String> {
    log::info!("[launcher_import] command detect_external_launchers");
    Ok(import_manager.detect_launchers())
}

#[tauri::command]
pub fn list_external_instances(
    import_manager: State<'_, ImportManager>,
    launcher: crate::launcher_import::types::LauncherKind,
    base_path_override: Option<String>,
) -> Result<Vec<ExternalInstanceCandidate>, String> {
    log::info!(
        "[launcher_import] command list_external_instances launcher={:?} override={}",
        launcher,
        base_path_override.as_deref().unwrap_or("")
    );
    import_manager
        .list_instances(&launcher, base_path_override.as_deref())
        .map_err(|e| e.to_string())
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
        let candidates = import_manager
            .list_instances(&request.launcher, request.base_path_override.as_deref())
            .map_err(|e| e.to_string())?;
        candidates
            .into_iter()
            .find(|candidate| candidate.instance_path == request.instance_path)
            .ok_or_else(|| "Instance not found for selected launcher/path".to_string())?
    };

    let mut instance = Instance::default();
    instance.name = request
        .instance_name_override
        .unwrap_or_else(|| selected.name.clone());
    instance.minecraft_version = selected
        .minecraft_version
        .unwrap_or_else(|| "1.21.1".to_string());
    instance.modloader = selected.modloader;
    instance.modloader_version = selected.modloader_version;
    instance.icon_path = selected.icon_path;
    instance.modpack_platform = selected.modpack_platform;
    instance.modpack_id = selected.modpack_id;
    instance.modpack_version_id = selected.modpack_version_id;
    instance.last_operation = Some("external-import".to_string());
    instance.import_source_game_directory = Some(selected.game_directory.clone());
    instance.import_launcher_kind = Some(launcher_kind_key(&request.launcher).to_string());
    instance.import_instance_path = Some(selected.instance_path.clone());
    // Defer watcher startup to the import task to avoid blocking enqueue.
    instance.installation_status = Some("skip-initial-watch".to_string());

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
