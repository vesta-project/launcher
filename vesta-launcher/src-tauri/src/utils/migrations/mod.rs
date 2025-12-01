// Migration Framework - Core functionality only
// App-specific migrations are in definitions.rs

mod definitions;
mod helpers;

pub use definitions::{get_config_migrations, get_data_migrations};
pub use helpers::*;

use anyhow::Error;
use rusqlite::Connection;

/// Compare two semantic version strings (e.g., "0.1.0" vs "0.2.0")
/// Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
fn compare_versions(v1: &str, v2: &str) -> i8 {
    let parse_version =
        |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse::<u32>().ok()).collect() };

    let v1_parts = parse_version(v1);
    let v2_parts = parse_version(v2);

    for i in 0..v1_parts.len().max(v2_parts.len()) {
        let p1 = v1_parts.get(i).unwrap_or(&0);
        let p2 = v2_parts.get(i).unwrap_or(&0);

        if p1 < p2 {
            return -1;
        } else if p1 > p2 {
            return 1;
        }
    }

    0
}

/// Represents a single database migration
#[derive(Debug, Clone)]
pub struct Migration {
    /// Version string (e.g., "0.1.0", "1.0.0")
    pub version: String,
    /// Human-readable description of what this migration does
    pub description: String,
    /// SQL statements to apply this migration (run in order)
    pub up_sql: Vec<String>,
    /// SQL statements to rollback this migration (run in reverse order)
    pub down_sql: Vec<String>,
}

/// Trait for running database migrations
pub trait MigrationRunner {
    /// Migrate database up to the specified target version
    fn migrate_up(&self, target_version: &str) -> Result<(), Error>;

    /// Migrate database down to the specified target version
    fn migrate_down(&self, target_version: &str) -> Result<(), Error>;

    /// Get the current database version
    fn get_current_version(&self) -> Result<String, Error>;

    /// Get list of applied migration versions
    fn get_applied_migrations(&self) -> Result<Vec<String>, Error>;

    /// Check if a specific migration has been applied
    fn is_migration_applied(&self, version: &str) -> Result<bool, Error>;
}

/// SQLite-specific migration runner implementation
pub struct SQLiteMigrationRunner<'a> {
    conn: &'a Connection,
    migrations: Vec<Migration>,
}

impl<'a> SQLiteMigrationRunner<'a> {
    /// Create a new migration runner
    pub fn new(conn: &'a Connection, migrations: Vec<Migration>) -> Self {
        Self { conn, migrations }
    }

    /// Sort migrations by version for proper execution order
    fn sort_migrations(&self) -> Vec<Migration> {
        let mut sorted = self.migrations.clone();
        sorted.sort_by(|a, b| match compare_versions(&a.version, &b.version) {
            -1 => std::cmp::Ordering::Less,
            1 => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        });
        sorted
    }

    /// Initialize migration tracking table if it doesn't exist
    fn ensure_migration_table(&self) -> Result<(), Error> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;
        Ok(())
    }

    /// Record that a migration has been applied
    fn record_migration_applied(&self, migration: &Migration) -> Result<(), Error> {
        self.conn.execute(
            "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
            [&migration.version, &migration.description],
        )?;
        Ok(())
    }

    /// Record that a migration has been rolled back
    fn record_migration_rolled_back(&self, version: &str) -> Result<(), Error> {
        self.conn
            .execute("DELETE FROM schema_migrations WHERE version = ?", [version])?;
        Ok(())
    }
}

