# 🗄️ Vesta Database System Guide

## Overview

The Vesta project uses a **SqlTable-based** system where Rust structs are the single source of truth for database schemas. This eliminates duplication and ensures type safety.

## Current System Architecture

### 1. **SqlTable Trait** (Single Source of Truth)

Every database table is defined as a Rust struct with `#[derive(SqlTable)]`:

```rust
#[derive(Serialize, Deserialize, Debug, SqlTable)]
#[migration_version("0.5.0")]           // ← Schema version
#[migration_description("User settings")] // ← What this table is for
pub struct UserSettings {
    #[primary_key]
    pub id: i32,
    pub theme: String,
    pub dark_mode: bool,                // ← Bool auto-converts to INTEGER
    pub custom_path: Option<String>,    // ← Option types fully supported
}
```

**What you get automatically:**
- ✅ CREATE TABLE SQL generation
- ✅ INSERT/UPDATE/SELECT methods
- ✅ Type-safe CRUD operations
- ✅ Migration metadata
- ✅ No manual SQL writing needed

### 2. **Migration System** (Version Tracking)

Migrations are stored in `src/utils/migrations/definitions.rs` and run automatically on app startup.

**Current migrations:**
- `0.1.0` - Initial schema (migration tracking table)
- `0.2.0` - App configuration (uses SqlTable)
- `0.3.0` - Instances table (old style - needs conversion)
- `0.4.0` - Accounts table (old style - needs conversion)

## How To: Common Tasks

### ✅ Add a New Table

**Step 1: Define the struct**

Create your struct in the appropriate module (e.g., `src/models/user_prefs.rs`):

```rust
use serde::{Deserialize, Serialize};
use piston_macros::SqlTable;
use crate::utils::sqlite::AUTOINCREMENT;

#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.5.0")]  // ← Increment from last migration
#[migration_description("User preferences table")]
pub struct UserPreferences {
    #[primary_key]
    #[autoincrement]
    id: AUTOINCREMENT,
    
    user_id: i32,
    
    #[unique]
    setting_key: String,
    
    setting_value: String,
    
    #[not_null]
    category: String,
}

// Optional: Provide default data
impl UserPreferences {
    pub fn get_default_data_sql() -> Vec<String> {
        vec![
            format!(
                "INSERT INTO {} (user_id, setting_key, setting_value, category) \
                 VALUES (1, 'theme', 'dark', 'appearance')",
                Self::name()
            )
        ]
    }
}
```

**Step 2: Create the migration**

In `src/utils/migrations/definitions.rs`:

```rust
// Add this function
fn migration_005_user_preferences() -> Migration {
    let schema_sql = UserPreferences::schema_sql();
    let default_data = UserPreferences::get_default_data_sql();
    
    let mut up_sql = vec![schema_sql];
    up_sql.extend(default_data);
    
    Migration {
        version: UserPreferences::migration_version(),
        description: UserPreferences::migration_description(),
        up_sql,
        down_sql: vec![format!("DROP TABLE IF EXISTS {}", UserPreferences::name())],
    }
}

// Update get_all_migrations()
pub fn get_all_migrations() -> Vec<Migration> {
    vec![
        migration_001_initial_schema(),
        migration_002_app_config(),
        migration_003_instances_table(),
        migration_004_accounts_table(),
        migration_005_user_preferences(),  // ← Add here
    ]
}
```

**Step 3: Use it!**

```rust
// Insert
let pref = UserPreferences::new(1, "font_size".to_string(), "14".to_string(), "appearance".to_string());
db.insert_data_serde(&pref)?;

// Query
let prefs: Vec<UserPreferences> = db.search_data_serde::<UserPreferences, i32, UserPreferences>(
    SQLiteSelect::ALL,
    "user_id",
    1
)?;

// Update
let mut pref = prefs[0].clone();
pref.setting_value = "16".to_string();
db.update_data_serde(&pref, "id", pref.id)?;
```

### ✅ Add a Field to Existing Table

**Step 1: Add field to struct**

```rust
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.2.0")]  // ← Keep same version
pub struct AppConfig {
    #[primary_key]
    pub id: i32,
    // ... existing fields ...
    pub new_feature_enabled: bool,  // ← Add new field
}
```

**Step 2: Update Default impl**

```rust
impl Default for AppConfig {
    fn default() -> Self {
        Self::new(
            1,
            // ... existing defaults ...
            true,  // ← Add default for new field
        )
    }
}
```

**Step 3: Create ALTER TABLE migration**

In `src/utils/migrations/definitions.rs`:

```rust
fn migration_006_add_new_feature_flag() -> Migration {
    create_migration(
        "0.6.0",  // ← New version
        "Add new_feature_enabled flag to app_config",
        vec![
            "ALTER TABLE app_config ADD COLUMN new_feature_enabled INTEGER DEFAULT 1",
        ],
        vec![
            "ALTER TABLE app_config DROP COLUMN new_feature_enabled",
        ],
    )
}

// Add to get_all_migrations()
```

