//! Bounded, revision-checked options.txt persistence. Callers serialize with
//! instance launch/update and reject running or busy instances before saving.
use crate::game_options::{catalog, options_file::OptionsDocument};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_CHANGES: usize = 4096;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: String,
    pub exists: bool,
    pub values: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub revision: String,
    pub changes: BTreeMap<String, String>,
}

pub(crate) fn checked_path(directory: &Path) -> Result<PathBuf, String> {
    crate::instance_file::checked_path(directory, "options.txt")
}

pub(crate) fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    crate::instance_file::read(path, MAX_BYTES, "Options file")
}

fn revision(bytes: Option<&[u8]>) -> String {
    bytes
        .map(|b| hex::encode(Sha256::digest(b)))
        .unwrap_or_else(|| "missing".into())
}

fn snapshot(bytes: Option<&[u8]>) -> Result<Snapshot, String> {
    let document = OptionsDocument::parse(bytes.unwrap_or_default()).map_err(err)?;
    Ok(Snapshot {
        revision: revision(bytes),
        exists: bytes.is_some(),
        values: document
            .values()
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect(),
    })
}

pub fn load(directory: &Path) -> Result<Snapshot, String> {
    snapshot(read_bytes(&checked_path(directory)?)?.as_deref())
}

pub fn save(directory: &Path, patch: Patch) -> Result<Snapshot, String> {
    if patch.changes.len() > MAX_CHANGES
        || patch
            .changes
            .iter()
            .map(|(k, v)| k.len().saturating_add(v.len()))
            .sum::<usize>()
            > MAX_BYTES as usize
    {
        return Err("Options patch exceeds the size limit".into());
    }
    for (key, value) in &patch.changes {
        if catalog::is_syncable_keybind(key) {
            catalog::validate_keybind(key, value).map_err(err)?;
        } else {
            catalog::validate(key, value).map_err(err)?;
        }
    }
    let path = checked_path(directory)?;
    let before = read_bytes(&path)?;
    if revision(before.as_deref()) != patch.revision {
        return Err("Options changed on disk. Reload before saving.".into());
    }
    let document = OptionsDocument::parse(before.as_deref().unwrap_or_default()).map_err(err)?;
    let updated = document.patched(&patch.changes).map_err(err)?;
    if updated.as_bytes().len() as u64 > MAX_BYTES {
        return Err("Updated options exceed the 1 MiB limit".into());
    }
    if updated.as_bytes() == document.as_bytes() {
        return snapshot(before.as_deref());
    }

    // Stage beside the destination so publication cannot cross filesystems.
    crate::instance_file::replace(
        directory,
        &path,
        before.as_deref(),
        updated.as_bytes(),
        MAX_BYTES,
        "Options file",
    )?;
    snapshot(Some(updated.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn patch(revision: String, key: &str, value: &str) -> Patch {
        Patch {
            revision,
            changes: BTreeMap::from([(key.into(), value.into())]),
        }
    }
    #[test]
    fn missing_file_and_stale_revision_are_distinct_from_empty_file() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        let missing = load(&dir).unwrap();
        assert!(!missing.exists);
        fs::write(dir.join("options.txt"), "").unwrap();
        assert!(save(&dir, patch(missing.revision, "fov", "0.5")).is_err());
        let loaded = load(&dir).unwrap();
        let saved = save(&dir, patch(loaded.revision, "fov", "0.5")).unwrap();
        assert_eq!(saved.values["fov"], "0.5");
    }
    #[test]
    fn validates_before_writing_and_preserves_unrelated_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        let path = dir.join("options.txt");
        fs::write(&path, "#keep\r\nfov:0\r\ncustom:a:b").unwrap();
        let old = load(&dir).unwrap();
        for (key, value) in [("version", "1"), ("fov", "NaN"), ("custom", "x\ny:z")] {
            assert!(save(&dir, patch(old.revision.clone(), key, value)).is_err());
        }
        save(&dir, patch(old.revision, "fov", "0.5")).unwrap();
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            "#keep\r\nfov:0.5\r\ncustom:a:b"
        );
    }
    #[test]
    fn rejects_oversized_files_and_patches() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        assert!(save(
            &dir,
            patch(
                "missing".into(),
                "custom",
                &"x".repeat(MAX_BYTES as usize + 1)
            )
        )
        .is_err());
        assert!(!dir.join("options.txt").exists());
        fs::write(dir.join("options.txt"), vec![b'x'; MAX_BYTES as usize + 1]).unwrap();
        assert!(load(&dir).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_linked_file_and_directory() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().canonicalize().unwrap();
        let outside = dir.join("outside");
        fs::write(&outside, "fov:0").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("options.txt")).unwrap();
        assert!(load(&dir).is_err());
        assert!(save(&dir, patch("missing".into(), "fov", "0.5")).is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "fov:0");
        std::os::unix::fs::symlink(&dir, dir.join("linked")).unwrap();
        assert!(load(&dir.join("linked")).is_err());
    }
}
