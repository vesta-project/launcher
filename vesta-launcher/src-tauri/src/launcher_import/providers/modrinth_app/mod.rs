use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod db;
mod helpers;
mod types;

pub use db::extract_modrinth_resource_hints;

use db::{find_app_db, read_instances_from_app_db};
use helpers::{encode_icon_as_data_url, resolve_profile_roots};
use types::ModrinthProfile;

pub struct ModrinthAppProvider;

impl ExternalLauncherProvider for ModrinthAppProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::ModrinthApp
    }

    fn display_name(&self) -> &'static str {
        "Modrinth App"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::ModrinthApp)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let mut instances = Vec::new();
        if !base_path.exists() {
            return Ok(instances);
        }

        // Prefer authoritative launcher metadata from app.db when available.
        if let Some(db_path) = find_app_db(base_path) {
            let db_instances = read_instances_from_app_db(base_path, &db_path);
            if !db_instances.is_empty() {
                return Ok(db_instances);
            }
        }

        for profile_root in resolve_profile_roots(base_path) {
            if !profile_root.exists() || !profile_root.is_dir() {
                continue;
            }

            for entry in std::fs::read_dir(&profile_root)? {
                let entry = entry?;
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let profile_json = path.join("profile.json");
                let profile_toml = path.join("profile.toml");

                let parsed = if profile_json.exists() {
                    let raw = std::fs::read_to_string(&profile_json)?;
                    serde_json::from_str::<ModrinthProfile>(&raw).ok()
                } else if profile_toml.exists() {
                    // Keep parsing lightweight; avoid introducing new toml dependencies in this pass.
                    None
                } else {
                    None
                };

                // Ignore non-profile directories when scanning launcher roots.
                // Modrinth can store metadata in app.db while profile folders under
                // `.../profiles/*` are plain instance directories without profile.json.
                let is_profiles_root = profile_root
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case("profiles"))
                    .unwrap_or(false);
                if !profile_json.exists() && !profile_toml.exists() && !is_profiles_root {
                    continue;
                }

                let id = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("profile")
                    .to_string();

                let name = parsed
                    .as_ref()
                    .and_then(|p| p.name.clone())
                    .unwrap_or_else(|| id.clone());

                let game_dir = if path.join(".minecraft").is_dir() {
                    path.join(".minecraft")
                } else if path.join("minecraft").is_dir() {
                    path.join("minecraft")
                } else {
                    path.clone()
                };

                let icon_path = parsed.as_ref().and_then(|p| {
                    p.icon_path.as_ref().map(|icon| {
                        let icon_candidate = PathBuf::from(icon);
                        if icon_candidate.is_absolute() {
                            icon_candidate.to_string_lossy().to_string()
                        } else {
                            path.join(icon_candidate).to_string_lossy().to_string()
                        }
                    })
                });
                let encoded_icon = icon_path
                    .as_deref()
                    .and_then(|icon| encode_icon_as_data_url(Path::new(icon)));

                instances.push(ExternalInstanceCandidate {
                    id,
                    name,
                    instance_path: path.to_string_lossy().to_string(),
                    game_directory: game_dir.to_string_lossy().to_string(),
                    icon_path: encoded_icon,
                    minecraft_version: parsed.as_ref().and_then(|p| p.game_version.clone()),
                    modloader: parsed.as_ref().and_then(|p| p.loader.clone()),
                    modloader_version: parsed.as_ref().and_then(|p| p.loader_version.clone()),
                    modpack_platform: Some("modrinth".to_string()),
                    modpack_id: parsed.as_ref().and_then(|p| p.linked_project_id.clone()),
                    modpack_version_id: parsed.as_ref().and_then(|p| p.linked_version_id.clone()),
                    ..Default::default()
                });
            }
        }

        Ok(instances)
    }
}

