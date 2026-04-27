use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::Value;

use crate::launcher_import::types::ExternalInstanceCandidate;

use super::types::{InstalledModpack, MinecraftGameInstance, MinecraftInstance};

pub(super) fn resolve_scan_roots(base_path: &Path) -> Vec<PathBuf> {
    vec![
        base_path.to_path_buf(),
        base_path.join("agent/GameInstances"),
        base_path.join("minecraft/Instances"),
        base_path.join("Instances"),
    ]
}

pub(super) fn collect_instances_from_root(
    root: &Path,
    base_path: &Path,
    instances: &mut Vec<ExternalInstanceCandidate>,
) -> Result<()> {
    let root_file = root.join("MinecraftGameInstance.json");
    if root_file.is_file() {
        collect_direct_json_instances(root, &root_file, base_path, instances)?;
    }

    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|name| name.eq_ignore_ascii_case("MinecraftGameInstance.json"))
                .unwrap_or(false)
        {
            collect_direct_json_instances(root, &path, base_path, instances)?;
            continue;
        }

        if !path.is_dir() {
            continue;
        }

        let modern_cfg = path.join("MinecraftGameInstance.json");
        if modern_cfg.exists() {
            if let Some(instance) = parse_modern_instance(&path, &modern_cfg, base_path)? {
                instances.push(instance);
            }
            continue;
        }

        let legacy_cfg = path.join("minecraftinstance.json");
        if legacy_cfg.exists() {
            if let Some(instance) = parse_legacy_instance(&path, &legacy_cfg)? {
                instances.push(instance);
            }
        }
    }

    Ok(())
}

fn collect_direct_json_instances(
    root: &Path,
    json_path: &Path,
    base_path: &Path,
    instances: &mut Vec<ExternalInstanceCandidate>,
) -> Result<()> {
    let raw = std::fs::read_to_string(json_path)?;
    let json: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    match json {
        Value::Array(arr) => {
            for (index, item) in arr.into_iter().enumerate() {
                if let Some(instance) = parse_modern_value(root, &item, base_path, index) {
                    instances.push(instance);
                }
            }
        }
        Value::Object(_) => {
            if let Some(instance) = parse_modern_value(root, &json, base_path, 0) {
                instances.push(instance);
            }
        }
        _ => {}
    }

    Ok(())
}

fn parse_modern_instance(
    instance_root: &Path,
    cfg_path: &Path,
    base_path: &Path,
) -> Result<Option<ExternalInstanceCandidate>> {
    let raw = std::fs::read_to_string(cfg_path)?;
    let parsed: MinecraftGameInstance = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let id = instance_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("instance")
        .to_string();
    let name = parsed.name.unwrap_or_else(|| id.clone());
    let game_directory = parsed
        .game_directory
        .as_ref()
        .or(parsed.install_location.as_ref())
        .or(parsed.install_path.as_ref())
        .map(PathBuf::from)
        .map(|path| if path.is_absolute() { path } else { base_path.join(path) })
        .unwrap_or_else(|| instance_root.to_path_buf());
    let loader_name = parsed.base_mod_loader.or(parsed.mod_loader).map(|l| l.name);
    let (modloader, modloader_version) = split_loader(loader_name);
    let (modpack_id, modpack_version_id) = extract_modpack_ids(
        parsed.project_id.as_ref(),
        parsed.file_id.as_ref(),
        parsed.installed_modpack.as_ref(),
    );

    Ok(Some(ExternalInstanceCandidate {
        id,
        name,
        instance_path: game_directory.to_string_lossy().to_string(),
        game_directory: game_directory.to_string_lossy().to_string(),
        icon_path: None,
        minecraft_version: parsed.game_version,
        modloader,
        modloader_version,
        modpack_platform: Some("curseforge".to_string()),
        modpack_id,
        modpack_version_id,
        ..Default::default()
    }))
}

