use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose};

use crate::launcher_import::providers::prism_multimc_cfg::parse_ini_field;
use crate::launcher_import::types::ExternalInstanceCandidate;

pub(super) fn infer_launcher_root(base_path: &Path, instances_root: &Path) -> PathBuf {
    if instances_root != base_path {
        return base_path.to_path_buf();
    }
    if base_path.file_name().and_then(|s| s.to_str()) == Some("instances") {
        return base_path.parent().unwrap_or(base_path).to_path_buf();
    }
    base_path.to_path_buf()
}

pub(super) fn enrich_managed_pack_from_cfg(instance: &mut ExternalInstanceCandidate) {
    let cfg_path = PathBuf::from(&instance.instance_path).join("instance.cfg");
    let Ok(raw_cfg) = std::fs::read_to_string(cfg_path) else {
        return;
    };

    if let Some(mc_version) = parse_ini_field(&raw_cfg, "MinecraftVersion") {
        instance.minecraft_version = Some(mc_version);
    }

    let managed_pack_type = parse_ini_field(&raw_cfg, "ManagedPackType")
        .map(|v| v.trim_matches('"').to_ascii_lowercase());
    let managed_pack_id = parse_ini_field(&raw_cfg, "ManagedPackID").map(|v| v.trim_matches('"').to_string());
    let managed_pack_version_id =
        parse_ini_field(&raw_cfg, "ManagedPackVersionID").map(|v| v.trim_matches('"').to_string());

    if let Some(pack_type) = managed_pack_type {
        let mapped = match pack_type.as_str() {
            "flame" | "curseforge" => Some("curseforge".to_string()),
            "modrinth" => Some("modrinth".to_string()),
            _ => None,
        };
        if mapped.is_some() {
            instance.modpack_platform = mapped;
        }
    }
    if managed_pack_id.is_some() {
        instance.modpack_id = managed_pack_id;
    }
    if managed_pack_version_id.is_some() {
        instance.modpack_version_id = managed_pack_version_id;
    }
}

pub(super) fn resolve_prism_icon(instance: &ExternalInstanceCandidate, icons_root: &Path) -> Option<String> {
    if !icons_root.is_dir() {
        return None;
    }
    let cfg_path = PathBuf::from(&instance.instance_path).join("instance.cfg");
    let Ok(raw_cfg) = std::fs::read_to_string(cfg_path) else {
        return None;
    };
    let icon_key = parse_ini_field(&raw_cfg, "iconKey")
        .or_else(|| parse_ini_field(&raw_cfg, "IconKey"))?
        .trim_matches('"')
        .to_string();
    if icon_key.is_empty() {
        return None;
    }

    for ext in ["webp", "png", "jpg", "jpeg"] {
        let candidate = icons_root.join(format!("{icon_key}.{ext}"));
        if let Some(data_url) = encode_image_as_data_url(&candidate) {
            return Some(data_url);
        }
    }
    None
}

fn encode_image_as_data_url(path: &Path) -> Option<String> {
    if !path.is_file() {
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
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}
