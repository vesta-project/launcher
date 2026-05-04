use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::Value;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
use helpers::{extract_stringish, resolve_ftb_instances_root, split_modloader_and_version};

pub struct FTBProvider;

impl ExternalLauncherProvider for FTBProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::Ftb
    }

    fn display_name(&self) -> &'static str {
        "FTB"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::Ftb)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let mut instances = Vec::new();
        if !base_path.exists() {
            return Ok(instances);
        }

        let instances_root = resolve_ftb_instances_root(base_path);
        if !instances_root.exists() || !instances_root.is_dir() {
            return Ok(instances);
        }

        for entry in std::fs::read_dir(instances_root)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let instance_json = path.join("instance.json");
            if !instance_json.is_file() {
                continue;
            }
            let parsed_json = std::fs::read_to_string(&instance_json)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

            let id = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("instance")
                .to_string();
            let name = parsed_json
                .as_ref()
                .and_then(|json| extract_stringish(json, &["name", "displayName", "display_name"]))
                .unwrap_or_else(|| id.clone());
            let minecraft_version = parsed_json
                .as_ref()
                .and_then(|json| extract_stringish(json, &["minecraftVersion", "minecraft_version", "mcVersion"]));
            let modloader = parsed_json
                .as_ref()
                .and_then(|json| extract_stringish(json, &["modloader", "modLoader", "loader"]));
            let parsed_modloader_version = parsed_json
                .as_ref()
                .and_then(|json| extract_stringish(json, &["modloaderVersion", "modloader_version", "loaderVersion"]));
            let (modloader, modloader_version) =
                split_modloader_and_version(modloader, parsed_modloader_version);

            instances.push(ExternalInstanceCandidate {
                id: id.clone(),
                name,
                instance_path: path.to_string_lossy().to_string(),
                game_directory: path.to_string_lossy().to_string(),
                icon_path: None,
                minecraft_version,
                modloader,
                modloader_version,
                modpack_platform: None,
                modpack_id: None,
                modpack_version_id: None,
                ..Default::default()
            });
        }

        Ok(instances)
    }
}
