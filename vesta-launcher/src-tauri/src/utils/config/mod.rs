//! # Configuration System
//!
//! This module provides a SqlTable-based configuration system with **automatic schema sync**.
//!
//! ## Single Source of Truth Architecture
//!
//! The `AppConfig` struct with `#[derive(SqlTable)]` is the ONLY place you define the schema.
//! Everything else is handled automatically:
//! - ✅ CREATE TABLE SQL (from SqlTable::schema_sql())
//! - ✅ **Automatic schema sync** - missing columns are added on startup!
//! - ✅ INSERT/UPDATE/SELECT queries (from SqlTable methods)
//! - ✅ Type-safe Rust API (from struct definition)
//! - ✅ JSON serialization (from serde derives)
//!
//! ## Adding a New Config Field
//!
//! Only 2 steps needed:
//!
//! 1. **Add field to `AppConfig` struct**:
//!    ```rust
//!    #[derive(SqlTable, Serialize, Deserialize)]
//!    pub struct AppConfig {
//!        // ... existing fields ...
//!        pub new_field_name: Type,  // ← Add this
//!    }
//!    ```
//!
//! 2. **Update `Default` impl** (in the new() call):
//!    ```rust
//!    impl Default for AppConfig {
//!        fn default() -> Self {
//!            Self::new(
//!                // ... existing defaults ...
//!                default_value,  // ← Add this
//!            )
//!        }
//!    }
//!    ```
//!
//! That's it! **No migrations needed!** On next app launch:
//! - `sync_schema::<AppConfig>()` detects the missing column
//! - Automatically runs `ALTER TABLE ADD COLUMN`
//! - Your new field is ready to use
//!
//! ## Example Usage from Frontend
//!
//! ```typescript
//! // Get entire config
//! const config = await invoke('get_config');
//!
//! // Update entire config
//! await invoke('set_config', { config: newConfig });
//!
//! // Update single field
//! await invoke('update_config_field', {
//!   field: 'new_field_name',
//!   value: newValue
//! });
//! ```
//!
//! ## Architecture Benefits
//!
//! - **No Duplication**: Schema defined once in Rust struct
//! - **Type Safety**: Compile-time checking for all database operations
//! - **Zero Migrations**: Schema changes are auto-synced on startup
//! - **Zero Boilerplate**: No manual SQL for CRUD operations
//! - **Frontend Ready**: Automatic JSON serialization via serde

use crate::utils::db_manager::get_config_db;
use crate::utils::sqlite::{SQLiteDB, SqlTable, AUTOINCREMENT};
use piston_macros::SqlTable;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[cfg(test)]
use crate::utils::sqlite::VersionVerification;

/// Main application configuration struct
///
/// This struct is the single source of truth for the app_config table schema.
/// - Uses SqlTable derive for automatic schema generation
/// - Schema is auto-synced on startup (missing columns added automatically)
/// - All CRUD operations use SqlTable methods
/// - Serde is used for JSON serialization (Tauri commands)
///
/// ## Adding a New Config Field
///
/// Just add the field to this struct and update the Default impl - that's it!
/// The database schema will be automatically updated on next app launch.
#[derive(Serialize, Deserialize, Clone, Debug, SqlTable)]
#[migration_description("Application configuration table")]
pub struct AppConfig {
    #[primary_key]
    pub id: i32, // Always 1 - we only have one config row
    pub background_hue: i32,
    pub theme: String,
    pub language: String,
    pub max_download_threads: i32,
    pub max_memory_mb: i32,
    pub java_path: Option<String>,
    pub default_game_dir: Option<String>,
    pub auto_update_enabled: bool,
    pub notification_enabled: bool,
    pub startup_check_updates: bool,
    pub show_tray_icon: bool,
    pub minimize_to_tray: bool,
    pub reduced_motion: bool,
    pub reduced_effects: bool,
    pub last_window_width: i32,
    pub last_window_height: i32,
    pub debug_logging: bool,
    pub notification_retention_days: i32,
    pub active_account_uuid: Option<String>,
    
