use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// Manages the `.update_stage/` temporary directory used for atomic updates.
/// All new files are downloaded and prepared here, then atomically moved
/// into the game directory only after all operations succeed.
pub struct StagingDir {
    /// The staging directory path (game_dir/.update_stage/)
    root: PathBuf,
    /// The target game directory
    game_dir: PathBuf,
}

impl StagingDir {
    /// Create/initialize the staging directory.
    /// Cleans up any leftover staging from a previous failed update.
    pub fn new(game_dir: &Path) -> Result<Self> {
        let root = game_dir.join(".update_stage");

        // Clean up any leftover staging from a previous interrupted update
        if root.exists() {
            log::warn!(
                "[staging] Found leftover staging directory, cleaning up: {:?}",
                root
            );
            std::fs::remove_dir_all(&root)
                .with_context(|| format!("Failed to clean up leftover staging dir {:?}", root))?;
        }

        std::fs::create_dir_all(&root)
            .with_context(|| format!("Failed to create staging directory {:?}", root))?;

        Ok(Self {
            root,
            game_dir: game_dir.to_path_buf(),
        })
    }

    /// Get the path to the staging directory.
    #[allow(dead_code)]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Get the path for a staged file.
    pub fn staged_path(&self, relative_path: &str) -> PathBuf {
        self.root.join(relative_path)
    }

    /// Prepare a subdirectory for a staged file (creates intermediate dirs).
    pub fn prepare_parent(&self, relative_path: &str) -> Result<()> {
        if let Some(parent) = self.staged_path(relative_path).parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create staging parent dir {:?}", parent))?;
        }
        Ok(())
    }

    /// Write content to a staged file.
    pub fn write_staged(&self, relative_path: &str, content: &[u8]) -> Result<()> {
        let target = self.staged_path(relative_path);
        self.prepare_parent(relative_path)?;
        std::fs::write(&target, content)
            .with_context(|| format!("Failed to write staged file {:?}", target))?;
        log::debug!("[staging] Wrote staged file: {}", relative_path);
        Ok(())
    }

    /// Copy a file from an external path into the staging directory.
    pub fn copy_into_staging(&self, source: &Path, relative_path: &str) -> Result<()> {
        let target = self.staged_path(relative_path);
        self.prepare_parent(relative_path)?;
        std::fs::copy(source, &target).with_context(|| {
            format!(
                "Failed to copy {:?} into staging as {:?}",
                source, target
            )
        })?;
        log::debug!("[staging] Copied into staging: {:?} → {}", source, relative_path);
        Ok(())
    }

    /// Move a file from an external path into the staging directory.
    #[allow(dead_code)]
    pub fn move_into_staging(&self, source: &Path, relative_path: &str) -> Result<()> {
        let target = self.staged_path(relative_path);
        self.prepare_parent(relative_path)?;
        std::fs::rename(source, &target).with_context(|| {
            format!(
                "Failed to move {:?} into staging as {:?}",
                source, target
            )
        })?;
        log::debug!("[staging] Moved into staging: {:?} → {}", source, relative_path);
        Ok(())
    }

    /// Atomically apply all staged changes to the game directory.
    /// This is the critical Phase 6 operation — all files are moved from
    /// `.update_stage/` into their permanent positions.
    pub fn commit(self) -> Result<()> {
        log::info!("[staging] Committing staged update to {:?}", self.game_dir);

        // Move each file from staging to its final destination
        Self::move_directory_contents(&self.root, &self.game_dir, &self.root)?;

        // Clean up the now-empty staging directory
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root)
                .with_context(|| format!("Failed to clean up staging dir {:?}", self.root))?;
        }

        log::info!("[staging] Update committed successfully");
        Ok(())
    }

    /// Rollback: clean up the staging directory without applying changes.
    /// Called if the update fails mid-way.
    pub fn rollback(self) {
        if self.root.exists() {
            if let Err(e) = std::fs::remove_dir_all(&self.root) {
                log::error!("[staging] Failed to rollback staging dir: {}", e);
            } else {
                log::info!("[staging] Rolled back staging directory");
            }
        }
    }

    /// Recursively move contents of one directory into another.
    fn move_directory_contents(source: &Path, target: &Path, root: &Path) -> Result<()> {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .with_context(|| format!("Failed to compute relative path for {:?}", path))?;
            let destination = target.join(relative);

            if path.is_dir() {
                std::fs::create_dir_all(&destination)?;
                Self::move_directory_contents(&path, &destination, root)?;
            } else {
                // Ensure parent directory exists in target
                if let Some(parent) = destination.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(&path, &destination).with_context(|| {
                    format!("Failed to move {:?} → {:?}", path, destination)
                })?;
            }
        }
        Ok(())
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        // If the staging dir still exists and we're being dropped
        // without an explicit commit, clean up.
        // Note: commit() and rollback() both consume self, so this
        // only triggers on unexpected drops (e.g., panic during setup).
        if self.root.exists() {
            log::warn!("[staging] StagingDir dropped without commit/rollback — cleaning up");
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_staging_write_and_commit() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(&game_dir).unwrap();

        let staging = StagingDir::new(&game_dir).unwrap();
        staging
            .write_staged("config/test.txt", b"hello world")
            .unwrap();
        staging.commit().unwrap();

        let content = std::fs::read_to_string(game_dir.join("config/test.txt")).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn test_staging_rollback() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(&game_dir).unwrap();

        let staging = StagingDir::new(&game_dir).unwrap();
        staging
            .write_staged("mods/test.jar", b"fake jar")
            .unwrap();
        staging.rollback();

        // Game directory should be untouched
        assert!(!game_dir.join("mods/test.jar").exists());
        // Staging should be cleaned up
        assert!(!game_dir.join(".update_stage").exists());
    }

    #[test]
    fn test_staging_cleans_up_leftovers() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(&game_dir).unwrap();

        // Create a fake leftover staging dir
        let leftover = game_dir.join(".update_stage");
        std::fs::create_dir_all(&leftover).unwrap();
        std::fs::write(leftover.join("old_file.txt"), b"leftover").unwrap();

        // Creating a new StagingDir should clean it up
        let staging = StagingDir::new(&game_dir).unwrap();
        assert!(!leftover.join("old_file.txt").exists());
        staging.rollback();
    }
}
