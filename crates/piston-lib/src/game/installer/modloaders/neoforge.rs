use crate::game::installer::config::NEOFORGE_MAVEN_URL;
use crate::game::installer::core::traits::ModloaderInstaller;
use crate::game::installer::modloaders::forge::installer::install_forge_modloader;
use crate::game::installer::types::{InstallSpec, ProgressReporter};
use crate::game::installer::{track_artifact_from_path, try_restore_artifact};
use crate::game::metadata::ModloaderType as MetadataModloaderType;
use anyhow::{Context, Result};
use futures::future::BoxFuture;
use std::path::PathBuf;
use std::sync::Arc;

pub struct NeoForgeInstaller;

impl ModloaderInstaller for NeoForgeInstaller {
    fn install<'a>(
        &'a self,
        spec: &'a InstallSpec,
        reporter: Arc<dyn ProgressReporter>,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(install_neoforge(spec, reporter))
    }
}

/// Install NeoForge modloader
pub async fn install_neoforge(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
) -> Result<()> {
    log::info!("Installing NeoForge for Minecraft {}", spec.version_id);

    // Determine NeoForge version
    let neoforge_version = spec
        .modloader_version
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("NeoForge version not specified"))?;

    // Download NeoForge installer JAR
    let installer_path = download_neoforge_installer(
        spec.version_id.clone(),
        neoforge_version.clone(),
        spec.data_dir().clone(),
    )
    .await?;

    // Use the same simplified installer as Forge
    install_forge_modloader(
        spec,
        reporter,
        MetadataModloaderType::NeoForge,
        "NeoForge",
        installer_path,
    )
    .await
}

/// Download NeoForge installer JAR
async fn download_neoforge_installer(
    _minecraft_version: String,
    neoforge_version: String,
    data_dir: PathBuf,
) -> Result<PathBuf> {
    // NeoForge version format: "21.1.65" or "21.0.65-beta"
    // The version is used directly as-is for NeoForge (not prefixed with MC version)
    let full_version = neoforge_version;

    let installer_filename = format!("neoforge-{}-installer.jar", full_version);
    let cache_dir = data_dir.join("cache").join("neoforge_installers");
    tokio::fs::create_dir_all(&cache_dir).await?;

    let installer_path = cache_dir.join(&installer_filename);
    let label = format!("installers/neoforge/{}", installer_filename);

    // Check cache first
    if installer_path.exists() {
        log::info!("Using cached NeoForge installer: {:?}", installer_path);
        track_artifact_from_path(label, &installer_path, None, None)
            .await
            .ok();
        return Ok(installer_path);
    }

    // Try restoring from artifact cache
    if try_restore_artifact(&label, &installer_path).await? {
        log::info!(
            "Restored NeoForge installer from cache: {:?}",
            installer_path
        );
        return Ok(installer_path);
    }

    // Download from NeoForge Maven
    let url = format!(
        "{}net/neoforged/neoforge/{}/{}",
        NEOFORGE_MAVEN_URL, full_version, installer_filename
    );

    log::info!("Downloading NeoForge installer from: {}", url);

    let response = reqwest::get(&url)
        .await
        .context("Failed to download NeoForge installer")?;

    if !response.status().is_success() {
        anyhow::bail!(
            "Failed to download NeoForge installer: HTTP {}",
            response.status()
        );
    }

    let bytes = response.bytes().await?;
    tokio::fs::write(&installer_path, &bytes).await?;
    track_artifact_from_path(label, &installer_path, None, Some(url)).await?;

    log::info!("Downloaded NeoForge installer to: {:?}", installer_path);
    Ok(installer_path)
}
