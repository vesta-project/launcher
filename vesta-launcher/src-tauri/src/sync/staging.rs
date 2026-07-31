use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::paths::{join_validated, path_is_within, validate_staged_relative_path};

const UPDATE_ROLLBACK_DIR: &str = ".update_rollback";
const UPDATE_ROLLBACK_FILES_DIR: &str = "files";
const UPDATE_ROLLBACK_MANIFEST: &str = "manifest.json";
const UPDATE_ROLLBACK_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RollbackPhase {
    Prepared,
    BackedUp,
    Restoring,
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RollbackManifest {
    version: u32,
    phase: RollbackPhase,
    entries: Vec<SnapshotEntry>,
    rotations: Vec<RollbackRotation>,
}

/// Snapshot of active paths that an update may mutate. The snapshot remains
/// live through manifest/runtime finalization so a late failure can restore the
/// previous playable instance, not merely clear the staging directory.
pub struct RollbackSnapshot {
    root: PathBuf,
    game_dir: PathBuf,
    active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingRollbackOutcome {
    Restored,
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotEntry {
    relative_path: String,
    existed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RollbackRotation {
    pub original_path: String,
    pub preserved_path: String,
    existed: bool,
}

impl RollbackRotation {
    pub fn new(original_path: String, preserved_path: String) -> Self {
        Self {
            original_path,
            preserved_path,
            existed: false,
        }
    }
}

impl RollbackSnapshot {
    pub fn capture<I, S, R>(game_dir: &Path, relative_paths: I, rotations: R) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
        R: IntoIterator<Item = RollbackRotation>,
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

        let mut rotations = rotations.into_iter().collect::<Vec<_>>();
        for rotation in &mut rotations {
            validate_transaction_path(&rotation.original_path)?;
            validate_transaction_path(&rotation.preserved_path)?;
            if rotation.original_path == rotation.preserved_path {
                anyhow::bail!(
                    "Rollback rotation must use distinct paths: {}",
                    rotation.original_path
                );
            }

            let original = join_validated(game_dir, &rotation.original_path)?;
            let preserved = join_validated(game_dir, &rotation.preserved_path)?;
            ensure_no_symlink_path(game_dir, &rotation.original_path)?;
            ensure_no_symlink_path(game_dir, &rotation.preserved_path)?;
            rotation.existed = std::fs::symlink_metadata(&original).is_ok();
            if rotation.existed && std::fs::symlink_metadata(&preserved).is_ok() {
                anyhow::bail!(
                    "Cannot preserve update path because the destination already exists: {}",
                    rotation.preserved_path
                );
            }
        }

        let rotated_roots = rotations
            .iter()
            .map(|rotation| PathBuf::from(&rotation.original_path))
            .collect::<Vec<_>>();
        paths.retain(|path| {
            let candidate = PathBuf::from(path);
            !rotated_roots
                .iter()
                .any(|root| candidate == *root || candidate.starts_with(root))
        });

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

        std::fs::create_dir_all(root.join(UPDATE_ROLLBACK_FILES_DIR))
            .with_context(|| format!("Failed to create update rollback snapshot {:?}", root))?;

        let mut entries = Vec::with_capacity(paths.len());
        for relative_path in paths {
            ensure_no_symlink_path(game_dir, &relative_path)?;
            let source = join_validated(game_dir, &relative_path)?;
            entries.push(SnapshotEntry {
                relative_path,
                existed: std::fs::symlink_metadata(source).is_ok(),
            });
        }

        let mut manifest = RollbackManifest {
            version: UPDATE_ROLLBACK_MANIFEST_VERSION,
            phase: RollbackPhase::Prepared,
            entries,
            rotations,
        };
        write_manifest(&root, &manifest)?;

        let capture_result = (|| {
            let files_root = root.join(UPDATE_ROLLBACK_FILES_DIR);
            for entry in &manifest.entries {
                if !entry.existed {
                    continue;
                }
                let source = join_validated(game_dir, &entry.relative_path)?;
                let destination = join_validated(&files_root, &entry.relative_path)?;
                move_path(&source, &destination)?;
            }

            for rotation in &manifest.rotations {
                if !rotation.existed {
                    continue;
                }
                let source = join_validated(game_dir, &rotation.original_path)?;
                let destination = join_validated(game_dir, &rotation.preserved_path)?;
                move_path(&source, &destination)?;
            }

            manifest.phase = RollbackPhase::BackedUp;
            write_manifest(&root, &manifest)
        })();

        match capture_result {
            Ok(()) => Ok(Self {
                root,
                game_dir: game_dir.to_path_buf(),
                active: true,
            }),
            Err(error) => {
                let restore_error = restore_from_root(game_dir, &root).err();
                match restore_error {
                    Some(restore_error) => Err(anyhow::anyhow!(
                        "{}; automatic rollback was incomplete: {}",
                        error,
                        restore_error
                    )),
                    None => Err(error),
                }
            }
        }
    }

    pub fn restore(mut self) -> Result<()> {
        restore_from_root(&self.game_dir, &self.root)?;
        self.active = false;
        Ok(())
    }

    pub fn finalize(mut self) -> Result<()> {
        let mut manifest = read_manifest(&self.root)?;
        manifest.phase = RollbackPhase::Committed;
        write_manifest(&self.root, &manifest)?;
        self.active = false;
        Ok(())
    }

    pub fn restore_pending(game_dir: &Path) -> Result<Option<PendingRollbackOutcome>> {
        let root = game_dir.join(UPDATE_ROLLBACK_DIR);
        if !root.exists() {
            return Ok(None);
        }
        restore_from_root(game_dir, &root).map(Some)
    }

    pub fn pending_exists(game_dir: &Path) -> bool {
        game_dir.join(UPDATE_ROLLBACK_DIR).exists()
    }

    pub fn pending_is_committed(game_dir: &Path) -> Result<bool> {
        let root = game_dir.join(UPDATE_ROLLBACK_DIR);
        if !root.exists() {
            return Ok(false);
        }
        Ok(read_manifest(&root)?.phase == RollbackPhase::Committed)
    }

    pub fn cleanup_committed(game_dir: &Path) -> Result<bool> {
        let root = game_dir.join(UPDATE_ROLLBACK_DIR);
        if !root.exists() {
            return Ok(false);
        }
        let manifest = read_manifest(&root)?;
        if manifest.phase != RollbackPhase::Committed {
            anyhow::bail!("Cannot clean an update rollback that is not committed");
        }
        std::fs::remove_dir_all(&root)
            .with_context(|| format!("Failed to clean committed rollback snapshot {:?}", root))?;
        Ok(true)
    }
}

impl Drop for RollbackSnapshot {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        if let Err(error) = restore_from_root(&self.game_dir, &self.root) {
            log::error!(
                "[staging] Failed to restore update rollback snapshot {:?}: {}",
                self.root,
                error
            );
        }
    }
}

fn restore_from_root(game_dir: &Path, root: &Path) -> Result<PendingRollbackOutcome> {
    let mut manifest = read_manifest(root)?;
    if manifest.phase == RollbackPhase::Committed {
        std::fs::remove_dir_all(root)
            .with_context(|| format!("Failed to clean committed rollback snapshot {:?}", root))?;
        return Ok(PendingRollbackOutcome::Committed);
    }

    let may_have_applied = manifest.phase != RollbackPhase::Prepared;
    manifest.phase = RollbackPhase::Restoring;
    write_manifest(root, &manifest)?;

    let files_root = root.join(UPDATE_ROLLBACK_FILES_DIR);
    for entry in manifest.entries.iter().rev() {
        let target = join_validated(game_dir, &entry.relative_path)?;
        let backup = join_validated(&files_root, &entry.relative_path)?;
        if entry.existed {
            if std::fs::symlink_metadata(&backup).is_ok() {
                remove_path_if_exists(&target)?;
                move_path(&backup, &target)?;
            } else if std::fs::symlink_metadata(&target).is_err() {
                anyhow::bail!(
                    "Missing both active and backup copies for {}",
                    entry.relative_path
                );
            }
        } else if may_have_applied {
            remove_path_if_exists(&target)?;
        }
    }

    for rotation in manifest.rotations.iter().rev() {
        if !rotation.existed {
            continue;
        }
        let original = join_validated(game_dir, &rotation.original_path)?;
        let preserved = join_validated(game_dir, &rotation.preserved_path)?;
        if std::fs::symlink_metadata(&preserved).is_ok() {
            remove_path_if_exists(&original)?;
            move_path(&preserved, &original)?;
        } else if std::fs::symlink_metadata(&original).is_err() {
            anyhow::bail!(
                "Missing both active and preserved copies for {}",
                rotation.original_path
            );
        }
    }

    std::fs::remove_dir_all(root).with_context(|| {
        format!(
            "Restored update files but failed to remove rollback snapshot {:?}",
            root
        )
    })?;
    log::info!("[staging] Restored pre-update filesystem transaction");
    Ok(PendingRollbackOutcome::Restored)
}

fn validate_transaction_path(path: &str) -> Result<()> {
    validate_staged_relative_path(path)?;
    let first = Path::new(path).components().next();
    if first.is_some_and(|component| {
        matches!(
            component.as_os_str().to_str(),
            Some(UPDATE_ROLLBACK_DIR) | Some(".update_stage")
        )
    }) {
        anyhow::bail!("Update path targets reserved launcher state: {}", path);
    }
    Ok(())
}

fn ensure_no_symlink_path(root: &Path, relative_path: &str) -> Result<()> {
    validate_transaction_path(relative_path)?;
    let mut current = root.to_path_buf();
    for component in Path::new(relative_path).components() {
        current.push(component.as_os_str());
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                anyhow::bail!("Cannot safely transact symlinked update path {:?}", current)
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Failed to inspect update path {:?}", current))
            }
        }
    }
    Ok(())
}

