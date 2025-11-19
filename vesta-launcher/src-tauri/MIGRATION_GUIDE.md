# Database Migration System - Integration Guide

## Overview

The Vesta Launcher uses a custom database migration system that integrates seamlessly with our `SQLiteDB` interface. This guide shows you how to use both systems together.

## Quick Start

### Initializing Database with Migrations

```rust
use crate::utils::sqlite::{SQLiteDB, VersionVerification};
use crate::utils::migrations::get_migrations;

// Create database connection
let db = SQLiteDB::new(
    path,
    "app.db".into(),
    "1.0.0".into(),
    VersionVerification::Any
)?;

// Run all migrations automatically
db.initialize_with_migrations()?;
```

### How It Works

1. **First Launch**: Runs all migrations from `0.0.0` → current version
2. **Subsequent Launches**: Only runs new migrations since last version
3. **Automatic Tracking**: Stores migration history in `schema_migrations` table

## Creating New Migrations

### Method 1: Simple SQL (Recommended for most cases)

```rust
/// Migration 005: Add mods table
fn migration_005_mods_table() -> Migration {
    create_migration(
        "0.5.0",
        "Add mods table for mod management",
        vec![
            "CREATE TABLE mods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                version TEXT NOT NULL
            )",
            "CREATE INDEX idx_mods_name ON mods(name)",
        ],
        vec![
            "DROP INDEX IF EXISTS idx_mods_name",
            "DROP TABLE IF EXISTS mods",
        ],
    )
}
```

### Method 2: Using Helper Functions (For programmatic generation)

```rust
use crate::utils::migrations::{
    generate_create_table_sql,
    generate_drop_table_sql,
    generate_create_index_sql,
    generate_drop_index_sql,
};

fn migration_006_cache_table() -> Migration {
    // Define columns programmatically
    let mut columns = HashMap::new();
    columns.insert("id".to_string(), (
        vec!["PRIMARY KEY".to_string(), "AUTOINCREMENT".to_string()],
        "INTEGER".to_string()
    ));
    columns.insert("key".to_string(), (
        vec!["UNIQUE".to_string(), "NOT NULL".to_string()],
        "TEXT".to_string()
    ));
    columns.insert("value".to_string(), (
        vec![],
        "TEXT".to_string()
    ));

    // Generate SQL
    let create_table = generate_create_table_sql("cache", &columns);
    let create_idx = generate_create_index_sql("idx_cache_key", "cache", &["key"]);
    let drop_idx = generate_drop_index_sql("idx_cache_key");
    let drop_table = generate_drop_table_sql("cache");

    Migration {
        version: "0.6.0".to_string(),
        description: "Add cache table".to_string(),
        up_sql: vec![create_table, create_idx],
        down_sql: vec![drop_idx, drop_table],
    }
}
```

### Method 3: Integration with SqlTable Trait

If you have a struct using the `SqlTable` trait, you can generate SQL from it:

```rust
#[derive(SqlTable)]
struct ModEntry {
    #[primary_key]
    #[autoincrement]
    id: AUTOINCREMENT,
    name: String,
    version: String,
}

fn migration_from_trait() -> Migration {
    // Get the SQL that would create this table
    let db = get_temp_db()?;
    let create_sql = db.create_table_from_trait::<ModEntry>()?;
    
    Migration {
        version: "0.7.0".to_string(),
        description: "Add mod entries".to_string(),
        up_sql: vec![create_sql],
        down_sql: vec![generate_drop_table_sql(&ModEntry::name())],
    }
}
```

## Registering Migrations

After creating a migration function, register it in `get_migrations()`:

```rust
// In src/utils/migrations/mod.rs

pub fn get_migrations() -> Vec<Migration> {
    vec![
        migration_001_initial_schema(),
        migration_002_app_config_expansion(),
        migration_003_instances_table(),
        migration_004_accounts_table(),
        migration_005_mods_table(),        // ← Add your new migration
        migration_006_cache_table(),       // ← Add another
    ]
}
```

## Common Migration Patterns

### Adding a Column

```rust
fn migration_007_add_description() -> Migration {
    create_migration(
        "0.7.0",
        "Add description to instances",
        vec!["ALTER TABLE instances ADD COLUMN description TEXT"],
        vec!["ALTER TABLE instances DROP COLUMN description"],
    )
}
```

### Modifying a Column Type (SQLite requires table recreation)

```rust
fn migration_008_modify_memory_type() -> Migration {
    create_migration(
        "0.8.0",
        "Change memory_mb to BIGINT",
        vec![
            "ALTER TABLE instances RENAME TO instances_old",
            "CREATE TABLE instances (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                memory_mb BIGINT DEFAULT 2048  -- Changed type
            )",
            "INSERT INTO instances SELECT * FROM instances_old",
            "DROP TABLE instances_old",
        ],
        vec![
            // Usually not worth implementing rollback for type changes
            "SELECT 1",  // No-op
        ],
    )
}
```

### Adding Indexes

