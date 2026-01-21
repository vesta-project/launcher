use crate::game::installer::core::batch::{BatchArtifact, BatchDownloader};
use crate::game::installer::types::{InstallSpec, ProgressReporter, ModloaderType as InstallerModloaderType};
use crate::game::installer::install_instance;
use crate::game::modpack::parser::{extract_overrides, get_modpack_metadata};
use crate::game::modpack::types::ModpackMod;
use anyhow::{Context, Result};
use reqwest::Client;
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
        hash: Option<String>
    ) -> futures::future::BoxFuture<'static, Result<ModpackResolvedCF>>;
}

/// Installer for local ZIP modpacks
pub struct ModpackInstaller;

impl ModpackInstaller {
    /// Install a modpack from a local ZIP file.
    /// This will:
    /// 1. Parse metadata from the ZIP
    /// 2. Install the base Minecraft engine and modloader
    /// 3. Extract overrides from the ZIP
    /// 4. Download additional mods (if Modrinth or CurseForge)
    pub async fn install_from_zip(
        zip_path: &Path,
        game_dir: &Path,
        data_dir: &Path,
        reporter: Arc<dyn ProgressReporter>,
        resolver: Option<Arc<dyn ModpackResolver>>,
        java_path: Option<std::path::PathBuf>,
    ) -> Result<(crate::game::modpack::types::ModpackMetadata, Vec<std::path::PathBuf>)> {
        log::info!("Installing modpack from ZIP: {:?}", zip_path);

        // Step 1: Parse metadata
        reporter.start_step("Analyzing modpack ZIP", Some(100));
        let metadata = get_modpack_metadata(zip_path)
            .context("Failed to parse modpack metadata from ZIP")?;
        
        log::info!("Installing modpack: {} v{}", metadata.name, metadata.version);
        reporter.set_message(&format!("Preparing to install {}...", metadata.name));

        // Step 2: Prepare InstallSpec for the base engine
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

        // Step 3: Install base Minecraft + Modloader
        // We wrap this in another reporter or just let it report to the same one.
        // Since install_instance reports its own steps, we might want to manage the overall progress.
        log::info!("[ModpackInstaller] Installing base engine: MC {}, Loader {:?}, Version {:?}", 
            metadata.minecraft_version, spec.modloader, spec.modloader_version);
        install_instance(spec, reporter.clone()).await?;

        // Step 4: Extract overrides
        reporter.start_step("Extracting modpack files", None);
        log::info!("[ModpackInstaller] Extracting overrides with prefix: {:?}", metadata.root_prefix);
        let mut override_files = Vec::new();
        if !reporter.is_dry_run() {
            override_files = extract_overrides(zip_path, game_dir, metadata.format, metadata.root_prefix.clone())
                .context("Failed to extract modpack overrides")?;
        }

        // Step 5: Download additional mods
        if !metadata.mods.is_empty() {
            reporter.start_step("Downloading modpack mods", Some(metadata.mods.len() as u32));
            let client = Client::new();
            let downloader = BatchDownloader::new(client, 8);
            
            let mut artifacts = Vec::new();
            for mod_entry in metadata.mods.clone() {
                match mod_entry {
                    ModpackMod::Modrinth { path, urls, hashes, size: _ } => {
                        if let Some(url) = urls.first() {
                            let sha1 = hashes.get("sha1").cloned();
                            // Path is relative to game_dir
                            let target_path = game_dir.join(path.replace("\\", "/"));
                            
                            artifacts.push(BatchArtifact {
                                name: target_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string(),
                                url: url.clone(),
                                path: target_path,
                                sha1,
                                label: format!("mod-modrinth-{}", url), // Simple label for caching
                            });
                        }
                    }
                    ModpackMod::CurseForge { project_id, file_id, required: _, hash } => {
                        if let Some(resolver) = &resolver {
                            match resolver.resolve_curseforge(project_id, file_id, hash).await {
                                Ok(resolved) => {
                                    let target_path = game_dir.join(&resolved.subfolder).join(&resolved.filename);
                                    let pid_str = project_id.map(|id| id.to_string()).unwrap_or_else(|| "unknown".to_string());
                                    artifacts.push(BatchArtifact {
                                        name: target_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string(),
                                        url: resolved.url,
                                        path: target_path,
                                        sha1: resolved.sha1,
                                        label: format!("mod-cf-{}-{}", pid_str, file_id),
                                    });
                                }
                                Err(e) => {
                                    log::error!("Failed to resolve CurseForge mod {:?} {}: {}", project_id, file_id, e);
                                }
                            }
                        } else {
                            log::warn!("CurseForge mod downloading is not yet implemented (project: {:?}, file: {}) - no resolver", project_id, file_id);
                        }
                    }
                }
            }

            if !artifacts.is_empty() {
                downloader.download_all(artifacts, reporter.clone(), 0, 1.0).await?;
            }
        }

        reporter.done(true, Some("Modpack installation complete"));
        Ok((metadata, override_files))
    }
}
