# Piston Backend Audit — 2025-12-01

Objective: confirm all Minecraft-specific backend logic (installation, versioning, manifest parsing, classpath, natives) lives inside `crates/piston-lib`, and note remaining work to migrate from `src-tauri`.

## Coverage Snapshot

- `crates/piston-lib/src/game/installer`
  - `mod.rs`, `vanilla`, `modloaders/{forge,neoforge,fabric,quilt}`
  - Handles InstallSpec execution, processors, patched manifests, library fetches
- `crates/piston-lib/src/game/launcher`
  - `arguments.rs`, `classpath.rs`, `classifier.rs`, `natives.rs`, `version_parser.rs`
  - Covers manifest parsing, JVM args, OS rules, natives extraction, classpath jar generation
- `crates/piston-lib/src/game/metadata`
  - Metadata fetcher, caching for manifests and loaders
- `crates/piston-lib/src/game/tasks`
  - Shared task abstractions used by install/launch steps

## Gaps / Actions

1. Hash-skip + cache/index schemas currently planned in `src-tauri` (`schemas.rs`). Need to define API in piston-lib or ensure bridge hands resolved artifacts down.
2. Notification wiring remains in `src-tauri` (expected).
3. Legacy installer code in `src-tauri/src/tasks/installers/mod.rs` still duplicates piston behavior. Once adapters plan phases, remove redundant logic.
4. Ensure piston-lib exposes stable functions for:
   - Manually running processor sets per loader
   - Querying manifests without triggering install

## Next Steps

- Keep adapter planning in `src-tauri`, execute via `piston_bridge.rs` until custom pipeline ready.
- Gradually move hash/index management into piston-lib or keep as orchestrated layer with clear API boundaries.
- Track progress via `task/step-04-loader-adapters.md` and follow-up steps for concurrency and rollback.