```rust
fn migration_009_performance_indexes() -> Migration {
    create_migration(
        "0.9.0",
        "Add performance indexes",
        vec![
            "CREATE INDEX idx_mods_version ON mods(version)",
            "CREATE INDEX idx_instances_last_played ON instances(last_played)",
        ],
        vec![
            "DROP INDEX IF EXISTS idx_instances_last_played",
            "DROP INDEX IF EXISTS idx_mods_version",
        ],
    )
}
```

### Seeding Data

```rust
fn migration_010_seed_defaults() -> Migration {
    create_migration(
        "0.10.0",
        "Add default instances",
        vec![
            "INSERT INTO instances (name, minecraft_version, modloader) 
             VALUES ('Vanilla 1.20.1', '1.20.1', 'vanilla')",
        ],
        vec![
            "DELETE FROM instances WHERE name = 'Vanilla 1.20.1'",
        ],
    )
}
```

## SQLiteDB Integration

### Available Methods

```rust
// Run migrations manually
db.run_migrations(get_migrations(), "1.0.0")?;

// Initialize with migrations (uses db version)
db.initialize_with_migrations()?;

// Get current schema version
let version = db.get_schema_version()?;

// Get list of applied migrations
let applied = db.get_applied_migrations()?;

// Generate SQL from SqlTable trait
let sql = db.create_table_from_trait::<MyStruct>()?;
```

## Best Practices

### ✅ DO

- **Increment version numbers** sequentially (0.1.0, 0.2.0, 0.3.0...)
- **Write reversible migrations** (good `down_sql`)
- **Test on a copy of production data** before deploying
- **Use transactions** (already built-in)
- **Document complex migrations** with comments
- **Keep migrations small** and focused on one change

### ❌ DON'T

- **Never modify** existing migrations once deployed
- **Don't skip** version numbers
- **Don't delete** old migration files
- **Don't assume** data format without validation
- **Don't use** raw SQL for actual data queries (use parameterized queries)

## Testing Migrations

```rust
#[test]
fn test_migrations() {
    let db = create_test_db()?;
    
    // Test up migration
    db.initialize_with_migrations()?;
    assert_eq!(db.get_schema_version()?, "0.4.0");
    
    // Test data persists
    let config = get_app_config(&db)?;
    assert!(config.is_some());
}
```

## Version Management

The migration system uses **semantic versioning**:

- `0.1.0` → First version with basic schema
- `0.2.0` → Added new table (minor change)
- `1.0.0` → Major rewrite (breaking change)

Versions are compared numerically:
- `0.9.0` < `0.10.0` ✓ (correctly handles double digits)
- `0.2.0` < `1.0.0` ✓

## Troubleshooting

### Migration Failed

If a migration fails:
1. **Automatic rollback** occurs (transaction safety)
2. Check error message for SQL syntax issues
3. Verify column names and types match existing schema
4. Test migration on empty database first

### Schema Version Mismatch

```rust
// Get current version
let current = db.get_schema_version()?;
println!("Current schema version: {}", current);

// Get applied migrations
let applied = db.get_applied_migrations()?;
println!("Applied migrations: {:?}", applied);
```

### Database Corruption

If migrations are corrupted:
1. Backup user data
2. Drop `schema_migrations` table
3. Re-run migrations from scratch
4. Restore user data

## Example: Complete Feature Addition

Let's add a complete "mod management" feature:

```rust
/// Migration 011: Complete mod management system
fn migration_011_mod_system() -> Migration {
    create_migration(
        "0.11.0",
        "Add complete mod management system",
        vec![
            // Main mods table
            "CREATE TABLE mods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_id INTEGER NOT NULL,
                mod_id TEXT NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                enabled BOOLEAN DEFAULT 1,
                source TEXT CHECK (source IN ('curseforge', 'modrinth', 'local')),
                FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
            )",
            
            // Mod dependencies
            "CREATE TABLE mod_dependencies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mod_id INTEGER NOT NULL,
                dependency_mod_id TEXT NOT NULL,
                dependency_type TEXT CHECK (dependency_type IN ('required', 'optional')),
                FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE
            )",
            
            // Performance indexes
            "CREATE INDEX idx_mods_instance ON mods(instance_id)",
            "CREATE INDEX idx_mods_mod_id ON mods(mod_id)",
            "CREATE INDEX idx_mod_deps_mod ON mod_dependencies(mod_id)",
        ],
        vec![
            "DROP INDEX IF EXISTS idx_mod_deps_mod",
            "DROP INDEX IF EXISTS idx_mods_mod_id",
            "DROP INDEX IF EXISTS idx_mods_instance",
            "DROP TABLE IF EXISTS mod_dependencies",
            "DROP TABLE IF EXISTS mods",
        ],
    )
}
```

Then register it:

```rust
pub fn get_migrations() -> Vec<Migration> {
    vec![
        // ... existing migrations ...
        migration_011_mod_system(),  // ← Add here
    ]
}
```

## Summary

The migration system provides:
- ✅ **Safe schema evolution** with transaction safety
- ✅ **Automatic version tracking** in `schema_migrations` table
- ✅ **Rollback support** for testing and debugging
- ✅ **Integration with SqlTable** for type-safe tables
- ✅ **Helper functions** for programmatic SQL generation
- ✅ **Semantic versioning** with proper comparison

Users automatically get schema updates when they update the app!
