use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_family = "unix")]
use std::io::ErrorKind;

/// InstallTransaction encapsulates atomic writes and rollback handling inside piston-lib.
pub struct InstallTransaction {
    version_id: String,
    versions_dir: PathBuf,
    libraries_dir: PathBuf,
    backup_dir: PathBuf,
    target_version_dir: PathBuf,
    backup_version_dir: PathBuf,
}

impl InstallTransaction {
    pub fn new(version_id: String, data_root: &Path) -> Self {
        let versions_dir = data_root.join("versions");
        let target_version_dir = versions_dir.join(&version_id);
        let backup_dir = data_root.join("backups").join(&version_id);
        let backup_version_dir = backup_dir.join("versions").join(&version_id);
        Self {
            versions_dir,
            libraries_dir: data_root.join("libraries"),
            backup_dir,
            version_id,
            target_version_dir,
            backup_version_dir,
        }
    }

    pub fn begin(&self) -> Result<()> {
        fs::create_dir_all(&self.backup_dir)
            .with_context(|| format!("Create backup dir {:?}", self.backup_dir))?;
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
            move_dir(&self.target_version_dir, &self.backup_version_dir).with_context(|| {
                format!(
                    "Move existing version into backup {:?} -> {:?}",
                    self.target_version_dir, self.backup_version_dir
                )
            })?;
        }
        log::info!("[txn:{}] begin", self.version_id);
        Ok(())
    }

    pub fn checkpoint(&self, label: &str) {
        log::debug!("[txn:{}] checkpoint {}", self.version_id, label);
    }

    pub fn commit(&self) -> Result<()> {
        if self.backup_version_dir.exists() {
            fs::remove_dir_all(&self.backup_version_dir)
                .with_context(|| format!("Remove version backup {:?}", self.backup_version_dir))?;
        }
        if self.backup_dir.exists() {
            fs::remove_dir_all(&self.backup_dir)
                .with_context(|| format!("Remove backup dir {:?}", self.backup_dir))?;
        }
        log::info!("[txn:{}] commit", self.version_id);
        Ok(())
    }

    pub fn rollback(&self, reason: &str) -> Result<()> {
        log::warn!("[txn:{}] rollback: {}", self.version_id, reason);
        if self.target_version_dir.exists() {
            fs::remove_dir_all(&self.target_version_dir)
                .with_context(|| format!("Remove failed install {:?}", self.target_version_dir))?;
        }
        if self.backup_version_dir.exists() {
            if let Some(parent) = self.target_version_dir.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("Recreate versions dir parent {:?}", parent))?;
            }
            move_dir(&self.backup_version_dir, &self.target_version_dir).with_context(|| {
                format!(
                    "Restore version from backup {:?} -> {:?}",
                    self.backup_version_dir, self.target_version_dir
                )
            })?;
        }
        if self.backup_dir.exists() {
            fs::remove_dir_all(&self.backup_dir)
                .with_context(|| format!("Clean backup dir {:?}", self.backup_dir))?;
        }
        Ok(())
    }

    pub fn versions_dir(&self) -> &PathBuf {
        &self.versions_dir
    }

    pub fn libraries_dir(&self) -> &PathBuf {
        &self.libraries_dir
    }

    pub fn backup_dir(&self) -> &PathBuf {
        &self.backup_dir
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
        use std::io::ErrorKind;
        // CrossDeviceLink was stabilized in 1.35, but sometimes it doesn't resolve correctly
        // in all environments or older toolchains. We also check the raw OS error for EXDEV.
        err.kind() == ErrorKind::CrossDeviceLink || err.raw_os_error() == Some(18)
    }

    #[cfg(not(target_family = "unix"))]
    {
        let _ = err;
        false
    }
}
