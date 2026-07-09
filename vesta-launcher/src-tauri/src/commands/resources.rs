use anyhow::{anyhow, Context};
use base64::{engine::general_purpose, Engine as _};

use crate::auth::ACCOUNT_TYPE_GUEST;
use crate::models::resource::{
    ReleaseType, ResourceCategory, ResourceProject, ResourceProjectRecord, ResourceProjectRef,
    ResourceType, ResourceVersion, SearchQuery, SearchResponse, SourcePlatform,
};
use crate::models::resource_update::{
    InstanceUpdateCheckResult, InstanceUpdateSnapshotResponse, ResourceUpdateCheckResult,
};
use crate::resources::update_cache::{
    instance_update_fingerprint, invalidate_instance_update_snapshot, is_snapshot_fresh,
    load_instance_update_snapshot, save_instance_update_snapshot, snapshot_to_result,
};
use crate::resources::{ResourceManager, ResourceWatcher};
use crate::tasks::manager::TaskManager;
use crate::tasks::resource_download::ResourceDownloadTask;
use anyhow_tauri::TAResult as Result;
use tauri::{Emitter, Manager, State};

const MAX_CONCURRENT_UPDATE_CHECKS: usize = 6;

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
pub fn get_instance_update_snapshot(
    instance_id: i32,
) -> Result<Option<InstanceUpdateSnapshotResponse>> {
    use crate::models::instance::Instance;
    use crate::schema::instance::dsl as inst_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let inst = inst_dsl::instance
        .filter(inst_dsl::id.eq(instance_id))
        .first::<Instance>(&mut conn)
        .map_err(|e| anyhow::anyhow!("Failed to load instance: {}", e))?;

    crate::resources::update_cache::get_instance_update_snapshot_response(instance_id, &inst)
        .map_err(|e| anyhow::anyhow!(e.to_string()).into())
}

