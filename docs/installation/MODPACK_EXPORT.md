# Modpack Export

Vesta Launcher supports exporting Minecraft instances as modpacks in both Modrinth (.mrpack) and CurseForge (.zip) formats. This feature allows users to share their custom mod configurations with others or create backups of their setups.

## Overview

The export system analyzes an instance's mods and configuration files, then creates a distributable modpack that can be installed by Vesta or other compatible launchers. The export process:

1. **Scans** the instance directory for mods and config files
2. **Identifies** mod sources (Modrinth, CurseForge, or custom)
3. **Generates** appropriate manifest files
4. **Packages** everything into a compressed archive

## Export Formats

### Modrinth Format (.mrpack)

Modrinth modpacks use a JSON-based manifest with hash-based file linking:

```json
{
  "formatVersion": 1,
  "game": "minecraft",
  "versionId": "1.0.0",
  "name": "My Custom Modpack",
  "summary": "Exported from Vesta Launcher",
  "dependencies": {
    "minecraft": "1.20.1",
    "fabric-loader": "0.14.21"
  },
  "files": [
    {
      "path": "mods/fabric-api.jar",
      "hashes": {
        "sha1": "abcdef123456...",
        "sha512": "fedcba654321..."
      },
      "downloads": [
        "https://api.modrinth.com/v2/version_file/abcdef123456/download",
        "https://www.curseforge.com/api/v1/mods/306612/files/4618395/download"
      ],
      "fileSize": 1234567,
      "env": {
        "client": "required",
        "server": "required"
      }
    }
  ]
}
```

**Structure:**
```
my-modpack.mrpack
├── modrinth.index.json    # Manifest file
├── mods/                  # Linked or bundled mods
├── config/                # Configuration files
├── resourcepacks/         # Resource packs
├── shaderpacks/           # Shader packs
└── overrides/             # Any files not linked to platforms
```

### CurseForge Format (.zip)

CurseForge modpacks use a numeric ID-based manifest:

```json
{
  "minecraft": {
    "version": "1.20.1",
    "modLoaders": [
      {
        "id": "fabric-0.14.21",
        "primary": true
      }
    ]
  },
  "manifestType": "minecraftModpack",
  "manifestVersion": 1,
  "name": "My Custom Modpack",
  "version": "1.0.0",
  "author": "Username",
  "description": "Exported from Vesta Launcher",
  "files": [
    {
      "projectID": 306612,
      "fileID": 4618395,
      "required": true
    }
  ],
  "overrides": "overrides"
}
```

**Structure:**
```
my-modpack.zip
├── manifest.json          # Manifest file
└── overrides/             # All mods and config files
    ├── mods/
    ├── config/
    └── ...
```

## Export Process

### File Selection

The export dialog presents a hierarchical file browser showing:

- **Mods** (identified by .jar files in mods/ directory)
- **Configuration Files** (config/, defaultconfigs/, etc.)
- **Resource Packs** (resourcepacks/)
- **Shader Packs** (shaderpacks/)
- **Data Packs** (datapacks/)
- **Saves** (can be included optionally)

**Default Selection Logic:**
```typescript
// Default select mods and common config files, skip backups and 0b files
if (!f.path.includes("backups/") && (f.size || 0) > 0) {
    initial.add(f.path);
}
```

### Mod Linking Strategy

#### For Modrinth Format
1. **Platform-Linked Mods**: If a mod has known Modrinth/CurseForge IDs, create download links
2. **Hash Fallback**: For unknown mods, use SHA1/SHA512 hashes for Modrinth's hash-based downloads
3. **Overrides**: Bundle files that can't be linked

#### For CurseForge Format
1. **ID-Based Linking**: Only mods with numeric CurseForge project/file IDs are linked
2. **Hash Resolution**: For mods without IDs, attempt fingerprint-based lookup via CurseForge API
3. **Overrides**: All other files are bundled in the overrides directory

### Metadata Collection

**Required Information:**
- **Modpack Name**: User-defined (defaults to instance name)
- **Version**: Semantic version (defaults to "1.0.0")
- **Author**: Auto-filled from active account
- **Description**: Optional description text
- **Minecraft Version**: Taken from instance
- **Modloader**: Type and version from instance

## Export Dialog

### Metadata Step

The first step collects modpack metadata:

```typescript
const [modpackName, setModpackName] = createSignal(props.instanceName);
const [version, setVersion] = createSignal("1.0.0");
const [author, setAuthor] = createSignal("");
const [description, setDescription] = createSignal("");
const [exportFormat, setExportFormat] = createSignal("modrinth");
```

**Format Selection:**
- **Modrinth**: Recommended for cross-platform compatibility
- **CurseForge**: Required for CurseForge-specific features

### File Selection Step

Interactive tree view for selecting files:

```typescript
const TreeRow = (p: { item: TreeItem; depth: number }) => {
    // Hierarchical display with checkboxes
    // Size calculations for folders
    // Mod identification badges
};
```

**Selection Features:**
- **Hierarchical Selection**: Selecting a folder selects all contents
- **Indeterminate States**: Partial selection indicators
- **File Type Badges**: "Mod" labels for identified mods
- **Size Display**: Individual file and folder sizes

