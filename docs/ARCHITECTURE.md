# Architecture Overview

This document describes the high-level architecture of Vesta Launcher and where core responsibilities live in the repository.

Core components
- `src-tauri/` — Tauri host and Rust glue. Contains app configuration, Tauri commands, and startup logic.
- `crates/piston-lib/` — Core launcher library. Implements installers (Vanilla, Fabric, Quilt, NeoForge/Forge), updater logic, installer processors, and platform-agnostic utilities.
- `crates/piston-macros/` — Procedural macros used by the codebase (notably `SqlTable`).
- `vesta-launcher/` — Frontend UI (SolidJS + Vite). Components, styling, and the UI application.

Key patterns
- SqlTable schema-first: Rust structs drive SQL schema generation and migrations. When the data model changes add a migration and bump the version annotation on the struct.
- Task / Notification model: Long-running work uses a `Task`-based pattern in Rust and reports progress via `NotificationManager`. Use `client_key` to coordinate updates for the same task across updates.
- Installer processors: Some installers invoke Java-based processors (external JARs). These processors receive command-line arguments that may reference files under `data/*` — the Rust code extracts `data/*` entries into the install `data_dir` so processors can access them.
- Cross-platform considerations: File canonicalization and path normalization are performed in several places; tests that canonicalize paths may fail in some environments.

Where to look for behavior
- Installers and preparation: `crates/piston-lib/src/game/installer/` contains per-loader logic and shared helpers in `forge_common.rs`.
- Processor invocation: `forge_processor.rs` builds processor invocations and normalizes processor-supplied paths.
- Database migrations: `src-tauri/src/utils/migrations/definitions.rs`.
