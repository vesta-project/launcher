//! Database Manager
//!
//! Helper functions for database paths.
//! Legacy database initialization has been replaced by Diesel `utils::db`.

use anyhow::Result;
use directories::BaseDirs;
use std::path::PathBuf;

/// Get the application's config directory (~/.VestaLauncher or %APPDATA%/.VestaLauncher)
pub fn get_app_config_dir() -> Result<PathBuf> {
    let base_dirs = BaseDirs::new()
        .ok_or_else(|| anyhow::anyhow!("Failed to determine user's config directory"))?;

    let config_dir = base_dirs.config_dir().join(".VestaLauncher");

    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir)?;
    }

    Ok(config_dir)
}
