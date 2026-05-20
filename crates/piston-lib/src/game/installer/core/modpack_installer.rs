use crate::game::installer::core::batch::{BatchArtifact, BatchDownloader};
use crate::game::installer::install_instance;
use crate::game::installer::types::{
    InstallSpec, ModloaderType as InstallerModloaderType, ProgressReporter,
};
use crate::game::modpack::manifest::ModSource;
use crate::game::modpack::manifest::ModpackManifest;
use crate::game::modpack::parser::{extract_overrides_with_config_policy, get_modpack_metadata};
use crate::game::modpack::types::ModpackMod;
use anyhow::{Context, Result};
use futures::stream::{self, StreamExt};
use std::path::Path;
use std::sync::Arc;

pub struct ModpackResolvedCF {
    pub url: String,
    pub filename: String,
    pub subfolder: String,
    pub sha1: Option<String>,
}

pub trait ModpackResolver: Send + Sync {
    /// Resolve a CurseForge mod to a download URL and filename
    fn resolve_curseforge(
        &self,
        project_id: Option<u32>,
        file_id: u32,
        hash: Option<String>,
    ) -> futures::future::BoxFuture<'static, Result<ModpackResolvedCF>>;
}

/// Installer for local ZIP modpacks
pub struct ModpackInstaller;

impl ModpackInstaller {
    /// Install a modpack from a local ZIP file.
    pub async fn install_from_zip(
        zip_path: &Path,
        game_dir: &Path,
        data_dir: &Path,
        reporter: Arc<dyn ProgressReporter>,
        resolver: Option<Arc<dyn ModpackResolver>>,
        java_path: Option<std::path::PathBuf>,
    ) -> Result<(
        crate::game::modpack::types::ModpackMetadata,
        Vec<std::path::PathBuf>,
    )> {
        Self::install_from_zip_with_metadata(
            zip_path, None, game_dir, data_dir, reporter, resolver, java_path,
        )
        .await
    }

