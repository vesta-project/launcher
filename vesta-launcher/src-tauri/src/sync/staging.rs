use anyhow::{Context, Result};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::paths::{join_validated, path_is_within, validate_staged_relative_path};

const UPDATE_ROLLBACK_DIR: &str = ".update_rollback";

/// Snapshot of active paths that an update may mutate. The snapshot remains
/// live through manifest/runtime finalization so a late failure can restore the
/// previous playable instance, not merely clear the staging directory.
pub struct RollbackSnapshot {
    root: PathBuf,
    game_dir: PathBuf,
    entries: Vec<SnapshotEntry>,
    active: bool,
}

struct SnapshotEntry {
    relative_path: String,
    existed: bool,
}

impl RollbackSnapshot {
    pub fn capture<I, S>(game_dir: &Path, relative_paths: I) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let root = game_dir.join(UPDATE_ROLLBACK_DIR);
        if root.exists() {
            anyhow::bail!(
                "Cannot start update while a previous rollback snapshot exists at {:?}",
                root
            );
        }

        let mut unique = HashSet::new();
        let mut paths = Vec::new();
        for path in relative_paths {
            let path = path.into();
            validate_staged_relative_path(&path)?;
            if Path::new(&path)
                .components()
                .next()
                .is_some_and(|component| component.as_os_str() == UPDATE_ROLLBACK_DIR)
            {
                anyhow::bail!(
                    "Update path may not target the reserved rollback directory: {}",
                    path
                );
            }
            if unique.insert(path.clone()) {
                paths.push(path);
            }
        }

        // If an ancestor is already captured, its snapshot covers every child.
        paths.sort_by_key(|path| Path::new(path).components().count());
        let mut covered = Vec::<PathBuf>::new();
        paths.retain(|path| {
            let candidate = PathBuf::from(path);
            if covered
                .iter()
                .any(|ancestor| candidate.starts_with(ancestor))
            {
                false
            } else {
                covered.push(candidate);
                true
            }
        });

        std::fs::create_dir_all(&root)
            .with_context(|| format!("Failed to create update rollback snapshot {:?}", root))?;

        let capture_result = (|| {
            let mut entries = Vec::with_capacity(paths.len());
            for relative_path in paths {
                let source = join_validated(game_dir, &relative_path)?;
                let existed = source.exists();
                if existed {
                    let destination = join_validated(&root, &relative_path)?;
                    copy_path(&source, &destination)?;
                }
                entries.push(SnapshotEntry {
                    relative_path,
                    existed,
                });
            }
            Ok(entries)
        })();

        match capture_result {
            Ok(entries) => Ok(Self {
                root,
                game_dir: game_dir.to_path_buf(),
                entries,
                active: true,
            }),
            Err(error) => {
                let _ = std::fs::remove_dir_all(&root);
                Err(error)
            }
        }
    }

    pub fn restore(mut self) -> Result<()> {
        self.restore_inner()?;
        self.active = false;
        Ok(())
    }

    pub fn finalize(mut self) {
        self.active = false;
        if let Err(error) = std::fs::remove_dir_all(&self.root) {
            log::warn!(
                "[staging] Update succeeded but rollback snapshot cleanup failed at {:?}: {}",
                self.root,
                error
            );
        }
    }

    fn restore_inner(&self) -> Result<()> {
        for entry in &self.entries {
            let target = join_validated(&self.game_dir, &entry.relative_path)?;
            remove_path_if_exists(&target)?;

            if entry.existed {
                let backup = join_validated(&self.root, &entry.relative_path)?;
                copy_path(&backup, &target)?;
            }
        }

        std::fs::remove_dir_all(&self.root).with_context(|| {
            format!(
                "Restored update files but failed to remove rollback snapshot {:?}",
                self.root
            )
        })?;
        log::info!("[staging] Restored pre-update filesystem snapshot");
        Ok(())
    }
}

impl Drop for RollbackSnapshot {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        if let Err(error) = self.restore_inner() {
            log::error!(
                "[staging] Failed to restore update rollback snapshot {:?}: {}",
                self.root,
                error
            );
        }
    }
}

