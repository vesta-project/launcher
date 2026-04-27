use std::path::Path;

use base64::{Engine as _, engine::general_purpose};
use serde_json::Value;

use super::types::ATResourceHint;

pub(super) fn encode_png_as_data_url(path: &Path) -> Option<String> {
    if !path.exists() || !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

pub fn extract_atlauncher_resource_hints(instance_root: &Path) -> Vec<ATResourceHint> {
    let cfg_path = instance_root.join("instance.json");
    let Ok(raw) = std::fs::read_to_string(cfg_path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    collect_resource_hints(&json, &mut out);
    out
}

fn collect_resource_hints(value: &Value, out: &mut Vec<ATResourceHint>) {
    match value {
        Value::Object(map) => {
            let project_id = find_stringish(map, &["projectId", "project_id", "projectID", "id"]);
            let version_id = find_stringish(map, &["versionId", "version_id", "fileId", "file_id", "fileID"]);
            let platform = find_stringish(map, &["platform", "source", "provider"]);
            if let (Some(project_id), Some(version_id), Some(platform)) = (project_id, version_id, platform) {
                let platform_norm = match platform.to_ascii_lowercase().as_str() {
                    "modrinth" | "mr" => Some("modrinth".to_string()),
                    "curseforge" | "cf" => Some("curseforge".to_string()),
                    _ => None,
                };
                if let Some(platform_norm) = platform_norm {
                    let file_name = find_stringish(map, &["file", "fileName", "filename", "path"]).and_then(|p| {
                        Path::new(&p)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .map(|s| s.to_string())
                    });
                    out.push(ATResourceHint {
                        project_id,
                        version_id,
                        platform: platform_norm,
                        file_name,
                    });
                }
            }
            for nested in map.values() {
                collect_resource_hints(nested, out);
            }
        }
        Value::Array(items) => {
            for nested in items {
                collect_resource_hints(nested, out);
            }
        }
        _ => {}
    }
}

fn find_stringish(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for (k, v) in map {
        if keys.iter().any(|known| known.eq_ignore_ascii_case(k)) {
            match v {
                Value::String(s) if !s.trim().is_empty() => return Some(s.to_string()),
                Value::Number(n) => return Some(n.to_string()),
                _ => {}
            }
        }
    }
    None
}
