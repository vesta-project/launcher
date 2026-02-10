# Quick Reference: Vesta Database System (Diesel)

## 🚀 Quick Start: Add a New Table

```bash
# 1. Generate migration
cd vesta-launcher/src-tauri
diesel migration generate create_your_table --migration-dir migrations/vesta
```

```sql
-- 2. Edit up.sql
CREATE TABLE your_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    optional_field TEXT
);

-- 3. Edit down.sql
DROP TABLE your_table;
```

```rust
// 4. Run migration and update schema.rs
diesel migration run --migration-dir migrations/vesta
```

```rust
// 5. Define models in src/models/your_table.rs
use diesel::prelude::*;
use crate::schema::your_table;

#[derive(Queryable, Identifiable, Debug)]
#[diesel(table_name = your_table)]
pub struct YourTable {
    pub id: i32,
    pub name: String,
    pub is_active: bool,
    pub optional_field: Option<String>,
}

#[derive(Insertable)]
#[diesel(table_name = your_table)]
pub struct NewYourTable<'a> {
    pub name: &'a str,
    pub is_active: bool,
    pub optional_field: Option<&'a str>,
}
```

## 📝 CRUD Operations Cheat Sheet

```rust
use diesel::prelude::*;
use crate::models::your_table::{YourTable, NewYourTable};
use crate::schema::your_table;

// CREATE
let new_item = NewYourTable {
    name: "example",
    is_active: true,
    optional_field: None,
};
let conn = &mut get_vesta_conn()?;
diesel::insert_into(your_table::table)
    .values(&new_item)
    .execute(conn)?;

// READ (by ID)
let item = your_table::table.find(item_id).first::<YourTable>(conn)?;

// READ (all)
let items = your_table::table.load::<YourTable>(conn)?;

// READ (filtered)
let active_items = your_table::table
    .filter(your_table::is_active.eq(true))
    .load::<YourTable>(conn)?;

// UPDATE
diesel::update(your_table::table.find(item_id))
    .set(your_table::name.eq("new name"))
    .execute(conn)?;

// DELETE
diesel::delete(your_table::table.find(item_id)).execute(conn)?;
```

## 🏷️ Diesel Derive Attributes

### Queryable (for reading)
```rust
#[derive(Queryable, Identifiable, Debug)]
#[diesel(table_name = your_table)]
pub struct YourTable {
    // fields...
}
```

### Insertable (for creating)
```rust
#[derive(Insertable)]
#[diesel(table_name = your_table)]
pub struct NewYourTable<'a> {
    // fields without id...
}
```

### AsChangeset (for updating)
```rust
#[derive(AsChangeset)]
#[diesel(table_name = your_table)]
pub struct UpdateYourTable<'a> {
    pub name: Option<&'a str>,
    pub is_active: Option<bool>,
}
```

## 📊 Type Mapping

| Rust | Diesel Type | SQLite |
|------|-------------|--------|
| `i32` | `Integer` | INTEGER |
| `i64` | `BigInt` | INTEGER |
| `String` | `Text` | TEXT |
| `bool` | `Bool` | BOOLEAN |
| `Option<T>` | `Nullable<T>` | NULLABLE |
| `Vec<u8>` | `Binary` | BLOB |
| `chrono::NaiveDateTime` | `Timestamp` | TIMESTAMP |

## 🔄 Adding Fields (Migration Pattern)

```bash
# 1. Generate migration
diesel migration generate add_field_to_your_table --migration-dir migrations/vesta
```

```sql
-- up.sql
ALTER TABLE your_table ADD COLUMN new_field TEXT DEFAULT 'default_value';
```

```sql
-- down.sql
ALTER TABLE your_table DROP COLUMN new_field;
```

```rust
// 2. Update model struct
#[derive(Queryable, Identifiable, Debug)]
#[diesel(table_name = your_table)]
pub struct YourTable {
    // ... existing fields ...
    pub new_field: String,  // Add here
}
```

## ⚙️ Database Connections

```rust
// Main database
use crate::utils::db::get_vesta_conn;
let conn = &mut get_vesta_conn()?;

// Config database
use crate::utils::db::get_config_conn;
let conn = &mut get_config_conn()?;
```

## 🧪 Testing

```bash
# Run all tests
cargo test

# Run specific test
cargo test your_table

# Build and check
cargo build
```

## 📋 Migration Checklist

- [ ] Generate migration with `diesel migration generate`
- [ ] Edit `up.sql` and `down.sql`
- [ ] Run `diesel migration run`
- [ ] Update model structs
- [ ] Test with `cargo test`
- [ ] Update queries if needed

## 🚨 Common Pitfalls

❌ **Don't:**
- Edit existing migration files
- Forget to run migrations after editing
- Use wrong table name in `#[diesel(table_name = ...)]`
- Mix up main vs config database

✅ **Do:**
- Use `diesel migration run` to apply changes
- Test migrations with `diesel migration revert`
- Keep model structs in sync with schema
- Use proper Diesel derives

## 📚 Examples

Full examples in codebase:
- `src-tauri/src/schema.rs` - Table definitions
- `src-tauri/src/models/` - Model structs
- `src-tauri/migrations/` - Migration files
