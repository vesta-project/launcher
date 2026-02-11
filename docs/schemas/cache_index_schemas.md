# Configuration, Cache, and Mirror Schemas

This document specifies the schemas used by Vesta for configuration, caching, artifact storage, and mirror management.

## Artifact Store (`cache/artifacts.json`)

- id: SHA256 hex (lowercase)
- size: integer bytes
- signature: optional ASCII-armored PGP or detached signature reference
- source_url: optional canonical URL for provenance
- refs: integer refcount (computed), do not edit by hand

Example:

```json
{
  "sha256": "f2a1...",
  "size": 1048576,
  "signature": null,
  "source_url": "https://example.com/lib.jar",
  "refs": 3
}
```

## Install Index (`cache/install_index.json`)

- version_id: string (e.g., "1.20.1-fabric-0.15.11")
- loader: enum { vanilla, fabric, quilt, forge, neoforge }
- components: array of items { name, sha256, path_hint }
- processors: array of items { id, sha256, args }
- libraries: array of items { maven, sha256, natives? }
- reachability: graph edges to artifacts (computed from above)

Example:

```json
{
  "version_id": "1.20.1-fabric-0.15.11",
  "loader": "fabric",
  "components": [
    { "name": "client.jar", "sha256": "a1b2...", "path_hint": "versions/1.20.1/client.jar" }
  ],
  "processors": [
    { "id": "strip_meta", "sha256": "c3d4...", "args": ["--safe"] }
  ],
  "libraries": [
    { "maven": "net.fabricmc.fabric-loader:0.15.11", "sha256": "dead..." }
  ],
  "reachability": {
    "a1b2...": ["client.jar"],
    "dead...": ["fabric-loader"]
  }
}
```

## GC Policy

- Prune only artifacts with `refs == 0` and no incoming edges in `reachability`
- Quarantine suspicious blobs (mismatch hash/signature) instead of deleting
- Respect server/headless profiles; shared libs remain unless explicitly unlinked

## Conventions

- Paths align with `vesta_preferences.md` (`AppData/Vesta/...`) and shared `libraries/`
- All hashes are SHA256; avoid weaker algorithms
- Installer adapters must populate the index consistently

## Vesta Configuration Schema (`vesta.config.json`)

The main configuration file controls launcher behavior, paths, and preferences. Located at `%APPDATA%/VestaLauncher/config/vesta.config.json`.

### Schema Version
- `schema_version`: integer (currently 1) - Increment on breaking changes

### Profile Section
- `profile.id`: string - Unique profile identifier
- `profile.name`: string - Human-readable profile name
- `profile.game_directory`: string - Base directory for game files (supports %APPDATA% expansion)
- `profile.backups.enabled`: boolean - Whether to create backups before modifications
- `profile.backups.max_entries`: integer - Maximum number of backup entries to retain
- `profile.backups.location`: string - Directory for backup storage

### Java Section
- `java.runtime_preference`: string - Preferred JVM runtime (e.g., "temurin-17-x86_64")
- `java.min_heap_mb`: integer - Minimum JVM heap size in MB
- `java.max_heap_mb`: integer - Maximum JVM heap size in MB
- `java.use_custom_runtime`: boolean - Whether to use a custom JVM path

### Downloads Section
- `downloads.max_parallel`: integer - Maximum concurrent download connections
- `downloads.retry_limit`: integer - Number of retry attempts for failed downloads
- `downloads.checksum_policy`: enum ("require"|"warn"|"skip") - How to handle checksum verification
- `downloads.quarantine_on_failure`: boolean - Whether to quarantine files with checksum failures

### Cache Section
- `cache.path`: string - Directory for cached artifacts
- `cache.max_bytes`: integer - Maximum cache size in bytes
- `cache.prune_on_exit`: boolean - Whether to clean cache on launcher exit

### Telemetry Section
- `telemetry.enabled`: boolean - Whether to send anonymous usage statistics
- `telemetry.include_system_fingerprint`: boolean - Whether to include system identification

### Notifications Section
- `notifications.persist_completed_tasks`: boolean - Whether to keep completed task notifications
- `notifications.dismiss_after_seconds`: integer - Auto-dismiss delay for notifications

## Mirror Configuration Schema (`mirrors.json`)

Defines external mirrors for downloading libraries, assets, and other artifacts. Supports fallback and load balancing.

### Schema Version
- `schema_version`: integer (currently 1)

### Mirrors Array
Each mirror object contains:
- `name`: string - Human-readable mirror name
- `url`: string - Base URL for the mirror
- `priority`: integer - Priority value (higher = preferred)
- `types`: array of strings - Content types served ("libraries", "assets", "installers", "processed")
- `require_https`: boolean - Whether to enforce HTTPS
- `timeout_ms`: integer - Request timeout in milliseconds
- `fail_fast`: boolean - Whether to skip this mirror on first failure

### Mirror Selection Logic
- Mirrors are sorted by priority (descending)
- Requests try mirrors in order until success or all fail
- Different content types can use different mirror sets
- Local file:// mirrors supported for air-gapped deployments
