use crate::models::instance::{Instance, NewInstance};
use crate::models::java::GlobalJavaPath;
use crate::models::resource::{
    ResourceProject, ResourceType, ResourceVersion, SearchQuery, SourcePlatform,
};
use crate::schema::config::global_java_paths::dsl::{
    global_java_paths, id as gp_id, is_active, major_version,
};
use crate::schema::vesta::instance::dsl::*;
use crate::tasks::installers::modpack::InstallModpackTask;
use crate::tasks::manager::TaskManager;
use crate::tasks::modpack_export::ModpackExportTask;
use crate::utils::config::get_app_config;
use crate::utils::db::{get_config_conn, get_vesta_conn};
use crate::utils::db_manager::get_app_config_dir;
use crate::utils::hash::{calculate_curseforge_fingerprint, calculate_sha1};
use crate::utils::instance_helpers::{compute_unique_name, compute_unique_slug};
use crate::utils::url::normalize_url;
use anyhow::Result;
use diesel::prelude::*;
use lazy_static::lazy_static;
use piston_lib::game::modpack::exporter::{ExportEntry, ExportSpec};
use piston_lib::game::modpack::parser::get_modpack_metadata;
use piston_lib::game::modpack::types::{ModpackFormat, ModpackMetadata};
use serde_json;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};
use tauri::{command, AppHandle, Manager, State};
use tempfile::NamedTempFile;
use zip::ZipArchive;

const MAX_SUMMARY_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_MANIFEST_JSON_BYTES: u64 = 5 * 1024 * 1024;
const MAX_MANIFEST_COMPRESSION_RATIO: u64 = 100;
const MAX_SUMMARY_CACHE_ENTRIES: usize = 24;
const MAX_SUMMARY_CACHE_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_SUMMARY_CACHE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_MANIFEST_MATCH_ARCHIVE_DOWNLOADS: usize = 30;
const MAX_MANIFEST_MATCH_RESULTS: usize = 2;

#[derive(Clone, Debug)]
struct ModpackArchiveCacheEntry {
    path: PathBuf,
    created_at: SystemTime,
    accessed_at: SystemTime,
    size: u64,
}