fn move_path(source: &Path, destination: &Path) -> Result<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create rollback parent {:?}", parent))?;
    }
    std::fs::rename(source, destination).with_context(|| {
        format!(
            "Failed to move update path {:?} to {:?}",
            source, destination
        )
    })
}

fn read_manifest(root: &Path) -> Result<RollbackManifest> {
    let path = root.join(UPDATE_ROLLBACK_MANIFEST);
    let bytes = std::fs::read(&path)
        .with_context(|| format!("Missing or unreadable rollback manifest {:?}", path))?;
    let manifest: RollbackManifest = serde_json::from_slice(&bytes)
        .with_context(|| format!("Invalid rollback manifest {:?}", path))?;
    if manifest.version != UPDATE_ROLLBACK_MANIFEST_VERSION {
        anyhow::bail!(
            "Unsupported rollback manifest version {} at {:?}",
            manifest.version,
            path
        );
    }
    Ok(manifest)
}

fn write_manifest(root: &Path, manifest: &RollbackManifest) -> Result<()> {
    let path = root.join(UPDATE_ROLLBACK_MANIFEST);
    let temporary = root.join(format!("{}.tmp", UPDATE_ROLLBACK_MANIFEST));
    let bytes = serde_json::to_vec_pretty(manifest)?;
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&temporary)
            .with_context(|| format!("Failed to create rollback journal {:?}", temporary))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&temporary, &path).with_context(|| {
        format!(
            "Failed to commit rollback journal {:?} to {:?}",
            temporary, path
        )
    })?;
    if let Ok(directory) = std::fs::File::open(root) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Failed to inspect updated path before removal {:?}", path)
            })
        }
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        std::fs::remove_dir_all(path)
            .with_context(|| format!("Failed to remove updated directory {:?}", path))
    } else {
        std::fs::remove_file(path)
            .with_context(|| format!("Failed to remove updated file or symlink {:?}", path))
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
            Vec::<RollbackRotation>::new(),
        )
        .unwrap();

        assert!(!game_dir.join("mods/changed.jar").exists());
        assert!(game_dir
            .join(UPDATE_ROLLBACK_DIR)
            .join(UPDATE_ROLLBACK_FILES_DIR)
            .join("mods/changed.jar")
            .exists());
        std::fs::write(game_dir.join("mods/changed.jar"), b"new").unwrap();
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

        let snapshot = RollbackSnapshot::capture(
            &game_dir,
            ["mods/example.jar"],
            Vec::<RollbackRotation>::new(),
        )
        .unwrap();
        std::fs::write(game_dir.join("mods/example.jar"), b"new").unwrap();
        snapshot.finalize().unwrap();

        assert_eq!(
            std::fs::read(game_dir.join("mods/example.jar")).unwrap(),
            b"new"
        );
        assert!(game_dir.join(UPDATE_ROLLBACK_DIR).exists());
        RollbackSnapshot::cleanup_committed(&game_dir).unwrap();
        assert!(!game_dir.join(UPDATE_ROLLBACK_DIR).exists());
    }

    #[test]
    fn rollback_snapshot_rejects_its_reserved_directory() {
        let dir = tempfile::tempdir().unwrap();
        let result = RollbackSnapshot::capture(
            dir.path(),
            [".update_rollback/recursive"],
            Vec::<RollbackRotation>::new(),
        );

        assert!(result.is_err());
        assert!(!dir.path().join(UPDATE_ROLLBACK_DIR).exists());
    }

    #[test]
    fn pending_snapshot_restores_after_owner_is_lost() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(game_dir.join("mods")).unwrap();
        std::fs::write(game_dir.join("mods/example.jar"), b"old").unwrap();

        let snapshot = RollbackSnapshot::capture(
            &game_dir,
            ["mods/example.jar", "mods/added.jar"],
            Vec::<RollbackRotation>::new(),
        )
        .unwrap();
        std::mem::forget(snapshot);
        std::fs::write(game_dir.join("mods/example.jar"), b"new").unwrap();
        std::fs::write(game_dir.join("mods/added.jar"), b"added").unwrap();

        assert_eq!(
            RollbackSnapshot::restore_pending(&game_dir).unwrap(),
            Some(PendingRollbackOutcome::Restored)
        );
        assert_eq!(
            std::fs::read(game_dir.join("mods/example.jar")).unwrap(),
            b"old"
        );
        assert!(!game_dir.join("mods/added.jar").exists());
    }

    #[test]
    fn prepared_snapshot_does_not_remove_new_user_path_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        let root = game_dir.join(UPDATE_ROLLBACK_DIR);
        std::fs::create_dir_all(root.join(UPDATE_ROLLBACK_FILES_DIR)).unwrap();
        std::fs::create_dir_all(game_dir.join("mods")).unwrap();
        std::fs::write(game_dir.join("mods/user-added.jar"), b"user").unwrap();
        write_manifest(
            &root,
            &RollbackManifest {
                version: UPDATE_ROLLBACK_MANIFEST_VERSION,
                phase: RollbackPhase::Prepared,
                entries: vec![SnapshotEntry {
                    relative_path: "mods/user-added.jar".to_string(),
                    existed: false,
                }],
                rotations: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(
            RollbackSnapshot::restore_pending(&game_dir).unwrap(),
            Some(PendingRollbackOutcome::Restored)
        );
        assert_eq!(
            std::fs::read(game_dir.join("mods/user-added.jar")).unwrap(),
            b"user"
        );
    }

    #[test]
    fn incomplete_restore_keeps_journal_for_resume() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        let root = game_dir.join(UPDATE_ROLLBACK_DIR);
        std::fs::create_dir_all(root.join(UPDATE_ROLLBACK_FILES_DIR)).unwrap();
        write_manifest(
            &root,
            &RollbackManifest {
                version: UPDATE_ROLLBACK_MANIFEST_VERSION,
                phase: RollbackPhase::BackedUp,
                entries: vec![SnapshotEntry {
                    relative_path: "mods/missing.jar".to_string(),
                    existed: true,
                }],
                rotations: Vec::new(),
            },
        )
        .unwrap();

        let error = RollbackSnapshot::restore_pending(&game_dir).unwrap_err();
        assert!(error
            .to_string()
            .contains("Missing both active and backup copies"));
        assert!(root.join(UPDATE_ROLLBACK_MANIFEST).exists());
        assert_eq!(
            read_manifest(&root).unwrap().phase,
            RollbackPhase::Restoring
        );

        let backup = root
            .join(UPDATE_ROLLBACK_FILES_DIR)
            .join("mods/missing.jar");
        std::fs::create_dir_all(backup.parent().unwrap()).unwrap();
        std::fs::write(&backup, b"restored").unwrap();

        assert_eq!(
            RollbackSnapshot::restore_pending(&game_dir).unwrap(),
            Some(PendingRollbackOutcome::Restored)
        );
        assert_eq!(
            std::fs::read(game_dir.join("mods/missing.jar")).unwrap(),
            b"restored"
        );
        assert!(!root.exists());
    }

    #[test]
    fn committed_snapshot_is_cleaned_without_restoring_old_files() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("instance");
        std::fs::create_dir_all(game_dir.join("mods")).unwrap();
        std::fs::write(game_dir.join("mods/example.jar"), b"old").unwrap();

        let snapshot = RollbackSnapshot::capture(
            &game_dir,
            ["mods/example.jar"],
            Vec::<RollbackRotation>::new(),
        )
        .unwrap();
        std::fs::write(game_dir.join("mods/example.jar"), b"new").unwrap();
        snapshot.finalize().unwrap();

        assert_eq!(
            RollbackSnapshot::restore_pending(&game_dir).unwrap(),
            Some(PendingRollbackOutcome::Committed)
        );
        assert_eq!(
            std::fs::read(game_dir.join("mods/example.jar")).unwrap(),
            b"new"
        );
        assert!(!game_dir.join(UPDATE_ROLLBACK_DIR).exists());
    }
}
