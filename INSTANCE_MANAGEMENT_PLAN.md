# Instance Management & Modpack Linking Implementation Plan

This document outlines the architecture and steps for implementing advanced instance management, version control, and modpack linking in Vesta Launcher.

## Core Concepts

### 1. Modpack Linking
Instances can be "Linked" to an external platform (Modrinth/CurseForge). 
- **Linked**: The launcher manages the instance based on a remote manifest. Manual version changes are disabled. Strict file integrity is enforced.
- **Unlinked**: The instance is managed manually. The user can change Minecraft versions, modloaders, and versions freely.

### 2. File Integrity (Strict Sync)
For **Linked** instances, every launch triggers a sync:
- Missing manifest files (mods, configs, etc.) are downloaded.
- Extra files (non-manifest mods) are **deleted**.
- Hash verification is used to ensure file correctness.

### 3. Maintenance Operations
- **Repair**: Verifies all file hashes. (Manual: MC assets/libs; Linked: All manifest resources).
- **Reset**: Wipes the instance folder and performs a fresh installation from the manifest/source.
- **Update**: Moves a linked instance to a new modpack version.
- **Duplicate**: Clones an instance (and its linkage) to a new name (e.g., "Pack (2)").

---

## Implementation Phases

### Phase 1: Database & Models (Status: Completed ✅)
- [x] Create Diesel migration for `instances` table:
    - `modpack_id`: Option<String>
    - `modpack_version_id`: Option<String>
    - `modpack_platform`: Option<String>
    - `modpack_icon_url`: Option<String>
- [x] Update `Instance` struct in `src-tauri/src/models/instance.rs`.
- [x] Update `NewInstance` struct and insertion logic.

### Phase 2: Backend Task System (Status: Completed ✅)
- [x] Implement `RepairTask`:
    - Logic for hashing local files.
    - Logic for downloading missing/corrupted files.
    - Task progress reporting via Notifications.
- [x] Implement `CloneInstanceTask`:
    - Recursive directory copy.
    - Database entry duplication with `get_unique_name`.
- [x] Implement `ResetTask`:
    - Directory wipe (preserving nothing for full reset).
    - Trigger existing installation logic.
- [x] Implement "Strict Sync" pre-launch hook for linked instances.

### Phase 3: Frontend Versioning Tab (Status: Completed ✅)
- [x] Create `Versioning` tab in `InstanceDetails.tsx`.
- [x] Move "Export Instance" from Settings to Versioning.
- [x] Implement UI for:
    - **Linked View**: Platform info, Repair/Reset buttons.
    - **Unlinked View**: Repair/Reset buttons.
- [x] Implement "Duplicate" button and flow.
- [x] Implement Modpack Version Picker (for Linked Update).
- [x] Consolidate header metadata (`1.20.1 • Fabric 0.15.3`).
- [x] Add "Linkage Badge" for active sync status.

### Phase 4: UI/UX Refinement (Status: Completed ✅)
- [x] Add async confirmation dialogs (`ask` from `@tauri-apps/api/dialog`) for Reset, Unlink, and Repair.
- [x] Update UI to show modpack icons in Linkage Card.
- [x] Ensure all tasks report progress to the notification sidebar.

---

## Technical Details

### Strict Sync Logic (Pseudo-code)
```rust
if instance.is_linked() {
    let manifest = fetch_manifest(instance.modpack_id, instance.modpack_version_id).await?;
    let local_files = list_files(instance.path).await?;
    
    for file in manifest.files {
        if !file.exists_locally() || file.hash_mismatch() {
            download_file(file).await?;
        }
    }
    
    for file in local_files {
        if file.is_mod() && !manifest.contains(file) {
            delete_file(file).await?;
        }
    }
}
```

### Duplicate Name Logic
Uses `get_unique_name` from `instance_helpers.rs` to append ` (2)`, ` (3)`, etc.

### Progress Reporting
Uses the `TaskManager` with `NotificationProgress` trait.
