use anyhow::{anyhow, Context};
use base64::{engine::general_purpose, Engine as _};

use crate::auth::ACCOUNT_TYPE_GUEST;
use crate::models::resource::{
    ResourceCategory, ResourceProject, ResourceProjectRecord, ResourceProjectRef, ResourceType,
    ResourceVersion, SearchQuery, SearchResponse, SourcePlatform,
};
use crate::resources::{ResourceManager, ResourceWatcher};
use crate::tasks::manager::TaskManager;
use crate::tasks::resource_download::ResourceDownloadTask;
use anyhow_tauri::TAResult as Result;
use tauri::{Manager, State};

/// Timeout for image downloads (in seconds)
const IMAGE_DOWNLOAD_TIMEOUT_SECS: u64 = 8;

/// Converts `icon_data` bytes to a base64 data URL, mirroring `process_instance_icon`.
/// Detects the actual image format from magic bytes.
fn process_resource_record_icon(mut record: ResourceProjectRecord) -> ResourceProjectRecord {
    if let Some(ref data) = record.icon_data {
        if !data.is_empty() {
            let mime = crate::utils::image::detect_image_mime(data);
            let b64 = general_purpose::STANDARD.encode(data);
            record.icon_url = Some(format!("data:{};base64,{}", mime, b64));
        }
    }
    // Keep the icon_url as a fallback only if it's a secure HTTPS URL (CSP allows `img-src https:`).
    // Insecure HTTP URLs are stripped — they would be blocked by both ATS and CSP.
    // If icon_data was available we already replaced icon_url with a data: URL above, so
    // this fallback only applies to records that haven't had their icon downloaded yet.
    if let Some(ref url) = record.icon_url {
        if url.starts_with("http://") {
            record.icon_url = None;
        }
    }
    record
}

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
        if let Err(e) = rm
            .refresh_resources_for_instance(instance_id, &mc_version, &loader)
            .await
        {
            log::error!(
                "[check_resource_updates] Failed to refresh resources: {}",
                e
            );
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
    resource_watcher
        .watch_instance("sync".to_string(), instance_id, game_dir)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn get_installed_resources(
    instance_id: i32,
) -> Result<Vec<crate::models::installed_resource::InstalledResource>> {
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let resources = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .load::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    Ok(resources)
}

#[tauri::command]
pub async fn get_resource_categories(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
) -> Result<Vec<ResourceCategory>> {
    resource_manager
        .get_categories(platform)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()).into())
}

#[tauri::command]
pub async fn search_resources(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    query: SearchQuery,
) -> Result<SearchResponse> {
    let res = resource_manager.search(platform, query).await;
    Ok(res?)
}

#[tauri::command]
pub async fn get_resource_project(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    id: String,
) -> Result<ResourceProject> {
    let res = resource_manager.get_project(platform, &id).await;
    Ok(res?)
}

#[tauri::command]
pub async fn cache_resource_metadata(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    project: ResourceProject,
) -> Result<()> {
    Ok(resource_manager
        .cache_project_metadata(platform, &project)
        .await?)
}

#[tauri::command]
pub async fn get_cached_resource_project(
    resource_manager: State<'_, ResourceManager>,
    id: String,
) -> Result<Option<ResourceProjectRecord>> {
    Ok(resource_manager
        .get_project_record(&id)
        .await?
        .map(process_resource_record_icon))
}

/// Downloads and caches a remote image as a base64 data URL.
/// Checks an in-memory cache in `ResourceManager` first; if the URL has
/// already been fetched, the cached data URL is returned immediately.
#[tauri::command]
pub async fn resolve_image_url(
    resource_manager: State<'_, ResourceManager>,
    url: String,
) -> Result<String> {
    // 1. Check cache
    {
        let cache = resource_manager.image_cache.read().await;
        if let Some(cached) = cache.get(&url) {
            return Ok(cached.clone());
        }
    }

    // 2. Download image with 8s timeout
    let client = piston_lib::client::shared_client();
    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Failed to download image from {}", url))?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "Image download failed with HTTP {} for {}",
            response.status(),
            url
        )
        .into());
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "image/png".to_string());

    let bytes = response
        .bytes()
        .await
        .context("Failed to read response bytes")?;
    if bytes.is_empty() {
        return Err(anyhow!("Downloaded image is empty for {}", url).into());
    }

    // 3. Base64 encode
    let b64 = general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", content_type, b64);

    // 4. Store in cache
    {
        let mut cache = resource_manager.image_cache.write().await;
        cache.insert(url, data_url.clone());
    }

    Ok(data_url)
}

