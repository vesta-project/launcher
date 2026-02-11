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
Caches version and file information:
- `project_id`: Reference to resource_project
- `platform`: Source platform
- `metadata`: JSON blob of version/file data
- `last_updated`: Cache timestamp

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

### 3. Dependency Analysis
- Backend analyzes version dependencies recursively
- Resolves all required dependencies
- Checks for conflicts and version compatibility

### 4. Download and Installation
- Downloads resource files from platform CDN
- Verifies file integrity using hashes
- Extracts archives (for modpacks)
- Places files in appropriate instance directories

### 5. Database Registration
- Creates `installed_resource` records
- Links dependencies in database
- Updates instance resource lists

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

### Cache Invalidation
- **Time-based**: Automatic expiration after configurable periods
- **Version-based**: Invalidation when new versions are detected
- **Manual**: User-triggered cache refresh operations

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
├── datapacks/      # Data pack folders/ZIPs
├── saves/          # World folders
└── config/         # Configuration files (from modpacks)
```

### File Watching
- Monitors all resource directories for changes
- Automatically updates database when files are added/removed
- Triggers UI refresh for real-time status updates
- Handles external modifications (manual installs, other launchers)

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
- `get_resource_versions`: Fetch available versions
- `install_resource`: Download and install resource
- `delete_resource`: Remove installed resource
- `toggle_resource`: Enable/disable resource
- `check_resource_updates`: Check for available updates

### Frontend Events
- `core://resources-updated`: Fired when resources change
- `core://resource-install-progress`: Installation progress updates
- `core://resource-install-error`: Installation failures

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