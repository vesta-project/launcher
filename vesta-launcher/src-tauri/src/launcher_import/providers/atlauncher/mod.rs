use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
mod types;

pub use helpers::extract_atlauncher_resource_hints;

use helpers::encode_png_as_data_url;
use types::ATInstance;

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
            return Ok(instances);
        }

        for entry in std::fs::read_dir(base_path)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let cfg_path = path.join("instance.json");
            if !cfg_path.exists() {
                continue;
            }

            let raw = std::fs::read_to_string(&cfg_path)?;
            let parsed: ATInstance = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let icon_path = encode_png_as_data_url(&path.join("instance.png"));

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
                modloader: parsed.launcher.loader_version.as_ref().map(|l| l.r#type.clone()),
                modloader_version: parsed.launcher.loader_version.map(|l| l.version),
                modpack_platform: Some("modrinth".to_string()),
                modpack_id: parsed.launcher.modrinth_project.map(|p| p.id),
                modpack_version_id: parsed.launcher.modrinth_version.map(|v| v.id),
                ..Default::default()
            });
        }

        Ok(instances)
    }
}
