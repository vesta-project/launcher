use crate::models::installed_resource::InstalledResource;
use crate::models::resource::{ReleaseType, ResourceType, ResourceVersion, SourcePlatform};
use crate::utils::instance_helpers::normalize_path;
use crate::worlds::manifest::{
    ComponentScope, ManagedComponent, ManagedComponentKind, MetadataStatus, WorldManifest,
};
use crate::worlds::WorldRef;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldDatapackOverview {
    pub world: WorldRef,
    pub entries: Vec<WorldDatapackSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldDatapackSummary {
    pub resource_id: Option<i32>,
    pub file_name: String,
    pub display_name: String,
    pub entry_kind: DatapackEntryKind,
    pub platform: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub enabled: bool,
    pub managed: bool,
    pub read_only: bool,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDatapackUpdateCheck {
    pub world: WorldRef,
    pub game_version: Option<String>,
    pub updates: Vec<WorldDatapackUpdateStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDatapackUpdateStatus {
    pub resource_id: i32,
    pub exact_version: Option<ResourceVersion>,
    pub manual_review_available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatapackEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldDatapackRemoval {
    pub removed_companion_count: usize,
    pub retained_companion_count: usize,
    pub cleanup_warning: Option<String>,
}

pub fn list_world_datapacks(world_ref: &WorldRef) -> Result<WorldDatapackOverview, String> {
    let Some(datapacks_root) = resolve_datapacks_root(world_ref, false)? else {
        return Ok(WorldDatapackOverview {
            world: world_ref.clone(),
            entries: Vec::new(),
        });
    };
    let rows = crate::resources::ledger::list_in_directory(
        world_ref.instance_id,
        "datapack",
        &datapacks_root,
    )
    .map_err(|error| format!("Failed to read installed datapacks: {error}"))?;
    let world_root = datapacks_root
        .parent()
        .ok_or_else(|| "Invalid world datapacks directory".to_string())?;
    let manifest = crate::worlds::manifest::read_manifest(world_root);
    let entries = list_entries(
        &datapacks_root,
        &rows,
        (manifest.status == MetadataStatus::Valid)
            .then_some(manifest.manifest)
            .flatten()
            .as_ref(),
    )?;
    Ok(WorldDatapackOverview {
        world: world_ref.clone(),
        entries,
    })
}

pub fn update_check_context(
    world_ref: &WorldRef,
) -> Result<(Option<String>, Vec<InstalledResource>), String> {
    let world_root = crate::worlds::resolve_world_path(world_ref)?;
    let game_version = crate::worlds::level_dat::read_world_level(&world_root).version_name;
    let Some(datapacks_root) = resolve_datapacks_root(world_ref, false)? else {
        return Ok((game_version, Vec::new()));
    };
    let rows = crate::resources::ledger::list_in_directory(
        world_ref.instance_id,
        "datapack",
        &datapacks_root,
    )
    .map_err(|error| format!("Failed to read installed datapacks: {error}"))?
    .into_iter()
    .filter(|row| {
        !row.is_manual
            && !row.remote_id.is_empty()
            && validate_resource(row, &datapacks_root).is_ok()
    })
    .collect();
    Ok((game_version, rows))
}

pub fn select_update_status(
    versions: &[ResourceVersion],
    resource: &InstalledResource,
    world_version: Option<&str>,
    platform: SourcePlatform,
    project_type: ResourceType,
) -> WorldDatapackUpdateStatus {
    let eligible = versions
        .iter()
        .take_while(|version| version.id != resource.remote_version_id)
        .filter(|version| {
            release_allowed(version.release_type, &resource.release_type)
                && if platform == SourcePlatform::Modrinth {
                    version
                        .loaders
                        .iter()
                        .any(|loader| loader.eq_ignore_ascii_case("datapack"))
                } else if platform == SourcePlatform::CurseForge {
                    project_type == ResourceType::DataPack
                } else {
                    crate::tasks::resource_download::requires_world_target(version, project_type)
                }
        })
        .collect::<Vec<_>>();
    let exact_version = world_version.and_then(|world_version| {
        eligible
            .iter()
            .find(|version| {
                version.game_versions.iter().any(|listed| {
                    crate::resources::manager::normalize_mc_version(listed)
                        == crate::resources::manager::normalize_mc_version(world_version)
                })
            })
            .map(|version| (*version).clone())
    });
    let manual_review_available = eligible.iter().any(|version| {
        exact_version
            .as_ref()
            .is_none_or(|exact| version.id != exact.id)
    });
    WorldDatapackUpdateStatus {
        resource_id: resource.id,
        exact_version,
        manual_review_available,
        error: None,
    }
}

pub fn open_world_datapacks_folder(world_ref: &WorldRef) -> Result<(), String> {
    let datapacks_root = resolve_datapacks_root(world_ref, true)?
        .ok_or_else(|| "Failed to create the world datapacks directory".to_string())?;
    open::that(&datapacks_root)
        .map_err(|error| format!("Failed to open {}: {error}", datapacks_root.display()))
}

pub fn replacement_path(world_ref: &WorldRef, resource_id: i32) -> Result<PathBuf, String> {
    let datapacks_root = resolve_datapacks_root(world_ref, false)?
        .ok_or_else(|| "This world has no datapacks directory".to_string())?;
    let resource = crate::resources::ledger::get_resource(world_ref.instance_id, resource_id)
        .map_err(|error| format!("Failed to find datapack: {error}"))?;
    validate_resource(&resource, &datapacks_root)?;
    let path = PathBuf::from(resource.local_path);
    if !path.is_file() {
        return Err("Only file-form datapacks can be updated".to_string());
    }
    Ok(path)
}

pub fn toggle_world_datapack(
    world_ref: &WorldRef,
    resource_id: i32,
    enabled: bool,
) -> Result<(), String> {
    let datapacks_root = resolve_datapacks_root(world_ref, false)?
        .ok_or_else(|| "This world has no datapacks directory".to_string())?;
    let resource = crate::resources::ledger::get_resource(world_ref.instance_id, resource_id)
        .map_err(|error| format!("Failed to find datapack: {error}"))?;
    validate_resource(&resource, &datapacks_root)?;

    let current_path = PathBuf::from(&resource.local_path);
    let new_path = crate::resources::ledger::toggled_path(&current_path, enabled);
    if new_path != current_path {
        validate_destination(&new_path, &datapacks_root)?;
        if new_path.exists() {
            return Err(format!(
                "A datapack named {} already exists",
                new_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("that")
            ));
        }
    }

    let managed = crate::worlds::manifest::managed_datapack_manifest(&resource)?;
    if let Some((world, mut manifest, component_index)) = managed.as_ref().cloned() {
        if world != datapacks_root.parent().unwrap_or(Path::new("")) {
            return Err("The managed datapack belongs to another world".to_string());
        }
        let previous = manifest.clone();
        manifest.managed_components[component_index].relative_path =
            relative_world_path(&world, &new_path)?;
        manifest.updated_at = Utc::now();
        crate::worlds::manifest::write_manifest(&world, &manifest)?;
        if let Err(error) = crate::resources::ledger::set_enabled(resource_id, enabled) {
            if new_path.exists() && !current_path.exists() {
                let _ = fs::rename(&new_path, &current_path);
            }
            let _ = crate::worlds::manifest::write_manifest(&world, &previous);
            return Err(format!("Failed to toggle datapack: {error}"));
        }
    } else {
        crate::resources::ledger::set_enabled(resource_id, enabled)
            .map_err(|error| format!("Failed to toggle datapack: {error}"))?;
    }
    Ok(())
}

pub fn delete_world_datapack(
    world_ref: &WorldRef,
    resource_id: i32,
) -> Result<WorldDatapackRemoval, String> {
    let datapacks_root = resolve_datapacks_root(world_ref, false)?
        .ok_or_else(|| "This world has no datapacks directory".to_string())?;
    let resource = crate::resources::ledger::get_resource(world_ref.instance_id, resource_id)
        .map_err(|error| format!("Failed to find datapack: {error}"))?;
    validate_resource(&resource, &datapacks_root)?;

    delete_world_datapack_bundle(world_ref, resource, &datapacks_root)
}

#[derive(Debug)]
struct StagedFileRemoval {
    original: PathBuf,
    staged: PathBuf,
}

fn delete_world_datapack_bundle(
    world_ref: &WorldRef,
    resource: InstalledResource,
    datapacks_root: &Path,
) -> Result<WorldDatapackRemoval, String> {
    let world_root = datapacks_root
        .parent()
        .ok_or_else(|| "Invalid world datapacks directory".to_string())?;
    let instance = crate::commands::instances::get_instance(world_ref.instance_id)?;
    let game_root = crate::worlds::instance_game_directory(&instance)?;
    let saves_root = game_root.join("saves");
    let managed = crate::worlds::manifest::managed_datapack_manifest(&resource)?;

    let mut manifest_publication = None;
    let mut companion_files = Vec::new();
    let mut retained_companion_count = 0;
    if let Some((managed_world, mut manifest, component_index)) = managed {
        if managed_world != world_root {
            return Err("The managed datapack belongs to another world".to_string());
        }
        let bundle_id = manifest.managed_components[component_index].bundle_id;
        let companions = manifest
            .managed_components
            .iter()
            .filter(|component| {
                component.bundle_id == bundle_id
                    && component.kind == ManagedComponentKind::CompanionResourcepack
            })
            .cloned()
            .collect::<Vec<_>>();
        for companion in &companions {
            let path = managed_companion_path(&game_root, companion)?;
            if companion_is_referenced_in_manifest(&manifest, bundle_id, &companion.relative_path)
                || companion_is_referenced_elsewhere(
                    &saves_root,
                    world_root,
                    &companion.relative_path,
                )
                || !managed_companion_matches(&path, companion)
            {
                retained_companion_count += 1;
            } else {
                companion_files.push(path);
            }
        }
        let previous = manifest.clone();
        manifest.managed_components.retain(|component| {
            component.bundle_id != bundle_id
                || (component.kind != ManagedComponentKind::Datapack
                    && component.kind != ManagedComponentKind::CompanionResourcepack)
        });
        manifest.updated_at = Utc::now();
        manifest_publication = Some((managed_world, previous, manifest));
    }

    companion_files.sort();
    companion_files.dedup();
    let mut staged = Vec::with_capacity(1 + companion_files.len());
    stage_removal(Path::new(&resource.local_path), &mut staged, "datapack")?;
    for companion in &companion_files {
        if let Err(error) = stage_removal(companion, &mut staged, "companion") {
            return Err(with_rollback(error, restore_staged_files(&staged)));
        }
    }

    if let Some((world, _, manifest)) = &manifest_publication {
        if let Err(error) = crate::worlds::manifest::write_manifest(world, manifest) {
            return Err(with_rollback(error, restore_staged_files(&staged)));
        }
    }

    let mut resource_ids = vec![resource.id];
    for path in &companion_files {
        match crate::resources::ledger::get_resource_by_path(world_ref.instance_id, path) {
            Ok(Some(row)) if row.resource_type.eq_ignore_ascii_case("resourcepack") => {
                resource_ids.push(row.id);
            }
            Ok(_) => {}
            Err(error) => {
                return Err(with_rollback(
                    format!("Failed to inspect companion Resource: {error}"),
                    restore_bundle_removal(&staged, manifest_publication.as_ref()),
                ));
            }
        }
    }
    if let Err(error) =
        crate::resources::ledger::remove_resource_rows(world_ref.instance_id, &resource_ids)
    {
        return Err(with_rollback(
            format!("Failed to update installed Resource records: {error}"),
            restore_bundle_removal(&staged, manifest_publication.as_ref()),
        ));
    }

    let cleanup_failures = staged
        .iter()
        .filter_map(|entry| {
            fs::remove_file(&entry.staged)
                .err()
                .map(|error| format!("{}: {error}", entry.staged.display()))
        })
        .collect::<Vec<_>>();
    Ok(WorldDatapackRemoval {
        removed_companion_count: companion_files.len(),
        retained_companion_count,
        cleanup_warning: (!cleanup_failures.is_empty()).then(|| {
            format!(
                "Removed the bundle, but temporary-file cleanup failed: {}",
                cleanup_failures.join("; ")
            )
        }),
    })
}

fn stage_removal(
    original: &Path,
    staged: &mut Vec<StagedFileRemoval>,
    label: &str,
) -> Result<(), String> {
    let parent = original
        .parent()
        .ok_or_else(|| format!("Invalid managed {label} path"))?;
    let temporary = parent.join(format!(".vesta-delete-{}-{label}.tmp", Uuid::new_v4()));
    fs::rename(original, &temporary).map_err(|error| {
        format!(
            "Failed to stage managed {label} {} for removal: {error}",
            original.display()
        )
    })?;
    staged.push(StagedFileRemoval {
        original: original.to_path_buf(),
        staged: temporary,
    });
    Ok(())
}

fn restore_staged_files(staged: &[StagedFileRemoval]) -> Result<(), String> {
    let mut failures = Vec::new();
    for entry in staged.iter().rev() {
        if entry.staged.exists() && !entry.original.exists() {
            if let Err(error) = fs::rename(&entry.staged, &entry.original) {
                failures.push(format!("{}: {error}", entry.original.display()));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to restore staged files: {}",
            failures.join("; ")
        ))
    }
}

fn restore_bundle_removal(
    staged: &[StagedFileRemoval],
    manifest_publication: Option<&(PathBuf, WorldManifest, WorldManifest)>,
) -> Result<(), String> {
    let files = restore_staged_files(staged).err();
    let mut manifest_error = None;
    if let Some((world, previous, _)) = manifest_publication {
        manifest_error = crate::worlds::manifest::write_manifest(world, previous).err();
    }
    match (files, manifest_error) {
        (None, None) => Ok(()),
        (files, manifest) => Err([files, manifest]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("; ")),
    }
}

fn with_rollback(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => error,
        Err(rollback_error) => format!("{error}; rollback also failed: {rollback_error}"),
    }
}

fn managed_companion_path(
    game_root: &Path,
    component: &ManagedComponent,
) -> Result<PathBuf, String> {
    if component.scope != ComponentScope::Instance {
        return Err("Managed companion Resource pack has an invalid scope".to_string());
    }
    let relative = Path::new(&component.relative_path);
    let components = relative.components().collect::<Vec<_>>();
    if relative.is_absolute()
        || components.iter().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
        || components.len() != 2
        || components[0].as_os_str() != "resourcepacks"
        || !matches!(components[1], std::path::Component::Normal(_))
    {
        return Err("World metadata contains an unsafe companion Resource path".to_string());
    }
    Ok(game_root.join(relative))
}

fn managed_companion_matches(path: &Path, component: &ManagedComponent) -> bool {
    let parent_metadata = path
        .parent()
        .and_then(|parent| fs::symlink_metadata(parent).ok());
    if !parent_metadata
        .is_some_and(|metadata| metadata.file_type().is_dir() && !metadata.file_type().is_symlink())
    {
        return false;
    }
    let metadata = fs::symlink_metadata(path).ok();
    if !metadata.is_some_and(|metadata| {
        metadata.file_type().is_file() && !metadata.file_type().is_symlink()
    }) {
        return false;
    }
    sha1_path(path).is_some_and(|hash| hash.eq_ignore_ascii_case(&component.sha1))
}

fn companion_is_referenced_in_manifest(
    manifest: &WorldManifest,
    removing_bundle_id: Uuid,
    relative_path: &str,
) -> bool {
    let expected = normalize_manifest_path(relative_path);
    manifest.managed_components.iter().any(|component| {
        component.bundle_id != removing_bundle_id
            && component.kind == ManagedComponentKind::CompanionResourcepack
            && component.scope == ComponentScope::Instance
            && normalize_manifest_path(&component.relative_path) == expected
    })
}

fn sha1_path(path: &Path) -> Option<String> {
    use sha1::{Digest, Sha1};
    use std::io::Read;

    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha1::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(hex::encode(hasher.finalize()))
}

/// Unknown or unreadable metadata is treated as a possible reference. It is
/// safer to retain an orphaned Resource pack than to remove one another World
/// may still require.
fn companion_is_referenced_elsewhere(
    saves_root: &Path,
    current_world: &Path,
    relative_path: &str,
) -> bool {
    let Ok(entries) = fs::read_dir(saves_root) else {
        return true;
    };
    let expected = normalize_manifest_path(relative_path);
    for entry in entries.flatten() {
        let path = entry.path();
        if path == current_world
            || !entry
                .file_type()
                .is_ok_and(|file_type| file_type.is_dir() && !file_type.is_symlink())
            || !crate::worlds::level_dat::has_level_marker(&path)
        {
            continue;
        }
        let read = crate::worlds::manifest::read_manifest(&path);
        match read.status {
            MetadataStatus::Valid => {
                if read.manifest.is_some_and(|manifest| {
                    manifest.managed_components.iter().any(|component| {
                        component.kind == ManagedComponentKind::CompanionResourcepack
                            && component.scope == ComponentScope::Instance
                            && normalize_manifest_path(&component.relative_path) == expected
                    })
                }) {
                    return true;
                }
            }
            MetadataStatus::Corrupt | MetadataStatus::Future => return true,
            MetadataStatus::Absent => {}
        }
    }
    false
}

/// Returns true when an instance Resource pack may still be owned by any
/// managed World. Unreadable topology or metadata is intentionally treated as
/// a possible reference so generic Resource actions cannot break a bundle.
pub fn companion_resourcepack_may_be_referenced(
    instance_id: i32,
    resourcepack_path: &Path,
) -> Result<bool, String> {
    let instance = crate::commands::instances::get_instance(instance_id)?;
    let game_root = crate::worlds::instance_game_directory(&instance)?;
    companion_resourcepack_may_be_referenced_in_game_root(&game_root, resourcepack_path)
}

fn companion_resourcepack_may_be_referenced_in_game_root(
    game_root: &Path,
    resourcepack_path: &Path,
) -> Result<bool, String> {
    let resourcepacks_root = game_root.join("resourcepacks");
    if resourcepack_path
        .parent()
        .is_none_or(|parent| normalize_path(parent) != normalize_path(&resourcepacks_root))
    {
        return Ok(false);
    }
    let relative = resourcepack_path
        .strip_prefix(game_root)
        .map_err(|_| "Resource pack escaped its Instance".to_string())?;
    let expected = normalize_manifest_path(&relative.to_string_lossy());
    let saves_root = game_root.join("saves");
    let entries = fs::read_dir(&saves_root).map_err(|error| {
        format!(
            "Cannot verify World references in {}: {error}",
            saves_root.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Cannot verify every World reference in {}: {error}",
                saves_root.display()
            )
        })?;
        let world = entry.path();
        if !entry
            .file_type()
            .is_ok_and(|file_type| file_type.is_dir() && !file_type.is_symlink())
            || !crate::worlds::level_dat::has_level_marker(&world)
        {
            continue;
        }
        let read = crate::worlds::manifest::read_manifest(&world);
        match read.status {
            MetadataStatus::Valid => {
                if read.manifest.is_some_and(|manifest| {
                    manifest.managed_components.iter().any(|component| {
                        component.kind == ManagedComponentKind::CompanionResourcepack
                            && component.scope == ComponentScope::Instance
                            && normalize_manifest_path(&component.relative_path) == expected
                    })
                }) {
                    return Ok(true);
                }
            }
            MetadataStatus::Corrupt | MetadataStatus::Future => return Ok(true),
            MetadataStatus::Absent => {}
        }
    }
    Ok(false)
}

fn normalize_manifest_path(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .filter(|component| !component.is_empty() && *component != ".")
        .collect::<Vec<_>>()
        .join("/")
}

pub fn emit_world_datapacks_changed(
    app: &AppHandle,
    world_ref: &WorldRef,
    reason: &str,
) -> Result<(), String> {
    if let Some(world_manager) = app.try_state::<crate::worlds::WorldManager>() {
        world_manager.invalidate(world_ref.instance_id);
    }
    let revision = Utc::now().timestamp_millis();
    app.emit(
        "core://world-datapacks-changed",
        serde_json::json!({
            "world": world_ref,
            "revision": revision,
            "reason": reason,
        }),
    )
    .map_err(|error| format!("Failed to emit world datapack change: {error}"))?;
    app.emit(
        "core://instance-worlds-changed",
        serde_json::json!({
            "instanceId": world_ref.instance_id,
            "revision": revision,
            "reason": reason,
        }),
    )
    .map_err(|error| format!("Failed to emit instance world change: {error}"))
}

fn resolve_datapacks_root(world_ref: &WorldRef, create: bool) -> Result<Option<PathBuf>, String> {
    let world_root = crate::worlds::resolve_world_path(world_ref)?;
    let datapacks = world_root.join("datapacks");
    match fs::symlink_metadata(&datapacks) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
                return Err("The world datapacks path is not a safe directory".to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&datapacks)
                .map_err(|error| format!("Failed to create {}: {error}", datapacks.display()))?;
        }
        Err(error) => {
            return Err(format!(
                "Failed to inspect {}: {error}",
                datapacks.display()
            ))
        }
    }
    let datapacks = datapacks
        .canonicalize()
        .map_err(|error| format!("Failed to resolve datapacks directory: {error}"))?;
    if datapacks.parent() != Some(world_root.as_path()) {
        return Err("The datapacks directory escapes the selected world".to_string());
    }
    Ok(Some(datapacks))
}

