//! Post-publication source recognition. Original artifacts and installed bytes
//! have distinct identities; provider failure never rolls back local publication.
use crate::models::installed_resource::{
    ManualSourceEvidence, ManualSourceScope, RecognizedSource,
};
use crate::models::resource::{ResourceProject, ResourceType, ResourceVersion, SourcePlatform};
use crate::resources::{ledger, reconciliation};
use crate::tasks::manager::{
    mods_conflict_key, resourcepacks_conflict_key, saves_conflict_key, shaderpacks_conflict_key,
    world_conflict_key, TaskManager,
};
use crate::utils::hash::{calculate_curseforge_fingerprint, calculate_sha1};
use crate::worlds::manifest::{self, WorldArchiveEvidence, WorldSource};
use crate::worlds::WorldRef;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

// Test-only conversion by parsed Windows prefix; production preserves all paths.
#[cfg(all(test, windows))]
pub(crate) fn ordinary_windows_test_path(path: &Path) -> PathBuf {
    use std::path::{Component, Prefix};
    let mut components = path.components();
    match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::VerbatimDisk(drive) | Prefix::Disk(drive) => {
                let mut ordinary = PathBuf::from(format!("{}:\\", drive as char));
                ordinary.extend(components.filter(|part| !matches!(part, Component::RootDir)));
                ordinary
            }
            _ => panic!("test requires a local drive path"),
        },
        _ => panic!("test requires an absolute Windows path"),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PublishedSource {
    instance_id: i32,
    game_root: PathBuf,
    path: PathBuf,
    original_path: PathBuf,
    original_sha1: String,
    installed_sha1: String,
    resource_type: ResourceType,
    target: Target,
}

#[derive(Debug, Clone)]
enum Target {
    File {
        row_id: i32,
        world: Option<(WorldRef, Uuid)>,
    },
    World {
        world: WorldRef,
        world_id: Uuid,
    },
}

fn type_name(kind: ResourceType) -> String {
    format!("{kind:?}").to_ascii_lowercase()
}

fn recognized(project: &ResourceProject, version: &ResourceVersion) -> RecognizedSource {
    RecognizedSource {
        platform: project.source.as_str().into(),
        project_id: project.id.clone(),
        version_id: version.id.clone(),
        version_number: version.version_number.clone(),
        display_name: project.name.clone(),
        icon_url: project.icon_url.clone(),
        web_url: project.web_url.clone(),
    }
}

impl PublishedSource {
    fn file_evidence(&self) -> ManualSourceEvidence {
        let scope = match &self.target {
            Target::File {
                world: Some((_, world_id)),
                ..
            } => ManualSourceScope::World {
                world_id: *world_id,
            },
            _ => ManualSourceScope::Instance,
        };
        ManualSourceEvidence {
            original_sha1: self.original_sha1.clone(),
            installed_sha1: self.installed_sha1.clone(),
            resource_type: type_name(self.resource_type),
            scope,
            source: None,
        }
    }

    fn world_evidence(&self, world_id: Uuid) -> WorldArchiveEvidence {
        WorldArchiveEvidence {
            original_sha1: self.original_sha1.clone(),
            installed_content_sha1: self.installed_sha1.clone(),
            world_id,
            source: None,
        }
    }

    fn conflict_keys(&self) -> Vec<String> {
        match &self.target {
            Target::World { world, .. }
            | Target::File {
                world: Some((world, _)),
                ..
            } => vec![
                saves_conflict_key(self.instance_id),
                world_conflict_key(self.instance_id, &world.directory_name),
            ],
            _ => vec![match self.resource_type {
                ResourceType::Mod => mods_conflict_key(self.instance_id),
                ResourceType::Shader => shaderpacks_conflict_key(self.instance_id),
                _ => resourcepacks_conflict_key(self.instance_id),
            }],
        }
    }
}

/// Capture and save unmatched original evidence under publication exclusion.
/// The original path is an immutable inspection snapshot, or the published file
/// when there was no coherent enclosing artifact. Never accept a mixed outer ZIP.
pub(crate) fn capture_file(
    instance_id: i32,
    game_root: &Path,
    path: &Path,
    original: Option<&Path>,
    kind: ResourceType,
    world: Option<&WorldRef>,
) -> Result<PublishedSource, String> {
    let row = ledger::get_resource_by_path(instance_id, path)
        .map_err(|e| e.to_string())?
        .ok_or("Published resource was not registered")?;
    let world = world
        .map(|world| {
            let root = crate::worlds::resolve_world_path(world)?;
            let manifest = manifest::ensure_manifest_for_management(&root)?;
            Ok::<_, String>((world.clone(), manifest.world_id))
        })
        .transpose()?;
    let original_path = original.unwrap_or(path).to_path_buf();
    // Publication just computed this exact hash under the same exclusion. Late
    // persistence rehashes the file, so do not reread it twice during capture.
    let installed_sha1 = row
        .hash
        .clone()
        .filter(|hash| !hash.is_empty())
        .ok_or("Published resource has no installed content hash")?;
    let original_sha1 = if original.is_none() {
        installed_sha1.clone()
    } else {
        calculate_sha1(&original_path).map_err(|e| e.to_string())?
    };
    let published = PublishedSource {
        instance_id,
        game_root: game_root.to_path_buf(),
        path: path.to_path_buf(),
        original_sha1,
        original_path,
        installed_sha1,
        resource_type: kind,
        target: Target::File {
            row_id: row.id,
            world,
        },
    };
    if !ledger::enrich_manual_source(instance_id, row.id, path, &published.file_evidence(), None)
        .map_err(|e| e.to_string())?
    {
        return Err("Published resource evidence could not be bound to its ledger row".into());
    }
    Ok(published)
}

