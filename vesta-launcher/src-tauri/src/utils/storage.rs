use crate::models::instance::Instance;
use crate::schema::instance::dsl as instance_dsl;
use crate::utils::config::AppConfig;
use crate::utils::db::get_vesta_conn;
use crate::utils::db_manager::{get_app_config_dir, get_launcher_log_dir};
use diesel::prelude::*;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager};

pub const DEFAULT_ARTIFACT_CACHE_MAX_BYTES: i64 =
    piston_lib::game::installer::types::DEFAULT_ARTIFACT_CACHE_MAX_BYTES as i64;
const STORAGE_SNAPSHOT_CACHE_TTL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
struct CachedStorageSnapshot {
    collected_at: Instant,
    snapshot: StorageSnapshot,
}

static STORAGE_SNAPSHOT_CACHE: OnceLock<Mutex<Option<CachedStorageSnapshot>>> = OnceLock::new();

fn storage_snapshot_cache() -> &'static Mutex<Option<CachedStorageSnapshot>> {
    STORAGE_SNAPSHOT_CACHE.get_or_init(|| Mutex::new(None))
}

pub fn invalidate_storage_snapshot_cache() {
    if let Ok(mut cache) = storage_snapshot_cache().lock() {
        *cache = None;
    }
}

pub fn normalize_artifact_cache_limit_bytes(value: i64) -> i64 {
    if value <= 0 {
        DEFAULT_ARTIFACT_CACHE_MAX_BYTES
    } else {
        value
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategorySnapshot {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub kind: String,
    pub bytes: u64,
    pub clearable: bool,
    pub openable: bool,
    pub governed_by_artifact_limit: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInstanceSnapshot {
    pub id: i32,
    pub name: String,
    pub slug: String,
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub total_bytes: u64,
    pub categories: Vec<StorageCategorySnapshot>,
    pub instances_total_bytes: u64,
    pub instances: Vec<StorageInstanceSnapshot>,
    pub artifact_cache_limit_bytes: u64,
    pub artifact_cache_usage_bytes: u64,
    pub artifact_cache_prunable_bytes: u64,
    pub artifact_cache_pinned_bytes: u64,
    pub artifact_cache_over_limit_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CacheClearTarget {
    ArtifactCache,
    RuntimeModpackCache,
    ManifestMetadata,
    TempFiles,
}

pub fn cache_clear_targets() -> Vec<CacheClearTarget> {
    vec![
        CacheClearTarget::ArtifactCache,
        CacheClearTarget::RuntimeModpackCache,
        CacheClearTarget::ManifestMetadata,
        CacheClearTarget::TempFiles,
    ]
}

pub fn artifact_cache_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("cache")
}

pub fn manifests_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("data").join("manifests")
}

pub fn legacy_manifest_path(config_dir: &Path) -> PathBuf {
    config_dir.join("data").join("piston_manifest.json")
}

pub fn temp_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("temp")
}

fn database_paths(config_dir: &Path) -> Vec<PathBuf> {
    vec![
        config_dir.join("app_config.db"),
        config_dir.join("app_config.db-wal"),
        config_dir.join("app_config.db-shm"),
        config_dir.join("vesta.db"),
        config_dir.join("vesta.db-wal"),
        config_dir.join("vesta.db-shm"),
        config_dir.join("vesta-config.db"),
    ]
}

fn existing_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths.into_iter().filter(|path| path.exists()).collect()
}

pub fn storage_paths_for_target(
    app_handle: &AppHandle,
    config_dir: &Path,
    target: CacheClearTarget,
) -> Vec<PathBuf> {
    match target {
        CacheClearTarget::ArtifactCache => existing_paths(vec![artifact_cache_dir(config_dir)]),
        CacheClearTarget::RuntimeModpackCache => runtime_modpack_cache_dir(app_handle)
            .into_iter()
            .filter(|path| path.exists())
            .collect(),
        CacheClearTarget::ManifestMetadata => existing_paths(vec![
            manifests_dir(config_dir),
            legacy_manifest_path(config_dir),
        ]),
        CacheClearTarget::TempFiles => existing_paths(vec![temp_dir(config_dir)]),
    }
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    total += dir_size(&entry_path);
                } else {
                    total += metadata.len();
                }
            }
        }
    }
    total
}