lazy_static! {
    static ref MODPACK_ARCHIVE_CACHE: Mutex<HashMap<String, ModpackArchiveCacheEntry>> =
        Mutex::new(HashMap::new());
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInfo {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub minecraft_version: String,
    pub modloader: String,
    pub modloader_version: Option<String>,
    pub mod_count: usize,
    pub recommended_ram_mb: Option<u32>,
    pub format: String,
    pub modpack_id: Option<String>,
    pub modpack_version_id: Option<String>,
    pub modpack_platform: Option<String>,
    pub full_metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModpackArchiveSummary {
    pub resource_count: usize,
    pub recommended_ram_mb: Option<u32>,
    pub format: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModpackSourceMatch {
    pub matched: bool,
    pub method: Option<String>,
    pub warning: Option<String>,
    pub modpack_id: Option<String>,
    pub modpack_version_id: Option<String>,
    pub modpack_platform: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub download_count: Option<u64>,
    pub follower_count: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ModpackManifestSignature {
    Modrinth(Vec<String>),
    CurseForge(Vec<String>),
}

#[derive(Clone, Debug)]
struct LocalModpackMatchInput {
    name: String,
    version: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
    format: ModpackFormat,
    signature: ModpackManifestSignature,
    can_hash_archive: bool,
}

fn modpack_info_from_metadata(
    metadata: ModpackMetadata,
    target_id: Option<String>,
    target_platform: Option<String>,
) -> ModpackInfo {
    // `version` is the manifest/display version. `modpack_version_id` is reserved
    // for trusted platform version IDs so manual uploads do not get fake linkage.
    ModpackInfo {
        name: metadata.name.clone(),
        version: metadata.version.clone(),
        author: metadata.author.clone(),
        description: metadata.description.clone(),
        icon_url: metadata.icon_url.clone(),
        minecraft_version: metadata.minecraft_version.clone(),
        modloader: metadata.modloader_type.clone(),
        modloader_version: metadata.modloader_version.clone(),
        mod_count: metadata.mods.len(),
        recommended_ram_mb: metadata.recommended_ram_mb,
        format: format!("{:?}", metadata.format),
        modpack_id: target_id,
        modpack_version_id: None,
        modpack_platform: target_platform,
        full_metadata: Some(metadata),
    }
}

fn archive_cache() -> MutexGuard<'static, HashMap<String, ModpackArchiveCacheEntry>> {
    match MODPACK_ARCHIVE_CACHE.lock() {
        Ok(cache) => cache,
        Err(poisoned) => {
            log::warn!("[modpack-summary-cache] Cache mutex was poisoned; recovering inner state");
            poisoned.into_inner()
        }
    }
}

fn modpack_cache_key(url: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(url.as_bytes());
    hex::encode(hasher.finalize())
}

fn sanitized_url_for_log(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(mut parsed) => {
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string()
        }
        Err(_) => url.to_string(),
    }
}

fn read_root_json_from_zip(zip_path: &Path, entry_name: &str) -> anyhow::Result<serde_json::Value> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut entry = archive
        .by_name(entry_name)
        .map_err(|_| anyhow::anyhow!("Missing root {}", entry_name))?;
    if entry.size() > MAX_MANIFEST_JSON_BYTES {
        return Err(anyhow::anyhow!(
            "Root {} is too large ({} bytes, max {} bytes)",
            entry_name,
            entry.size(),
            MAX_MANIFEST_JSON_BYTES
        ));
    }
    let compressed_size = entry.compressed_size();
    if entry.size() > 0 && compressed_size == 0 {
        return Err(anyhow::anyhow!(
            "Root {} has invalid compressed size metadata",
            entry_name
        ));
    }
    if compressed_size > 0 && entry.size() / compressed_size > MAX_MANIFEST_COMPRESSION_RATIO {
        return Err(anyhow::anyhow!(
            "Root {} compression ratio is too high ({}:{}, max {}:1)",
            entry_name,
            entry.size(),
            compressed_size,
            MAX_MANIFEST_COMPRESSION_RATIO
        ));
    }

    let mut raw = String::new();
    let limit = MAX_MANIFEST_JSON_BYTES + 1;
    (&mut entry).take(limit).read_to_string(&mut raw)?;
    if raw.len() as u64 > MAX_MANIFEST_JSON_BYTES {
        return Err(anyhow::anyhow!(
            "Root {} exceeded {} bytes while reading",
            entry_name,
            MAX_MANIFEST_JSON_BYTES
        ));
    }
    Ok(serde_json::from_str(&raw)?)
}

fn parse_modpack_archive_summary(zip_path: &Path) -> anyhow::Result<ModpackArchiveSummary> {
    if let Ok(index) = read_root_json_from_zip(zip_path, "modrinth.index.json") {
        let resource_count = index
            .get("files")
            .and_then(|files| files.as_array())
            .map(|files| files.len())
            .unwrap_or(0);

        return Ok(ModpackArchiveSummary {
            resource_count,
            recommended_ram_mb: None,
            format: "Modrinth".to_string(),
        });
    }

    if let Ok(manifest) = read_root_json_from_zip(zip_path, "manifest.json") {
        let resource_count = manifest
            .get("files")
            .and_then(|files| files.as_array())
            .map(|files| files.len())
            .unwrap_or(0);
        let recommended_ram_mb = manifest
            .get("minecraft")
            .and_then(|minecraft| minecraft.get("recommendedRam"))
            .and_then(|value| value.as_u64())
            .or_else(|| {
                manifest
                    .get("manifestMemory")
                    .and_then(|value| value.as_u64())
            })
            .or_else(|| manifest.get("memory").and_then(|value| value.as_u64()))
            .and_then(|value| u32::try_from(value).ok());

        return Ok(ModpackArchiveSummary {
            resource_count,
            recommended_ram_mb,
            format: "CurseForge".to_string(),
        });
    }

    Err(anyhow::anyhow!(
        "Invalid modpack archive: expected root modrinth.index.json or manifest.json"
    ))
}

fn read_root_json_from_dir(dir_path: &Path, entry_name: &str) -> anyhow::Result<serde_json::Value> {
    let path = dir_path.join(entry_name);
    let metadata = std::fs::metadata(&path)?;
    if metadata.len() > MAX_MANIFEST_JSON_BYTES {
        return Err(anyhow::anyhow!(
            "Root {} is too large ({} bytes, max {} bytes)",
            entry_name,
            metadata.len(),
            MAX_MANIFEST_JSON_BYTES
        ));
    }

    let mut file = File::open(&path)?;
    let mut raw = String::new();
    (&mut file)
        .take(MAX_MANIFEST_JSON_BYTES + 1)
        .read_to_string(&mut raw)?;
    if raw.len() as u64 > MAX_MANIFEST_JSON_BYTES {
        return Err(anyhow::anyhow!(
            "Root {} exceeded {} bytes while reading",
            entry_name,
            MAX_MANIFEST_JSON_BYTES
        ));
    }
    Ok(serde_json::from_str(&raw)?)
}

fn read_root_json_from_modpack_path(
    path: &Path,
    entry_name: &str,
) -> anyhow::Result<serde_json::Value> {
    if path.is_dir() {
        read_root_json_from_dir(path, entry_name)
    } else {
        read_root_json_from_zip(path, entry_name)
    }
}

fn sorted_modrinth_signature(index: &serde_json::Value) -> anyhow::Result<Vec<String>> {
    let files = index
        .get("files")
        .and_then(|files| files.as_array())
        .ok_or_else(|| anyhow::anyhow!("Modrinth manifest is missing files[]"))?;
    let mut hashes = files
        .iter()
        .filter_map(|file| {
            file.get("hashes")
                .and_then(|hashes| hashes.get("sha1"))
                .and_then(|value| value.as_str())
                .map(|hash| hash.to_lowercase())
        })
        .collect::<Vec<_>>();
    hashes.sort();
    hashes.dedup();
    if hashes.is_empty() && !files.is_empty() {
        return Err(anyhow::anyhow!(
            "Modrinth manifest files[] did not contain SHA1 hashes"
        ));
    }
    Ok(hashes)
}

fn sorted_curseforge_signature(manifest: &serde_json::Value) -> anyhow::Result<Vec<String>> {
    let files = manifest
        .get("files")
        .and_then(|files| files.as_array())
        .ok_or_else(|| anyhow::anyhow!("CurseForge manifest is missing files[]"))?;
    let mut ids = files
        .iter()
        .filter_map(|file| {
            let project_id = file
                .get("projectID")
                .or_else(|| file.get("projectId"))
                .and_then(|value| value.as_u64())?;
            let file_id = file
                .get("fileID")
                .or_else(|| file.get("fileId"))
                .and_then(|value| value.as_u64())?;
            Some(format!("{}:{}", project_id, file_id))
        })
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    if ids.is_empty() && !files.is_empty() {
        return Err(anyhow::anyhow!(
            "CurseForge manifest files[] did not contain projectID/fileID pairs"
        ));
    }
    Ok(ids)
}

fn loader_from_modrinth_dependencies(index: &serde_json::Value) -> Option<String> {
    let deps = index.get("dependencies")?.as_object()?;
    if deps.contains_key("fabric-loader") {
        Some("fabric".to_string())
    } else if deps.contains_key("forge") {
        Some("forge".to_string())
    } else if deps.contains_key("neoforge") {
        Some("neoforge".to_string())
    } else if deps.contains_key("quilt-loader") {
        Some("quilt".to_string())
    } else {
        Some("vanilla".to_string())
    }
}

fn loader_from_curseforge_manifest(manifest: &serde_json::Value) -> Option<String> {
    let loaders = manifest
        .get("minecraft")
        .and_then(|minecraft| minecraft.get("modLoaders"))
        .and_then(|loaders| loaders.as_array())?;
    let loader = loaders
        .iter()
        .find(|loader| {
            loader
                .get("primary")
                .and_then(|primary| primary.as_bool())
                .unwrap_or(false)
        })
        .or_else(|| loaders.first())?;
    let loader_id = loader.get("id").and_then(|value| value.as_str())?;
    Some(
        loader_id
            .split('-')
            .next()
            .unwrap_or(loader_id)
            .to_ascii_lowercase()
            .replace("fabric-loader", "fabric"),
    )
}

fn local_match_input_from_path(path: &Path) -> anyhow::Result<LocalModpackMatchInput> {
    if let Ok(index) = read_root_json_from_modpack_path(path, "modrinth.index.json") {
        let deps = index
            .get("dependencies")
            .and_then(|dependencies| dependencies.as_object());
        let local_minecraft_version = deps
            .and_then(|deps| deps.get("minecraft"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let pack_name = index
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown Modpack")
            .to_string();
        let version = index
            .get("versionId")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();
        return Ok(LocalModpackMatchInput {
            name: pack_name,
            version,
            minecraft_version: local_minecraft_version,
            loader: loader_from_modrinth_dependencies(&index),
            format: ModpackFormat::Modrinth,
            signature: ModpackManifestSignature::Modrinth(sorted_modrinth_signature(&index)?),
            can_hash_archive: path.is_file(),
        });
    }

    if let Ok(manifest) = read_root_json_from_modpack_path(path, "manifest.json") {
        let local_minecraft_version = manifest
            .get("minecraft")
            .and_then(|minecraft| minecraft.get("version"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let pack_name = manifest
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown Modpack")
            .to_string();
        let version = manifest
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();
        return Ok(LocalModpackMatchInput {
            name: pack_name,
            version,
            minecraft_version: local_minecraft_version,
            loader: loader_from_curseforge_manifest(&manifest),
            format: ModpackFormat::CurseForge,
            signature: ModpackManifestSignature::CurseForge(sorted_curseforge_signature(
                &manifest,
            )?),
            can_hash_archive: path.is_file(),
        });
    }

    Err(anyhow::anyhow!(
        "No root modpack metadata found. Expected modrinth.index.json or manifest.json."
    ))
}

fn manifest_signature_from_archive(path: &Path) -> anyhow::Result<ModpackManifestSignature> {
    if let Ok(index) = read_root_json_from_zip(path, "modrinth.index.json") {
        return Ok(ModpackManifestSignature::Modrinth(
            sorted_modrinth_signature(&index)?,
        ));
    }
    if let Ok(manifest) = read_root_json_from_zip(path, "manifest.json") {
        return Ok(ModpackManifestSignature::CurseForge(
            sorted_curseforge_signature(&manifest)?,
        ));
    }
    Err(anyhow::anyhow!(
        "Candidate archive has no root modpack manifest"
    ))
}

fn normalize_match_name(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn match_result_from_project_version(
    project: ResourceProject,
    version: ResourceVersion,
    method: &str,
) -> ModpackSourceMatch {
    let platform = match project.source {
        SourcePlatform::Modrinth => "modrinth",
        SourcePlatform::CurseForge => "curseforge",
    };
    ModpackSourceMatch {
        matched: true,
        method: Some(method.to_string()),
        warning: None,
        modpack_id: Some(project.id),
        modpack_version_id: Some(version.id),
        modpack_platform: Some(platform.to_string()),
        name: Some(project.name),
        version: Some(version.version_number),
        author: Some(project.author),
        description: Some(project.summary),
        icon_url: project.icon_url,
        download_count: Some(project.download_count),
        follower_count: Some(project.follower_count),
    }
}

fn no_match_result(warning: impl Into<String>) -> ModpackSourceMatch {
    ModpackSourceMatch {
        matched: false,
        method: None,
        warning: Some(warning.into()),
        modpack_id: None,
        modpack_version_id: None,
        modpack_platform: None,
        name: None,
        version: None,
        author: None,
        description: None,
        icon_url: None,
        download_count: None,
        follower_count: None,
    }
}

fn calculate_sha512(path: &Path) -> anyhow::Result<String> {
    use sha2::{Digest as Sha2Digest, Sha512};
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha512::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn get_modrinth_match_by_file_hash(
    resource_manager: &crate::resources::ResourceManager,
    hash: &str,
    algorithm: &str,
) -> Option<ModpackSourceMatch> {
    if algorithm == "sha1" {
        match resource_manager
            .get_by_hash(SourcePlatform::Modrinth, hash)
            .await
        {
            Ok((project, version)) if project.resource_type == ResourceType::Modpack => {
                return Some(match_result_from_project_version(
                    project,
                    version,
                    "exact-file-hash",
                ));
            }
            Ok((project, _)) => {
                log::info!(
                    "[modpack-match] Modrinth exact hash matched non-modpack project {}; ignoring",
                    project.id
                );
                return None;
            }
            Err(err) => {
                log::info!(
                    "[modpack-match] Modrinth exact archive SHA1 did not match: {}",
                    err
                );
            }
        }
    }

    let url = format!(
        "https://api.modrinth.com/v2/version_file/{}?algorithm={}",
        hash, algorithm
    );
    let response = match piston_lib::client::shared_client().get(&url).send().await {
        Ok(response) => response,
        Err(err) => {
            log::info!(
                "[modpack-match] Modrinth {} lookup request failed: {}",
                algorithm,
                err
            );
            return None;
        }
    };
    if !response.status().is_success() {
        log::info!(
            "[modpack-match] Modrinth {} lookup returned {}",
            algorithm,
            response.status()
        );
        return None;
    }

    let version_json: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(err) => {
            log::warn!(
                "[modpack-match] Modrinth {} lookup JSON decode failed: {}",
                algorithm,
                err
            );
            return None;
        }
    };
    let project_id = version_json
        .get("project_id")
        .and_then(|value| value.as_str())?;
    let version_id = version_json.get("id").and_then(|value| value.as_str())?;
    let project = match resource_manager
        .get_project(SourcePlatform::Modrinth, project_id)
        .await
    {
        Ok(project) if project.resource_type == ResourceType::Modpack => project,
        Ok(project) => {
            log::info!(
                "[modpack-match] Modrinth {} lookup matched non-modpack project {}; ignoring",
                algorithm,
                project.id
            );
            return None;
        }
        Err(err) => {
            log::warn!(
                "[modpack-match] Failed to hydrate Modrinth project {}: {}",
                project_id,
                err
            );
            return None;
        }
    };
    let version = match resource_manager
        .get_version(SourcePlatform::Modrinth, project_id, version_id)
        .await
    {
        Ok(version) => version,
        Err(err) => {
            log::warn!(
                "[modpack-match] Failed to hydrate Modrinth version {}: {}",
                version_id,
                err
            );
            return None;
        }
    };
    Some(match_result_from_project_version(
        project,
        version,
        "exact-file-hash",
    ))
}

fn is_fresh_cache_entry(entry: &ModpackArchiveCacheEntry, now: SystemTime) -> bool {
    if !entry.path.exists() || entry.size > MAX_SUMMARY_ARCHIVE_BYTES {
        return false;
    }

    let access_is_fresh = now
        .duration_since(entry.accessed_at)
        .map(|age| age <= MAX_SUMMARY_CACHE_AGE)
        .unwrap_or(true);
    let creation_is_fresh = now
        .duration_since(entry.created_at)
        .map(|age| age <= MAX_SUMMARY_CACHE_AGE)
        .unwrap_or(true);

    access_is_fresh && creation_is_fresh
}

fn prune_summary_archive_cache(cache_dir: &Path) {
    let now = SystemTime::now();
    let mut paths_to_remove = Vec::new();
    let mut tracked_paths = Vec::new();

    {
        let mut cache = archive_cache();
        cache.retain(|key, entry| {
            let keep = is_fresh_cache_entry(entry, now);
            if !keep {
                log::info!(
                    "[modpack-summary-cache] Pruning stale entry cache_key={} path={:?}",
                    key,
                    entry.path
                );
                paths_to_remove.push(entry.path.clone());
            }
            keep
        });

        if cache.len() > MAX_SUMMARY_CACHE_ENTRIES {
            let mut entries: Vec<(String, SystemTime, PathBuf)> = cache
                .iter()
                .map(|(key, entry)| (key.clone(), entry.accessed_at, entry.path.clone()))
                .collect();
            entries.sort_by_key(|(_, accessed_at, _)| *accessed_at);
            let remove_count = cache.len().saturating_sub(MAX_SUMMARY_CACHE_ENTRIES);
            for (key, _, path) in entries.into_iter().take(remove_count) {
                cache.remove(&key);
                log::info!(
                    "[modpack-summary-cache] Pruning LRU entry over count budget cache_key={} path={:?}",
                    key,
                    path
                );
                paths_to_remove.push(path);
            }
        }

        let mut total_size: u64 = cache.values().map(|entry| entry.size).sum();
        if total_size > MAX_SUMMARY_CACHE_BYTES {
            let mut entries: Vec<(String, SystemTime, PathBuf, u64)> = cache
                .iter()
                .map(|(key, entry)| {
                    (
                        key.clone(),
                        entry.accessed_at,
                        entry.path.clone(),
                        entry.size,
                    )
                })
                .collect();
            entries.sort_by_key(|(_, accessed_at, _, _)| *accessed_at);

            for (key, _, path, size) in entries {
                if total_size <= MAX_SUMMARY_CACHE_BYTES {
                    break;
                }
                cache.remove(&key);
                total_size = total_size.saturating_sub(size);
                log::info!(
                    "[modpack-summary-cache] Pruning LRU entry over size budget cache_key={} size={} path={:?}",
                    key,
                    size,
                    path
                );
                paths_to_remove.push(path);
            }
        }

        tracked_paths.extend(cache.values().map(|entry| entry.path.clone()));
    }

    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|entry_name| entry_name.to_str())
            else {
                continue;
            };
            if !(file_name.starts_with("summary_")
                && (file_name.ends_with(".zip") || file_name.ends_with(".zip.part")))
            {
                continue;
            }
            let expired = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > MAX_SUMMARY_CACHE_AGE);
            let untracked = !tracked_paths.iter().any(|tracked| tracked == &path);
            if expired || untracked || file_name.ends_with(".zip.part") {
                log::info!(
                    "[modpack-summary-cache] Pruning cache file expired={} untracked={} path={:?}",
                    expired,
                    untracked,
                    path
                );
                paths_to_remove.push(path);
            }
        }
    }

    for path in paths_to_remove {
        if let Err(err) = std::fs::remove_file(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "[modpack-summary-cache] Failed to remove stale cache file {:?}: {}",
                    path,
                    err
                );
            }
        }
    }
}