fn validate_resource(resource: &InstalledResource, datapacks_root: &Path) -> Result<(), String> {
    if !resource.resource_type.eq_ignore_ascii_case("datapack") {
        return Err("The selected Resource is not a datapack".to_string());
    }
    let path = Path::new(&resource.local_path);
    validate_destination(path, datapacks_root)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to access datapack: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err("Only direct datapack files can be managed".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve datapack: {error}"))?;
    if canonical.parent() != Some(datapacks_root) {
        return Err("The selected datapack belongs to another world".to_string());
    }
    Ok(())
}

fn validate_destination(path: &Path, datapacks_root: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid datapack path".to_string())?;
    if normalize_path(parent) != normalize_path(datapacks_root) || !is_datapack_file(path) {
        return Err("The selected datapack is not a direct file in this world".to_string());
    }
    Ok(())
}

fn list_entries(
    datapacks_root: &Path,
    rows: &[InstalledResource],
    manifest: Option<&WorldManifest>,
) -> Result<Vec<WorldDatapackSummary>, String> {
    let rows = rows
        .iter()
        .map(|row| (normalize_path(Path::new(&row.local_path)), row))
        .collect::<HashMap<_, _>>();
    let mut entries = Vec::new();
    for entry in fs::read_dir(datapacks_root)
        .map_err(|error| format!("Failed to read {}: {error}", datapacks_root.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read datapack entry: {error}"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("Failed to inspect datapack entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let entry_kind = if metadata.file_type().is_dir() && is_directory_datapack(&entry.path()) {
            DatapackEntryKind::Directory
        } else if metadata.file_type().is_file() && is_datapack_file(&entry.path()) {
            DatapackEntryKind::File
        } else {
            continue;
        };
        let file_name = entry.file_name().to_string_lossy().to_string();
        let row = rows.get(&normalize_path(&entry.path())).copied();
        let relative = format!("datapacks/{file_name}");
        let managed = manifest.is_some_and(|manifest| {
            manifest.managed_components.iter().any(|component| {
                component.kind == ManagedComponentKind::Datapack
                    && component.relative_path == relative
            })
        });
        let is_directory = entry_kind == DatapackEntryKind::Directory;
        entries.push(WorldDatapackSummary {
            resource_id: row.map(|row| row.id),
            file_name: file_name.clone(),
            display_name: row
                .map(|row| row.display_name.clone())
                .unwrap_or_else(|| display_name_from_file(&file_name)),
            entry_kind,
            platform: row.map(|row| row.platform.clone()),
            project_id: row.and_then(|row| non_empty(&row.remote_id)),
            version_id: row.and_then(|row| non_empty(&row.remote_version_id)),
            version_number: row.and_then(|row| non_empty(&row.current_version)),
            enabled: is_directory || !file_name.ends_with(".disabled"),
            managed,
            read_only: is_directory || row.is_none(),
            size_bytes: if is_directory {
                logical_size(&entry.path())
            } else {
                metadata.len()
            },
            modified_at: metadata
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
                .map(|value| value.to_rfc3339()),
        });
    }
    entries.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    Ok(entries)
}

pub(crate) fn is_datapack_file(path: &Path) -> bool {
    let mut name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if let Some(enabled_name) = name.strip_suffix(".disabled") {
        name = enabled_name;
    }
    Path::new(name).extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("zip") || extension.eq_ignore_ascii_case("jar")
    })
}

