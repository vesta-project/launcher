use tauri::State;
use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, SearchResponse};
use crate::resources::{ResourceManager, ResourceWatcher};
use crate::tasks::manager::TaskManager;
use crate::tasks::resource_download::ResourceDownloadTask;
use anyhow_tauri::TAResult as Result;

#[tauri::command]
pub async fn sync_instance_resources(
    watcher: State<'_, ResourceWatcher>,
    instance_id: i32,
    instance_slug: String,
    game_dir: String,
) -> Result<()> {
    // Start watching if not already
    watcher.watch_instance(instance_slug, instance_id, game_dir.clone()).await?;
    // Always force a scan/cleanup when manually requested
    watcher.refresh_instance(instance_id, game_dir).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_installed_resources(
    instance_id: i32,
) -> Result<Vec<crate::models::installed_resource::InstalledResource>> {
    use crate::utils::db::get_vesta_conn;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let resources = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .load::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    
    Ok(resources)
}

#[tauri::command]
pub async fn search_resources(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    query: SearchQuery,
) -> Result<SearchResponse> {
    Ok(resource_manager.search(platform, query).await?)
}

#[tauri::command]
pub async fn get_resource_project(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    id: String,
) -> Result<ResourceProject> {
    Ok(resource_manager.get_project(platform, &id).await?)
}

#[tauri::command]
pub async fn get_resource_versions(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    project_id: String,
) -> Result<Vec<ResourceVersion>> {
    Ok(resource_manager.get_versions(platform, &project_id).await?)
}

#[tauri::command]
pub async fn delete_resource(
    instance_id: i32,
    resource_id: i32,
) -> Result<()> {
    use crate::utils::db::get_vesta_conn;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use diesel::prelude::*;
    use std::fs;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    
    // Find the resource to get the path
    let res = ir_dsl::installed_resource
        .filter(ir_dsl::id.eq(resource_id))
        .filter(ir_dsl::instance_id.eq(instance_id))
        .first::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .map_err(|e| anyhow::anyhow!("Resource not found or does not belong to this instance: {}", e))?;

    // Delete the file
    if fs::metadata(&res.local_path).is_ok() {
        fs::remove_file(&res.local_path).map_err(|e| anyhow::anyhow!("Failed to delete file: {}", e))?;
    }

    // Remove from database
    diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
        .execute(&mut conn)
        .map_err(|e| anyhow::anyhow!("Failed to delete from database: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn toggle_resource(
    resource_id: i32,
    enabled: bool,
) -> Result<()> {
    use crate::utils::db::get_vesta_conn;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use diesel::prelude::*;
    use std::fs;
    use std::path::Path;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    
    let res = ir_dsl::installed_resource
        .filter(ir_dsl::id.eq(resource_id))
        .first::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .map_err(|e| anyhow::anyhow!("Resource not found: {}", e))?;

    let current_path = Path::new(&res.local_path);
    if !current_path.exists() {
        // Auto-delete dead entry
        let _ = diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
            .execute(&mut conn);
        return Err(anyhow::anyhow!("File not found on disk. The entry has been removed from the database.").into());
    }

    let new_path = if enabled {
        // Remove .disabled if it exists
        if res.local_path.ends_with(".disabled") {
            res.local_path[..res.local_path.len() - 9].to_string()
        } else {
            res.local_path.clone()
        }
    } else {
        // Add .disabled if it doesn't exist
        if !res.local_path.ends_with(".disabled") {
            format!("{}.disabled", res.local_path)
        } else {
            res.local_path.clone()
        }
    };

    if new_path != res.local_path {
        fs::rename(&res.local_path, &new_path)
            .map_err(|e| anyhow::anyhow!("Failed to rename file: {}", e))?;
    }
    
    // Update database
    diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
        .set((
            ir_dsl::local_path.eq(new_path),
            ir_dsl::is_enabled.eq(enabled),
        ))
        .execute(&mut conn)
        .map_err(|e| anyhow::anyhow!("Failed to update database: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn install_resource(
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
    platform: SourcePlatform,
    project_id: String,
    project_name: String,
    version: ResourceVersion,
    resource_type: ResourceType,
) -> Result<String> {
    let task = ResourceDownloadTask {
        instance_id,
        platform,
        project_id,
        project_name,
        version,
        resource_type,
    };
    
    task_manager.submit(Box::new(task)).await.map_err(|e| anyhow::anyhow!(e))?;
    Ok("Task submitted".to_string())
}