fn take_cached_archive(cache_key: &str) -> Option<PathBuf> {
    let now = SystemTime::now();
    let mut cache = archive_cache();
    let entry = cache.get_mut(cache_key)?;
    if !is_fresh_cache_entry(entry, now) {
        let stale_path = entry.path.clone();
        cache.remove(cache_key);
        drop(cache);
        log::info!(
            "[modpack-summary-cache] Removing stale cache entry cache_key={} path={:?}",
            cache_key,
            stale_path
        );
        let _ = std::fs::remove_file(stale_path);
        return None;
    }

    entry.accessed_at = now;
    Some(entry.path.clone())
}

fn insert_cached_archive(cache_key: String, path: PathBuf, size: u64) {
    let now = SystemTime::now();
    let mut cache = archive_cache();
    cache.insert(
        cache_key,
        ModpackArchiveCacheEntry {
            path,
            created_at: now,
            accessed_at: now,
            size,
        },
    );
}

async fn get_or_download_summary_archive(
    app: &AppHandle,
    url: &str,
) -> Result<(String, PathBuf), String> {
    let client = piston_lib::client::shared_client();
    let (final_url, _) = resolve_modpack_resource(client, url).await;
    let cache_key = modpack_cache_key(&final_url);
    let safe_final_url = sanitized_url_for_log(&final_url);
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Could not resolve cache directory: {}", e))?
        .join("modpacks");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| format!("Could not create cache directory: {}", e))?;
    prune_summary_archive_cache(&cache_dir);

    if let Some(cached_path) = take_cached_archive(&cache_key) {
        let validation_path = cached_path.clone();
        match run_blocking_modpack_io("validate cached modpack archive", move || {
            let size = std::fs::metadata(&validation_path)?.len();
            if size > MAX_SUMMARY_ARCHIVE_BYTES {
                return Err(anyhow::anyhow!(
                    "Cached archive is too large ({} bytes, max {} bytes)",
                    size,
                    MAX_SUMMARY_ARCHIVE_BYTES
                ));
            }
            parse_modpack_archive_summary(&validation_path).map(|_| ())
        })
        .await
        {
            Ok(()) => {
                log::info!(
                    "[modpack-summary-cache] Reusing cached archive cache_key={} final_url={} path={:?}",
                    cache_key,
                    safe_final_url,
                    cached_path
                );
                return Ok((final_url, cached_path));
            }
            Err(err) => {
                log::warn!(
                    "[modpack-summary-cache] Ignoring invalid cached archive cache_key={} final_url={} path={:?}: {}",
                    cache_key,
                    safe_final_url,
                    cached_path,
                    err
                );
                archive_cache().remove(&cache_key);
                let _ = std::fs::remove_file(cached_path);
            }
        }
    }

    let archive_path = cache_dir.join(format!("summary_{}.zip", cache_key));
    let partial_path = cache_dir.join(format!("summary_{}.zip.part", cache_key));
    let response = client
        .get(&final_url)
        .send()
        .await
        .map_err(|e| format!("Could not download modpack archive: {}", e))?;
    log::info!(
        "[modpack-summary-cache] Downloading archive cache_key={} final_url={}",
        cache_key,
        safe_final_url
    );

    if !response.status().is_success() {
        return Err(format!(
            "Could not download modpack archive: {}",
            response.status()
        ));
    }

    if let Some(content_length) = response.content_length() {
        if content_length > MAX_SUMMARY_ARCHIVE_BYTES {
            return Err(format!(
                "Modpack archive is too large for summary enrichment ({} bytes, max {} bytes)",
                content_length, MAX_SUMMARY_ARCHIVE_BYTES
            ));
        }
    }

    let download_result: Result<u64, String> = async {
        let mut file = tokio::fs::File::create(&partial_path)
            .await
            .map_err(|e| format!("Could not create modpack archive cache: {}", e))?;
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("Modpack archive stream error: {}", e))?;
            downloaded += chunk.len() as u64;
            if downloaded > MAX_SUMMARY_ARCHIVE_BYTES {
                return Err(format!(
                    "Modpack archive exceeded summary limit ({} bytes, max {} bytes)",
                    downloaded, MAX_SUMMARY_ARCHIVE_BYTES
                ));
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Could not write modpack archive cache: {}", e))?;
        }
        file.flush()
            .await
            .map_err(|e| format!("Could not flush modpack archive cache: {}", e))?;
        Ok(downloaded)
    }
    .await;

    let downloaded = match download_result {
        Ok(downloaded) => downloaded,
        Err(err) => {
            let _ = tokio::fs::remove_file(&partial_path).await;
            return Err(err);
        }
    };

    let validation_path = partial_path.clone();
    if let Err(err) = run_blocking_modpack_io("validate downloaded modpack archive", move || {
        parse_modpack_archive_summary(&validation_path).map(|_| ())
    })
    .await
    {
        let _ = tokio::fs::remove_file(&partial_path).await;
        return Err(err);
    }

    let _ = tokio::fs::remove_file(&archive_path).await;
    if let Err(err) = tokio::fs::rename(&partial_path, &archive_path).await {
        let _ = tokio::fs::remove_file(&partial_path).await;
        return Err(format!("Could not finalize modpack archive cache: {}", err));
    }

    insert_cached_archive(cache_key.clone(), archive_path.clone(), downloaded);
    log::info!(
        "[modpack-summary-cache] Cached archive cache_key={} final_url={} size={} path={:?}",
        cache_key,
        safe_final_url,
        downloaded,
        archive_path
    );
    prune_summary_archive_cache(&cache_dir);
    Ok((final_url, archive_path))
}

async fn try_exact_archive_match(
    path: &Path,
    input: &LocalModpackMatchInput,
    resource_manager: &crate::resources::ResourceManager,
) -> Option<ModpackSourceMatch> {
    if !input.can_hash_archive {
        return None;
    }

    match input.format {
        ModpackFormat::Modrinth => {
            let hash_path = path.to_path_buf();
            let sha1 = match run_blocking_modpack_io("hash local Modrinth archive", move || {
                calculate_sha1(&hash_path)
            })
            .await
            {
                Ok(hash) => hash,
                Err(err) => {
                    log::warn!("[modpack-match] Modrinth archive SHA1 failed: {}", err);
                    return None;
                }
            };

            if let Some(match_result) =
                get_modrinth_match_by_file_hash(resource_manager, &sha1, "sha1").await
            {
                return Some(match_result);
            }

            let sha512_path = path.to_path_buf();
            let sha512 =
                match run_blocking_modpack_io("hash local Modrinth archive sha512", move || {
                    calculate_sha512(&sha512_path)
                })
                .await
                {
                    Ok(hash) => hash,
                    Err(err) => {
                        log::debug!(
                            "[modpack-match] Optional Modrinth archive SHA512 failed: {}",
                            err
                        );
                        return None;
                    }
                };
            if let Some(match_result) =
                get_modrinth_match_by_file_hash(resource_manager, &sha512, "sha512").await
            {
                return Some(match_result);
            }
        }
        ModpackFormat::CurseForge => {
            let fingerprint_path = path.to_path_buf();
            let fingerprint =
                match run_blocking_modpack_io("fingerprint local CurseForge archive", move || {
                    calculate_curseforge_fingerprint(&fingerprint_path)
                })
                .await
                {
                    Ok(fingerprint) => fingerprint,
                    Err(err) => {
                        log::warn!(
                            "[modpack-match] CurseForge archive fingerprint failed: {}",
                            err
                        );
                        return None;
                    }
                };

            match resource_manager
                .get_by_hash(SourcePlatform::CurseForge, &fingerprint.to_string())
                .await
            {
                Ok((project, version)) if project.resource_type == ResourceType::Modpack => {
                    return Some(match_result_from_project_version(
                        project,
                        version,
                        "exact-file-fingerprint",
                    ));
                }
                Ok((project, _)) => {
                    log::info!(
                        "[modpack-match] CurseForge exact fingerprint matched non-modpack project {}; ignoring",
                        project.id
                    );
                }
                Err(err) => {
                    log::info!(
                        "[modpack-match] CurseForge exact archive fingerprint did not match: {}",
                        err
                    );
                }
            }
        }
    }

    None
}

