pub mod installer;
pub mod parser;

use self::installer::install_forge_modloader;
use crate::game::installer::config::FORGE_MAVEN_URL;
use crate::game::installer::core::traits::ModloaderInstaller;
use crate::game::installer::types::{InstallSpec, ProgressReporter};
use crate::game::installer::{track_artifact_from_path, try_restore_artifact};
use crate::game::metadata::ModloaderType as MetadataModloaderType;
use anyhow::{Context, Result};
use futures::future::BoxFuture;
use std::path::PathBuf;
use std::sync::Arc;

pub struct ForgeInstaller;

impl ModloaderInstaller for ForgeInstaller {
    fn install<'a>(
        &'a self,
        spec: &'a InstallSpec,
        reporter: Arc<dyn ProgressReporter>,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(install_forge(spec, reporter))
    }
}

/// Install Forge modloader
pub async fn install_forge(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
) -> Result<()> {
    log::info!("Installing Forge for Minecraft {}", spec.version_id);

    // Determine Forge version
    let forge_version = spec
        .modloader_version
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Forge version not specified"))?;

    // Download Forge installer JAR
    let installer_path = download_forge_installer(
        spec.version_id.clone(),
        forge_version.clone(),
        spec.data_dir().clone(),
    )
    .await?;

    // Use the new simplified installer
    install_forge_modloader(
        spec,
        reporter,
        MetadataModloaderType::Forge,
        "Forge",
        installer_path,
    )
    .await
}

/// Download Forge installer JAR
async fn download_forge_installer(
    minecraft_version: String,
    forge_version: String,
    data_dir: PathBuf,
) -> Result<PathBuf> {
    // Forge version format: 1.20.1-47.2.0 or just 47.2.0
    let full_version = if forge_version.contains('-') {
        forge_version
    } else {
        format!("{}-{}", minecraft_version, forge_version)
    };

    let installer_filename = format!("forge-{}-installer.jar", full_version);
    let cache_dir = data_dir.join("cache").join("forge_installers");
    tokio::fs::create_dir_all(&cache_dir).await?;

    let installer_path = cache_dir.join(&installer_filename);
    let label = format!("installers/forge/{}", installer_filename);

    // Check cache first
    if installer_path.exists() {
        log::info!("Using cached Forge installer: {:?}", installer_path);
        track_artifact_from_path(label, &installer_path, None, None)
            .await
            .ok();
        return Ok(installer_path);
    }

    // Try restoring from artifact cache
    if try_restore_artifact(&label, &installer_path).await? {
        log::info!("Restored Forge installer from cache: {:?}", installer_path);
        return Ok(installer_path);
    }

    // Download from Forge Maven
    let url = format!(
        "{}net/minecraftforge/forge/{}/{}",
        FORGE_MAVEN_URL, full_version, installer_filename
    );

    log::info!("Downloading Forge installer from: {}", url);

    let response = reqwest::get(&url)
        .await
        .context("Failed to download Forge installer")?;

    if !response.status().is_success() {
        anyhow::bail!(
            "Failed to download Forge installer: HTTP {}",
            response.status()
        );
    }

    let bytes = response.bytes().await?;
    tokio::fs::write(&installer_path, &bytes).await?;
    track_artifact_from_path(label, &installer_path, None, Some(url)).await?;

    log::info!("Downloaded Forge installer to: {:?}", installer_path);
    Ok(installer_path)
}