fn path_size(path: &Path) -> u64 {
    if path.is_dir() {
        dir_size(path)
    } else {
        file_size(path)
    }
}

fn collect_files(path: &Path, files: &mut Vec<PathBuf>) {
    if !path.exists() {
        return;
    }

    if path.is_file() {
        files.push(path.to_path_buf());
        return;
    }

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            collect_files(&entry.path(), files);
        }
    }
}

fn file_lru_time(path: &Path) -> SystemTime {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.accessed().or_else(|_| metadata.modified()).ok())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn runtime_cache_dir(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle.path().app_cache_dir().ok()
}

fn runtime_modpack_cache_dir(app_handle: &AppHandle) -> Option<PathBuf> {
    runtime_cache_dir(app_handle).map(|path| path.join("modpacks"))
}

fn runtime_modpack_cache_size(app_handle: &AppHandle) -> u64 {
    runtime_modpack_cache_dir(app_handle)
        .filter(|path| path.exists())
        .map(|path| dir_size(&path))
        .unwrap_or(0)
}

fn runtime_cache_size(app_handle: &AppHandle) -> u64 {
    let Some(cache_dir) = runtime_cache_dir(app_handle).filter(|path| path.exists()) else {
        return 0;
    };

    let total = dir_size(&cache_dir);
    total.saturating_sub(runtime_modpack_cache_size(app_handle))
}

fn instance_snapshots() -> Result<Vec<StorageInstanceSnapshot>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let instances = instance_dsl::instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to load instances for storage snapshot: {}", e))?;

    let mut snapshots = instances
        .into_iter()
        .filter_map(|instance| {
            let path = instance.game_directory.clone()?;
            let bytes = path_size(Path::new(&path));
            Some(StorageInstanceSnapshot {
                id: instance.id,
                name: instance.name.clone(),
                slug: instance.slug(),
                path,
                bytes,
            })
        })
        .collect::<Vec<_>>();

    snapshots.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    Ok(snapshots)
}

fn category(
    id: &str,
    label: &str,
    description: impl Into<Option<String>>,
    kind: &str,
    bytes: u64,
    clearable: bool,
    openable: bool,
    governed_by_artifact_limit: bool,
) -> StorageCategorySnapshot {
    StorageCategorySnapshot {
        id: id.to_string(),
        label: label.to_string(),
        description: description.into(),
        kind: kind.to_string(),
        bytes,
        clearable,
        openable,
        governed_by_artifact_limit,
    }
}

