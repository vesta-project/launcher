use crate::tasks::manager::{
    resourcepacks_conflict_key, saves_conflict_key, world_conflict_key, TaskManager,
};
use crate::tasks::world_transfer::WorldTransferTask;
use crate::worlds::install_selection;
use crate::worlds::transfer::TransferMode;
use crate::worlds::{datapacks::WorldDatapackOverview, WorldManager, WorldRef, WorldSummary};
use tauri::{Emitter, State};

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
pub async fn delete_world(
    app_handle: tauri::AppHandle,
    world_manager: State<'_, WorldManager>,
    task_manager: State<'_, TaskManager>,
    world_ref: WorldRef,
) -> Result<(), String> {
    let _conflict_guard = task_manager
        .acquire_conflicts([
            world_conflict_key(world_ref.instance_id, &world_ref.directory_name),
            saves_conflict_key(world_ref.instance_id),
        ])
        .await;
    crate::worlds::delete_world(&world_ref)?;
    world_manager.invalidate(world_ref.instance_id);
    let rows_result = crate::resources::reconciliation::emit_rows_changed(
        &app_handle,
        world_ref.instance_id,
        "world-deleted",
    );
    let worlds_result = app_handle.emit(
        "core://instance-worlds-changed",
        serde_json::json!({
            "instanceId": world_ref.instance_id,
            "revision": chrono::Utc::now().timestamp_millis(),
            "reason": "world-deleted",
        }),
    );
    if let Err(error) = worlds_result {
        log::warn!("World was deleted, but World change notification failed: {error}");
    }
    if let Err(error) = rows_result {
        log::warn!("World was deleted, but Resource change notification failed: {error}");
    }
    Ok(())
}

#[tauri::command]
pub fn list_world_datapacks(world_ref: WorldRef) -> Result<WorldDatapackOverview, String> {
    crate::worlds::datapacks::list_world_datapacks(&world_ref)
}

#[tauri::command]
pub async fn check_world_datapack_updates(
    resource_manager: State<'_, crate::resources::ResourceManager>,
    world_ref: WorldRef,
    force_refresh: bool,
) -> Result<crate::worlds::datapacks::WorldDatapackUpdateCheck, String> {
    use crate::models::resource::{ResourceType, SourcePlatform};

    let (game_version, resources) = crate::worlds::datapacks::update_check_context(&world_ref)?;
    let mut updates = Vec::with_capacity(resources.len());
    for resource in resources {
        let Some(platform) = SourcePlatform::from_str_id(&resource.platform) else {
            continue;
        };
        let project_type = if platform == SourcePlatform::CurseForge {
            match resource_manager
                .get_project(platform, &resource.remote_id)
                .await
            {
                Ok(project) => project.resource_type,
                Err(error) => {
                    updates.push(crate::worlds::datapacks::WorldDatapackUpdateStatus {
                        resource_id: resource.id,
                        exact_version: None,
                        manual_review_available: false,
                        error: Some(format!("Failed to inspect datapack project: {error}")),
                    });
                    continue;
                }
            }
        } else {
            // Mixed Modrinth projects can remain typed as mods. The selected
            // version's `datapack` loader is the authoritative variant tag.
            ResourceType::Mod
        };
        match resource_manager
            .get_versions(platform, &resource.remote_id, force_refresh, None, None)
            .await
        {
            Ok(versions) => updates.push(crate::worlds::datapacks::select_update_status(
                &versions,
                &resource,
                game_version.as_deref(),
                platform,
                project_type,
            )),
            Err(error) => {
                updates.push(crate::worlds::datapacks::WorldDatapackUpdateStatus {
                    resource_id: resource.id,
                    exact_version: None,
                    manual_review_available: false,
                    error: Some(format!("Failed to check datapack versions: {error}")),
                });
            }
        }
    }
    Ok(crate::worlds::datapacks::WorldDatapackUpdateCheck {
        world: world_ref,
        game_version,
        updates,
    })
}

#[tauri::command]
pub fn open_world_datapacks_folder(world_ref: WorldRef) -> Result<(), String> {
    crate::worlds::datapacks::open_world_datapacks_folder(&world_ref)
}

#[tauri::command]
pub async fn toggle_world_datapack(
    app_handle: tauri::AppHandle,
    world_manager: State<'_, WorldManager>,
    task_manager: State<'_, TaskManager>,
    world_ref: WorldRef,
    resource_id: i32,
    enabled: bool,
) -> Result<(), String> {
    let _conflict_guard = task_manager
        .acquire_conflicts([world_conflict_key(
            world_ref.instance_id,
            &world_ref.directory_name,
        )])
        .await;
    crate::worlds::datapacks::toggle_world_datapack(&world_ref, resource_id, enabled)?;
    world_manager.invalidate(world_ref.instance_id);
    let rows_result = crate::resources::reconciliation::emit_rows_changed(
        &app_handle,
        world_ref.instance_id,
        "world-datapack-toggled",
    );
    let world_result = crate::worlds::datapacks::emit_world_datapacks_changed(
        &app_handle,
        &world_ref,
        "datapack-toggled",
    );
    if let Err(error) = world_result {
        log::warn!("Datapack was toggled, but World change notification failed: {error}");
    }
    if let Err(error) = rows_result {
        log::warn!("Datapack was toggled, but Resource change notification failed: {error}");
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_world_datapack(
    app_handle: tauri::AppHandle,
    world_manager: State<'_, WorldManager>,
    task_manager: State<'_, TaskManager>,
    world_ref: WorldRef,
    resource_id: i32,
) -> Result<crate::worlds::datapacks::WorldDatapackRemoval, String> {
    let _conflict_guard = task_manager
        .acquire_conflicts([
            world_conflict_key(world_ref.instance_id, &world_ref.directory_name),
            resourcepacks_conflict_key(world_ref.instance_id),
        ])
        .await;
    let removal = crate::worlds::datapacks::delete_world_datapack(&world_ref, resource_id)?;
    world_manager.invalidate(world_ref.instance_id);
    let rows_result = crate::resources::reconciliation::emit_rows_changed(
        &app_handle,
        world_ref.instance_id,
        "world-datapack-deleted",
    );
    let world_result = crate::worlds::datapacks::emit_world_datapacks_changed(
        &app_handle,
        &world_ref,
        "datapack-deleted",
    );
    if let Err(error) = world_result {
        log::warn!("Datapack was deleted, but World change notification failed: {error}");
    }
    if let Err(error) = rows_result {
        log::warn!("Datapack was deleted, but Resource change notification failed: {error}");
    }
    Ok(removal)
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
