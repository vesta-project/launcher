use anyhow::{anyhow, Context};
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::collections::{hash_map::DefaultHasher, HashSet};
use std::hash::{Hash, Hasher};

use crate::auth::ACCOUNT_TYPE_GUEST;
use crate::models::resource::{
    ResourceCategory, ResourceProject, ResourceProjectRecord, ResourceProjectRef, ResourceType,
    ResourceVersion, ResourceVersionDetails, SearchQuery, SearchResponse, SourcePlatform,
};
use crate::models::resource_update::{
    InstanceUpdateCheckResult, InstanceUpdateSnapshotResponse, ResourceUpdateCheckResult,
};
use crate::notifications::models::{ProgressUpdate, PROGRESS_INDETERMINATE};
use crate::resources::update_cache::{
    instance_update_fingerprint, invalidate_instance_update_snapshot, is_snapshot_fresh,
    load_instance_update_snapshot, save_instance_update_snapshot, snapshot_to_result,
};
use crate::resources::{ResourceManager, ResourceWatcher};
use crate::tasks::manager::TaskManager;
use crate::tasks::resource_download::{
    plan_artifacts, requires_world_target, ResourceDownloadTask,
};
use crate::worlds::ResourceInstallTarget;
use anyhow_tauri::TAResult as Result;
use std::sync::{Mutex, OnceLock};
use tauri::{ipc::Channel, Emitter, Manager, State};

const MAX_CONCURRENT_UPDATE_CHECKS: usize = 6;

#[derive(Debug, Serialize)]
pub struct ResourceProjectOverviewRecord {
    pub id: String,
    pub source: String,
    pub name: String,
    pub summary: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub has_cached_icon: bool,
    pub project_type: String,
    pub last_updated: String,
    pub metadata_synced_at: Option<String>,
    pub icon_synced_at: Option<String>,
}

impl From<ResourceProjectRecord> for ResourceProjectOverviewRecord {
    fn from(record: ResourceProjectRecord) -> Self {
        Self {
            id: record.id,
            source: record.source,
            name: record.name,
            summary: record.summary,
            description: record.description,
            icon_url: record
                .icon_url
                .filter(|url| url.starts_with("https://") || url.starts_with("data:image/")),
            has_cached_icon: record
                .icon_data
                .as_ref()
                .is_some_and(|bytes| !bytes.is_empty()),
            project_type: record.project_type,
            last_updated: record.last_updated,
            metadata_synced_at: record.metadata_synced_at,
            icon_synced_at: record.icon_synced_at,
        }
    }
}

#[cfg(test)]
mod overview_tests {
    use super::*;

