use super::fabric;
use crate::game::installer::config::{QUILT_MAVEN_URL, QUILT_META_URL};
use crate::game::installer::core::traits::ModloaderInstaller;
use crate::game::installer::types::{InstallSpec, ProgressReporter};
use anyhow::Result;
use futures::future::BoxFuture;
use std::sync::Arc;

pub struct QuiltInstaller;

impl ModloaderInstaller for QuiltInstaller {
    fn install<'a>(
        &'a self,
        spec: &'a InstallSpec,
        reporter: Arc<dyn ProgressReporter>,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(install_quilt(spec, reporter))
    }
}

/// Install Quilt modloader
/// Quilt uses the same installation process as Fabric, just with different API endpoints
pub async fn install_quilt(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
) -> Result<()> {
    log::info!(
        "Installing Quilt {} for Minecraft {}",
        spec.modloader_version
            .as_ref()
            .unwrap_or(&"latest".to_string()),
        spec.version_id
    );

    // Quilt installation is identical to Fabric, just with different URLs
    // The fabric module handles the generic loader installation logic
    fabric::install_loader(
        spec,
        reporter.clone(),
        "Quilt",
        "https://meta.quiltmc.org/v3/versions",
        QUILT_META_URL,
        QUILT_MAVEN_URL,
    )
    .await
}
