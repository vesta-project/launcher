use crate::utils::db_manager::get_app_config_dir;
use crate::{metadata_cache::MetadataCache, tasks::manifest::GenerateManifestTask};
use piston_lib::game::installer::core::jre_manager;
use piston_lib::game::java_policy::LEGACY_JAVA_MAJOR;
use piston_lib::game::metadata::PistonMetadata;
use std::path::PathBuf;
use tauri::Manager;

pub use piston_lib::game::java_policy::preferred_java_major;

fn normalize_metadata_java_requirements(metadata: &mut PistonMetadata) -> bool {
    let mut changed = false;

    for major in metadata.java_major_version_by_game_version.values_mut() {
        let preferred = preferred_java_major(*major);
        if preferred != *major {
            *major = preferred;
            changed = true;
        }
    }

    let before = metadata.required_java_major_versions.clone();
    for major in metadata.required_java_major_versions.iter_mut() {
        *major = preferred_java_major(*major);
    }
    metadata
        .required_java_major_versions
        .sort_unstable_by(|a, b| b.cmp(a));
    metadata.required_java_major_versions.dedup();

    if metadata.required_java_major_versions != before {
        changed = true;
    }

    changed
}

pub fn get_managed_jre_dir() -> Result<PathBuf, String> {
    get_app_config_dir()
        .map(|d| d.join("data").join("jre"))
        .map_err(|e| e.to_string())
}

pub fn scan_system_javas_filtered() -> Vec<jre_manager::DetectedJava> {
    let mut javas = jre_manager::scan_system_javas();

    // Filter out javas that are in our managed directory
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if managed_dir.exists() {
            javas.retain(|java| !java.path.starts_with(&managed_dir));
        }
    }

    javas
}

pub fn get_managed_javas() -> Vec<jre_manager::DetectedJava> {
    let mut managed_javas = Vec::new();
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if managed_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&managed_dir) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_dir() {
                        if let Some(java_exe) = jre_manager::find_java_executable(&entry_path) {
                            if let Ok(info) = jre_manager::verify_java(&java_exe) {
                                managed_javas.push(info);
                            }
                        }
                    }
                }
            }
        }
    }
    managed_javas
}

fn is_legacy_version_type(version_type: &str) -> bool {
    matches!(version_type, "old_alpha" | "old_beta")
}

pub fn resolve_required_java_from_manifest(
    metadata: &PistonMetadata,
    mc_version: &str,
) -> Result<u32, String> {
    if let Some(major) = metadata.java_major_version_by_game_version.get(mc_version) {
        return Ok(preferred_java_major(*major));
    }

    if let Some(version_meta) = metadata.game_versions.iter().find(|v| v.id == mc_version) {
        if is_legacy_version_type(&version_meta.version_type) {
            return Ok(LEGACY_JAVA_MAJOR);
        }

        return Err(format!(
            "Missing javaVersion.majorVersion for non-legacy version '{}'",
            mc_version
        ));
    }

    Err(format!(
        "Minecraft version '{}' not found in metadata",
        mc_version
    ))
}

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

pub async fn load_manifest_for_java_resolution(
    app_handle: &tauri::AppHandle,
) -> Result<Option<PistonMetadata>, String> {
    if let Some(cache) = app_handle.try_state::<MetadataCache>() {
        if let Some(mut meta) = cache.get() {
            if normalize_metadata_java_requirements(&mut meta) {
                cache.set(&meta);
            }
            return Ok(Some(meta));
        }
    }

    let data_dir = get_app_config_dir().map_err(|e| e.to_string())?;
    match piston_lib::game::metadata::cache::load_cached_metadata_if_present(&data_dir).await {
        Ok(Some(mut meta)) => {
            normalize_metadata_java_requirements(&mut meta);
            if let Some(cache) = app_handle.try_state::<MetadataCache>() {
                cache.set(&meta);
            }
            Ok(Some(meta))
        }
        Ok(None) => {
            if let Err(e) = queue_manifest_generation(app_handle, false).await {
                log::warn!("Failed to queue manifest generation: {}", e);
            }
            Ok(None)
        }
        Err(e) => {
            log::warn!("Failed to load cached metadata from disk: {}", e);
            if let Err(err) = queue_manifest_generation(app_handle, false).await {
                log::warn!(
                    "Failed to queue manifest generation after cache error: {}",
                    err
                );
            }
            Ok(None)
        }
    }
}

pub async fn resolve_required_java_major(
    app_handle: &tauri::AppHandle,
    mc_version: &str,
) -> Result<u32, String> {
    if let Some(mut metadata) = load_manifest_for_java_resolution(app_handle).await? {
        match resolve_required_java_from_manifest(&metadata, mc_version) {
            Ok(major) => return Ok(major),
            Err(e) => {
                log::warn!(
                    "Java major missing in cached manifest for '{}': {}. Falling back to Mojang detail lookup.",
                    mc_version,
                    e
                );
            }
        }

        let fetched = piston_lib::game::metadata::fetch_java_major_for_version(mc_version)
            .await
            .map_err(|e| e.to_string())?;
        let preferred = preferred_java_major(fetched);

        metadata
            .java_major_version_by_game_version
            .insert(mc_version.to_string(), preferred);

        if !metadata.required_java_major_versions.contains(&preferred) {
            metadata.required_java_major_versions.push(preferred);
            metadata
                .required_java_major_versions
                .sort_unstable_by(|a, b| b.cmp(a));
            metadata.required_java_major_versions.dedup();
        }

        if let Some(cache) = app_handle.try_state::<MetadataCache>() {
            cache.set(&metadata);
        }

        return Ok(preferred);
    }

    piston_lib::game::metadata::fetch_java_major_for_version(mc_version)
        .await
        .map(preferred_java_major)
        .map_err(|e| e.to_string())
}
