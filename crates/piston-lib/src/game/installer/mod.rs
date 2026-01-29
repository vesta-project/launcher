pub mod cache;
pub mod config;
pub mod core;
pub mod modloaders;
pub mod transaction;
pub mod types;
pub mod vanilla;

#[cfg(test)]
mod tests;

use anyhow::{Context, Result};
use types::{InstallSpec, ModloaderType, ProgressReporter};

use crate::game::installer::core::traits::ModloaderInstaller;
use crate::game::installer::modloaders::fabric::FabricInstaller;
use crate::game::installer::modloaders::forge::ForgeInstaller;
use crate::game::installer::modloaders::neoforge::NeoForgeInstaller;
use crate::game::installer::modloaders::quilt::QuiltInstaller;
use crate::game::installer::vanilla::VanillaInstaller;
use cache::{ArtifactCache, InstallArtifactRef};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use transaction::InstallTransaction;

tokio::task_local! {
    static INSTALL_SCOPE: InstallScope;
}

struct InstallScope {
    cache: Arc<Mutex<ArtifactCache>>,
    artifacts: Arc<Mutex<Vec<InstallArtifactRef>>>,
    dry_run: bool,
}

pub(crate) fn install_scope_handles() -> Option<(
    Arc<Mutex<ArtifactCache>>,
    Arc<Mutex<Vec<InstallArtifactRef>>>,
    bool,
)> {
    INSTALL_SCOPE
        .try_with(|scope| (scope.cache.clone(), scope.artifacts.clone(), scope.dry_run))
        .ok()
}

pub(crate) async fn track_artifact_from_path(
    label: impl Into<String>,
    path: &Path,
    signature: Option<String>,
    source_url: Option<String>,
) -> Result<()> {
    if let Some((cache, artifacts, dry_run)) = install_scope_handles() {
        if dry_run {
            return Ok(());
        }
        let label_str: String = label.into();
        let sha = {
            let mut cache_guard = cache.lock().await;
            let sha = cache_guard.ingest_file(path, signature, source_url)?;
            cache_guard.set_label(label_str.clone(), sha.clone());
            sha
        };
        let mut refs = artifacts.lock().await;
        refs.push(InstallArtifactRef::new(label_str, sha));
    }
    Ok(())
}

pub(crate) async fn try_restore_artifact(label: &str, destination: &Path) -> Result<bool> {
    if let Some((cache, artifacts, dry_run)) = install_scope_handles() {
        let cache_guard = cache.lock().await;
        if let Some(sha) = cache_guard.find_component(label) {
            if dry_run {
                return Ok(true);
            }

            if cache_guard.restore_artifact(&sha, destination)? {
                // Track it without re-hashing since we know the SHA from the cache
                let mut artifacts_guard = artifacts.lock().await;
                artifacts_guard.push(InstallArtifactRef::new(label.to_string(), sha));
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn get_installer(modloader: Option<ModloaderType>) -> Box<dyn ModloaderInstaller> {
    match modloader {
        None | Some(ModloaderType::Vanilla) => Box::new(VanillaInstaller),
        Some(ModloaderType::Fabric) => Box::new(FabricInstaller),
        Some(ModloaderType::Quilt) => Box::new(QuiltInstaller),
        Some(ModloaderType::Forge) => Box::new(ForgeInstaller),
        Some(ModloaderType::NeoForge) => Box::new(NeoForgeInstaller),
    }
}

/// Main entry point for game installation
/// Dispatches to the appropriate installer based on modloader type
pub async fn install_instance(
    spec: InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
) -> Result<()> {
    log::info!(
        "Starting installation: version={}, modloader={:?} (dry_run={})",
        spec.version_id,
        spec.modloader,
        spec.dry_run
    );

    if !spec.dry_run {
        // Ensure base directories exist
        std::fs::create_dir_all(spec.data_dir())?;
        std::fs::create_dir_all(spec.libraries_dir())?;
        std::fs::create_dir_all(spec.assets_dir())?;
        std::fs::create_dir_all(spec.versions_dir())?;
        std::fs::create_dir_all(spec.jre_dir())?;
        std::fs::create_dir_all(&spec.game_dir)?;

        // Ensure mods directory exists for modded installations
        if spec.modloader.is_some() && spec.modloader != Some(ModloaderType::Vanilla) {
            std::fs::create_dir_all(spec.game_dir.join("mods"))?;
        }
    }

    // Load cache + transaction state
    let cache = Arc::new(Mutex::new(ArtifactCache::load_with_labels(
        spec.data_dir(),
    )?));
    let recorded_artifacts = Arc::new(Mutex::new(Vec::new()));
    let install_id = spec.installed_version_id();
    let loader_label = spec.modloader.map(|m| m.as_str().to_string());
    let txn = if !spec.dry_run {
        let t = InstallTransaction::new(install_id.clone(), spec.data_dir());
        t.begin()?;
        Some(t)
    } else {
        None
    };

    reporter.set_message("Starting installation...");
    reporter.set_percent(0);

    let installer = get_installer(spec.modloader);
    let scope = InstallScope {
        cache: cache.clone(),
        artifacts: recorded_artifacts.clone(),
        dry_run: spec.dry_run,
    };

    let install_result = INSTALL_SCOPE
        .scope(scope, async {
            installer.install(&spec, reporter.clone()).await
        })
        .await;

    if let Err(err) = install_result {
        if let Some(ref t) = txn {
            let _ = t.rollback(&err.to_string());
        }
        reporter.done(false, Some("Installation failed"));
        return Err(err);
    }

    if spec.dry_run {
        reporter.done(true, Some("Dry-run completed successfully"));
        return Ok(());
    }

    let finalize_result = async {
        let mut cache_guard = cache.lock().await;
        let mut artifacts = collect_version_artifacts(&spec, &install_id, &mut cache_guard)?;
        drop(cache_guard);

        {
            let mut recorded = recorded_artifacts.lock().await;
            artifacts.extend(recorded.drain(..));
        }

        let mut cache_guard = cache.lock().await;
        cache_guard.record_install(&install_id, loader_label.clone(), &artifacts);
        cache_guard.prune_unused();
        cache_guard.save()?;
        drop(cache_guard);

        if let Some(ref txn) = txn {
            txn.commit()?;
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;

    if let Err(err) = finalize_result {
        if let Some(ref txn) = txn {
            let _ = txn.rollback(&err.to_string());
        }
        reporter.done(false, Some("Installation failed"));
        return Err(err);
    }

    reporter.done(true, Some("Installation complete"));
    log::info!("Installation completed successfully: {}", spec.version_id);

    Ok(())
}

fn collect_version_artifacts(
    spec: &InstallSpec,
    install_id: &str,
    cache: &mut ArtifactCache,
) -> Result<Vec<InstallArtifactRef>> {
    let mut artifacts = Vec::new();
    let version_dir = spec.versions_dir().join(install_id);
    let jar_name = format!("{}.jar", install_id);
    let jar_path = version_dir.join(&jar_name);
    if jar_path.exists() {
        let sha = cache
            .ingest_file(&jar_path, None, None)
            .with_context(|| format!("Cache version jar {:?}", jar_path))?;
        artifacts.push(InstallArtifactRef::new(
            format!("versions/{}/{}", install_id, jar_name),
            sha,
        ));
    } else {
        log::warn!(
            "Version jar missing after install; skip cache ingestion: {:?}",
            jar_path
        );
    }
    Ok(artifacts)
}
