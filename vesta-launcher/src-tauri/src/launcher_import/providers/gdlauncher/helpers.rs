use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose};
use serde_json::Value;

use crate::launcher_import::types::ExternalInstanceCandidate;

use super::types::GDCarbonInstance;

pub(super) fn resolve_instances_root(base_path: &Path) -> PathBuf {
    if base_path.join("instances").is_dir() {
        return base_path.join("instances");
    }
    base_path.to_path_buf()
}

pub(super) fn parse_carbon_instance(
    instance_root: &Path,
    parsed: GDCarbonInstance,
) -> ExternalInstanceCandidate {
    let id = instance_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("instance")
        .to_string();

    let display_name = parsed.name.clone().unwrap_or_else(|| id.clone());

    let nested_instance_dir = instance_root.join("instance");
    let game_dir = if nested_instance_dir.is_dir() {
        nested_instance_dir
    } else {
        instance_root.to_path_buf()
    };

    let (minecraft_version, modloader, modloader_version) =
        if let Some(version) = parsed.game_configuration.and_then(|cfg| cfg.version) {
            let loader = version.modloaders.first();
            (
                version.release,
                loader.and_then(|l| l.loader_type.clone()),
                loader.and_then(|l| l.version.clone()),
            )
        } else {
            (None, None, None)
        };

    let icon_path = encode_image_as_data_url(&instance_root.join("icon.png"));
    let (modpack_platform, modpack_id, modpack_version_id) =
        parse_modpack_linkage(parsed.modpack.as_ref(), &instance_root.join("packinfo.json"));

    ExternalInstanceCandidate {
        id,
        name: display_name,
        instance_path: instance_root.to_string_lossy().to_string(),
        game_directory: game_dir.to_string_lossy().to_string(),
        icon_path,
        minecraft_version,
        modloader,
        modloader_version,
        modpack_platform,
        modpack_id,
        modpack_version_id,
        ..Default::default()
    }
}

fn parse_modpack_linkage(
    modpack: Option<&super::types::GDCarbonModpack>,
    packinfo_path: &Path,
) -> (Option<String>, Option<String>, Option<String>) {
    let mut platform = None;
    let mut project_id = None;
    let mut version_id = None;

    if let Some(modpack) = modpack {
        platform = modpack
            .platform
            .as_ref()
            .map(|value| value.to_ascii_lowercase())
            .and_then(|value| match value.as_str() {
                "modrinth" => Some("modrinth".to_string()),
                "curseforge" => Some("curseforge".to_string()),
                _ => None,
            });

        project_id = normalize_modpack_id(modpack.project_id.as_ref());
        version_id = normalize_modpack_id(modpack.file_id.as_ref());
    }

    if (platform.is_none() || project_id.is_none() || version_id.is_none()) && packinfo_path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(packinfo_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&raw) {
                if platform.is_none() {
                    platform = extract_platform(&json);
                }
                if project_id.is_none() {
                    project_id = extract_stringish(&json, &["project_id", "projectId", "projectID"]);
                }
                if version_id.is_none() {
                    version_id = extract_stringish(&json, &["file_id", "fileId", "fileID", "versionId"]);
                }
            }
        }
    }

    (platform, project_id, version_id)
}

fn normalize_modpack_id(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn extract_platform(value: &Value) -> Option<String> {
    extract_stringish(value, &["platform", "source", "provider"]).and_then(|value| {
        match value.to_ascii_lowercase().as_str() {
            "modrinth" | "mr" => Some("modrinth".to_string()),
            "curseforge" | "cf" => Some("curseforge".to_string()),
            _ => None,
        }
    })
}

fn extract_stringish(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                if keys.iter().any(|known| known.eq_ignore_ascii_case(key)) {
                    if let Some(found) = match nested {
                        Value::String(s) => Some(s.to_string()),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None,
                    } {
                        return Some(found);
                    }
                }
                if let Some(found) = extract_stringish(nested, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| extract_stringish(item, keys)),
        _ => None,
    }
}

fn encode_image_as_data_url(path: &Path) -> Option<String> {
    if !path.exists() || !path.is_file() {
        return None;
    }

    let mime = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}