    #[test]
    fn overview_metadata_never_serializes_cached_icon_bytes() {
        let record = ResourceProjectRecord {
            id: "project".to_string(),
            source: "modrinth".to_string(),
            name: "Project".to_string(),
            summary: "Summary".to_string(),
            description: None,
            icon_url: Some("https://example.invalid/icon.png".to_string()),
            icon_data: Some(vec![1, 2, 3, 4]),
            project_type: "mod".to_string(),
            last_updated: "2026-07-24T00:00:00Z".to_string(),
            metadata_synced_at: None,
            icon_synced_at: None,
        };

        let value = serde_json::to_value(ResourceProjectOverviewRecord::from(record))
            .expect("overview record should serialize");
        assert!(value.get("icon_data").is_none());
        assert_eq!(
            value.get("has_cached_icon"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn overview_metadata_rejects_insecure_icon_urls() {
        let record = ResourceProjectRecord {
            id: "project".to_string(),
            source: "modrinth".to_string(),
            name: "Project".to_string(),
            summary: "Summary".to_string(),
            description: None,
            icon_url: Some("http://example.invalid/icon.png".to_string()),
            icon_data: None,
            project_type: "mod".to_string(),
            last_updated: "2026-07-24T00:00:00Z".to_string(),
            metadata_synced_at: None,
            icon_synced_at: None,
        };

        assert!(ResourceProjectOverviewRecord::from(record)
            .icon_url
            .is_none());
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceResourceOverview {
    pub instance_id: i32,
    pub resources: Vec<crate::models::installed_resource::InstalledResource>,
    pub project_records: Vec<ResourceProjectOverviewRecord>,
    pub missing_project_refs: Vec<ResourceProjectRef>,
    pub update_snapshot: Option<InstanceUpdateSnapshotResponse>,
    pub metadata_status: &'static str,
    pub repair_status: &'static str,
    pub revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRescanSummary {
    pub scanned: usize,
    pub hashed: usize,
    pub identified: usize,
    pub unresolved: usize,
    pub status: &'static str,
}

static ACTIVE_RESOURCE_RESCANS: OnceLock<Mutex<HashSet<i32>>> = OnceLock::new();

struct ResourceRescanGuard(i32);

impl ResourceRescanGuard {
    fn acquire(instance_id: i32) -> Option<Self> {
        let active = ACTIVE_RESOURCE_RESCANS.get_or_init(|| Mutex::new(HashSet::new()));
        let mut active = active.lock().unwrap();
        active.insert(instance_id).then_some(Self(instance_id))
    }
}

impl Drop for ResourceRescanGuard {
    fn drop(&mut self) {
        if let Some(active) = ACTIVE_RESOURCE_RESCANS.get() {
            active.lock().unwrap().remove(&self.0);
        }
    }
}

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
pub async fn rescan_instance_resources(
    app_handle: tauri::AppHandle,
    resource_watcher: State<'_, ResourceWatcher>,
    instance_id: i32,
    resource_ids: Option<Vec<i32>>,
    progress_channel: Channel<ProgressUpdate>,
) -> Result<ResourceRescanSummary> {
    let Some(_guard) = ResourceRescanGuard::acquire(instance_id) else {
        return Ok(ResourceRescanSummary {
            scanned: 0,
            hashed: 0,
            identified: 0,
            unresolved: 0,
            status: "alreadyRunning",
        });
    };

    let inst = crate::commands::instances::get_instance(instance_id)
        .map_err(|error| anyhow!("Failed to load instance for resource rescan: {error}"))?;
    let game_dir = inst
        .game_directory
        .clone()
        .ok_or_else(|| anyhow!("Instance has no game directory"))?;

    let targeted = resource_ids.as_ref().is_some_and(|ids| !ids.is_empty());
    if !targeted {
        let _ = progress_channel.send(ProgressUpdate::Step {
            name: "Discovering local resources…".to_string(),
            total: None,
        });
        resource_watcher
            .refresh_instance(instance_id, game_dir)
            .await
            .map_err(|error| anyhow!(error.to_string()))?;
    }

    let candidates = crate::resources::reconciliation::unresolved_candidates_for_instance(
        instance_id,
        resource_ids.as_deref(),
    )
    .map_err(|error| anyhow!(error.to_string()))?;
    let scanned = candidates.len();

    let total = candidates.len();
    let channel = progress_channel.clone();
    let progress = std::sync::Arc::new(move |current: usize, total: usize| {
        let _ = channel.send(ProgressUpdate::Progress {
            percent: PROGRESS_INDETERMINATE,
            description: Some(format!("Hashing local resources… {current}/{total}")),
            severity: None,
        });
        let _ = channel.send(ProgressUpdate::StepCount {
            current: current as u32,
            total: Some(total as u32),
        });
    }) as crate::resources::reconciliation::LocalFactProgress;
    let _ = progress_channel.send(ProgressUpdate::Step {
        name: "Hashing local resources…".to_string(),
        total: Some(total as u32),
    });
    let prepared = crate::resources::reconciliation::prepare_candidates_with_progress(
        instance_id,
        candidates,
        Some(progress),
    )
    .await;
    let hashed = prepared.len();

    let _ = progress_channel.send(ProgressUpdate::Step {
        name: "Matching with Modrinth and CurseForge…".to_string(),
        total: Some(hashed as u32),
    });
    let summary = crate::resources::reconciliation::reconcile_prepared_candidates(
        &app_handle,
        instance_id,
        prepared,
        if targeted {
            "manual-resource-identification"
        } else {
            "manual-resource-rescan"
        },
    )
    .await
    .map_err(|error| anyhow!(error.to_string()))?;

    let offline = app_handle
        .state::<crate::utils::network::NetworkManager>()
        .get_status()
        == crate::utils::network::NetworkStatus::Offline;
    let status = if summary.unresolved == 0 {
        "complete"
    } else if offline {
        "offline"
    } else {
        "partial"
    };
    let message = if scanned == 0 {
        "No unlinked resources need identification.".to_string()
    } else if summary.unresolved == 0 {
        format!("Identified {} resources.", summary.identified)
    } else {
        format!(
            "Identified {} resources; {} remain unlinked.",
            summary.identified, summary.unresolved
        )
    };
    let _ = progress_channel.send(ProgressUpdate::Finished {
        success: true,
        message: Some(message),
    });

    Ok(ResourceRescanSummary {
        scanned,
        hashed,
        identified: summary.identified,
        unresolved: summary.unresolved,
        status,
    })
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

/// Returns the complete locally available resource state needed for first paint.
///
/// This command deliberately performs no network requests and no filesystem scan.
/// Cached icon bytes are reduced to a boolean so a large resource collection cannot
/// turn into a multi-megabyte base64 IPC payload.
#[tauri::command]
pub async fn get_instance_resource_overview(instance_id: i32) -> Result<InstanceResourceOverview> {
    let started = std::time::Instant::now();
    let overview = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        use crate::models::installed_resource::InstalledResource;
        use crate::models::instance::Instance;
        use crate::schema::installed_resource::dsl as ir_dsl;
        use crate::schema::instance::dsl as inst_dsl;
        use crate::schema::resource_project::dsl as rp_dsl;
        use crate::utils::db::get_vesta_conn;
        use diesel::prelude::*;

        let mut conn = get_vesta_conn()?;
        let resources = ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .load::<InstalledResource>(&mut conn)?;

        let mut refs = Vec::new();
        let mut seen_refs = HashSet::new();
        for resource in &resources {
            let Some(platform) = SourcePlatform::from_str_id(resource.platform.as_str()) else {
                continue;
            };
            if resource.remote_id.is_empty() {
                continue;
            }
            if seen_refs.insert((platform, resource.remote_id.clone())) {
                refs.push(ResourceProjectRef {
                    platform,
                    id: resource.remote_id.clone(),
                });
            }
        }

        let ids = refs
            .iter()
            .map(|project_ref| &project_ref.id)
            .collect::<Vec<_>>();
        let mut records = if ids.is_empty() {
            Vec::new()
        } else {
            rp_dsl::resource_project
                .filter(rp_dsl::id.eq_any(ids))
                .load::<ResourceProjectRecord>(&mut conn)?
        };
        let requested_keys = refs
            .iter()
            .map(|project_ref| {
                (
                    format!("{:?}", project_ref.platform).to_lowercase(),
                    project_ref.id.clone(),
                )
            })
            .collect::<HashSet<_>>();
        records.retain(|record| {
            requested_keys.contains(&(record.source.to_lowercase(), record.id.clone()))
        });

        let record_keys = records
            .iter()
            .map(|record| (record.source.to_lowercase(), record.id.clone()))
            .collect::<HashSet<_>>();
        let missing_project_refs = refs
            .into_iter()
            .filter(|project_ref| {
                let source = format!("{:?}", project_ref.platform).to_lowercase();
                !record_keys.contains(&(source, project_ref.id.clone()))
            })
            .collect::<Vec<_>>();

        let inst = inst_dsl::instance
            .filter(inst_dsl::id.eq(instance_id))
            .first::<Instance>(&mut conn)?;
        let update_snapshot =
            crate::resources::update_cache::get_instance_update_snapshot_response(
                instance_id,
                &inst,
            )?;

        let mut revision_hasher = DefaultHasher::new();
        instance_id.hash(&mut revision_hasher);
        for resource in &resources {
            resource.id.hash(&mut revision_hasher);
            resource.remote_version_id.hash(&mut revision_hasher);
            resource.is_enabled.hash(&mut revision_hasher);
            resource.file_mtime.hash(&mut revision_hasher);
        }

        let has_unresolved_rows = resources.iter().any(|resource| {
            resource.remote_id.is_empty()
                || !matches!(
                    resource.platform.as_str(),
                    "modrinth" | "curseforge" | "smithed"
                )
        });
        Ok(InstanceResourceOverview {
            instance_id,
            metadata_status: if missing_project_refs.is_empty() && !has_unresolved_rows {
                "complete"
            } else {
                "partial"
            },
            repair_status: "notChecked",
            revision: format!("{:x}", revision_hasher.finish()),
            resources,
            project_records: records.into_iter().map(Into::into).collect(),
            missing_project_refs,
            update_snapshot,
        })
    })
    .await
    .map_err(|error| anyhow!("Failed to join resource overview task: {error}"))?
    .map_err(|error| anyhow!(error.to_string()))?;

    log::debug!(
        "[perf] instance-resource-overview instance_id={} resources={} metadata={} elapsed_ms={}",
        instance_id,
        overview.resources.len(),
        overview.project_records.len(),
        started.elapsed().as_millis()
    );
    Ok(overview)
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
    platform: SourcePlatform,
    id: String,
) -> Result<Option<ResourceProjectRecord>> {
    Ok(resource_manager
        .get_project_record(platform, &id)
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
    refs: Vec<ResourceProjectRef>,
) -> Result<Vec<ResourceProjectOverviewRecord>> {
    Ok(resource_manager
        .get_project_records(&refs)?
        .into_iter()
        .map(Into::into)
        .collect())
}

#[tauri::command]
pub async fn hydrate_resource_project_icons(
    resource_manager: State<'_, ResourceManager>,
    refs: Vec<ResourceProjectRef>,
) -> Result<Vec<ResourceProjectOverviewRecord>> {
    Ok(resource_manager
        .hydrate_project_icons(&refs)
        .await?
        .into_iter()
        .map(process_resource_record_icon)
        .map(Into::into)
        .collect())
}

#[tauri::command]
pub async fn get_or_hydrate_resource_projects(
    resource_manager: State<'_, ResourceManager>,
    refs: Vec<ResourceProjectRef>,
    allow_network: Option<bool>,
    refresh_stale: Option<bool>,
) -> Result<Vec<ResourceProjectOverviewRecord>> {
    Ok(resource_manager
        .get_or_hydrate_project_records(
            &refs,
            allow_network.unwrap_or(true),
            refresh_stale.unwrap_or(false),
        )
        .await?
        .into_iter()
        .map(Into::into)
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
pub async fn get_resource_version_details(
    resource_manager: State<'_, ResourceManager>,
    platform: SourcePlatform,
    project_id: String,
    version_id: String,
) -> Result<ResourceVersionDetails> {
    Ok(resource_manager
        .get_version_details(platform, &project_id, &version_id)
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
                let best = crate::resources::update_policy::find_best_update(
                    &versions,
                    &res,
                    &mc_version,
                    &loader,
                )?;
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
    SourcePlatform::from_str_id(platform)
}

#[tauri::command]
pub async fn list_resource_sources(
    resource_manager: State<'_, ResourceManager>,
) -> Result<Vec<crate::resources::sources::SourceCapabilities>> {
    Ok(resource_manager.list_source_capabilities().await)
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
    app_handle: tauri::AppHandle,
    instance_id: i32,
    resource_id: i32,
) -> Result<()> {
    let resource = crate::resources::ledger::get_resource(instance_id, resource_id)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let managed = crate::worlds::manifest::managed_datapack_manifest(&resource)
        .map_err(anyhow::Error::msg)?;
    let mut backup = None;
    if let Some((world, mut manifest, component_index)) = managed.as_ref().cloned() {
        let previous = manifest.clone();
        manifest.managed_components.remove(component_index);
        manifest.updated_at = chrono::Utc::now();
        crate::worlds::manifest::write_manifest(&world, &manifest).map_err(anyhow::Error::msg)?;

        let original = std::path::PathBuf::from(&resource.local_path);
        if original.exists() {
            let backup_path = world
                .join(".vesta")
                .join(format!(".delete-{}", uuid::Uuid::new_v4()));
            if let Err(error) = std::fs::rename(&original, &backup_path) {
                let _ = crate::worlds::manifest::write_manifest(&world, &previous);
                return Err(anyhow!("Failed to stage datapack deletion: {error}").into());
            }
            backup = Some((original, backup_path, world, previous));
        }
    }
    if let Err(error) = crate::resources::ledger::remove_resource(instance_id, resource_id) {
        if let Some((original, backup_path, world, previous)) = &backup {
            let _ = std::fs::rename(backup_path, original);
            let _ = crate::worlds::manifest::write_manifest(world, previous);
        } else if let Some((world, previous, _)) = managed {
            let _ = crate::worlds::manifest::write_manifest(&world, &previous);
        }
        return Err(anyhow!(error.to_string()).into());
    }
    if let Some((_, backup_path, _, _)) = backup {
        let _ = std::fs::remove_file(backup_path);
    }

    if let Err(e) = invalidate_instance_update_snapshot(instance_id) {
        log::warn!(
            "[update_cache] Failed to invalidate snapshot for instance {}: {}",
            instance_id,
            e
        );
    }

    crate::resources::reconciliation::emit_rows_changed(
        &app_handle,
        instance_id,
        "resource-deleted",
    )?;
    let _ = app_handle.emit(
        "core://instance-worlds-changed",
        serde_json::json!({
            "instanceId": instance_id,
            "revision": chrono::Utc::now().timestamp_millis(),
            "reason": "datapack-deleted"
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn toggle_resource(
    app_handle: tauri::AppHandle,
    instance_id: i32,
    resource_id: i32,
    enabled: bool,
) -> Result<()> {
    let resource = crate::resources::ledger::get_resource(instance_id, resource_id)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let managed = crate::worlds::manifest::managed_datapack_manifest(&resource)
        .map_err(anyhow::Error::msg)?;
    let current_path = std::path::PathBuf::from(&resource.local_path);
    let new_path = crate::resources::ledger::toggled_path(&current_path, enabled);
    if let Some((world, mut manifest, component_index)) = managed.as_ref().cloned() {
        let previous = manifest.clone();
        let relative = new_path
            .strip_prefix(&world)
            .map_err(|_| anyhow!("Managed datapack escaped its world"))?
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        manifest.managed_components[component_index].relative_path = relative;
        manifest.updated_at = chrono::Utc::now();
        crate::worlds::manifest::write_manifest(&world, &manifest).map_err(anyhow::Error::msg)?;
        if let Err(error) = crate::resources::ledger::set_enabled(resource_id, enabled) {
            if new_path.exists() && !current_path.exists() {
                let _ = std::fs::rename(&new_path, &current_path);
            }
            let _ = crate::worlds::manifest::write_manifest(&world, &previous);
            return Err(anyhow!(error.to_string()).into());
        }
    } else {
        crate::resources::ledger::set_enabled(resource_id, enabled)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    crate::resources::reconciliation::emit_rows_changed(
        &app_handle,
        instance_id,
        "resource-toggled",
    )?;
    let _ = app_handle.emit(
        "core://instance-worlds-changed",
        serde_json::json!({
            "instanceId": instance_id,
            "revision": chrono::Utc::now().timestamp_millis(),
            "reason": "datapack-toggled"
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn clear_modpack_resource_provenance(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<()> {
    crate::resources::ledger::clear_modpack_provenance(instance_id)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    crate::resources::reconciliation::emit_rows_changed(
        &app_handle,
        instance_id,
        "provenance-cleared",
    )?;
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
                    let _ = crate::resources::reconciliation::emit_rows_changed(
                        &app_handle,
                        instance_id,
                        "provenance-backfill",
                    );
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

    let Some(manifest) = crate::modpack::state::load_present(&game_dir)? else {
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

    let matched_ids =
        crate::modpack::state::match_owned_resources(&resources, &manifest, &game_dir);
    let changed =
        crate::modpack::state::apply_resource_provenance(&inst, &resources, &matched_ids)?;
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

    let mut manifest =
        crate::modpack::state::load_or_bootstrap(&app_handle, &inst, &game_dir).await?;
    crate::modpack::state::backfill_and_persist(&mut manifest, &game_dir, instance_id);

    let resources = {
        let mut conn = get_vesta_conn().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .load::<InstalledResource>(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to load installed resources: {}", e))?
    };

    let matched_ids =
        crate::modpack::state::match_owned_resources(&resources, &manifest, &game_dir);

    let matched_vec: Vec<i32> = matched_ids.iter().copied().collect();
    let changed = crate::modpack::state::apply_resource_provenance(&inst, &resources, &matched_ids)
        .map_err(|e| anyhow::anyhow!("Failed to apply resource provenance: {}", e))?;

    if changed > 0 {
        let _ = crate::resources::reconciliation::emit_rows_changed(
            &app_handle,
            instance_id,
            "provenance-backfill",
        );
    }

    Ok(matched_vec.len())
}

#[tauri::command]
pub async fn install_resource(
    app_handle: tauri::AppHandle,
    resource_manager: State<'_, ResourceManager>,
    task_manager: State<'_, TaskManager>,
    target: ResourceInstallTarget,
    platform: SourcePlatform,
    project_id: String,
    project_name: String,
    version: ResourceVersion,
    resource_type: ResourceType,
) -> Result<String> {
    let instance_id = match &target {
        ResourceInstallTarget::Instance { instance_id } => *instance_id,
        ResourceInstallTarget::World { world } => world.instance_id,
    };
    let planned = plan_artifacts(&version, resource_type).map_err(anyhow::Error::msg)?;
    let world_artifact_count = planned
        .iter()
        .filter(|artifact| artifact.resource_type == ResourceType::World)
        .count();
    if world_artifact_count > 1 {
        return Err(anyhow!("A resource version may contain only one world archive").into());
    }
    if world_artifact_count > 0 && planned.len() != world_artifact_count {
        return Err(anyhow!("World archives cannot be combined with file artifacts").into());
    }
    if planned
        .iter()
        .any(|artifact| artifact.resource_type == ResourceType::DataPack)
        && !matches!(&target, ResourceInstallTarget::World { .. })
    {
        return Err(anyhow!("Datapack installation requires a world target").into());
    }
    if world_artifact_count > 0 && !matches!(&target, ResourceInstallTarget::Instance { .. }) {
        return Err(anyhow!("World archives install into an instance, not another world").into());
    }
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

    if !matches!(&target, ResourceInstallTarget::World { .. })
        && dependencies.iter().any(|(project, dependency_version)| {
            plan_artifacts(dependency_version, project.resource_type).is_ok_and(|artifacts| {
                artifacts
                    .iter()
                    .any(|artifact| artifact.resource_type == ResourceType::DataPack)
            })
        })
    {
        return Err(anyhow!("A datapack dependency requires a world target").into());
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
        target: target.clone(),
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

        let dependency_requires_world =
            requires_world_target(&dep_version, dep_project.resource_type);

        // World-scoped dependencies must be resolved by their exact destination
        // in the download task. A copy in another world is not a duplicate.
        let mut is_installed = false;
        let dep_platform_str = format!("{:?}", dep_project.source).to_lowercase();

        for ins in installed.iter().filter(|_| !dependency_requires_world) {
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
            target: if dependency_requires_world {
                target.clone()
            } else {
                ResourceInstallTarget::Instance { instance_id }
            },
            platform: dep_project.source,
            project_id: dep_project.id.clone(),
            project_name: dep_project.name,
            version: dep_version,
            resource_type: dep_project.resource_type,
            dependency_for: Some(project_name.clone()),
        };

        task_manager
            .submit(Box::new(dep_task))
            .await
            .map_err(|e| anyhow::anyhow!(e))?;
    }

    Ok("Tasks submitted".to_string())
}