async fn match_by_manifest_signature(
    app: &AppHandle,
    input: &LocalModpackMatchInput,
    resource_manager: &crate::resources::ResourceManager,
) -> Result<ModpackSourceMatch, String> {
    let platform = match input.format {
        ModpackFormat::Modrinth => SourcePlatform::Modrinth,
        ModpackFormat::CurseForge => SourcePlatform::CurseForge,
    };
    let loader = input
        .loader
        .as_deref()
        .filter(|loader| !loader.eq_ignore_ascii_case("vanilla"));

    let query = SearchQuery {
        text: Some(input.name.clone()),
        resource_type: ResourceType::Modpack,
        game_version: input.minecraft_version.clone(),
        loader: loader.map(|loader| loader.to_string()),
        limit: 10,
        sort_by: Some("relevance".to_string()),
        ..Default::default()
    };

    let search = resource_manager
        .search(platform, query)
        .await
        .map_err(|e| format!("Modpack source search failed: {}", e))?;
    let target_name = normalize_match_name(&input.name);
    let mut matches: Vec<(ResourceProject, ResourceVersion)> = Vec::new();
    let mut checked_candidate_archives = 0usize;

    for project in search
        .hits
        .into_iter()
        .filter(|project| project.resource_type == ResourceType::Modpack)
        .filter(|project| normalize_match_name(&project.name) == target_name)
        .take(5)
    {
        let versions = match resource_manager
            .get_versions(
                platform,
                &project.id,
                false,
                input.minecraft_version.as_deref(),
                loader,
            )
            .await
        {
            Ok(versions) => versions,
            Err(err) => {
                log::warn!(
                    "[modpack-match] Failed to fetch candidate versions for {}: {}",
                    project.id,
                    err
                );
                continue;
            }
        };

        let mut versions = versions;
        versions.sort_by_key(|version| {
            !version
                .version_number
                .eq_ignore_ascii_case(input.version.as_str())
        });

        for version in versions {
            if checked_candidate_archives >= MAX_MANIFEST_MATCH_ARCHIVE_DOWNLOADS {
                log::info!(
                    "[modpack-match] Reached manifest match candidate cap ({})",
                    MAX_MANIFEST_MATCH_ARCHIVE_DOWNLOADS
                );
                break;
            }
            checked_candidate_archives += 1;

            let download_url = version.download_url.clone();
            let archive_path = match get_or_download_summary_archive(app, &download_url).await {
                Ok((resolved_url, path)) => {
                    log::debug!(
                        "[modpack-match] Checking candidate archive project={} version={} version_number={} final_url={}",
                        project.id,
                        version.id,
                        version.version_number,
                        sanitized_url_for_log(&resolved_url)
                    );
                    path
                }
                Err(err) => {
                    log::debug!(
                        "[modpack-match] Failed to cache candidate archive {} {}: {}",
                        project.id,
                        version.id,
                        err
                    );
                    continue;
                }
            };

            let candidate_path = archive_path.clone();
            let candidate_signature =
                match run_blocking_modpack_io("parse candidate modpack signature", move || {
                    manifest_signature_from_archive(&candidate_path)
                })
                .await
                {
                    Ok(signature) => signature,
                    Err(err) => {
                        log::debug!(
                            "[modpack-match] Failed to parse candidate signature {} {}: {}",
                            project.id,
                            version.id,
                            err
                        );
                        continue;
                    }
                };

            if candidate_signature == input.signature {
                matches.push((project.clone(), version));
                if matches.len() >= MAX_MANIFEST_MATCH_RESULTS {
                    log::info!(
                        "[modpack-match] Found {} exact manifest matches; stopping candidate scan",
                        matches.len()
                    );
                    break;
                }
            }
        }

        if checked_candidate_archives >= MAX_MANIFEST_MATCH_ARCHIVE_DOWNLOADS
            || matches.len() >= MAX_MANIFEST_MATCH_RESULTS
        {
            break;
        }
    }

    if matches.len() == 1 {
        let (project, version) = matches.remove(0);
        return Ok(match_result_from_project_version(
            project,
            version,
            "exact-manifest-signature",
        ));
    }

    if matches.len() > 1 {
        return Ok(no_match_result(format!(
            "Found {} exact manifest matches; leaving this upload local to avoid linking the wrong project.",
            matches.len()
        )));
    }

    Ok(no_match_result("No exact online source match found."))
}

async fn run_blocking_modpack_io<T, F>(label: &'static str, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    let started = Instant::now();
    let result = tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("{} worker failed: {}", label, e))?
        .map_err(|e| e.to_string());
    log::info!(
        "[modpack-preflight] {} finished in {:?}",
        label,
        started.elapsed()
    );
    result
}

#[command]
pub async fn get_modpack_info(
    path: String,
    target_id: Option<String>,
    target_platform: Option<String>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
) -> Result<ModpackInfo, String> {
    let res = (async {
        let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err("File does not exist".to_string());
    }

    let metadata_path = path_buf.clone();
    let metadata = run_blocking_modpack_io("parse local modpack metadata", move || {
        get_modpack_metadata(&metadata_path)
            .map_err(|e| anyhow::anyhow!("Failed to parse modpack: {}", e))
    })
    .await?;

    log::info!("[get_modpack_info] Parsed metadata: name={}, version={}, mc={}, loader={:?}, loader_ver={:?}",
        metadata.name, metadata.version, metadata.minecraft_version, metadata.modloader_type, metadata.modloader_version);

    let mut info = modpack_info_from_metadata(metadata, target_id.clone(), target_platform.clone());

    // If we already know the platform and ID, we can skip the heavy identification logic
    if let (Some(tid), Some(tplatform)) = (&target_id, &target_platform) {
        log::info!(
            "[get_modpack_info] Using provided platform info, skipping fingerprinting: {}/{}",
            tplatform,
            tid
        );

        // However, we still might want to fetch project details (icon, summary) if they are missing
        let platform_enum = match tplatform.to_lowercase().as_str() {
            "curseforge" => Some(SourcePlatform::CurseForge),
            "modrinth" => Some(SourcePlatform::Modrinth),
            _ => None,
        };

        if let Some(p) = platform_enum {
            if let Ok(proj) = resource_manager.get_project(p, tid).await {
                if info.icon_url.is_none() {
                    info.icon_url = proj.icon_url;
                }
                if info.description.is_none() {
                    info.description = Some(proj.summary);
                }
            }
        }
        return Ok(info);
    }

    log::info!(
        "[get_modpack_info] Manual upload has no trusted source id; using local {} manifest metadata and skipping whole-pack source matching",
        info.format
    );
    Ok(info)
}).await;

    let info_val = res.map_err(|e| e.to_string())?;
    Ok(info_val)
}

#[command]
pub async fn get_system_memory_mb() -> Result<u64, String> {
    Ok(piston_lib::utils::hardware::get_total_memory_mb())
}

#[command]
pub async fn get_hardware_info() -> Result<u64, String> {
    Ok(piston_lib::utils::hardware::get_total_memory_mb())
}

async fn resolve_modpack_resource(client: &reqwest::Client, url: &str) -> (String, Option<String>) {
    let mut final_url = url.to_string();
    let mut icon_url = None;

    // Modrinth Support
    if url.contains("modrinth.com/") {
        let mut target_version_id = None;
        let mut slug = None;

        // 1. Try to extract Version ID or Slug from various Modrinth URL patterns
        if url.contains("api.modrinth.com/v2/version/") {
            target_version_id = url
                .split("api.modrinth.com/v2/version/")
                .nth(1)
                .and_then(|s| s.split('?').next())
                .map(|s| s.to_string());
        } else if url.contains("cdn.modrinth.com/data/") {
            target_version_id = url
                .split("/versions/")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());
            log::info!(
                "[resolve_modpack_resource] Detected direct CDN link, extracted version ID: {:?}",
                target_version_id
            );
        } else {
            let pattern = if url.contains("modrinth.com/modpack/") {
                "modrinth.com/modpack/"
            } else {
                "modrinth.com/project/"
            };
            slug = url
                .split(pattern)
                .nth(1)
                .and_then(|s| s.split('?').next())
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());

            if url.contains("/version/") {
                target_version_id = url
                    .split("/version/")
                    .nth(1)
                    .and_then(|s| s.split('?').next())
                    .map(|s| s.to_string());
            } else if let Some(q) = url.split('?').nth(1) {
                target_version_id = q
                    .split('&')
                    .find(|p| p.starts_with("version="))
                    .map(|p| p.replace("version=", ""));
            }
        }

        // 2. Obtain Version Data
        let version_json = if let Some(vid) = target_version_id {
            let ver_api_url = format!("https://api.modrinth.com/v2/version/{}", vid);
            client.get(&ver_api_url).send().await.ok().and_then(|r| {
                if r.status().is_success() {
                    Some(r)
                } else {
                    None
                }
            })
        } else if let Some(slug_str) = slug {
            let versions_url = format!("https://api.modrinth.com/v2/project/{}/version", slug_str);
            client.get(&versions_url).send().await.ok().and_then(|r| {
                if r.status().is_success() {
                    Some(r)
                } else {
                    None
                }
            })
        } else {
            None
        };

        if let Some(resp) = version_json {
            if let Ok(json_val) = resp.json::<serde_json::Value>().await {
                // Handle both single version response (from /version/{id}) and array response (from /project/{slug}/version)
                let version = if json_val.is_array() {
                    json_val.as_array().and_then(|arr| arr.first().cloned())
                } else {
                    Some(json_val)
                };

                if let Some(v) = version {
                    // Try to get icon_url if we don't have it (needed for direct version links)
                    if icon_url.is_none() {
                        if let Some(project_id) = v["project_id"].as_str() {
                            let project_url =
                                format!("https://api.modrinth.com/v2/project/{}", project_id);
                            if let Ok(p_resp) = client.get(&project_url).send().await {
                                if let Ok(p_json) = p_resp.json::<serde_json::Value>().await {
                                    icon_url = p_json["icon_url"].as_str().map(|s| s.to_string());
                                }
                            }
                        }
                    }

                    if let Some(files) = v["files"].as_array() {
                        log::debug!(
                            "[resolve_modpack_resource] Version {} has {} files",
                            v["id"].as_str().unwrap_or("?"),
                            files.len()
                        );

                        let filtered: Vec<&serde_json::Value> = files
                            .iter()
                            .filter(|f| {
                                let fname = f["filename"].as_str().unwrap_or("").to_lowercase();
                                !fname.contains("cosign-bundle")
                                    && !fname.ends_with(".asc")
                                    && !fname.ends_with(".sha1")
                                    && !fname.ends_with(".sha512")
                            })
                            .collect();

                        let selected = filtered
                            .iter()
                            .find(|f| f["primary"].as_bool() == Some(true))
                            .or_else(|| filtered.first())
                            .copied();

                        if let Some(file) = selected {
                            if let Some(u) = file["url"].as_str() {
                                final_url = u.to_string();
                                log::info!(
                                    "[resolve_modpack_resource] Selected file: {} (primary: {:?})",
                                    file["filename"].as_str().unwrap_or("?"),
                                    file["primary"].as_bool()
                                );
                            }
                        }
                    }
                }
            }
        }
    } else if url.contains("curseforge.com/") {
        // Attempt to find /files/{id}
        if let Some(file_id_str) = url
            .split("/files/")
            .nth(1)
            .and_then(|s| s.split('?').next())
        {
            if let Ok(file_id) = file_id_str.parse::<u32>() {
                // Typical CurseForge CDN pattern: https://edge.forgecdn.net/files/ID/STR/FILE.zip
                // But since we don't know the filename, it's safer to just return our URL and hope the redirect works,
                // or use the API if we had a key here.
                // For now, we just ensure we have the cleanest possible direct link URL.
                log::info!(
                    "[resolve_modpack_resource] Detected CurseForge file ID: {}",
                    file_id
                );
            }
        }
    }

    log::info!(
        "[resolve_modpack_resource] Final result for {}: {}",
        url,
        final_url
    );
    (final_url, icon_url)
}