#[tauri::command]
pub async fn check_instance_updates_lightweight(
    resource_manager: State<'_, ResourceManager>,
    instance_id: i32,
    force_refresh: Option<bool>,
    resource_ids: Option<Vec<i32>>,
    force_resource_ids: Option<Vec<i32>>,
) -> Result<InstanceUpdateCheckResult> {
    use crate::models::installed_resource::InstalledResource;
    use crate::models::instance::Instance;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::schema::instance::dsl as inst_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;
    use futures::stream::{self, StreamExt};
    use std::collections::{HashMap, HashSet};

    let (inst, resources) = {
        let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let inst = inst_dsl::instance
            .filter(inst_dsl::id.eq(instance_id))
            .first::<Instance>(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to load instance: {}", e))?;
        let resources = ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::is_manual.eq(false))
            .load::<InstalledResource>(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to load installed resources: {}", e))?;
        (inst, resources)
    };

    let fingerprint = instance_update_fingerprint(&inst);
    let force_refresh = force_refresh.unwrap_or(false);
    let filter_ids: Option<HashSet<i32>> = resource_ids.map(|ids| ids.into_iter().collect());
    let force_resource_ids: HashSet<i32> =
        force_resource_ids.unwrap_or_default().into_iter().collect();
    let is_partial = filter_ids.is_some() || !force_resource_ids.is_empty();

    if !force_refresh && !is_partial {
        if let Some(record) = load_instance_update_snapshot(instance_id)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            if is_snapshot_fresh(&record, &fingerprint) {
                return Ok(snapshot_to_result(&record).map_err(|e| anyhow::anyhow!(e.to_string()))?);
            }
        }
    }

    let loader = inst
        .modloader
        .clone()
        .unwrap_or_else(|| "vanilla".to_string());

    let mut merged_updates: HashMap<i32, ResourceUpdateCheckResult> = HashMap::new();
    let mut modpack_versions = Vec::new();
    let mut merge_base_loaded = false;
    let mut had_snapshot = false;

    if is_partial {
        if let Some(record) = load_instance_update_snapshot(instance_id)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            had_snapshot = true;
            if record.instance_fingerprint == fingerprint {
                if let Ok(data) = snapshot_to_result(&record) {
                    for update in data.resource_updates {
                        merged_updates.insert(update.resource_id, update);
                    }
                    if !force_refresh {
                        modpack_versions = data.modpack_versions;
                    }
                    merge_base_loaded = true;
                }
            }
        }
    }

    let all_candidates: Vec<InstalledResource> = resources
        .into_iter()
        .filter(|res| {
            res.source_kind != "modpack"
                && res.platform != "manual"
                && source_platform_from_str(&res.platform).is_some()
        })
        .collect();

    let candidates: Vec<InstalledResource> = if let Some(ref ids) = filter_ids {
        all_candidates
            .into_iter()
            .filter(|res| ids.contains(&res.id))
            .collect()
    } else {
        all_candidates
    };

    if !is_partial {
        if let (Some(modpack_id), Some(modpack_platform)) =
            (inst.modpack_id.as_deref(), inst.modpack_platform.as_deref())
        {
            modpack_versions = match source_platform_from_str(modpack_platform) {
                Some(platform) => resource_manager
                    .get_versions(platform, modpack_id, force_refresh, None, None)
                    .await
                    .unwrap_or_default(),
                None => Vec::new(),
            };
        }
    } else if force_refresh || modpack_versions.is_empty() {
        if let (Some(modpack_id), Some(modpack_platform)) =
            (inst.modpack_id.as_deref(), inst.modpack_platform.as_deref())
        {
            modpack_versions = match source_platform_from_str(modpack_platform) {
                Some(platform) => resource_manager
                    .get_versions(platform, modpack_id, force_refresh, None, None)
                    .await
                    .unwrap_or_default(),
                None => Vec::new(),
            };
        }
    }

    let rm = resource_manager.inner().clone();
    let mc_version = inst.minecraft_version.clone();
    let update_results = stream::iter(candidates)
        .map(|res| {
            let rm = rm.clone();
            let mc_version = mc_version.clone();
            let loader = loader.clone();
            let ignore_version_cache = force_refresh || force_resource_ids.contains(&res.id);
            async move {
                let platform = source_platform_from_str(&res.platform)?;
                let versions = rm
                    .get_versions(platform, &res.remote_id, ignore_version_cache, None, None)
                    .await
                    .ok()?;
                let best = find_best_resource_update(&versions, &res, &mc_version, &loader)?;
                if best.id == res.remote_version_id {
                    return Some((res.id, None));
                }
                Some((
                    res.id,
                    Some(ResourceUpdateCheckResult {
                        resource_id: res.id,
                        version: best,
                    }),
                ))
            }
        })
        .buffer_unordered(MAX_CONCURRENT_UPDATE_CHECKS)
        .filter_map(|result| async move { result })
        .collect::<Vec<_>>()
        .await;

    for (resource_id, update) in update_results {
        if let Some(entry) = update {
            merged_updates.insert(resource_id, entry);
        } else {
            merged_updates.remove(&resource_id);
        }
    }

    let result = InstanceUpdateCheckResult {
        resource_updates: merged_updates.into_values().collect(),
        modpack_versions,
    };

    let should_save_snapshot = !is_partial || merge_base_loaded || !had_snapshot;
    if should_save_snapshot {
        save_instance_update_snapshot(instance_id, &fingerprint, &result)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    } else if had_snapshot {
        if let Err(e) = invalidate_instance_update_snapshot(instance_id) {
            log::warn!(
                "[update_cache] Failed to invalidate stale snapshot for instance {}: {}",
                instance_id,
                e
            );
        }
    }

    Ok(result)
}

fn source_platform_from_str(platform: &str) -> Option<SourcePlatform> {
    match platform {
        "modrinth" => Some(SourcePlatform::Modrinth),
        "curseforge" => Some(SourcePlatform::CurseForge),
        _ => None,
    }
}

fn resource_type_from_str(resource_type: &str) -> Option<ResourceType> {
    match resource_type {
        "mod" => Some(ResourceType::Mod),
        "resourcepack" => Some(ResourceType::ResourcePack),
        "shader" => Some(ResourceType::Shader),
        "datapack" => Some(ResourceType::DataPack),
        "modpack" => Some(ResourceType::Modpack),
        "world" => Some(ResourceType::World),
        _ => None,
    }
}

fn release_type_from_str(release_type: &str) -> ReleaseType {
    match release_type {
        "alpha" => ReleaseType::Alpha,
        "beta" => ReleaseType::Beta,
        _ => ReleaseType::Release,
    }
}

fn is_release_allowed(candidate: ReleaseType, current: ReleaseType) -> bool {
    match current {
        ReleaseType::Release => candidate == ReleaseType::Release,
        ReleaseType::Beta => candidate == ReleaseType::Release || candidate == ReleaseType::Beta,
        ReleaseType::Alpha => true,
    }
}

fn release_rank(release_type: ReleaseType) -> u8 {
    match release_type {
        ReleaseType::Release => 0,
        ReleaseType::Beta => 1,
        ReleaseType::Alpha => 2,
    }
}

