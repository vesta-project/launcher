use tauri::State;
use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, SearchResponse};
use crate::resources::ResourceManager;
use crate::tasks::manager::TaskManager;
use crate::tasks::resource_download::ResourceDownloadTask;
use anyhow_tauri::TAResult as Result;

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