pub fn collect_storage_snapshot(
    app_handle: &AppHandle,
    config: &AppConfig,
) -> Result<StorageSnapshot, String> {
    let config_dir = get_app_config_dir().map_err(|e| e.to_string())?;
    let log_dir = get_launcher_log_dir().map_err(|e| e.to_string())?;
    let instances = instance_snapshots()?;
    let instances_total_bytes = instances.iter().map(|instance| instance.bytes).sum::<u64>();

    let artifact_cache_dir = artifact_cache_dir(&config_dir);
    let artifact_cache_size = path_size(&artifact_cache_dir);
    let manifest_cache_size =
        path_size(&manifests_dir(&config_dir)) + file_size(&legacy_manifest_path(&config_dir));
    let temp_files_size = path_size(&temp_dir(&config_dir));
    let logs_size = path_size(&log_dir);
    let database_storage_size = database_paths(&config_dir)
        .into_iter()
        .map(|path| file_size(&path))
        .sum::<u64>();
    let runtime_cache_size = runtime_cache_size(app_handle);
    let modpack_cache_size = runtime_modpack_cache_size(app_handle);

    let artifact_cache_usage =
        match piston_lib::game::installer::cache::ArtifactCache::load_with_labels(&config_dir) {
            Ok(cache) => cache.usage_summary(),
            Err(error) => {
                log::warn!("Failed to inspect artifact cache usage summary: {}", error);
                piston_lib::game::installer::cache::ArtifactUsageSummary {
                    total_bytes: artifact_cache_size,
                    prunable_bytes: artifact_cache_size,
                    pinned_bytes: 0,
                }
            }
        };

    let artifact_cache_prunable_bytes = artifact_cache_usage
        .prunable_bytes
        .saturating_add(modpack_cache_size);
    let artifact_cache_pinned_bytes = artifact_cache_usage.pinned_bytes;
    let artifact_cache_usage_bytes = artifact_cache_usage
        .total_bytes
        .saturating_add(modpack_cache_size);

    let categories = vec![
        category(
            "instances",
            "Instances",
            Some("Installed Minecraft instances and their game data.".to_string()),
            "instances",
            instances_total_bytes,
            false,
            false,
            false,
        ),
        category(
            "artifact-cache",
            "Installer Artifacts",
            Some("Downloaded libraries, assets, runtimes, and installer files retained for repair and reuse.".to_string()),
            "cache",
            artifact_cache_size,
            true,
            false,
            true,
        ),
        category(
            "modpack-cache",
            "Modpack Archives",
            Some("Downloaded modpack ZIPs kept in runtime storage for installs, updates, and archive matching.".to_string()),
            "cache",
            modpack_cache_size,
            true,
            false,
            true,
        ),
        category(
            "manifest-cache",
            "Manifest Metadata",
            Some("Cached Minecraft, modloader, and Java requirement manifests.".to_string()),
            "cache",
            manifest_cache_size,
            true,
            false,
            false,
        ),
        category(
            "database-storage",
            "Database Metadata",
            Some("App databases, including resource metadata and launcher state.".to_string()),
            "data",
            database_storage_size,
            false,
            false,
            false,
        ),
        category(
            "runtime-cache",
            "Runtime Cache",
            Some("Player heads, capes, and other runtime-managed cached files.".to_string()),
            "cache",
            runtime_cache_size,
            false,
            true,
            false,
        ),
        category(
            "temp-files",
            "Temporary Files",
            Some("Temporary launcher files created during installs and background tasks.".to_string()),
            "cache",
            temp_files_size,
            true,
            false,
            false,
        ),
        category(
            "logs",
            "Logs",
            Some("Launcher diagnostic logs.".to_string()),
            "logs",
            logs_size,
            false,
            true,
            false,
        ),
    ];

    let total_bytes = categories.iter().map(|entry| entry.bytes).sum::<u64>();
    let artifact_cache_limit_bytes =
        normalize_artifact_cache_limit_bytes(config.artifact_cache_max_bytes) as u64;
    let artifact_cache_over_limit_bytes =
        artifact_cache_usage_bytes.saturating_sub(artifact_cache_limit_bytes);

    Ok(StorageSnapshot {
        total_bytes,
        categories,
        instances_total_bytes,
        instances,
        artifact_cache_limit_bytes,
        artifact_cache_usage_bytes,
        artifact_cache_prunable_bytes,
        artifact_cache_pinned_bytes,
        artifact_cache_over_limit_bytes,
    })
}

