// Database connection management using Diesel with r2d2 connection pooling

use diesel::prelude::*;
use diesel::r2d2::{self, ConnectionManager, Pool};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

#[derive(Debug)]
struct SqliteCustomizer;

impl r2d2::CustomizeConnection<SqliteConnection, r2d2::Error> for SqliteCustomizer {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), r2d2::Error> {
        use diesel::connection::SimpleConnection;
        conn.batch_execute("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
            .map_err(r2d2::Error::QueryError)?;
        Ok(())
    }
}

// Embed migrations at compile time
pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("../../migrations");
// Separate migration sets for different databases
pub const VESTA_MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations/vesta");
pub const CONFIG_MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations/config");

#[tauri::command]
pub fn get_db_status() -> Result<serde_json::Value, String> {
    let mut status = serde_json::json!({});

    // Check Vesta (vesta.db)
    if let Ok(mut conn) = get_vesta_conn() {
        let tables = get_tables(&mut conn);
        status["vesta"] = serde_json::json!({
            "tables": tables,
        });
    }

    // Check Config (app_config.db)
    if let Ok(mut conn) = get_config_conn() {
        let tables = get_tables(&mut conn);
        status["config"] = serde_json::json!({
            "tables": tables,
        });
    }

    Ok(status)
}

fn get_tables(conn: &mut SqliteConnection) -> Vec<String> {
    use diesel::sql_query;
    use diesel::RunQueryDsl;

    #[derive(QueryableByName)]
    struct TableName {
        #[diesel(sql_type = diesel::sql_types::Text)]
        name: String,
    }

    sql_query("SELECT name FROM sqlite_master WHERE type='table'")
        .load::<TableName>(conn)
        .map(|v| v.into_iter().map(|t| t.name).collect())
        .unwrap_or_default()
}

// Global connection pools
lazy_static::lazy_static! {
    static ref VESTA_POOL: Arc<Mutex<Option<DbPool>>> = Arc::new(Mutex::new(None));
    static ref CONFIG_POOL: Arc<Mutex<Option<DbPool>>> = Arc::new(Mutex::new(None));
}

/// Initialize the vesta.db connection pool
pub fn init_vesta_pool(path: PathBuf) -> Result<(), anyhow::Error> {
    let db_path = path.join("vesta.db");
    let url = db_path.to_string_lossy().to_string();

    log::info!("Connecting to vesta database at {}", url);

    let manager = ConnectionManager::<SqliteConnection>::new(url);
    let pool = Pool::builder()
        .max_size(16)
        .connection_customizer(Box::new(SqliteCustomizer))
        .build(manager)?;

    // Run migrations
    let mut conn = pool.get()?;

    let pending = conn
        .pending_migrations(VESTA_MIGRATIONS)
        .map_err(|e| anyhow::anyhow!("Failed to check pending migrations: {}", e))?;

    log::info!("Vesta database: {} pending migrations found", pending.len());
    for m in &pending {
        log::info!("  - Pending: {}", m.name());
    }

    conn.run_pending_migrations(VESTA_MIGRATIONS)
        .map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;

    log::info!("✓ Vesta database initialized");

    *VESTA_POOL.lock().unwrap() = Some(pool);
    Ok(())
}

/// Initialize the app_config.db connection pool
pub fn init_config_pool(path: PathBuf) -> Result<(), anyhow::Error> {
    let db_path = path.join("app_config.db");
    let url = db_path.to_string_lossy().to_string();

    log::info!("Connecting to config database at {}", url);

    let manager = ConnectionManager::<SqliteConnection>::new(url);
    let pool = Pool::builder()
        .max_size(4)
        .connection_customizer(Box::new(SqliteCustomizer))
        .build(manager)?;

    // Run migrations (same migrations, they'll check if tables exist)
    let mut conn = pool.get()?;

    let pending = conn
        .pending_migrations(CONFIG_MIGRATIONS)
        .map_err(|e| anyhow::anyhow!("Failed to check pending migrations: {}", e))?;

    log::info!(
        "Config database: {} pending migrations found",
        pending.len()
    );
    for m in &pending {
        log::info!("  - Pending: {}", m.name());
    }

    conn.run_pending_migrations(CONFIG_MIGRATIONS)
        .map_err(|e| anyhow::anyhow!("Config migration failed: {}", e))?;

    log::info!("✓ Config database initialized");

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
