use super::Migration;
use crate::models::{Account, Instance, Notification, UserVersionTracking};
use crate::utils::config::AppConfig;
use crate::utils::sqlite::SqlTable;

/// Generate a migration from a SqlTable implementation
/// This is the single source of truth - the struct defines the schema!
pub fn migration_from_sqltable<T: SqlTable>() -> Migration {
    let version = T::migration_version();
    let description = T::migration_description();
    let create_sql = T::schema_sql();
    let default_data = T::default_data_sql();

    let mut up_sql = vec![create_sql];
    up_sql.extend(default_data);

    let down_sql = vec![format!("DROP TABLE IF EXISTS {}", T::name())];

    Migration {
        version,
        description,
        up_sql,
        down_sql,
    }
}

// ============================================================================
// CONFIG DATABASE MIGRATIONS (app_config.db)
// ============================================================================
// These migrations manage application settings and preferences

/// Migration 001: Initial schema setup for config database
fn migration_001_config_initial_schema() -> Migration {
    Migration {
        version: "0.1.0".to_string(),
        description: "Initial config database schema with migration tracking".to_string(),
        up_sql: vec![
            // Migration tracking table (created automatically by runner, but included for clarity)
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )"
            .to_string(),
        ],
        down_sql: vec!["DROP TABLE IF EXISTS schema_migrations".to_string()],
    }
}

/// Migration 002: App configuration table
fn migration_002_app_config() -> Migration {
    let schema_sql = AppConfig::schema_sql();
    let default_data = AppConfig::get_default_data_sql();

    let mut up_sql = vec![schema_sql];
    up_sql.extend(default_data);

    Migration {
        version: AppConfig::migration_version(),
        description: AppConfig::migration_description(),
        up_sql,
        down_sql: vec![format!("DROP TABLE IF EXISTS {}", AppConfig::name())],
    }
}

/// Get all **config database** migrations in order
pub fn get_config_migrations() -> Vec<Migration> {
    vec![
        migration_001_config_initial_schema(),
        migration_002_app_config(),
        migration_003_reduced_motion_setting(),
    ]
}

/// Migration 003: Add reduced_motion toggle to app_config
/// NOTE: This migration exists for databases created before reduced_motion was added to AppConfig.
/// For new databases, the column already exists from migration_002's CREATE TABLE.
/// The migration runner will skip this if already applied or if column exists.
fn migration_003_reduced_motion_setting() -> Migration {
    Migration {
        version: "0.3.0".to_string(),
        description: "Add reduced_motion setting to app_config".to_string(),
        // Empty up_sql since schema_sql() now includes reduced_motion
        // This migration is kept for version tracking on databases that already have it applied
        up_sql: vec![],
        down_sql: vec![],
    }
}

// ============================================================================
// DATA DATABASE MIGRATIONS (vesta.db)
// ============================================================================
// These migrations manage user data: instances, accounts, notifications

/// Migration 001: Initial schema setup for data database
fn migration_001_data_initial_schema() -> Migration {
    Migration {
        version: "0.1.0".to_string(),
        description: "Initial data database schema with migration tracking".to_string(),
        up_sql: vec![
            // Migration tracking table (created automatically by runner, but included for clarity)
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )"
            .to_string(),
        ],
        down_sql: vec!["DROP TABLE IF EXISTS schema_migrations".to_string()],
    }
}

/// Migration 002: Instances table for Minecraft instances
fn migration_002_instances_table() -> Migration {
    let schema_sql = Instance::schema_sql();
    let indices = Instance::get_indices();
    let drop_indices = Instance::get_drop_indices();

    let mut up_sql = vec![schema_sql];
    up_sql.extend(indices);

    let mut down_sql = drop_indices;
    down_sql.push(format!("DROP TABLE IF EXISTS {}", Instance::name()));

    Migration {
        version: Instance::migration_version(),
        description: Instance::migration_description(),
        up_sql,
        down_sql,
    }
}

/// Migration 003: Accounts table for Microsoft authentication
fn migration_003_accounts_table() -> Migration {
    let schema_sql = Account::schema_sql();
    let indices = Account::get_indices();
    let drop_indices = Account::get_drop_indices();

    let mut up_sql = vec![schema_sql];
    up_sql.extend(indices);

    let mut down_sql = drop_indices;
    down_sql.push(format!("DROP TABLE IF EXISTS {}", Account::name()));

    Migration {
        version: Account::migration_version(),
        description: Account::migration_description(),
        up_sql,
        down_sql,
    }
}

/// Migration 004: Notifications table for persistent and ephemeral notifications
fn migration_004_notifications_table() -> Migration {
    let schema_sql = Notification::schema_sql();
    let indices = Notification::get_indices();
    let drop_indices = Notification::get_drop_indices();

    let mut up_sql = vec![schema_sql];
    up_sql.extend(indices);

    let mut down_sql = drop_indices;
    down_sql.push(format!("DROP TABLE IF EXISTS {}", Notification::name()));

    Migration {
        version: Notification::migration_version(),
        description: Notification::migration_description(),
        up_sql,
        down_sql,
    }
}

/// Migration 005: User version tracking for update notifications
fn migration_005_user_version_tracking_table() -> Migration {
    let schema_sql = UserVersionTracking::schema_sql();
    let indices = UserVersionTracking::get_indices();
    let drop_indices = UserVersionTracking::get_drop_indices();

    let mut up_sql = vec![schema_sql];
    up_sql.extend(indices);

    let mut down_sql = drop_indices;
    down_sql.push(format!("DROP TABLE IF EXISTS {}", UserVersionTracking::name()));

    Migration {
        version: UserVersionTracking::migration_version(),
        description: UserVersionTracking::migration_description(),
        up_sql,
        down_sql,
    }
}

/// Migration 006: Crash detection and tracking
/// NOTE: This migration exists for databases created before crashed/crash_details were added to Instance.
/// For new databases, the columns already exist from migration_002's CREATE TABLE (via Instance::schema_sql()).
/// The migration runner will skip this if already applied or if columns exist.
fn migration_006_crash_tracking() -> Migration {
    Migration {
        version: "0.7.1".to_string(),
        description: "Add crash detection columns to instance table".to_string(),
        // Empty up_sql since Instance struct now includes crashed/crash_details
        // and schema_sql() generates CREATE TABLE with all current fields
        up_sql: vec![],
        down_sql: vec![],
    }
}

/// Get all **data database** migrations in order
pub fn get_data_migrations() -> Vec<Migration> {
    vec![
        migration_001_data_initial_schema(),
        migration_002_instances_table(),
        migration_003_accounts_table(),
        migration_004_notifications_table(),
        migration_005_user_version_tracking_table(),
        migration_006_crash_tracking(),
    ]
}

/// Legacy function for backwards compatibility
///
/// # Deprecated
/// Use `get_config_migrations()` for app_config.db or `get_data_migrations()` for vesta.db instead
#[deprecated(note = "Use get_config_migrations() or get_data_migrations() instead")]
pub fn get_all_migrations() -> Vec<Migration> {
    // Return data migrations for backwards compatibility
    // (config migrations should be run separately via initialize_config_db)
    get_data_migrations()
}
