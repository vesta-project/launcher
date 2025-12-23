# PistonMetadata System

## Overview

PistonMetadata is a unified metadata system that aggregates version information from Mojang, Fabric, Quilt, Forge, and NeoForge into a single cached JSON file. This eliminates the need to query multiple APIs during installation and provides instant access to all available game versions and their compatible modloaders.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Launcher Startup                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Load PistonMetadata   │
              │  (from cache or fetch) │
              └────────────┬───────────┘
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
    Cache exists?                       No cache
    Age < 24h?                          or stale
         │                                   │
         ▼                                   ▼
   Use cached                    ┌─────────────────────┐
   metadata.json                 │  Fetch from sources │
                                 └──────────┬──────────┘
                                            │
                      ┌─────────────────────┴─────────────────────┐
                      │                                           │
                      ▼                                           ▼
         ┌─────────────────────────┐               ┌─────────────────────────┐
         │  Mojang API (required)  │               │  Loader APIs (optional) │
         │  piston-meta.mojang.com │               │  - meta.fabricmc.net   │
         └─────────┬───────────────┘               │  - meta.quiltmc.org    │
                   │                               │  - files.minecraftforge │
                   │                               │  - maven.neoforged.net │
                   │                               └───────────┬─────────────┘
                   │                                           │
                   └──────────────┬────────────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │  Merge into unified JSON │
                    │  Save to metadata.json   │
                    └──────────┬───────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────┐
            │  metadata.json cached in data dir   │
            │  %appdata%/.VestaLauncher/data/     │
            └──────────────────────────────────────┘
```

## Data Structure

```json
{
  "last_updated": "2025-11-21T10:30:00Z",
  "latest": {
    "release": "1.21.3",
    "snapshot": "24w45a"
  },
  "game_versions": [
    {
      "id": "1.20.1",
      "version_type": "release",
      "release_time": "2023-06-12T12:00:00Z",
      "stable": true,
      "loaders": {
        "vanilla": [
          {
            "version": "1.20.1",
            "stable": true,
            "metadata": null
          }
        ],
        "fabric": [
          {
            "version": "0.15.11",
            "stable": true,
            "metadata": null
          },
          {
            "version": "0.15.10",
            "stable": true,
            "metadata": null
          }
        ],
        "forge": [
          {
            "version": "47.2.0",
            "stable": true,
            "metadata": null
          },
          {
            "version": "47.1.0",
            "stable": true,
            "metadata": null
          }
        ],
        "quilt": [
          {
            "version": "0.25.0",
            "stable": true,
            "metadata": null
          }
        ]
      }
    }
  ]
}
```

## Usage

### At Launcher Startup

```rust
use piston_lib::game::{load_or_fetch_metadata, refresh_metadata};

#[tokio::main]
async fn main() {
    let data_dir = PathBuf::from("%appdata%/.VestaLauncher/data");
    
    // Option 1: Load cached or fetch if stale (recommended)
    let metadata = load_or_fetch_metadata(&data_dir).await?;
    
    // Option 2: Force refresh (e.g., user clicked "Refresh" button)
    let metadata = refresh_metadata(&data_dir).await?;
    
    println!("Loaded {} game versions", metadata.game_versions.len());
}
```

### During Installation

```rust
use piston_lib::game::{PistonMetadata, ModloaderType};

async fn install_fabric(metadata: &PistonMetadata, game_version: &str) {
    // Get latest stable Fabric version for this game version
    if let Some(loader_version) = metadata.get_latest_loader_version(
        game_version,
        ModloaderType::Fabric
    ) {
        println!("Installing Fabric {} for Minecraft {}", loader_version, game_version);
        // ... proceed with installation
    } else {
        eprintln!("Fabric is not available for Minecraft {}", game_version);
    }
}
```

### Query Helpers

```rust
// Check if specific version combo is available
let is_available = metadata.is_loader_available(
    "1.20.1",
    ModloaderType::Forge,
    Some("47.2.0")
);

// Get all game versions that support Fabric
let fabric_versions = metadata.get_game_versions_for_loader(ModloaderType::Fabric);

// Get metadata for specific game version
if let Some(game_meta) = metadata.get_game_version("1.20.1") {
    println!("Available loaders:");
    for (loader_type, versions) in &game_meta.loaders {
        println!("  {}: {} versions", loader_type.as_str(), versions.len());
    }
}
```

## Cache Behavior

- **Location**: `%appdata%/.VestaLauncher/data/metadata.json`
- **Refresh Interval**: 24 hours (configurable in `cache.rs`)
- **Size**: Typically 500KB - 2MB (depends on number of versions)
- **Fallback**: If individual APIs fail (Fabric, Forge, etc.), metadata still includes Mojang + available loaders

## Error Handling

1. **Mojang API failure**: Installation fails immediately (vanilla data is required)
2. **Loader API failure**: Logs warning, continues with other loaders
3. **Cache read failure**: Falls back to fresh fetch
4. **Network timeout**: Returns error, launcher can retry or use stale cache

## Performance

- **Initial fetch**: ~5-15 seconds (fetches from 5 APIs)
- **Cached load**: <100ms (reads local JSON)
- **Memory usage**: ~5-10MB in-memory representation

## Integration Points

### Fabric/Quilt Installers

```rust
// Before (fetched Fabric API every time):
let loaders_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", version_id);
let loaders: Vec<FabricLoaderVersion> = download_json(&loaders_url).await?;

// After (uses cached metadata):
let metadata = load_or_fetch_metadata(&spec.data_dir()).await?;
let loader_version = metadata.get_latest_loader_version(&spec.version_id, ModloaderType::Fabric)?;
```

### Forge/NeoForge Installers (Future)

```rust
async fn install_forge(spec: &InstallSpec, reporter: &dyn ProgressReporter) -> Result<()> {
    let metadata = load_or_fetch_metadata(&spec.data_dir()).await?;
    
    // Verify Forge is available for this version
    if !metadata.is_loader_available(&spec.version_id, ModloaderType::Forge, spec.modloader_version.as_deref()) {
        return Err(anyhow!("Forge {} is not available for Minecraft {}", 
            spec.modloader_version.as_deref().unwrap_or("latest"),
            spec.version_id
        ));
    }
    
    // ... proceed with installation
}
```

## TODO

- [ ] Add user-configurable cache TTL in settings
- [ ] Add manual cache clear button in UI
- [ ] Add background auto-refresh on startup (non-blocking)
- [ ] Add cache size limits (e.g., keep only last 100 versions)
- [ ] Add delta updates (only fetch changed data)
