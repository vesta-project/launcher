# Database Architecture Change Summary

## Changes Implemented

### 1. **Snake_case Table Naming** ✅
- Updated `piston-macros` to generate snake_case table names by default
- Added `heck` crate dependency for `ToSnakeCase` conversion
- Tables now use SQL convention: `app_config`, `instance`, `account`, `notification`
- Updated all index definitions to match new naming

### 2. **Separated Database Files** ✅
Two distinct SQLite databases:

#### **app_config.db** (Config Database)
- **Purpose**: Application settings and preferences
- **Tables**: 
  - `app_config` - User preferences, UI settings, system config
  - `schema_migrations` - Migration tracking
- **Location**: `~/.VestaLauncher/app_config.db`
- **Migrations**: Managed by `get_config_migrations()`

#### **vesta.db** (Data Database)
- **Purpose**: User data and application state
- **Tables**:
  - `instance` - Minecraft instances
  - `account` - Microsoft accounts  
  - `notification` - Notification history
  - `schema_migrations` - Migration tracking
- **Location**: `~/.VestaLauncher/vesta.db`
- **Migrations**: Managed by `get_data_migrations()`

### 3. **New Modules** ✅

#### `utils/db_manager.rs`
Centralized database access:
- `get_app_config_dir()` - Returns `~/.VestaLauncher/` directory
- `get_config_db()` - Returns config database connection
- `get_data_db()` - Returns data database connection

#### `utils/data.rs`
Data database initialization:
- `initialize_data_db()` - Runs data migrations on startup

### 4. **Migration System Refactor** ✅

#### `utils/migrations/definitions.rs`
- Split into `get_config_migrations()` and `get_data_migrations()`
- Renamed migration functions for clarity:
  - Config: `migration_001_config_initial_schema()`, `migration_002_app_config()`
  - Data: `migration_001_data_initial_schema()`, `migration_002_instances_table()`, etc.
- Deprecated `get_all_migrations()` with backwards compatibility

### 5. **Updated Module Imports** ✅
- `utils/config/mod.rs` - Uses `get_config_db()` and `get_config_migrations()`
- `notifications.rs` - Uses `get_data_db()` via db_manager
- `main.rs` - Calls both `initialize_config_db()` and `initialize_data_db()` on startup

### 6. **Enhanced Debug Commands** ✅
- `debug_check_tables()` - Shows tables from BOTH databases with prefixes
- `debug_rerun_migrations()` - Reruns migrations for BOTH databases

## Files Modified

### Core Changes
1. `crates/piston-macros/Cargo.toml` - Added `heck = "0.5"`
2. `crates/piston-macros/src/sqlite.rs` - Snake_case conversion
3. `src-tauri/src/utils/migrations/definitions.rs` - Split migrations
4. `src-tauri/src/utils/migrations/mod.rs` - Export new functions
5. `src-tauri/src/utils/config/mod.rs` - Use config DB only
6. `src-tauri/src/notifications.rs` - Use data DB
7. `src-tauri/src/main.rs` - Initialize both DBs

### New Files
8. `src-tauri/src/utils/db_manager.rs` - Centralized DB access
9. `src-tauri/src/utils/data.rs` - Data DB initialization

### Index Updates
10. `src-tauri/src/models/instance.rs` - Snake_case indices
11. `src-tauri/src/models/account.rs` - Snake_case indices
12. `src-tauri/src/models/notification.rs` - Snake_case indices

## Migration Versions

### Config Database (app_config.db)
- `0.1.0` - Initial schema with migration tracking
- `0.2.0` - AppConfig table with all settings

### Data Database (vesta.db)
- `0.1.0` - Initial schema with migration tracking
- `0.3.0` - Instance table
- `0.4.0` - Account table
- `0.5.0` - Notification table

## Testing

### Validation Steps
1. Delete old databases: `Remove-Item "C:\Users\eatha\AppData\Roaming\.VestaLauncher\*.db"`
2. Run dev server: `bun run vesta:dev`
3. Check logs for successful migrations:
   ```
   ✓ Applied migration 0.1.0: Initial config database schema with migration tracking
   ✓ Applied migration 0.2.0: Application configuration table
   ✓ Applied migration 0.1.0: Initial data database schema with migration tracking
   ✓ Applied migration 0.3.0: Minecraft instance management
   ✓ Applied migration 0.4.0: Microsoft OAuth authentication
   ✓ Applied migration 0.5.0: Notification system with progress tracking
   ```
4. Use debug commands in notification-test page:
   - Click "Check Tables" - should show CONFIG and DATA prefixes
   - Verify tables exist in correct databases

### Expected Results
- `app_config.db` contains: `schema_migrations`, `app_config`
- `vesta.db` contains: `schema_migrations`, `instance`, `account`, `notification`
- No "no such table" errors
- All notification commands work correctly

## Benefits of New Architecture

1. **Separation of Concerns**: Config isolated from user data
2. **Independent Backups**: Users can backup vesta.db without config
3. **Safe Resets**: Can reset config without losing data
4. **Migration Independence**: Schema changes don't conflict
5. **Clearer Code**: DB purpose explicit in code
6. **SQL Convention**: Snake_case matches standard SQL practices
7. **Better Debugging**: Debug commands show both DBs clearly

## Breaking Changes

⚠️ **Old databases will not work** - this is a clean break from previous architecture
- All old `app_config.db` data will be reset (user preferences lost)
- All old `vesta.db` data will be reset (instances, accounts, notifications lost)
- This is acceptable for a project in development phase

## Next Steps

1. Test all notification functionality end-to-end
2. Verify config persistence works correctly
3. Test instance and account management (when implemented)
4. Consider adding migration path for production (if needed later)
5. Update documentation to reflect new architecture
