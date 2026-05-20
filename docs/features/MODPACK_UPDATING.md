# Modpack Updating System

The modpack updating system provides safe, delta-based updates that protect user customizations while applying changes from new modpack versions.

## Overview

When a modpack author releases a new version, the update engine performs a **three-way differential analysis** to determine exactly what changed, who changed it, and what needs to happen to bring the instance up to date — without destroying user modifications.

### Key Principles

- **User changes are sacred.** If a user modified a config or replaced a mod, the engine preserves it.
- **Atomic updates.** All changes are staged in `.update_stage/` and applied in a single atomic commit. If anything fails, the game directory is left untouched.
- **Binary vs. text awareness.** Binary files (JARs, ZIPs) are compared by hash. Text configs (.properties, .json) are merged at the key-value level.

---

## The Three States

The engine uses three data sources to classify every file:

```
  [ Old Base Manifest ]     What the pack was *supposed* to look like last sync
           │
           ├─── Compared against ───► [ Current Client Directory ]   Actual files on disk
           │
  [ New Base Manifest ]     What the pack *wants* to look like now
```

| State | Name | Source |
|-------|------|--------|
| **$O$** | Old Base Manifest | `modpack_manifest.json` from the previous successful update |
| **$C$** | Current Client | Physical files in the instance directory (SHA-256 scanned) |
| **$N$** | New Base Manifest | Downloaded new modpack ZIP, parsed to build a target manifest |

---

## File Classification

Every file in the instance directory falls into one of three categories:

### Category A: Tracked Binaries (`.jar`, `.zip`, `.png`, Litematica files)

- Matched by **SHA-256 hash**.
- If $C \neq O$ → user modified or replaced it → **protect** (skip).
- If $C = O$ → pristine → update or delete according to $N$.

### Category B: Tracked Structured Text (`.properties`, `.json`, `.toml`, `.cfg`)

- Merged at the **key-value level** rather than the file level.
- If the user changed a key from its old value, the user's value is kept.
- If the user didn't change a key, the author's new value is applied.
- Comments and blank lines are preserved line-by-line.

Currently supported formats:
- **`.properties`** — Full line-by-line merge with comment preservation
- **`.json`** — Flattened to key-value pairs, merged, then reconstructed

Future support planned for: `.toml`, `.cfg`

### Category C: Untracked Files (`saves/`, `screenshots/`, custom mods)

- Anything present in $C$ that was **never** declared in $O$.
- Left completely untouched. Bypasses the sync engine entirely.
- **Exception:** If a world folder is introduced in $N$ but already exists in $C$ with user progress, the **World Rotation Routine** is triggered.

---

## Config Merging Priority Matrix

For each key-value pair in a text config:

```
Is the key in New Base (N)?
  ├── YES: Has the user changed it from Old Base? (C != O)
  │     ├── YES ──► Keep User Value (C)
  │     └── NO  ──► Apply New Base Value (N)
  └── NO: Was it manually added by the user? (In C, but not O or N)
        ├── YES ──► Keep User Value (C)
        └── NO  ──► Drop Key (Author removed it)
```

For `.properties` files, the engine walks the new file line-by-line, copying comments verbatim and applying the matrix to each key. Removed keys are commented out rather than deleted ("# key=value (removed by modpack author)"). User-added keys are appended at the bottom under a `# ── User-added settings (preserved) ──` section.

---

## Update Execution Flow (6 Phases)

The entire sequence is staged before application to prevent half-updated, corrupted states.

### Phase 1: Manifest Fetch & Differential Audit *(Memory Only)*

1. Download the new modpack ZIP for the target version.
2. Parse its platform index (Modrinth: `modrinth.index.json`, CurseForge: `manifest.json`).
3. Build $N$ as a `ModpackManifest`.
4. Load $O$ from `<game_dir>/modpack_manifest.json`.
5. Scan $C$ — compute SHA-256 for all paths declared in $O$.
6. Run `ThreeWayDiffer::diff($O, $C, $N)` → produces an `ActionTree`.

### Phase 2: Conflict & Preservation Evaluation *(Memory Only)*

1. Filter the action tree against conflict rules.
2. Run all text configs flagged for merge through the `ConfigMerger`.
3. If a world collision is detected, flag it for rotation.
4. Corrupted configs (unparseable JSON, etc.) are flagged for quarantine.

### Phase 3: Staged Isolation Download *(Disk — Temp)*

1. Create `.update_stage/` directory inside the game directory.
2. Download all new mod JARs from platform APIs (Modrinth CDN, CurseForge).
3. Extract override files from the new modpack ZIP.
4. Write merged config content.
5. **The active instance folders are never touched during this phase.**

### Phase 4: Safety Quarantines *(Disk — Atomic Rename)*

1. **World Rotation:** If a world save has user progress (level.dat hash ≠ $O$), rename it:
   - `saves/MyWorld` → `saves/MyWorld_user_20260520_1337`
   - This preserves user data atomically via OS folder renames.
