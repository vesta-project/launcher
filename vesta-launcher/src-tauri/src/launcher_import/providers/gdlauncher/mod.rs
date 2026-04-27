use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod db;
mod helpers;
mod types;

pub use db::extract_gdlauncher_resource_hints;

use helpers::{parse_carbon_instance, resolve_instances_root};
use types::GDLegacyConfig;

pub struct GDLauncherProvider;

impl ExternalLauncherProvider for GDLauncherProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::GDLauncher
    }

    fn display_name(&self) -> &'static str {
        "GDLauncher"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::GDLauncher)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let mut instances = Vec::new();
        if !base_path.exists() {
            return Ok(instances);
        }

        let instances_root = resolve_instances_root(base_path);
        if !instances_root.exists() || !instances_root.is_dir() {
            return Ok(instances);
        }

        for entry in std::fs::read_dir(instances_root)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            // Carbon layout first: instance.json + instance/ payload.
            let carbon_cfg = path.join("instance.json");
            if carbon_cfg.exists() {
                let raw = std::fs::read_to_string(&carbon_cfg)?;
                if let Ok(parsed) = serde_json::from_str::<types::GDCarbonInstance>(&raw) {
                    let candidate = parse_carbon_instance(&path, parsed);
                    instances.push(candidate);
                    continue;
                }
            }

            // Legacy fallback layout: config.json in root.
            let legacy_cfg = path.join("config.json");
            if !legacy_cfg.exists() {
                continue;
            }

            let raw = std::fs::read_to_string(&legacy_cfg)?;
            let parsed: GDLegacyConfig = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let id = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("instance")
                .to_string();

            instances.push(ExternalInstanceCandidate {
                id: id.clone(),
                name: id.clone(),
                instance_path: path.to_string_lossy().to_string(),
                game_directory: path.to_string_lossy().to_string(),
                icon_path: None,
                minecraft_version: Some(parsed.loader.mc_version),
                modloader: Some(parsed.loader.loader_type),
                modloader_version: parsed.loader.loader_version,
                modpack_platform: None,
                modpack_id: None,
                modpack_version_id: None,
                ..Default::default()
            });
        }

        Ok(instances)
    }
}