pub(crate) fn capture_world(
    instance_id: i32,
    game_root: &Path,
    world: &WorldRef,
    path: &Path,
    original: &Path,
) -> Result<PublishedSource, String> {
    let mut manifest = manifest::read_manifest(path)
        .manifest
        .ok_or("Published world metadata is unavailable")?;
    let published = PublishedSource {
        instance_id,
        game_root: game_root.to_path_buf(),
        path: path.to_path_buf(),
        original_path: original.to_path_buf(),
        original_sha1: calculate_sha1(original).map_err(|e| e.to_string())?,
        installed_sha1: world_content_sha1(path)?,
        resource_type: ResourceType::World,
        target: Target::World {
            world: world.clone(),
            world_id: manifest.world_id,
        },
    };
    manifest.archive_evidence = Some(published.world_evidence(manifest.world_id));
    manifest::write_manifest(path, &manifest)?;
    Ok(published)
}

/// Deterministic full world binding, excluding Vesta's mutable metadata. Refuse
/// symlinks rather than hashing data outside the published tree.
fn world_content_sha1(root: &Path) -> Result<String, String> {
    use sha1::{Digest, Sha1};
    let mut entries = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.path() == root || entry.path() != root.join(".vesta"))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_symlink() {
            return Err("World content contains a symlink".into());
        }
        if entry.file_type().is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            entries.push((relative, entry.path().to_path_buf()));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut digest = Sha1::new();
    for (relative, path) in entries {
        digest.update((relative.len() as u64).to_le_bytes());
        digest.update(relative.as_bytes());
        digest.update(calculate_sha1(&path).map_err(|e| e.to_string())?.as_bytes());
    }
    Ok(hex::encode(digest.finalize()))
}

fn compatible_artifact(
    project: &ResourceProject,
    version: &ResourceVersion,
    sha1: &str,
    kind: ResourceType,
) -> bool {
    if !reconciliation::version_matches_sha1(version, Some(sha1)) {
        return false;
    }
    // Explicit artifact roles take precedence for companion/alternate files.
    if let Some(file) = version.files.iter().find(|file| {
        file.hash.eq_ignore_ascii_case(sha1)
            && !file.role.is_empty()
            && file.role != "primary"
            && file.role != "alternate"
    }) {
        return file.role.eq_ignore_ascii_case(&type_name(kind))
            || (kind == ResourceType::Shader && file.role.eq_ignore_ascii_case("shaderpack"));
    }
    if kind == ResourceType::DataPack && project.source == SourcePlatform::Modrinth {
        return version
            .loaders
            .iter()
            .any(|loader| loader.eq_ignore_ascii_case("datapack"));
    }
    project.resource_type == kind || project.project_types.contains(&kind)
}

fn resolve(
    sha1: &str,
    fingerprint: Option<&str>,
    kind: ResourceType,
    modrinth: &reconciliation::ArtifactMatches,
    curseforge: &reconciliation::ArtifactMatches,
) -> Option<(ResourceProject, ResourceVersion)> {
    let mr = modrinth.get(sha1).filter(|found| {
        reconciliation::verified_artifact(found, SourcePlatform::Modrinth, sha1)
            && compatible_artifact(&found.0, &found.1, sha1, kind)
    });
    let cf = fingerprint
        .and_then(|fingerprint| curseforge.get(fingerprint))
        .filter(|found| {
            reconciliation::verified_artifact(found, SourcePlatform::CurseForge, sha1)
                && compatible_artifact(&found.0, &found.1, sha1, kind)
        });
    reconciliation::select_platform_match(None, mr, cf).cloned()
}

fn peer_evidence(
    sha1: &str,
    fingerprint: Option<&str>,
    kind: ResourceType,
    mr: &reconciliation::ArtifactMatches,
    cf: &reconciliation::ArtifactMatches,
) -> Vec<crate::models::resource::ResourceProjectPeerRecord> {
    let mut peers = Vec::new();
    let mr = mr.get(sha1).filter(|found| {
        reconciliation::verified_artifact(found, SourcePlatform::Modrinth, sha1)
            && compatible_artifact(&found.0, &found.1, sha1, kind)
    });
    let cf = fingerprint
        .and_then(|fingerprint| cf.get(fingerprint))
        .filter(|found| {
            reconciliation::verified_artifact(found, SourcePlatform::CurseForge, sha1)
                && compatible_artifact(&found.0, &found.1, sha1, kind)
        });
    if let (Some((mr, _)), Some((cf, _))) = (mr, cf) {
        reconciliation::push_peer(
            &mut peers,
            SourcePlatform::Modrinth,
            &mr.id,
            SourcePlatform::CurseForge,
            &cf.id,
            "shared-file-hash",
        );
    }
    if let Some((mr, _)) = mr {
        if let Some(cf) = mr
            .external_ids
            .as_ref()
            .and_then(|ids| ids.get("curseforge"))
        {
            reconciliation::push_peer(
                &mut peers,
                SourcePlatform::Modrinth,
                &mr.id,
                SourcePlatform::CurseForge,
                cf,
                "provider-external-id",
            );
        }
    }
    peers
}

