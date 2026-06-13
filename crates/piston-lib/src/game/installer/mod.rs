pub mod cache;
pub mod config;
pub mod core;
pub mod modloaders;
pub mod transaction;
pub mod types;
pub mod verifier;

use anyhow::{Context, Result};
use types::{InstallSpec, ModloaderType, ProgressReporter};

use crate::game::installer::core::batch::{BatchArtifact, BatchDownloader};
use crate::game::installer::core::downloader::download_to_path;
use crate::game::installer::core::jre_manager::{get_or_install_jre, JavaVersion};
use crate::game::installer::core::pipeline::process_and_download_libraries;
use cache::{ArtifactCache, InstallArtifactRef};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use verifier::verify_instance_readiness;

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
                let mut artifacts_guard = artifacts.lock().await;
                artifacts_guard.push(InstallArtifactRef::new(label.to_string(), sha));
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Main entry point for game installation.
/// Handles vanilla + modloader installation in a single unified pass.
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
        std::fs::create_dir_all(spec.data_dir())?;
        std::fs::create_dir_all(spec.libraries_dir())?;
        std::fs::create_dir_all(spec.assets_dir())?;
        std::fs::create_dir_all(spec.versions_dir())?;
        std::fs::create_dir_all(spec.jre_dir())?;
        std::fs::create_dir_all(&spec.game_dir)?;

        if spec.modloader.is_some() && spec.modloader != Some(ModloaderType::Vanilla) {
            std::fs::create_dir_all(spec.game_dir.join("mods"))?;
        }
    }

    reporter.start_step("Verifying local runtime artifacts", None);
    let preflight = verify_instance_readiness(&spec)?;
    log::info!(
        "[installer] verify-summary stage=preflight ready={} checked={} missing={} mismatch={}",
        preflight.ready,
        preflight.checked,
        preflight.missing_count(),
        preflight.mismatch_count()
    );
    if !preflight.ready {
        for issue in &preflight.issues {
            log::error!(
                "[installer] verify-issue stage=preflight kind={:?} class={} path={} detail={}",
                issue.kind,
                issue.artifact_class,
                issue.path,
                issue.detail
            );
        }

        // If VerifyOnly, stop here — don't download anything
        if spec.remediation_policy == types::RemediationPolicy::VerifyOnly {
            log::info!(
                "[installer] RemediationPolicy::VerifyOnly — stopping after verification. {} issues found.",
                preflight.issues.len()
            );
            reporter.set_message(&format!(
                "Verification complete: {} issues found",
                preflight.issues.len()
            ));
            reporter.set_percent(100);
            reporter.done(true, Some("Verification complete"));
            return Ok(());
        }
    } else if !spec.dry_run {
        reporter.set_message("Runtime already valid. Skipping repair downloads.");
        reporter.set_percent(100);
        reporter.done(true, Some("Installation verification complete"));
        return Ok(());
    }

    // ------------------------------------------------------------------
    // Phase 1: Load version info + optional modloader profile
    // ------------------------------------------------------------------
    let client = crate::client::shared_client();

    // 1a. Fetch / use cached version info
    reporter.start_step("Loading version metadata", None);
    reporter.set_percent(5);

    let version_json_path = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.json", spec.version_id));
    let version_json_label = format!("versions/{}/{}.json", spec.version_id, spec.version_id);

    if !version_json_path.exists()
        && try_restore_artifact(&version_json_label, &version_json_path).await?
    {
        log::info!("Restored cached version metadata for {}", spec.version_id);
    }

    if !version_json_path.exists() {
        if spec.dry_run {
            log::info!(
                "[Dry-Run] Would download version metadata for {}",
                spec.version_id
            );
            reporter.set_percent(100);
            reporter.done(true, Some("[Dry-Run] Installation plan validated"));
            return Ok(());
        }

        tokio::fs::create_dir_all(version_json_path.parent().unwrap()).await?;

        let version_url = format!(
            "https://launcher-meta.modrinth.com/minecraft/v0/versions/{}.json",
            spec.version_id
        );
        download_to_path(&client, &version_url, &version_json_path, None, &*reporter)
            .await
            .with_context(|| format!("Failed to download version info for {}", spec.version_id))?;

        track_artifact_from_path(
            version_json_label.clone(),
            &version_json_path,
            None,
            Some(version_url),
        )
        .await?;
    }

    let version_json_bytes = tokio::fs::read_to_string(&version_json_path).await?;
    let version_info: serde_json::Value = serde_json::from_str(&version_json_bytes)?;
    let manifest_cache =
        crate::game::manifest_cache::ManifestCache::new(spec.data_dir().join("manifests"));
    if let Err(e) = manifest_cache
        .cache_java_requirement_from_version_detail(&spec.version_id, version_info.clone())
        .await
    {
        log::warn!(
            "Failed to cache Java requirement for {} from version detail: {}",
            spec.version_id,
            e
        );
    }

    // 1b. If modloader, resolve version and fetch profile
    let loader_profile =
        if spec.modloader.is_some() && spec.modloader != Some(ModloaderType::Vanilla) {
            Some(
                crate::game::installer::modloaders::resolve_loader_profile(
                    &spec,
                    reporter.clone(),
                    &client,
                )
                .await?,
            )
        } else {
            None
        };

    // ------------------------------------------------------------------
    // Phase 2: Download client jar + assets
    // ------------------------------------------------------------------
    reporter.start_step("Downloading game client", None);
    reporter.set_percent(15);

    let installed_id = spec.installed_version_id();
    let client_jar_path = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.jar", installed_id));

    if !client_jar_path.exists() {
        if let Some(client_url) = version_info
            .get("downloads")
            .and_then(|d| d.get("client"))
            .and_then(|c| c.get("url"))
            .and_then(|u| u.as_str())
        {
            let client_sha1 = version_info
                .get("downloads")
                .and_then(|d| d.get("client"))
                .and_then(|c| c.get("sha1"))
                .and_then(|s| s.as_str());

            download_to_path(
                &client,
                client_url,
                &client_jar_path,
                client_sha1,
                &*reporter,
            )
            .await?;
        }
    }

    // 2b. Download asset index
    reporter.start_step("Downloading asset index", None);
    reporter.set_percent(20);

    if let Some(asset_index) = version_info.get("assetIndex") {
        let asset_index_id = asset_index
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("legacy");
        let asset_index_path = spec
            .assets_dir()
            .join("indexes")
            .join(format!("{}.json", asset_index_id));
        let asset_index_label = format!("assets/indexes/{}.json", asset_index_id);

        if !asset_index_path.exists()
            && try_restore_artifact(&asset_index_label, &asset_index_path).await?
        {
            log::info!("Restored asset index from cache");
        }

        if !asset_index_path.exists() {
            if let Some(url) = asset_index.get("url").and_then(|u| u.as_str()) {
                let sha1 = asset_index.get("sha1").and_then(|s| s.as_str());
                download_to_path(&client, url, &asset_index_path, sha1, &*reporter).await?;
                track_artifact_from_path(
                    asset_index_label,
                    &asset_index_path,
                    None,
                    Some(url.to_string()),
                )
                .await?;
            }
        }

        // 2c. Download assets
        reporter.start_step("Downloading assets", None);
        reporter.set_percent(30);

        let asset_index_path = asset_index_path.clone();
        let asset_index_content =
            tokio::task::spawn_blocking(move || std::fs::read_to_string(&asset_index_path))
                .await
                .context("spawn_blocking panicked")??;
        let asset_index_parsed: serde_json::Value = serde_json::from_str(&asset_index_content)?;

        if let Some(objects) = asset_index_parsed
            .get("objects")
            .and_then(|o| o.as_object())
        {
            let mut assets_to_download = Vec::new();

            for (asset_name, asset_obj) in objects {
                let hash = asset_obj
                    .get("hash")
                    .and_then(|h| h.as_str())
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "Asset '{}' in index is missing its hash \
                             — asset index may be corrupt",
                            asset_name
                        )
                    })?;
                let hash_prefix = hash.get(..2).ok_or_else(|| {
                    anyhow::anyhow!(
                        "Asset '{}' in index has a hash shorter than 2 characters",
                        asset_name
                    )
                })?;
                let asset_url = format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    hash_prefix, hash
                );
                let asset_path = spec
                    .assets_dir()
                    .join("objects")
                    .join(hash_prefix)
                    .join(hash);

                if !asset_path.exists() {
                    assets_to_download.push(BatchArtifact {
                        name: asset_name.clone(),
                        urls: vec![asset_url],
                        path: asset_path,
                        sha1: Some(hash.to_string()),
                        label: format!("assets/objects/{}/{}", hash_prefix, hash),
                    });
                }
            }

            if !assets_to_download.is_empty() {
                let batch = BatchDownloader::new(client.clone(), spec.concurrency);
                batch
                    .download_all(assets_to_download, reporter.clone(), 30, 10.0)
                    .await?;
            }
        }
    }

    // ------------------------------------------------------------------
    // Phase 3: Unified library download + native extraction
    // ------------------------------------------------------------------
    reporter.start_step("Downloading libraries", None);
    reporter.set_percent(40);

    // Parse vanilla manifest from the already-loaded JSON
    let vanilla_manifest: crate::game::launcher::version_parser::VersionManifest =
        serde_json::from_value(version_info.clone())?;

    // Convert loader profile to VersionManifest if present
    // (borrow the profile so we can still use it for processors later)
    let loader_manifest = loader_profile
        .as_ref()
        .map(|p| crate::game::installer::modloaders::profile_to_version_manifest(p, &spec));

    let unified = process_and_download_libraries(
        &spec,
        vanilla_manifest,
        loader_manifest,
        client.clone(),
        reporter.clone(),
    )
    .await?;

    // ------------------------------------------------------------------
    // Phase 4: Run Forge/NeoForge processors
    // ------------------------------------------------------------------
    if let Some(ref profile) = loader_profile {
        if let Some(processors) = &profile.processors {
            if !processors.is_empty() {
                if let Some(data) = &profile.data {
                    reporter.start_step("Running forge processors", None);
                    reporter.set_percent(90);

                    crate::game::installer::modloaders::execute_loader_processors(
                        &spec,
                        reporter.clone(),
                        processors,
                        data,
                        &client,
                    )
                    .await?;
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Phase 5: Setup JRE
    // ------------------------------------------------------------------
    reporter.start_step("Setting up Java runtime", None);
    reporter.set_percent(95);

    let java_requirement = crate::game::java_policy::java_requirement_from_version_detail_value(
        &spec.version_id,
        version_info.clone(),
    )
    .with_context(|| {
        format!(
            "Failed to resolve Java requirement from version detail for {}",
            spec.version_id
        )
    })?;
    let java_ver = JavaVersion::new(java_requirement.major_version);

    if spec.java_path.is_none() {
        get_or_install_jre(&spec.jre_dir(), &java_ver, client, &*reporter).await?;
    }

    // ------------------------------------------------------------------
    // Phase 6: Save unified manifest + finalize
    // ------------------------------------------------------------------
    if !spec.dry_run {
        // Only save the UnifiedManifest for modloader installs where the
        // installed version ID differs from the base Minecraft version.
        // For vanilla installs, the raw Modrinth version JSON must remain
        // at its original path so that subsequent modloader installs can
        // read it as a `VersionManifest` (which has `downloads.artifact.url`).
        if installed_id != spec.version_id {
            reporter.start_step("Finalizing installation", None);
            reporter.set_percent(98);

            let installed_dir = spec.versions_dir().join(&installed_id);
            tokio::fs::create_dir_all(&installed_dir).await?;
            let version_json_path = installed_dir.join(format!("{}.json", installed_id));
            let unified_for_save = unified.clone();
            tokio::task::spawn_blocking(move || unified_for_save.save_to_path(&version_json_path))
                .await??;
        }
    }

    reporter.set_percent(100);
    reporter.done(true, Some("Installation complete"));
    log::info!("Installation completed successfully: {}", spec.version_id);

    Ok(())
}

/// Verify that an instance's runtime artifacts are present and valid.
pub fn verify_instance(spec: &InstallSpec) -> Result<types::VerificationResult> {
    verify_instance_readiness(spec)
}
