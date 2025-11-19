//! Data Database Initialization
//! 
//! Manages the data database (vesta.db) which contains:
//! - Minecraft instances
//! - User accounts
//! - Notification history

use anyhow::Result;
use crate::utils::sqlite::SQLiteDB;
use crate::utils::migrations::get_data_migrations;
use crate::utils::db_manager::get_data_db;

/// Initialize the data database with migrations
/// 
/// This should be called once during application startup to ensure:
/// 1. The database exists and is created if needed
/// 2. All data migrations are run to bring schema up to date
/// 
/// # Errors
/// 
/// Returns error if database cannot be created or migrations fail
pub fn init_data_db(db: &SQLiteDB) -> Result<()> {
    // Run DATA migrations only
    let migrations = get_data_migrations();
    db.run_migrations(migrations, env!("CARGO_PKG_VERSION"))?;

    Ok(())
}
