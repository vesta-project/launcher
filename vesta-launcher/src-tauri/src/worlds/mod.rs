pub mod archive;
pub mod install_selection;
pub mod level_dat;
pub mod manifest;
pub mod transfer;

use crate::models::instance::Instance;
use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use level_dat::{LevelStatus, StorageFamily};
use manifest::{ManagedComponentKind, MetadataStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

const WORLD_CACHE_TTL: Duration = Duration::from_secs(30);
const MAX_ICON_BYTES: u64 = 1024 * 1024;
const MAX_ICON_DIMENSION: u32 = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct WorldRef {
    pub instance_id: i32,
    pub directory_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceInstallTarget {
    Instance { instance_id: i32 },
    World { world: WorldRef },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummary {
    #[serde(rename = "ref")]
    pub world_ref: WorldRef,
    pub world_id: Option<String>,
    pub instance_name: String,
    pub folder_name: String,
    pub display_name: String,
    pub last_played_at: Option<String>,
    pub size_bytes: u64,
    pub icon_data_url: Option<String>,
    pub data_version: Option<i32>,
    pub game_version: Option<String>,
    pub storage_family: StorageFamilyDto,
    pub level_status: LevelStatusDto,
    pub metadata_status: MetadataStatusDto,
    pub datapack_count: usize,
    pub managed_datapack_count: usize,
    pub running: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StorageFamilyDto {
    Alpha,
    Mcregion,
    Anvil,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LevelStatusDto {
    Valid,
    Recovered,
    Unreadable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MetadataStatusDto {
    Absent,
    Valid,
    Corrupt,
    Future,
}

struct CacheEntry {
    created_at: Instant,
    worlds: Vec<WorldSummary>,
}

#[derive(Default)]
pub struct WorldManager {
    cache: Mutex<HashMap<i32, CacheEntry>>,
}

impl WorldManager {
    pub fn list_instance_worlds(
        &self,
        instance: &Instance,
        running: bool,
        force_refresh: bool,
    ) -> Result<Vec<WorldSummary>, String> {
        if !force_refresh {
            if let Some(cached) = self
                .cache
                .lock()
                .map_err(|_| "World cache is unavailable".to_string())?
                .get(&instance.id)
                .filter(|entry| entry.created_at.elapsed() < WORLD_CACHE_TTL)
            {
                let mut worlds = cached.worlds.clone();
                worlds.iter_mut().for_each(|world| world.running = running);
                return Ok(worlds);
            }
        }

        let worlds = discover_instance_worlds(instance, running)?;
        self.cache
            .lock()
            .map_err(|_| "World cache is unavailable".to_string())?
            .insert(
                instance.id,
                CacheEntry {
                    created_at: Instant::now(),
                    worlds: worlds.clone(),
                },
            );
        Ok(worlds)
    }

    pub fn invalidate(&self, instance_id: i32) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(&instance_id);
        }
    }
}

pub fn discover_instance_worlds(
    instance: &Instance,
    running: bool,
) -> Result<Vec<WorldSummary>, String> {
    let game_directory = instance_game_directory(instance)?;
    let saves = game_directory.join("saves");
    if !saves.exists() {
        return Ok(Vec::new());
    }
    let mut worlds = Vec::new();
    for entry in fs::read_dir(&saves)
        .map_err(|error| format!("Failed to read {}: {error}", saves.display()))?
    {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if !level_dat::has_level_marker(&path) {
            continue;
        }
        let folder_name = entry.file_name().to_string_lossy().to_string();
        worlds.push(summarize_world(instance, &path, folder_name, running));
    }
    worlds.sort_by(|left, right| {
        right
            .last_played_at
            .as_deref()
            .cmp(&left.last_played_at.as_deref())
            .then_with(|| {
                left.display_name
                    .to_lowercase()
                    .cmp(&right.display_name.to_lowercase())
            })
    });
    Ok(worlds)
}

fn summarize_world(
    instance: &Instance,
    world_root: &Path,
    folder_name: String,
    running: bool,
) -> WorldSummary {
    let level = level_dat::read_world_level(world_root);
    let manifest_read = manifest::read_manifest(world_root);
    let last_played = valid_last_played(level.last_played_millis)
        .or_else(|| modified_at(&level.source_path))
        .or_else(|| modified_at(world_root));
    let game_version = level
        .version_name
        .clone()
        .or_else(|| {
            level
                .data_version
                .map(|value| format!("DataVersion {value}"))
        })
        .or_else(|| match level.storage_family {
            StorageFamily::Alpha => Some("Alpha storage".to_string()),
            StorageFamily::McRegion => Some("MCRegion".to_string()),
            StorageFamily::Anvil if level.data_version.is_none() => Some("Anvil".to_string()),
            _ => None,
        });
    let managed_datapack_count = manifest_read
        .manifest
        .as_ref()
        .map(|manifest| {
            manifest
                .managed_components
                .iter()
                .filter(|component| component.kind == ManagedComponentKind::Datapack)
                .count()
        })
        .unwrap_or(0);

    WorldSummary {
        world_ref: WorldRef {
            instance_id: instance.id,
            directory_name: folder_name.clone(),
        },
        world_id: manifest_read
            .manifest
            .as_ref()
            .map(|manifest| manifest.world_id.to_string()),
        instance_name: instance.name.clone(),
        folder_name: folder_name.clone(),
        display_name: level.level_name.unwrap_or(folder_name),
        last_played_at: last_played.map(|value| value.to_rfc3339()),
        size_bytes: logical_world_size(world_root),
        icon_data_url: read_world_icon(world_root),
        data_version: level.data_version,
        game_version,
        storage_family: level.storage_family.into(),
        level_status: level.status.into(),
        metadata_status: manifest_read.status.into(),
        datapack_count: count_datapacks(world_root),
        managed_datapack_count,
        running,
    }
}

pub fn instance_game_directory(instance: &Instance) -> Result<PathBuf, String> {
    instance
        .game_directory
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("Instance {} has no game directory", instance.name))
}

pub fn resolve_world_path(world_ref: &WorldRef) -> Result<PathBuf, String> {
    let instance = crate::commands::instances::get_instance(world_ref.instance_id)?;
    resolve_world_path_for_instance(&instance, world_ref)
}

pub fn resolve_world_path_for_instance(
    instance: &Instance,
    world_ref: &WorldRef,
) -> Result<PathBuf, String> {
    if instance.id != world_ref.instance_id {
        return Err("The world does not belong to this instance".to_string());
    }
    validate_directory_name(&world_ref.directory_name)?;
    let saves = instance_game_directory(instance)?.join("saves");
    let saves = saves
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", saves.display()))?;
    let candidate = saves.join(&world_ref.directory_name);
    let candidate = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve world: {error}"))?;
    if candidate.parent() != Some(saves.as_path()) || !candidate.starts_with(&saves) {
        return Err("World path escapes the instance saves directory".to_string());
    }
    if !level_dat::has_level_marker(&candidate)
        || level_dat::read_world_level(&candidate).status == LevelStatus::Unreadable
    {
        return Err("The selected folder is not a readable Java world".to_string());
    }
    Ok(candidate)
}

pub fn validate_directory_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || Path::new(name).components().count() != 1
        || !matches!(
            Path::new(name).components().next(),
            Some(Component::Normal(_))
        )
    {
        return Err("Invalid world directory name".to_string());
    }
    Ok(())
}

fn valid_last_played(millis: Option<i64>) -> Option<DateTime<Utc>> {
    let value = DateTime::<Utc>::from_timestamp_millis(millis?)?;
    (value <= Utc::now() + ChronoDuration::days(1)).then_some(value)
}

fn modified_at(path: &Path) -> Option<DateTime<Utc>> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Utc>::from(modified))
}