impl<'a> MigrationRunner for SQLiteMigrationRunner<'a> {
    fn migrate_up(&self, target_version: &str) -> Result<(), Error> {
        self.ensure_migration_table()?;

        let current_version = self
            .get_current_version()
            .unwrap_or_else(|_| "0.0.0".to_string());

        let target_ver = target_version.to_string();
        let current_ver = current_version.clone();

        if compare_versions(&target_ver, &current_ver) <= 0 {
            return Ok(()); // Already at or beyond target version
        }

        let sorted_migrations = self.sort_migrations();

        // Execute migrations in order
        for migration in sorted_migrations {
            if compare_versions(&migration.version, &current_ver) > 0
                && compare_versions(&migration.version, &target_ver) <= 0
            {
                // Check if already applied
                if self.is_migration_applied(&migration.version)? {
                    continue;
                }

                // Execute up migration
                self.conn.execute("BEGIN TRANSACTION", [])?;

                match (|| -> Result<(), Error> {
                    for sql in &migration.up_sql {
                        self.conn.execute(sql, [])?;
                    }
                    self.record_migration_applied(&migration)?;
                    Ok(())
                })() {
                    Ok(_) => {
                        self.conn.execute("COMMIT", [])?;
                        println!(
                            "✓ Applied migration {}: {}",
                            migration.version, migration.description
                        );
                    }
                    Err(e) => {
                        self.conn.execute("ROLLBACK", [])?;
                        return Err(anyhow::anyhow!(
                            "Migration {} failed: {}. Rolled back.",
                            migration.version,
                            e
                        ));
                    }
                }
            }
        }

        Ok(())
    }

    fn migrate_down(&self, target_version: &str) -> Result<(), Error> {
        self.ensure_migration_table()?;

        let current_version = self.get_current_version()?;
        let target_ver = target_version.to_string();
        let current_ver = current_version.clone();

        if compare_versions(&target_ver, &current_ver) >= 0 {
            return Ok(()); // Already at or below target version
        }

        let sorted_migrations = self.sort_migrations();
        let mut migrations_to_rollback = Vec::new();

        // Find migrations to rollback (in reverse order)
        for migration in sorted_migrations.iter().rev() {
            if compare_versions(&migration.version, &current_ver) <= 0
                && compare_versions(&migration.version, &target_ver) > 0
            {
                if self.is_migration_applied(&migration.version)? {
                    migrations_to_rollback.push(migration.clone());
                }
            }
        }

        // Execute rollbacks
        for migration in migrations_to_rollback {
            self.conn.execute("BEGIN TRANSACTION", [])?;

            match (|| -> Result<(), Error> {
                // Execute down SQL in reverse order
                for sql in migration.down_sql.iter().rev() {
                    self.conn.execute(sql, [])?;
                }
                self.record_migration_rolled_back(&migration.version)?;
                Ok(())
            })() {
                Ok(_) => {
                    self.conn.execute("COMMIT", [])?;
                    println!(
                        "✓ Rolled back migration {}: {}",
                        migration.version, migration.description
                    );
                }
                Err(e) => {
                    self.conn.execute("ROLLBACK", [])?;
                    return Err(anyhow::anyhow!(
                        "Rollback of migration {} failed: {}",
                        migration.version,
                        e
                    ));
                }
            }
        }

        Ok(())
    }

    fn get_current_version(&self) -> Result<String, Error> {
        self.ensure_migration_table()?;

        let mut stmt = self
            .conn
            .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")?;

        let version = stmt
            .query_row([], |row| row.get(0))
            .unwrap_or("0.0.0".to_string());

        Ok(version)
    }

    fn get_applied_migrations(&self) -> Result<Vec<String>, Error> {
        self.ensure_migration_table()?;

        let mut stmt = self
            .conn
            .prepare("SELECT version FROM schema_migrations ORDER BY applied_at")?;

        let versions = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        Ok(versions)
    }

    fn is_migration_applied(&self, version: &str) -> Result<bool, Error> {
        self.ensure_migration_table()?;

        let mut stmt = self
            .conn
            .prepare("SELECT COUNT(*) FROM schema_migrations WHERE version = ?")?;

        let count: i64 = stmt.query_row([version], |row| row.get(0))?;

        Ok(count > 0)
    }
}

/// Helper function to create a migration
pub fn create_migration(
    version: &str,
    description: &str,
    up_sql: Vec<&str>,
    down_sql: Vec<&str>,
) -> Migration {
    Migration {
        version: version.to_string(),
        description: description.to_string(),
        up_sql: up_sql.into_iter().map(|s| s.to_string()).collect(),
        down_sql: down_sql.into_iter().map(|s| s.to_string()).collect(),
    }
}
