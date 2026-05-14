use anyhow::{anyhow, Result};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

use crate::game::modpack::types::{
    CurseForgeManifest, ModpackFormat, ModpackMetadata, ModpackMod, ModrinthIndex,
};

/// Detects the modpack format and returns its metadata from a ZIP file
pub fn get_modpack_metadata<P: AsRef<Path>>(path: P) -> Result<ModpackMetadata> {
    let path_ref = path.as_ref();
    log::info!("[get_modpack_metadata] Opening ZIP: {:?}", path_ref);

    let file = File::open(path_ref)?;
    let mut archive = ZipArchive::new(file)?;
    log::info!(
        "[get_modpack_metadata] ZIP opened, contains {} files",
        archive.len()
    );

    // Optimization: check common manifest locations first to avoid a full scan
    let common_locations = [
        "modrinth.index.json",
        "manifest.json",
        // Sometimes nested in a single top-level folder
    ];

    for loc in common_locations {
        if let Ok(mut file) = archive.by_name(loc) {
            log::info!(
                "[get_modpack_metadata] Found manifest at common location: {}",
                loc
            );
            let mut content = String::new();
            file.read_to_string(&mut content)?;

            if loc == "modrinth.index.json" {
                if let Ok(index) = serde_json::from_str::<ModrinthIndex>(&content) {
                    return Ok(metadata_from_modrinth(index));
                }
            } else if loc == "manifest.json" {
                if let Ok(manifest) = serde_json::from_str::<CurseForgeManifest>(&content) {
                    return Ok(metadata_from_curseforge(manifest));
                }
            }
        }
    }

    // If not found in common locations, we do the full scan (supporting nested folders)
    log::info!("[get_modpack_metadata] Manifest not found at root. Scanning all files...");
    let mut modrinth_data: Option<(String, ModrinthIndex)> = None;
    let mut curseforge_data: Option<(String, CurseForgeManifest)> = None;
    let mut last_error: Option<String> = None;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_owned();

        // Check for modrinth.index.json (must be at root OR in a subfolder)
        if name == "modrinth.index.json" || name.ends_with("/modrinth.index.json") {
            log::info!(
                "[get_modpack_metadata] Found potential Modrinth index: {}",
                name
            );
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            let preview: String = content.chars().take(100).collect();
            log::debug!(
                "[get_modpack_metadata] Modrinth content (first 100 chars): {}",
                preview
            );

            match serde_json::from_str::<ModrinthIndex>(&content) {
                Ok(index) => {
                    let prefix = name
                        .strip_suffix("modrinth.index.json")
                        .unwrap_or("")
                        .to_string();
                    log::info!(
                        "[get_modpack_metadata] Successfully parsed Modrinth index at prefix: '{}'",
                        prefix
                    );
                    modrinth_data = Some((prefix, index));
                    break; // Modrinth is primary preference
                }
                Err(e) => {
                    let err_msg = format!(
                        "Found modrinth.index.json ({}) but failed to parse: {}",
                        name, e
                    );
                    log::warn!("[get_modpack_metadata] {}", err_msg);
                    last_error = Some(err_msg);
                }
            }
        } else if name == "manifest.json" || name.ends_with("/manifest.json") {
            log::info!(
                "[get_modpack_metadata] Found potential CurseForge manifest: {}",
                name
            );
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            let preview: String = content.chars().take(100).collect();
            log::debug!(
                "[get_modpack_metadata] CurseForge content (first 100 chars): {}",
                preview
            );

            match serde_json::from_str::<CurseForgeManifest>(&content) {
                Ok(manifest) => {
                    let prefix = name.strip_suffix("manifest.json").unwrap_or("").to_string();
                    log::info!("[get_modpack_metadata] Successfully parsed CurseForge manifest at prefix: '{}'", prefix);
                    curseforge_data = Some((prefix, manifest));
                }
                Err(e) => {
                    let err_msg =
                        format!("Found manifest.json ({}) but failed to parse: {}", name, e);
                    log::warn!("[get_modpack_metadata] {}", err_msg);
                    last_error = Some(err_msg);
                }
            }
        }
    }

    if let Some((prefix, index)) = modrinth_data {
        log::info!(
            "[get_modpack_metadata] Returning Modrinth metadata ({} v{})",
            index.name,
            index.version_id
        );
        let mut meta = metadata_from_modrinth(index);
        meta.root_prefix = if prefix.is_empty() {
            None
        } else {
            Some(prefix)
        };
        return Ok(meta);
    }

    if let Some((prefix, manifest)) = curseforge_data {
        log::info!(
            "[get_modpack_metadata] Returning CurseForge metadata ({} v{})",
            manifest.name,
            manifest.version
        );
        let mut meta = metadata_from_curseforge(manifest);
        meta.root_prefix = if prefix.is_empty() {
            None
        } else {
            Some(prefix)
        };
        return Ok(meta);
    }

    log::error!(
        "[get_modpack_metadata] No valid metadata found in ZIP. Searched all {} files.",
        archive.len()
    );
    let base_err = "No supported modpack metadata (modrinth.index.json or manifest.json) found or valid in ZIP.".to_string();
    if let Some(e) = last_error {
        Err(anyhow!("{}. Last parse error: {}", base_err, e))
    } else {
        Err(anyhow!("{}", base_err))
    }
}