    pub async fn install_from_zip_with_metadata(
        zip_path: &Path,
        metadata: Option<crate::game::modpack::types::ModpackMetadata>,
        game_dir: &Path,
        data_dir: &Path,
        reporter: Arc<dyn ProgressReporter>,
        resolver: Option<Arc<dyn ModpackResolver>>,
        java_path: Option<std::path::PathBuf>,
    ) -> Result<(
        crate::game::modpack::types::ModpackMetadata,
        Vec<std::path::PathBuf>,
    )> {
        log::info!("Installing modpack from ZIP: {:?}", zip_path);

        // Step 1: Parse metadata
        let metadata = if let Some(meta) = metadata {
            log::info!("Using pre-interpreted modpack metadata for {}", meta.name);
            meta
        } else {
            reporter.start_step("Analyzing modpack ZIP", Some(100));
            get_modpack_metadata(zip_path).context("Failed to parse modpack metadata from ZIP")?
        };

        log::info!(
            "Installing modpack: {} v{}",
            metadata.name,
            metadata.version
        );
        reporter.set_message(&format!("Preparing to install {}...", metadata.name));

        // Step 2: Prepare InstallSpec
        let modloader = match metadata.modloader_type.to_lowercase().as_str() {
            "fabric" => Some(InstallerModloaderType::Fabric),
            "quilt" => Some(InstallerModloaderType::Quilt),
            "forge" => Some(InstallerModloaderType::Forge),
            "neoforge" => Some(InstallerModloaderType::NeoForge),
            _ => None,
        };

        let mut spec = InstallSpec::new(
            metadata.minecraft_version.clone(),
            data_dir.to_path_buf(),
            game_dir.to_path_buf(),
        );
        spec.modloader = modloader;
        spec.modloader_version = metadata.modloader_version.clone();
        spec.dry_run = reporter.is_dry_run();
        spec.java_path = java_path;
        let force_overwrite_configs = spec.force_overwrite_configs;

        // Step 3: Install base Minecraft + Modloader
        log::info!(
            "[ModpackInstaller] Installing base engine: MC {}, Loader {:?}, Version {:?}",
            metadata.minecraft_version,
            spec.modloader,
            spec.modloader_version
        );
        install_instance(spec, reporter.clone()).await?;

        // Step 4: Extract overrides with config preservation
        reporter.start_step("Extracting modpack files", None);
        log::info!(
            "[ModpackInstaller] Extracting overrides with prefix: {:?}",
            metadata.root_prefix
        );
        let mut override_files = Vec::new();
        let mut skipped_configs: Vec<String> = Vec::new();
        if !reporter.is_dry_run() {
            let (extracted, skipped) = extract_overrides_with_config_policy(
                zip_path,
                game_dir,
                metadata.format,
                metadata.root_prefix.clone(),
                force_overwrite_configs,
            )
            .context("Failed to extract modpack overrides")?;
            override_files = extracted;
            skipped_configs = skipped;
            if !skipped_configs.is_empty() {
                log::info!(
                    "[ModpackInstaller] Preserved {} config files from override",
                    skipped_configs.len()
                );
            }
        }

        // Step 5: Download additional mods
        if !metadata.mods.is_empty() {
            reporter.start_step(
                "Downloading modpack resources",
                Some(metadata.mods.len() as u32),
            );
            let downloader = BatchDownloader::new(crate::client::shared_client().clone(), 8);

            let mut artifacts = Vec::new();
            let mut curseforge_jobs: Vec<(Option<u32>, u32, Option<String>)> = Vec::new();
            for mod_entry in &metadata.mods {
                match mod_entry {
                    ModpackMod::Modrinth {
                        ref path,
                        urls,
                        ref hashes,
                        size: _,
                    } => {
                        if !urls.is_empty() {
                            let sha1 = hashes.get("sha1").cloned();
                            let target_path = game_dir.join(path.replace("\\", "/"));
                            artifacts.push(BatchArtifact {
                                name: target_path
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("unknown")
                                    .to_string(),
                                label: format!("mod-modrinth-{}", urls[0]),
                                urls: urls.clone(),
                                path: target_path,
                                sha1,
                            });
                        }
                    }
                    ModpackMod::CurseForge {
                        ref project_id,
                        file_id,
                        required: _,
                        ref hash,
                    } => {
                        curseforge_jobs.push((*project_id, *file_id, hash.clone()));
                    }
                }
            }

            if !curseforge_jobs.is_empty() {
                if let Some(resolver) = &resolver {
                    let resolved = stream::iter(curseforge_jobs.into_iter())
                        .map(|(project_id, file_id, hash)| {
                            let resolver = resolver.clone();
                            async move {
                                let result =
                                    resolver.resolve_curseforge(project_id, file_id, hash).await;
                                (project_id, file_id, result)
                            }
                        })
                        .buffer_unordered(12)
                        .collect::<Vec<_>>()
                        .await;

                    for (project_id, file_id, result) in resolved {
                        match result {
                            Ok(resolved) => {
                                let target_path =
                                    game_dir.join(&resolved.subfolder).join(&resolved.filename);
                                let pid_str = project_id
                                    .map(|id| id.to_string())
                                    .unwrap_or_else(|| "unknown".to_string());
                                artifacts.push(BatchArtifact {
                                    name: target_path
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("unknown")
                                        .to_string(),
                                    label: format!("mod-cf-{}-{}", pid_str, file_id),
                                    urls: vec![resolved.url],
                                    path: target_path,
                                    sha1: resolved.sha1,
                                });
                            }
                            Err(e) => {
                                log::error!(
                                    "Failed to resolve CurseForge mod {:?} {}: {}",
                                    project_id,
                                    file_id,
                                    e
                                );
                            }
                        }
                    }
                } else {
                    log::warn!(
                        "Skipping {} CurseForge mods - no resolver provided",
                        curseforge_jobs.len()
                    );
                }
            }

            // Collect CurseForge artifact metadata before passing to download_all
            // (artifacts is moved into download_all, so we extract what we need first)
            let cf_resolved: Vec<(String, String, Option<String>, Option<String>)> = artifacts
                .iter()
                .filter(|a| a.label.starts_with("mod-cf-"))
                .map(|a| {
                    let relative_path = a
                        .path
                        .strip_prefix(game_dir)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default();
                    (
                        a.label.clone(),
                        relative_path,
                        a.sha1.clone(),
                        a.urls.first().cloned(),
                    )
                })
                .collect();

            if !artifacts.is_empty() {
                downloader
                    .download_all(artifacts, reporter.clone(), 0, 1.0)
                    .await?;
            }

            // Step 6: Persist modpack manifest for future repair
            if !reporter.is_dry_run() {
                let mut manifest = ModpackManifest::from_install(
                    &metadata,
                    &override_files,
                    &skipped_configs,
                    Some(zip_path.to_path_buf()),
                    None,
                );

                // Update CurseForge manifest entries with resolved data + file size from disk
                for (label, relative_path, sha1, download_url) in &cf_resolved {
                    for mod_entry in &mut manifest.mods {
                        if let ModSource::CurseForge {
                            project_id,
                            file_id,
                            ref mut url,
                        } = &mut mod_entry.source
                        {
                            let pid_str = project_id
                                .map(|id| id.to_string())
                                .unwrap_or_else(|| "unknown".to_string());
                            let expected_label = format!("mod-cf-{}-{}", pid_str, file_id);
                            if label == &expected_label {
                                mod_entry.path = relative_path.clone();
                                mod_entry.sha1 = sha1.clone();
                                *url = download_url.clone().unwrap_or_default();
                                // Grab file size from disk after download
                                mod_entry.size = std::fs::metadata(game_dir.join(relative_path))
                                    .ok()
                                    .map(|m| m.len());
                                break;
                            }
                        }
                    }
                }

                if let Err(e) = manifest.persist(game_dir) {
                    log::warn!(
                        "[ModpackInstaller] Failed to persist modpack manifest: {}",
                        e
                    );
                }
            }
        }

        reporter.done(true, Some("Modpack installation complete"));
        Ok((metadata, override_files))
    }

