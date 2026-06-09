use std::path::{Path, PathBuf};

use piston_lib::game::modpack::manifest::ModpackManifest;
use tauri::{AppHandle, Manager};

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::sync::manifest;
use crate::tasks::installers::modpack::enrich_manifest_platform_hashes;

/// Progress callback for long-running bootstrap operations.
pub trait BootstrapProgress: Send + Sync {
    fn on_description(&self, message: String);
}

/// Load $O$ from disk, or bootstrap it from the instance's linked platform version when missing.
pub async fn ensure_old_manifest(
    app_handle: &AppHandle,
    inst: &Instance,
    game_dir: &Path,
    progress: Option<&dyn BootstrapProgress>,
) -> Result<ModpackManifest, String> {
    if let Ok(mut manifest) = ModpackManifest::load(game_dir) {
        if let Err(e) = manifest::backfill_manifest_hashes(&mut manifest, game_dir, inst.id) {
            log::warn!(
                "[manifest_bootstrap] Failed to backfill hashes on existing manifest for instance {}: {}",
                inst.id,
                e
            );
        } else if let Err(e) = manifest.persist(game_dir) {
            log::warn!(
                "[manifest_bootstrap] Failed to persist backfilled manifest for instance {}: {}",
                inst.id,
                e
            );
        }
        return Ok(manifest);
    }

    if !is_linked_modpack(inst) {
        return Err(
            "Cannot load modpack manifest: instance is not linked to a platform modpack.".to_string(),
        );
    }

    log::info!(
        "[manifest_bootstrap] No manifest at {:?} for instance {} — bootstrapping from linked version {}",
        game_dir.join(ModpackManifest::FILE_NAME),
        inst.id,
        inst.modpack_version_id.as_deref().unwrap_or("?")
    );

    bootstrap_manifest_from_linked_version(app_handle, inst, game_dir, progress).await?;

    ModpackManifest::load(game_dir).map_err(|e| {
        format!(
            "Failed to load modpack manifest after bootstrap: {}",
            e
        )
    })
}

/// Build and persist a manifest from the instance's linked `modpack_version_id` ZIP.
pub async fn bootstrap_manifest_from_linked_version(
    app_handle: &AppHandle,
    inst: &Instance,
    game_dir: &Path,
    progress: Option<&dyn BootstrapProgress>,
) -> Result<ModpackManifest, String> {
    let project_id = inst
        .modpack_id
        .as_deref()
        .ok_or_else(|| "Missing modpack_id for manifest bootstrap".to_string())?;
    let version_id = inst
        .modpack_version_id
        .as_deref()
        .ok_or_else(|| "Missing modpack_version_id for manifest bootstrap".to_string())?;
    let platform = source_platform(inst)?;

    if let Some(p) = progress {
        p.on_description("Preparing modpack manifest...".to_string());
    }

    let zip_path = download_linked_version_zip(app_handle, platform, project_id, version_id, progress)
        .await?;

    if let Some(p) = progress {
        p.on_description("Building modpack manifest...".to_string());
    }

    let mut manifest =
        manifest::build_new_manifest(&zip_path, inst.modpack_id.clone()).map_err(|e| {
            format!("Failed to build manifest from linked modpack version: {}", e)
        })?;
    enrich_manifest_platform_hashes(app_handle, &mut manifest).await;
    manifest::backfill_manifest_hashes(&mut manifest, game_dir, inst.id).map_err(|e| {
        format!("Failed to backfill manifest hashes during bootstrap: {}", e)
    })?;
    manifest
        .persist(game_dir)
        .map_err(|e| format!("Failed to persist bootstrapped manifest: {}", e))?;

    log::info!(
        "[manifest_bootstrap] Bootstrapped manifest for instance {} ({} mods, {} overrides)",
        inst.id,
        manifest.mods.len(),
        manifest.overrides.extracted.len()
    );

    Ok(manifest)
}

fn is_linked_modpack(inst: &Instance) -> bool {
    inst.modpack_id.is_some()
        && inst.modpack_version_id.is_some()
        && inst.modpack_platform.is_some()
}

fn source_platform(inst: &Instance) -> Result<SourcePlatform, String> {
    match inst.modpack_platform.as_deref() {
        Some("modrinth") => Ok(SourcePlatform::Modrinth),
        Some("curseforge") => Ok(SourcePlatform::CurseForge),
        other => Err(format!(
            "Unsupported modpack platform for manifest bootstrap: {:?}",
            other
        )),
    }
}

async fn download_linked_version_zip(
    app_handle: &AppHandle,
    platform: SourcePlatform,
    project_id: &str,
    version_id: &str,
    progress: Option<&dyn BootstrapProgress>,
) -> Result<PathBuf, String> {
    let resource_manager = app_handle.state::<ResourceManager>();
    let version = resource_manager
        .get_version(platform, project_id, version_id)
        .await
        .map_err(|e| format!("Failed to resolve linked modpack version: {}", e))?;

    let modpacks_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("modpacks");
    std::fs::create_dir_all(&modpacks_dir).map_err(|e| e.to_string())?;

    let file_stem = format!("{}-{}", project_id, version_id)
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "_");
    let zip_path = modpacks_dir.join(format!("{}.zip", file_stem));

    if zip_path.exists() {
        return Ok(zip_path);
    }

    if let Some(p) = progress {
        p.on_description("Downloading modpack version...".to_string());
    }

    let client = piston_lib::client::shared_client();
    let silent_reporter = piston_lib::game::installer::types::SilentProgressReporter;
    piston_lib::game::installer::core::downloader::download_to_path(
        client,
        &version.download_url,
        &zip_path,
        Some(&version.hash),
        &silent_reporter,
    )
    .await
    .map_err(|e| format!("Failed to download linked modpack version: {}", e))?;

    Ok(zip_path)
}

/// Adapter so TaskContext progress can drive bootstrap downloads.
pub struct TaskBootstrapProgress<'a>(pub &'a crate::tasks::manager::TaskContext);

impl BootstrapProgress for TaskBootstrapProgress<'_> {
    fn on_description(&self, message: String) {
        self.0.update_description(message);
    }
}