fn metadata_from_modrinth(index: ModrinthIndex) -> ModpackMetadata {
    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());

    // Detect modloader
    let mut modloader_type = "vanilla".to_string();
    let mut modloader_version = None;

    if let Some(v) = index.dependencies.get("fabric-loader") {
        modloader_type = "fabric".to_string();
        modloader_version = Some(v.clone());
    } else if let Some(v) = index.dependencies.get("forge") {
        modloader_type = "forge".to_string();
        modloader_version = Some(v.clone());
    } else if let Some(v) = index.dependencies.get("neoforge") {
        modloader_type = "neoforge".to_string();
        modloader_version = Some(v.clone());
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        modloader_type = "quilt".to_string();
        modloader_version = Some(v.clone());
    }

    let mods_count = index.files.len();
    let recommended_ram = if mods_count > 200 {
        Some(8192)
    } else if mods_count > 100 {
        Some(6144)
    } else if mods_count > 20 {
        Some(4096)
    } else {
        Some(2048)
    };

    let mods = index
        .files
        .into_iter()
        .map(|f| ModpackMod::Modrinth {
            path: f.path,
            urls: f.downloads,
            hashes: f.hashes,
            size: f.file_size,
        })
        .collect();

    ModpackMetadata {
        name: index.name,
        version: index.version_id,
        author: None,
        minecraft_version: mc_version,
        modloader_type,
        modloader_version,
        description: index.summary,
        recommended_ram_mb: recommended_ram,
        format: ModpackFormat::Modrinth,
        mods,
        root_prefix: None,
    }
}

fn metadata_from_curseforge(manifest: CurseForgeManifest) -> ModpackMetadata {
    let mc_version = manifest.minecraft.version.clone();

    // Find primary modloader
    let mut modloader_type = "vanilla".to_string();
    let mut modloader_version = None;

    if let Some(loader) = manifest.minecraft.mod_loaders.iter().find(|l| l.primary) {
        if loader.id.starts_with("fabric-loader-") {
            modloader_type = "fabric".to_string();
            modloader_version = Some(loader.id.replace("fabric-loader-", ""));
        } else if loader.id.starts_with("quilt-loader-") {
            modloader_type = "quilt".to_string();
            modloader_version = Some(loader.id.replace("quilt-loader-", ""));
        } else if loader.id.starts_with("neoforge-") {
            modloader_type = "neoforge".to_string();
            modloader_version = Some(loader.id.replace("neoforge-", ""));
        } else if loader.id.starts_with("forge-") {
            modloader_type = "forge".to_string();
            modloader_version = Some(loader.id.replace("forge-", ""));
        } else {
            let parts: Vec<&str> = loader.id.split('-').collect();
            if parts.len() >= 2 {
                modloader_type = parts[0].to_string();
                modloader_version = Some(parts[1].to_string());
            } else {
                modloader_type = loader.id.clone();
            }
        }
    }

    let mods_count = manifest.files.len();
    let recommended_ram = manifest.minecraft.recommended_ram.or_else(|| {
        if mods_count > 200 {
            Some(8192)
        } else if mods_count > 100 {
            Some(6144)
        } else if mods_count > 20 {
            Some(4096)
        } else {
            Some(2048)
        }
    });

    let mods = manifest
        .files
        .into_iter()
        .map(|f| {
            // Find a SHA1 hash if available (algo index 1 in CF usually, otherwise look at others)
            let hash = f
                .hashes
                .as_ref()
                .and_then(|hlist| hlist.iter().find(|h| h.algo == 1).map(|h| h.value.clone()));

            ModpackMod::CurseForge {
                project_id: f.project_id,
                file_id: f.file_id,
                required: f.required,
                hash,
            }
        })
        .collect();

    ModpackMetadata {
        name: manifest.name,
        version: manifest.version,
        author: Some(manifest.author),
        minecraft_version: mc_version,
        modloader_type,
        modloader_version,
        description: None,
        recommended_ram_mb: recommended_ram,
        format: ModpackFormat::CurseForge,
        mods,
        root_prefix: None,
    }
}

