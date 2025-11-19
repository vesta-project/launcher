use super::Migration;
use crate::utils::sqlite::SqlTable;
use crate::utils::config::AppConfig;
use crate::models::{Instance, Account, Notification};

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
            )".to_string(),
        ],
        down_sql: vec![
            "DROP TABLE IF EXISTS schema_migrations".to_string(),
        ],
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
    ]
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
            )".to_string(),
        ],
        down_sql: vec![
            "DROP TABLE IF EXISTS schema_migrations".to_string(),
        ],
    }
}

/// Migration 003: Instances table for Minecraft instances

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

/// Migration 004: Accounts table for Microsoft authentication

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

/// Migration 005: Notifications table for persistent and ephemeral notifications
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

/// Get all **data database** migrations in order
pub fn get_data_migrations() -> Vec<Migration> {
    vec![
        migration_001_data_initial_schema(),
        migration_002_instances_table(),
        migration_003_accounts_table(),
        migration_004_notifications_table(),
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