2. **Corrupted Configs:** Rename broken files to `.corrupted` and place the clean default.

### Phase 5: Deletion Sweep *(Disk)*

1. Locate files present in $O$ but missing from $N$.
2. If their current hash matches $O$ (user never customized them) → **delete**.
3. Prevents "dead" configuration files and lingering incompatible mods.
4. If the hash does NOT match $O$ (user modified) → **keep** the file.

### Phase 6: Atomic Swap & Manifest Write *(Disk)*

1. Move all files from `.update_stage/` into their permanent positions.
2. Overwrite `modpack_manifest.json` with $N$'s contents.
3. Update the instance's `modpack_version_id` in the database.
4. Wipe `.update_stage/`.
5. Emit `core://instance-installed` event to refresh the UI.

---

## Technical Safeguards

### Instance Lockout
Before any update begins, the engine checks the OS process tree for Java processes. If a Java process is found with the game directory in its command line or working directory, the update is blocked entirely. This prevents file corruption from simultaneous access.

### Case Normalization
All file paths in both manifests are forced to lowercase during comparison loops. This prevents duplicate mod files on case-sensitive filesystems (Linux/macOS) when a modpack author changes casing (e.g., `JEI.jar` → `jei.jar`).

### Fail-Soft Warnings
If a text config fails structural validation (e.g., user typo like a missing brace in JSON):
- The broken file is renamed to `<original>.corrupted`.
- The clean default file from the pack is placed.
- A non-blocking diagnostic is logged and the update continues.

### Rollback Safety
If any phase (3–6) fails, `.update_stage/` is cleaned up without touching the game directory. If the process crashes mid-update, the leftover staging directory is detected and cleaned on the next update attempt.

---

## Code Architecture

### Module Structure

```
src-tauri/src/sync/
├── mod.rs              # Module exports
├── manifest.rs         # $O$ loader, $N$ builder, $C$ SHA-256 scanner
├── differ.rs           # ThreeWayDiffer — $O$ vs $C$ vs $N$ → ActionTree
├── classifier.rs       # Binary / Text / Untracked classification
├── action_tree.rs      # SyncAction enum, ActionTree collection
├── merger.rs           # ConfigMerger (.properties + .json)
├── staging.rs          # .update_stage/ directory + atomic commit/rollback
└── safeguards.rs       # Process lock, case normalization, world rotation
```

### Key Types

- **`SyncAction`** — Actions: `Add`, `Update`, `Remove`, `Merge`, `RotateWorld`, `Skip`
- **`ActionTree`** — Collection of actions + metadata (protected count, world collisions, corrupted configs)
- **`FileSource`** — Where file content comes from: `Modrinth`, `CurseForge`, `ZipOverride`, `Generated`
- **`MergeResult`** — `Merged(content)`, `Corrupted(reason)`, `Unsupported`
- **`FileClass`** — `Binary`, `Text`, `Untracked`

### Task Architecture

`UpdateModpackTask` implements the `Task` trait and integrates with the existing TaskManager, notification system, and progress reporting pipeline. It supports cancellation via the standard task cancellation channel.

### Manifest Format

The system extends the existing `ModpackManifest` (in `crates/piston-lib`) with:
- **`sha256`** field on `ModpackManifestMod` — Stronger integrity check than SHA-1
- **`modpack_manifest.json`** — Persisted at `<game_dir>/.vesta/modpack_manifest.json`

SHA-256 is used for internal diffing while SHA-1 is retained for Modrinth/CurseForge API compatibility.

---

## Frontend Integration

### Commands

| Command | Description |
|---------|-------------|
| `check_modpack_update(instanceId)` | Returns `ModpackUpdateInfo` with current/latest version IDs and whether an update is available |
| `start_modpack_update(instanceId, newVersionId)` | Submits `UpdateModpackTask` to the task manager; progress reported via notifications |

### TypeScript Types

```typescript
interface ModpackUpdateInfo {
  currentVersion: string | null;
  latestVersion: ModpackVersionInfo | null;
  updateAvailable: boolean;
}

interface ModpackVersionInfo {
  id: string;
  versionNumber: string;
  releaseType: string;
}
```

### UI Flow

1. User views instance details → `check_modpack_update` runs automatically
2. If `updateAvailable` is true, an "Update Available" badge is shown
3. User selects a new version from the version selector
4. User clicks "Update" → `start_modpack_update` is called
5. Task manager handles progress reporting via notification system
6. On completion, `core://instance-installed` event triggers UI refresh

---

## Future Work

- **TOML config merging** — Add the `toml` crate for Fabric/Quilt mod configs
- **CFG config merging** — Forge config format parser
- **Full $O$ content storage** — Store config file contents (not just hashes) in the manifest to enable true 3-way merges with old values
- **Preview mode** — Show what will change before applying
- **Partial updates** — Allow selective mod updates (e.g., skip specific mods)
- **Rollback support** — Restore previous manifest state if an update causes issues
