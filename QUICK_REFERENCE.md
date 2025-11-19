# Quick Reference: Vesta Database System

## 🚀 Quick Start: Add a New Table

```rust
// 1. Define struct with SqlTable
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.X.0")]
#[migration_description("Your table description")]
pub struct YourTable {
    #[primary_key]
    #[autoincrement]
    id: AUTOINCREMENT,
    name: String,
    is_active: bool,
    optional_field: Option<String>,
}

// 2. Add migration in definitions.rs
fn migration_00X_your_table() -> Migration {
    let schema_sql = YourTable::schema_sql();
    Migration {
        version: YourTable::migration_version(),
        description: YourTable::migration_description(),
        up_sql: vec![schema_sql],
        down_sql: vec![format!("DROP TABLE IF EXISTS {}", YourTable::name())],
    }
}

// 3. Add to get_all_migrations()
pub fn get_all_migrations() -> Vec<Migration> {
    vec![
        // ... existing migrations ...
        migration_00X_your_table(),
    ]
}
```

## 📝 CRUD Operations Cheat Sheet

```rust
// CREATE
let item = MyStruct::new(...);
db.insert_data_serde(&item)?;

// READ (by column)
let items: Vec<MyStruct> = db.search_data_serde::<MyStruct, i32, MyStruct>(
    SQLiteSelect::ALL,
    "column_name",
    search_value
)?;

// READ (all)
let all: Vec<MyStruct> = db.get_all_data_serde::<MyStruct, MyStruct>()?;

// UPDATE
let mut item = items[0].clone();
item.field = new_value;
db.update_data_serde(&item, "id", item.id)?;
```

## 🏷️ Attributes Quick Reference

### Struct Attributes
```rust
#[migration_version("0.X.0")]         // Required: schema version
#[migration_description("Description")] // Required: what this table does
```

### Field Attributes
```rust
#[primary_key]      // Make this the primary key
#[autoincrement]    // Auto-increment (requires AUTOINCREMENT type)
#[unique]          // Add UNIQUE constraint
#[not_null]        // Add NOT NULL constraint
```

## 📊 Type Mapping

| Rust | SQLite | Notes |
|------|--------|-------|
| `i32`, `i64` | `INTEGER` | - |
| `String` | `TEXT` | - |
| `bool` | `INTEGER` | Auto-converts 0/1 |
| `Option<T>` | `T` | NULL when None |
| `AUTOINCREMENT` | `INTEGER` | For auto-increment IDs |

## 🔄 Adding Fields (Migration Pattern)

```rust
// 1. Add field to struct
pub struct AppConfig {
    // ... existing ...
    pub new_field: bool,  // ← Add here
}

// 2. Update Default::new()
Self::new(
    // ... existing ...
    true,  // ← Add default
)

// 3. Create ALTER TABLE migration
fn migration_00X_add_field() -> Migration {
    create_migration(
        "0.X.0",
        "Add new_field to app_config",
        vec!["ALTER TABLE app_config ADD COLUMN new_field INTEGER DEFAULT 1"],
        vec!["ALTER TABLE app_config DROP COLUMN new_field"],
    )
}
```

## ⚙️ Database Initialization

```rust
// In main.rs setup hook:
use crate::utils::config::initialize_config_db;

tauri::Builder::default()
    .setup(|app| {
        // Initialize database with migrations
        initialize_config_db()?;
        Ok(())
    })
```

## 🧪 Testing

```bash
# Run all tests
cargo test

# Run specific test
cargo test config

# Build and check
cargo build
```

## 📋 Migration Checklist

- [ ] Increment version number (0.X.0)
- [ ] Add migration function
- [ ] Add to `get_all_migrations()`
- [ ] Test with `cargo test`
- [ ] Update Default impl if needed
- [ ] Document changes

## 🚨 Common Pitfalls

❌ **Don't:**
- Edit old migrations
- Skip version numbers
- Forget to add to `get_all_migrations()`
- Use `bool` without knowing it becomes INTEGER

✅ **Do:**
- Create new migrations for changes
- Use sequential version numbers
- Test before deploying
- Provide rollback SQL

## 📚 Examples

Full examples in codebase:
- `src/utils/config/mod.rs` - AppConfig
- `src/utils/sqlite.rs` - CustomTableStruct test
- `src/utils/migrations/definitions.rs` - All migrations