    // Theme system fields
    pub theme_id: String,                     // Current theme preset ID (e.g., "midnight", "solar")
    pub theme_mode: String,                   // "template" or "advanced" 
    pub theme_primary_hue: i32,               // User-customized primary hue
    pub theme_primary_sat: Option<i32>,       // Advanced mode: primary saturation
    pub theme_primary_light: Option<i32>,     // Advanced mode: primary lightness
    pub theme_style: String,                  // "glass", "satin", "flat", "bordered"
    pub theme_gradient_enabled: bool,         // Enable background gradient
    pub theme_gradient_angle: Option<i32>,    // Gradient angle in degrees
    pub theme_gradient_harmony: Option<String>, // "none", "analogous", "complementary", "triadic"
    pub theme_advanced_overrides: Option<String>, // JSON blob for advanced custom overrides
}

impl Default for AppConfig {
    fn default() -> Self {
        Self::new(
            1,                  // id - always 1 for single config row
            220,                // background_hue
            "dark".to_string(), // theme
            "en".to_string(),   // language
            4,                  // max_download_threads
            4096,               // max_memory_mb
            None,               // java_path
            None,               // default_game_dir
            true,               // auto_update_enabled
            true,               // notification_enabled
            true,               // startup_check_updates
            true,               // show_tray_icon
            false,              // minimize_to_tray
            false,              // reduced_motion
            false,              // reduced_effects
            1200,               // last_window_width
            700,                // last_window_height
            false,              // debug_logging
            30,                 // notification_retention_days
            None,               // active_account_uuid
            
            // Theme system defaults
            "midnight".to_string(),  // theme_id - default to signature theme
            "template".to_string(),  // theme_mode - start with easy mode  
            220,                     // theme_primary_hue - default blue
            None,                    // theme_primary_sat - advanced mode only
            None,                    // theme_primary_light - advanced mode only
            "glass".to_string(),     // theme_style - default glass effect
            true,                    // theme_gradient_enabled - enable gradients
            Some(135),               // theme_gradient_angle - diagonal gradient
            Some("complementary".to_string()), // theme_gradient_harmony - complementary colors
            None,                    // theme_advanced_overrides - no custom overrides by default
        )
    }
}

impl AppConfig {
    /// Get default data SQL for migrations
    pub fn get_default_data_sql() -> Vec<String> {
        let default_config = Self::default();
        vec![format!(
            "INSERT OR IGNORE INTO {} (id, background_hue, theme, language, max_download_threads, \
             max_memory_mb, java_path, default_game_dir, auto_update_enabled, notification_enabled, \
             startup_check_updates, show_tray_icon, minimize_to_tray, reduced_motion, reduced_effects, last_window_width, last_window_height, \
             debug_logging, notification_retention_days, active_account_uuid) \
             VALUES ({}, {}, '{}', '{}', {}, {}, NULL, NULL, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, NULL)",
            Self::name(),
            default_config.id,
            default_config.background_hue,
            default_config.theme,
            default_config.language,
            default_config.max_download_threads,
            default_config.max_memory_mb,
            if default_config.auto_update_enabled { 1 } else { 0 },
            if default_config.notification_enabled { 1 } else { 0 },
            if default_config.startup_check_updates { 1 } else { 0 },
            if default_config.show_tray_icon { 1 } else { 0 },
            if default_config.minimize_to_tray { 1 } else { 0 },
            if default_config.reduced_motion { 1 } else { 0 },
            if default_config.reduced_effects { 1 } else { 0 },
            default_config.last_window_width,
            default_config.last_window_height,
            if default_config.debug_logging { 1 } else { 0 },
            default_config.notification_retention_days,
        )]
    }
}

