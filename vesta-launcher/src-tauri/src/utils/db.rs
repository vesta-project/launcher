// Database connection management using Diesel with r2d2 connection pooling

use diesel::prelude::*;
use diesel::r2d2::{self, ConnectionManager, Pool};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

// Embed migrations at compile time
pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

// Global connection pools
lazy_static::lazy_static! {
    static ref VESTA_POOL: Arc<Mutex<Option<DbPool>>> = Arc::new(Mutex::new(None));
    static ref CONFIG_POOL: Arc<Mutex<Option<DbPool>>> = Arc::new(Mutex::new(None));
}

/// Initialize the vesta.db connection pool
pub fn init_vesta_pool(path: PathBuf) -> Result<(), anyhow::Error> {
    let db_path = path.join("vesta.db");
    let url = format!("file:{}", db_path.display());

    let manager = ConnectionManager::<SqliteConnection>::new(url);
    let pool = Pool::builder().max_size(16).build(manager)?;

    // Run migrations
    let mut conn = pool.get()?;
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;

    println!(
        "✓ Vesta database initialized with {} pending migrations",
        conn.pending_migrations(MIGRATIONS)
            .map(|m| m.len())
            .unwrap_or(0)
    );

    *VESTA_POOL.lock().unwrap() = Some(pool);
    Ok(())
}

/// Initialize the app_config.db connection pool
pub fn init_config_pool(path: PathBuf) -> Result<(), anyhow::Error> {
    let db_path = path.join("app_config.db");
    let url = format!("file:{}", db_path.display());

    let manager = ConnectionManager::<SqliteConnection>::new(url);
    let pool = Pool::builder().max_size(4).build(manager)?;

    // Run migrations (same migrations, they'll check if tables exist)
    let mut conn = pool.get()?;
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| anyhow::anyhow!("Config migration failed: {}", e))?;

    println!("✓ Config database initialized");

    *CONFIG_POOL.lock().unwrap() = Some(pool);
    Ok(())
}

/// Get a connection from the vesta.db pool
pub fn get_vesta_conn(
) -> Result<r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, anyhow::Error> {
    VESTA_POOL
        .lock()
        .unwrap()
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Vesta database pool not initialized"))?
        .get()
        .map_err(|e| anyhow::anyhow!("Failed to get vesta connection: {}", e))
}

/// Get a connection from the app_config.db pool
pub fn get_config_conn(
) -> Result<r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, anyhow::Error> {
    CONFIG_POOL
        .lock()
        .unwrap()
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Config database pool not initialized"))?
        .get()
        .map_err(|e| anyhow::anyhow!("Failed to get config connection: {}", e))
}

/// Get the vesta database pool (for advanced usage)
pub fn get_vesta_pool() -> Result<DbPool, anyhow::Error> {
    VESTA_POOL
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Vesta database pool not initialized"))
}

/// Get the config database pool (for advanced usage)
pub fn get_config_pool() -> Result<DbPool, anyhow::Error> {
    CONFIG_POOL
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Config database pool not initialized"))
}