// Validate the declared root before resolving aliases, then walk without following
// links. Trusted aliases above the root (for example /var) remain supported.
fn checked_target(root: &Path, path: &Path) -> Option<(PathBuf, fs::Metadata)> {
    let root_metadata = fs::symlink_metadata(root).ok()?;
    if !root_metadata.is_dir() || crate::instance_file::is_link(&root_metadata) {
        return None;
    }
    let canonical_root = root.canonicalize().ok()?;
    let relative = path
        .strip_prefix(root)
        .or_else(|_| path.strip_prefix(&canonical_root))
        .ok()?;
    let parts = relative.components().collect::<Vec<_>>();
    if parts
        .iter()
        .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return None;
    }
    let mut current = canonical_root.clone();
    let mut metadata = root_metadata;
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        metadata = fs::symlink_metadata(&current).ok()?;
        if crate::instance_file::is_link(&metadata)
            || (index + 1 < parts.len() && !metadata.is_dir())
        {
            return None;
        }
    }
    if !current.canonicalize().ok()?.starts_with(&canonical_root) {
        return None;
    }
    Some((relative.to_path_buf(), metadata))
}

pub(crate) fn real_target_path(root: &Path, path: &Path) -> bool {
    checked_target(root, path).is_some()
}

pub(crate) fn real_direct_child_file(game_root: &Path, directory: &Path, path: &Path) -> bool {
    // Check the declared resource directory before its canonical spelling can
    // conceal a linked directory inside the game root.
    let Some((_, metadata)) = checked_target(game_root, directory) else {
        return false;
    };
    if !metadata.is_dir() {
        return false;
    }
    checked_target(directory, path).is_some_and(|(relative, metadata)| {
        relative.components().count() == 1 && metadata.is_file()
    })
}

fn same_world(world_root: &Path, world_id: Uuid) -> bool {
    if !real_target_path(world_root, &manifest::manifest_path(world_root)) {
        return false;
    }
    let read = manifest::read_manifest(world_root);
    read.status == manifest::MetadataStatus::Valid
        && read
            .manifest
            .is_some_and(|manifest| manifest.world_id == world_id)
}

/// Called only under shared mutation exclusion, after all provider work.
fn revalidate(published: &PublishedSource) -> bool {
    let Ok(instance) = crate::commands::instances::get_instance(published.instance_id) else {
        return false;
    };
    if crate::worlds::instance_game_directory(&instance)
        .ok()
        .as_ref()
        != Some(&published.game_root)
    {
        return false;
    }
    if !real_target_path(&published.game_root, &published.path) {
        return false;
    }
    match &published.target {
        Target::File { row_id, world } => {
            if let Some((world, world_id)) = world {
                if !same_world(
                    &published
                        .game_root
                        .join("saves")
                        .join(&world.directory_name),
                    *world_id,
                ) {
                    return false;
                }
            }
            ledger::get_resource(published.instance_id, *row_id).is_ok_and(|row| {
                Path::new(&row.local_path) == published.path
                    && row.resource_type == type_name(published.resource_type)
                    && row.hash.as_deref() == Some(&published.installed_sha1)
                    && row.source_kind == "custom"
            }) && calculate_sha1(&published.path)
                .is_ok_and(|hash| hash.eq_ignore_ascii_case(&published.installed_sha1))
        }
        Target::World { world_id, .. } => same_world(&published.path, *world_id),
    }
}

/// Final world persistence seam, called under shared mutation exclusion. A
/// transfer/replacement or any changed payload leaves the published world alone.
fn persist_world_source(
    item: &PublishedSource,
    resolution: Option<&(ResourceProject, ResourceVersion)>,
) -> Result<bool, String> {
    let Target::World { world_id, .. } = &item.target else {
        return Ok(false);
    };
    if !real_target_path(&item.game_root, &item.path)
        || !real_target_path(&item.path, &manifest::manifest_path(&item.path))
    {
        return Ok(false);
    }
    let read = manifest::read_manifest(&item.path);
    let Some(mut manifest) = read
        .manifest
        .filter(|manifest| manifest.world_id == *world_id)
    else {
        return Ok(false);
    };
    if read.status != manifest::MetadataStatus::Valid
        || !world_content_sha1(&item.path).is_ok_and(|hash| hash == item.installed_sha1)
    {
        return Ok(false);
    }
    let mut evidence = item.world_evidence(*world_id);
    if let Some((project, version)) = resolution {
        // Also enforce strict compatible archive identity at the persistence seam.
        if !compatible_artifact(project, version, &item.original_sha1, ResourceType::World)
            || version.project_id != project.id
        {
            return Ok(false);
        }
        evidence.source = Some(recognized(project, version));
        manifest.source = Some(WorldSource {
            platform: project.source.as_str().into(),
            project_id: project.id.clone(),
            version_id: version.id.clone(),
            version_number: version.version_number.clone(),
            sha1: item.original_sha1.clone(),
            installed_at: chrono::Utc::now(),
        });
    }
    manifest.archive_evidence = Some(evidence);
    manifest.updated_at = chrono::Utc::now();
    manifest::write_manifest(&item.path, &manifest)?;
    Ok(true)
}