fn is_game_version_compatible(supported: &[String], target: &str) -> bool {
    let normalized_target = normalize_mc_version(target);
    let target_major_minor = normalized_target
        .split('.')
        .take(2)
        .collect::<Vec<_>>()
        .join(".");

    supported.iter().any(|version| {
        let normalized = normalize_mc_version(version);
        normalized == normalized_target || normalized == format!("{}.x", target_major_minor)
    })
}

fn normalize_mc_version(version: &str) -> String {
    version.strip_suffix(".0").unwrap_or(version).to_string()
}

fn version_matches_loader(
    version: &ResourceVersion,
    instance_loader: &str,
    resource_type: Option<ResourceType>,
) -> bool {
    let inst_loader = instance_loader.to_lowercase();
    let normalized_loaders = version
        .loaders
        .iter()
        .map(|loader| loader.to_lowercase())
        .collect::<Vec<_>>();

    match resource_type {
        Some(ResourceType::Shader) => inst_loader != "vanilla" && !inst_loader.is_empty(),
        Some(ResourceType::ResourcePack) | Some(ResourceType::DataPack) => true,
        Some(ResourceType::Mod) => {
            if inst_loader == "vanilla" || inst_loader.is_empty() {
                return false;
            }
            normalized_loaders
                .iter()
                .any(|loader| loader == &inst_loader)
                || (inst_loader == "quilt"
                    && normalized_loaders.iter().any(|loader| loader == "fabric"))
                || (inst_loader == "neoforge"
                    && normalized_loaders.iter().any(|loader| loader == "forge"))
        }
        Some(ResourceType::Modpack) => true,
        _ => {
            if inst_loader == "vanilla" || inst_loader.is_empty() {
                normalized_loaders.is_empty()
                    || normalized_loaders
                        .iter()
                        .any(|loader| loader == "minecraft")
            } else {
                normalized_loaders
                    .iter()
                    .any(|loader| loader == &inst_loader)
                    || (inst_loader == "quilt"
                        && normalized_loaders.iter().any(|loader| loader == "fabric"))
                    || (inst_loader == "neoforge"
                        && normalized_loaders.iter().any(|loader| loader == "forge"))
            }
        }
    }
}

