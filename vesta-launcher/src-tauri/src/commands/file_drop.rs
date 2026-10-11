//! Metadata-only classification of paths dropped onto the launcher window.
//!
//! The native Tauri drag-drop event only carries `paths: string[]`, so the
//! renderer asks this command whether each path is a file, a directory, or
//! something else. Only file metadata is read; file contents are never opened
//! and paths are never canonicalized.
//!
//! This is NOT a security boundary. Consumers must re-validate paths in Rust
//! before any import; the classification returned here is advisory only.

use serde::Serialize;
use std::io::ErrorKind;
use std::path::Path;

/// Upper bound on paths accepted in one call. Larger batches are rejected whole.
const MAX_DROPPED_PATHS: usize = 1000;

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DropPathKind {
    File,
    Directory,
    Other,
    Missing,
    Inaccessible,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassifiedDropPath {
    pub path: String,
    pub kind: DropPathKind,
    pub is_symlink: bool,
}

fn check_path_count(count: usize) -> Result<(), String> {
    if count > MAX_DROPPED_PATHS {
        return Err(format!(
            "Too many dropped paths: {count} (maximum is {MAX_DROPPED_PATHS})"
        ));
    }
    Ok(())
}

/// Classifies one path. Empty, NUL-containing and relative inputs are rejected
/// before any filesystem access.
fn classify_path(input: &str) -> ClassifiedDropPath {
    if input.is_empty() || input.contains('\0') || !Path::new(input).is_absolute() {
        return ClassifiedDropPath {
            path: input.to_string(),
            kind: DropPathKind::Other,
            is_symlink: false,
        };
    }

    let path = Path::new(input);
    let is_symlink = std::fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    let kind = match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => DropPathKind::File,
        Ok(meta) if meta.is_dir() => DropPathKind::Directory,
        Ok(_) => DropPathKind::Other,
        Err(err) if err.kind() == ErrorKind::NotFound => DropPathKind::Missing,
        Err(_) => DropPathKind::Inaccessible,
    };

    ClassifiedDropPath {
        path: input.to_string(),
        kind,
        is_symlink,
    }
}

/// Pure synchronous core of the command. Output order matches input order.
fn classify_paths(paths: &[String]) -> Vec<ClassifiedDropPath> {
    paths.iter().map(|path| classify_path(path)).collect()
}

/// Classifies dropped filesystem paths by metadata only.
///
/// Returns `Err` without touching the filesystem when more than 1000 paths are supplied.
#[tauri::command]
pub async fn classify_dropped_paths(paths: Vec<String>) -> Result<Vec<ClassifiedDropPath>, String> {
    let count = paths.len();
    if let Err(message) = check_path_count(count) {
        log::warn!("[classify_dropped_paths] rejected batch of {} paths", count);
        return Err(message);
    }

    let classified = tauri::async_runtime::spawn_blocking(move || classify_paths(&paths))
        .await
        .map_err(|e| e.to_string())?;
    log::debug!("[classify_dropped_paths] classified {} paths", count);
    Ok(classified)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify_one(input: &str) -> ClassifiedDropPath {
        classify_paths(&[input.to_string()]).remove(0)
    }

    fn expected(input: &str, kind: DropPathKind, is_symlink: bool) -> ClassifiedDropPath {
        ClassifiedDropPath {
            path: input.to_string(),
            kind,
            is_symlink,
        }
    }

    #[test]
    fn regular_file_is_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("mod.jar");
        std::fs::write(&file, b"data").unwrap();
        let input = file.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::File, false)
        );
    }

    #[test]
    fn directory_is_directory() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::Directory, false)
        );
    }

    #[test]
    fn missing_path_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("does-not-exist.zip");
        let input = file.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::Missing, false)
        );
    }

    #[test]
    fn path_with_spaces_is_classified() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("my mod pack.zip");
        let folder = dir.path().join("my instance folder");
        std::fs::write(&file, b"data").unwrap();
        std::fs::create_dir(&folder).unwrap();
        let file_input = file.to_str().unwrap();
        let folder_input = folder.to_str().unwrap();
        assert_eq!(
            classify_one(file_input),
            expected(file_input, DropPathKind::File, false)
        );
        assert_eq!(
            classify_one(folder_input),
            expected(folder_input, DropPathKind::Directory, false)
        );
    }

    #[test]
    fn unicode_filename_is_classified() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("wörld 世界.zip");
        std::fs::write(&file, b"data").unwrap();
        let input = file.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::File, false)
        );
    }

    #[test]
    fn empty_string_is_other() {
        assert_eq!(classify_one(""), expected("", DropPathKind::Other, false));
    }

    #[test]
    fn nul_byte_is_other_without_panicking() {
        let dir = tempfile::tempdir().unwrap();
        let input = format!("{}\0suffix", dir.path().to_str().unwrap());
        assert_eq!(
            classify_one(&input),
            expected(&input, DropPathKind::Other, false)
        );
    }

    #[test]
    fn relative_paths_are_other() {
        assert_eq!(
            classify_one("relative/mod.jar"),
            expected("relative/mod.jar", DropPathKind::Other, false)
        );
        // Relative but existing in the working directory is still rejected.
        assert_eq!(classify_one("."), expected(".", DropPathKind::Other, false));
    }

    #[test]
    fn batch_preserves_order_and_length() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.zip");
        std::fs::write(&file, b"data").unwrap();
        let file_input = file.to_str().unwrap().to_string();
        let missing_input = dir.path().join("b.zip").to_str().unwrap().to_string();
        let inputs = vec![missing_input.clone(), file_input.clone(), String::new()];
        let out = classify_paths(&inputs);
        assert_eq!(
            out,
            vec![
                expected(&missing_input, DropPathKind::Missing, false),
                expected(&file_input, DropPathKind::File, false),
                expected("", DropPathKind::Other, false),
            ]
        );
    }

    #[test]
    fn batch_over_limit_is_rejected() {
        assert!(check_path_count(MAX_DROPPED_PATHS).is_ok());
        assert!(check_path_count(MAX_DROPPED_PATHS + 1).is_err());
    }

    #[test]
    fn serialized_shape_matches_contract() {
        let value = serde_json::to_value(expected("/x", DropPathKind::Inaccessible, true)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "path": "/x", "kind": "inaccessible", "isSymlink": true })
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_file_is_file_and_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.zip");
        let link = dir.path().join("link.zip");
        std::fs::write(&target, b"data").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let input = link.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::File, true)
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_directory_is_directory_and_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("real");
        let link = dir.path().join("alias");
        std::fs::create_dir(&target).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let input = link.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::Directory, true)
        );
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlink_is_missing_and_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("dangling.zip");
        std::os::unix::fs::symlink(dir.path().join("gone.zip"), &link).unwrap();
        let input = link.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::Missing, true)
        );
    }

    #[cfg(unix)]
    #[test]
    fn fifo_is_other() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(status.success());
        let input = fifo.to_str().unwrap();
        assert_eq!(
            classify_one(input),
            expected(input, DropPathKind::Other, false)
        );
    }
}