fn logical_world_size(world_root: &Path) -> u64 {
    WalkDir::new(world_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            if entry.file_type().is_file() {
                entry.metadata().ok().map(|metadata| metadata.len())
            } else {
                None
            }
        })
        .sum()
}

fn count_datapacks(world_root: &Path) -> usize {
    let Ok(entries) = fs::read_dir(world_root.join("datapacks")) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            let Ok(file_type) = entry.file_type() else {
                return false;
            };
            (file_type.is_dir() && !file_type.is_symlink())
                || (file_type.is_file()
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip")))
        })
        .count()
}

fn read_world_icon(world_root: &Path) -> Option<String> {
    let path = world_root.join("icon.png");
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_ICON_BYTES {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let reader = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .ok()?;
    let (width, height) = reader.into_dimensions().ok()?;
    if width > MAX_ICON_DIMENSION || height > MAX_ICON_DIMENSION {
        return None;
    }
    let mime = crate::utils::image::detect_image_mime(&bytes);
    Some(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

impl From<StorageFamily> for StorageFamilyDto {
    fn from(value: StorageFamily) -> Self {
        match value {
            StorageFamily::Alpha => Self::Alpha,
            StorageFamily::McRegion => Self::Mcregion,
            StorageFamily::Anvil => Self::Anvil,
            StorageFamily::Unknown => Self::Unknown,
        }
    }
}

impl From<LevelStatus> for LevelStatusDto {
    fn from(value: LevelStatus) -> Self {
        match value {
            LevelStatus::Valid => Self::Valid,
            LevelStatus::Recovered => Self::Recovered,
            LevelStatus::Unreadable => Self::Unreadable,
        }
    }
}

impl From<MetadataStatus> for MetadataStatusDto {
    fn from(value: MetadataStatus) -> Self {
        match value {
            MetadataStatus::Absent => Self::Absent,
            MetadataStatus::Valid => Self::Valid,
            MetadataStatus::Corrupt => Self::Corrupt,
            MetadataStatus::Future => Self::Future,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_refs_reject_traversal_and_nested_paths() {
        for invalid in ["", "..", "../world", "wrapper/world", "/tmp/world"] {
            assert!(
                validate_directory_name(invalid).is_err(),
                "accepted {invalid}"
            );
        }
        assert!(validate_directory_name("My World").is_ok());
    }

    #[test]
    fn resource_install_targets_use_frontend_camel_case_fields() {
        let target: ResourceInstallTarget = serde_json::from_value(serde_json::json!({
            "kind": "instance",
            "instanceId": 42
        }))
        .unwrap();
        assert_eq!(target, ResourceInstallTarget::Instance { instance_id: 42 });

        let world_target: ResourceInstallTarget = serde_json::from_value(serde_json::json!({
            "kind": "world",
            "world": { "instanceId": 42, "directoryName": "World" }
        }))
        .unwrap();
        assert_eq!(
            world_target,
            ResourceInstallTarget::World {
                world: WorldRef {
                    instance_id: 42,
                    directory_name: "World".to_string(),
                }
            }
        );
    }

    #[test]
    fn invalid_or_future_last_played_is_ignored() {
        assert!(valid_last_played(None).is_none());
        assert!(valid_last_played(Some(i64::MAX)).is_none());
        let far_future = (Utc::now() + ChronoDuration::days(30)).timestamp_millis();
        assert!(valid_last_played(Some(far_future)).is_none());
    }

    #[test]
    fn java_26_dimension_layout_is_opaque_to_world_size() {
        let temp = tempfile::TempDir::new().unwrap();
        let dimension = temp.path().join("dimensions/minecraft/the_nether/region");
        fs::create_dir_all(&dimension).unwrap();
        fs::write(dimension.join("r.0.0.mca"), [1_u8, 2, 3]).unwrap();
        assert_eq!(logical_world_size(temp.path()), 3);
    }

    #[cfg(unix)]
    #[test]
    fn world_icon_symlinks_are_not_read() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::TempDir::new().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        symlink(outside.path(), temp.path().join("icon.png")).unwrap();
        assert!(read_world_icon(temp.path()).is_none());
    }
}
