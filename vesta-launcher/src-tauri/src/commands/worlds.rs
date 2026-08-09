use crate::tasks::manager::TaskManager;
use crate::tasks::world_transfer::WorldTransferTask;
use crate::worlds::install_selection;
use crate::worlds::transfer::TransferMode;
use crate::worlds::{WorldManager, WorldRef, WorldSummary};
use tauri::State;

#[tauri::command]
pub async fn list_instance_worlds(
    world_manager: State<'_, WorldManager>,
    instance_id: i32,
    force_refresh: bool,
) -> Result<Vec<WorldSummary>, String> {
    let instance = crate::commands::instances::get_instance(instance_id)?;
    let running = piston_lib::game::launcher::is_instance_running(&instance.slug())
        .await
        .map_err(|error| format!("Failed to check instance run state: {error}"))?;
    world_manager.list_instance_worlds(&instance, running, force_refresh)
}

#[tauri::command]
pub fn open_world_folder(world_ref: WorldRef) -> Result<(), String> {
    let path = crate::worlds::resolve_world_path(&world_ref)?;
    open::that(path).map_err(|error| format!("Failed to open world folder: {error}"))
}

#[tauri::command]
pub async fn transfer_world(
    task_manager: State<'_, TaskManager>,
    world_ref: WorldRef,
    destination_instance_id: i32,
    mode: TransferMode,
    risk_acknowledged: bool,
) -> Result<String, String> {
    let source = crate::commands::instances::get_instance(world_ref.instance_id)?;
    let destination = crate::commands::instances::get_instance(destination_instance_id)?;
    let task_id = format!(
        "world_transfer_{}_{}_{}",
        source.id, world_ref.directory_name, destination.id
    );
    task_manager
        .submit(Box::new(WorldTransferTask::new(
            source,
            destination,
            world_ref,
            mode,
            risk_acknowledged,
        )))
        .await?;
    Ok(task_id)
}

#[tauri::command]
pub fn submit_world_archive_selection(
    install_id: String,
    selected_candidate_ids: Vec<String>,
) -> Result<(), String> {
    install_selection::submit_selection(&install_id, selected_candidate_ids)
}
