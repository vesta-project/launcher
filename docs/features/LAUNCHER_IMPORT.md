# Launcher Import

This document describes the external launcher import system added to Vesta.

## Goals

- Discover installed launcher roots automatically.
- Allow manual path overrides when auto-detection misses custom installs.
- Enumerate importable instances from each launcher provider.
- Import instance files with a modular backend provider architecture.
- Avoid watcher churn during bulk import, then run manual post-import processing.

## Backend Architecture

Core module:

- `vesta-launcher/src-tauri/src/launcher_import`

Important files:

- `launcher_import/types.rs` - shared request/response and launcher instance models.
- `launcher_import/providers/mod.rs` - provider trait (`ExternalLauncherProvider`).
- `launcher_import/manager.rs` - provider registry, detection fan-out, instance listing.
- `commands/launcher_imports.rs` - Tauri commands.
- `tasks/installers/external_import.rs` - import execution task.

Provider folders:

- `launcher_import/providers/curseforge`
- `launcher_import/providers/gdlauncher`
- `launcher_import/providers/prism`
- `launcher_import/providers/multimc`
- `launcher_import/providers/atlauncher`
- `launcher_import/providers/ftb`
- `launcher_import/providers/modrinth_app`
- `launcher_import/providers/technic`

Shared provider helpers:

- `launcher_import/providers/prism_multimc_cfg.rs` - shared `instance.cfg` parser used by both Prism and MultiMC.
- `launcher_import/providers/flame_metadata.rs` - shared flame metadata enrichment (modpack platform + IDs + MinecraftVersion).

Each provider implements:

- `detect_paths()` for auto-discovery roots.
- `list_instances(base_path)` for instance enumeration + metadata extraction.

### Prism vs MultiMC strategy

Prism and MultiMC intentionally share the same base import logic:

- Both enumerate instances from launcher `instances/*` folders using `instance.cfg`.
- Both use the same parser helper to map display name, instance path, and game directory.
- Both apply the same optional flame metadata enrichment when a `flame` folder exists.
- Prism also enriches from `instance.cfg` managed-pack fields (`ManagedPackType`, `ManagedPackID`, `ManagedPackVersionID`) and resolves `iconKey` from launcher `icons/`.

Current intentional difference:

- Only launcher root detection paths differ (`paths.rs`), because installs are stored in different platform-specific locations.
- On macOS, Prism, MultiMC, and ATLauncher may store data either in user app-data folders or inside `.app` bundle data directories under `/Applications`, so both are probed.

## Command Surface

Tauri commands:

- `detect_external_launchers`
- `list_external_instances`
- `import_external_instance`

Import request shape:

- `launcher`: provider ID
- `instancePath`: selected external instance folder
- `selectedInstance`: optional selected candidate payload from UI (used to avoid expensive re-enumeration during import submission)
- `basePathOverride`: optional manual launcher root
- `instanceNameOverride`: optional custom final name

## Import Lifecycle

1. UI calls `detect_external_launchers`.
2. UI chooses launcher + path and calls `list_external_instances`.
3. UI selects an instance and calls `import_external_instance`.
4. Backend creates a Vesta instance row.
5. Backend queues `ImportExternalInstanceTask`.
6. Task:
   - temporarily un-watches target instance
   - recursively copies external files into target game dir in a blocking worker thread
   - reports copy progress and supports cancellation during copy
   - re-attaches watcher first, then runs explicit resync with progress callbacks
   - emits periodic heartbeat status during long resync operations
   - marks installation status `installed`

Completion semantics:

- The import task only completes after resync has completed.
- `installation_status=installed` is set only after resync completion.
- This is intentional to preserve correctness over early completion.

## Watcher Strategy

To reduce load during large imports:

- Watchers are disabled for the target instance before bulk copy.
- Resource scanning is executed once after copy when watcher is re-attached.
- Scan/link fan-out is bounded to avoid large burst pressure.
- Duplicate in-flight scans for the same `(instance_id, path)` are suppressed.
- Remote identify calls are wrapped with conservative timeouts; timed-out lookups fall back to manual linkage and scanning continues.

This avoids per-file event storms while preserving post-import resource indexing.

## Logs and Troubleshooting

Stage logs (info level) are emitted across the import pipeline:

- command/manager: detect/list start/end, launcher and candidate counts
- import task: `copy-start`, `copy-end`, `resync-start`, `resync-end`, completion elapsed time
- watcher scan: per-folder progress counters (processed/total/skipped/failed)

If import appears stuck at "Resyncing imported resources...":

- check logs for `resync-start`; if present, work is active
- check for incremental watcher progress snapshots
- check for timeout fallback behavior (manual linkage continues scan)
- large modpacks can still take noticeable time due to hashing and DB writes, but heartbeat updates should continue

## Linkage Strategy

Best-effort linkage currently comes from:

- provider metadata (`modpackPlatform`, `modpackId`, `modpackVersionId`) when available
- post-import watcher identification via hashes/fingerprints for Modrinth/CurseForge resources

If no metadata can be resolved, resources remain as manual entries.

## Frontend Integration

Main entry:

- `vesta-launcher/src/components/pages/mini-pages/install/install-page.tsx`

Added flow:

- New source option in modpack menu: **Import Launcher**
- Launcher detection + root override
- If multiple detected roots contain instances for the selected launcher, user picks the root before import
- Instance scan + instance select
- Import trigger

Secondary entry:

- `vesta-launcher/src/components/pages/mini-pages/settings/general/GeneralTab.tsx`
- "Launcher Import" action routes into install import source.

Utility wrapper:

- `vesta-launcher/src/utils/launcher-imports.ts`

## Manual Validation Checklist

Per provider:

- Detection finds default path.
- Manual override path works.
- Instance list is populated.
- Import task completes and new instance appears.
- Imported mods/resources are indexed after manual refresh.
- Watcher resumes after import.