pub fn collect_storage_snapshot_cached(
    app_handle: &AppHandle,
    config: &AppConfig,
    force_refresh: bool,
) -> Result<StorageSnapshot, String> {
    if !force_refresh {
        if let Ok(cache) = storage_snapshot_cache().lock() {
            if let Some(cached) = cache.as_ref() {
                if cached.collected_at.elapsed() <= STORAGE_SNAPSHOT_CACHE_TTL {
                    return Ok(cached.snapshot.clone());
                }
            }
        }
    }

    let snapshot = collect_storage_snapshot(app_handle, config)?;
    if let Ok(mut cache) = storage_snapshot_cache().lock() {
        *cache = Some(CachedStorageSnapshot {
            collected_at: Instant::now(),
            snapshot: snapshot.clone(),
        });
    }
    Ok(snapshot)
}

pub fn enforce_governed_cache_limit(
    app_handle: &AppHandle,
    config: &AppConfig,
) -> Result<(), String> {
    let config_dir = get_app_config_dir().map_err(|e| e.to_string())?;
    let limit = normalize_artifact_cache_limit_bytes(config.artifact_cache_max_bytes) as u64;

    let mut artifact_cache =
        piston_lib::game::installer::cache::ArtifactCache::load_with_labels(&config_dir)
            .map_err(|e| format!("Failed to load artifact cache: {}", e))?;
    artifact_cache.prune_to_limit(limit);
    artifact_cache
        .save()
        .map_err(|e| format!("Failed to save artifact cache after pruning: {}", e))?;

    let artifact_usage = artifact_cache.usage_summary();
    let mut modpack_files = Vec::new();
    if let Some(modpack_dir) = runtime_modpack_cache_dir(app_handle) {
        collect_files(&modpack_dir, &mut modpack_files);
    }

    let mut modpack_bytes = modpack_files
        .iter()
        .map(|path| file_size(path))
        .sum::<u64>();
    if artifact_usage.total_bytes.saturating_add(modpack_bytes) <= limit {
        return Ok(());
    }

    modpack_files.sort_by_key(|path| (file_lru_time(path), path.clone()));
    for path in modpack_files {
        if artifact_usage.total_bytes.saturating_add(modpack_bytes) <= limit {
            break;
        }

        let bytes = file_size(&path);
        match fs::remove_file(&path) {
            Ok(()) => {
                modpack_bytes = modpack_bytes.saturating_sub(bytes);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                modpack_bytes = modpack_bytes.saturating_sub(bytes);
            }
            Err(error) => {
                log::warn!(
                    "Failed to prune runtime modpack cache file {:?}: {}",
                    path,
                    error
                );
            }
        }
    }

    invalidate_storage_snapshot_cache();
    Ok(())
}

pub fn clear_storage_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to remove directory {:?}: {}", path, e))?;
        fs::create_dir_all(path)
            .map_err(|e| format!("Failed to recreate directory {:?}: {}", path, e))?;
        return Ok(());
    }

    fs::remove_file(path).map_err(|e| format!("Failed to remove file {:?}: {}", path, e))?;
    Ok(())
}

pub fn unique_storage_paths_for_targets(
    app_handle: &AppHandle,
    config_dir: &Path,
    targets: &[CacheClearTarget],
) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for target in targets {
        for path in storage_paths_for_target(app_handle, config_dir, *target) {
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
    }

    paths
}

pub fn unique_storage_paths_for_targets_with_runtime(
    app_handle: &AppHandle,
    config_dir: &Path,
    targets: &[CacheClearTarget],
) -> Vec<PathBuf> {
    unique_storage_paths_for_targets(app_handle, config_dir, targets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_default_cache_limit_matches_installer_default() {
        assert_eq!(
            DEFAULT_ARTIFACT_CACHE_MAX_BYTES as u64,
            piston_lib::game::installer::types::DEFAULT_ARTIFACT_CACHE_MAX_BYTES
        );
        assert_eq!(
            normalize_artifact_cache_limit_bytes(0),
            DEFAULT_ARTIFACT_CACHE_MAX_BYTES
        );
    }

    #[test]
    fn cache_clear_policy_includes_runtime_modpack_cache() {
        assert!(cache_clear_targets().contains(&CacheClearTarget::RuntimeModpackCache));
    }
}