fn copy_path(source: &Path, destination: &Path) -> Result<()> {
    let metadata = std::fs::symlink_metadata(source)
        .with_context(|| format!("Failed to inspect update path {:?}", source))?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Cannot safely snapshot symlinked update path {:?}", source);
    }

    if metadata.is_dir() {
        std::fs::create_dir_all(destination)
            .with_context(|| format!("Failed to create snapshot directory {:?}", destination))?;
        for entry in std::fs::read_dir(source)
            .with_context(|| format!("Failed to read update directory {:?}", source))?
        {
            let entry = entry?;
            copy_path(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(source, destination).with_context(|| {
            format!(
                "Failed to snapshot update path {:?} to {:?}",
                source, destination
            )
        })?;
    }
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        std::fs::remove_dir_all(path)
            .with_context(|| format!("Failed to remove updated directory {:?}", path))
    } else {
        std::fs::remove_file(path)
            .with_context(|| format!("Failed to remove updated file {:?}", path))
    }
}

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
    pub fn staged_path(&self, relative_path: &str) -> Result<PathBuf> {
        join_validated(&self.root, relative_path)
    }

    /// Prepare a subdirectory for a staged file (creates intermediate dirs).
    pub fn prepare_parent(&self, relative_path: &str) -> Result<()> {
        validate_staged_relative_path(relative_path)?;
        if let Some(parent) = self.staged_path(relative_path)?.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create staging parent dir {:?}", parent))?;
        }
        Ok(())
    }

    /// Write content to a staged file.
    pub fn write_staged(&self, relative_path: &str, content: &[u8]) -> Result<()> {
        let target = self.staged_path(relative_path)?;
        self.prepare_parent(relative_path)?;
        std::fs::write(&target, content)
            .with_context(|| format!("Failed to write staged file {:?}", target))?;
        log::debug!("[staging] Wrote staged file: {}", relative_path);
        Ok(())
    }

    /// Move a file from an external path into the staging directory.
    #[allow(dead_code)]
    pub fn move_into_staging(&self, source: &Path, relative_path: &str) -> Result<()> {
        let target = self.staged_path(relative_path)?;
        self.prepare_parent(relative_path)?;
        std::fs::rename(source, &target)
            .with_context(|| format!("Failed to move {:?} into staging as {:?}", source, target))?;
        log::debug!(
            "[staging] Moved into staging: {:?} → {}",
            source,
            relative_path
        );
        Ok(())
    }

    /// Atomically apply all staged changes to the game directory.
    /// This is the critical Phase 6 operation — all files are moved from
    /// `.update_stage/` into their permanent positions.
    pub fn commit(self) -> Result<()> {
        log::info!("[staging] Committing staged update to {:?}", self.game_dir);

        // Move each file from staging to its final destination
        Self::move_directory_contents(&self.root, &self.game_dir)?;

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
    /// Strips the current `source` prefix (not a constant root) so that
    /// nested subdirectories produce correct relative paths.
    fn move_directory_contents(source: &Path, target: &Path) -> Result<()> {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path
                .strip_prefix(source)
                .with_context(|| format!("Failed to compute relative path for {:?}", path))?;
            let destination = target.join(relative);
            path_is_within(target, &destination).with_context(|| {
                format!(
                    "Refusing to move staged file outside target directory: {:?} → {:?}",
                    path, destination
                )
            })?;

            if path.is_dir() {
                std::fs::create_dir_all(&destination)?;
                Self::move_directory_contents(&path, &destination)?;
            } else {
                // Ensure parent directory exists in target
                if let Some(parent) = destination.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(&path, &destination)
                    .with_context(|| format!("Failed to move {:?} → {:?}", path, destination))?;
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
        staging.write_staged("mods/test.jar", b"fake jar").unwrap();
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

    #[test]
    fn test_staging_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(&game_dir).unwrap();

        let staging = StagingDir::new(&game_dir).unwrap();
        assert!(staging.write_staged("../outside.txt", b"bad").is_err());
        staging.rollback();
        assert!(!dir.path().join("outside.txt").exists());
    }

    #[test]
    fn rollback_snapshot_restores_changed_deleted_and_added_paths() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(game_dir.join("mods")).unwrap();
        std::fs::write(game_dir.join("mods/changed.jar"), b"old").unwrap();
        std::fs::write(game_dir.join("mods/deleted.jar"), b"keep").unwrap();

        let snapshot = RollbackSnapshot::capture(
            &game_dir,
            ["mods/changed.jar", "mods/deleted.jar", "mods/added.jar"],
        )
        .unwrap();

        std::fs::write(game_dir.join("mods/changed.jar"), b"new").unwrap();
        std::fs::remove_file(game_dir.join("mods/deleted.jar")).unwrap();
        std::fs::write(game_dir.join("mods/added.jar"), b"added").unwrap();

        snapshot.restore().unwrap();

        assert_eq!(
            std::fs::read(game_dir.join("mods/changed.jar")).unwrap(),
            b"old"
        );
        assert_eq!(
            std::fs::read(game_dir.join("mods/deleted.jar")).unwrap(),
            b"keep"
        );
        assert!(!game_dir.join("mods/added.jar").exists());
        assert!(!game_dir.join(UPDATE_ROLLBACK_DIR).exists());
    }

    #[test]
    fn finalized_snapshot_keeps_updated_paths() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(game_dir.join("mods")).unwrap();
        std::fs::write(game_dir.join("mods/example.jar"), b"old").unwrap();

        let snapshot = RollbackSnapshot::capture(&game_dir, ["mods/example.jar"]).unwrap();
        std::fs::write(game_dir.join("mods/example.jar"), b"new").unwrap();
        snapshot.finalize();

        assert_eq!(
            std::fs::read(game_dir.join("mods/example.jar")).unwrap(),
            b"new"
        );
        assert!(!game_dir.join(UPDATE_ROLLBACK_DIR).exists());
    }

    #[test]
    fn rollback_snapshot_rejects_its_reserved_directory() {
        let dir = tempfile::tempdir().unwrap();
        let result = RollbackSnapshot::capture(dir.path(), [".update_rollback/recursive"]);

        assert!(result.is_err());
        assert!(!dir.path().join(UPDATE_ROLLBACK_DIR).exists());
    }
}
