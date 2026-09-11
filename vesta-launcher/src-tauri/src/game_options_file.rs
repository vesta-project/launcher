//! Bounded, revision-checked options.txt persistence. Callers serialize with
//! instance launch/update and reject running or busy instances before saving.
use crate::game_options::{catalog, options_file::OptionsDocument};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_CHANGES: usize = 4096;

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

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn checked_path(directory: &Path) -> Result<PathBuf, String> {
    if !directory.is_absolute()
        || directory
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Game directory must be an absolute path without parent traversal".into());
    }
    for ancestor in directory.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).map_err(err)?;
        if is_link(&metadata) || !metadata.is_dir() {
            return Err(
                "Linked game directories are not supported by the game-options editor".into(),
            );
        }
    }
    Ok(directory.join("options.txt"))
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    if is_link(&metadata) || !metadata.is_file() {
        return Err("Options must be a regular file, not a link".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("Options file exceeds the 1 MiB limit".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path).map_err(err)?;
    let opened = file.metadata().map_err(err)?;
    if is_link(&opened) || !opened.is_file() {
        return Err("Options must be a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Options file exceeds the 1 MiB limit".into());
    }
    Ok(Some(bytes))
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
        catalog::validate(key, value).map_err(err)?;
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
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(err)?;
    if before.is_some() {
        temporary
            .as_file()
            .set_permissions(fs::metadata(&path).map_err(err)?.permissions())
            .map_err(err)?;
    }
    temporary.write_all(updated.as_bytes()).map_err(err)?;
    temporary.as_file().sync_all().map_err(err)?;
    checked_path(directory)?;
    if read_bytes(&path)? != before {
        return Err("Options changed on disk. Reload before saving.".into());
    }
    if before.is_some() {
        temporary.persist(&path).map_err(err)?;
    } else {
        temporary.persist_noclobber(&path).map_err(err)?;
    }
    #[cfg(unix)]
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(err)?;
    snapshot(Some(updated.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
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
