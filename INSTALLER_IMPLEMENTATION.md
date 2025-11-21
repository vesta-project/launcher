# Game Installer Implementation Summary

## Overview
Implemented a comprehensive Minecraft game installation system for Vesta Launcher with support for 5 modloader types: Vanilla, Fabric, Quilt, Forge, and NeoForge.

## Architecture

### Core Components

#### 1. **Installer Framework** (`crates/piston-lib/src/game/installer/`)
- **types.rs**: Core types and traits
  - `ProgressReporter` trait: 7 methods for reporting installation progress
  - `InstallSpec`: Configuration struct with version, modloader, paths
  - `ModloaderType` enum: Vanilla, Fabric, Quilt, Forge, NeoForge
  - `OsType` and `Arch`: Platform detection utilities
  - `CancelToken`: Wrapper for cancellation signals
  
- **downloader.rs**: HTTP download utilities
  - `download_to_path()`: Streaming downloads with progress reporting
  - SHA1 validation for file integrity
  - 3-retry exponential backoff for reliability
  - `extract_zip()`: Archive extraction with Unix permission preservation

- **jre_manager.rs**: Java Runtime Environment management
  - Auto-download Zulu JRE from api.azul.com
  - Platform-specific archive handling (tar.gz for Unix, zip for Windows)
  - `find_java_executable()`: Smart executable discovery
  - `detect_system_java()`: Fallback to system Java

#### 2. **Vanilla Installer** (`vanilla.rs`)
Fully implemented with 8-step process:
1. Download version manifest from Mojang Piston Meta API
2. Download version-specific JSON to `data/versions/{id}/{id}.json`
3. Download client JAR
4. Download asset index
5. Download all asset objects to `data/assets/objects/`
6. Download and extract libraries + natives
7. Get or install JRE (auto-downloads Zulu if needed)
8. Finalize installation

Features:
- Rules evaluation for platform-specific libraries
- Native library extraction with pattern exclusion
- SHA1 validation on all downloads
- Progress reporting at each step

#### 3. **Modloader Installers** (`fabric.rs`, `quilt.rs`, `forge.rs`, `neoforge.rs`)
Status: **Stub implementations**
- All call `install_vanilla()` as base installation
- Marked with TODO comments outlining required steps:
  - **Fabric/Quilt**: Fetch meta API, download profile JSON, merge with vanilla PartialVersionInfo, download loader libraries
  - **Forge/NeoForge**: Download installer JAR, extract install_profile.json + version.json, parse processors, run processors or extract processed files, download Forge-specific libraries

#### 4. **Tauri Integration** (`src-tauri/src/tasks/installers/`)
- **InstallInstanceTask**: Implements `Task` trait for TaskManager
- **TauriProgressReporter**: Bridges piston-lib to Tauri notification system
  - Forwards progress updates to NotificationManager
  - Uses indeterminate progress (-1) for step transitions
  - Converts to "Patient" notification type on completion

#### 5. **Command Integration** (`src-tauri/src/commands/instances.rs`)
- `install_instance` command: Queues installation task
- Receives `Instance` from frontend
- Creates InstallInstanceTask and submits to TaskManager

## Data Organization

### Storage Paths
All data stored under: `%appdata%/.VestaLauncher/`

```
data/
├── libraries/       # Shared Minecraft libraries
├── assets/          # Game assets (sounds, textures, etc.)
│   ├── indexes/     # Asset index JSON files
│   └── objects/     # Asset files organized by hash
├── versions/        # Version-specific files
│   └── {version}/
│       ├── {version}.json
│       └── {version}.jar
├── jre/             # Java Runtime Environments
│   └── zulu-{major}/
└── instances/       # Instance-specific game directories
    └── {instance_name}/
        └── natives/ # Extracted native libraries

logs/                # Application logs (30-day retention)
```

## Logging Infrastructure

### Configuration
- **Plugin**: tauri-plugin-log 2.7.1
- **Targets**: Stdout, LogDir, Webview
- **Level**: Info
- **Timezone**: UseLocal
- **Rotation**: KeepAll with 10MB file limit
- **Retention**: 30 days (auto-cleanup on startup)

### Implementation
- Added to `src-tauri/src/main.rs`
- Cleanup function in `src-tauri/src/setup.rs`
- Logs async installation progress

## Dependencies

