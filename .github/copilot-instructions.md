# Vesta Launcher - AI Coding Instructions

## Project Overview
Vesta Launcher is a Minecraft launcher built with **Tauri (Rust)** for the backend and **SolidJS (TypeScript)** for the frontend. It uses a custom SQLite database layer and a robust notification system.

## Architecture & Core Components

### Backend (Rust/Tauri)
- **Location:** `vesta-launcher/src-tauri`
- **Service Model:** Logic is organized into "Managers" (e.g., `NotificationManager`, `TaskManager`) managed by Tauri's state.
- **Database:** SQLite via `rusqlite`.
  - **Pattern:** **SqlTable Trait**. Rust structs are the single source of truth for schemas.
  - **Key File:** `src-tauri/src/utils/sqlite.rs` (SqlTable trait), `crates/piston-macros` (Derive macro).
  - **Migrations:** Defined in `src-tauri/src/utils/migrations/definitions.rs`. Always add a new migration for schema changes; never edit old ones.
- **Tasks:** `TaskManager` (`src-tauri/src/tasks/manager.rs`) handles async operations. Tasks implement the `Task` trait and report progress via notifications.

### Frontend (SolidJS)
- **Location:** `vesta-launcher/src`
- **Framework:** SolidJS with Vite.
- **State Management:** Uses SolidJS `createSignal`, `createResource`, and `createStore`.
- **Communication:**
  - **Commands:** `invoke('command_name', { payload })` for actions.
  - **Events:** `listen('core://event-name', callback)` for updates (e.g., notifications).

## Key Workflows

### Development
- **Run Dev Server:** `bun run vesta:dev` (Runs Tauri + Vite).
- **Frontend Only:** `bun run dev` in `vesta-launcher`.
- **Backend Build:** `cargo build` in `src-tauri`.

### Database Changes
1.  **Define Struct:** Add `#[derive(SqlTable)]` to your Rust struct.
    ```rust
    #[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
    #[migration_version("0.5.0")]
    #[migration_description("Description")]
    pub struct MyTable { ... }
    ```
2.  **Create Migration:** Add a function in `src-tauri/src/utils/migrations/definitions.rs` using `MyTable::schema_sql()`.
3.  **Register:** Add to `get_all_migrations()`.

### Notification System
- **Pattern:** Use `client_key` to track and update notifications (e.g., progress bars).
- **Lifecycle:**
  1.  `create_notification` (returns ID).
  2.  `update_notification_progress` (updates UI).
  3.  **Completion:** When progress >= 100, type converts to `Patient` (dismissible).
- **Types:**
  - `Progress`: Active task (bar or pulsing `-1`).
  - `Patient`: Completed/Passive notification (dismissible).
  - `Immediate`: Toast only.
  - `Alert`: Persistent warning/error.

## Conventions & Patterns
- **Rust:** Prefer `anyhow::Result` for error handling. Use `Box<dyn Task>` for task polymorphism.
- **SolidJS:** Use `Show` and `For` components for control flow. Avoid direct DOM manipulation.
- **Styling:** CSS Modules (`.module.css`) or global styles in `src/styles.css`.
- **Icons:** Import SVG icons directly as components (e.g., `import CloseIcon from "@assets/close.svg"`).

## Common Pitfalls
- **Notification Flashing:** Ensure `dismissible` state is consistent between backend updates and frontend rendering. Completed tasks should be `dismissible: true`.
- **Database Locks:** SQLite is single-writer. Ensure transactions are short and handled correctly by the `db_manager`.
- **Tauri Commands:** Arguments must match exactly between Rust (`#[tauri::command]`) and TypeScript (`invoke`). Use `camelCase` in JS and `snake_case` in Rust (Tauri handles conversion).

## Assistant / Copilot behaviour
- If there's anything technical that the assistant doesn't know or is unsure about, the assistant must notify the developer and request guidance rather than guessing.
 - We're not in a release stage right now: **ignore backwards-compatibility constraints for now**. Breaking changes are acceptable when they help move the project forward — but please clearly document any breaking changes in the PR description (and add migrations where relevant).
- If the assistant becomes stuck on a technical step or reaches an uncertainty, it should stop the current automated process and ask for clarification or additional context.
- If assistance instructions change or the assistant's responsibilities update, update this file to reflect that guidance so future runs follow the current expectations.
