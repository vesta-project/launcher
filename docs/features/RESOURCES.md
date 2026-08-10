# Resources System

The Resources system in Vesta Launcher provides comprehensive support for browsing, installing, and managing Minecraft mods and resources from external platforms like Modrinth and CurseForge.

## Overview

Vesta's resource system enables users to discover and install mods, resource packs, shaders, data packs, modpacks, and worlds directly within the launcher. The system integrates seamlessly with instance management, automatically handling dependencies and version compatibility.

## Supported Platforms

### Modrinth
- **Primary Platform**: Open-source platform focused on community-driven content
- **API**: RESTful API with comprehensive metadata
- **Features**: Categories, search, dependency resolution, file hashing

### CurseForge
- **Legacy Platform**: Popular platform with extensive mod library
- **API**: RESTful API with project and file metadata
- **Features**: Categories, search, dependency information

### Smithed
- **Pack Platform**: Datapack-first ecosystem (`api.smithed.dev/v2`); optional companion resource packs ship with the datapack
- **Browse types**: Data Packs only (not listed under Resource Pack search)
- **Artifacts**: A pack version may expose datapack and/or resourcepack downloads (`ResourceVersion.files` with roles); the shared artifact planner installs every recognized artifact as one bundle
- **Description**: Short `display.description` is the summary; `display.webPage` is often an author-hosted markdown URL which the adapter fetches into `description` (falls back to a markdown link if fetch fails / returns HTML)
- **Browse banners**: Search includes the first gallery image URL (`/packs/{id}/gallery/{index}`); the frontend warms those through `resolve_image_urls` (Rust in-memory image cache). Full gallery still loads on project details
- **Authors**: Search/details resolve Firebase owner UIDs via `/users/{id}` (cached) into display names
- **Download URLs**: Direct file URLs install as-is; Modrinth project/version page links are resolved to CDN files when possible; HTML page downloads are rejected with a clear error
- **Browse pagination**: Uses 1-indexed `page` (live API); docs still mention unused `start`
- **Peers / hash lookup**: Not supported

### Source catalog
Platform toggles, sort options, and peer targets are driven by `SourceCapabilities` (Rust) and `RESOURCE_SOURCES` (frontend) rather than hardcoded Modrinth/CurseForge pairs. Search remains **single-source** (`activeSource`).

## Resource Types

The system supports six main resource types:

- **Mods**: Core modifications that change gameplay mechanics
- **Resource Packs**: Client-side assets for textures, sounds, and UI
- **Shaders**: Advanced graphical enhancements using shader programs
- **Data Packs**: Server-side content additions (functions, loot tables, etc.)
- **Modpacks**: Curated collections of mods with configuration
- **Worlds**: Pre-built Minecraft worlds and adventure maps

## Backend Architecture

### ResourceManager

The `ResourceManager` is the core service handling all resource operations:

```rust
pub struct ResourceManager {
    sources: Vec<Arc<dyn ResourceSource>>,
    project_cache: HashMap<(SourcePlatform, String), ResourceProject>,
    version_cache: HashMap<(SourcePlatform, String), Vec<ResourceVersion>>,
    hash_cache: HashMap<(SourcePlatform, String), (ResourceProject, ResourceVersion)>,
    search_cache: HashMap<String, (SearchResponse, NaiveDateTime)>,
    category_cache: HashMap<SourcePlatform, (Vec<ResourceCategory>, NaiveDateTime)>,
}
```

#### Key Features:
- **Multi-platform Support**: Unified interface for Modrinth and CurseForge
- **Intelligent Caching**: In-memory caches with TTL for performance
- **Dependency Resolution**: Automatic resolution of mod dependencies
- **Version Compatibility**: Filtering by Minecraft version and mod loader

### ResourceWatcher

The `ResourceWatcher` monitors the file system for changes to installed resources:

```rust
pub struct ResourceWatcher {
    app_handle: AppHandle,
    watchers: HashMap<PathBuf, (RecommendedWatcher, UnboundedSender<()>)>,
}
```

#### Responsibilities:
- **File System Monitoring**: Watches instance directories for resource changes
- **Database Synchronization**: Keeps database records in sync with file system
- **Automatic Cleanup**: Removes orphaned database entries for deleted files
- **Change Detection**: Triggers UI updates when resources are modified externally

### Database Schema

Resources are stored in the Vesta database with the following key tables:

#### `resource_project`
Stores metadata for discovered projects:
- `id`: Unique project identifier
- `platform`: Source platform (modrinth/curseforge)
- `project_id`: Platform-specific ID
- `resource_type`: Type of resource
- `name`, `summary`, `description`: Display metadata
- `author`, `download_count`: Statistics
- `categories`: Associated categories
- `web_url`: Link to platform page

#### `resource_metadata_cache`
Caches volatile version list data per remote project:
- `source`, `remote_id`: Platform and project identifier (unique key)
- `project_data`: Serialized project payload (preserved across version refreshes)
- `versions_data`: Serialized `Vec<ResourceVersion>` for update comparison
- `last_updated`: When the row was written
- `expires_at`: TTL expiry (30 minutes for version lists)

