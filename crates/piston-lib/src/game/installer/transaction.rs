use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Controls which directories an [`InstallTransaction`] protects during
/// an install/repair operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionScope {
    /// Protect versions, libraries, and assets directories.
    Full,
    /// Protect only the version-specific directory under `versions/`.
    Versions,
    /// Protect only the shared `libraries/` directory.
    Libraries,
    /// Protect only the shared `assets/` directory.
    Assets,
}

/// InstallTransaction encapsulates atomic writes and rollback handling inside piston-lib.
///
/// During [`begin`] the relevant directories (determined by [`TransactionScope`]) are moved
/// into a backup location.  [`commit`] discards the backups; [`rollback`] restores them.
pub struct InstallTransaction {
    version_id: String,
    data_root: PathBuf,
    scope: TransactionScope,
    backup_dir: PathBuf,
    checkpoints: Vec<String>,
    // Target paths
    target_version_dir: PathBuf,
    target_libraries_dir: PathBuf,
    target_assets_dir: PathBuf,
    // Backup paths
    backup_version_dir: PathBuf,
    backup_libraries_dir: PathBuf,
    backup_assets_dir: PathBuf,
}

impl InstallTransaction {
    /// Create a new transaction with the given [`TransactionScope`].
    ///
    /// `data_root` is the launcher data directory (the one that contains
    /// `versions/`, `libraries/`, and `assets/`).
    pub fn new(version_id: String, data_root: &Path, scope: TransactionScope) -> Self {
        let target_version_dir = data_root.join("versions").join(&version_id);
        let target_libraries_dir = data_root.join("libraries");
        let target_assets_dir = data_root.join("assets");
        let backup_dir = data_root.join("backups").join(&version_id);
        let backup_version_dir = backup_dir.join("versions").join(&version_id);
        let backup_libraries_dir = backup_dir.join("libraries");
        let backup_assets_dir = backup_dir.join("assets");
        Self {
            data_root: data_root.to_path_buf(),
            scope,
            backup_dir,
            version_id,
            target_version_dir,
            target_libraries_dir,
            target_assets_dir,
            backup_version_dir,
            backup_libraries_dir,
            backup_assets_dir,
            checkpoints: Vec::new(),
        }
    }

    // ------------------------------------------------------------------
    // Scope helpers
    // ------------------------------------------------------------------

    fn scope_versions(&self) -> bool {
        matches!(
            self.scope,
            TransactionScope::Full | TransactionScope::Versions
        )
    }

    fn scope_libraries(&self) -> bool {
        matches!(
            self.scope,
            TransactionScope::Full | TransactionScope::Libraries
        )
    }

    fn scope_assets(&self) -> bool {
        matches!(
            self.scope,
            TransactionScope::Full | TransactionScope::Assets
        )
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /// Begin the transaction: move existing directories into the backup
    /// location so they can be restored on [`rollback`](Self::rollback).
    pub fn begin(&self) -> Result<()> {
        fs::create_dir_all(&self.backup_dir)
            .with_context(|| format!("Create backup dir {:?}", self.backup_dir))?;

        // -- versions --
        if self.scope_versions() {
            if self.target_version_dir.exists() {
                if let Some(parent) = self.backup_version_dir.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("Create backup version parent {:?}", parent))?;
                }
                if self.backup_version_dir.exists() {
                    fs::remove_dir_all(&self.backup_version_dir).with_context(|| {
                        format!("Remove stale backup {:?}", self.backup_version_dir)
                    })?;
                }
                move_dir(&self.target_version_dir, &self.backup_version_dir).with_context(
                    || {
                        format!(
                            "Move existing version into backup {:?} -> {:?}",
                            self.target_version_dir, self.backup_version_dir
                        )
                    },
                )?;
            }
        }

