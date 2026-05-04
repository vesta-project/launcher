use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose};
use serde_json::Value;

pub(super) fn encode_icon_as_data_url(icon_path: &Path) -> Option<String> {
    if !icon_path.exists() || !icon_path.is_file() {
        return None;
    }

    let mime_type = match icon_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => return None,
    };

    let bytes = std::fs::read(icon_path).ok()?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime_type};base64,{encoded}"))
}

pub(super) fn resolve_profile_roots(base_path: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        base_path.to_path_buf(),
        base_path.join("profiles"),
        base_path.join("minecraft/Instances"),
        base_path.join("instances"),
        base_path.join("theseus/profiles"),
        base_path.join("com.modrinth.theseus/profiles"),
    ];
    candidates.extend(instance_roots_from_settings(base_path));

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn instance_roots_from_settings(base_path: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let settings_candidates = [
        base_path.join("settings.json"),
        base_path.join("app_settings.json"),
        base_path.join("state.json"),
        base_path.join("meta/settings.json"),
    ];

    for settings_path in settings_candidates {
        if !settings_path.exists() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&settings_path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };

        let mut extracted_paths = Vec::new();
        collect_instance_path_fields(&json, &mut extracted_paths);
        for extracted in extracted_paths {
            let candidate = PathBuf::from(&extracted);
            if candidate.is_absolute() {
                out.push(candidate);
            } else {
                out.push(base_path.join(candidate));
            }
        }
    }

    out
}

fn collect_instance_path_fields(value: &Value, out: &mut Vec<String>) {
    const TRACKED_FIELDS: &[&str] = &[
        "instance_dir",
        "instances_dir",
        "instance_path",
        "instances_path",
        "profiles_dir",
        "profiles_path",
        "instanceDir",
        "instancesDir",
        "instancePath",
        "instancesPath",
        "profilesDir",
        "profilesPath",
    ];

    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                if TRACKED_FIELDS.iter().any(|known| known.eq_ignore_ascii_case(key)) {
                    if let Some(path) = nested.as_str() {
                        out.push(path.to_string());
                    }
                }
                collect_instance_path_fields(nested, out);
            }
        }
        Value::Array(arr) => {
            for nested in arr {
                collect_instance_path_fields(nested, out);
            }
        }
        _ => {}
    }
}
