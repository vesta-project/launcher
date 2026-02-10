# Technical Findings

## 1. Directory Structure
- Current instances are stored in `%appdata%/.VestaLauncher/instances/<slug>`.
- The game directory logic is already sanitized using `sanitize_instance_name`.

## 2. Modpack Manifests
### Modrinth (`modrinth.index.json`):
- Format version 1.
- `files` array includes `path` (relative to root) and `hashes`.
- `dependencies` map includes `minecraft` and modloaders.

### CurseForge (`manifest.json`):
- `minecraft` object has `version` and `modLoaders`.
- `files` array has `projectID` and `fileID`.
- `overrides` field points to the folder (usually `overrides`).

## 3. Piston-Lib Integration
- `InstallInstanceTask` currently handles vanilla/modloader installation.
- Modpack installation should probably be a "Wrapper Task" that:
    1. Downloads/validates the ZIP.
    2. Parses the manifest.
    3. Runs `install_instance` for the core game.
    4. Downloads all mods into the global cache.
    5. Links/Copies mods to the instance `mods/` folder.
    6. Extracts overrides to the instance root.

## 4. RAM Detection
- Need `sysinfo` or similar in Rust.
- Currently, the launcher uses a hardcoded 2GB if not specified.
- CurseForge manifests have `recommendedRam`.

## 5. UI Components
- `InstallPage` uses SolidJS signals and `createResource` for hardware-agnostic metadata.
- `IconPicker` handles both default gradients and custom uploaded icons.
- `Slider` component is used for memory selection.
