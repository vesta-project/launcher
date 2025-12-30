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

use crate::utils::config::init_config_db;
use crate::utils::data::init_data_db;
use crate::utils::sqlite::{SQLiteDB, VersionVerification};
use anyhow::Result;
use directories::BaseDirs;
use std::path::PathBuf;
use std::sync::{Mutex, Once};

/// One-time initialization guards for databases
static CONFIG_DB_INIT: Once = Once::new();
static DATA_DB_INIT: Once = Once::new();

/// Store initialization results
static CONFIG_INIT_RESULT: Mutex<Option<Result<(), String>>> = Mutex::new(None);
static DATA_INIT_RESULT: Mutex<Option<Result<(), String>>> = Mutex::new(None);

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

/// Internal helper to create a raw DB connection without initialization
fn create_raw_db(name: &str) -> Result<SQLiteDB> {
    let path = get_app_config_dir()?;
    // Use Any to skip version verification - migrations handle schema versioning
    SQLiteDB::new(
        path,
        name.into(),
        env!("CARGO_PKG_VERSION").into(),
        VersionVerification::Any,
    )
}

/// Get the **config database** connection (app_config.db)
///
/// This database contains application settings and preferences.
///
/// **Auto-initializes on first access**: Runs migrations automatically if not yet initialized.
pub fn get_config_db() -> Result<SQLiteDB> {
    // Lazy initialization: run migrations on first access using Once
    // Once::call_once ensures this runs exactly once, even with multiple threads
    CONFIG_DB_INIT.call_once(|| {
        log::info!("Config DB: Initialization starting...");
        let result = (|| -> Result<()> {
            let db = create_raw_db("app_config.db")?;
            init_config_db(&db)?;
            Ok(())
        })()
        .map_err(|e| e.to_string());

        log::info!("Config DB: Initialization finished: {:?}", result);
        let mut init_result = CONFIG_INIT_RESULT.lock().unwrap();
        *init_result = Some(result);
    });

    // Check if initialization succeeded
    let init_result = CONFIG_INIT_RESULT.lock().unwrap();
    if let Some(Err(e)) = init_result.as_ref() {
        return Err(anyhow::anyhow!(
            "Config database initialization failed: {}",
            e
        ));
    }

    // Return fresh connection
    create_raw_db("app_config.db")
}

/// Get the **data database** connection (vesta.db)
///
/// This database contains user data: instances, accounts, notifications.
///
/// **Auto-initializes on first access**: Runs migrations automatically if not yet initialized.
pub fn get_data_db() -> Result<SQLiteDB> {
    // Lazy initialization: run migrations on first access using Once
    // Once::call_once ensures this runs exactly once, even with multiple threads
    DATA_DB_INIT.call_once(|| {
        log::info!("Data DB: Initialization starting...");
        let result = (|| -> Result<()> {
            let db = create_raw_db("vesta.db")?;
            init_data_db(&db)?;
            Ok(())
        })()
        .map_err(|e| e.to_string());

        log::info!("Data DB: Initialization finished: {:?}", result);
        let mut init_result = DATA_INIT_RESULT.lock().unwrap();
        *init_result = Some(result);
    });

    // Check if initialization succeeded
    let init_result = DATA_INIT_RESULT.lock().unwrap();
    if let Some(Err(e)) = init_result.as_ref() {
        return Err(anyhow::anyhow!(
            "Data database initialization failed: {}",
            e
        ));
    }

    // Return fresh connection
    create_raw_db("vesta.db")
}