Read order in `ResourceManager::get_versions`: in-memory `version_cache` → `resource_metadata_cache` → platform API.

#### `instance_resource_update_check`
Caches per-instance update check results:
- `instance_id`: Associated instance (primary key)
- `checked_at`: When the last check completed
- `results_json`: Serialized update candidates + modpack versions
- `instance_fingerprint`: Hash of MC version, loader, and modpack version for invalidation

Snapshot TTL is 5 minutes. Fresh snapshots are returned without network calls; stale or forced checks recompute using cached version lists when possible.

#### `installed_resource`
Tracks installed resources per instance:
- `id`: Auto-increment primary key
- `instance_id`: Associated instance
- `project_id`: Reference to resource_project
- `version_id`: Installed version ID
- `filename`: Installed file name
- `hash`: File hash for integrity
- `enabled`: Whether resource is active
- `installed_at`: Installation timestamp

## Frontend Integration

### Resource Store

The frontend uses a SolidJS store for state management:

```typescript
export type ResourceState = {
    selectedInstanceId: number | null;
    resourceType: ResourceType;
    gameVersion: string | null;
    loader: string | null;
    searchQuery: string;
    categories: ResourceCategory[];
    searchResults: SearchResponse | null;
    selectedProject: ResourceProject | null;
    versions: ResourceVersion[];
    installedResources: InstalledResource[];
    installingProjectIds: string[];
    installingVersionIds: string[];
};
```

### Key Components

#### ResourceBrowser
Main browsing interface with:
- Platform and type selection
- Search and filtering
- Category navigation
- Instance association

#### ResourceDetails
Detailed view for individual resources:
- Version selection
- Dependency display
- Installation status
- Compatibility checking

## Installation Process

### 1. Discovery and Selection
- User browses or searches for resources
- Frontend queries backend for project metadata
- Results cached for performance

### 2. Version Resolution
- Backend fetches available versions for selected project
- Filters by Minecraft version and mod loader compatibility
- Presents version options to user
- Datapacks select their World before quick version resolution and ignore the
  Instance mod loader
- Modrinth mixed projects retain only versions tagged with the `datapack`
  loader; CurseForge uses its datapack project class
- Only an exact provider tag for the World's saved Minecraft version may be
  selected automatically. Nearby, wildcard, unlisted, and unknown matches
  require explicit version selection and acknowledgement

### 3. Dependency Analysis
- Backend analyzes version dependencies recursively
- Resolves all required dependencies
- Checks for conflicts and version compatibility

### 4. Download and Installation
- Plans all version artifacts before downloading and rejects unknown roles
- Downloads and verifies the complete bundle in a unique staging directory
- Publishes all files atomically, rolling back the bundle if any artifact fails
- Places datapacks in the selected world's `datapacks` directory
- Safely extracts world archives into collision-free directories under `saves`
- Delegates modpack archives to the existing modpack workflow

### 5. Database Registration
- Creates `installed_resource` records
- Links dependencies in database
- Updates Instance resource lists for Instance-owned files and the dedicated
  World datapack view for World-owned files

## Dependency Resolution

The system implements sophisticated dependency resolution:

### Algorithm Overview
1. **Root Dependencies**: Start with explicitly requested resource
2. **Recursive Resolution**: For each dependency, resolve its dependencies
3. **Conflict Detection**: Identify version conflicts between dependencies
4. **Backtracking**: Use backtracking to find compatible version combinations
5. **Optimization**: Prefer latest stable versions when possible

### Dependency Types
- **Required**: Must be installed for resource to function
- **Optional**: Recommended but not required
- **Incompatible**: Known conflicts that prevent installation
- **Embedded**: Dependencies included in the main download

## Caching Strategy

### Multi-Level Caching
1. **Memory Cache**: Fast in-process caching with TTL
2. **Database Cache**: Persistent caching of API responses
3. **File Cache**: Local storage of downloaded files

### Durable Project Cache (2026-04)
The backend now treats resource project card data as durable and backend-owned.

- `resource_project` persists linkage and display metadata indefinitely, including:
    - `id`, `source`, `project_type`
    - `name`, `summary`, `description`
    - `icon_url`, `icon_data`
    - `last_updated`, `metadata_synced_at`, `icon_synced_at`
- `resource_metadata_cache` stores version lists with a 30-minute TTL for update comparison.
- `instance_resource_update_check` stores per-instance update snapshots with a 5-minute TTL.
- `get_or_hydrate_resource_projects` command accepts `[{ platform, id }]` refs and:
    - returns existing durable rows immediately
    - hydrates missing/incomplete rows from backend sources when network is allowed
    - keeps old icon bytes if refresh download fails, preventing icon regressions

This allows instance resource views to request backend-hydrated project records instead of relying on frontend URL fetches.

### Cache Invalidation
- **Time-based**: Version cache (30 min), instance update snapshots (5 min)
- **Fingerprint-based**: Instance snapshot invalidated when MC version, loader, or modpack version changes
- **Event-based**: Snapshots cleared on resource install, update, or delete
- **Manual**: `forceRefresh` on `check_instance_updates_lightweight` bypasses snapshot and version cache

