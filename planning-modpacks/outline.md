# Modpack Support Planning

## Overview
Implement support for Modrinth (.mrpack) and CurseForge (.zip) modpacks in Vesta Launcher. This includes downloading, parsing, installing, and exporting modpacks.

## 1. Backend Implementation (piston-lib & src-tauri)

### A. Modpack Parser (piston-lib)
- [ ] Create `piston-lib/src/game/modpack` module.
- [ ] Implement Modrinth index parser (`modrinth.index.json`).
    - [ ] Support `overrides/` and `client-overrides/`.
- [ ] Implement CurseForge manifest parser (`manifest.json`).
    - [ ] Support `overrides` field (usually maps to `overrides/`).
- [ ] Unified Modpack interface to get:
    - Minecraft Version
    - Modloader (Type & Version)
    - File list (mods to download)
    - Overrides mapping

### B. Modpack Installer (piston-lib / src-tauri)
- [ ] Implement a task to:
    1. Download/Open modpack ZIP.
    2. Extract and parse manifest.
    3. Determine base instance requirements (MC version, Modloader).
    4. Queue downloads for all mods listed in the manifest (using existing CurseForge/Modrinth logic).
    5. Extract overrides to instance root.
    6. (Optional) Set specific metadata like recommended RAM.

### C. Exporting (piston-lib)
- [ ] Implement logic to bundle an existing instance into:
    - `.mrpack` (Modrinth format)
    - `.zip` (CurseForge format)
- [ ] Allow user to select specific files/folders to include.
- [ ] Identify which files are mods (to be linked in manifest) vs overrides.

### D. Tauri Commands (src-tauri)
- [ ] `get_modpack_info`: Returns metadata from a local ZIP or URL (for UI preview).
- [ ] `install_modpack`: Handles the download/extraction/installation flow.
- [ ] `export_instance`: Handles bundling and saving with file selection.
- [ ] RAM check utility: Compare recommended RAM against physical total.

## 2. Frontend Implementation (SolidJS)

### A. Refreshed Install Experience
- [ ] Refactor `InstallPage` into a reusable `InstallForm`.
- [ ] Create `InstallDialog` (modal) for triggering installation from anywhere in the UI.
    - [ ] Design: Skinny, vertical-focused layout.
    - [ ] Feature: "Show More" expansion for advanced settings.
- [ ] Update `InstallPage`:
    - [ ] Design: Wide-form view for desktop-class editing.
- [ ] "Modpack" tab/mode in `InstallForm`:
    - Handles pre-filling from Modrinth/CurseForge projects.
    - URL input for manual pack links.
    - File selection for local `.mrpack` / `.zip` files.
    - Version selection for the modpack itself.
- [ ] Update `ResourceBrowser` and `ResourceDetails` to use `InstallDialog` for new instances.

### B. Improved Settings & Metadata
- [ ] Auto-fill recommended RAM from manifest.
- [ ] Check physical RAM and show warning banner if insufficient.
- [ ] Use existing system for instance icons.

### C. Instance Export UI
- [ ] Add "Export" option to instance context menu or settings.
- [ ] Navigation component to select/deselect files/folders for export.
- [ ] Modal to choose format (.mrpack vs CurseForge).
- [ ] Progress bar for export task.

## 3. Styling & Consistency
- [ ] Ensure all new UI elements follow the Vesta theme.
- [ ] Use `Show`, `For`, and SolidJS signals correctly.
- [ ] Adaptive layout for the new install tab.