fn find_best_resource_update(
    versions: &[ResourceVersion],
    resource: &crate::models::installed_resource::InstalledResource,
    game_version: &str,
    loader: &str,
) -> Option<ResourceVersion> {
    let current_release = release_type_from_str(&resource.release_type);
    let resource_type = resource_type_from_str(&resource.resource_type);

    versions
        .iter()
        .filter(|version| {
            is_game_version_compatible(&version.game_versions, game_version)
                && version_matches_loader(version, loader, resource_type)
                && is_release_allowed(version.release_type, current_release)
        })
        .min_by_key(|version| {
            let explicit = version.game_versions.iter().any(|v| v == game_version);
            (!explicit, release_rank(version.release_type))
        })
        .cloned()
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
    crate::resources::ledger::remove_resource(instance_id, resource_id)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if let Err(e) = invalidate_instance_update_snapshot(instance_id) {
        log::warn!(
            "[update_cache] Failed to invalidate snapshot for instance {}: {}",
            instance_id,
            e
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_resource(resource_id: i32, enabled: bool) -> Result<()> {
    crate::resources::ledger::set_enabled(resource_id, enabled)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn clear_modpack_resource_provenance(instance_id: i32) -> Result<()> {
    crate::resources::ledger::clear_modpack_provenance(instance_id)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn backfill_modpack_resource_provenance_fast(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<()> {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match backfill_modpack_resource_provenance_fast_inner(instance_id) {
            Ok(changed) => {
                if changed > 0 {
                    let _ = app_handle.emit("resources-updated", instance_id);
                }
            }
            Err(e) => {
                log::warn!(
                    "[resource-provenance] Fast backfill failed for instance {}: {}",
                    instance_id,
                    e
                );
            }
        }
    });
    Ok(())
}

fn backfill_modpack_resource_provenance_fast_inner(instance_id: i32) -> anyhow::Result<usize> {
    use crate::models::installed_resource::InstalledResource;
    use crate::models::instance::Instance;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::schema::instance::dsl as inst_dsl;
    use crate::utils::db::get_vesta_conn;
    use crate::utils::db_manager::get_app_config_dir;
    use crate::utils::instance_helpers::resolve_instance_game_directory;
    use diesel::prelude::*;

    let inst = {
        let mut conn = get_vesta_conn()?;
        inst_dsl::instance
            .filter(inst_dsl::id.eq(instance_id))
            .first::<Instance>(&mut conn)?
    };

    if inst.modpack_id.is_none()
        || inst.modpack_version_id.is_none()
        || inst.modpack_platform.is_none()
    {
        return Ok(0);
    }

    let config_dir = get_app_config_dir()?;
    let data_dir = config_dir.join("data");
    let instances_root = data_dir.join("instances");
    let game_dir = resolve_instance_game_directory(&inst, &instances_root, &data_dir);

    let Some(manifest) = load_modpack_manifest_for_fast_backfill(&inst, &game_dir)? else {
        log::info!(
            "[resource-provenance] No local manifest for fast backfill on instance {}; skipping repair/bootstrap",
            instance_id
        );
        return Ok(0);
    };

    let resources = {
        let mut conn = get_vesta_conn()?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .load::<InstalledResource>(&mut conn)?
    };

    let matched_ids = match_manifest_owned_resources(&resources, &manifest, &game_dir);
    let changed = apply_resource_provenance_diff(&inst, &resources, &matched_ids)?;
    if changed > 0 {
        log::info!(
            "[resource-provenance] Fast backfilled {} provenance rows for instance {}",
            changed,
            instance_id
        );
    }

    Ok(changed)
}

#[tauri::command]
pub async fn backfill_modpack_resource_provenance(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<usize> {
    use crate::models::installed_resource::InstalledResource;
    use crate::models::instance::Instance;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::schema::instance::dsl as inst_dsl;
    use crate::utils::db::get_vesta_conn;
    use crate::utils::db_manager::get_app_config_dir;
    use crate::utils::instance_helpers::resolve_instance_game_directory;
    use diesel::prelude::*;

    let inst = {
        let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        inst_dsl::instance
            .filter(inst_dsl::id.eq(instance_id))
            .first::<Instance>(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to load instance: {}", e))?
    };

    if inst.modpack_id.is_none()
        || inst.modpack_version_id.is_none()
        || inst.modpack_platform.is_none()
    {
        return Ok(0);
    }

    let config_dir = get_app_config_dir().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let data_dir = config_dir.join("data");
    let instances_root = data_dir.join("instances");
    let game_dir = resolve_instance_game_directory(&inst, &instances_root, &data_dir);

    let mut manifest = load_modpack_manifest_for_backfill(&app_handle, &inst, &game_dir).await?;
    if let Err(e) =
        crate::sync::manifest::backfill_manifest_hashes(&mut manifest, &game_dir, instance_id)
    {
        log::warn!(
            "[resource-provenance] Failed to backfill manifest hashes for instance {}: {}",
            instance_id,
            e
        );
    }
    if let Err(e) = manifest.persist(&game_dir) {
        log::warn!(
            "[resource-provenance] Failed to persist manifest after backfill for instance {}: {}",
            instance_id,
            e
        );
    }

    let resources = {
        let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .load::<InstalledResource>(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to load installed resources: {}", e))?
    };

    let matched_ids = match_manifest_owned_resources(&resources, &manifest, &game_dir);

    let matched_vec: Vec<i32> = matched_ids.iter().copied().collect();
    let changed = apply_resource_provenance_diff(&inst, &resources, &matched_ids)
        .map_err(|e| anyhow::anyhow!("Failed to apply resource provenance: {}", e))?;

    if changed > 0 {
        let _ = app_handle.emit("resources-updated", instance_id);
    }

    Ok(matched_vec.len())
}

fn load_modpack_manifest_for_fast_backfill(
    inst: &crate::models::instance::Instance,
    game_dir: &std::path::Path,
) -> anyhow::Result<Option<piston_lib::game::modpack::manifest::ModpackManifest>> {
    use piston_lib::game::modpack::manifest::ModpackManifest;
    use piston_lib::game::modpack::types::ModpackMetadata;

    if let Ok(manifest) = ModpackManifest::load(game_dir) {
        return Ok(Some(manifest));
    }

    let legacy_path = game_dir.join(".vesta").join(ModpackManifest::FILE_NAME);
    if let Ok(content) = std::fs::read_to_string(&legacy_path) {
        if let Ok(manifest) = serde_json::from_str::<ModpackManifest>(&content) {
            return Ok(Some(manifest));
        }
        if let Ok(metadata) = serde_json::from_str::<ModpackMetadata>(&content) {
            return Ok(Some(ModpackManifest::from_install(
                &metadata,
                &[],
                &[],
                None,
                inst.modpack_id.clone(),
            )));
        }
    }

    Ok(None)
}

fn apply_resource_provenance_diff(
    inst: &crate::models::instance::Instance,
    resources: &[crate::models::installed_resource::InstalledResource],
    matched_ids: &std::collections::HashSet<i32>,
) -> anyhow::Result<usize> {
    crate::resources::ledger::apply_modpack_provenance(inst, resources, matched_ids)
}

async fn load_modpack_manifest_for_backfill(
    app_handle: &tauri::AppHandle,
    inst: &crate::models::instance::Instance,
    game_dir: &std::path::Path,
) -> Result<piston_lib::game::modpack::manifest::ModpackManifest> {
    use piston_lib::game::modpack::manifest::ModpackManifest;
    use piston_lib::game::modpack::types::ModpackMetadata;

    if let Ok(manifest) = ModpackManifest::load(game_dir) {
        return Ok(manifest);
    }

    let legacy_path = game_dir.join(".vesta").join(ModpackManifest::FILE_NAME);
    if let Ok(content) = std::fs::read_to_string(&legacy_path) {
        if let Ok(manifest) = serde_json::from_str::<ModpackManifest>(&content) {
            return Ok(manifest);
        }
        if let Ok(metadata) = serde_json::from_str::<ModpackMetadata>(&content) {
            return Ok(ModpackManifest::from_install(
                &metadata,
                &[],
                &[],
                None,
                inst.modpack_id.clone(),
            ));
        }
    }

    Ok(
        crate::sync::manifest_bootstrap::ensure_old_manifest(app_handle, inst, game_dir, None)
            .await
            .map_err(|e| anyhow::anyhow!(e))?,
    )
}

fn match_manifest_owned_resources(
    resources: &[crate::models::installed_resource::InstalledResource],
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
    game_dir: &std::path::Path,
) -> std::collections::HashSet<i32> {
    use crate::utils::instance_helpers::normalize_path;
    use piston_lib::game::modpack::manifest::{disabled_mod_path, resolve_mod_path_on_disk};
    use std::collections::HashSet;

    let mut matched_ids = HashSet::new();

    for manifest_mod in &manifest.mods {
        let mut path_candidates = HashSet::new();
        path_candidates.insert(normalize_path(&game_dir.join(&manifest_mod.path)));
        path_candidates.insert(normalize_path(
            &game_dir.join(disabled_mod_path(&manifest_mod.path)),
        ));
        if let Some(path) = resolve_mod_path_on_disk(game_dir, &manifest_mod.path) {
            path_candidates.insert(normalize_path(&path));
        }

        let manifest_sha1 = manifest_mod
            .sha1
            .as_deref()
            .filter(|hash| !hash.is_empty())
            .map(str::to_lowercase);

        for resource in resources {
            let path_matches = path_candidates
                .contains(&normalize_path(std::path::Path::new(&resource.local_path)));
            let hash_matches = manifest_sha1.as_ref().is_some_and(|sha1| {
                resource
                    .hash
                    .as_deref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(sha1))
            });
            let platform_version_matches =
                manifest_source_matches_resource(&manifest_mod.source, resource);

            if path_matches || hash_matches || platform_version_matches {
                matched_ids.insert(resource.id);
            }
        }
    }

    for override_path in &manifest.overrides.extracted {
        let mut path_candidates = HashSet::new();
        path_candidates.insert(normalize_path(&game_dir.join(override_path)));
        path_candidates.insert(normalize_path(
            &game_dir.join(disabled_mod_path(override_path)),
        ));
        let override_sha1 = manifest
            .overrides
            .hashes
            .get(&override_path.to_lowercase())
            .filter(|hash| !hash.is_empty())
            .map(|hash| hash.to_lowercase());

        for resource in resources {
            let path_matches = path_candidates
                .contains(&normalize_path(std::path::Path::new(&resource.local_path)));
            let hash_matches = override_sha1.as_ref().is_some_and(|sha1| {
                resource
                    .hash
                    .as_deref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(sha1))
            });
            if path_matches || hash_matches {
                matched_ids.insert(resource.id);
            }
        }
    }

    matched_ids
}

fn manifest_source_matches_resource(
    source: &piston_lib::game::modpack::manifest::ModSource,
    resource: &crate::models::installed_resource::InstalledResource,
) -> bool {
    use piston_lib::game::modpack::manifest::ModSource;

    match source {
        ModSource::Modrinth {
            project_id,
            version_id,
            ..
        } => {
            resource.platform == "modrinth"
                && resource.remote_version_id == *version_id
                && (project_id.is_empty() || resource.remote_id == *project_id)
        }
        ModSource::CurseForge {
            project_id,
            file_id,
            ..
        } => {
            resource.platform == "curseforge"
                && resource.remote_version_id == file_id.to_string()
                && project_id
                    .map(|id| resource.remote_id == id.to_string())
                    .unwrap_or(true)
        }
    }
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
