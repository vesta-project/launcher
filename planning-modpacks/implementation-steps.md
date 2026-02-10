# Implementation Steps

## Phase 1: Core Logic (piston-lib)
1. **Define Modpack Schemas**: Create structs for `modrinth.index.json` and `manifest.json`.
2. **Parser Component**: Implement a function to detect and parse a modpack ZIP, returning a `ModpackMetadata` struct.
3. **Internal Helpers**:
   - `get_physical_memory()` using `sysinfo`.
   - Override extraction logic for `overrides/`, `client-overrides/`, etc.
4. **Mod Download Integration**: 
   - Integrate with `piston-lib`'s existing download infrastructure.
5. **Export Heuristics**: 
   - Implement logic to separate mods from overrides based on known platform IDs.
   - Implement ZIP bundling for `.mrpack` and CurseForge `.zip`.

## Phase 2: Backend Task & Commands (src-tauri)
1. **Command: `get_modpack_info`**:
   - Takes a path or URL.
   - Returns metadata (name, version, MC version, modloader, recommended RAM).
   - Handles the pre-filled data for the frontend.
2. **Update `install_instance` or new `install_modpack_instance`**:
   - Orchestrate the full flow:
     - Install base game.
     - Download modpack mods.
     - Extract overrides.
3. **Command: `get_hardware_info`**:
   - Returns physical RAM total.
4. **Command: `export_instance`**:
   - Takes instance ID and a list of file paths (selected by user).
   - Generates the modpack file at the target location.

## Phase 3: Frontend Refactor & Install Dialog
1. **Refactor `InstallPage`**:
   - Extract the core form logic into a reusable `InstallForm` component.
   - This form should handle Vanilla, Modloader, and now **Modpack** flows.
2. **Create `InstallDialog`**:
   - A modal component that can be triggered from the `ResourceBrowser` or `ResourceDetails`.
   - **Adaptive Layout**: 
     - Skinny, vertical orientation for quick installs.
     - Includes an "Expand" button to reveal advanced/pre-filled settings without cluttering the initial view.
3. **Update `InstallPage`**:
   - Redesign for a wider, more comprehensive form layout suitable for the full-page view.
4. **Modpack Integration in `InstallForm`**:
   - When a Modpack is detected, pull recommendations (MC version, RAM, Modloader).
   - Show a version selector for the modpack itself.
   - Display a warning banner if `recommendedRAM > physicalRAM`.
4. **Update `ResourceBrowser` & `ResourceDetails`**:
   - Replace the navigation to `/install` with opening the `InstallDialog`.
   - Ensure the experience is seamless (pre-fills the correct tab and project data).
5. **Export UI Component**:
   - Create a directory tree component with selective checkboxes.
   - Integrate into Instance Settings/Context menu.

## Phase 4: Refinement
1. **Theming**: Ensure consistent look and feel for the new components.
2. **Error Handling**: Proper handling of invalid manifests or failed mod downloads.
3. **Persistence**: Ensure icons and metadata correctly sync with the DB.
