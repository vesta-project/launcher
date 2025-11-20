use std::path::PathBuf;
use tauri::{AppHandle, State};
use directories::ProjectDirs;

use piston_lib::models::common::ModloaderType;
use piston_lib::models::minecraft::VersionManifest;

use crate::tasks::manager::{TaskManager, TestTask};
use crate::tasks::install::InstallGameTask;

#[tauri::command]
pub async fn submit_test_task(
    state: State<'_, TaskManager>,
    title: String,
    duration_secs: u64,
) -> Result<(), String> {
    let task = TestTask { title, duration_secs };
    state.submit(Box::new(task)).await
}

#[tauri::command]
pub async fn set_worker_limit(
    state: State<'_, TaskManager>,
    limit: usize,
) -> Result<(), String> {
    state.set_worker_count(limit);
    Ok(())
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, TaskManager>,
    client_key: String,
) -> Result<(), String> {
    state.cancel_task(&client_key)
}

#[derive(serde::Deserialize)]
pub struct InstallGameRequest {
    pub game_dir: Option<PathBuf>,
    pub version_id: String,
    pub modloader: ModloaderType,
    pub loader_version: Option<String>,
    pub version_manifest: VersionManifest,
}

#[tauri::command]
pub async fn install_game(
    app_handle: AppHandle,
    state: State<'_, TaskManager>,
    request: InstallGameRequest,
) -> Result<(), String> {
    // Determine game directory (use provided or default)
    let game_dir = if let Some(dir) = &request.game_dir {
        dir.clone()
    } else {
        // Default to AppData/Roaming/vesta-launcher/gamedata
        let project_dirs = ProjectDirs::from("com", "vesta", "vesta-launcher")
            .ok_or("Failed to get project directories")?;
        project_dirs.data_dir().join("gamedata")
    };
    
    // Runtime directory for Java installations
    let runtime_dir = if let Some(dir) = &request.game_dir {
        dir.parent().unwrap_or(dir).join("runtimes")
    } else {
        let project_dirs = ProjectDirs::from("com", "vesta", "vesta-launcher")
            .ok_or("Failed to get project directories")?;
        project_dirs.data_dir().join("runtimes")
    };
    
    let task = InstallGameTask {
        game_dir,
        runtime_dir,
        version_id: request.version_id,
        modloader: request.modloader,
        loader_version: request.loader_version,
        version_manifest: request.version_manifest,
    };
    
    state.submit(Box::new(task)).await
}

