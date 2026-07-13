use std::collections::HashSet;
use std::path::Path;

use anyhow::{anyhow, Result};
use piston_lib::game::modpack::manifest::{
    disabled_mod_path, resolve_mod_path_on_disk, ModSource, ModpackManifest,
};

use crate::models::installed_resource::InstalledResource;
use crate::models::instance::Instance;

pub fn load_present(game_dir: &Path) -> Result<Option<ModpackManifest>> {
    match ModpackManifest::load(game_dir) {
        Ok(manifest) => Ok(Some(manifest)),
        Err(_) => Ok(None),
    }
}

pub async fn load_or_bootstrap(
    app_handle: &tauri::AppHandle,
    instance: &Instance,
    game_dir: &Path,
) -> Result<ModpackManifest> {
    if let Some(manifest) = load_present(game_dir)? {
        return Ok(manifest);
    }

    crate::sync::manifest_bootstrap::ensure_old_manifest(app_handle, instance, game_dir, None)
        .await
        .map_err(|error| anyhow!(error))
}

pub fn backfill_and_persist(manifest: &mut ModpackManifest, game_dir: &Path, instance_id: i32) {
    if let Err(error) =
        crate::sync::manifest::backfill_manifest_hashes(manifest, game_dir, instance_id)
    {
        log::warn!(
            "[modpack-state] Failed to backfill manifest hashes for instance {}: {}",
            instance_id,
            error
        );
        return;
    }

    if let Err(error) = manifest.persist(game_dir) {
        log::warn!(
            "[modpack-state] Failed to persist manifest after backfill for instance {}: {}",
            instance_id,
            error
        );
    }
}

pub fn apply_resource_provenance(
    instance: &Instance,
    resources: &[InstalledResource],
    matched_ids: &HashSet<i32>,
) -> Result<usize> {
    crate::resources::ledger::apply_modpack_provenance(instance, resources, matched_ids)
}

pub fn match_owned_resources(
    resources: &[InstalledResource],
    manifest: &ModpackManifest,
    game_dir: &Path,
) -> HashSet<i32> {
    use crate::utils::instance_helpers::normalize_path;

    let mut matched_ids = HashSet::new();

    for manifest_mod in &manifest.mods {
        let mut path_candidates = HashSet::new();
        path_candidates.insert(normalize_path(&game_dir.join(&manifest_mod.path)));
        path_candidates.insert(normalize_path(
            &game_dir.join(disabled_mod_path(&manifest_mod.path)),
        ));
        if let Some(path) = resolve_mod_path_on_disk(game_dir, &manifest_mod.path) {
            path_candidates.insert(normalize_path(&path));
        }

        let manifest_sha1 = manifest_mod
            .sha1
            .as_deref()
            .filter(|hash| !hash.is_empty())
            .map(str::to_lowercase);

        for resource in resources {
            let path_matches =
                path_candidates.contains(&normalize_path(Path::new(&resource.local_path)));
            let hash_matches = manifest_sha1.as_ref().is_some_and(|sha1| {
                resource
                    .hash
                    .as_deref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(sha1))
            });

            if path_matches
                || hash_matches
                || manifest_source_matches_resource(&manifest_mod.source, resource)
            {
                matched_ids.insert(resource.id);
            }
        }
    }

    for override_path in &manifest.overrides.extracted {
        let mut path_candidates = HashSet::new();
        path_candidates.insert(normalize_path(&game_dir.join(override_path)));
        path_candidates.insert(normalize_path(
            &game_dir.join(disabled_mod_path(override_path)),
        ));
        let override_sha1 = manifest
            .overrides
            .hashes
            .get(&override_path.to_lowercase())
            .filter(|hash| !hash.is_empty())
            .map(|hash| hash.to_lowercase());

        for resource in resources {
            let path_matches =
                path_candidates.contains(&normalize_path(Path::new(&resource.local_path)));
            let hash_matches = override_sha1.as_ref().is_some_and(|sha1| {
                resource
                    .hash
                    .as_deref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(sha1))
            });
            if path_matches || hash_matches {
                matched_ids.insert(resource.id);
            }
        }
    }

    matched_ids
}

fn manifest_source_matches_resource(source: &ModSource, resource: &InstalledResource) -> bool {
    match source {
        ModSource::Modrinth {
            project_id,
            version_id,
            ..
        } => {
            resource.platform == "modrinth"
                && resource.remote_version_id == *version_id
                && (project_id.is_empty() || resource.remote_id == *project_id)
        }
        ModSource::CurseForge {
            project_id,
            file_id,
            ..
        } => {
            resource.platform == "curseforge"
                && resource.remote_version_id == file_id.to_string()
                && project_id
                    .map(|id| resource.remote_id == id.to_string())
                    .unwrap_or(true)
        }
    }
}
