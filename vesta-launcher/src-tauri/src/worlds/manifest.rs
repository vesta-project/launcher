use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const WORLD_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldSource {
    pub platform: String,
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub sha1: String,
    pub installed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedComponent {
    pub bundle_id: Uuid,
    pub kind: ManagedComponentKind,
    pub platform: String,
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub display_name: String,
    pub sha1: String,
    pub scope: ComponentScope,
    pub relative_path: String,
    pub installed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ManagedComponentKind {
    Datapack,
    CompanionResourcepack,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ComponentScope {
    World,
    Instance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldManifest {
    pub schema_version: u32,
    pub world_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<WorldSource>,
    #[serde(default)]
    pub managed_components: Vec<ManagedComponent>,
}

impl WorldManifest {
    pub fn new(source: Option<WorldSource>) -> Self {
        let now = Utc::now();
        Self {
            schema_version: WORLD_MANIFEST_SCHEMA_VERSION,
            world_id: Uuid::new_v4(),
            created_at: now,
            updated_at: now,
            source,
            managed_components: Vec::new(),
        }
    }

    pub fn clone_with_new_identity(&self) -> Self {
        let now = Utc::now();
        let mut cloned = self.clone();
        cloned.world_id = Uuid::new_v4();
        cloned.created_at = now;
        cloned.updated_at = now;
        let mut bundle_ids = HashMap::new();
        for component in &mut cloned.managed_components {
            component.bundle_id = *bundle_ids
                .entry(component.bundle_id)
                .or_insert_with(Uuid::new_v4);
        }
        cloned
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataStatus {
    Absent,
    Valid,
    Corrupt,
    Future,
}

#[derive(Debug, Clone)]
pub struct ManifestRead {
    pub status: MetadataStatus,
    pub manifest: Option<WorldManifest>,
}

pub fn managed_datapack_manifest(
    resource: &crate::models::installed_resource::InstalledResource,
) -> Result<Option<(PathBuf, WorldManifest, usize)>, String> {
    if !resource.resource_type.eq_ignore_ascii_case("datapack") {
        return Ok(None);
    }
    let path = Path::new(&resource.local_path);
    let Some(datapacks) = path.parent() else {
        return Ok(None);
    };
    let Some(world) = datapacks.parent() else {
        return Ok(None);
    };
    if datapacks.file_name().and_then(|name| name.to_str()) != Some("datapacks")
        || world
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            != Some("saves")
    {
        return Ok(None);
    }

    let read = read_manifest(world);
    match read.status {
        MetadataStatus::Absent => return Ok(None),
        MetadataStatus::Corrupt => {
            return Err(
                "World metadata is corrupt; manage the world before changing this datapack"
                    .to_string(),
            )
        }
        MetadataStatus::Future => {
            return Err("World metadata was created by a newer Vesta version".to_string())
        }
        MetadataStatus::Valid => {}
    }
    let Some(manifest) = read.manifest else {
        return Ok(None);
    };
    let relative = path
        .strip_prefix(world)
        .map_err(|_| "Managed datapack escaped its world".to_string())?
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    let component = manifest.managed_components.iter().position(|component| {
        component.kind == ManagedComponentKind::Datapack && component.relative_path == relative
    });
    Ok(component.map(|index| (world.to_path_buf(), manifest, index)))
}

pub fn manifest_path(world_root: &Path) -> PathBuf {
    world_root.join(".vesta").join("world.json")
}

pub fn read_manifest(world_root: &Path) -> ManifestRead {
    let path = manifest_path(world_root);
    let Ok(bytes) = fs::read(&path) else {
        return ManifestRead {
            status: MetadataStatus::Absent,
            manifest: None,
        };
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return ManifestRead {
            status: MetadataStatus::Corrupt,
            manifest: None,
        };
    };
    let schema_version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    if schema_version.is_some_and(|version| version > WORLD_MANIFEST_SCHEMA_VERSION) {
        return ManifestRead {
            status: MetadataStatus::Future,
            manifest: serde_json::from_value(value).ok(),
        };
    }
    match serde_json::from_value(value) {
        Ok(manifest) => ManifestRead {
            status: MetadataStatus::Valid,
            manifest: Some(manifest),
        },
        Err(_) => ManifestRead {
            status: MetadataStatus::Corrupt,
            manifest: None,
        },
    }
}

pub fn ensure_manifest_for_management(world_root: &Path) -> Result<WorldManifest, String> {
    match read_manifest(world_root) {
        ManifestRead {
            status: MetadataStatus::Valid,
            manifest: Some(manifest),
        } => Ok(manifest),
        ManifestRead {
            status: MetadataStatus::Future,
            ..
        } => Err(
            "This world uses a newer Vesta metadata format and cannot be changed safely"
                .to_string(),
        ),
        ManifestRead {
            status: MetadataStatus::Corrupt,
            ..
        } => {
            preserve_corrupt_manifest(world_root)?;
            let manifest = WorldManifest::new(None);
            write_manifest(world_root, &manifest)?;
            Ok(manifest)
        }
        _ => {
            let manifest = WorldManifest::new(None);
            write_manifest(world_root, &manifest)?;
            Ok(manifest)
        }
    }
}

pub fn write_manifest(world_root: &Path, manifest: &WorldManifest) -> Result<(), String> {
    let vesta_dir = world_root.join(".vesta");
    fs::create_dir_all(&vesta_dir)
        .map_err(|error| format!("Failed to create {}: {error}", vesta_dir.display()))?;
    let path = vesta_dir.join("world.json");
    let temp_path = vesta_dir.join(format!(".world.json.{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Failed to serialize world metadata: {error}"))?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| format!("Failed to create {}: {error}", temp_path.display()))?;
    if let Err(error) = file
        .write_all(&bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to write {}: {error}", temp_path.display()));
    }
    if let Err(error) = atomic_replace(&temp_path, &path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to publish {}: {error}", path.display()));
    }
    Ok(())
}

pub fn restore_manifest_bytes(world_root: &Path, snapshot: Option<&[u8]>) -> Result<(), String> {
    let path = manifest_path(world_root);
    let Some(bytes) = snapshot else {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Failed to remove {}: {error}", path.display()))?;
        }
        return Ok(());
    };
    let directory = path
        .parent()
        .ok_or_else(|| "Invalid world manifest path".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!(".world-restore-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    if let Err(error) = atomic_replace(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Failed to restore {}: {error}", path.display()));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn preserve_corrupt_manifest(world_root: &Path) -> Result<(), String> {
    let original = manifest_path(world_root);
    if !original.exists() {
        return Ok(());
    }
    let stamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let diagnostic = original.with_file_name(format!("world.corrupt-{stamp}.json"));
    fs::rename(&original, &diagnostic).map_err(|error| {
        format!(
            "Failed to preserve corrupt metadata as {}: {error}",
            diagnostic.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn listing_read_does_not_create_metadata() {
        let temp = TempDir::new().unwrap();
        assert_eq!(read_manifest(temp.path()).status, MetadataStatus::Absent);
        assert!(!manifest_path(temp.path()).exists());
    }

    #[test]
    fn corrupt_manifest_is_preserved_on_first_management_action() {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join(".vesta")).unwrap();
        fs::write(manifest_path(temp.path()), b"not-json").unwrap();
        let manifest = ensure_manifest_for_management(temp.path()).unwrap();
        assert_eq!(read_manifest(temp.path()).status, MetadataStatus::Valid);
        assert!(temp
            .path()
            .join(".vesta")
            .read_dir()
            .unwrap()
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("world.corrupt-")));
        assert_ne!(manifest.world_id, Uuid::nil());
    }

    #[test]
    fn cloned_manifest_gets_new_world_and_bundle_ids() {
        let mut original = WorldManifest::new(None);
        original.managed_components.push(ManagedComponent {
            bundle_id: Uuid::new_v4(),
            kind: ManagedComponentKind::Datapack,
            platform: "provider".into(),
            project_id: "project".into(),
            version_id: "version".into(),
            version_number: "1".into(),
            display_name: "Pack".into(),
            sha1: "abc".into(),
            scope: ComponentScope::World,
            relative_path: "datapacks/pack.zip".into(),
            installed_at: Utc::now(),
        });
        let cloned = original.clone_with_new_identity();
        assert_ne!(cloned.world_id, original.world_id);
        assert_ne!(
            cloned.managed_components[0].bundle_id,
            original.managed_components[0].bundle_id
        );
    }

    #[test]
    fn cloned_manifest_preserves_bundle_pairing() {
        let bundle_id = Uuid::new_v4();
        let mut original = WorldManifest::new(None);
        for (kind, path) in [
            (ManagedComponentKind::Datapack, "datapacks/pack.zip"),
            (
                ManagedComponentKind::CompanionResourcepack,
                "resourcepacks/pack.zip",
            ),
        ] {
            original.managed_components.push(ManagedComponent {
                bundle_id,
                kind,
                platform: "provider".into(),
                project_id: "project".into(),
                version_id: "version".into(),
                version_number: "1".into(),
                display_name: "Pack".into(),
                sha1: "abc".into(),
                scope: if kind == ManagedComponentKind::Datapack {
                    ComponentScope::World
                } else {
                    ComponentScope::Instance
                },
                relative_path: path.into(),
                installed_at: Utc::now(),
            });
        }
        let cloned = original.clone_with_new_identity();
        assert_ne!(cloned.managed_components[0].bundle_id, bundle_id);
        assert_eq!(
            cloned.managed_components[0].bundle_id,
            cloned.managed_components[1].bundle_id
        );
    }
}