fn parse_modern_value(
    root: &Path,
    value: &Value,
    base_path: &Path,
    index: usize,
) -> Option<ExternalInstanceCandidate> {
    let parsed: MinecraftGameInstance = serde_json::from_value(value.clone()).ok()?;
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .unwrap_or_else(|| format!("instance_{index}"));
    let name = parsed.name.clone().unwrap_or_else(|| id.clone());
    let game_directory = parsed
        .game_directory
        .as_ref()
        .or(parsed.install_location.as_ref())
        .or(parsed.install_path.as_ref())
        .map(PathBuf::from)
        .map(|path| if path.is_absolute() { path } else { base_path.join(path) })
        .unwrap_or_else(|| root.to_path_buf());
    let loader_name = parsed.base_mod_loader.or(parsed.mod_loader).map(|l| l.name);
    let (modloader, modloader_version) = split_loader(loader_name);

    let installed_modpack = value
        .get("installedModpack")
        .or_else(|| value.get("installed_modpack"))
        .and_then(|v| v.as_object());
    let top_project_id = value
        .get("project_id")
        .or_else(|| value.get("projectId"))
        .or_else(|| value.get("projectID"));
    let top_file_id = value
        .get("file_id")
        .or_else(|| value.get("fileId"))
        .or_else(|| value.get("fileID"));
    let nested_project_id = installed_modpack.and_then(|o| {
        o.get("project_id")
            .or_else(|| o.get("projectId"))
            .or_else(|| o.get("projectID"))
            .or_else(|| o.get("addonID"))
            .or_else(|| o.get("addonId"))
            .or_else(|| {
                o.get("installedFile")
                    .or_else(|| o.get("installed_file"))
                    .and_then(|f| f.get("projectId").or_else(|| f.get("projectID")))
            })
            .or_else(|| {
                o.get("latestFile")
                    .or_else(|| o.get("latest_file"))
                    .and_then(|f| f.get("projectId").or_else(|| f.get("projectID")))
            })
    });
    let nested_file_id = installed_modpack.and_then(|o| {
        o.get("file_id")
            .or_else(|| o.get("fileId"))
            .or_else(|| o.get("fileID"))
            .or_else(|| {
                o.get("installedFile")
                    .or_else(|| o.get("installed_file"))
                    .and_then(|f| {
                        f.get("fileId")
                            .or_else(|| f.get("fileID"))
                            .or_else(|| f.get("id"))
                    })
            })
            .or_else(|| {
                o.get("latestFile")
                    .or_else(|| o.get("latest_file"))
                    .and_then(|f| {
                        f.get("fileId")
                            .or_else(|| f.get("fileID"))
                            .or_else(|| f.get("id"))
                    })
            })
    });
    let (modpack_id, modpack_version_id) = (
        normalize_value(top_project_id).or_else(|| normalize_value(nested_project_id)),
        normalize_value(top_file_id).or_else(|| normalize_value(nested_file_id)),
    );

    Some(ExternalInstanceCandidate {
        id,
        name,
        instance_path: game_directory.to_string_lossy().to_string(),
        game_directory: game_directory.to_string_lossy().to_string(),
        icon_path: None,
        minecraft_version: parsed.game_version,
        modloader,
        modloader_version,
        modpack_platform: Some("curseforge".to_string()),
        modpack_id,
        modpack_version_id,
        ..Default::default()
    })
}

fn parse_legacy_instance(instance_root: &Path, cfg_path: &Path) -> Result<Option<ExternalInstanceCandidate>> {
    let raw = std::fs::read_to_string(cfg_path)?;
    let parsed: MinecraftInstance = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let id = instance_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("instance")
        .to_string();
    let loader_name = parsed.base_mod_loader.map(|loader| loader.name);
    let (modloader, modloader_version) = split_loader(loader_name);
    let (modpack_id, modpack_version_id) = extract_modpack_ids(
        parsed.project_id.as_ref(),
        parsed.file_id.as_ref(),
        parsed.installed_modpack.as_ref(),
    );

    Ok(Some(ExternalInstanceCandidate {
        id: id.clone(),
        name: parsed.name.unwrap_or(id),
        instance_path: instance_root.to_string_lossy().to_string(),
        game_directory: instance_root.to_string_lossy().to_string(),
        icon_path: None,
        minecraft_version: Some(parsed.game_version),
        modloader,
        modloader_version,
        modpack_platform: Some("curseforge".to_string()),
        modpack_id,
        modpack_version_id,
        ..Default::default()
    }))
}

fn extract_modpack_ids(
    top_project_id: Option<&Value>,
    top_file_id: Option<&Value>,
    installed_modpack: Option<&InstalledModpack>,
) -> (Option<String>, Option<String>) {
    let nested_project_id = installed_modpack
        .and_then(|pack| {
            pack.project_id
                .as_ref()
                .or(pack.addon_id.as_ref())
                .or_else(|| pack.installed_file.as_ref().and_then(|f| f.project_id.as_ref()))
                .or_else(|| pack.latest_file.as_ref().and_then(|f| f.project_id.as_ref()))
        });
    let nested_file_id = installed_modpack.and_then(|pack| {
        pack.file_id
            .as_ref()
            .or_else(|| pack.installed_file.as_ref().and_then(|f| f.file_id.as_ref().or(f.file_uid.as_ref())))
            .or_else(|| pack.latest_file.as_ref().and_then(|f| f.file_id.as_ref().or(f.file_uid.as_ref())))
    });
    (
        normalize_value(top_project_id).or_else(|| normalize_value(nested_project_id)),
        normalize_value(top_file_id).or_else(|| normalize_value(nested_file_id)),
    )
}

fn split_loader(loader_name: Option<String>) -> (Option<String>, Option<String>) {
    loader_name
        .and_then(|loader| loader.split_once('-').map(|(kind, version)| (kind.to_string(), version.to_string())))
        .map(|(kind, version)| (Some(kind), Some(version)))
        .unwrap_or((Some("vanilla".to_string()), None))
}

fn normalize_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.to_string()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}