**That's it!** The SqlTable trait will automatically handle the new field in all queries.

### ✅ Supported Field Types

| Rust Type | SQLite Type | Notes |
|-----------|-------------|-------|
| `i32`, `i64` | `INTEGER` | - |
| `f32`, `f64` | `REAL` | - |
| `String` | `TEXT` | - |
| `bool` | `INTEGER` | Auto-converts to 0/1 |
| `Option<T>` | Same as `T` | NULL if None |
| `AUTOINCREMENT` | `INTEGER` | Special enum for auto-increment PKs |
| `Vec<u8>` | `BLOB` | Binary data |

### ✅ Supported Attributes

On the struct:
- `#[migration_version("x.y.z")]` - Schema version
- `#[migration_description("...")]` - Migration description

On fields:
- `#[primary_key]` - Make field primary key
- `#[autoincrement]` - Auto-increment (use with `AUTOINCREMENT` type)
- `#[unique]` - Add UNIQUE constraint
- `#[not_null]` - Add NOT NULL constraint
- `#[table_name]` - Use field value as table name (advanced)

## Removing Old System (TODO)

### Tables Still Using Old System:

1. **migration_003_instances_table** (line 66)
2. **migration_004_accounts_table** (line 97)

### How to Convert:

**Before (Old System):**
```rust
fn migration_003_instances_table() -> Migration {
    create_migration(
        "0.3.0",
        "Create instances table",
        vec![
            "CREATE TABLE instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                // ... 50 lines of SQL ...
            )",
        ],
        // ...
    )
}
```

**After (New System):**
```rust
// 1. Create the struct
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.3.0")]
#[migration_description("Minecraft instance management")]
pub struct Instance {
    #[primary_key]
    #[autoincrement]
    id: AUTOINCREMENT,
    
    #[not_null]
    name: String,
    
    #[not_null]
    minecraft_version: String,
    
    modloader: Option<String>,
    // ... etc
}

// 2. Use SqlTable for migration
fn migration_003_instances_table() -> Migration {
    let schema_sql = Instance::schema_sql();
    
    Migration {
        version: Instance::migration_version(),
        description: Instance::migration_description(),
        up_sql: vec![
            schema_sql,
            // Add indexes separately (SqlTable doesn't handle these yet)
            "CREATE INDEX idx_instances_name ON instances(name)".to_string(),
        ],
        down_sql: vec![
            "DROP INDEX IF EXISTS idx_instances_name".to_string(),
            format!("DROP TABLE IF EXISTS {}", Instance::name()),
        ],
    }
}
```

## Database Operations Reference

### Insert
```rust
let item = MyStruct::new(...);
db.insert_data_serde(&item)?;

// Or insert only if doesn't exist (for AUTOINCREMENT tables)
db.insert_data_if_not_exists_serde(&item)?;
```

### Query
```rust
// Search by column
let results: Vec<MyStruct> = db.search_data_serde::<MyStruct, i32, MyStruct>(
    SQLiteSelect::ALL,  // or SQLiteSelect::ONLY(vec!["col1", "col2"])
    "column_name",
    search_value
)?;

// Get all records
let all: Vec<MyStruct> = db.get_all_data_serde::<MyStruct, MyStruct>()?;
```

### Update
```rust
let mut item = /* ... get from database ... */;
item.field = new_value;
db.update_data_serde(&item, "id", item.id)?;
```

## Migration Best Practices

1. **Never edit old migrations** - Always create new ones
2. **Sequential versions** - Use semantic versioning (0.1.0, 0.2.0, etc.)
3. **Test migrations** - Run `cargo test` before deploying
4. **Provide rollback** - Always include `down_sql` for rollbacks
5. **One concern per migration** - Don't mix table creation with data changes

## Benefits of This System

✅ **Type Safety** - Compiler catches schema errors  
✅ **No SQL Duplication** - Schema defined once in Rust  
✅ **Auto-Generated Queries** - CRUD methods generated automatically  
✅ **Migration Tracking** - Version control built-in  
✅ **Easy Maintenance** - Add fields in one place, everything updates  
✅ **Testable** - All operations are type-checked at compile time  

## Next Steps

1. **Convert migration_003 and migration_004** to use SqlTable
2. **Create Instance and Account structs** with SqlTable derive
3. **Update documentation** once conversion is complete
4. **Add more SqlTable features** (CHECK constraints, indexes, etc.)

## Questions?

Check the examples in:
- `src/utils/config/mod.rs` - AppConfig (full example)
- `src/utils/sqlite.rs` - CustomTableStruct (test example)
- `src/utils/migrations/definitions.rs` - All migrations