    /// Verify modpack completeness against the persisted manifest.
    pub fn verify_modpack_completeness(
        game_dir: &Path,
    ) -> Result<Vec<crate::game::installer::types::VerificationIssue>> {
        let manifest_path = game_dir.join(ModpackManifest::FILE_NAME);
        if !manifest_path.exists() {
            return Ok(vec![]);
        }

        let manifest =
            ModpackManifest::load(game_dir).context("Failed to load modpack manifest")?;
        let diff = manifest.diff(game_dir);

        let mut issues = Vec::new();
        for m in &diff.resources_to_fix {
            issues.push(crate::game::installer::types::VerificationIssue {
                kind: crate::game::installer::types::VerificationIssueKind::Missing,
                artifact_class: "modpack-resource".to_string(),
                path: game_dir.join(&m.path).to_string_lossy().to_string(),
                detail: format!("Modpack resource missing or hash mismatch: {}", m.path),
            });
        }
        for ov in &diff.overrides_to_fix {
            issues.push(crate::game::installer::types::VerificationIssue {
                kind: crate::game::installer::types::VerificationIssueKind::Missing,
                artifact_class: "modpack-override".to_string(),
                path: game_dir.join(ov).to_string_lossy().to_string(),
                detail: format!("Modpack override file missing: {}", ov),
            });
        }
        if !diff.configs_would_overwrite.is_empty() {
            log::info!(
                "[ModpackInstaller] {} config files would be overwritten (preserved)",
                diff.configs_would_overwrite.len()
            );
        }
        Ok(issues)
    }