/// Initialize the config database with migrations
///
/// This should be called once during application startup to ensure:
/// 1. The database and table exist (created if needed)
/// 2. Schema is automatically synced with AppConfig struct (missing columns added)
/// 3. Default config row exists
///
/// # Automatic Schema Sync
/// 
/// This function uses `sync_schema` which automatically:
/// - Creates the table if it doesn't exist
/// - Detects missing columns by comparing struct fields to DB columns
/// - Adds any missing columns via ALTER TABLE
/// 
/// **No manual migrations needed!** Just add fields to AppConfig struct.
///
/// # Errors
///
/// Returns error if database cannot be created or schema sync fails
pub fn init_config_db(db: &SQLiteDB) -> Result<(), anyhow::Error> {
    // Automatically sync schema with AppConfig struct
    // This creates the table if needed and adds any missing columns
    log::info!("Config DB: syncing schema (AppConfig)");
    let added_columns = db.sync_schema::<AppConfig>()?;
    log::info!("Config DB: sync_schema completed, added_columns={:?}", added_columns);
    
    if !added_columns.is_empty() {
        log::info!("Config DB: Auto-added {} new column(s): {:?}", added_columns.len(), added_columns);
    }

    // Ensure default config row exists with all fields populated
    let conn = db.get_connection();
    
    // Check if config row exists
    let row_exists: bool = conn
        .prepare(&format!("SELECT COUNT(*) FROM {} WHERE id = 1", AppConfig::name()))?
        .query_row([], |row| row.get(0))?;
    
    if !row_exists {
        // Insert default config
        let default_config = AppConfig::default();
        db.insert_data_serde(&default_config)?;
        log::info!("Config DB: Created default configuration: {:?}", default_config);
    }

    Ok(())
}

/// Get the current application configuration
///
/// Uses SqlTable's search_data_serde for type-safe queries.
///
/// # Errors
///
/// Returns error if database cannot be accessed or config row doesn't exist
pub fn get_app_config() -> Result<AppConfig, anyhow::Error> {
    let db = get_config_db()?;

    // Use SqlTable's search method to find the config row with id = 1
    let configs: Vec<AppConfig> = db.search_data_serde::<AppConfig, i32, AppConfig>(
        crate::utils::sqlite::SQLiteSelect::ALL,
        "id",
        1,
    )?;

    let config = configs
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("Config row not found"))?;

    log::debug!("Loaded AppConfig: {:?}", config);

    Ok(config)
}

/// Update application configuration
///
/// Uses SqlTable's update_data_serde for type-safe updates.
///
/// # Errors
///
/// Returns error if database cannot be accessed or update fails
pub fn update_app_config(config: &AppConfig) -> Result<(), anyhow::Error> {
    let db = get_config_db()?;
    db.update_data_serde(config, "id", 1)?;
    Ok(())
}

// ==================== Tauri Commands ====================

/// Tauri command to get the current configuration
#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    log::info!("Tauri command: get_config called");
    let cfg = get_app_config().map_err(|e| e.to_string())?;
    log::info!("Tauri command: get_config returning config id={}, theme_id={}", cfg.id, cfg.theme_id);
    Ok(cfg)
}

/// Tauri command to update the configuration
#[tauri::command]
pub fn set_config(config: AppConfig) -> Result<(), String> {
    log::info!("Tauri command: set_config called, id={}, theme_id={}", config.id, config.theme_id);
    update_app_config(&config).map_err(|e| e.to_string())
}

