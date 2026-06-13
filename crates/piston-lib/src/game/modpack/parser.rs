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
    let started = std::time::Instant::now();
    log::info!("[get_modpack_metadata] Opening ZIP: {:?}", path_ref);

    let file = File::open(path_ref)?;
    let mut archive = ZipArchive::new(file)?;
    log::info!(
        "[get_modpack_metadata] ZIP opened, contains {} files",
        archive.len()
    );

    if let Ok(mut file) = archive.by_name("modrinth.index.json") {
        log::info!("[get_modpack_metadata] Found root modrinth.index.json");
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let index = serde_json::from_str::<ModrinthIndex>(&content)
            .map_err(|e| anyhow!("Root modrinth.index.json is invalid: {}", e))?;
        let metadata = metadata_from_modrinth(index);
        log::info!(
            "[get_modpack_metadata] Parsed root Modrinth metadata in {:?}",
            started.elapsed()
        );
        return Ok(metadata);
    }

    if let Ok(mut file) = archive.by_name("manifest.json") {
        log::info!("[get_modpack_metadata] Found root manifest.json");
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let manifest = serde_json::from_str::<CurseForgeManifest>(&content)
            .map_err(|e| anyhow!("Root manifest.json is invalid: {}", e))?;
        let metadata = metadata_from_curseforge(manifest);
        log::info!(
            "[get_modpack_metadata] Parsed root CurseForge metadata in {:?}",
            started.elapsed()
        );
        return Ok(metadata);
    }

    log::warn!(
        "[get_modpack_metadata] No root modpack manifest found in {:?}; nested manifests are not scanned during normal preflight",
        started.elapsed()
    );
    Err(anyhow!(
        "No root modpack metadata found. Expected modrinth.index.json for .mrpack or manifest.json for CurseForge ZIP at the archive root."
    ))
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
        icon_url: None,
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
        icon_url: manifest.image,
        recommended_ram_mb: recommended_ram,
        format: ModpackFormat::CurseForge,
        mods,
        root_prefix: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use zip::write::FileOptions;

    fn write_zip(entries: &[(&str, &str)]) -> NamedTempFile {
        let file = NamedTempFile::new().expect("create temp zip");
        {
            let writer = std::fs::File::create(file.path()).expect("open temp zip");
            let mut zip = zip::ZipWriter::new(writer);
            for (name, content) in entries {
                zip.start_file::<&str, ()>(*name, FileOptions::default())
                    .expect("start zip file");
                zip.write_all(content.as_bytes()).expect("write zip file");
            }
            zip.finish().expect("finish zip");
        }
        file
    }

    #[test]
    fn parses_root_modrinth_pack() {
        let zip = write_zip(&[(
            "modrinth.index.json",
            r#"{
                "formatVersion": 1,
                "game": "minecraft",
                "versionId": "1.0.0",
                "name": "Root MR Pack",
                "files": [],
                "dependencies": {
                    "minecraft": "1.20.1",
                    "fabric-loader": "0.15.0"
                }
            }"#,
        )]);

        let metadata = get_modpack_metadata(zip.path()).expect("parse root mrpack");

        assert_eq!(metadata.name, "Root MR Pack");
        assert_eq!(metadata.format, ModpackFormat::Modrinth);
        assert_eq!(metadata.minecraft_version, "1.20.1");
        assert_eq!(metadata.modloader_type, "fabric");
        assert_eq!(metadata.root_prefix, None);
    }

    #[test]
    fn parses_root_curseforge_pack() {
        let zip = write_zip(&[(
            "manifest.json",
            r#"{
                "minecraft": {
                    "version": "1.20.1",
                    "modLoaders": [{ "id": "forge-47.2.0", "primary": true }]
                },
                "manifestType": "minecraftModpack",
                "manifestVersion": 1,
                "name": "Root CF Pack",
                "version": "2.0.0",
                "author": "Vesta",
                "image": "https://media.forgecdn.net/avatars/example.gif",
                "files": [],
                "overrides": "overrides"
            }"#,
        )]);

        let metadata = get_modpack_metadata(zip.path()).expect("parse root curseforge pack");

        assert_eq!(metadata.name, "Root CF Pack");
        assert_eq!(metadata.format, ModpackFormat::CurseForge);
        assert_eq!(metadata.minecraft_version, "1.20.1");
        assert_eq!(metadata.modloader_type, "forge");
        assert_eq!(metadata.modloader_version.as_deref(), Some("47.2.0"));
        assert_eq!(
            metadata.icon_url.as_deref(),
            Some("https://media.forgecdn.net/avatars/example.gif")
        );
        assert_eq!(metadata.root_prefix, None);
    }

    #[test]
    fn rejects_nested_only_manifest_without_scanning_for_compatibility() {
        let zip = write_zip(&[(
            "wrapped/modrinth.index.json",
            r#"{
                "formatVersion": 1,
                "game": "minecraft",
                "versionId": "1.0.0",
                "name": "Nested MR Pack",
                "files": [],
                "dependencies": { "minecraft": "1.20.1" }
            }"#,
        )]);

        let err = get_modpack_metadata(zip.path()).expect_err("nested manifest should fail");
        assert!(
            err.to_string().contains("No root modpack metadata found"),
            "unexpected error: {err}"
        );
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
            let relative_path_str = relative_path_str.replace('\\', "/");
            if crate::utils::paths::validate_relative_path(&relative_path_str).is_err() {
                log::warn!(
                    "[extract_overrides] Skipping ZIP entry with unsafe path: {}",
                    relative_path_str
                );
                continue;
            }
            let relative_path = PathBuf::from(&relative_path_str);
            let target_path = destination.join(&relative_path);

            if !file.is_dir()
                && !force_overwrite_configs
                && is_config_file(&relative_path_str)
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

