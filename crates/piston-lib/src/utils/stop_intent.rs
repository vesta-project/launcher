//! User-initiated stop markers for distinguishing intentional kills from crashes.
//!
//! When the launcher kills an instance, it writes `{game_dir}/.vesta/stop_requested`.
//! Exit handlers consume this marker so non-zero exit codes are not reported as crashes.

use anyhow::{Context, Result};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

fn stop_requested_file(game_dir: &Path) -> PathBuf {
    game_dir.join(".vesta").join("stop_requested")
}

fn remove_marker(path: &Path) -> Result<bool> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Mark that the current game stop was explicitly requested by the user.
pub fn mark_stop_requested(game_dir: &Path) -> Result<()> {
    let path = stop_requested_file(game_dir);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .context("Failed to create stop-request marker directory")?;
    }

    std::fs::write(&path, chrono::Utc::now().to_rfc3339())
        .context("Failed to write stop-request marker")?;

    Ok(())
}

/// Clear any pending stop-request marker before a new launch (idempotent).
pub fn clear_stop_requested(game_dir: &Path) -> Result<()> {
    let _ = remove_marker(&stop_requested_file(game_dir))?;
    Ok(())
}

/// Consume and clear a pending stop-request marker, returning whether one existed.
pub fn consume_stop_requested(game_dir: &Path) -> Result<bool> {
    remove_marker(&stop_requested_file(game_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn marker_path(dir: &Path) -> PathBuf {
        stop_requested_file(dir)
    }

    #[test]
    fn mark_creates_file() {
        let tmp = TempDir::new().unwrap();
        mark_stop_requested(tmp.path()).unwrap();
        assert!(marker_path(tmp.path()).is_file());
    }

    #[test]
    fn consume_returns_true_and_removes() {
        let tmp = TempDir::new().unwrap();
        mark_stop_requested(tmp.path()).unwrap();

        assert!(consume_stop_requested(tmp.path()).unwrap());
        assert!(!marker_path(tmp.path()).exists());
    }

    #[test]
    fn consume_absent_returns_false() {
        let tmp = TempDir::new().unwrap();
        assert!(!consume_stop_requested(tmp.path()).unwrap());
    }

    #[test]
    fn clear_is_idempotent() {
        let tmp = TempDir::new().unwrap();

        clear_stop_requested(tmp.path()).unwrap();
        assert!(!marker_path(tmp.path()).exists());

        mark_stop_requested(tmp.path()).unwrap();
        clear_stop_requested(tmp.path()).unwrap();
        assert!(!marker_path(tmp.path()).exists());
    }

    #[test]
    fn double_consume_returns_false() {
        let tmp = TempDir::new().unwrap();
        mark_stop_requested(tmp.path()).unwrap();

        assert!(consume_stop_requested(tmp.path()).unwrap());
        assert!(!consume_stop_requested(tmp.path()).unwrap());
    }
}
