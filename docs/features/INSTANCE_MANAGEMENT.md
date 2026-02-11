# Instance Management

Vesta Launcher provides comprehensive instance management for Minecraft installations, allowing users to create, configure, and maintain multiple isolated game environments. This system supports both manual and modpack-linked instances with advanced maintenance operations.

## Overview

An instance represents a complete Minecraft installation with specific:
- Minecraft version
- Mod loader and version
- Java runtime settings
- Mods, resource packs, and configurations
- Optional modpack linkage for automated updates

## Database Schema

Instances are stored in the `instances` table with the following key fields:

```sql
CREATE TABLE instances (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    minecraft_version TEXT NOT NULL,
    modloader TEXT,
    modloader_version TEXT,
    java_path TEXT,
    java_args TEXT,
    game_directory TEXT,
    width INTEGER DEFAULT 854,
    height INTEGER DEFAULT 480,
    icon_path TEXT,
    last_played TEXT,
    total_playtime_minutes INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    installation_status TEXT,
    crashed BOOLEAN,
    crash_details TEXT,
    min_memory INTEGER DEFAULT 1024,
    max_memory INTEGER DEFAULT 4096,
    -- Modpack linkage fields
    modpack_id TEXT,
    modpack_version_id TEXT,
    modpack_platform TEXT,
    modpack_icon_url TEXT,
    icon_data BLOB,
    last_operation TEXT
);
```

### Modpack Linking

Linked instances are tied to external modpacks (Modrinth, CurseForge):
- `modpack_id`: Platform-specific identifier
- `modpack_version_id`: Specific version identifier
- `modpack_platform`: "modrinth" or "curseforge"
- `modpack_icon_url`: Icon for display

## Instance Operations

### Creation
- **Manual**: User selects Minecraft version, modloader, and settings
- **From Modpack**: Imports from Modrinth/CurseForge with automatic configuration
- **Clone**: Duplicates existing instance with unique name generation

### Maintenance Tasks

#### Repair Task
Verifies and restores instance integrity:
- Checks Minecraft assets and libraries
- For linked instances: Validates all manifest files
- Downloads missing or corrupted files
- Reports progress via notifications

#### Reset Task
Performs complete instance reinstallation:
- Wipes instance directory
- Reinstalls from source (manual config or modpack manifest)
- Preserves instance metadata

#### Clone Task
Creates duplicate instances:
- Recursive directory copy
- Database entry duplication
- Automatic name uniqueness (e.g., "My Pack (2)")

### Strict Sync (Linked Instances)
Pre-launch verification for modpack-linked instances:
- Fetches current manifest
- Downloads missing files
- Removes unauthorized modifications
- Enforces file integrity

## Frontend Integration

### Instance Store
Located in `src/stores/instances.ts`, manages:
- Instance list with reactive updates
- Launch status tracking (`launchingIds`, `runningIds`)
- CRUD operations via Tauri commands

### Instance Details Page
Provides comprehensive management UI:
- **General Tab**: Basic settings, Java configuration
- **Mods Tab**: Resource management integration
- **Versioning Tab**: Maintenance operations, modpack linking

### Pinning System
Instances can be pinned to sidebar for quick access with:
- Real-time status indicators
- Quick launch actions
- Drag-and-drop reordering

## Backend Implementation

### Commands (`src-tauri/src/commands/instances.rs`)
Core CRUD operations:
- `get_instances`: Retrieve all instances
- `create_instance`: New instance creation
- `update_instance`: Modify settings
- `delete_instance`: Remove instance
- `launch_instance`: Start game process
- `kill_instance`: Terminate running instance

### Tasks (`src-tauri/src/tasks/`)
Specialized operations:
- `InstallInstanceTask`: Initial setup
- `RepairInstanceTask`: Integrity restoration
- `ResetInstanceTask`: Clean reinstall
- `CloneInstanceTask`: Duplication

### Playtime Tracking
Automatic session logging:
- Captures launch/exit timestamps
- Updates `total_playtime_minutes`
- Persists across sessions

## File Structure

```
instances/
├── {instance-slug}/
│   ├── mods/
│   ├── resourcepacks/
│   ├── shaderpacks/
│   ├── config/
│   ├── saves/
│   ├── .minecraft/  (symlinked or copied)
│   └── manifest.json (for linked instances)
```

## Error Handling

- **Crash Detection**: Tracks `crashed` status with details
- **Operation Logging**: `last_operation` field for debugging
- **Validation**: Prevents invalid configurations
- **Recovery**: Repair/reset options for corrupted instances

## Future Extensions

- **InstanceManager**: Centralized manager class (currently planned)
- **Version Control**: Git-like instance snapshots
- **Cloud Sync**: Cross-device instance synchronization
- **Advanced Modpack Features**: Custom overrides, optional files</content>
<parameter name="filePath">v:\launcher\docs\features\INSTANCE_MANAGEMENT.md