#[command]
pub async fn get_modpack_info_from_url(
    url: String,
    target_id: Option<String>,
    target_platform: Option<String>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
) -> Result<ModpackInfo, String> {
    (async {
        log::info!(
            "[get_modpack_info_from_url] Fetching info for: {} (id override: {:?})",
            url,
            target_id
        );
    let client = piston_lib::client::shared_client();

    // Optimization: Try to get metadata from Modrinth API first to avoid downloading large ZIPs
    if url.contains("modrinth.com/") {
        let mut version_id = None;
        let mut slug = None;

        if url.contains("api.modrinth.com/v2/version/") {
            version_id = url
                .split("v2/version/")
                .nth(1)
                .and_then(|s| s.split('?').next())
                .map(|s| s.to_string());
        } else if url.contains("cdn.modrinth.com/data/") {
            version_id = url
                .split("/versions/")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());
        } else {
            let pattern = if url.contains("modrinth.com/modpack/") {
                "modrinth.com/modpack/"
            } else {
                "modrinth.com/project/"
            };
            slug = url
                .split(pattern)
                .nth(1)
                .and_then(|s| s.split('?').next())
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());

            if url.contains("/version/") {
                version_id = url
                    .split("/version/")
                    .nth(1)
                    .and_then(|s| s.split('?').next())
                    .map(|s| s.to_string());
            } else if let Some(q) = url.split('?').nth(1) {
                version_id = q
                    .split('&')
                    .find(|p| p.starts_with("version="))
                    .map(|p| p.replace("version=", ""));
            }
        }

        if version_id.is_some() || slug.is_some() {
            let version_obj = if let Some(vid) = version_id {
                let v_url = format!("https://api.modrinth.com/v2/version/{}", vid);
                if let Ok(r) = client.get(&v_url).send().await {
                    r.json::<serde_json::Value>().await.ok()
                } else {
                    None
                }
            } else if let Some(s) = slug {
                let v_url = format!("https://api.modrinth.com/v2/project/{}/version", s);
                if let Ok(r) = client.get(&v_url).send().await {
                    if let Ok(arr) = r.json::<Vec<serde_json::Value>>().await {
                        arr.first().cloned()
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(v) = version_obj {
                if let Some(pid) = v["project_id"].as_str() {
                    let p_url = format!("https://api.modrinth.com/v2/project/{}", pid);
                    if let Ok(p_resp) = client.get(&p_url).send().await {
                        if let Ok(p) = p_resp.json::<serde_json::Value>().await {
                            return Ok(ModpackInfo {
                                name: p["title"].as_str().unwrap_or("Unknown Modpack").to_string(),
                                description: Some(
                                    p["description"].as_str().unwrap_or("").to_string(),
                                ),
                                version: v["version_number"]
                                    .as_str()
                                    .unwrap_or("1.0.0")
                                    .to_string(),
                                icon_url: p["icon_url"].as_str().map(|s| s.to_string()),
                                author: None,
                                minecraft_version: v["game_versions"]
                                    .as_array()
                                    .and_then(|a| a.first())
                                    .and_then(|g| g.as_str())
                                    .unwrap_or("unknown")
                                    .to_string(),
                                modloader: v["loaders"]
                                    .as_array()
                                    .and_then(|a| a.first())
                                    .and_then(|l| l.as_str())
                                    .unwrap_or("fabric")
                                    .to_string(),
                                modloader_version: None,
                                mod_count: 0,
                                recommended_ram_mb: None,
                                format: "Modrinth".to_string(),
                                modpack_id: Some(pid.to_string()),
                                modpack_version_id: Some(
                                    v["id"].as_str().unwrap_or("").to_string(),
                                ),
                                modpack_platform: Some("modrinth".to_string()),
                                full_metadata: None,
                            });
                        }
                    }
                }
            }
        }
    } else if url.contains("curseforge.com/") {
        log::info!(
            "[get_modpack_info_from_url] Detected CurseForge URL: {}",
            url
        );

        let mut project_id = None;
        let mut version_id = None;

        // Determine resource type from URL
        let mut res_type = crate::models::resource::ResourceType::Modpack;
        if url.contains("/mc-mods/") {
            res_type = crate::models::resource::ResourceType::Mod;
        } else if url.contains("/texture-packs/") || url.contains("/resource-packs/") {
            res_type = crate::models::resource::ResourceType::ResourcePack;
        } else if url.contains("/shaders/") {
            res_type = crate::models::resource::ResourceType::Shader;
        } else if url.contains("/worlds/") {
            res_type = crate::models::resource::ResourceType::World;
        }

        // Extract IDs from URL if possible
        if let Some(vid_str) = url
            .split("/files/")
            .nth(1)
            .and_then(|s| s.split('?').next())
        {
            version_id = vid_str.parse::<i64>().ok();
        }

        // Extract slug more robustly from /minecraft/<class>/<slug>
        let slug = if let Some(parts) = url.split("curseforge.com/minecraft/").nth(1) {
            parts
                .split('/')
                .nth(1) // Skip class segment (e.g. "mc-mods")
                .and_then(|s| s.split('?').next())
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string())
        } else {
            None
        };

        if let Some(ref slug_str) = slug {
            log::info!(
                "[get_modpack_info_from_url] Search for slug: {} (type: {:?})",
                slug_str,
                res_type
            );
            // Search for project by slug
            let query = crate::models::resource::SearchQuery {
                text: Some(slug_str.clone()),
                resource_type: res_type,
                limit: 10,
                ..Default::default()
            };

            if let Ok(res) = resource_manager
                .search(SourcePlatform::CurseForge, query)
                .await
            {
                let slug_lower = slug_str.to_lowercase();
                if let Some(hit) = res.hits.iter().find(|h| {
                    let web_lower = h.web_url.to_lowercase();
                    // Normalize and compare final path segment
                    let normalized_web = normalize_url(&web_lower);
                    if let Some(pos) = normalized_web.rfind('/') {
                        let last = &normalized_web[pos + 1..];
                        return last == slug_lower || last.ends_with(&format!("-{}", slug_lower));
                    }
                    normalized_web == slug_lower || normalized_web.ends_with(&format!("-{}", slug_lower))
                })
                {
                    project_id = Some(hit.id.clone());
                    log::info!(
                        "[get_modpack_info_from_url] Found project match: {} ({})",
                        hit.name,
                        hit.id
                    );
                    if version_id.is_none() {
                        // Get latest version if not specified
                        if let Ok(versions) = resource_manager
                            .get_versions(SourcePlatform::CurseForge, &hit.id, false, None, None)
                            .await
                        {
                            if let Some(v) = versions.first() {
                                version_id = v.id.parse::<i64>().ok();
                            }
                        }
                    }
                } else {
                    log::warn!("[get_modpack_info_from_url] No project match found in search results for slug '{}'", slug_str);
                    for h in &res.hits {
                        log::debug!("  Hit: {} (link: {})", h.name, h.web_url);
                    }
                }
            }
        }

        if let (Some(pid), Some(vid)) = (project_id, version_id) {
            log::info!(
                "[get_modpack_info_from_url] Identified as PID={}, VID={}",
                pid,
                vid
            );
            if let Ok(proj) = resource_manager
                .get_project(SourcePlatform::CurseForge, &pid)
                .await
            {
                if let Ok(ver) = resource_manager
                    .get_version(SourcePlatform::CurseForge, &pid, &vid.to_string())
                    .await
                {
                    log::info!("[get_modpack_info_from_url] Success! Returning ModpackInfo for '{}' version '{}'", proj.name, ver.version_number);
                    return Ok(ModpackInfo {
                        name: proj.name,
                        description: Some(proj.summary),
                        version: ver.version_number,
                        icon_url: proj.icon_url,
                        author: Some(proj.author),
                        minecraft_version: ver.game_versions.first().cloned().unwrap_or_default(),
                        modloader: ver
                            .loaders
                            .first()
                            .cloned()
                            .unwrap_or_default()
                            .to_lowercase(),
                        modloader_version: None,
                        mod_count: 0,
                        recommended_ram_mb: None,
                        format: "CurseForge".to_string(),
                        modpack_id: Some(pid),
                        modpack_version_id: Some(vid.to_string()),
                        modpack_platform: Some("curseforge".to_string()),
                        full_metadata: None,
                    });
                } else {
                    log::error!(
                        "[get_modpack_info_from_url] Failed to fetch version {} for project {}",
                        vid,
                        pid
                    );
                }
            } else {
                log::error!(
                    "[get_modpack_info_from_url] Failed to fetch project {}",
                    pid
                );
            }
        }
    }

    if let (Some(tid), Some(tplatform)) = (target_id.clone(), target_platform.clone()) {
        log::warn!(
            "[get_modpack_info_from_url] Metadata enrichment failed for known project {}/{}; returning route fallback without downloading ZIP",
            tplatform,
            tid
        );

        let platform_enum = match tplatform.to_lowercase().as_str() {
            "curseforge" => Some(SourcePlatform::CurseForge),
            "modrinth" => Some(SourcePlatform::Modrinth),
            _ => None,
        };

        let mut fallback_name = "Unknown Modpack".to_string();
        let mut description = None;
        let mut icon_url = None;
        let mut author = None;

        if let Some(platform) = platform_enum {
            let lookup_started = Instant::now();
            if let Ok(proj) = resource_manager.get_project(platform, &tid).await {
                fallback_name = proj.name;
                description = Some(proj.summary);
                icon_url = proj.icon_url;
                author = Some(proj.author);
            }
            log::info!(
                "[get_modpack_info_from_url] Fallback project lookup finished in {:?}",
                lookup_started.elapsed()
            );
        }

        return Ok(ModpackInfo {
            name: fallback_name,
            description,
            version: "1.0.0".to_string(),
            icon_url,
            author,
            minecraft_version: "unknown".to_string(),
            modloader: "vanilla".to_string(),
            modloader_version: None,
            mod_count: 0,
            recommended_ram_mb: None,
            format: tplatform.clone(),
            modpack_id: Some(tid),
            modpack_version_id: None,
            modpack_platform: Some(tplatform),
            full_metadata: None,
        });
    }

    // Fallback: Download and parse physical ZIP
    let (final_url, icon_url) = resolve_modpack_resource(client, &url).await;
    log::info!(
        "[get_modpack_info_from_url] Falling back to ZIP download. Resolved: {} -> {}",
        url,
        final_url
    );

    let response = client
        .get(&final_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let (mut temp_file, temp_path) = NamedTempFile::new()
        .map_err(|e| e.to_string())?
        .into_parts();

    // Stream body using async chunks to avoid blocking
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut downloaded = 0;
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        std::io::Write::write_all(&mut temp_file, &chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len();
        if downloaded % (1024 * 1024) == 0 {
            log::debug!(
                "[get_modpack_info_from_url] Downloaded {} MB...",
                downloaded / (1024 * 1024)
            );
        }
    }

    log::info!(
        "[get_modpack_info_from_url] Download complete ({} bytes). Parsing ZIP...",
        downloaded
    );
    let mut info = get_modpack_info(
        temp_path.to_string_lossy().to_string(),
        target_id,
        target_platform,
        resource_manager,
    )
    .await?;
    if icon_url.is_some() {
        info.icon_url = icon_url;
    }

    Ok(info)
}).await
}

#[command]
pub async fn match_local_modpack_source(
    app: AppHandle,
    path: String,
    resource_manager: State<'_, crate::resources::ResourceManager>,
) -> Result<ModpackSourceMatch, String> {
    let started = Instant::now();
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err("File does not exist".to_string());
    }

    let input_path = path_buf.clone();
    let input = run_blocking_modpack_io("parse local modpack match signature", move || {
        local_match_input_from_path(&input_path)
    })
    .await?;

    log::info!(
        "[modpack-match] Matching local {} modpack '{}' version '{}' (mc={:?}, loader={:?}, archive_hash={})",
        match input.format {
            ModpackFormat::Modrinth => "Modrinth",
            ModpackFormat::CurseForge => "CurseForge",
        },
        input.name,
        input.version,
        input.minecraft_version,
        input.loader,
        input.can_hash_archive
    );

    if let Some(match_result) =
        try_exact_archive_match(&path_buf, &input, resource_manager.inner()).await
    {
        log::info!(
            "[modpack-match] Exact archive match completed in {:?}",
            started.elapsed()
        );
        return Ok(match_result);
    }

    let result = match_by_manifest_signature(&app, &input, resource_manager.inner()).await?;
    log::info!(
        "[modpack-match] Manifest signature match completed in {:?}: matched={}, method={:?}, warning={:?}",
        started.elapsed(),
        result.matched,
        result.method,
        result.warning
    );
    Ok(result)
}

