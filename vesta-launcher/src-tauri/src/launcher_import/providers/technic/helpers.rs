use std::collections::HashSet;
use std::path::Path;

use anyhow::Result;
use serde_json::Value;

use crate::launcher_import::types::ExternalInstanceCandidate;

pub(super) fn candidates_from_root(root: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
    let mut out = Vec::new();
    let mut known_slugs = HashSet::new();

    let installed = root.join("installedPacks");
    if installed.exists() && installed.is_file() {
        known_slugs.extend(read_installed_pack_slugs(&installed));
    }

    let modpacks_root = root.join("modpacks");
    if !modpacks_root.is_dir() {
        return Ok(out);
    }

    for entry in std::fs::read_dir(modpacks_root)? {
        let entry = entry?;
        let pack_dir = entry.path();
        if !pack_dir.is_dir() {
            continue;
        }

        let slug = pack_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("pack")
            .to_string();
        if !known_slugs.is_empty() && !known_slugs.contains(&slug) {
            continue;
        }

        let game_dir = if pack_dir.join(".minecraft").is_dir() {
            pack_dir.join(".minecraft")
        } else if pack_dir.join("minecraft").is_dir() {
            pack_dir.join("minecraft")
        } else {
            pack_dir.clone()
        };
        let display_name = read_pack_display_name(&pack_dir).unwrap_or_else(|| slug.clone());

        out.push(ExternalInstanceCandidate {
            id: slug.clone(),
            name: display_name,
            instance_path: pack_dir.to_string_lossy().to_string(),
            game_directory: game_dir.to_string_lossy().to_string(),
            icon_path: encode_pack_icon(root, &pack_dir, &slug),
            minecraft_version: None,
            modloader: None,
            modloader_version: None,
            modpack_platform: None,
            modpack_id: None,
            modpack_version_id: None,
            ..Default::default()
        });
    }

    Ok(out)
}

fn read_installed_pack_slugs(path: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    let Ok(raw) = std::fs::read_to_string(path) else {
        return out;
    };

    if let Ok(json) = serde_json::from_str::<Value>(&raw) {
        collect_pack_slugs(&json, &mut out);
    } else {
        for line in raw.lines() {
            let line = line.trim();
            if !line.is_empty() && !line.starts_with('#') {
                out.insert(line.to_string());
            }
        }
    }

    out
}

fn collect_pack_slugs(value: &Value, out: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                if key.eq_ignore_ascii_case("name") || key.eq_ignore_ascii_case("slug") {
                    if let Some(v) = nested.as_str() {
                        out.insert(v.to_string());
                    }
                }
                collect_pack_slugs(nested, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_pack_slugs(item, out);
            }
        }
        _ => {}
    }
}

fn read_pack_display_name(pack_dir: &Path) -> Option<String> {
    let candidates = [
        pack_dir.join("pack.json"),
        pack_dir.join("modpack.json"),
        pack_dir.join("installedPack.json"),
    ];
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(candidate) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if let Some(name) = json
            .get("displayName")
            .and_then(|v| v.as_str())
            .or_else(|| json.get("name").and_then(|v| v.as_str()))
        {
            return Some(name.to_string());
        }
    }
    None
}

fn encode_pack_icon(root: &Path, pack_dir: &Path, pack_slug: &str) -> Option<String> {
    let candidates = [
        pack_dir.join("icon.png"),
        pack_dir.join("icon.jpg"),
        pack_dir.join("logo.png"),
        root.join("assets").join("packs").join(pack_slug).join("icon.png"),
    ];
    for icon in candidates {
        if !icon.is_file() {
            continue;
        }
        let bytes = std::fs::read(&icon).ok()?;
        let mime = match icon
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref()
        {
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            _ => continue,
        };
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
        return Some(format!("data:{mime};base64,{encoded}"));
    }
    None
}
