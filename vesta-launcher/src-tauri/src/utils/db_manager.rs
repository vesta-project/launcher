//! Database Manager
//!
//! Helper functions for database paths.
//! Legacy database initialization has been replaced by Diesel `utils::db`.

use anyhow::Result;
use directories::BaseDirs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

fn app_config_folder_name() -> &'static str {
    if cfg!(target_os = "windows") {
        ".VestaLauncher"
    } else {
        "VestaLauncher"
    }
}

fn migrate_missing_legacy_entries(legacy_dir: &Path, config_dir: &Path) -> Result<()> {
    for entry in std::fs::read_dir(legacy_dir)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = config_dir.join(entry.file_name());

        if dst_path.exists() {
            continue;
        }

        std::fs::rename(&src_path, &dst_path).map_err(|err| {
            anyhow::anyhow!(
                "Failed to migrate app data entry from '{}' to '{}': {}",
                src_path.display(),
                dst_path.display(),
                err
            )
        })?;
    }

    match std::fs::remove_dir(legacy_dir) {
        Ok(()) => {
            log::info!(
                "Removed legacy app data directory after migration: '{}'",
                legacy_dir.display()
            );
        }
        Err(err) if err.kind() == ErrorKind::DirectoryNotEmpty => {
            log::warn!(
                "Legacy app data directory still has entries after migration: '{}'",
                legacy_dir.display()
            );
        }
        Err(err) => {
            log::warn!(
                "Failed to remove legacy app data directory '{}': {}",
                legacy_dir.display(),
                err
            );
        }
    }

    Ok(())
}

fn migrate_legacy_non_windows_config_dir(base_config_dir: &Path, config_dir: &Path) -> Result<()> {
    if cfg!(target_os = "windows") {
        return Ok(());
    }

    let legacy_dir = base_config_dir.join(".VestaLauncher");
    if !legacy_dir.exists() {
        return Ok(());
    }

    if config_dir.exists() {
        migrate_missing_legacy_entries(&legacy_dir, config_dir)?;
        return Ok(());
    }

    match std::fs::rename(&legacy_dir, config_dir) {
        Ok(()) => {
            log::info!(
                "Migrated app data directory from '{}' to '{}'",
                legacy_dir.display(),
                config_dir.display()
            );
        }
        Err(err) => {
            // Another caller may have already moved the directory.
            if config_dir.exists() && !legacy_dir.exists() {
                log::info!(
                    "App data directory migration already completed by another caller for '{}'",
                    config_dir.display()
                );
                return Ok(());
            }

            return Err(anyhow::anyhow!(
                "Failed to migrate app data directory from '{}' to '{}': {}",
                legacy_dir.display(),
                config_dir.display(),
                err
            ));
        }
    }

    Ok(())
}

/// Get the application's config directory.
/// - Windows: `%APPDATA%/.VestaLauncher`
/// - macOS: `~/Library/Application Support/VestaLauncher`
/// - Linux: `~/.config/VestaLauncher`
///
/// On non-Windows platforms, this migrates the legacy `.VestaLauncher` folder
/// to `VestaLauncher` when needed.
pub fn get_app_config_dir() -> Result<PathBuf> {
    let base_dirs = BaseDirs::new()
        .ok_or_else(|| anyhow::anyhow!("Failed to determine user's config directory"))?;

    let base_config_dir = base_dirs.config_dir();
    let config_dir = base_config_dir.join(app_config_folder_name());

    migrate_legacy_non_windows_config_dir(base_config_dir, &config_dir)?;

    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir)?;
    }

    Ok(config_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "vesta-db-manager-{}-{}-{}",
            label,
            std::process::id(),
            timestamp
        ))
    }

    #[test]
    fn migrate_missing_legacy_entries_moves_files_and_removes_legacy_dir() {
        let root = unique_temp_dir("moves");
        let legacy_dir = root.join(".VestaLauncher");
        let target_dir = root.join("VestaLauncher");

        fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        fs::create_dir_all(&target_dir).expect("create target dir");
        fs::write(legacy_dir.join("app_config.db"), b"legacy-config").expect("write legacy db");

        migrate_missing_legacy_entries(&legacy_dir, &target_dir).expect("migrate legacy entries");

        assert!(target_dir.join("app_config.db").exists());
        assert!(!legacy_dir.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_missing_legacy_entries_does_not_overwrite_existing_files() {
        let root = unique_temp_dir("preserve");
        let legacy_dir = root.join(".VestaLauncher");
        let target_dir = root.join("VestaLauncher");

        fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        fs::create_dir_all(&target_dir).expect("create target dir");
        fs::write(legacy_dir.join("app_config.db"), b"legacy-config").expect("write legacy db");
        fs::write(target_dir.join("app_config.db"), b"target-config").expect("write target db");

        migrate_missing_legacy_entries(&legacy_dir, &target_dir).expect("migrate legacy entries");

        let contents = fs::read(target_dir.join("app_config.db")).expect("read target db");
        assert_eq!(contents, b"target-config");
        assert!(legacy_dir.exists());

        let _ = fs::remove_dir_all(&root);
    }
}
