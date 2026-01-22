use tauri::State;
use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, SearchResponse};
use crate::resources::{ResourceManager, ResourceWatcher};
use crate::tasks::manager::TaskManager;
use crate::tasks::resource_download::ResourceDownloadTask;
use anyhow_tauri::TAResult as Result;

#[tauri::command]
pub async fn check_resource_updates(
    resource_manager: State<'_, ResourceManager>,
    instance_id: i32,
    mc_version: String,
    loader: String,
) -> Result<()> {
    // Run in background
    let rm = resource_manager.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = rm.refresh_resources_for_instance(instance_id, &mc_version, &loader).await {
            log::error!("[check_resource_updates] Failed to refresh resources: {}", e);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn sync_instance_resources(
    resource_watcher: State<'_, ResourceWatcher>,
    instance_id: i32,
    game_dir: String,
) -> Result<()> {
    resource_watcher.watch_instance("sync".to_string(), instance_id, game_dir).await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
pub async fn cache_resource_metadata(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    project: ResourceProject,
) -> Result<()> {
    Ok(resource_manager.cache_project_metadata(platform, &project).await?)
}

#[tauri::command]
pub async fn get_cached_resource_project(
    resource_manager: State<'_, ResourceManager>,
    id: String,
) -> Result<Option<crate::models::resource::ResourceProjectRecord>> {
    Ok(resource_manager.get_project_record(&id).await?)
}

#[tauri::command]
pub async fn get_cached_resource_projects(
    resource_manager: State<'_, ResourceManager>,
    ids: Vec<String>,
) -> Result<Vec<crate::models::resource::ResourceProjectRecord>> {
    Ok(resource_manager.get_project_records(&ids)?)
}

#[tauri::command]
pub async fn get_resource_projects(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    ids: Vec<String>,
) -> Result<Vec<ResourceProject>> {
    Ok(resource_manager.get_projects(platform, &ids).await?)
}

#[tauri::command]
pub async fn get_resource_versions(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    project_id: String,
    ignore_cache: Option<bool>,
) -> Result<Vec<ResourceVersion>> {
    Ok(resource_manager.get_versions(platform, &project_id, ignore_cache.unwrap_or(false), None, None).await?)
}

#[tauri::command]
pub async fn find_peer_resource(
    resource_manager: State<'_, ResourceManager>,
    project: ResourceProject,
) -> Result<Option<ResourceProject>> {
    Ok(resource_manager.find_peer_project(&project).await?)
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
    resource_manager: State<'_, ResourceManager>,
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
    platform: SourcePlatform,
    project_id: String,
    project_name: String,
    version: ResourceVersion,
    resource_type: ResourceType,
) -> Result<String> {
    use crate::utils::db::get_vesta_conn;
    use crate::schema::instance::dsl as inst_dsl;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // 1. Get instance info for context
    let instance = inst_dsl::instance
        .filter(inst_dsl::id.eq(instance_id))
        .first::<crate::models::instance::Instance>(&mut conn)
        .map_err(|e| anyhow::anyhow!("Instance not found: {}", e))?;

    // 2. Resolve dependencies
    let loader = instance.modloader.as_deref().unwrap_or("vanilla");
    let dependencies = if resource_type == ResourceType::Mod {
        resource_manager.resolve_dependencies(
            platform, 
            &version, 
            &instance.minecraft_version, 
            loader
        ).await?
    } else {
        Vec::new()
    };

    // 3. Get currently installed resources to skip duplicates
    let installed = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .load::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .unwrap_or_default();

    // 4. Submit tasks
    // Main resource
    
    // Fetch and cache main project metadata (including icon)
    if let Ok(project) = resource_manager.get_project(platform, &project_id).await {
        let _ = resource_manager.cache_project_metadata(platform, &project).await;
    }

    let main_task = ResourceDownloadTask {
        instance_id,
        platform,
        project_id,
        project_name,
        version,
        resource_type,
    };
    task_manager.submit(Box::new(main_task)).await.map_err(|e| anyhow::anyhow!(e))?;

    // Dependencies
    for (dep_project, dep_version) in dependencies {
        // Cache dependency metadata (including icon)
        let _ = resource_manager.cache_project_metadata(dep_project.source, &dep_project).await;

        // Check if already installed (by ID or Peer ID)
        let mut is_installed = false;
        let dep_platform_str = format!("{:?}", dep_project.source).to_lowercase();
        
        for ins in &installed {
            // Direct ID match
            if ins.platform == dep_platform_str && ins.remote_id == dep_project.id {
                is_installed = true;
                break;
            }
            
            // External ID match
            if let Some(ref external_ids) = dep_project.external_ids {
                for (ext_plat, ext_id) in external_ids {
                    if ins.platform == ext_plat.to_lowercase() && ins.remote_id == *ext_id {
                        is_installed = true;
                        break;
                    }
                }
            }
            if is_installed { break; }

            // Name match as fallback
            if ins.display_name.to_lowercase() == dep_project.name.to_lowercase() {
                is_installed = true;
                break;
            }
        }

        if is_installed {
            log::info!("Skipping dependency {} as it is already installed (matched by ID, peer ID, or name)", dep_project.name);
            continue;
        }

        let dep_task = ResourceDownloadTask {
            instance_id,
            platform: dep_project.source,
            project_id: dep_project.id.clone(),
            project_name: dep_project.name,
            version: dep_version,
            resource_type: ResourceType::Mod,
        };
        
        task_manager.submit(Box::new(dep_task)).await.map_err(|e| anyhow::anyhow!(e))?;
    }

    Ok("Tasks submitted".to_string())
}