    /// Repair a modpack instance by re-extracting missing files from the ZIP
    /// and re-downloading missing mods from their original sources.
    pub async fn repair_modpack(
        game_dir: &Path,
        force_overwrite_configs: bool,
        reporter: Arc<dyn ProgressReporter>,
        resolver: Option<Arc<dyn ModpackResolver>>,
    ) -> Result<ModpackManifest> {
        let mut manifest = ModpackManifest::load(game_dir)
            .context("Failed to load modpack manifest for repair")?;

        let zip_path = manifest.source_zip_path.as_ref().ok_or_else(|| {
            anyhow::anyhow!("Cannot repair modpack: original ZIP path not available in manifest")
        })?;

        if !zip_path.exists() {
            return Err(anyhow::anyhow!(
                "Cannot repair modpack: original ZIP file no longer exists at {:?}",
                zip_path
            ));
        }

        let diff = manifest.diff(game_dir);
        if diff.resources_to_fix.is_empty() && diff.overrides_to_fix.is_empty() {
            reporter.set_message("Modpack files are already up to date");
            return Ok(manifest);
        }

        // Step A: Re-extract overrides from ZIP for missing override files
        if !diff.overrides_to_fix.is_empty() {
            reporter.start_step("Re-extracting modpack overrides", None);
            let (_extracted, skipped_configs) = extract_overrides_with_config_policy(
                zip_path,
                game_dir,
                manifest.source,
                None,
                force_overwrite_configs,
            )
            .context("Failed to re-extract modpack overrides during repair")?;

            if !skipped_configs.is_empty() {
                log::info!(
                    "[ModpackInstaller::repair] Preserved {} config files",
                    skipped_configs.len()
                );
            }
        }

        // Step B: Re-download missing/corrupt resources from their sources
        if !diff.resources_to_fix.is_empty() {
            reporter.start_step(
                "Downloading missing resources",
                Some(diff.resources_to_fix.len() as u32),
            );

            let downloader = BatchDownloader::new(crate::client::shared_client().clone(), 8);
            let mut artifacts = Vec::new();
            let mut curseforge_jobs: Vec<(Option<u32>, u32, Option<String>)> = Vec::new();

            for m in &diff.resources_to_fix {
                match &m.source {
                    crate::game::modpack::manifest::ModSource::Modrinth { url, .. } => {
                        if !url.is_empty() {
                            let target_path = game_dir.join(&m.path);
                            artifacts.push(BatchArtifact {
                                name: m.path.clone(),
                                label: format!("repair-modrinth-{}", m.path),
                                urls: vec![url.clone()],
                                path: target_path,
                                sha1: m.sha1.clone(),
                            });
                        }
                    }
                    crate::game::modpack::manifest::ModSource::CurseForge {
                        project_id,
                        file_id,
                        ..
                    } => {
                        curseforge_jobs.push((*project_id, *file_id, m.sha1.clone()));
                    }
                }
            }

            // Resolve CurseForge mods via the resolver
            if !curseforge_jobs.is_empty() {
                if let Some(resolver) = &resolver {
                    let resolved = stream::iter(curseforge_jobs.into_iter())
                        .map(|(project_id, file_id, hash)| {
                            let resolver = resolver.clone();
                            async move {
                                let result =
                                    resolver.resolve_curseforge(project_id, file_id, hash).await;
                                (project_id, file_id, result)
                            }
                        })
                        .buffer_unordered(12)
                        .collect::<Vec<_>>()
                        .await;

                    for (project_id, file_id, result) in resolved {
                        match result {
                            Ok(resolved_cf) => {
                                let target_path = game_dir
                                    .join(&resolved_cf.subfolder)
                                    .join(&resolved_cf.filename);
                                let pid_str = project_id
                                    .map(|id| id.to_string())
                                    .unwrap_or_else(|| "unknown".to_string());
                                artifacts.push(BatchArtifact {
                                    name: resolved_cf.filename.clone(),
                                    label: format!("repair-cf-{}-{}", pid_str, file_id),
                                    urls: vec![resolved_cf.url],
                                    path: target_path,
                                    sha1: resolved_cf.sha1,
                                });
                            }
                            Err(e) => {
                                log::error!(
                                    "[ModpackInstaller::repair] Failed to resolve CF mod {:?}/{}: {}",
                                    project_id,
                                    file_id,
                                    e
                                );
                            }
                        }
                    }
                } else {
                    log::warn!(
                        "[ModpackInstaller::repair] {} CurseForge mods need re-download but no resolver provided",
                        curseforge_jobs.len()
                    );
                }
            }

            // Collect CurseForge artifact metadata before passing to download_all
            let cf_repaired: Vec<(String, String, Option<String>, Option<String>)> = artifacts
                .iter()
                .filter(|a| a.label.starts_with("repair-cf-"))
                .map(|a| {
                    let relative_path = a
                        .path
                        .strip_prefix(game_dir)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default();
                    (
                        a.label.clone(),
                        relative_path,
                        a.sha1.clone(),
                        a.urls.first().cloned(),
                    )
                })
                .collect();

            if !artifacts.is_empty() {
                downloader
                    .download_all(artifacts, reporter.clone(), 0, 1.0)
                    .await?;
            }

            // Update CurseForge manifest entries with resolved filenames, SHA1s, and URLs
            for (label, relative_path, sha1, download_url) in &cf_repaired {
                // Labels are "repair-cf-{pid}-{fid}" — extract pid and fid
                let label_body = label.strip_prefix("repair-cf-").unwrap_or(label);
                for mod_entry in &mut manifest.mods {
                    if let ModSource::CurseForge {
                        project_id,
                        file_id,
                        ref mut url,
                    } = &mut mod_entry.source
                    {
                        let pid_str = project_id
                            .map(|id| id.to_string())
                            .unwrap_or_else(|| "unknown".to_string());
                        let expected = format!("{}-{}", pid_str, file_id);
                        if label_body == expected {
                            mod_entry.path = relative_path.clone();
                            mod_entry.sha1 = sha1.clone();
                            *url = download_url.clone().unwrap_or_default();
                            mod_entry.size = std::fs::metadata(game_dir.join(relative_path))
                                .ok()
                                .map(|m| m.len());
                            break;
                        }
                    }
                }
            }
        }

        // Persist the updated manifest so resolved CurseForge data is saved
        if let Err(e) = manifest.persist(game_dir) {
            log::warn!(
                "[ModpackInstaller::repair] Failed to persist modpack manifest: {}",
                e
            );
        }
        reporter.done(true, Some("Modpack repair complete"));
        Ok(manifest)
    }
}
