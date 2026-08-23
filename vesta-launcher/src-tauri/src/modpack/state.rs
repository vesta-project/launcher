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
        let active_path = normalize_path(&game_dir.join(&manifest_mod.path));
        let disabled_path = normalize_path(&game_dir.join(disabled_mod_path(&manifest_mod.path)));
        let resolved_path = resolve_mod_path_on_disk(game_dir, &manifest_mod.path)
            .map(|path| normalize_path(&path));

        let manifest_sha1 = manifest_mod
            .sha1
            .as_deref()
            .filter(|hash| !hash.is_empty())
            .map(str::to_lowercase);

        let best = resources
            .iter()
            .filter(|resource| !matched_ids.contains(&resource.id))
            .filter_map(|resource| {
                let local_path = normalize_path(Path::new(&resource.local_path));
                let path_rank = if resolved_path.as_deref() == Some(local_path.as_str()) {
                    Some(0)
                } else if local_path == active_path {
                    Some(1)
                } else if local_path == disabled_path {
                    Some(2)
                } else {
                    None
                };
                let hash_matches = manifest_sha1.as_ref().is_some_and(|sha1| {
                    resource
                        .hash
                        .as_deref()
                        .is_some_and(|hash| hash.eq_ignore_ascii_case(sha1))
                });

                let match_rank = path_rank.or_else(|| {
                    if hash_matches {
                        Some(3)
                    } else if manifest_source_matches_resource(&manifest_mod.source, resource) {
                        Some(4)
                    } else {
                        None
                    }
                })?;
                Some((
                    match_rank,
                    usize::from(resource.source_kind != "modpack"),
                    resource.id,
                ))
            })
            .min();
        if let Some((_, _, resource_id)) = best {
            matched_ids.insert(resource_id);
        }
    }

    for override_path in &manifest.overrides.extracted {
        let active_path = normalize_path(&game_dir.join(override_path));
        let disabled_path = normalize_path(&game_dir.join(disabled_mod_path(override_path)));
        let override_sha1 = manifest
            .overrides
            .hashes
            .get(&override_path.to_lowercase())
            .filter(|hash| !hash.is_empty())
            .map(|hash| hash.to_lowercase());

        let best = resources
            .iter()
            .filter(|resource| !matched_ids.contains(&resource.id))
            .filter_map(|resource| {
                let local_path = normalize_path(Path::new(&resource.local_path));
                let path_rank = if local_path == active_path {
                    Some(0)
                } else if local_path == disabled_path {
                    Some(1)
                } else {
                    None
                };
                let hash_matches = override_sha1.as_ref().is_some_and(|sha1| {
                    resource
                        .hash
                        .as_deref()
                        .is_some_and(|hash| hash.eq_ignore_ascii_case(sha1))
                });
                let match_rank = path_rank.or(hash_matches.then_some(2))?;
                Some((
                    match_rank,
                    usize::from(resource.source_kind != "modpack"),
                    resource.id,
                ))
            })
            .min();
        if let Some((_, _, resource_id)) = best {
            matched_ids.insert(resource_id);
        }
    }

    matched_ids
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LocalLedgerReconciliation {
    pub pruned_missing: usize,
    pub removed_obsolete_pack_rows: usize,
    pub refreshed_provenance: usize,
}

/// Reconciles durable local facts for a completed update before the new
/// Instance version is observable. Provider metadata is intentionally left to
/// the background enrichment task.
pub fn reconcile_updated_ledger(
    instance: &Instance,
    manifest: &ModpackManifest,
    game_dir: &Path,
) -> Result<LocalLedgerReconciliation> {
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let pruned_missing = crate::resources::ledger::remove_missing_in_folder(instance.id, game_dir)?;
    let resources = {
        let mut conn = get_vesta_conn()?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance.id))
            .load::<InstalledResource>(&mut conn)?
    };
    let matched_ids = match_owned_resources(&resources, manifest, game_dir);
    let obsolete_pack_ids = resources
        .iter()
        .filter(|resource| resource.source_kind == "modpack" && !matched_ids.contains(&resource.id))
        .map(|resource| resource.id)
        .collect::<Vec<_>>();
    let mut removed_obsolete_pack_rows = 0;
    for resource_id in obsolete_pack_ids {
        crate::resources::ledger::remove_resource(instance.id, resource_id)?;
        removed_obsolete_pack_rows += 1;
    }

    let current_resources = {
        let mut conn = get_vesta_conn()?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance.id))
            .load::<InstalledResource>(&mut conn)?
    };
    let current_matches = match_owned_resources(&current_resources, manifest, game_dir);
    let refreshed_provenance =
        apply_resource_provenance(instance, &current_resources, &current_matches)?;

    Ok(LocalLedgerReconciliation {
        pruned_missing,
        removed_obsolete_pack_rows,
        refreshed_provenance,
    })
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

