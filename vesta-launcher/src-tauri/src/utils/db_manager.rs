//! Database Manager
//! 
//! Centralized database management for the Vesta Launcher.
//! 
//! ## Database Architecture
//! 
//! This application uses **two separate SQLite databases**:
//! 
//! ### 1. Config Database (`app_config.db`)
//! - **Purpose**: Application configuration and settings
//! - **Tables**: 
//!   - `app_config` - User preferences, UI settings, system config
//!   - `schema_migrations` - Migration version tracking
//! - **Characteristics**:
//!   - Single-row table (id = 1)
//!   - Frequently read/written
//!   - Small data size
//!   - Critical for app initialization
//! 
//! ### 2. Data Database (`vesta.db`)
//! - **Purpose**: User data and application state
//! - **Tables**:
//!   - `instance` - Minecraft instances
//!   - `account` - Microsoft accounts
//!   - `notification` - Notification history
//!   - `schema_migrations` - Migration version tracking
//! - **Characteristics**:
//!   - Multi-row tables with dynamic data
//!   - Can grow large over time
//!   - User-generated content
//!   - Can be backed up/restored independently
//! 
//! ## Why Separate Databases?
//! 
//! 1. **Separation of Concerns**: Config is system-level, data is user-level
//! 2. **Backup Strategy**: Users can backup `vesta.db` without config
//! 3. **Reset Safety**: Can reset config without losing user data
//! 4. **Migration Independence**: Config schema changes don't affect data
//! 5. **Performance**: Smaller config DB loads faster on startup
//! 
//! ## Usage Examples
//! 
//! ```rust
//! use crate::utils::db_manager::{get_config_db, get_data_db};
//! 
//! // Get config database (for app settings)
//! let config_db = get_config_db()?;
//! 
//! // Get data database (for instances, accounts, notifications)
//! let data_db = get_data_db()?;
//! ```

use std::path::PathBuf;
use anyhow::Result;
use directories::BaseDirs;
use crate::utils::sqlite::{SQLiteDB, VersionVerification};

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

/// Get the **config database** connection (app_config.db)
/// 
/// This database contains application settings and preferences.
/// 
/// # Note
/// This does NOT run migrations. Use `initialize_config_db()` for full setup.
pub fn get_config_db() -> Result<SQLiteDB> {
    let path = get_app_config_dir()?;
    let db = SQLiteDB::new(
        path,
        "app_config.db".into(),
        env!("CARGO_PKG_VERSION").into(),
        VersionVerification::LessOrEqual
    )?;
    Ok(db)
}

/// Get the **data database** connection (vesta.db)
/// 
/// This database contains user data: instances, accounts, notifications.
/// 
/// # Note
/// This does NOT run migrations. Use `initialize_data_db()` for full setup.
pub fn get_data_db() -> Result<SQLiteDB> {
    let path = get_app_config_dir()?;
    let db = SQLiteDB::new(
        path,
        "vesta.db".into(),
        env!("CARGO_PKG_VERSION").into(),
        VersionVerification::LessOrEqual
    )?;
    Ok(db)
}
