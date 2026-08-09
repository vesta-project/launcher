use crate::models::instance::Instance;
use crate::worlds::manifest::{self, ManagedComponentKind, MetadataStatus, WorldManifest};
use crate::worlds::{instance_game_directory, resolve_world_path_for_instance, WorldRef};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferMode {
    Move,
    Copy,
    Duplicate,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityWarning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct TransferResult {
    pub source_path: PathBuf,
    pub destination_path: PathBuf,
    pub destination_directory_name: String,
    pub source_removed: bool,
    pub cleanup_warning: Option<String>,
    pub companion_publications: Vec<CompanionPublication>,
    previous_manifest: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct CompanionPublication {
    pub source_path: PathBuf,
    pub destination_path: PathBuf,
    pub created: bool,
}

pub fn compatibility_warnings(
    source: &Instance,
    destination: &Instance,
    saved_world_version: Option<&str>,
) -> Vec<CompatibilityWarning> {
    let mut warnings = Vec::new();
    if source.minecraft_version != destination.minecraft_version {
        warnings.push(CompatibilityWarning {
            code: "minecraftVersion",
            message: format!(
                "Minecraft version differs: {} → {}",
                source.minecraft_version, destination.minecraft_version
            ),
        });
    }
    if source.modpack_id != destination.modpack_id
        || source.modpack_version_id != destination.modpack_version_id
    {
        warnings.push(CompatibilityWarning {
            code: "modpack",
            message: "The source and destination modpack link or version differs".to_string(),
        });
    }
    if !is_pure_vanilla(source) || !is_pure_vanilla(destination) {
        warnings.push(CompatibilityWarning {
            code: "modded",
            message: "At least one instance is not pure vanilla".to_string(),
        });
    }
    if saved_world_version.is_some_and(|saved| saved != destination.minecraft_version) {
        warnings.push(CompatibilityWarning {
            code: "savedVersion",
            message: format!(
                "The world was last saved with {}, but the destination uses {}",
                saved_world_version.unwrap(),
                destination.minecraft_version
            ),
        });
    }
    warnings
}

pub fn transfer_world(
    source_instance: &Instance,
    destination_instance: &Instance,
    world_ref: &WorldRef,
    mode: TransferMode,
    risk_acknowledged: bool,
) -> Result<TransferResult, String> {
    transfer_world_impl(
        source_instance,
        destination_instance,
        world_ref,
        mode,
        risk_acknowledged,
        false,
    )
}

/// Performs the filesystem publication while deferring destructive cleanup of
/// a cross-filesystem move until the Ledger transaction succeeds.
pub fn prepare_world_transfer(
    source_instance: &Instance,
    destination_instance: &Instance,
    world_ref: &WorldRef,
    mode: TransferMode,
    risk_acknowledged: bool,
) -> Result<TransferResult, String> {
    transfer_world_impl(
        source_instance,
        destination_instance,
        world_ref,
        mode,
        risk_acknowledged,
        true,
    )
}

fn transfer_world_impl(
    source_instance: &Instance,
    destination_instance: &Instance,
    world_ref: &WorldRef,
    mode: TransferMode,
    risk_acknowledged: bool,
    defer_cross_filesystem_cleanup: bool,
) -> Result<TransferResult, String> {
    match mode {
        TransferMode::Duplicate if source_instance.id != destination_instance.id => {
            return Err("Duplicate must stay in the source instance".to_string())
        }
        TransferMode::Move | TransferMode::Copy
            if source_instance.id == destination_instance.id =>
        {
            return Err("Move and copy require a different destination instance".to_string())
        }
        _ => {}
    }
    let source_path = resolve_world_path_for_instance(source_instance, world_ref)?;
    let level = crate::worlds::level_dat::read_world_level(&source_path);
    let warnings = compatibility_warnings(
        source_instance,
        destination_instance,
        level.version_name.as_deref(),
    );
    if !warnings.is_empty() && !risk_acknowledged {
        return Err("World transfer requires compatibility acknowledgement".to_string());
    }

    let destination_saves = instance_game_directory(destination_instance)?.join("saves");
    fs::create_dir_all(&destination_saves)
        .map_err(|error| format!("Failed to create {}: {error}", destination_saves.display()))?;
    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("World");
    let destination_name = collision_free_name(&destination_saves, original_name);
    let destination_path = destination_saves.join(&destination_name);

    if mode == TransferMode::Move && same_filesystem(&source_path, &destination_saves) {
        validate_internal_symlinks(&source_path)?;
        let previous_manifest = fs::read(manifest::manifest_path(&source_path)).ok();
        let mut world_manifest = manifest::ensure_manifest_for_management(&source_path)?;
        world_manifest.updated_at = chrono::Utc::now();
        let companion_publications =
            copy_companions(source_instance, destination_instance, &mut world_manifest)?;
        if let Err(error) = manifest::write_manifest(&source_path, &world_manifest) {
            cleanup_created_companions(&companion_publications);
            return Err(error);
        }
        if let Err(error) = fs::rename(&source_path, &destination_path) {
            restore_manifest(&source_path, previous_manifest.as_deref());
            cleanup_created_companions(&companion_publications);
            return Err(format!("Failed to move world: {error}"));
        }
        return Ok(TransferResult {
            source_path,
            destination_path,
            destination_directory_name: destination_name,
            source_removed: true,
            cleanup_warning: None,
            companion_publications,
            previous_manifest,
        });
    }

    reject_symlinks(&source_path)?;
    let staging = destination_saves.join(format!(".vesta-world-transfer-{}", Uuid::new_v4()));
    let result = copy_and_publish(
        source_instance,
        destination_instance,
        &source_path,
        &staging,
        &destination_path,
        mode,
        !defer_cross_filesystem_cleanup,
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result.map(|(cleanup_warning, companion_publications)| TransferResult {
        source_path,
        destination_path,
        destination_directory_name: destination_name,
        source_removed: mode == TransferMode::Move
            && !defer_cross_filesystem_cleanup
            && cleanup_warning.is_none(),
        cleanup_warning,
        companion_publications,
        previous_manifest: None,
    })
}

pub fn rollback_prepared_transfer(
    result: &TransferResult,
    mode: TransferMode,
) -> Result<(), String> {
    for companion in &result.companion_publications {
        if companion.created {
            let _ = fs::remove_file(&companion.destination_path);
        }
    }
    if mode == TransferMode::Move && result.source_removed {
        fs::rename(&result.destination_path, &result.source_path)
            .map_err(|error| format!("Failed to roll back world move: {error}"))?;
        restore_manifest(&result.source_path, result.previous_manifest.as_deref());
        Ok(())
    } else {
        fs::remove_dir_all(&result.destination_path)
            .map_err(|error| format!("Failed to roll back copied world: {error}"))
    }
}

pub fn finalize_prepared_move(result: &mut TransferResult) {
    if result.source_removed {
        return;
    }
    match fs::remove_dir_all(&result.source_path) {
        Ok(()) => result.source_removed = true,
        Err(error) => {
            result.cleanup_warning = Some(format!(
                "The verified destination was kept, but the source could not be removed: {error}"
            ));
        }
    }
}

fn copy_and_publish(
    source_instance: &Instance,
    destination_instance: &Instance,
    source: &Path,
    staging: &Path,
    destination: &Path,
    mode: TransferMode,
    delete_source_after_publish: bool,
) -> Result<(Option<String>, Vec<CompanionPublication>), String> {
    let (source_count, source_bytes) = copy_tree_verified(source, staging)?;
    let (destination_count, destination_bytes) = verify_tree_pair(source, staging)?;
    if source_count != destination_count || source_bytes != destination_bytes {
        return Err("World copy verification did not match source file count and size".to_string());
    }

    if manifest::read_manifest(staging).status == MetadataStatus::Future {
        return Err(
            "This world uses a newer Vesta metadata format and cannot be transferred safely"
                .to_string(),
        );
    }
    let managed_manifest = manifest::ensure_manifest_for_management(staging)?;
    let mut world_manifest = if mode == TransferMode::Move {
        managed_manifest
    } else {
        managed_manifest.clone_with_new_identity()
    };
    world_manifest.updated_at = chrono::Utc::now();
    let companion_publications =
        copy_companions(source_instance, destination_instance, &mut world_manifest)?;
    if let Err(error) = manifest::write_manifest(staging, &world_manifest) {
        cleanup_created_companions(&companion_publications);
        return Err(error);
    }
    if let Err(error) = fs::rename(staging, destination) {
        cleanup_created_companions(&companion_publications);
        return Err(format!("Failed to publish copied world: {error}"));
    }

    if mode == TransferMode::Move && delete_source_after_publish {
        if let Err(error) = fs::remove_dir_all(source) {
            return Ok((
                Some(format!(
                    "The verified destination was kept, but the source could not be removed: {error}"
                )),
                companion_publications,
            ));
        }
    }
    Ok((None, companion_publications))
}

fn copy_tree_verified(source: &Path, destination: &Path) -> Result<(u64, u64), String> {
    fs::create_dir(destination).map_err(|error| error.to_string())?;
    let mut files = 0_u64;
    let mut bytes = 0_u64;
    for entry in WalkDir::new(source).follow_links(false).into_iter() {
        let entry = entry.map_err(|error| error.to_string())?;
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let output = destination.join(relative);
        if entry.file_type().is_symlink() {
            return Err(format!("World contains a symlink: {}", relative.display()));
        } else if entry.file_type().is_dir() {
            fs::create_dir(&output).map_err(|error| error.to_string())?;
        } else if entry.file_type().is_file() {
            fs::copy(entry.path(), &output).map_err(|error| error.to_string())?;
            let source_hash = sha256_file(entry.path())?;
            let copied_hash = sha256_file(&output)?;
            if source_hash != copied_hash {
                return Err(format!(
                    "Copied file failed verification: {}",
                    relative.display()
                ));
            }
            let length = entry.metadata().map_err(|error| error.to_string())?.len();
            files += 1;
            bytes = bytes.saturating_add(length);
        }
    }
    Ok((files, bytes))
}

fn verify_tree_pair(source: &Path, destination: &Path) -> Result<(u64, u64), String> {
    let mut files = 0_u64;
    let mut bytes = 0_u64;
    for entry in WalkDir::new(source).follow_links(false).into_iter() {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        let copied = destination.join(relative);
        if sha256_file(entry.path())? != sha256_file(&copied)? {
            return Err(format!(
                "Copied file failed verification: {}",
                relative.display()
            ));
        }
        files += 1;
        bytes = bytes.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
    }
    Ok((files, bytes))
}

fn sha256_file(path: &Path) -> Result<[u8; 32], String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn copy_companions(
    source_instance: &Instance,
    destination_instance: &Instance,
    world_manifest: &mut WorldManifest,
) -> Result<Vec<CompanionPublication>, String> {
    if source_instance.id == destination_instance.id {
        return Ok(Vec::new());
    }
    let mut publications = Vec::new();
    if let Err(error) = copy_companions_inner(
        source_instance,
        destination_instance,
        world_manifest,
        &mut publications,
    ) {
        cleanup_created_companions(&publications);
        return Err(error);
    }
    Ok(publications)
}

fn copy_companions_inner(
    source_instance: &Instance,
    destination_instance: &Instance,
    world_manifest: &mut WorldManifest,
    publications: &mut Vec<CompanionPublication>,
) -> Result<(), String> {
    let source_game = instance_game_directory(source_instance)?;
    let destination_game = instance_game_directory(destination_instance)?;
    for component in world_manifest
        .managed_components
        .iter_mut()
        .filter(|component| component.kind == ManagedComponentKind::CompanionResourcepack)
    {
        let relative_path = Path::new(&component.relative_path);
        validate_relative_component_path(relative_path)?;
        if relative_path
            .components()
            .next()
            .and_then(|part| part.as_os_str().to_str())
            != Some("resourcepacks")
        {
            return Err(
                "Managed companion pack must stay under the resourcepacks directory".to_string(),
            );
        }
        let source = source_game.join(relative_path);
        if !fs::symlink_metadata(&source)
            .map(|metadata| metadata.file_type().is_file())
            .unwrap_or(false)
        {
            return Err(format!(
                "Managed companion pack is missing: {}",
                source.display()
            ));
        }
        let relative_parent = relative_path.parent().unwrap_or(Path::new("resourcepacks"));
        let destination_parent = destination_game.join(relative_parent);
        fs::create_dir_all(&destination_parent).map_err(|error| error.to_string())?;
        let requested = relative_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("resourcepack.zip");
        let source_hash = sha256_file(&source)?;
        let direct = destination_parent.join(requested);
        let (destination, created) = if direct.is_file() && sha256_file(&direct)? == source_hash {
            (direct, false)
        } else if !direct.exists() {
            fs::copy(&source, &direct).map_err(|error| error.to_string())?;
            (direct, true)
        } else {
            let stem = Path::new(requested)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("resourcepack");
            let extension = Path::new(requested)
                .extension()
                .and_then(|ext| ext.to_str());
            let mut index = 2_u32;
            loop {
                let name = match extension {
                    Some(extension) => format!("{stem} ({index}).{extension}"),
                    None => format!("{stem} ({index})"),
                };
                let candidate = destination_parent.join(name);
                if candidate.is_file() && sha256_file(&candidate)? == source_hash {
                    break (candidate, false);
                }
                if !candidate.exists() {
                    fs::copy(&source, &candidate).map_err(|error| error.to_string())?;
                    break (candidate, true);
                }
                index += 1;
            }
        };
        component.relative_path = destination
            .strip_prefix(&destination_game)
            .map_err(|_| "Companion pack escaped destination instance".to_string())?
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        publications.push(CompanionPublication {
            source_path: source,
            destination_path: destination,
            created,
        });
    }
    Ok(())
}

fn cleanup_created_companions(publications: &[CompanionPublication]) {
    for publication in publications {
        if publication.created {
            let _ = fs::remove_file(&publication.destination_path);
        }
    }
}

fn validate_relative_component_path(path: &Path) -> Result<(), String> {
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || path.components().next().is_none()
    {
        return Err("World metadata contains an unsafe component path".to_string());
    }
    Ok(())
}

fn reject_symlinks(world_root: &Path) -> Result<(), String> {
    if let Some(entry) = WalkDir::new(world_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| entry.file_type().is_symlink())
    {
        return Err(format!(
            "World contains a symlink: {}",
            entry.path().display()
        ));
    }
    Ok(())
}

fn validate_internal_symlinks(world_root: &Path) -> Result<(), String> {
    let canonical_root = world_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    for entry in WalkDir::new(world_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_symlink() {
            let resolved = entry
                .path()
                .canonicalize()
                .map_err(|error| error.to_string())?;
            if !resolved.starts_with(&canonical_root) {
                return Err(format!(
                    "World contains an external symlink: {}",
                    entry.path().display()
                ));
            }
        }
    }
    Ok(())
}

fn restore_manifest(world_root: &Path, previous: Option<&[u8]>) {
    let _ = manifest::restore_manifest_bytes(world_root, previous);
}

fn is_pure_vanilla(instance: &Instance) -> bool {
    let loader_is_vanilla = instance
        .modloader
        .as_deref()
        .map(str::trim)
        .is_none_or(|loader| loader.is_empty() || loader.eq_ignore_ascii_case("vanilla"));
    instance.modpack_id.is_none() && loader_is_vanilla
}

fn collision_free_name(saves: &Path, requested: &str) -> String {
    if !saves.join(requested).exists() {
        return requested.to_string();
    }
    for index in 2_u32.. {
        let candidate = format!("{requested} ({index})");
        if !saves.join(&candidate).exists() {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(unix)]
fn same_filesystem(source: &Path, destination_directory: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(source)
        .and_then(|source| {
            fs::metadata(destination_directory).map(|destination| source.dev() == destination.dev())
        })
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn same_filesystem(_source: &Path, _destination_directory: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use serde::Serialize;
    use std::collections::HashSet;
    use std::io::Write;

    fn instance(id: i32, root: &Path, version: &str) -> Instance {
        Instance {
            id,
            name: format!("Instance {id}"),
            game_directory: Some(root.to_string_lossy().to_string()),
            minecraft_version: version.to_string(),
            ..Instance::default()
        }
    }

    fn write_level(world: &Path, name: &str) {
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Root {
            data: Data,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Data {
            level_name: String,
        }
        fs::create_dir_all(world).unwrap();
        let nbt = fastnbt::to_bytes(&Root {
            data: Data {
                level_name: name.to_string(),
            },
        })
        .unwrap();
        let file = File::create(world.join("level.dat")).unwrap();
        let mut encoder = GzEncoder::new(file, Compression::default());
        encoder.write_all(&nbt).unwrap();
        encoder.finish().unwrap();
    }

    #[test]
    fn compatibility_warns_for_version_modpack_and_modded_differences() {
        let temp = tempfile::TempDir::new().unwrap();
        let source = instance(1, temp.path(), "1.20.1");
        let mut destination = instance(2, temp.path(), "1.21.1");
        destination.modloader = Some("fabric".into());
        destination.modpack_id = Some("pack".into());
        let warnings = compatibility_warnings(&source, &destination, Some("1.20.1"));
        let codes: HashSet<_> = warnings.iter().map(|warning| warning.code).collect();
        assert!(codes.contains("minecraftVersion"));
        assert!(codes.contains("modpack"));
        assert!(codes.contains("modded"));
        assert!(codes.contains("savedVersion"));
    }

    #[test]
    fn copied_tree_is_verified_and_symlinks_are_not_followed() {
        let temp = tempfile::TempDir::new().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("level.dat"), b"bytes").unwrap();
        assert_eq!(copy_tree_verified(&source, &destination).unwrap(), (1, 5));
        assert_eq!(verify_tree_pair(&source, &destination).unwrap(), (1, 5));
    }

    #[test]
    fn collision_names_are_deterministic() {
        let temp = tempfile::TempDir::new().unwrap();
        fs::create_dir(temp.path().join("World")).unwrap();
        fs::create_dir(temp.path().join("World (2)")).unwrap();
        assert_eq!(collision_free_name(temp.path(), "World"), "World (3)");
    }

    #[test]
    fn same_filesystem_move_preserves_world_identity() {
        let temp = tempfile::TempDir::new().unwrap();
        let source_game = temp.path().join("source");
        let destination_game = temp.path().join("destination");
        let source_world = source_game.join("saves/World");
        fs::create_dir_all(destination_game.join("saves")).unwrap();
        write_level(&source_world, "World");
        let manifest = WorldManifest::new(None);
        let world_id = manifest.world_id;
        manifest::write_manifest(&source_world, &manifest).unwrap();
        let source = instance(1, &source_game, "1.21.1");
        let destination = instance(2, &destination_game, "1.21.1");

        let result = transfer_world(
            &source,
            &destination,
            &WorldRef {
                instance_id: 1,
                directory_name: "World".into(),
            },
            TransferMode::Move,
            false,
        )
        .unwrap();
        assert!(!source_world.exists());
        assert!(result.destination_path.join("level.dat").is_file());
        assert_eq!(
            manifest::read_manifest(&result.destination_path)
                .manifest
                .unwrap()
                .world_id,
            world_id
        );
    }

    #[test]
    fn copy_preserves_source_and_regenerates_identity() {
        let temp = tempfile::TempDir::new().unwrap();
        let source_game = temp.path().join("source");
        let destination_game = temp.path().join("destination");
        let source_world = source_game.join("saves/World");
        fs::create_dir_all(destination_game.join("saves")).unwrap();
        write_level(&source_world, "World");
        let manifest = WorldManifest::new(None);
        let world_id = manifest.world_id;
        manifest::write_manifest(&source_world, &manifest).unwrap();
        let source = instance(1, &source_game, "1.21.1");
        let destination = instance(2, &destination_game, "1.21.1");

        let result = transfer_world(
            &source,
            &destination,
            &WorldRef {
                instance_id: 1,
                directory_name: "World".into(),
            },
            TransferMode::Copy,
            false,
        )
        .unwrap();
        assert!(source_world.join("level.dat").is_file());
        assert_ne!(
            manifest::read_manifest(&result.destination_path)
                .manifest
                .unwrap()
                .world_id,
            world_id
        );
    }
}