pub(crate) fn is_directory_datapack(path: &Path) -> bool {
    fs::symlink_metadata(path.join("pack.mcmeta"))
        .is_ok_and(|metadata| metadata.file_type().is_file() && !metadata.file_type().is_symlink())
}

fn release_allowed(candidate: ReleaseType, installed: &str) -> bool {
    match installed.to_ascii_lowercase().as_str() {
        "alpha" => true,
        "beta" => candidate != ReleaseType::Alpha,
        _ => candidate == ReleaseType::Release,
    }
}

fn display_name_from_file(file_name: &str) -> String {
    let enabled = file_name.strip_suffix(".disabled").unwrap_or(file_name);
    Path::new(enabled)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(enabled)
        .to_string()
}

fn non_empty(value: &str) -> Option<String> {
    (!value.trim().is_empty() && value != "unknown").then(|| value.to_string())
}

fn logical_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .is_file()
                .then(|| entry.metadata().ok().map(|metadata| metadata.len()))
                .flatten()
        })
        .sum()
}

fn relative_world_path(world: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(world)
        .map_err(|_| "Managed datapack escaped its world".to_string())
        .map(|relative| {
            relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn resource(id: i32, path: &Path) -> InstalledResource {
        InstalledResource {
            id,
            instance_id: 1,
            platform: "modrinth".to_string(),
            remote_id: "project".to_string(),
            remote_version_id: "version".to_string(),
            resource_type: "datapack".to_string(),
            local_path: normalize_path(path),
            display_name: "Managed pack".to_string(),
            current_version: "1.0".to_string(),
            is_manual: false,
            is_enabled: true,
            last_updated: Utc::now().to_rfc3339(),
            release_type: "release".to_string(),
            hash: Some("abc".to_string()),
            file_size: 3,
            file_mtime: 1,
            source_kind: "custom".to_string(),
            source_modpack_id: None,
            source_modpack_version_id: None,
            source_modpack_platform: None,
        }
    }

    fn version(id: &str, game_version: &str, loaders: &[&str]) -> ResourceVersion {
        ResourceVersion {
            id: id.to_string(),
            project_id: "project".to_string(),
            version_number: id.to_string(),
            game_versions: vec![game_version.to_string()],
            loaders: loaders.iter().map(|loader| loader.to_string()).collect(),
            download_url: String::new(),
            file_name: "pack.zip".to_string(),
            release_type: ReleaseType::Release,
            hash: String::new(),
            dependencies: Vec::new(),
            published_at: None,
            download_count: None,
            file_size: None,
            files: Vec::new(),
        }
    }

    #[test]
    fn lists_files_and_read_only_directory_packs_without_exposing_paths() {
        let temp = TempDir::new().unwrap();
        let datapacks = temp.path().join("datapacks");
        fs::create_dir(&datapacks).unwrap();
        let archive = datapacks.join("pack.zip");
        fs::write(&archive, [1_u8, 2, 3]).unwrap();
        fs::create_dir(datapacks.join("folder pack")).unwrap();
        fs::write(datapacks.join("folder pack/pack.mcmeta"), b"{}").unwrap();

        let entries = list_entries(&datapacks, &[resource(7, &archive)], None).unwrap();
        assert_eq!(entries.len(), 2);
        let managed = entries
            .iter()
            .find(|entry| entry.resource_id == Some(7))
            .unwrap();
        assert_eq!(managed.display_name, "Managed pack");
        assert!(!managed.read_only);
        let directory = entries
            .iter()
            .find(|entry| entry.entry_kind == DatapackEntryKind::Directory)
            .unwrap();
        assert!(directory.read_only);
        assert_eq!(directory.resource_id, None);
        assert_eq!(directory.size_bytes, 2);
    }

    #[test]
    fn disabled_zip_and_jar_names_are_recognized() {
        assert!(is_datapack_file(Path::new("pack.zip")));
        assert!(is_datapack_file(Path::new("pack.jar.disabled")));
        assert!(!is_datapack_file(Path::new("notes.txt")));
    }

    #[test]
    fn ignores_directories_without_root_pack_metadata() {
        let temp = TempDir::new().unwrap();
        let datapacks = temp.path().join("datapacks");
        fs::create_dir_all(datapacks.join("noise/nested")).unwrap();
        fs::write(datapacks.join("noise/nested/pack.mcmeta"), b"{}").unwrap();
        assert!(list_entries(&datapacks, &[], None).unwrap().is_empty());
    }

    #[test]
    fn automatic_update_requires_exact_world_version_and_datapack_variant() {
        let installed = resource(7, Path::new("/world/datapacks/pack.zip"));
        let versions = vec![
            version("wrong-loader", "1.21.1", &["fabric"]),
            version("nearby", "1.21.2", &["datapack"]),
            version("exact", "1.21.1", &["datapack"]),
            version("version", "1.21.1", &["datapack"]),
        ];
        let result = select_update_status(
            &versions,
            &installed,
            Some("1.21.1"),
            SourcePlatform::Modrinth,
            ResourceType::Mod,
        );
        assert_eq!(result.exact_version.unwrap().id, "exact");
        assert!(result.manual_review_available);
    }

    #[test]
    fn non_exact_or_unknown_world_versions_only_offer_manual_review() {
        let installed = resource(7, Path::new("/world/datapacks/pack.zip"));
        let versions = vec![
            version("nearby", "1.21.2", &["datapack"]),
            version("version", "1.21.1", &["datapack"]),
        ];
        for world_version in [Some("1.21.1"), None] {
            let result = select_update_status(
                &versions,
                &installed,
                world_version,
                SourcePlatform::Modrinth,
                ResourceType::Mod,
            );
            assert!(result.exact_version.is_none());
            assert!(result.manual_review_available);
        }
    }

    #[test]
    fn curseforge_requires_datapack_project_class() {
        let installed = resource(7, Path::new("/world/datapacks/pack.zip"));
        let versions = vec![
            version("next", "1.21.1", &[]),
            version("version", "1.21.1", &[]),
        ];
        let wrong_class = select_update_status(
            &versions,
            &installed,
            Some("1.21.1"),
            SourcePlatform::CurseForge,
            ResourceType::Mod,
        );
        assert!(wrong_class.exact_version.is_none());
        let datapack = select_update_status(
            &versions,
            &installed,
            Some("1.21.1"),
            SourcePlatform::CurseForge,
            ResourceType::DataPack,
        );
        assert_eq!(datapack.exact_version.unwrap().id, "next");
    }

    #[test]
    fn direct_parent_validation_rejects_other_worlds_and_nested_paths() {
        let temp = TempDir::new().unwrap();
        let datapacks = temp.path().join("world/datapacks");
        fs::create_dir_all(datapacks.join("nested")).unwrap();
        assert!(validate_destination(&datapacks.join("pack.zip"), &datapacks).is_ok());
        assert!(validate_destination(&datapacks.join("nested/pack.zip"), &datapacks).is_err());
        assert!(
            validate_destination(&temp.path().join("other/datapacks/pack.zip"), &datapacks)
                .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_entries_are_not_listed() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let datapacks = temp.path().join("datapacks");
        fs::create_dir(&datapacks).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        symlink(outside.path(), datapacks.join("linked.zip")).unwrap();
        assert!(list_entries(&datapacks, &[], None).unwrap().is_empty());
    }

    fn marker_world(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("level.dat"), b"marker").unwrap();
    }

    fn companion_component(relative_path: &str, sha1: &str) -> ManagedComponent {
        ManagedComponent {
            bundle_id: Uuid::new_v4(),
            kind: ManagedComponentKind::CompanionResourcepack,
            platform: "provider".into(),
            project_id: "project".into(),
            version_id: "version".into(),
            version_number: "1".into(),
            display_name: "Pack".into(),
            sha1: sha1.into(),
            scope: ComponentScope::Instance,
            relative_path: relative_path.into(),
            installed_at: Utc::now(),
        }
    }

    #[test]
    fn shared_companion_reference_is_retained_for_another_world() {
        let temp = TempDir::new().unwrap();
        let saves = temp.path().join("saves");
        let current = saves.join("Current");
        let other = saves.join("Other");
        marker_world(&current);
        marker_world(&other);
        let mut manifest = WorldManifest::new(None);
        manifest
            .managed_components
            .push(companion_component("resourcepacks/shared.zip", "abc"));
        crate::worlds::manifest::write_manifest(&other, &manifest).unwrap();

        assert!(companion_is_referenced_elsewhere(
            &saves,
            &current,
            "resourcepacks/shared.zip"
        ));
        assert!(!companion_is_referenced_elsewhere(
            &saves,
            &current,
            "resourcepacks/unused.zip"
        ));
    }

    #[test]
    fn shared_companion_reference_is_retained_for_another_bundle_in_the_same_world() {
        let removing_bundle = Uuid::new_v4();
        let mut manifest = WorldManifest::new(None);
        let mut first = companion_component("resourcepacks/shared.zip", "abc");
        first.bundle_id = removing_bundle;
        manifest.managed_components.push(first);
        manifest
            .managed_components
            .push(companion_component("resourcepacks/shared.zip", "abc"));

        assert!(companion_is_referenced_in_manifest(
            &manifest,
            removing_bundle,
            "resourcepacks/shared.zip"
        ));
    }

    #[test]
    fn uncertain_world_metadata_conservatively_retains_companions() {
        let temp = TempDir::new().unwrap();
        let saves = temp.path().join("saves");
        let current = saves.join("Current");
        let other = saves.join("Other");
        marker_world(&current);
        marker_world(&other);
        fs::create_dir_all(other.join(".vesta")).unwrap();
        fs::write(crate::worlds::manifest::manifest_path(&other), b"not-json").unwrap();

        assert!(companion_is_referenced_elsewhere(
            &saves,
            &current,
            "resourcepacks/shared.zip"
        ));
    }

    #[test]
    fn companion_content_must_match_manifest_hash_before_removal() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("pack.zip");
        fs::write(&path, b"pack").unwrap();
        let actual = sha1_path(&path).unwrap();
        assert!(managed_companion_matches(
            &path,
            &companion_component("resourcepacks/pack.zip", &actual)
        ));
        assert!(!managed_companion_matches(
            &path,
            &companion_component("resourcepacks/pack.zip", "different")
        ));
    }

    #[test]
    fn generic_resource_actions_detect_managed_companion_references() {
        let temp = TempDir::new().unwrap();
        let world = temp.path().join("saves/World");
        marker_world(&world);
        fs::create_dir_all(temp.path().join("resourcepacks")).unwrap();
        let pack = temp.path().join("resourcepacks/shared.zip");
        fs::write(&pack, b"pack").unwrap();
        let mut manifest = WorldManifest::new(None);
        manifest
            .managed_components
            .push(companion_component("resourcepacks/shared.zip", "abc"));
        crate::worlds::manifest::write_manifest(&world, &manifest).unwrap();

        assert!(companion_resourcepack_may_be_referenced_in_game_root(temp.path(), &pack).unwrap());
        assert!(!companion_resourcepack_may_be_referenced_in_game_root(
            temp.path(),
            &temp.path().join("resourcepacks/unmanaged.zip")
        )
        .unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_resourcepack_directory_is_never_removed_through() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let path = outside.path().join("pack.zip");
        fs::write(&path, b"pack").unwrap();
        symlink(outside.path(), temp.path().join("resourcepacks")).unwrap();
        let linked_path = temp.path().join("resourcepacks/pack.zip");
        let actual = sha1_path(&linked_path).unwrap();

        assert!(!managed_companion_matches(
            &linked_path,
            &companion_component("resourcepacks/pack.zip", &actual)
        ));
        assert!(path.exists());
    }
}