### Performance Benefits
- Reduced API calls to external platforms
- Faster search and browsing
- Offline capability for previously accessed resources

## File System Integration

### Directory Structure
Resources are installed in standard Minecraft directories:

```
instance/
├── mods/           # Mod JAR files
├── resourcepacks/  # Resource pack ZIPs
├── shaderpacks/    # Shader pack folders/ZIPs
├── saves/          # Java folder worlds
│   └── My World/
│       ├── level.dat
│       ├── datapacks/  # World-scoped data pack folders/ZIPs
│       └── .vesta/world.json  # Optional Vesta identity/provenance
└── config/         # Configuration files (from modpacks)
```

### File Watching
- Watches instance resource directories, `saves` topology, and each known
  world's `datapacks` directory without recursively watching region data
- Automatically updates database when files are added/removed
- Triggers UI refresh for real-time status updates
- Handles external modifications (manual installs, other launchers)

### World Ownership

Java folder worlds are filesystem-owned directories, not `installed_resource`
rows. Vesta discovers immediate children of `saves` through root `level.dat` or
`level.dat_old` and leaves internal layouts opaque. Listing an existing world is
read-only. Vesta creates `.vesta/world.json` only when it installs a world or
datapack, or moves, copies, or duplicates a world.

World archives are preflighted before extraction. Unsafe paths, links, case
collisions, unreasonable expansion, and archives without a Java folder world
are rejected. Archives with multiple worlds require a candidate selection or
explicit install-all action and never overwrite or merge existing worlds.

The Installed Resource Ledger continues to own installed files. Datapack rows
are scoped by their exact path under a world, while companion resource-pack rows
remain instance-scoped and are linked through the portable world manifest.
Datapacks are not shown in the Instance Resources tab or its batch/update state.
Clicking a World opens its dedicated datapack view, where direct file packs can
be enabled, removed, checked for updates, or used as an exact update target.
Directory-form datapacks are counted and listed read-only. Listing never creates
World metadata, and the same remote datapack can be installed independently in
several Worlds.

## Error Handling

### Common Issues
- **Network Failures**: Retry logic with exponential backoff
- **Version Conflicts**: Clear error messages with resolution suggestions
- **Corrupted Downloads**: Hash verification and re-download
- **Platform API Limits**: Rate limiting and quota management

### Recovery Mechanisms
- **Partial Install Cleanup**: Rolls back failed installations
- **Cache Corruption**: Automatic cache rebuilding
- **Database Inconsistencies**: Synchronization and repair operations

## API Integration

### Backend Commands
- `get_resource_categories`: Fetch available categories
- `search_resources`: Search projects with filters
- `get_resource_project`: Get detailed project info
- `get_resource_versions`: Fetch available versions (uses layered version cache)
- `check_instance_updates_lightweight`: Check instance for resource/modpack updates (uses snapshot + version cache)
- `get_instance_update_snapshot`: Read cached update snapshot without triggering a check
- `install_resource`: Download and install resource
- `list_instance_worlds`: Discover and summarize Java worlds for one Instance
- `open_world_folder`: Open a validated world directory
- `list_world_datapacks`: List direct datapack entries and exact Ledger facts for one World
- `check_world_datapack_updates`: Check one World's remote datapacks against its saved version
- `open_world_datapacks_folder`: Open the validated World datapacks directory
- `toggle_world_datapack`: Toggle an exact file-form datapack in one World
- `delete_world_datapack`: Remove an exact file-form datapack from one World
- `transfer_world`: Submit a safe move, copy, or duplicate World task
- `submit_world_archive_selection`: Continue or cancel a multi-world archive install
- `delete_resource`: Remove installed resource
- `toggle_resource`: Enable/disable resource
- `rescan_instance_resources`: Discover local rows and batch-identify all or selected unresolved resources
- `check_resource_updates`: Check for available updates

### Frontend Events
- `core://instance-resource-rows-changed`: Local resource rows changed for one Instance
- `core://instance-resource-metadata-changed`: Cached project metadata changed for source-aware project refs
- `core://resource-install-progress`: Installation progress updates
- `core://resource-install-error`: Installation failures
- `core://instance-worlds-changed`: World topology or managed contents changed for one Instance
- `core://world-datapacks-changed`: Datapack contents changed for one exact WorldRef
- `core://world-install-selection-required`: A world archive needs candidate selection

## Future Enhancements

### Planned Features
- **Bulk Operations**: Install multiple resources simultaneously
- **Update Management**: Automatic update notifications and installation
- **Backup/Restore**: Resource configuration snapshots
- **Sharing**: Export resource lists and configurations
- **Advanced Filtering**: More sophisticated search and filter options

### Performance Optimizations
- **Parallel Downloads**: Concurrent resource downloading
- **Delta Updates**: Incremental updates for large resources
- **CDN Optimization**: Intelligent mirror selection
- **Background Processing**: Non-blocking installation operations