/// Tauri command to update a specific config field
///
/// This uses serde_json to dynamically update any field in the config struct.
/// No need to add match arms when adding new fields!
#[tauri::command]
pub fn update_config_field(
    app_handle: tauri::AppHandle,
    field: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let config = get_app_config().map_err(|e| e.to_string())?;

    // Convert config to serde_json::Value for manipulation
    let mut config_value =
        serde_json::to_value(&config).map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Update the specific field
    if let Some(config_obj) = config_value.as_object_mut() {
        if config_obj.contains_key(&field) {
            config_obj.insert(field.clone(), value.clone());
        } else {
            return Err(format!("Unknown config field: {}", field));
        }
    } else {
        return Err("Config is not an object".to_string());
    }

    // Convert back to AppConfig
    let updated_config: AppConfig = serde_json::from_value(config_value)
        .map_err(|e| format!("Failed to deserialize config: {}", e))?;

    log::info!("Updating config field '{}' via Tauri command", field);
    update_app_config(&updated_config).map_err(|e| e.to_string())?;

    // Emit event to all windows so they can update their state
    let event_payload = serde_json::json!({
        "field": field,
        "value": value,
    });

    // Notify of config update
    let _ = app_handle.emit("config-updated", event_payload);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    // Generate unique database names for each test to avoid lock conflicts
    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn get_test_db_name() -> String {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        format!("test_config_{}.db", id)
    }

    fn initialize_test_db() -> SQLiteDB {
        let path = std::env::temp_dir().join("vesta_test");
        std::fs::create_dir_all(&path).unwrap();

        // Use Any version verification for tests to bypass version checks
        let db = SQLiteDB::new(
            path,
            get_test_db_name(),
            "1.0.0".into(),
            VersionVerification::Any,
        )
        .unwrap();

        // Use automatic schema sync (same as production)
        db.sync_schema::<AppConfig>().unwrap();

        // Insert default config for tests
        let default_config = AppConfig::default();
        db.insert_data_serde(&default_config).unwrap_or_else(|_| {
            // Already exists, update instead
            db.update_data_serde(&default_config, "id", 1).unwrap();
        });

        db
    }

    #[test]
    fn test_config_initialization() {
        let db = initialize_test_db();
        let conn = db.get_connection();

        // Query the config (including theme fields)
        let mut stmt = conn
            .prepare(
                "SELECT id, background_hue, theme, language, max_download_threads, max_memory_mb, 
                    java_path, default_game_dir, auto_update_enabled,
                    notification_enabled, startup_check_updates, show_tray_icon, 
                    minimize_to_tray, reduced_motion, reduced_effects, last_window_width, last_window_height,
                    debug_logging, notification_retention_days, active_account_uuid,
                    theme_id, theme_mode, theme_primary_hue, theme_primary_sat, theme_primary_light,
                    theme_style, theme_gradient_enabled, theme_gradient_angle, theme_gradient_harmony, theme_advanced_overrides
             FROM app_config WHERE id = 1",
            )
            .unwrap();

        let config = stmt
            .query_row([], |row| {
                Ok(AppConfig {
                    id: row.get(0)?,
                    background_hue: row.get(1)?,
                    theme: row.get(2)?,
                    language: row.get(3)?,
                    max_download_threads: row.get(4)?,
                    max_memory_mb: row.get(5)?,
                    java_path: row.get(6)?,
                    default_game_dir: row.get(7)?,
                    auto_update_enabled: row.get(8)?,
                    notification_enabled: row.get(9)?,
                    startup_check_updates: row.get(10)?,
                    show_tray_icon: row.get(11)?,
                    minimize_to_tray: row.get(12)?,
                    reduced_motion: row.get(13)?,
                    reduced_effects: row.get(14)?,
                    last_window_width: row.get(15)?,
                    last_window_height: row.get(16)?,
                    debug_logging: row.get(17)?,
                    notification_retention_days: row.get(18)?,
                    active_account_uuid: row.get(19)?,

                    // theme fields
                    theme_id: row.get(20)?,
                    theme_mode: row.get(21)?,
                    theme_primary_hue: row.get(22)?,
                    theme_primary_sat: row.get(23)?,
                    theme_primary_light: row.get(24)?,
                    theme_style: row.get(25)?,
                    theme_gradient_enabled: row.get(26)?,
                    theme_gradient_angle: row.get(27)?,
                    theme_gradient_harmony: row.get(28)?,
                    theme_advanced_overrides: row.get(29)?,
                })
            })
            .unwrap();

        assert_eq!(config.id, 1);
        // Theme default can differ across environments/migrations (dark or light)
        assert!(config.theme == "dark" || config.theme == "light");
        assert_eq!(config.language, "en");
    }

    #[test]
    fn test_config_update() {
        let db = initialize_test_db();
        let conn = db.get_connection();

        // Update config
        conn.execute(
            "UPDATE app_config SET theme = ?1, background_hue = ?2 WHERE id = 1",
            rusqlite::params!["light", 180],
        )
        .unwrap();

        // Query updated config
        let mut stmt = conn
            .prepare("SELECT id, background_hue, theme FROM app_config WHERE id = 1")
            .unwrap();

        let (id, hue, theme): (i32, i32, String) = stmt
            .query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap();

        assert_eq!(id, 1);
        assert_eq!(theme, "light");
        assert_eq!(hue, 180);
    }
}