## Backend Processing

### Export Command

```rust
#[tauri::command]
pub async fn export_instance_to_modpack(
    instance_id: i32,
    output_path: String,
    format_str: String,
    selections: Vec<ExportCandidate>,
    modpack_name: String,
    version: String,
    author: String,
    description: String,
) -> Result<(), String>
```

**Parameters:**
- `instance_id`: Database ID of the instance to export
- `output_path`: Full path for the output file
- `format_str`: "modrinth" or "curseforge"
- `selections`: List of files to include
- `modpack_name`, `version`, `author`, `description`: Metadata

### Task Execution

The export runs as an asynchronous task with progress reporting:

```rust
pub struct ModpackExportTask {
    pub instance_name: String,
    pub game_dir: String,
    pub output_path: String,
    pub modpack_format: ModpackFormat,
    pub spec: ExportSpec,
}
```

**Progress Reporting:**
- **File Processing**: Individual file status updates
- **ID Resolution**: For CurseForge format, shows hash lookup progress
- **Compression**: Archive creation progress

### CurseForge ID Resolution

For CurseForge exports, numeric IDs are required. The system attempts to resolve missing IDs:

```rust
// Calculate CurseForge fingerprint
let fp = crate::utils::hash::calculate_curseforge_fingerprint(&full_path)?;

// Lookup via ResourceManager
let (project, version) = rm.get_by_hash(SourcePlatform::CurseForge, &fp.to_string()).await?;
```

## File Processing

### Export Specification

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportSpec {
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: Option<String>,
    pub minecraft_version: String,
    pub modloader_type: String,
    pub modloader_version: String,
    pub entries: Vec<ExportEntry>,
}
```

### Entry Types

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ExportEntry {
    Mod {
        path: PathBuf,
        source_id: String,
        version_id: String,
        platform: Option<ModpackFormat>,
        download_url: Option<String>,
        external_ids: Option<HashMap<String, String>>,
    },
    Override {
        path: PathBuf,
    },
}
```

### Hash Calculation

For Modrinth format, files are hashed for integrity and download linking:

```rust
fn calculate_hashes(path: &Path) -> Result<(String, String)> {
    let mut sha1 = Sha1::new();
    let mut sha512 = Sha512::new();
    // Read file and calculate both hashes
    Ok((sha1_hash, sha512_hash))
}
```

## Output Generation

### Archive Creation

Both formats create ZIP archives with the following process:

1. **Manifest Generation**: Create appropriate JSON manifest
2. **File Processing**: Link or bundle each selected file
3. **Compression**: Add files to ZIP with DEFLATE compression

### Filename Handling

Automatic filename generation with conflict avoidance:

```typescript
const ext = exportFormat() === "modrinth" ? "mrpack" : "zip";
const baseFileName = `${modpackName()} - ${version()}`;
let fileName = `${baseFileName}.${ext}`;

let counter = 1;
while (await invoke("path_exists", { path: fullPath })) {
    fileName = `${baseFileName} (${counter}).${ext}`;
    fullPath = await join(selectedDir, fileName);
    counter++;
}
```

## Integration Points

### UI Access

Export functionality is accessible from:

1. **Instance Details Page**: "Export Modpack" button in Versioning tab
2. **Instance Cards**: Right-click context menu option

### Task Management

Exports run as cancellable background tasks with:

- **Progress Notifications**: Real-time progress updates
- **Completion Notifications**: Success/failure alerts
- **Cancellation Support**: Can be stopped mid-process

### Resource Manager Integration

For ID resolution and metadata fetching:

```rust
// Batch fetch project metadata
let mr_projects = resource_manager
    .get_projects(SourcePlatform::Modrinth, &mr_ids)
    .await?;
```

## Error Handling

### Common Issues

- **Missing Instance**: Instance not found in database
- **Permission Errors**: Cannot write to output directory
- **Corrupted Files**: Files that cannot be hashed or read
- **Network Issues**: For CurseForge ID resolution

### Validation

- **Authentication Check**: Requires valid account (not guest mode)
- **File Existence**: Verifies all selected files exist before export
- **Path Sanitization**: Ensures safe file paths in archives

## Platform Differences

### Modrinth Advantages
- **Hash-Based Downloads**: Works with any mod hosting service
- **Cross-Platform**: Can include mods from multiple sources
- **Flexible Linking**: Supports multiple download URLs per file

### CurseForge Advantages
- **Official Support**: Native CurseForge ecosystem integration
- **Dependency Resolution**: Automatic handling of mod dependencies
- **User Interface**: Rich integration in CurseForge app

## Future Enhancements

### Planned Features
- **Selective Overrides**: Choose which config files to include/exclude
- **Modpack Updates**: Version comparison and update notifications
- **Dependency Analysis**: Automatic inclusion of required dependencies
- **Preview Mode**: Show what will be exported before processing
- **Template Support**: Pre-configured export templates

### Technical Improvements
- **Parallel Processing**: Concurrent file hashing and processing
- **Incremental Exports**: Only re-export changed files
- **Cloud Storage**: Direct upload to hosting platforms
- **Validation Suite**: Pre-export compatibility checking