/// List relative paths of override files inside a modpack ZIP without extracting.
pub fn list_override_paths<P: AsRef<Path>>(zip_path: P) -> Result<Vec<String>> {
    let metadata = get_modpack_metadata(&zip_path)?;
    let file = File::open(zip_path.as_ref())?;
    let mut archive = ZipArchive::new(file)?;
    let prefix = detect_modpack_root_prefix(&mut archive)?;

    let mut paths = Vec::new();
    match metadata.format {
        ModpackFormat::Modrinth => {
            paths.extend(list_folder_entries(
                &mut archive,
                &format!("{}overrides", prefix),
            )?);
            paths.extend(list_folder_entries(
                &mut archive,
                &format!("{}client-overrides", prefix),
            )?);
        }
        ModpackFormat::CurseForge => {
            let overrides_folder = read_curseforge_overrides_folder(&mut archive, &prefix)?;
            paths.extend(list_folder_entries(
                &mut archive,
                &format!("{}{}", prefix, overrides_folder),
            )?);
        }
    }

    paths.sort();
    paths.dedup();
    Ok(paths)
}

/// Read a single override file from a modpack ZIP by its game-relative path.
pub fn read_zip_override_entry<P: AsRef<Path>>(
    zip_path: P,
    format: ModpackFormat,
    relative_path: &str,
) -> Result<Vec<u8>> {
    crate::utils::paths::validate_relative_path(relative_path)?;
    let file = File::open(zip_path.as_ref())?;
    let mut archive = ZipArchive::new(file)?;
    let prefix = detect_modpack_root_prefix(&mut archive)?;
    let normalized = relative_path.replace('\\', "/");

    let candidate_folders = match format {
        ModpackFormat::Modrinth => vec![
            format!("{}overrides/{}", prefix, normalized),
            format!("{}client-overrides/{}", prefix, normalized),
        ],
        ModpackFormat::CurseForge => {
            let overrides_folder = read_curseforge_overrides_folder(&mut archive, &prefix)?;
            vec![format!("{}{}/{}", prefix, overrides_folder, normalized)]
        }
    };

    for entry_name in candidate_folders {
        if let Ok(mut file) = archive.by_name(&entry_name) {
            if file.is_dir() {
                continue;
            }
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            return Ok(buf);
        }
    }

    Err(anyhow!(
        "Override entry not found in ZIP: {}",
        relative_path
    ))
}

/// Read override file contents as UTF-8 text.
pub fn read_zip_override_text<P: AsRef<Path>>(
    zip_path: P,
    format: ModpackFormat,
    relative_path: &str,
) -> Result<String> {
    let bytes = read_zip_override_entry(zip_path, format, relative_path)?;
    String::from_utf8(bytes).map_err(|e| anyhow!("Override file is not valid UTF-8: {}", e))
}

/// Compute sha1 hashes for override paths listed inside a modpack ZIP.
pub fn hash_override_paths_from_zip<P: AsRef<Path>>(
    zip_path: P,
    format: ModpackFormat,
    paths: &[String],
) -> Result<std::collections::HashMap<String, String>> {
    use sha1::{Digest, Sha1};

    let mut hashes = std::collections::HashMap::new();
    for path in paths {
        let data = read_zip_override_entry(&zip_path, format, path)?;
        let digest = Sha1::digest(&data);
        hashes.insert(path.to_lowercase(), format!("{:x}", digest));
    }
    Ok(hashes)
}

fn detect_modpack_root_prefix<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<String> {
    for i in 0..archive.len() {
        let name = archive.by_index(i)?.name().to_owned();
        if name == "modrinth.index.json" || name.ends_with("/modrinth.index.json") {
            return Ok(name
                .strip_suffix("modrinth.index.json")
                .unwrap_or("")
                .to_string());
        }
        if name == "manifest.json" || name.ends_with("/manifest.json") {
            return Ok(name.strip_suffix("manifest.json").unwrap_or("").to_string());
        }
    }
    Ok(String::new())
}

fn read_curseforge_overrides_folder<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    prefix: &str,
) -> Result<String> {
    let manifest_name = format!("{}manifest.json", prefix);
    if let Ok(mut file) = archive.by_name(&manifest_name) {
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let manifest: CurseForgeManifest = serde_json::from_str(&content)?;
        return Ok(manifest.overrides);
    }
    Ok("overrides".to_string())
}

fn list_folder_entries<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    folder_name: &str,
) -> Result<Vec<String>> {
    let folder_prefix = format!("{}/", folder_name.trim_end_matches('/'));
    let mut paths = Vec::new();

    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_owned();
        if !name.starts_with(&folder_prefix) || name == folder_prefix {
            continue;
        }
        if file.is_dir() {
            continue;
        }
        let relative = name
            .strip_prefix(&folder_prefix)
            .unwrap_or(&name)
            .replace('\\', "/");
        if !relative.is_empty() && crate::utils::paths::validate_relative_path(&relative).is_ok() {
            paths.push(relative);
        }
    }

    Ok(paths)
}