pub(crate) async fn enrich(app: &AppHandle, published: Vec<PublishedSource>) -> Vec<String> {
    if published.is_empty() {
        return Vec::new();
    }
    // Original snapshots outlive this call through the coordinator's InspectedDrop.
    let prepared = tokio::task::spawn_blocking(move || {
        published
            .into_iter()
            .map(|item| {
                let installed_fingerprint = if matches!(item.target, Target::File { .. }) {
                    calculate_curseforge_fingerprint(&item.path)
                        .ok()
                        .map(|hash| hash.to_string())
                } else {
                    None
                };
                let original_fingerprint = if item.original_sha1 == item.installed_sha1 {
                    installed_fingerprint.clone()
                } else {
                    calculate_curseforge_fingerprint(&item.original_path)
                        .ok()
                        .map(|hash| hash.to_string())
                };
                (item, installed_fingerprint, original_fingerprint)
            })
            .collect::<Vec<_>>()
    })
    .await;
    let Ok(prepared) = prepared else {
        return vec!["Source recognition was interrupted; local resources remain added.".into()];
    };
    let sha1s = prepared
        .iter()
        .flat_map(|(item, _, _)| {
            let mut hashes = vec![item.original_sha1.clone()];
            if matches!(item.target, Target::File { .. })
                && item.installed_sha1 != item.original_sha1
            {
                hashes.push(item.installed_sha1.clone());
            }
            hashes
        })
        .collect::<Vec<_>>();
    let fingerprints = prepared
        .iter()
        .flat_map(|(_, installed, original)| installed.iter().chain(original.iter()).cloned())
        .collect::<Vec<_>>();
    let (mr, cf, mut warnings) = reconciliation::lookup_artifacts(app, &sha1s, &fingerprints).await;
    let Some(tasks) = app.try_state::<TaskManager>() else {
        warnings.push("Source recognition could not acquire mutation exclusion.".into());
        return warnings;
    };
    for (item, installed_fingerprint, original_fingerprint) in prepared {
        for (sha1, fingerprint) in [
            (&item.original_sha1, original_fingerprint.as_deref()),
            (&item.installed_sha1, installed_fingerprint.as_deref()),
        ] {
            if fingerprint
                .and_then(|fingerprint| cf.get(fingerprint))
                .is_some_and(|found| {
                    !reconciliation::verified_artifact(found, SourcePlatform::CurseForge, sha1)
                })
            {
                warnings.push("A CurseForge fingerprint match failed exact SHA-1 verification; no source identity was assigned from that match.".into());
            }
        }
        let original = resolve(
            &item.original_sha1,
            original_fingerprint.as_deref(),
            item.resource_type,
            &mr,
            &cf,
        );
        let installed = if matches!(item.target, Target::File { .. }) {
            resolve(
                &item.installed_sha1,
                installed_fingerprint.as_deref(),
                item.resource_type,
                &mr,
                &cf,
            )
        } else {
            None
        };
        let _guard = tasks.acquire_conflicts(item.conflict_keys()).await;
        if !revalidate(&item) {
            continue;
        }
        let mut peers = peer_evidence(
            &item.original_sha1,
            original_fingerprint.as_deref(),
            item.resource_type,
            &mr,
            &cf,
        );
        if matches!(item.target, Target::File { .. }) {
            peers.extend(peer_evidence(
                &item.installed_sha1,
                installed_fingerprint.as_deref(),
                item.resource_type,
                &mr,
                &cf,
            ));
        }
        if reconciliation::persist_peer_links(peers).is_err() {
            warnings.push("Recognized provider peer metadata could not be saved.".into());
        }
        let result = match &item.target {
            Target::File { row_id, world } => {
                let mut evidence = item.file_evidence();
                evidence.source = original
                    .as_ref()
                    .map(|(project, version)| recognized(project, version));
                let result = ledger::enrich_manual_source(
                    item.instance_id,
                    *row_id,
                    &item.path,
                    &evidence,
                    installed.as_ref(),
                )
                .map_err(|e| e.to_string());
                if result.as_ref().is_ok_and(|changed| *changed) {
                    let _ = reconciliation::emit_rows_changed(
                        app,
                        item.instance_id,
                        "manual-source-recognition",
                    );
                    if let Some((world, _)) = world {
                        let _ = crate::worlds::datapacks::emit_world_datapacks_changed(
                            app,
                            world,
                            "manual-source-recognition",
                        );
                    }
                }
                result.map(|_| ())
            }
            Target::World { .. } => {
                let result = persist_world_source(&item, original.as_ref());
                if result.as_ref().is_ok_and(|changed| *changed) {
                    if let Some(manager) = app.try_state::<crate::worlds::WorldManager>() {
                        manager.invalidate(item.instance_id);
                    }
                    let _ = app.emit("core://instance-worlds-changed", serde_json::json!({"instanceId":item.instance_id,"revision":chrono::Utc::now().timestamp_millis(),"reason":"manual-source-recognition"}));
                }
                result.map(|_| ())
            }
        };
        if result.is_err() {
            warnings
                .push("Source metadata could not be saved; local resources remain added.".into());
        }
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::resource::ResourceVersionFile;

    #[test]
    fn checked_targets_accept_declared_aliases_and_canonical_publication() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("anchor")).unwrap();
        let game = temp.path().join("anchor/../game");
        let mods = game.join("mods");
        fs::create_dir_all(&mods).unwrap();
        let declared = mods.join("a.jar");
        fs::write(&declared, b"mod").unwrap();
        let published = declared.canonicalize().unwrap();
        assert_ne!(published.parent(), Some(mods.as_path()));
        for path in [&declared, &published] {
            assert!(real_target_path(&game, path));
            assert!(real_direct_child_file(&game, &mods, path));
        }
        assert!(real_target_path(&game, &mods.canonicalize().unwrap()));
        assert!(real_target_path(&game, &game.canonicalize().unwrap()));
        assert!(!real_direct_child_file(&game, &mods, &mods));
        assert!(!real_target_path(&game, &mods.join("../mods/a.jar")));
        assert!(!real_target_path(
            &game,
            &game.canonicalize().unwrap().join("mods/../mods/a.jar")
        ));
        fs::create_dir_all(game.join("saves/World/.vesta")).unwrap();
        fs::write(game.join("saves/World/.vesta/world.json"), b"{}").unwrap();
        assert!(real_target_path(
            &game,
            &game.join("saves/World").canonicalize().unwrap()
        ));
        assert!(real_target_path(
            &game.join("saves/World"),
            &game
                .join("saves/World/.vesta/world.json")
                .canonicalize()
                .unwrap()
        ));
        fs::create_dir_all(game.join("resourcepacks")).unwrap();
        fs::write(game.join("resourcepacks/pack.zip"), b"pack").unwrap();
        assert!(real_target_path(
            &game,
            &game.join("resourcepacks/pack.zip").canonicalize().unwrap()
        ));
    }

    #[test]
    fn direct_child_files_reject_missing_outside_nested_and_directory_targets() {
        let temp = tempfile::tempdir().unwrap();
        let game = temp.path().join("game");
        let mods = game.join("mods");
        fs::create_dir_all(mods.join("nested")).unwrap();
        fs::write(mods.join("nested/a.jar"), b"mod").unwrap();
        fs::write(temp.path().join("outside.jar"), b"mod").unwrap();
        fs::write(mods.join("file.jar"), b"mod").unwrap();
        for path in [
            mods.join("missing.jar"),
            mods.join("nested/a.jar"),
            mods.join("nested"),
            mods.clone(),
            temp.path().join("outside.jar"),
            mods.join("../mods/file.jar"),
        ] {
            assert!(
                !real_direct_child_file(&game, &mods, &path),
                "{}",
                path.display()
            );
        }
        assert!(!real_target_path(&game, &mods.join("file.jar/child")));
        assert!(!real_target_path(&game, &mods.join("absent/child")));
        assert!(!real_target_path(
            &temp.path().join("missing"),
            &mods.join("file.jar")
        ));
        assert!(!real_target_path(
            &mods.join("file.jar"),
            &mods.join("file.jar")
        ));
    }

    #[cfg(unix)]
    #[test]
    fn checked_targets_reject_root_folder_and_leaf_links_even_for_canonical_candidates() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let game = temp.path().join("game");
        let mods = game.join("mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("a.jar"), b"mod").unwrap();
        symlink(&game, temp.path().join("linked-game")).unwrap();
        assert!(!real_target_path(
            &temp.path().join("linked-game"),
            &mods.join("a.jar").canonicalize().unwrap()
        ));
        assert!(!real_direct_child_file(
            &temp.path().join("linked-game"),
            &temp.path().join("linked-game/mods"),
            &mods.join("a.jar").canonicalize().unwrap()
        ));
        symlink(mods.join("a.jar"), mods.join("leaf.jar")).unwrap();
        assert!(!real_direct_child_file(
            &game,
            &mods,
            &mods.join("leaf.jar")
        ));
        symlink(&mods, game.join("folder")).unwrap();
        assert!(!real_target_path(&game, &game.join("folder/a.jar")));
        assert!(!real_direct_child_file(
            &game,
            &game.join("folder"),
            &mods.join("a.jar").canonicalize().unwrap()
        ));
        symlink(&game, temp.path().join("parent-link")).unwrap();
        assert!(!real_direct_child_file(
            temp.path(),
            &temp.path().join("parent-link/mods"),
            &mods.join("a.jar").canonicalize().unwrap()
        ));
    }

    #[cfg(windows)]
    #[test]
    fn ordinary_windows_root_accepts_verbatim_published_path() {
        let temp = tempfile::tempdir().unwrap();
        let game = ordinary_windows_test_path(temp.path());
        let mods = game.join("mods");
        fs::create_dir(&mods).unwrap();
        fs::write(mods.join("a.jar"), b"mod").unwrap();
        let published = mods.join("a.jar").canonicalize().unwrap();
        assert!(
            matches!(game.components().next(), Some(std::path::Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_)))
        );
        assert!(
            matches!(published.components().next(), Some(std::path::Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::VerbatimDisk(_)))
        );
        assert_ne!(published.parent(), Some(mods.as_path()));
        assert!(real_target_path(&game, &published));
        assert!(real_direct_child_file(&game, &mods, &published));
    }

    #[cfg(windows)]
    #[test]
    fn junction_roots_and_folders_reject_canonical_candidates() {
        let temp = tempfile::tempdir().unwrap();
        let game = ordinary_windows_test_path(temp.path()).join("game");
        let mods = game.join("mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("a.jar"), b"mod").unwrap();
        let published = mods.join("a.jar").canonicalize().unwrap();
        for (link, target) in [
            (game.join("linked-mods"), mods.clone()),
            (game.with_file_name("linked-game"), game.clone()),
        ] {
            let result = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "junction creation failed: {}",
                String::from_utf8_lossy(&result.stderr)
            );
            assert!(!real_target_path(&link, &published));
            if target == mods {
                assert!(!real_direct_child_file(&game, &link, &published));
                assert!(!real_target_path(&game, &link.join("a.jar")));
            } else {
                assert!(!real_direct_child_file(
                    &link,
                    &link.join("mods"),
                    &published
                ));
            }
            fs::remove_dir(&link).unwrap();
        }
    }

    fn archive(path: &Path, entries: &[(&str, &[u8])]) {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn wrapped_pack_retains_original_snapshot_hash_separately_from_installed_zip() {
        use crate::resources::drop_archive::{inspect_paths, DropKind};
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("wrapped.zip");
        archive(
            &source,
            &[
                (
                    "pack/pack/pack.mcmeta",
                    br#"{"pack":{"pack_format":48,"description":"fixture"}}"#,
                ),
                ("pack/pack/assets/test/model.json", b"{}"),
            ],
        );
        let inspected = inspect_paths(vec![source.clone()]).unwrap();
        let candidate = &inspected.candidates[0];
        let original = inspected.source_evidence_path(&candidate.id).unwrap();
        assert_eq!(
            calculate_sha1(original).unwrap(),
            calculate_sha1(&source).unwrap()
        );
        let output = temp.path().join("normalized");
        let files = inspected
            .materialize(&candidate.id, DropKind::ResourcePack, &output)
            .unwrap();
        let installed_sha1 = calculate_sha1(&files[0]).unwrap();
        let original_sha1 = calculate_sha1(original).unwrap();
        assert_ne!(installed_sha1, original_sha1);
        let evidence = ManualSourceEvidence {
            original_sha1,
            installed_sha1,
            resource_type: "resourcepack".into(),
            scope: ManualSourceScope::Instance,
            source: None,
        };
        let reloaded: ManualSourceEvidence =
            serde_json::from_slice(&serde_json::to_vec(&evidence).unwrap()).unwrap();
        assert_eq!(reloaded, evidence);
    }

    #[test]
    fn mixed_outer_identity_is_never_offered_for_independent_children() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("mixed.zip");
        archive(
            &source,
            &[
                (
                    "one/pack.mcmeta",
                    br#"{"pack":{"pack_format":48,"description":"one"}}"#,
                ),
                ("one/assets/test/model.json", b"{}"),
                (
                    "two/pack.mcmeta",
                    br#"{"pack":{"pack_format":48,"description":"two"}}"#,
                ),
                ("two/assets/test/model.json", b"{}"),
            ],
        );
        let inspected = crate::resources::drop_archive::inspect_paths(vec![source]).unwrap();
        assert_eq!(inspected.candidates.len(), 2);
        assert!(inspected
            .candidates
            .iter()
            .all(|candidate| inspected.source_evidence_path(&candidate.id).is_none()));
    }

    fn artifact(
        platform: SourcePlatform,
        kind: ResourceType,
        hash: &str,
    ) -> (ResourceProject, ResourceVersion) {
        let mut project: ResourceProject = serde_json::from_value(serde_json::json!({
            "id":"project", "source":"modrinth", "resource_type":"resourcepack", "name":"Pack",
            "summary":"", "author":"", "authors":[], "download_count":0, "follower_count":0,
            "categories":[], "web_url":"https://example.invalid/project", "gallery":[]
        }))
        .unwrap();
        project.source = platform;
        project.resource_type = kind;
        let version = serde_json::from_value(serde_json::json!({
            "id":"version", "project_id":"project", "version_number":"1", "game_versions":[],
            "loaders":[], "download_url":"https://example.invalid/pack.zip", "file_name":"pack.zip",
            "release_type":"release", "hash":hash, "dependencies":[]
        }))
        .unwrap();
        (project, version)
    }

    #[test]
    fn recognizes_exact_primary_and_alternate_artifacts() {
        let found = artifact(
            SourcePlatform::Modrinth,
            ResourceType::ResourcePack,
            "primary",
        );
        let mut mr = reconciliation::ArtifactMatches::from([("primary".into(), found.clone())]);
        assert!(resolve(
            "primary",
            None,
            ResourceType::ResourcePack,
            &mr,
            &Default::default()
        )
        .is_some());
        let mut alternate = found;
        alternate.1.files.push(ResourceVersionFile {
            url: "https://example.invalid/other.zip".into(),
            file_name: "other.zip".into(),
            hash: "alternate".into(),
            file_size: None,
            role: "alternate".into(),
        });
        mr.insert("alternate".into(), alternate);
        assert!(resolve(
            "alternate",
            None,
            ResourceType::ResourcePack,
            &mr,
            &Default::default()
        )
        .is_some());
        assert!(resolve(
            "different",
            None,
            ResourceType::ResourcePack,
            &mr,
            &Default::default()
        )
        .is_none());
    }

    #[test]
    fn curseforge_fingerprint_mismatch_has_no_identity_or_shared_hash_peer() {
        let mr = reconciliation::ArtifactMatches::from([(
            "installed".into(),
            artifact(SourcePlatform::Modrinth, ResourceType::Shader, "installed"),
        )]);
        let cf = reconciliation::ArtifactMatches::from([(
            "fingerprint".into(),
            artifact(
                SourcePlatform::CurseForge,
                ResourceType::Shader,
                "different",
            ),
        )]);
        assert!(resolve(
            "installed",
            Some("fingerprint"),
            ResourceType::Shader,
            &Default::default(),
            &cf
        )
        .is_none());
        assert!(peer_evidence(
            "installed",
            Some("fingerprint"),
            ResourceType::Shader,
            &mr,
            &cf
        )
        .is_empty());
    }

    #[test]
    fn selected_datapack_type_requires_compatible_artifact_and_keeps_world_scope() {
        let mut found = artifact(SourcePlatform::Modrinth, ResourceType::Mod, "datapack");
        found.1.loaders = vec!["datapack".into()];
        let mr = reconciliation::ArtifactMatches::from([("datapack".into(), found)]);
        assert!(resolve(
            "datapack",
            None,
            ResourceType::DataPack,
            &mr,
            &Default::default()
        )
        .is_some());
        assert!(resolve(
            "datapack",
            None,
            ResourceType::World,
            &mr,
            &Default::default()
        )
        .is_none());
        let world_id = Uuid::new_v4();
        let item = PublishedSource {
            instance_id: 7,
            game_root: "/game".into(),
            path: "/game/saves/World/datapacks/pack.zip".into(),
            original_path: "/snapshot.zip".into(),
            original_sha1: "original".into(),
            installed_sha1: "installed".into(),
            resource_type: ResourceType::DataPack,
            target: Target::File {
                row_id: 1,
                world: Some((
                    WorldRef {
                        instance_id: 7,
                        directory_name: "World".into(),
                    },
                    world_id,
                )),
            },
        };
        let evidence = item.file_evidence();
        assert_eq!(evidence.resource_type, "datapack");
        assert_eq!(evidence.scope, ManualSourceScope::World { world_id });
        assert_eq!(
            item.conflict_keys(),
            vec![saves_conflict_key(7), world_conflict_key(7, "World")]
        );
    }

    #[test]
    fn companion_alternate_role_cannot_be_recognized_as_world_or_wrong_pack_type() {
        let mut found = artifact(SourcePlatform::Modrinth, ResourceType::World, "world");
        found.1.files.push(ResourceVersionFile {
            url: "https://example.invalid/companion.zip".into(),
            file_name: "companion.zip".into(),
            hash: "companion".into(),
            file_size: None,
            role: "resourcepack".into(),
        });
        assert!(compatible_artifact(
            &found.0,
            &found.1,
            "companion",
            ResourceType::ResourcePack
        ));
        assert!(!compatible_artifact(
            &found.0,
            &found.1,
            "companion",
            ResourceType::World
        ));
        assert!(!compatible_artifact(
            &found.0,
            &found.1,
            "companion",
            ResourceType::DataPack
        ));
    }

    #[test]
    fn world_binding_detects_mutation_transfer_and_identity_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("saves/World");
        fs::create_dir_all(root.join("region")).unwrap();
        fs::write(root.join("level.dat"), b"level").unwrap();
        fs::write(root.join("region/a.mca"), b"region").unwrap();
        let manifest = manifest::WorldManifest::new(None);
        manifest::write_manifest(&root, &manifest).unwrap();
        let hash = world_content_sha1(&root).unwrap();
        assert!(same_world(&root, manifest.world_id));
        let mut changed = manifest.clone();
        changed.updated_at = chrono::Utc::now();
        manifest::write_manifest(&root, &changed).unwrap();
        assert_eq!(world_content_sha1(&root).unwrap(), hash);
        fs::write(root.join("region/a.mca"), b"change").unwrap();
        assert_ne!(world_content_sha1(&root).unwrap(), hash);
        manifest::write_manifest(&root, &manifest.clone_with_new_identity()).unwrap();
        assert!(!same_world(&root, manifest.world_id));
        let moved = temp.path().join("Transferred");
        fs::rename(&root, &moved).unwrap();
        assert!(!same_world(&root, manifest.world_id));
        assert!(!real_target_path(temp.path(), &root));
    }

    #[tokio::test]
    async fn late_world_persistence_skips_transfer_and_mutation_during_lookup() {
        for transfer in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("saves/World");
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("level.dat"), b"level").unwrap();
            let manifest = manifest::WorldManifest::new(None);
            manifest::write_manifest(&root, &manifest).unwrap();
            let world = WorldRef {
                instance_id: 1,
                directory_name: "World".into(),
            };
            let item = PublishedSource {
                instance_id: 1,
                game_root: temp.path().to_path_buf(),
                path: root.clone(),
                original_path: temp.path().join("archive.zip"),
                original_sha1: "original".into(),
                installed_sha1: world_content_sha1(&root).unwrap(),
                resource_type: ResourceType::World,
                target: Target::World {
                    world,
                    world_id: manifest.world_id,
                },
            };
            let coordinator = crate::tasks::manager::TaskConflictCoordinator::default();
            let late_coordinator = coordinator.clone();
            let keys = item.conflict_keys();
            let late_keys = keys.clone();
            let (lookup_finished, lookup_pending) = tokio::sync::oneshot::channel::<()>();
            let late = tokio::spawn(async move {
                lookup_pending.await.unwrap();
                let _guard = late_coordinator.acquire(late_keys).await;
                let resolution =
                    artifact(SourcePlatform::Modrinth, ResourceType::World, "original");
                persist_world_source(&item, Some(&resolution)).unwrap()
            });
            // Mutation remains available while provider lookup is pending.
            let guard =
                tokio::time::timeout(std::time::Duration::from_secs(1), coordinator.acquire(keys))
                    .await
                    .unwrap();
            let target = if transfer {
                let moved = temp.path().join("Transferred");
                fs::rename(&root, &moved).unwrap();
                moved
            } else {
                fs::write(root.join("level.dat"), b"other").unwrap();
                root
            };
            drop(guard);
            lookup_finished.send(()).unwrap();
            assert!(!late.await.unwrap());
            let after = manifest::read_manifest(&target).manifest.unwrap();
            assert!(after.source.is_none() && after.archive_evidence.is_none());
            assert!(target.join("level.dat").is_file());
        }
    }

    #[cfg(unix)]
    #[test]
    fn late_world_persistence_rejects_symlinked_metadata() {
        for linked_directory in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("saves/World");
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("level.dat"), b"level").unwrap();
            let metadata = manifest::WorldManifest::new(None);
            manifest::write_manifest(&root, &metadata).unwrap();
            let item = PublishedSource {
                instance_id: 1,
                game_root: temp.path().to_path_buf(),
                path: root.clone(),
                original_path: temp.path().join("archive.zip"),
                original_sha1: "original".into(),
                installed_sha1: world_content_sha1(&root).unwrap(),
                resource_type: ResourceType::World,
                target: Target::World {
                    world: WorldRef {
                        instance_id: 1,
                        directory_name: "World".into(),
                    },
                    world_id: metadata.world_id,
                },
            };
            let outside = tempfile::tempdir().unwrap();
            let metadata_path = if linked_directory {
                let directory = outside.path().join("metadata");
                fs::rename(root.join(".vesta"), &directory).unwrap();
                std::os::unix::fs::symlink(&directory, root.join(".vesta")).unwrap();
                directory.join("world.json")
            } else {
                let path = outside.path().join("world.json");
                fs::rename(manifest::manifest_path(&root), &path).unwrap();
                std::os::unix::fs::symlink(&path, manifest::manifest_path(&root)).unwrap();
                path
            };
            let before = fs::read(&metadata_path).unwrap();
            // The payload and identity still match; only metadata containment changed.
            assert_eq!(world_content_sha1(&root).unwrap(), item.installed_sha1);
            assert!(!same_world(&root, metadata.world_id));
            let resolution = artifact(SourcePlatform::Modrinth, ResourceType::World, "original");
            assert!(!persist_world_source(&item, Some(&resolution)).unwrap());
            assert_eq!(fs::read(&metadata_path).unwrap(), before);
            assert_eq!(fs::read(manifest::manifest_path(&root)).unwrap(), before);
        }
    }

    #[cfg(unix)]
    #[test]
    fn revalidation_rejects_symlinked_world_payloads_and_file_ancestors() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("saves/World");
        fs::create_dir_all(&root).unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("payload"), b"data").unwrap();
        std::os::unix::fs::symlink(outside.path().join("payload"), root.join("level.dat")).unwrap();
        assert!(world_content_sha1(&root).is_err());
        assert!(!real_target_path(temp.path(), &root.join("level.dat")));
    }
}
