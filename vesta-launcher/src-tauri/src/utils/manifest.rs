use crate::metadata_cache::MetadataCache;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::db_manager::get_app_config_dir;
use piston_lib::game::metadata::PistonMetadata;
use tauri::Manager;

pub async fn queue_manifest_generation(
    app_handle: &tauri::AppHandle,
    force_refresh: bool,
) -> Result<(), String> {
    let Some(task_manager) = app_handle.try_state::<crate::tasks::manager::TaskManager>() else {
        return Err("TaskManager not available".to_string());
    };

    let submit_result = if force_refresh {
        task_manager
            .submit(Box::new(GenerateManifestTask::new_force_refresh()))
            .await
    } else {
        task_manager
            .submit(Box::new(GenerateManifestTask::new()))
            .await
    };

    submit_result.map_err(|e| e.to_string())
}

/// Load the manifest, populating caches if needed. Never returns empty.
/// 1. In-memory MetadataCache → instant
/// 2. Disk cache → fast (warmup already ran)
/// 3. Fresh fetch → slow (first boot before warmup finishes)
pub async fn load_manifest(app_handle: &tauri::AppHandle) -> Result<PistonMetadata, String> {
    // 1. In-memory cache hit — instant
    if let Some(cache) = app_handle.try_state::<MetadataCache>() {
        if let Some(mut meta) = cache.get() {
            if super::java::normalize_metadata_java_requirements(&mut meta) {
                cache.set(&meta);
            }
            return Ok(meta);
        }
    }

    let config_dir = get_app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = config_dir.join("data");

    // 2. Disk cache hit — warmup already ran
    match piston_lib::game::metadata::cache::load_cached_metadata_if_present(&data_dir).await {
        Ok(Some(mut meta)) => {
            super::java::normalize_metadata_java_requirements(&mut meta);
            if let Some(cache) = app_handle.try_state::<MetadataCache>() {
                cache.set(&meta);
            }
            return Ok(meta);
        }
        Ok(None) => {
            log::info!("No cached metadata found, fetching fresh...");
        }
        Err(e) => {
            log::warn!("Failed to load cached metadata from disk: {}", e);
        }
    }

    // 3. Nothing cached — fetch fresh
    let mut meta = piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
        .await
        .map_err(|e| format!("Failed to fetch metadata: {}", e))?;

    super::java::normalize_metadata_java_requirements(&mut meta);

    if let Some(cache) = app_handle.try_state::<MetadataCache>() {
        cache.set(&meta);
    }
    Ok(meta)
}

/// Load manifest for version display on the install page.
/// Currently delegates to `load_manifest` (which does normalize Java requirements).
/// TODO: Add a fast-path that skips Java normalization since the install page
///       doesn't need Java version info.
pub async fn load_manifest_for_versions(
    app_handle: &tauri::AppHandle,
) -> Result<PistonMetadata, String> {
    load_manifest(app_handle).await
}
