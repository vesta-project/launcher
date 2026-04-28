use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
mod types;

pub use helpers::extract_atlauncher_resource_hints;

use helpers::{encode_png_as_data_url, extract_instance_link};
use types::{ATInstance, ATLauncherSourceLink};

pub struct ATLauncherProvider;

impl ExternalLauncherProvider for ATLauncherProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::ATLauncher
    }

    fn display_name(&self) -> &'static str {
        "ATLauncher"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::ATLauncher)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let mut instances = Vec::new();
        if !base_path.exists() {
            log::warn!("[ATLauncher] base_path does not exist: {}", base_path.display());
            return Ok(instances);
        }

        log::debug!("[ATLauncher] scanning instances at: {}", base_path.display());

        for entry in std::fs::read_dir(base_path)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let instance_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown");

            let cfg_path = path.join("instance.json");
            if !cfg_path.exists() {
                log::debug!("[ATLauncher] instance.json not found for: {}", instance_name);
                continue;
            }

            let raw = std::fs::read_to_string(&cfg_path)?;
            let parsed: ATInstance = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!(
                        "[ATLauncher] failed to parse instance.json for '{}': {}",
                        instance_name,
                        e
                    );
                    continue;
                }
            };

            let icon_path = encode_png_as_data_url(&path.join("instance.png"));
            let source_link = extract_instance_link(&parsed);
            
            if let Some(ref link) = source_link {
                log::debug!(
                    "[ATLauncher] found source link for '{}': {:?}",
                    instance_name,
                    match link {
                        ATLauncherSourceLink::Modrinth { project_id, .. } => format!("modrinth/{}", project_id),
                        ATLauncherSourceLink::Curseforge { project_id, .. } => format!("curseforge/{}", project_id),
                    }
                );
            } else {
                log::debug!(
                    "[ATLauncher] no supported source link found for '{}'",
                    instance_name
                );
            }

            let (modpack_platform, modpack_id, modpack_version_id) = match source_link {
                Some(ATLauncherSourceLink::Modrinth {
                    project_id,
                    version_id,
                }) => (Some("modrinth".to_string()), Some(project_id), Some(version_id)),
                Some(ATLauncherSourceLink::Curseforge {
                    project_id,
                    version_id,
                }) => (Some("curseforge".to_string()), Some(project_id), Some(version_id)),
                None => (None, None, None),
            };
            let loader_version = parsed.launcher.loader_version;

            instances.push(ExternalInstanceCandidate {
                id: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("instance")
                    .to_string(),
                name: parsed.launcher.name,
                instance_path: path.to_string_lossy().to_string(),
                game_directory: path.to_string_lossy().to_string(),
                icon_path,
                minecraft_version: Some(parsed.id),
                modloader: loader_version.as_ref().map(|l| l.r#type.clone()),
                modloader_version: loader_version.map(|l| l.version),
                modpack_platform,
                modpack_id,
                modpack_version_id,
                ..Default::default()
            });
        }

        Ok(instances)
    }
}