/// Batch version of `resolve_image_url`. Accepts multiple URLs, checks the cache first
/// for each one, then downloads any uncached URLs concurrently. Returns a `Vec<String>`
/// where each element is the base64 data URL for the corresponding input URL.
/// If a download fails, an empty string is returned for that position.
#[tauri::command]
pub async fn resolve_image_urls(
    resource_manager: State<'_, ResourceManager>,
    urls: Vec<String>,
) -> Result<Vec<String>> {
    let total = urls.len();
    let mut results: Vec<Option<String>> = vec![None; total];

    // 1. Check cache for all URLs
    let mut uncached: Vec<(usize, String)> = Vec::new();
    {
        let cache = resource_manager.image_cache.read().await;
        for (i, url) in urls.iter().enumerate() {
            if let Some(cached) = cache.get(url) {
                results[i] = Some(cached.clone());
            } else {
                uncached.push((i, url.clone()));
            }
        }
    }

    if uncached.is_empty() {
        return Ok(results.into_iter().map(|r| r.unwrap_or_default()).collect());
    }

    // 2. Build a reusable HTTP client
    let client = piston_lib::client::shared_client();

    // 3. Download all uncached URLs concurrently
    let downloads = uncached.iter().map(|(_, url)| {
        let client = client.clone();
        let url = url.clone();
        async move {
            let result = async {
                let response = client
                    .get(&url)
                    .send()
                    .await
                    .with_context(|| format!("Failed to download image from {}", url))?;

                if !response.status().is_success() {
                    anyhow::bail!(
                        "Image download failed with HTTP {} for {}",
                        response.status(),
                        url
                    );
                }

                let content_type = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "image/png".to_string());

                let bytes = response
                    .bytes()
                    .await
                    .with_context(|| format!("Failed to read response bytes from {}", url))?;

                if bytes.is_empty() {
                    anyhow::bail!("Downloaded image is empty for {}", url);
                }

                let b64 = general_purpose::STANDARD.encode(&bytes);
                let data_url = format!("data:{};base64,{}", content_type, b64);
                Ok::<_, anyhow::Error>(data_url)
            }
            .await;
            (url, result.ok())
        }
    });

    let downloaded: Vec<(String, Option<String>)> = futures::future::join_all(downloads).await;

    // 4. Store results in cache and populate the output vector
    {
        let mut cache = resource_manager.image_cache.write().await;
        for ((idx, _original_url), (url, data_url)) in uncached.iter().zip(downloaded.iter()) {
            if let Some(data_url) = data_url {
                cache.insert(url.clone(), data_url.clone());
                results[*idx] = Some(data_url.clone());
            }
            // If download failed, results[idx] stays None -> will become empty string
        }
    }

    Ok(results.into_iter().map(|r| r.unwrap_or_default()).collect())
}

#[tauri::command]
pub async fn get_cached_resource_projects(
    resource_manager: State<'_, ResourceManager>,
    ids: Vec<String>,
) -> Result<Vec<ResourceProjectRecord>> {
    Ok(resource_manager
        .get_project_records(&ids)?
        .into_iter()
        .map(process_resource_record_icon)
        .collect())
}

#[tauri::command]
pub async fn get_or_hydrate_resource_projects(
    resource_manager: State<'_, ResourceManager>,
    refs: Vec<ResourceProjectRef>,
    allow_network: Option<bool>,
    refresh_stale: Option<bool>,
) -> Result<Vec<ResourceProjectRecord>> {
    Ok(resource_manager
        .get_or_hydrate_project_records(
            &refs,
            allow_network.unwrap_or(true),
            refresh_stale.unwrap_or(false),
        )
        .await?
        .into_iter()
        .map(process_resource_record_icon)
        .collect())
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
    Ok(resource_manager
        .get_versions(
            platform,
            &project_id,
            ignore_cache.unwrap_or(false),
            None,
            None,
        )
        .await?)
}

#[tauri::command]
pub async fn find_peer_resource(
    resource_manager: State<'_, ResourceManager>,
    project: ResourceProject,
) -> Result<Option<ResourceProject>> {
    Ok(resource_manager.find_peer_project(&project).await?)
}