        // -- libraries --
        if self.scope_libraries() {
            if self.target_libraries_dir.exists() {
                if self.backup_libraries_dir.exists() {
                    fs::remove_dir_all(&self.backup_libraries_dir).with_context(|| {
                        format!("Remove stale backup {:?}", self.backup_libraries_dir)
                    })?;
                }
                if let Some(parent) = self.backup_libraries_dir.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("Create backup libraries parent {:?}", parent))?;
                }
                move_dir(&self.target_libraries_dir, &self.backup_libraries_dir).with_context(
                    || {
                        format!(
                            "Move existing libraries into backup {:?} -> {:?}",
                            self.target_libraries_dir, self.backup_libraries_dir
                        )
                    },
                )?;
            }
        }

        // -- assets --
        if self.scope_assets() {
            if self.target_assets_dir.exists() {
                if self.backup_assets_dir.exists() {
                    fs::remove_dir_all(&self.backup_assets_dir).with_context(|| {
                        format!("Remove stale backup {:?}", self.backup_assets_dir)
                    })?;
                }
                if let Some(parent) = self.backup_assets_dir.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("Create backup assets parent {:?}", parent))?;
                }
                move_dir(&self.target_assets_dir, &self.backup_assets_dir).with_context(|| {
                    format!(
                        "Move existing assets into backup {:?} -> {:?}",
                        self.target_assets_dir, self.backup_assets_dir
                    )
                })?;
            }
        }

        log::info!("[txn:{}] begin (scope={:?})", self.version_id, self.scope);
        Ok(())
    }

    /// Record a named checkpoint.  All checkpoints are logged on
    /// [`commit`](Self::commit) / [`rollback`](Self::rollback).
    pub fn checkpoint(&mut self, label: &str) {
        self.checkpoints.push(label.to_string());
        log::debug!("[txn:{}] checkpoint {}", self.version_id, label);
    }

    /// Commit the transaction: discard all backups.
    pub fn commit(&self) -> Result<()> {
        self.log_checkpoints("commit");

        if self.backup_version_dir.exists() {
            fs::remove_dir_all(&self.backup_version_dir)
                .with_context(|| format!("Remove version backup {:?}", self.backup_version_dir))?;
        }
        if self.backup_libraries_dir.exists() {
            fs::remove_dir_all(&self.backup_libraries_dir).with_context(|| {
                format!("Remove libraries backup {:?}", self.backup_libraries_dir)
            })?;
        }
        if self.backup_assets_dir.exists() {
            fs::remove_dir_all(&self.backup_assets_dir)
                .with_context(|| format!("Remove assets backup {:?}", self.backup_assets_dir))?;
        }
        if self.backup_dir.exists() {
            fs::remove_dir_all(&self.backup_dir)
                .with_context(|| format!("Remove backup dir {:?}", self.backup_dir))?;
        }
        log::info!("[txn:{}] commit (scope={:?})", self.version_id, self.scope);
        Ok(())
    }

    /// Rollback the transaction: remove any partially-installed targets and
    /// restore the original directories from backup.
    pub fn rollback(&self, reason: &str) -> Result<()> {
        log::warn!("[txn:{}] rollback: {}", self.version_id, reason);
        self.log_checkpoints("rollback");

        // -- versions --
        if self.scope_versions() {
            if self.target_version_dir.exists() {
                fs::remove_dir_all(&self.target_version_dir).with_context(|| {
                    format!("Remove failed install {:?}", self.target_version_dir)
                })?;
            }
            if self.backup_version_dir.exists() {
                if let Some(parent) = self.target_version_dir.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("Recreate versions dir parent {:?}", parent))?;
                }
                move_dir(&self.backup_version_dir, &self.target_version_dir).with_context(
                    || {
                        format!(
                            "Restore version from backup {:?} -> {:?}",
                            self.backup_version_dir, self.target_version_dir
                        )
                    },
                )?;
            }
        }

        // -- libraries --
        if self.scope_libraries() {
            if self.target_libraries_dir.exists() {
                fs::remove_dir_all(&self.target_libraries_dir).with_context(|| {
                    format!(
                        "Remove partially-installed libraries {:?}",
                        self.target_libraries_dir
                    )
                })?;
            }
            if self.backup_libraries_dir.exists() {
                if let Some(parent) = self.target_libraries_dir.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("Recreate libraries dir parent {:?}", parent))?;
                }
                move_dir(&self.backup_libraries_dir, &self.target_libraries_dir).with_context(
                    || {
                        format!(
                            "Restore libraries from backup {:?} -> {:?}",
                            self.backup_libraries_dir, self.target_libraries_dir
                        )
                    },
                )?;
            }
        }

        // -- assets --
        if self.scope_assets() {
            if self.target_assets_dir.exists() {
                fs::remove_dir_all(&self.target_assets_dir).with_context(|| {
                    format!(
                        "Remove partially-installed assets {:?}",
                        self.target_assets_dir
                    )
                })?;
            }
            if self.backup_assets_dir.exists() {
                if let Some(parent) = self.target_assets_dir.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("Recreate assets dir parent {:?}", parent))?;
                }
                move_dir(&self.backup_assets_dir, &self.target_assets_dir).with_context(|| {
                    format!(
                        "Restore assets from backup {:?} -> {:?}",
                        self.backup_assets_dir, self.target_assets_dir
                    )
                })?;
            }
        }

        if self.backup_dir.exists() {
            fs::remove_dir_all(&self.backup_dir)
                .with_context(|| format!("Clean backup dir {:?}", self.backup_dir))?;
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Accessors
    // ------------------------------------------------------------------

    pub fn versions_dir(&self) -> PathBuf {
        self.data_root.join("versions")
    }

    pub fn libraries_dir(&self) -> PathBuf {
        self.data_root.join("libraries")
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.data_root.join("assets")
    }

    pub fn backup_dir(&self) -> &PathBuf {
        &self.backup_dir
    }

    pub fn scope(&self) -> TransactionScope {
        self.scope
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    fn log_checkpoints(&self, phase: &str) {
        if self.checkpoints.is_empty() {
            return;
        }
        log::info!(
            "[txn:{}] {} checkpoints: {}",
            self.version_id,
            phase,
            self.checkpoints.join(" → ")
        );
    }
}

fn move_dir(src: &Path, dest: &Path) -> Result<()> {
    match fs::rename(src, dest) {
        Ok(_) => Ok(()),
        Err(err) if is_cross_device_link(&err) => {
            copy_dir_recursive(src, dest)?;
            fs::remove_dir_all(src).with_context(|| format!("Remove source dir {:?}", src))?;
            Ok(())
        }
        Err(err) => Err(err).with_context(|| format!("Move dir {:?} -> {:?}", src, dest)),
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest).with_context(|| format!("Create copy dest {:?}", dest))?;
    for entry in fs::read_dir(src).with_context(|| format!("Read dir {:?}", src))? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target_path = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target_path)?;
        } else {
            fs::copy(entry.path(), &target_path)
                .with_context(|| format!("Copy file {:?} -> {:?}", entry.path(), target_path))?;
        }
    }
    Ok(())
}

fn is_cross_device_link(err: &std::io::Error) -> bool {
    #[cfg(target_family = "unix")]
    {
        // EXDEV (18) is the standard error for cross-device links on Unix.
        // We check the raw OS error primarily to avoid compatibility issues with
        // older Rust toolchains that might not have ErrorKind::CrossDeviceLink.
        err.raw_os_error() == Some(18)
    }

    #[cfg(not(target_family = "unix"))]
    {
        let _ = err;
        false
    }
}
