# Database Migration Guide - Diesel

## Overview

Vesta Launcher uses **Diesel ORM** for database schema management and migrations. Migrations are stored in `migrations/vesta` (main data) and `migrations/config` (app config), and are managed via the Diesel CLI.

## Quick Start

### Running Migrations

Migrations run automatically on app startup via `utils::db::run_migrations()`.

To run manually during development:

```bash
cd vesta-launcher/src-tauri

# Run all pending migrations for main database
diesel migration run --migration-dir migrations/vesta

# Run all pending migrations for config database
diesel migration run --migration-dir migrations/config
```

### Checking Status

```bash
# See pending migrations
diesel migration pending --migration-dir migrations/vesta

# See applied migrations
diesel migration list --migration-dir migrations/vesta
```

## Creating New Migrations

### Step 1: Generate Migration

```bash
# For main database (user data)
diesel migration generate create_users_table --migration-dir migrations/vesta

# For config database (app settings)
diesel migration generate add_theme_setting --migration-dir migrations/config
```

This creates a new directory: `migrations/vesta/<timestamp>_create_users_table/`

### Step 2: Edit Migration Files

**up.sql** - The SQL to apply the migration:

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
```

**down.sql** - The SQL to rollback:

```sql
DROP INDEX IF EXISTS idx_users_username;
DROP TABLE users;
```

### Step 3: Run and Test

```bash
# Apply the migration
diesel migration run --migration-dir migrations/vesta

# Test rollback
diesel migration revert --migration-dir migrations/vesta

# Re-apply
diesel migration run --migration-dir migrations/vesta
```

### Step 4: Update Schema

After running migrations, the `src/schema.rs` file is automatically updated with the new table definitions.

## Common Migration Patterns

### Adding a Column

```sql
-- up.sql
ALTER TABLE users ADD COLUMN last_login TIMESTAMP;

-- down.sql
ALTER TABLE users DROP COLUMN last_login;
```

### Creating a Table

```sql
-- up.sql
CREATE TABLE mods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    instance_id INTEGER NOT NULL REFERENCES instances(id)
);

CREATE INDEX idx_mods_instance ON mods(instance_id);

-- down.sql
DROP INDEX IF EXISTS idx_mods_instance;
DROP TABLE mods;
```

### Modifying Data

```sql
-- up.sql
UPDATE users SET last_login = created_at WHERE last_login IS NULL;

-- down.sql
-- Usually no rollback for data changes
```

### Renaming a Column (SQLite)

```sql
-- up.sql
ALTER TABLE users RENAME COLUMN email TO email_address;

-- down.sql
ALTER TABLE users RENAME COLUMN email_address TO email;
```

### Complex Schema Changes

For complex changes requiring table recreation:

```sql
-- up.sql
ALTER TABLE instances RENAME TO instances_old;

CREATE TABLE instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    minecraft_version TEXT NOT NULL,
    memory_mb BIGINT DEFAULT 2048,  -- Changed from INTEGER
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO instances (id, name, minecraft_version, memory_mb)
SELECT id, name, minecraft_version, CAST(memory_mb AS BIGINT)
FROM instances_old;

DROP TABLE instances_old;

-- down.sql
-- Complex rollbacks may not be worth implementing
SELECT 1;  -- No-op
```

## Best Practices

### ✅ DO

- **Test migrations** on a copy of your database
- **Write reversible migrations** when possible
- **Use transactions** (Diesel handles this automatically)
- **Keep migrations small** and focused
- **Document complex changes** with comments in SQL
- **Use semantic naming** for migration directories

### ❌ DON'T

- **Never modify** existing migration files once committed
- **Don't skip** testing migrations
- **Don't delete** old migration files
- **Don't assume** data exists without checking

## Migration Directories

- **`migrations/vesta/`** - Main user data (instances, accounts, mods, etc.)
- **`migrations/config/`** - App configuration (settings, themes, preferences)

## Integration with Code

Migrations run automatically when the app starts:

```rust
// In utils/db.rs or similar
pub fn run_migrations() -> Result<(), Box<dyn std::error::Error>> {
    // Run vesta migrations
    let mut vesta_conn = establish_connection("vesta.db")?;
    diesel_migrations::run_pending_migrations(&mut vesta_conn)?;

    // Run config migrations
    let mut config_conn = establish_connection("config.db")?;
    diesel_migrations::run_pending_migrations(&mut config_conn)?;

    Ok(())
}
```

## Troubleshooting

### Migration Failed

1. Check the SQL syntax in `up.sql`
2. Ensure foreign key references exist
3. Test on an empty database first
4. Check for conflicting column names

### Reverting Migrations

```bash
# Revert last migration
diesel migration revert --migration-dir migrations/vesta

# Revert multiple
diesel migration revert --migration-dir migrations/vesta --number 3
```

### Database Issues

If migrations get corrupted:
1. Backup data
2. Drop and recreate database
3. Re-run all migrations
4. Restore data

## Example: Adding Mod Management

```bash
# Generate migration
diesel migration generate add_mod_management --migration-dir migrations/vesta
```

**up.sql:**
```sql
-- Mods table
CREATE TABLE mods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    mod_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    source TEXT CHECK (source IN ('curseforge', 'modrinth', 'local')),
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_mods_instance ON mods(instance_id);
CREATE INDEX idx_mods_mod_id ON mods(mod_id);

-- Mod dependencies
CREATE TABLE mod_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mod_id INTEGER NOT NULL,
    dependency_mod_id TEXT NOT NULL,
    dependency_type TEXT CHECK (dependency_type IN ('required', 'optional')),
    FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE
);

CREATE INDEX idx_mod_deps_mod ON mod_dependencies(mod_id);
```

**down.sql:**
```sql
DROP INDEX IF EXISTS idx_mod_deps_mod;
DROP TABLE IF EXISTS mod_dependencies;
DROP INDEX IF EXISTS idx_mods_mod_id;
DROP INDEX IF EXISTS idx_mods_instance;
DROP TABLE IF EXISTS mods;
```

## Summary

Diesel migrations provide:
- ✅ **CLI-based workflow** for generating and managing migrations
- ✅ **Automatic schema generation** in `schema.rs`
- ✅ **Transaction safety** for all migrations
- ✅ **Easy testing and rollback** during development
- ✅ **Separation of concerns** between data and config migrations

Users get automatic schema updates when updating the app!
