use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

/// Represents the SHA-256 hash of a single tracked file on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHash {
    pub path: String,
    pub sha256: String,
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

    let manifest = piston_lib::game::modpack::manifest::ModpackManifest::from_install(
        &metadata,
        &[],           // overrides will be re-extracted during update
        &[],           // no skipped configs for the target manifest
        None,          // no source zip path needed for $N$
        modpack_id,
    );

    Ok(manifest)
}

/// Compute SHA-256 hashes for every file declared in a manifest.
/// Scans the physical disk ($C$) to determine the current state of tracked files.
/// Returns a map of relative_path → FileHash for all manifest entries found on disk.
/// Files not found on disk are simply omitted from the map.
pub fn hash_current_directory(
    game_dir: &Path,
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
) -> HashMap<String, FileHash> {
    let mut hashes = HashMap::new();

    for m in &manifest.mods {
        let full_path = game_dir.join(&m.path);
        if full_path.exists() {
            if let Ok(sha256) = compute_sha256_file(&full_path) {
                hashes.insert(
                    m.path.to_lowercase(),
                    FileHash {
                        path: m.path.clone(),
                        sha256,
                    },
                );
            }
        }
    }

    for ov in &manifest.overrides.extracted {
        let full_path = game_dir.join(ov);
        if full_path.exists() {
            if let Ok(sha256) = compute_sha256_file(&full_path) {
                hashes.insert(
                    ov.to_lowercase(),
                    FileHash {
                        path: ov.clone(),
                        sha256,
                    },
                );
            }
        }
    }

    hashes
}

/// Compute SHA-256 hash of a single file.
pub fn compute_sha256_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    use std::io::Read;
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_sha256_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        std::fs::write(&file_path, b"hello world").unwrap();
        let hash = compute_sha256_file(&file_path).unwrap();
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }
}
