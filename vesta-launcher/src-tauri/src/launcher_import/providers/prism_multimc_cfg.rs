use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::Value;

use crate::launcher_import::types::ExternalInstanceCandidate;

pub fn list_cfg_instances(base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
    let mut instances = Vec::new();
    let instances_root = resolve_instances_root(base_path);
    if !instances_root.exists() {
        return Ok(instances);
    }

    for entry in std::fs::read_dir(instances_root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let cfg_path = path.join("instance.cfg");
        if !cfg_path.exists() {
            continue;
        }

        let name_fallback = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("instance")
            .to_string();
        let raw = std::fs::read_to_string(&cfg_path)?;
        let parsed_name = parse_ini_field(&raw, "name");
        let display_name = parsed_name.unwrap_or_else(|| name_fallback.clone());

        let game_dir = if path.join("minecraft").is_dir() {
            path.join("minecraft")
        } else {
            path.join(".minecraft")
        };

        instances.push(ExternalInstanceCandidate {
            id: name_fallback,
            name: display_name,
            instance_path: path.to_string_lossy().to_string(),
            game_directory: game_dir.to_string_lossy().to_string(),
            icon_path: None,
            minecraft_version: None,
            modloader: None,
            modloader_version: None,
            modpack_platform: None,
            modpack_id: None,
            modpack_version_id: None,
            ..Default::default()
        });
    }

    Ok(instances)
}

pub fn enrich_mmc_pack_metadata(instance: &mut ExternalInstanceCandidate) {
    let pack_path = PathBuf::from(&instance.instance_path).join("mmc-pack.json");
    if !pack_path.is_file() {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(pack_path) else {
        return;
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let Some(components) = json.get("components").and_then(|v| v.as_array()) else {
        return;
    };

    if let Some(mc_version) = component_version(components, "net.minecraft") {
        instance.minecraft_version = Some(mc_version);
    }
    if let Some((loader, version)) = detect_loader_and_version(components) {
        instance.modloader = Some(loader);
        instance.modloader_version = version;
    }
}

fn detect_loader_and_version(components: &[Value]) -> Option<(String, Option<String>)> {
    let candidates = [
        ("net.fabricmc.fabric-loader", "fabric"),
        ("org.quiltmc.quilt-loader", "quilt"),
        ("net.minecraftforge", "forge"),
        ("net.neoforged", "neoforge"),
        ("org.prismlauncher.legacyjavafixer", "vanilla"),
    ];

    for (uid, mapped_loader) in candidates {
        if let Some(version) = component_version(components, uid) {
            if mapped_loader == "vanilla" {
                continue;
            }
            return Some((mapped_loader.to_string(), Some(version)));
        }
    }
    None
}

fn component_version(components: &[Value], uid: &str) -> Option<String> {
    components.iter().find_map(|component| {
        let component_uid = component.get("uid")?.as_str()?;
        if component_uid != uid {
            return None;
        }
        component
            .get("version")
            .and_then(|v| v.as_str())
            .or_else(|| component.get("cachedVersion").and_then(|v| v.as_str()))
            .map(|value| value.to_string())
    })
}

pub fn resolve_instances_root(base_path: &Path) -> PathBuf {
    if base_path.join("instances").is_dir() {
        return base_path.join("instances");
    }
    base_path.to_path_buf()
}

pub fn parse_ini_field(raw: &str, key: &str) -> Option<String> {
    raw.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with(';') {
            return None;
        }
        let (left, right) = trimmed.split_once('=')?;
        if left.trim().eq_ignore_ascii_case(key) {
            return Some(right.trim().to_string());
        }
        None
    })
}
