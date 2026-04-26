use std::path::PathBuf;

use serde_json::Value;

use crate::launcher_import::providers::prism_multimc_cfg::parse_ini_field;
use crate::launcher_import::types::ExternalInstanceCandidate;

#[derive(Debug, Clone)]
pub struct FlameResourceHint {
    pub project_id: String,
    pub version_id: String,
    pub file_name: Option<String>,
}

pub fn enrich_flame_metadata(instance: &mut ExternalInstanceCandidate) {
    let root = PathBuf::from(&instance.instance_path);
    let cfg_path = root.join("instance.cfg");
    if let Ok(raw_cfg) = std::fs::read_to_string(cfg_path) {
        if let Some(mc_version) = parse_ini_field(&raw_cfg, "MinecraftVersion") {
            instance.minecraft_version = Some(mc_version);
        }
    }

    let flame_dir = root.join("flame");
    if !flame_dir.is_dir() {
        return;
    }

    let mut platform = None;
    let mut pack_id = None;
    let mut version_id = None;

    if let Ok(entries) = std::fs::read_dir(&flame_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_json = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("json"))
                .unwrap_or(false);
            if !is_json || !path.is_file() {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };

            if platform.is_none() {
                platform = detect_platform(&json);
            }
            if pack_id.is_none() {
                pack_id = extract_stringish(&json, &["projectID", "projectId", "project_id"]);
            }
            if version_id.is_none() {
                version_id = extract_stringish(&json, &["fileID", "fileId", "file_id", "versionId"]);
            }
        }
    }

    if platform.is_some() {
        instance.modpack_platform = platform;
    }
    if pack_id.is_some() {
        instance.modpack_id = pack_id;
    }
    if version_id.is_some() {
        instance.modpack_version_id = version_id;
    }
}

pub fn extract_flame_resource_hints(instance_root: &std::path::Path) -> Vec<FlameResourceHint> {
    let flame_dir = instance_root.join("flame");
    if !flame_dir.is_dir() {
        return Vec::new();
    }

    let mut hints = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&flame_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_json = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("json"))
                .unwrap_or(false);
            if !is_json || !path.is_file() {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            collect_hints_from_value(&json, &mut hints);
        }
    }
    hints
}

fn collect_hints_from_value(value: &Value, out: &mut Vec<FlameResourceHint>) {
    match value {
        Value::Object(map) => {
            let project_id = map
                .iter()
                .find(|(k, _)| matches_key(k, &["projectID", "projectId", "project_id"]))
                .and_then(|(_, v)| value_to_string(v));
            let version_id = map
                .iter()
                .find(|(k, _)| matches_key(k, &["fileID", "fileId", "file_id", "versionId"]))
                .and_then(|(_, v)| value_to_string(v));
            if let (Some(project_id), Some(version_id)) = (project_id, version_id) {
                let file_name = map
                    .iter()
                    .find(|(k, _)| {
                        matches_key(k, &["fileName", "filename", "file_name", "path"])
                    })
                    .and_then(|(_, v)| value_to_string(v))
                    .and_then(|v| {
                        std::path::Path::new(&v)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .map(|s| s.to_string())
                    });
                out.push(FlameResourceHint {
                    project_id,
                    version_id,
                    file_name,
                });
            }
            for nested in map.values() {
                collect_hints_from_value(nested, out);
            }
        }
        Value::Array(items) => {
            for nested in items {
                collect_hints_from_value(nested, out);
            }
        }
        _ => {}
    }
}

fn matches_key(key: &str, known: &[&str]) -> bool {
    known.iter().any(|k| k.eq_ignore_ascii_case(key))
}

fn detect_platform(value: &Value) -> Option<String> {
    let explicit = extract_stringish(value, &["platform", "provider", "source"]);
    explicit.and_then(|platform| match platform.to_ascii_lowercase().as_str() {
        "curseforge" | "cf" => Some("curseforge".to_string()),
        "modrinth" | "mr" => Some("modrinth".to_string()),
        _ => None,
    })
}

fn extract_stringish(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                if keys.iter().any(|known| known.eq_ignore_ascii_case(key)) {
                    if let Some(found) = value_to_string(nested) {
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

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.trim().is_empty() => Some(s.to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