#[cfg(test)]
mod tests {
    use super::match_owned_resources;
    use crate::models::installed_resource::InstalledResource;
    use piston_lib::game::modpack::manifest::{
        ModSource, ModpackManifest, ModpackManifestMod, ModpackManifestModloader,
        ModpackManifestOverrides,
    };
    use piston_lib::game::modpack::types::ModpackFormat;

    fn manifest(path: &str, version_id: &str) -> ModpackManifest {
        ModpackManifest {
            source: ModpackFormat::Modrinth,
            modpack_id: Some("pack".to_string()),
            name: "Pack".to_string(),
            version: "2".to_string(),
            installed_at: String::new(),
            minecraft_version: "1.21.1".to_string(),
            modloader: ModpackManifestModloader {
                loader_type: "fabric".to_string(),
                version: None,
            },
            mods: vec![ModpackManifestMod {
                source: ModSource::Modrinth {
                    project_id: "project".to_string(),
                    version_id: version_id.to_string(),
                    url: String::new(),
                },
                path: path.to_string(),
                sha1: None,
                size: None,
            }],
            overrides: ModpackManifestOverrides {
                extracted: vec![],
                skipped_configs: vec![],
                hashes: Default::default(),
            },
            source_zip_path: None,
        }
    }

    fn resource(id: i32, path: String, version_id: &str, source_kind: &str) -> InstalledResource {
        InstalledResource {
            id,
            instance_id: 1,
            platform: "modrinth".to_string(),
            remote_id: "project".to_string(),
            remote_version_id: version_id.to_string(),
            resource_type: "mod".to_string(),
            local_path: path,
            display_name: format!("resource-{id}"),
            current_version: version_id.to_string(),
            is_manual: false,
            is_enabled: true,
            last_updated: String::new(),
            release_type: "release".to_string(),
            hash: None,
            file_size: 1,
            file_mtime: 1,
            source_kind: source_kind.to_string(),
            source_modpack_id: None,
            source_modpack_version_id: None,
            source_modpack_platform: None,
        }
    }

    #[test]
    fn renamed_manifest_resource_owns_only_the_new_path() {
        let game = tempfile::tempdir().unwrap();
        let new_path = game.path().join("mods/new.jar");
        let rows = vec![
            resource(
                1,
                game.path()
                    .join("mods/old.jar")
                    .to_string_lossy()
                    .into_owned(),
                "old",
                "modpack",
            ),
            resource(2, new_path.to_string_lossy().into_owned(), "new", "custom"),
        ];

        assert_eq!(
            match_owned_resources(&rows, &manifest("mods/new.jar", "new"), game.path()),
            std::collections::HashSet::from([2])
        );
    }

    #[test]
    fn unchanged_path_matches_even_when_provider_metadata_is_stale() {
        let game = tempfile::tempdir().unwrap();
        let row = resource(
            1,
            game.path()
                .join("mods/same.jar")
                .to_string_lossy()
                .into_owned(),
            "old",
            "modpack",
        );

        assert_eq!(
            match_owned_resources(&[row], &manifest("mods/same.jar", "new"), game.path()),
            std::collections::HashSet::from([1])
        );
    }

    #[test]
    fn one_manifest_entry_never_claims_multiple_provider_duplicates() {
        let game = tempfile::tempdir().unwrap();
        let rows = vec![
            resource(1, "/mods/bundled.jar".to_string(), "same", "modpack"),
            resource(2, "/mods/custom.jar".to_string(), "same", "custom"),
        ];

        assert_eq!(
            match_owned_resources(&rows, &manifest("mods/other.jar", "same"), game.path()),
            std::collections::HashSet::from([1])
        );
    }
}