### piston-lib (`crates/piston-lib/Cargo.toml`)
```toml
anyhow = "1.0.100"
reqwest = { version = "0.11", features = ["stream"] }
tokio = { version = "1.48.0", features = ["full"] }
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.145"
futures = "0.3"
sha1 = "0.10"
zip = "2.2"
log = "0.4.28"
flate2 = "1.0"
tar = "0.4"
```

### vesta-launcher (`vesta-launcher/src-tauri/Cargo.toml`)
- Added: `futures = "0.3"`

## Testing

### Test Infrastructure (`crates/piston-lib/src/game/installer/tests.rs`)
- **MockProgressReporter**: Tracks all progress calls for validation
- **Unit Tests**: OS detection, Arch detection, ModloaderType serialization
- **TODO**: Integration tests with mock HTTP server (httpmock/wiremock)

### Validation
```bash
cargo check --workspace  # All checks pass ✓
cargo build --release    # Successful build ✓
```

## Known Issues / TODO

### High Priority
1. **Implement Fabric Installer**
   - Fetch https://meta.fabricmc.net/v2/versions
   - Download loader profile JSON
   - Merge with vanilla PartialVersionInfo
   - Download Fabric libraries from maven

2. **Implement Quilt Installer**
   - Fetch https://meta.quiltmc.org/v3/versions
   - Similar to Fabric with different endpoints

3. **Implement Forge Installer**
   - Download installer JAR from maven.minecraftforge.net
   - Extract install_profile.json and version.json
   - Parse processors array
   - Run processors or extract pre-processed files (Modrinth Daedalus pattern)

4. **Implement NeoForge Installer**
   - Similar to Forge but use maven.neoforged.net
   - Handle version parsing differences

### Medium Priority
5. **Integration Tests**
   - Mock HTTP server for Mojang API
   - Test fixtures for version manifests
   - Validate file layout after installation

6. **Error Handling**
   - Improve error messages for network failures
   - Add retry UI feedback
   - Validate disk space before installation

### Low Priority
7. **InstanceManager**
   - Currently commented out in setup.rs
   - Needed for tracking running instances

8. **Performance Optimizations**
   - Parallel asset downloads (currently sequential)
   - Download queue with configurable concurrency
   - Resume interrupted downloads

## API References

### Mojang Piston Meta
- Version Manifest: https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
- Version JSON: https://piston-meta.mojang.com/v1/packages/{hash}/{version}.json

### Zulu JRE
- API Base: https://api.azul.com/metadata/v1/zulu/packages
- Query Params: os, arch, hw_bitness, bundle_type, java_version, javafx_bundled, ext

### Fabric
- Meta API: https://meta.fabricmc.net/v2/versions
- Loader: https://meta.fabricmc.net/v2/versions/loader/{game_version}/{loader_version}/profile/json

### Quilt
- Meta API: https://meta.quiltmc.org/v3/versions
- Loader: https://meta.quiltmc.org/v3/versions/loader/{game_version}/{loader_version}/profile/json

### Forge
- Maven: https://maven.minecraftforge.net/net/minecraftforge/forge/
- Installer: {maven}/{version}/forge-{version}-installer.jar

### NeoForge
- Maven: https://maven.neoforged.net/net/neoforged/neoforge/
- Installer: {maven}/{version}/neoforge-{version}-installer.jar

## Usage Example

```rust
use piston_lib::game::installer::*;

// Create installation spec
let spec = InstallSpec {
    version_id: "1.21.1".to_string(),
    modloader: Some(ModloaderType::Fabric),
    modloader_version: Some("0.16.0".to_string()),
    data_dir: PathBuf::from("C:/Users/User/AppData/Roaming/.VestaLauncher/data"),
    game_dir: PathBuf::from("C:/Users/User/AppData/Roaming/.VestaLauncher/data/instances/MyInstance"),
    java_path: None, // Auto-detect or download
};

// Create progress reporter
let reporter = MyProgressReporter::new();

// Install
install_instance(spec, &reporter).await?;
```

## Next Steps

1. **Immediate**: Test vanilla installer with real Minecraft version
2. **Short-term**: Implement Fabric/Quilt installers (simpler than Forge)
3. **Medium-term**: Implement Forge/NeoForge with processor execution
4. **Long-term**: Add comprehensive integration tests and error recovery

## References

- NexusLauncher: https://github.com/DrinksJuice/NexusLauncher (PistonMetadata pattern)
- Modrinth Daedalus: https://github.com/modrinth/daedalus (Forge processor handling)
- Tauri Documentation: https://v2.tauri.app/
- Mojang Launcher Docs: https://minecraft.fandom.com/wiki/Client.json