#[tauri::command]
pub async fn delete_resource(instance_id: i32, resource_id: i32) -> Result<()> {
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;
    use std::fs;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Find the resource to get the path
    let res = ir_dsl::installed_resource
        .filter(ir_dsl::id.eq(resource_id))
        .filter(ir_dsl::instance_id.eq(instance_id))
        .first::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .map_err(|e| {
            anyhow::anyhow!(
                "Resource not found or does not belong to this instance: {}",
                e
            )
        })?;

    // Delete the file
    if fs::metadata(&res.local_path).is_ok() {
        fs::remove_file(&res.local_path)
            .map_err(|e| anyhow::anyhow!("Failed to delete file at {}: {}", res.local_path, e))?;
    }

    // Remove from database
    diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
        .execute(&mut conn)
        .map_err(|e| anyhow::anyhow!("Failed to delete from database: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn toggle_resource(resource_id: i32, enabled: bool) -> Result<()> {
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::utils::db::get_vesta_conn;
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
        return Err(anyhow::anyhow!(
            "File not found on disk. The entry has been removed from the database."
        )
        .into());
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
    app_handle: tauri::AppHandle,
    resource_manager: State<'_, ResourceManager>,
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
    platform: SourcePlatform,
    project_id: String,
    project_name: String,
    version: ResourceVersion,
    resource_type: ResourceType,
) -> Result<String> {
    // Check if we are in guest mode
    let active_account = match crate::auth::get_active_account() {
        Ok(a) => a,
        Err(_) => None,
    };

    if let Some(acc) = active_account {
        if acc.account_type == ACCOUNT_TYPE_GUEST {
            log::warn!("[install_resource] Blocked resource install attempt from Guest account");

            // Show notification
            if let Some(nm) =
                app_handle.try_state::<crate::notifications::manager::NotificationManager>()
            {
                let _ = nm.create(crate::notifications::models::CreateNotificationInput {
                    client_key: None,
                    title: Some("Login Required".to_string()),
                    description: Some(
                        "You must be signed in with a Microsoft account to install mods or resources."
                            .to_string(),
                    ),
                    severity: Some("warning".to_string()),
                    notification_type: Some(crate::notifications::models::NotificationType::Immediate),
                    dismissible: Some(true),                    persist: Some(false),
                    silent: Some(false),                    actions: None,
                    progress: None,
                    current_step: None,
                    total_steps: None,
                    metadata: None,
                    show_on_completion: None,
                });
            }

            return Err(anyhow::anyhow!(
                "You must be signed in with a Microsoft account to install mods or resources."
            )
            .into());
        }
    }

    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::schema::instance::dsl as inst_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // 0. Get config for dependency preferences
    let app_config = crate::utils::config::get_app_config().unwrap_or_default();

    // 1. Get instance info for context
    let instance = inst_dsl::instance
        .filter(inst_dsl::id.eq(instance_id))
        .first::<crate::models::instance::Instance>(&mut conn)
        .map_err(|e| anyhow::anyhow!("Instance not found: {}", e))?;

    // 2. Resolve dependencies
    let loader = instance.modloader.as_deref().unwrap_or("vanilla");
    let mut dependencies = resource_manager
        .resolve_dependencies(
            platform,
            resource_type,
            &version,
            &instance.minecraft_version,
            loader,
        )
        .await?;

    // 3. Filter dependencies based on user settings
    if !app_config.auto_install_dependencies {
        // If auto-install is off, we only keep "synthetic" dependencies (like Iris/Oculus)
        // that are injected for Shaders to ensure they work.
        // For other mods, we clear the list.
        if resource_type != ResourceType::Shader {
            dependencies.clear();
        } else {
            // Keep only the shader engines (Iris/Oculus)
            dependencies.retain(|(p, _)| {
                let id_lower = p.id.to_lowercase();
                let name_lower = p.name.to_lowercase();

                // Match by known slugs, IDs, or common names
                id_lower == "iris"
                    || id_lower == "oculus"
                    || id_lower == "445996"
                    || id_lower == "581495"
                    || name_lower == "iris"
                    || name_lower == "oculus"
                    || name_lower.contains("iris shaders")
                    || name_lower.contains("oculus shaders")
            });
        }
    }

    // 4. Get currently installed resources to skip duplicates
    let installed = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .load::<crate::models::installed_resource::InstalledResource>(&mut conn)
        .unwrap_or_default();

    // 5. Submit tasks
    // Main resource

    // Fetch and cache main project metadata (including icon)
    if let Ok(project) = resource_manager.get_project(platform, &project_id).await {
        let _ = resource_manager
            .cache_project_metadata(platform, &project)
            .await;
    }

    let main_task = ResourceDownloadTask {
        instance_id,
        platform,
        project_id,
        project_name: project_name.clone(),
        version,
        resource_type,
        dependency_for: None,
    };
    task_manager
        .submit(Box::new(main_task))
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    // Dependencies
    for (dep_project, dep_version) in dependencies {
        // Cache dependency metadata (including icon)
        let _ = resource_manager
            .cache_project_metadata(dep_project.source, &dep_project)
            .await;

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
            if is_installed {
                break;
            }

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
            dependency_for: Some(project_name.clone()),
        };

        task_manager
            .submit(Box::new(dep_task))
            .await
            .map_err(|e| anyhow::anyhow!(e))?;
    }

    Ok("Tasks submitted".to_string())
}