/// Extracts overrides from a modpack ZIP to the specified instance directory
pub fn extract_overrides<P: AsRef<Path>, D: AsRef<Path>>(
    zip_path: P,
    destination: D,
    format: ModpackFormat,
    root_prefix: Option<String>,
) -> Result<Vec<PathBuf>> {
    let (extracted, _skipped) =
        extract_overrides_with_config_policy(zip_path, destination, format, root_prefix, true)?;
    Ok(extracted)
}

/// Extract overrides with config preservation control.
/// When `force_overwrite_configs` is false, files in the `config/` directory
/// and files with common config extensions (.cfg, .json, .toml, .yml, .yaml, .properties)
/// are skipped. Returns (extracted_files, skipped_configs).
pub fn extract_overrides_with_config_policy<P: AsRef<Path>, D: AsRef<Path>>(
    zip_path: P,
    destination: D,
    format: ModpackFormat,
    root_prefix: Option<String>,
    force_overwrite_configs: bool,
) -> Result<(Vec<PathBuf>, Vec<String>)> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let destination = destination.as_ref();
    let prefix = root_prefix.unwrap_or_default();
    let mut extracted_files = Vec::new();
    let mut skipped_configs = Vec::new();

    match format {
        ModpackFormat::Modrinth => {
            let (extracted, skipped) = extract_folder_to_root_with_config_policy(
                &mut archive,
                &format!("{}overrides", prefix),
                destination,
                force_overwrite_configs,
            )?;
            extracted_files.extend(extracted);
            skipped_configs.extend(skipped);

            let (extracted, skipped) = extract_folder_to_root_with_config_policy(
                &mut archive,
                &format!("{}client-overrides", prefix),
                destination,
                force_overwrite_configs,
            )?;
            extracted_files.extend(extracted);
            skipped_configs.extend(skipped);
        }
        ModpackFormat::CurseForge => {
            let overrides_folder = if let Ok(mut manifest_file) =
                archive.by_name(&format!("{}manifest.json", prefix))
            {
                let mut content = String::new();
                manifest_file.read_to_string(&mut content)?;
                let manifest: CurseForgeManifest = serde_json::from_str(&content)?;
                manifest.overrides
            } else {
                "overrides".to_string()
            };

            let (extracted, skipped) = extract_folder_to_root_with_config_policy(
                &mut archive,
                &format!("{}{}", prefix, overrides_folder),
                destination,
                force_overwrite_configs,
            )?;
            extracted_files.extend(extracted);
            skipped_configs.extend(skipped);
        }
    }

    Ok((extracted_files, skipped_configs))
}

fn extract_folder_to_root<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    folder_name: &str,
    destination: &Path,
) -> Result<Vec<PathBuf>> {
    let (extracted, _) =
        extract_folder_to_root_with_config_policy(archive, folder_name, destination, true)?;
    Ok(extracted)
}

/// Extract a folder from a ZIP archive to a destination, with config preservation.
/// When `force_overwrite_configs` is false, files in `config/` or with config extensions
/// are skipped. Returns (extracted_files, skipped_config_paths).
fn extract_folder_to_root_with_config_policy<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    folder_name: &str,
    destination: &Path,
    force_overwrite_configs: bool,
) -> Result<(Vec<PathBuf>, Vec<String>)> {
    let folder_prefix = format!("{}/", folder_name);
    let mut extracted = Vec::new();
    let mut skipped = Vec::new();

    /// Check if a relative path should be treated as a config file.
    fn is_config_file(rel_path: &str) -> bool {
        let lower = rel_path.to_lowercase();
        if lower.starts_with("config/") || lower.starts_with("config\\") {
            return true;
        }
        let config_exts = [
            ".cfg",
            ".config",
            ".json",
            ".toml",
            ".yml",
            ".yaml",
            ".properties",
            ".txt",
        ];
        config_exts.iter().any(|ext| lower.ends_with(ext))
    }

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_owned();

        if name.starts_with(&folder_prefix) && name != folder_prefix {
            let relative_path_str = name.strip_prefix(&folder_prefix).unwrap();
            let relative_path = PathBuf::from(relative_path_str.replace("\\", "/"));
            let target_path = destination.join(&relative_path);

            if !file.is_dir()
                && !force_overwrite_configs
                && is_config_file(relative_path_str)
                && target_path.exists()
            {
                log::info!(
                    "[extract_overrides] Preserving existing config file: {}",
                    relative_path_str
                );
                skipped.push(relative_path_str.to_string());
                continue;
            }

            if file.is_dir() {
                std::fs::create_dir_all(&target_path)?;
            } else {
                if let Some(parent) = target_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut outfile = File::create(&target_path)?;
                std::io::copy(&mut file, &mut outfile)?;
                extracted.push(relative_path);
            }
        }
    }

    Ok((extracted, skipped))
}
