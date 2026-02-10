# 🗄️ Vesta Database System Guide

## Overview

The Vesta project uses **Diesel ORM** for database interactions with SQLite. Schemas are defined in `src-tauri/src/schema.rs`, models in `src-tauri/src/models` and `utils/config`, and migrations are managed via Diesel CLI in `src-tauri/migrations/vesta` and `src-tauri/migrations/config`.

## Current System Architecture

### 1. **Schema Definition** (Single Source of Truth)

Database tables are defined in `src-tauri/src/schema.rs` using Diesel's `table!` macro:

```rust
table! {
    users (id) {
        id -> Integer,
        username -> Text,
        email -> Nullable<Text>,
        created_at -> Timestamp,
    }
}
```

### 2. **Models**

Models are defined in `src-tauri/src/models` using Diesel's derive macros:

```rust
use diesel::prelude::*;
use crate::schema::users;

#[derive(Queryable, Identifiable, Debug)]
#[diesel(table_name = users)]
pub struct User {
    pub id: i32,
    pub username: String,
    pub email: Option<String>,
    pub created_at: chrono::NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = users)]
pub struct NewUser<'a> {
    pub username: &'a str,
    pub email: Option<&'a str>,
}
```

### 3. **Migration System**

Migrations are created using Diesel CLI and stored in `src-tauri/migrations/vesta` (for main data) and `src-tauri/migrations/config` (for app config).

**Commands:**
- Generate migration: `diesel migration generate <name> --migration-dir migrations/vesta`
- Run migrations: Automatic on app startup via `utils::db::run_migrations`.

## How To: Common Tasks

### ✅ Add a New Table

**Step 1: Generate Migration**

```bash
cd vesta-launcher/src-tauri
diesel migration generate create_users_table --migration-dir migrations/vesta
```

**Step 2: Edit Migration Files**

In `migrations/vesta/<timestamp>_create_users_table/up.sql`:

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

In `down.sql`:

```sql
DROP TABLE users;
```

**Step 3: Update Schema**

Run the migration to update `src-tauri/src/schema.rs`:

```bash
diesel migration run --migration-dir migrations/vesta
```

**Step 4: Define Models**

In `src-tauri/src/models/users.rs`:

```rust
use diesel::prelude::*;
use crate::schema::users;

#[derive(Queryable, Identifiable, Debug)]
#[diesel(table_name = users)]
pub struct User {
    pub id: i32,
    pub username: String,
    pub email: Option<String>,
    pub created_at: chrono::NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = users)]
pub struct NewUser<'a> {
    pub username: &'a str,
    pub email: Option<&'a str>,
}
```

**Step 5: Use in Code**

```rust
use diesel::prelude::*;
use crate::models::users::{User, NewUser};
use crate::utils::db::get_vesta_conn;

fn create_user(username: &str, email: Option<&str>) -> Result<User, diesel::result::Error> {
    let conn = &mut get_vesta_conn()?;
    let new_user = NewUser { username, email };
    diesel::insert_into(users::table)
        .values(&new_user)
        .get_result(conn)
}
```

### ✅ Add a Field to Existing Table

**Step 1: Generate Migration**

```bash
diesel migration generate add_verified_to_users --migration-dir migrations/vesta
```

**Step 2: Edit Migration**

`up.sql`:
```sql
ALTER TABLE users ADD COLUMN verified BOOLEAN DEFAULT FALSE;
```

`down.sql`:
```sql
ALTER TABLE users DROP COLUMN verified;
```

**Step 3: Update Schema and Models**

Run migration, then update `schema.rs` and add the field to the `User` struct.

### ✅ Query Data

```rust
use diesel::prelude::*;
use crate::models::users::User;
use crate::schema::users;

fn get_user_by_id(user_id: i32) -> Result<User, diesel::result::Error> {
    let conn = &mut get_vesta_conn()?;
    users::table.find(user_id).first(conn)
}

fn get_all_users() -> Result<Vec<User>, diesel::result::Error> {
    let conn = &mut get_vesta_conn()?;
    users::table.load(conn)
}
```

### ✅ Update Data

```rust
use diesel::prelude::*;
use crate::models::users::User;
use crate::schema::users;

fn verify_user(user_id: i32) -> Result<(), diesel::result::Error> {
    let conn = &mut get_vesta_conn()?;
    diesel::update(users::table.find(user_id))
        .set(users::verified.eq(true))
        .execute(conn)?;
    Ok(())
}
```

### ✅ Delete Data

```rust
use diesel::prelude::*;
use crate::schema::users;

fn delete_user(user_id: i32) -> Result<(), diesel::result::Error> {
    let conn = &mut get_vesta_conn()?;
    diesel::delete(users::table.find(user_id)).execute(conn)?;
    Ok(())
}
```

## Supported Field Types

| Rust Type | Diesel Type | SQLite Type |
|-----------|-------------|-------------|
| `i32` | `Integer` | INTEGER |
| `i64` | `BigInt` | INTEGER |
| `f32` | `Float` | REAL |
| `f64` | `Double` | REAL |
| `String` | `Text` | TEXT |
| `bool` | `Bool` | BOOLEAN |
| `Option<T>` | `Nullable<T>` | NULLABLE |
| `Vec<u8>` | `Binary` | BLOB |
| `chrono::NaiveDateTime` | `Timestamp` | TIMESTAMP |

## Migration Best Practices

1. **Use Diesel CLI** for generating migrations
2. **Test migrations** locally before committing
3. **Provide rollback** in `down.sql`
4. **One change per migration** for clarity
5. **Run migrations** automatically on startup

## Connections

- **Main database:** `get_vesta_conn()` for user data
- **Config database:** `get_config_conn()` for app settings

## Benefits of Diesel

✅ **Type Safety** - Compile-time query checking  
✅ **Performance** - Efficient SQL generation  
✅ **Migrations** - Built-in version control  
✅ **Ecosystem** - Active maintenance and features  
✅ **Flexibility** - Raw SQL when needed  

## Questions?

Check:
- `src-tauri/src/schema.rs` - Table definitions
- `src-tauri/src/models/` - Model structs
- `src-tauri/migrations/` - Migration files
- `src-tauri/src/utils/db.rs` - Connection utilities
