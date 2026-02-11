# Architecture Overview

This document describes the high-level architecture of Vesta Launcher and where core responsibilities live in the repository.

## Core Components
- `vesta-launcher/src-tauri/` — Tauri host and Rust backend. Contains app configuration, Tauri commands, startup logic, and managers (e.g., `NotificationManager`, `TaskManager`, `NetworkManager`, `ResourceManager`).
- `crates/piston-lib/` — Core launcher library. Implements installers (Vanilla, Fabric, Quilt, NeoForge/Forge), updater logic, installer processors, and platform-agnostic utilities.
- `vesta-launcher/` — Frontend UI (SolidJS + Vite). Components, styling, state management, and the UI application.

## Key Patterns
- **Database:** SQLite via **Diesel ORM** (primary) and **rusqlite** (legacy/specific).
  - **Schema:** Defined in `src-tauri/src/schema.rs`.
  - **Models:** Structs in `src-tauri/src/models` and `utils/config`.
  - **Connections:** Via `get_vesta_conn()` and `get_config_conn()` in `utils::db`.
  - **Migrations:** Managed via Diesel CLI. Located in `src-tauri/migrations/vesta` and `src-tauri/migrations/config`.
- **Task / Notification Model:** Long-running work uses a `Task`-based pattern in Rust (`src-tauri/src/tasks/manager.rs`). Tasks implement the `Task` trait and report progress via `NotificationManager`. Use `client_key` to coordinate updates for the same task.
- **Managers:** Core services are implemented as managers managed by Tauri's state system:
  - `NotificationManager`: Handles UI notifications and progress reporting.
  - `TaskManager`: Orchestrates background tasks with cancellation and pausing support.
  - `NetworkManager`: Manages network connectivity and status.
  - `ResourceManager`: Handles external resources (Modrinth, CurseForge API interactions).
  - `ResourceWatcher`: Monitors file system changes for instances.
  - `MetadataCache`: In-memory caching for game metadata.
- **Installer Processors:** Some installers invoke Java-based processors (external JARs). These processors receive command-line arguments that may reference files under `data/*` — the Rust code extracts `data/*` entries into the install `data_dir` so processors can access them.
- **Cross-platform Considerations:** File canonicalization and path normalization are performed in several places; tests that canonicalize paths may fail in some environments.

## Where to Look for Behavior
- **Installers and Preparation:** `crates/piston-lib/src/game/installer/` contains per-loader logic and shared helpers.
- **Processor Invocation:** Forge processor logic is integrated into the installer implementation.
- **Database Migrations:** `src-tauri/migrations/vesta` and `src-tauri/migrations/config`.
- **Manager Initialization:** Managers are initialized in `src-tauri/src/setup.rs` and managed via Tauri's state system.
