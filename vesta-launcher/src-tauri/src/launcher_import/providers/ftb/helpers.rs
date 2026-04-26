use std::path::{Path, PathBuf};

use serde_json::Value;

pub(super) fn resolve_ftb_instances_root(base_path: &Path) -> PathBuf {
    if base_path.file_name().and_then(|s| s.to_str()) == Some("instances") {
        return base_path.to_path_buf();
    }
    if base_path.join("instances").is_dir() {
        return base_path.join("instances");
    }
    if base_path.join(".ftba/instances").is_dir() {
        return base_path.join(".ftba/instances");
    }
    if base_path.file_name().and_then(|s| s.to_str()) == Some(".ftba")
        && base_path.join("instances").is_dir()
    {
        return base_path.join("instances");
    }
    if base_path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|name| name.eq_ignore_ascii_case("application support"))
        .unwrap_or(false)
        && base_path.join(".ftba/instances").is_dir()
    {
        return base_path.join(".ftba/instances");
    }
    base_path.join("instances")
}

pub(super) fn extract_stringish(value: &Value, keys: &[&str]) -> Option<String> {
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
        Value::Array(arr) => arr.iter().find_map(|item| extract_stringish(item, keys)),
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

pub(super) fn split_modloader_and_version(
    modloader: Option<String>,
    modloader_version: Option<String>,
) -> (Option<String>, Option<String>) {
    match (modloader, modloader_version) {
        (Some(loader), Some(version)) => (Some(loader), Some(version)),
        (Some(loader), None) => {
            if let Some((kind, version)) = loader.split_once('-') {
                if !kind.trim().is_empty() && !version.trim().is_empty() {
                    return (Some(kind.to_string()), Some(version.to_string()));
                }
            }
            (Some(loader), None)
        }
        (None, Some(version)) => (None, Some(version)),
        (None, None) => (None, None),
    }
}
