# Cache and Mirror Systems

This guide explains Vesta's caching architecture, mirror configuration, and how they work together to provide reliable, fast downloads.

## Overview

Vesta uses a content-addressable cache system to store downloaded artifacts (libraries, assets, installers) and a configurable mirror system for fallback download sources. This ensures:

- **Fast reinstalls**: Skip downloads for already-cached files
- **Reliability**: Multiple mirror sources prevent single-point failures
- **Efficiency**: Garbage collection removes unused artifacts
- **Security**: Integrity verification via SHA256 hashes

## Cache Architecture

### Directory Structure
```
data/
├── cache/
│   ├── artifacts.json      # Artifact metadata store
│   ├── install_index.json  # Install manifests
│   └── artifacts/          # Actual cached files (by SHA256)
│       ├── ab/
│       │   └── abc123...   # File: ab/abc123...
│       └── de/
│           └── def456...
```

### Artifact Store (`artifacts.json`)

Content-addressable storage for all downloaded files:

```json
{
  "artifacts": {
    "a1b2c3d4...": {
      "size": 1048576,
      "signature": null,
      "source_url": "https://maven.vesta.gg/net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar",
      "refs": 2,
      "created_at": "2026-02-11T10:00:00Z"
    }
  }
}
```

**Fields:**
- `size`: File size in bytes
- `signature`: Optional PGP signature for verification
- `source_url`: Original download URL
- `refs`: Reference count (how many installs use this artifact)
- `created_at`: When first cached

### Install Index (`install_index.json`)

Tracks which artifacts belong to each installed version:

```json
{
  "installs": {
    "1.20.1-fabric-0.15.11": {
      "loader": "fabric",
      "components": [
        {"name": "client.jar", "sha256": "a1b2...", "path_hint": "versions/1.20.1/client.jar"}
      ],
      "libraries": [
        {"maven": "net.fabricmc:fabric-loader:0.15.11", "sha256": "c3d4..."}
      ],
      "processors": [],
      "reachability": {
        "a1b2...": ["client.jar"],
        "c3d4...": ["libraries/net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar"]
      }
    }
  }
}
```

## Mirror Configuration

### Configuration File (`data/mirrors.json`)

Defines fallback download sources with priority ordering:

```json
{
  "schema_version": 1,
  "mirrors": [
    {
      "name": "Vesta Primary",
      "url": "https://maven.vesta.gg/releases",
      "priority": 100,
      "types": ["libraries", "assets", "installers"],
      "require_https": true,
      "timeout_ms": 10000,
      "fail_fast": false
    },
    {
      "name": "Mojang Official",
      "url": "https://libraries.minecraft.net",
      "priority": 50,
      "types": ["libraries", "assets"],
      "require_https": true,
      "timeout_ms": 15000,
      "fail_fast": true
    }
  ]
}
```

**Mirror Fields:**
- `name`: Human-readable identifier
- `url`: Base URL for the mirror
- `priority`: Higher values tried first
- `types`: What this mirror provides (libraries, assets, installers, processed)
- `require_https`: Enforce HTTPS for security
- `timeout_ms`: Connection timeout
- `fail_fast`: Skip remaining mirrors if this one fails

### Mirror Types

- **libraries**: Maven artifacts (JARs, POMs)
- **assets**: Minecraft resources and textures
- **installers**: Mod loader installers
- **processed**: Pre-processed artifacts (Forge patches, etc.)

## Download Flow

1. **Check Cache**: Look for artifact by SHA256 in `artifacts.json`
2. **If Found**: Verify file exists and matches size/hash, then use cached copy
3. **If Missing**: Try download from mirrors in priority order
4. **On Success**: Store in cache with metadata
5. **On Failure**: Try next mirror or fail

### Fallback Logic

```rust
// Pseudocode for download with mirrors
async fn download_artifact(sha256: &str, maven_path: &str) -> Result<PathBuf> {
    // Check cache first
    if let Some(cached) = cache.get(sha256) {
        return verify_and_return(cached);
    }

    // Try mirrors in priority order
    for mirror in mirrors.sorted_by_priority() {
        if mirror.supports_type("libraries") {
            let url = format!("{}/{}", mirror.url, maven_path);
            match download_with_timeout(url, mirror.timeout_ms).await {
                Ok(data) => {
                    // Verify hash
                    if sha256::digest(&data) == sha256 {
                        // Cache and return
                        return cache.store(sha256, data, mirror.url);
                    }
                }
                Err(_) if mirror.fail_fast => break,
                Err(_) => continue,
            }
        }
    }

    Err("All mirrors failed")
}
```

## Garbage Collection

### Reference Counting
- Each artifact has a `refs` count
- Incremented when used in new install
- Decremented when install removed
- GC removes artifacts with `refs = 0`

### Manual GC
```bash
# Remove unused artifacts
vesta cache gc

# Show cache statistics
vesta cache stats

# Clear all cache (dangerous!)
vesta cache clear
```

### Automatic GC
- Runs after install/uninstall operations
- Configurable retention period in AppConfig
- Can be disabled for debugging

## Configuration

### AppConfig Settings
```sql
-- Cache retention (days)
UPDATE AppConfig SET cache_retention_days = 30;

-- Enable/disable mirrors
UPDATE AppConfig SET use_mirrors = 1;

-- GC on startup
UPDATE AppConfig SET auto_gc = 1;
```

### Environment Variables
```bash
# Disable cache for testing
VESTA_NO_CACHE=1

# Custom mirror config
VESTA_MIRRORS_PATH=/path/to/mirrors.json

# Verbose cache logging
RUST_LOG=vesta_cache=debug
```

## Best Practices

### For Users
- Keep cache enabled for faster launches
- Run GC periodically to free disk space
- Backup `cache/` directory for reinstalls

### For Mirror Operators
- Implement proper HTTP caching headers
- Support range requests for resumable downloads
- Provide consistent URLs (no redirects)
- Monitor for abuse and implement rate limiting

### For Developers
- Always verify SHA256 after download
- Use mirror priorities appropriately
- Handle network failures gracefully
- Test with cache disabled (`VESTA_NO_CACHE=1`)

## Troubleshooting

### Common Issues

**"Download failed: All mirrors failed"**
- Check internet connection
- Verify mirror URLs are accessible
- Try with `VESTA_NO_CACHE=1` to bypass cache

**"Hash mismatch"**
- Corrupted download or cache
- Clear cache: `vesta cache clear`
- Check mirror integrity

**"Out of disk space"**
- Run GC: `vesta cache gc`
- Increase cache retention or free space

**"Mirror timeout"**
- Increase `timeout_ms` in mirrors.json
- Check network latency to mirror hosts

### Debug Commands
```bash
# Show cache contents
vesta cache list

# Verify all cached files
vesta cache verify

# Show mirror health
vesta mirrors health
```