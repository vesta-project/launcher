use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

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
        let full_path = game_dir.join(&m.path);
        if full_path.exists() {
            if let Ok(hash) = hash_file_on_disk(&full_path) {
                hashes.insert(
                    m.path.to_lowercase(),
                    FileHash {
                        path: m.path.clone(),
                        hash,
                    },
                );
            }
        }
    }

    for ov in &manifest.overrides.extracted {
        let full_path = game_dir.join(ov);
        if full_path.exists() {
            if let Ok(hash) = hash_file_on_disk(&full_path) {
                hashes.insert(
                    ov.to_lowercase(),
                    FileHash {
                        path: ov.clone(),
                        hash,
                    },
                );
            }
        }
    }

    hashes
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
