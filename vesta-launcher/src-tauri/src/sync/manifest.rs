use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

use piston_lib::game::modpack::manifest::{ModSource, ModpackManifest};

use super::hash_util::hash_file_on_disk;

/// Content hash (sha1) of a tracked file on disk ($C$).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHash {
    pub path: String,
    pub hash: String,
}

/// Load the old base manifest ($O$) from an instance's game directory.
/// This is the snapshot recorded during the last successful update.
pub fn load_old_manifest(
    game_dir: &Path,
) -> Result<piston_lib::game::modpack::manifest::ModpackManifest> {
    piston_lib::game::modpack::manifest::ModpackManifest::load(game_dir).context(
        "Failed to load modpack_manifest.json — has this instance been installed from a modpack?",
    )
}

/// Build a new base manifest ($N$) from a modpack ZIP file.
/// Parses the platform index (modrinth.index.json / manifest.json) and
/// constructs a ModpackManifest that represents what the new version wants.
pub fn build_new_manifest(
    zip_path: &Path,
    modpack_id: Option<String>,
) -> Result<piston_lib::game::modpack::manifest::ModpackManifest> {
    let metadata = piston_lib::game::modpack::parser::get_modpack_metadata(zip_path)
        .context("Failed to parse modpack metadata from ZIP")?;

    let override_paths =
        piston_lib::game::modpack::parser::list_override_paths(zip_path).unwrap_or_default();
    let override_pathbufs: Vec<std::path::PathBuf> =
        override_paths.iter().map(std::path::PathBuf::from).collect();

    let mut manifest = piston_lib::game::modpack::manifest::ModpackManifest::from_install(
        &metadata,
        &override_pathbufs,
        &[],
        Some(zip_path.to_path_buf()),
        modpack_id,
    );

    if let Ok(hashes) = piston_lib::game::modpack::parser::hash_override_paths_from_zip(
        zip_path,
        metadata.format,
        &override_paths,
    ) {
        manifest.overrides.hashes = hashes;
    }

    Ok(manifest)
}

/// Hash tracked files on disk ($C$) using sha1.
pub fn hash_current_directory(
    game_dir: &Path,
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
) -> HashMap<String, FileHash> {
    let mut hashes = HashMap::new();

    for m in &manifest.mods {
        let Some(full_path) =
            piston_lib::game::modpack::manifest::resolve_mod_path_on_disk(game_dir, &m.path)
        else {
            continue;
        };
        match hash_file_on_disk(&full_path) {
            Ok(hash) => {
                hashes.insert(
                    m.path.to_lowercase(),
                    FileHash {
                        path: m.path.clone(),
                        hash,
                    },
                );
            }
            Err(e) => {
                log::warn!(
                    "[sync/manifest] Failed to hash current mod {}: {}",
                    m.path,
                    e
                );
            }
        }
    }

    for ov in &manifest.overrides.extracted {
        let Ok(full_path) =
            piston_lib::utils::paths::join_validated(game_dir, ov)
        else {
            continue;
        };
        match hash_file_on_disk(&full_path) {
            Ok(hash) => {
                hashes.insert(
                    ov.to_lowercase(),
                    FileHash {
                        path: ov.clone(),
                        hash,
                    },
                );
            }
            Err(e) => {
                log::warn!(
                    "[sync/manifest] Failed to hash current override {}: {}",
                    ov,
                    e
                );
            }
        }
    }

    hashes
}

/// Fill missing mod/override sha1 from disk and the ResourceWatcher `installed_resource` cache.
/// Platform API enrichment is handled by [`crate::tasks::installers::modpack::enrich_manifest_platform_hashes`].
pub fn backfill_manifest_hashes(
    manifest: &mut ModpackManifest,
    game_dir: &Path,
    instance_id: i32,
) -> Result<()> {
    manifest.backfill_mod_sha1(game_dir);
    manifest.backfill_override_hashes(game_dir);
    backfill_mod_sha1_from_installed_resources(manifest, game_dir, instance_id)?;
    Ok(())
}

fn backfill_mod_sha1_from_installed_resources(
    manifest: &mut ModpackManifest,
    game_dir: &Path,
    instance_id: i32,
) -> Result<()> {
    use crate::models::installed_resource::InstalledResource;
    use crate::schema::installed_resource::dsl as ir_dsl;
    use crate::utils::db::get_vesta_conn;
    use crate::utils::instance_helpers::normalize_path;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn()?;

    for m in &mut manifest.mods {
        if m.sha1.as_ref().is_some_and(|h| !h.is_empty()) {
            continue;
        }

        let path_candidates = [
            normalize_path(&game_dir.join(&m.path)),
            normalize_path(
                &game_dir.join(piston_lib::game::modpack::manifest::disabled_mod_path(&m.path)),
            ),
        ];
        let mut found_hash = None;
        for local_path in &path_candidates {
            if let Ok(Some(res)) = ir_dsl::installed_resource
                .filter(ir_dsl::instance_id.eq(instance_id))
                .filter(ir_dsl::local_path.eq(local_path))
                .first::<InstalledResource>(&mut conn)
                .optional()
            {
                if let Some(hash) = res.hash.filter(|h| !h.is_empty()) {
                    found_hash = Some(hash);
                    break;
                }
            }
        }
        if let Some(hash) = found_hash {
            m.sha1 = Some(hash);
            continue;
        }

        match &m.source {
            ModSource::CurseForge { file_id, .. } => {
                if let Ok(Some(res)) = ir_dsl::installed_resource
                    .filter(ir_dsl::instance_id.eq(instance_id))
                    .filter(ir_dsl::platform.eq("curseforge"))
                    .filter(ir_dsl::remote_version_id.eq(file_id.to_string()))
                    .first::<InstalledResource>(&mut conn)
                    .optional()
                {
                    if let Some(hash) = res.hash.filter(|h| !h.is_empty()) {
                        m.sha1 = Some(hash);
                    }
                }
            }
            ModSource::Modrinth { version_id, .. } => {
                if let Ok(Some(res)) = ir_dsl::installed_resource
                    .filter(ir_dsl::instance_id.eq(instance_id))
                    .filter(ir_dsl::platform.eq("modrinth"))
                    .filter(ir_dsl::remote_version_id.eq(version_id))
                    .first::<InstalledResource>(&mut conn)
                    .optional()
                {
                    if let Some(hash) = res.hash.filter(|h| !h.is_empty()) {
                        m.sha1 = Some(hash);
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use piston_lib::game::modpack::manifest::compute_file_sha1;

    #[test]
    fn test_hash_file_uses_sha1() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.jar");
        std::fs::write(&file_path, b"hello world").unwrap();
        let hash = hash_file_on_disk(&file_path).unwrap();
        assert_eq!(hash, compute_file_sha1(&file_path).unwrap());
        assert_eq!(hash.len(), 40);
    }
}