#[command]
pub async fn get_modpack_archive_summary_from_url(
    app: AppHandle,
    url: String,
) -> Result<ModpackArchiveSummary, String> {
    let started = Instant::now();
    let (final_url, archive_path) = get_or_download_summary_archive(&app, &url).await?;
    let summary_path = archive_path.clone();
    let summary = run_blocking_modpack_io("parse modpack archive summary", move || {
        parse_modpack_archive_summary(&summary_path)
    })
    .await?;
    log::info!(
        "[get_modpack_archive_summary_from_url] Parsed {} resources from {} in {:?}",
        summary.resource_count,
        sanitized_url_for_log(&final_url),
        started.elapsed()
    );
    Ok(summary)
}

async fn prepare_instance(
    app_handle: &AppHandle,
    conn: &mut SqliteConnection,
    instance_data: &Instance,
) -> Result<NewInstance, String> {
    log::info!(
        "[prepare_instance] Incoming instance data: name={}, mc={}, pack_id={:?}, version_id={:?}",
        instance_data.name,
        instance_data.minecraft_version,
        instance_data.modpack_id,
        instance_data.modpack_version_id
    );
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Determine instances root
    let config = get_app_config().map_err(|e| e.to_string())?;
    let app_config_dir = get_app_config_dir().map_err(|e| e.to_string())?;

    let instances_root = if let Some(ref dir) = config.default_game_dir {
        if !dir.is_empty() && dir != "/" {
            PathBuf::from(dir)
        } else {
            app_config_dir.join("instances")
        }
    } else {
        app_config_dir.join("instances")
    };

    // 2. Load existing names/slugs for uniqueness
    let existing: Vec<(String, Option<String>)> = instance
        .select((name, game_directory))
        .load::<(String, Option<String>)>(conn)
        .map_err(|e| format!("DB Error: {}", e))?;

    let mut seen_names = std::collections::HashSet::new();
    let mut seen_slugs = std::collections::HashSet::new();

    for (existing_name, existing_gd) in existing {
        seen_names.insert(existing_name.to_lowercase());
        if let Some(gd) = existing_gd {
            if let Some(s) = Path::new(&gd).file_name().and_then(|f| f.to_str()) {
                seen_slugs.insert(s.to_string());
            }
        }
    }

    // 3. Compute unique name and slug
    let unique_name = compute_unique_name(&instance_data.name, &seen_names);
    let slug = compute_unique_slug(&unique_name, &seen_slugs, &instances_root);
    let gd_str = instances_root.join(&slug).to_string_lossy().to_string();

    // Ensure the game directory exists
    if let Err(e) = std::fs::create_dir_all(&gd_str) {
        log::error!("[prepare_instance] Failed to create game directory: {}", e);
    }

    let mut current_java_path = instance_data.java_path.clone();

    // If no Java path provided, try to find a recommended one from global config
    if current_java_path.is_none() {
        let recommended_major = crate::utils::java::resolve_required_java_major(
            app_handle,
            &instance_data.minecraft_version,
        )
        .await;

        match recommended_major {
            Ok(recommended_major) => {
                if let Ok(mut config_conn) = get_config_conn() {
                    let global_path = global_java_paths
                        .filter(major_version.eq(recommended_major as i32))
                        .order((is_active.desc(), gp_id.desc()))
                        .first::<GlobalJavaPath>(&mut config_conn)
                        .ok();

                    if let Some(gp) = global_path {
                        log::info!(
                            "[prepare_instance] Found recommended Java {:?} path: {}",
                            gp.major_version,
                            gp.path
                        );
                        current_java_path = Some(gp.path);
                    } else {
                        log::info!(
                            "[prepare_instance] No global Java path for {}; instance will use managed Java via use_global_java_path",
                            recommended_major
                        );
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "[prepare_instance] Could not resolve required Java for '{}': {}",
                    instance_data.minecraft_version,
                    e
                );
            }
        }
    }

    // Handle icon downloading if we have a URL but no data
    let mut final_icon_data = instance_data.icon_data.clone();
    let mut final_icon_path = instance_data.icon_path.clone();

    if let Some(ref path) = final_icon_path {
        if path.starts_with("data:image/") {
            log::info!("[prepare_instance] Converting base64 icon to binary data");
            if let Some(base64_part) = path.split(",").collect::<Vec<&str>>().get(1) {
                use base64::{engine::general_purpose, Engine as _};
                if let Ok(bytes) = general_purpose::STANDARD.decode(base64_part) {
                    final_icon_data = Some(bytes);
                    final_icon_path = Some("internal://icon".to_string());
                }
            }
        }
    }

    if instance_data.modpack_icon_url.is_some() && final_icon_data.is_none() {
        if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(
            instance_data.modpack_icon_url.as_ref().unwrap(),
        )
        .await
        {
            log::info!(
                "[prepare_instance] Successfully downloaded icon for offline use ({} bytes)",
                bytes.len()
            );
            final_icon_data = Some(bytes);
        }
    }

    Ok(NewInstance {
        name: unique_name,
        minecraft_version: instance_data.minecraft_version.clone(),
        modloader: instance_data.modloader.clone(),
        modloader_version: instance_data.modloader_version.clone(),
        java_path: current_java_path,
        java_args: instance_data.java_args.clone(),
        game_directory: Some(gd_str),
        game_width: instance_data.game_width,
        game_height: instance_data.game_height,
        min_memory: instance_data.min_memory,
        max_memory: instance_data.max_memory,
        icon_path: final_icon_path,
        last_played: None,
        total_playtime_minutes: 0,
        created_at: Some(now.clone()),
        updated_at: Some(now),
        installation_status: Some("installing".to_string()),
        crashed: Some(false),
        crash_details: None,
        modpack_id: instance_data.modpack_id.clone(),
        modpack_version_id: instance_data.modpack_version_id.clone(),
        modpack_platform: instance_data.modpack_platform.clone(),
        modpack_icon_url: instance_data.modpack_icon_url.clone(),
        icon_data: final_icon_data,
        last_operation: Some("install".to_string()),
        import_source_game_directory: None,
        import_launcher_kind: None,
        import_instance_path: None,
        use_global_resolution: instance_data.use_global_resolution,
        use_global_java_args: instance_data.use_global_java_args,
        use_global_java_path: instance_data.use_global_java_path,
        use_global_hooks: instance_data.use_global_hooks,
        use_global_environment_variables: instance_data.use_global_environment_variables,
        use_global_game_dir: instance_data.use_global_game_dir,
        use_global_launcher_action: instance_data.use_global_launcher_action,
        launcher_action_on_launch: instance_data.launcher_action_on_launch.clone(),
        environment_variables: instance_data.environment_variables.clone(),
        pre_launch_hook: instance_data.pre_launch_hook.clone(),
        wrapper_command: instance_data.wrapper_command.clone(),
        post_exit_hook: instance_data.post_exit_hook.clone(),
    })
}

#[command]
pub async fn install_modpack_from_zip(
    _app: AppHandle,
    zip_path: String,
    instance_data: Instance,
    metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
    task_manager: State<'_, TaskManager>,
) -> Result<i32, String> {
    log::info!(
        "[install_modpack_from_zip] Requested for: {}",
        instance_data.name
    );
    log::info!(
        "[install_modpack_from_zip] Data: MC={}, Loader={:?}, LoaderVersion={:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    let zip_path = PathBuf::from(zip_path);
    if !zip_path.exists() {
        return Err("Modpack ZIP does not exist".to_string());
    }

    let mut conn = get_vesta_conn().map_err(|e| format!("DB Error: {}", e))?;

    let new_inst = prepare_instance(&_app, &mut conn, &instance_data).await?;

    diesel::insert_into(instance)
        .values(&new_inst)
        .execute(&mut conn)
        .map_err(|e| format!("Failed to save instance: {}", e))?;

    let saved_instance = instance
        .order(id.desc())
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to fetch saved instance: {}", e))?;

    // Emit created event so UI home page updates immediately
    use tauri::Emitter;
    let _ = _app.emit("core://instance-created", &saved_instance);

    // 2. Queue Task
    use crate::tasks::installers::modpack::ModpackSource;
    let task = InstallModpackTask::new(
        saved_instance.clone(),
        ModpackSource::Path(zip_path),
        metadata,
    );
    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| e.to_string())?;

    Ok(saved_instance.id)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCandidate {
    pub path: String, // Relative
    pub is_mod: bool,
    pub size: u64,
    pub platform: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub hash: Option<String>,
    pub download_url: Option<String>,
}

#[command]
pub async fn list_export_candidates(instance_id: i32) -> Result<Vec<ExportCandidate>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst = instance
        .filter(id.eq(instance_id))
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let game_dir = PathBuf::from(inst.game_directory.as_ref().ok_or("No game directory")?);
    if !game_dir.exists() {
        return Err("Game directory does not exist".to_string());
    }

    let mut candidates = Vec::new();

    // 1. Scan installed resources (mods, resource packs, shaders, etc.)
    use crate::models::InstalledResource;
    use crate::schema::installed_resource::dsl as res_dsl;

    let installed_resources = res_dsl::installed_resource
        .filter(res_dsl::instance_id.eq(instance_id))
        .load::<InstalledResource>(&mut conn)
        .map_err(|e| e.to_string())?;

    for m in installed_resources {
        let mut rel_path = m.local_path.clone().replace("\\", "/");

        // Ensure path is relative to game_dir
        if let Some(game_dir_str) = game_dir.to_str() {
            let normalized_game_dir = game_dir_str.replace("\\", "/");
            if rel_path.starts_with(&normalized_game_dir) {
                rel_path = rel_path
                    .strip_prefix(&normalized_game_dir)
                    .unwrap_or(&rel_path)
                    .trim_start_matches('/')
                    .to_string();
            }
        }

        candidates.push(ExportCandidate {
            path: rel_path,
            is_mod: true, // "Resource" in modpack terms
            size: m.file_size as u64,
            platform: Some(m.platform),
            project_id: Some(m.remote_id),
            version_id: Some(m.remote_version_id),
            hash: m.hash,
            download_url: None,
        });
    }

    // 2. Scan all folders in game_dir except standard Minecraft internals
    let entries = tokio::task::spawn_blocking({
        let game_dir = game_dir.clone();
        move || std::fs::read_dir(&game_dir)
    })
    .await
    .map_err(|e| format!("spawn_blocking panicked: {}", e))?;
    if let Ok(entries) = entries {
        let skip_folders = [
            "logs",
            "backups",
            "crash-reports",
            "temp",
            "bin",
            "natives",
            "assets",
            "libraries",
            "versions",
            ".mixin.out",
            "runtime",
            "cache",
            "mod-cache",
            "web-cache",
            "patchy",
            ".vesta",
        ];

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();

                // Skip blacklisted folders
                if skip_folders.contains(&dir_name.as_ref()) {
                    continue;
                }

                // Recursively add files
                let mut stack = vec![path];
                while let Some(current) = stack.pop() {
                    let sub_entries =
                        tokio::task::spawn_blocking(move || std::fs::read_dir(&current))
                            .await
                            .map_err(|e| format!("spawn_blocking panicked: {}", e))?;
                    if let Ok(sub_entries) = sub_entries {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if sub_path.is_dir() {
                                let sub_dir_name =
                                    sub_path.file_name().unwrap_or_default().to_string_lossy();
                                if !skip_folders.contains(&sub_dir_name.as_ref()) {
                                    stack.push(sub_path.clone());
                                }
                            } else {
                                if let Ok(rel_path) = sub_path.strip_prefix(&game_dir) {
                                    let rel_str =
                                        rel_path.to_string_lossy().to_string().replace("\\", "/");
                                    let size = sub_path.metadata().map(|m| m.len()).unwrap_or(0);

                                    // Avoid duplicates from resources scan
                                    if !candidates.iter().any(|c| c.path == rel_str) {
                                        candidates.push(ExportCandidate {
                                            path: rel_str,
                                            is_mod: false,
                                            size,
                                            platform: None,
                                            project_id: None,
                                            version_id: None,
                                            hash: None,
                                            download_url: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            } else if path.is_file() {
                // Add files in the root (options.txt, servers.dat, etc.)
                if let Ok(rel_path) = path.strip_prefix(&game_dir) {
                    let rel_str = rel_path.to_string_lossy().to_string().replace("\\", "/");
                    let size = path.metadata().map(|m| m.len()).unwrap_or(0);

                    if !candidates.iter().any(|c| c.path == rel_str) {
                        candidates.push(ExportCandidate {
                            path: rel_str,
                            is_mod: false,
                            size,
                            platform: None,
                            project_id: None,
                            version_id: None,
                            hash: None,
                            download_url: None,
                        });
                    }
                }
            }
        }
    }

    Ok(candidates)
}

#[command]
pub async fn export_instance_to_modpack(
    instance_id: i32,
    output_path: String,
    format_str: String,
    selections: Vec<ExportCandidate>,
    modpack_name: String,
    version: String,
    author: String,
    description: String,
    task_manager: State<'_, TaskManager>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst = crate::schema::vesta::instance::table
        .filter(id.eq(instance_id))
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let format = match format_str.to_lowercase().as_str() {
        "modrinth" => ModpackFormat::Modrinth,
        _ => ModpackFormat::CurseForge,
    };

    // Group mods by platform for batch metadata fetching
    let mut mr_ids = Vec::new();
    let mut cf_ids = Vec::new();

    for s in &selections {
        if s.is_mod {
            if let Some(ref pid) = s.project_id {
                match s.platform.as_deref() {
                    Some("modrinth") => mr_ids.push(pid.clone()),
                    Some("curseforge") => cf_ids.push(pid.clone()),
                    _ => {}
                }
            }
        }
    }

    let mr_projects = if !mr_ids.is_empty() {
        resource_manager
            .get_projects(SourcePlatform::Modrinth, &mr_ids)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let cf_projects = if !cf_ids.is_empty() {
        resource_manager
            .get_projects(SourcePlatform::CurseForge, &cf_ids)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut project_meta = std::collections::HashMap::new();
    for p in mr_projects {
        project_meta.insert((SourcePlatform::Modrinth, p.id.clone()), p);
    }
    for p in cf_projects {
        project_meta.insert((SourcePlatform::CurseForge, p.id.clone()), p);
    }

    let entries = selections
        .into_iter()
        .map(|s| {
            let has_ids = s.project_id.is_some() && s.version_id.is_some();
            let has_hash = s.hash.is_some();

            if s.is_mod && (has_ids || has_hash) {
                let mut ext_ids = None;
                if let (Some(ref platform_str), Some(ref pid)) = (&s.platform, &s.project_id) {
                    let platform = match platform_str.as_str() {
                        "modrinth" => Some(SourcePlatform::Modrinth),
                        "curseforge" => Some(SourcePlatform::CurseForge),
                        _ => None,
                    };

                    if let Some(p) = platform {
                        if let Some(meta) = project_meta.get(&(p, pid.clone())) {
                            ext_ids = meta.external_ids.clone();
                        }
                    }
                }

                ExportEntry::Mod {
                    path: PathBuf::from(s.path),
                    source_id: s.project_id.unwrap_or_default(),
                    version_id: s.version_id.unwrap_or_default(),
                    platform: match s.platform.as_deref() {
                        Some("modrinth") => Some(ModpackFormat::Modrinth),
                        Some("curseforge") => Some(ModpackFormat::CurseForge),
                        _ => None,
                    },
                    download_url: s.download_url,
                    external_ids: ext_ids,
                }
            } else {
                ExportEntry::Override {
                    path: PathBuf::from(s.path),
                }
            }
        })
        .collect();

    let spec = ExportSpec {
        name: modpack_name.clone(),
        version: version.clone(),
        author: author.clone(),
        description: if description.is_empty() {
            None
        } else {
            Some(description)
        },
        minecraft_version: inst.minecraft_version.clone(),
        modloader_type: inst.modloader.clone().unwrap_or("vanilla".to_string()),
        modloader_version: inst.modloader_version.clone().unwrap_or_default(),
        entries,
    };

    let game_dir = inst
        .game_directory
        .as_ref()
        .ok_or("No game directory")?
        .clone();

    let task = ModpackExportTask {
        instance_name: modpack_name,
        game_dir,
        output_path,
        modpack_format: format,
        spec,
        resource_manager: resource_manager.inner().clone(),
    };

    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| format!("Failed to submit export task: {}", e))?;

    Ok(())
}

#[command]
pub async fn install_modpack_from_url(
    _app: AppHandle,
    url: String,
    instance_data: Instance,
    metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
    task_manager: State<'_, TaskManager>,
) -> Result<i32, String> {
    let client = piston_lib::client::shared_client();

    let (final_url, _) = resolve_modpack_resource(client, &url).await;
    log::info!(
        "[install_modpack_from_url] Resolved URL: {} -> {}",
        url,
        final_url
    );

    let mut conn = get_vesta_conn().map_err(|e| format!("DB Error: {}", e))?;

    let new_inst = prepare_instance(&_app, &mut conn, &instance_data).await?;
    log::info!(
        "[install_modpack_from_url] Prepared instance: {} (dir: {:?})",
        new_inst.name,
        new_inst.game_directory
    );

    diesel::insert_into(instance)
        .values(&new_inst)
        .execute(&mut conn)
        .map_err(|e| format!("Failed to save instance: {}", e))?;

    let saved_instance = instance
        .order(id.desc())
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to fetch saved instance: {}", e))?;

    log::info!(
        "[install_modpack_from_url] Saved instance into DB. ID={}, name={}, version_id={:?}",
        saved_instance.id,
        saved_instance.name,
        saved_instance.modpack_version_id
    );

    // Emit created event so UI home page updates immediately
    use tauri::Emitter;
    let _ = _app.emit("core://instance-created", &saved_instance);

    use crate::tasks::installers::modpack::ModpackSource;
    let cache_key = modpack_cache_key(&final_url);
    let safe_final_url = sanitized_url_for_log(&final_url);
    let source = if let Some(cached_path) = take_cached_archive(&cache_key) {
        let validation_path = cached_path.clone();
        match run_blocking_modpack_io(
            "validate cached modpack archive before install",
            move || {
                let size = std::fs::metadata(&validation_path)?.len();
                if size > MAX_SUMMARY_ARCHIVE_BYTES {
                    return Err(anyhow::anyhow!(
                        "Cached archive is too large ({} bytes, max {} bytes)",
                        size,
                        MAX_SUMMARY_ARCHIVE_BYTES
                    ));
                }
                parse_modpack_archive_summary(&validation_path).map(|_| ())
            },
        )
        .await
        {
            Ok(()) => {
                log::info!(
                    "[install_modpack_from_url] Reusing preloaded archive cache_key={} final_url={} path={:?}",
                    cache_key,
                    safe_final_url,
                    cached_path
                );
                ModpackSource::Path(cached_path)
            }
            Err(err) => {
                log::warn!(
                    "[install_modpack_from_url] Cached archive invalid; falling back to URL install cache_key={} final_url={}: {}",
                    cache_key,
                    safe_final_url,
                    err
                );
                archive_cache().remove(&cache_key);
                let _ = std::fs::remove_file(cached_path);
                ModpackSource::Url(final_url)
            }
        }
    } else {
        ModpackSource::Url(final_url)
    };

    let task = InstallModpackTask::new(saved_instance.clone(), source, metadata);
    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| e.to_string())?;

    Ok(saved_instance.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use piston_lib::game::modpack::types::{ModpackFormat, ModpackMetadata};
    use std::io::Write;
    use zip::{write::FileOptions, CompressionMethod, ZipWriter};

    fn sample_metadata() -> ModpackMetadata {
        ModpackMetadata {
            name: "Local Pack".to_string(),
            version: "1.2.3".to_string(),
            author: None,
            minecraft_version: "1.20.1".to_string(),
            modloader_type: "fabric".to_string(),
            modloader_version: Some("0.16.0".to_string()),
            description: Some("Local manifest summary".to_string()),
            icon_url: None,
            recommended_ram_mb: Some(4096),
            format: ModpackFormat::Modrinth,
            mods: Vec::new(),
            root_prefix: None,
        }
    }

    fn write_zip(entries: &[(&str, &str)]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().expect("create temp zip");
        {
            let mut zip = ZipWriter::new(file.reopen().expect("reopen temp zip"));
            for (entry_name, content) in entries {
                zip.start_file::<&str, ()>(*entry_name, FileOptions::default())
                    .expect("start zip file");
                zip.write_all(content.as_bytes()).expect("write zip entry");
            }
            zip.finish().expect("finish zip");
        }
        file
    }

    fn write_deflated_zip(entries: &[(&str, &str)]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().expect("create temp zip");
        {
            let mut zip = ZipWriter::new(file.reopen().expect("reopen temp zip"));
            let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
            for (entry_name, content) in entries {
                zip.start_file::<&str, ()>(*entry_name, options)
                    .expect("start zip file");
                zip.write_all(content.as_bytes()).expect("write zip entry");
            }
            zip.finish().expect("finish zip");
        }
        file
    }

    #[test]
    fn manual_metadata_does_not_create_source_link() {
        let info = modpack_info_from_metadata(sample_metadata(), None, None);

        assert_eq!(info.name, "Local Pack");
        assert_eq!(info.version, "1.2.3");
        assert_eq!(info.modpack_id, None);
        assert_eq!(info.modpack_platform, None);
        assert_eq!(info.modpack_version_id, None);
    }

    #[test]
    fn trusted_source_metadata_does_not_fabricate_version_id() {
        let info = modpack_info_from_metadata(
            sample_metadata(),
            Some("project-id".to_string()),
            Some("modrinth".to_string()),
        );

        assert_eq!(info.modpack_id.as_deref(), Some("project-id"));
        assert_eq!(info.modpack_platform.as_deref(), Some("modrinth"));
        assert_eq!(info.modpack_version_id, None);
    }

    #[test]
    fn root_modrinth_summary_counts_files() {
        let file = write_zip(&[(
            "modrinth.index.json",
            r#"{"formatVersion":1,"game":"minecraft","files":[{"path":"mods/a.jar"},{"path":"mods/b.jar"}]}"#,
        )]);

        let summary = parse_modpack_archive_summary(file.path()).expect("parse mrpack summary");

        assert_eq!(summary.resource_count, 2);
        assert_eq!(summary.format, "Modrinth");
    }

    #[test]
    fn root_curseforge_summary_counts_files() {
        let file = write_zip(&[(
            "manifest.json",
            r#"{"minecraft":{"version":"1.20.1","recommendedRam":9504},"manifestType":"minecraftModpack","files":[{"projectID":1,"fileID":2},{"projectID":3,"fileID":4}]}"#,
        )]);

        let summary = parse_modpack_archive_summary(file.path()).expect("parse curseforge summary");

        assert_eq!(summary.resource_count, 2);
        assert_eq!(summary.recommended_ram_mb, Some(9504));
        assert_eq!(summary.format, "CurseForge");
    }

    #[test]
    fn archive_summary_serialization_does_not_expose_cache_path() {
        let summary = ModpackArchiveSummary {
            resource_count: 2,
            recommended_ram_mb: Some(9504),
            format: "CurseForge".to_string(),
        };

        let serialized = serde_json::to_value(summary).expect("serialize summary");

        assert!(serialized.get("cachedPath").is_none());
    }

    #[test]
    fn modrinth_manifest_signature_is_sorted_and_stable() {
        let index = serde_json::json!({
            "files": [
                { "hashes": { "sha1": "BBBB" } },
                { "hashes": { "sha1": "aaaa" } },
                { "hashes": { "sha1": "BBBB" } }
            ]
        });

        let signature = sorted_modrinth_signature(&index).expect("modrinth signature");

        assert_eq!(signature, vec!["aaaa".to_string(), "bbbb".to_string()]);
    }

    #[test]
    fn curseforge_manifest_signature_is_sorted_and_stable() {
        let manifest = serde_json::json!({
            "files": [
                { "projectID": 30, "fileID": 2 },
                { "projectID": 10, "fileID": 5 },
                { "projectID": 30, "fileID": 2 }
            ]
        });

        let signature = sorted_curseforge_signature(&manifest).expect("curseforge signature");

        assert_eq!(signature, vec!["10:5".to_string(), "30:2".to_string()]);
    }

    #[test]
    fn nested_only_summary_fails_fast() {
        let file = write_zip(&[(
            "nested/manifest.json",
            r#"{"manifestType":"minecraftModpack","files":[{"projectID":1,"fileID":2}]}"#,
        )]);

        let error = parse_modpack_archive_summary(file.path()).expect_err("nested manifest fails");

        assert!(
            error.to_string().contains("Invalid modpack archive"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn oversized_root_manifest_is_rejected() {
        let oversized_json = format!(
            "{{\"files\":[],\"padding\":\"{}\"}}",
            "x".repeat(MAX_MANIFEST_JSON_BYTES as usize + 1)
        );
        let file = write_zip(&[("manifest.json", oversized_json.as_str())]);

        let error = parse_modpack_archive_summary(file.path()).expect_err("oversized JSON fails");

        assert!(
            error.to_string().contains("Invalid modpack archive"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn suspicious_manifest_compression_ratio_is_rejected() {
        let compressible_json = format!(
            "{{\"files\":[],\"padding\":\"{}\"}}",
            "x".repeat(256 * 1024)
        );
        let file = write_deflated_zip(&[("manifest.json", compressible_json.as_str())]);

        let error = read_root_json_from_zip(file.path(), "manifest.json")
            .expect_err("high compression ratio fails");

        assert!(
            error.to_string().contains("compression ratio"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn cache_prune_removes_missing_and_limits_entries() {
        let temp_dir = tempfile::tempdir().expect("create cache dir");
        let now = SystemTime::now();

        {
            let mut cache = archive_cache();
            cache.clear();
            cache.insert(
                "missing".to_string(),
                ModpackArchiveCacheEntry {
                    path: temp_dir.path().join("summary_missing.zip"),
                    created_at: now,
                    accessed_at: now,
                    size: 1,
                },
            );

            for idx in 0..=MAX_SUMMARY_CACHE_ENTRIES {
                let path = temp_dir.path().join(format!("summary_{idx}.zip"));
                std::fs::write(&path, b"zip").expect("write fake cache file");
                cache.insert(
                    format!("key-{idx}"),
                    ModpackArchiveCacheEntry {
                        path,
                        created_at: now,
                        accessed_at: now + Duration::from_secs(idx as u64),
                        size: 3,
                    },
                );
            }
        }

        prune_summary_archive_cache(temp_dir.path());

        let cache = archive_cache();
        assert!(!cache.contains_key("missing"));
        assert!(cache.len() <= MAX_SUMMARY_CACHE_ENTRIES);
    }

    #[test]
    fn cache_prune_limits_total_tracked_size() {
        let temp_dir = tempfile::tempdir().expect("create cache dir");
        let now = SystemTime::now();
        let entry_size = MAX_SUMMARY_ARCHIVE_BYTES;

        {
            let mut cache = archive_cache();
            cache.clear();
            for idx in 0..5 {
                let path = temp_dir.path().join(format!("summary_big_{idx}.zip"));
                std::fs::write(&path, b"zip").expect("write fake cache file");
                cache.insert(
                    format!("big-key-{idx}"),
                    ModpackArchiveCacheEntry {
                        path,
                        created_at: now,
                        accessed_at: now + Duration::from_secs(idx as u64),
                        size: entry_size,
                    },
                );
            }
        }

        prune_summary_archive_cache(temp_dir.path());

        let cache = archive_cache();
        let total_size: u64 = cache.values().map(|entry| entry.size).sum();
        assert!(total_size <= MAX_SUMMARY_CACHE_BYTES);
        assert!(!cache.contains_key("big-key-0"));
    }
}
