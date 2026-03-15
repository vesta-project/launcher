# Vesta Launcher - AI Coding Instructions

## Project Overview
Vesta Launcher is a Minecraft launcher built with **Tauri (Rust)** for the backend and **SolidJS (TypeScript)** for the frontend. It uses a custom SQLite database layer and a robust notification system.

### Important details

1. **Codebase details:** You can find more information in the docs `./docs` folder, and the code itself is organized into `src-tauri` for Rust backend and `src` for SolidJS frontend.
2. **Best practices:** Always review code changes to ensure they align with the project's architecture and coding standards. When in doubt, refer to existing code patterns or ask for clarification. Also run checks for typescript bugs and/or rust bugs when you have completed the changes. Only do it at the end of the PR, not during the process, to avoid interrupting the flow of thought.
3. **Testing:** Ensure that any new features or changes are covered by appropriate tests when necessary. For frontend, use testing libraries compatible with SolidJS. For backend, use Rust's built-in testing framework.
4. **Documentation:** Update this file with any changes to the architecture, workflows, or conventions or ./docs when relevant. Clear documentation helps maintain consistency and onboard new contributors effectively.

## Architecture & Core Components

### Backend (Rust/Tauri)
- **Location:** `vesta-launcher/src-tauri`
- **Service Model:** Logic is organized into "Managers" (e.g., `NotificationManager`, `TaskManager`) managed by Tauri's state.
- **Database:** SQLite via **Diesel ORM** (Primary) and **rusqlite** (Legacy/Specific).
  - **Pattern:** Diesel schema in `src-tauri/src/schema.rs`. Structs in `src-tauri/src/models` and `utils/config`.
  - **Connection:** Access via `get_vesta_conn()` and `get_config_conn()` in `utils::db`.
  - **Migrations:** Managed via Diesel CLI. Located in `src-tauri/migrations/vesta` and `src-tauri/migrations/config`.
- **Tasks:** `TaskManager` (`src-tauri/src/tasks/manager.rs`) handles async operations. Tasks implement the `Task` trait and report progress via notifications.

### Frontend (SolidJS)
- **Location:** `vesta-launcher/src`
- **Framework:** SolidJS with Vite.
- **State Management:** Uses SolidJS `createSignal`, `createResource`, and `createStore`.
- **Theming System:** 
  - **Central Hub:** `src/themes/presets.ts`.
  - **Mechanism:** `applyTheme` maps `ThemeConfig` to CSS variables on `:root`.
  - **Sync:** Theme settings are stored in `AppConfig` and synced to the active `Account` profile.
  - **Switching:** Changing the active account automatically applies that user's specific theme settings.

### Communication
- **Commands:** `invoke('command_name', { payload })` for actions.
- **Events:** `listen('core://event-name', callback)` for updates (e.g., notifications, account-heads-updated).

## Key Workflows

### Development
- **Run Dev Server:** `bun run vesta:dev` (Runs Tauri + Vite).
- **Frontend Only:** `bun run dev` in `vesta-launcher`.
- **Backend Build:** `cargo build` in `src-tauri`.

### Database Changes
1.  **Generate Migration:** `diesel migration generate <name> --migration-dir migrations/<vesta|config>`
2.  **Define SQL:** Edit `up.sql` and `down.sql`.
3.  **Update Structs:** Update Rust structs and `schema.rs` (Diesel CLI usually updates `schema.rs` automatically on `migration run`).
4.  **Run:** Migrations run automatically on app startup via `utils::db::run_migrations`.

### Theming Details (Advanced)
- **Fields:** `theme_id`, `theme_mode`, `theme_primary_hue`, `theme_style`, `theme_gradient_enabled`, `theme_border_width`, etc.
- **Mapping:** `configToTheme` in `presets.ts` converts backend model to frontend `ThemeConfig`.
- **Style Modes:** `glass` (translucent), `satin` (matte), `flat` (no backdrop filter), `bordered` (high contrast), `solid` (opaque).
- **UUIDs:** Always use **normalized (no-dash)** UUIDs when referencing accounts in the backend or local cache.

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
- **Icons:** Import SVG icons directly as components (e.g., `import CloseIcon from "@assets/close.svg"`). Prefer component SVGs instead of inline paths for better maintainability.
- **File Structure:** Group related components and logic together (e.g., `components/pages/home`)

## Common Pitfalls
- **Notification Flashing:** Ensure `dismissible` state is consistent between backend updates and frontend rendering. Completed tasks should be `dismissible: true`.
- **Database Locks:** SQLite is single-writer. Ensure transactions are short and handled correctly by the `db_manager`.
- **Tauri Commands:** Arguments must match exactly between Rust (`#[tauri::command]`) and TypeScript (`invoke`). Use `camelCase` in JS and `snake_case` in Rust (Tauri handles conversion).

## Assistant / Copilot behaviour
- If there's anything technical that the assistant doesn't know or is unsure about, the assistant must notify the developer and request guidance rather than guessing.
 - We're not in a release stage right now: **ignore backwards-compatibility constraints for now**. Breaking changes are acceptable when they help move the project forward — but please clearly document any breaking changes in the PR description (and add migrations where relevant).
- If the assistant becomes stuck on a technical step or reaches an uncertainty, it should stop the current automated process and ask for clarification or additional context.
- If assistance instructions change or the assistant's responsibilities update, update this file to reflect that guidance so future runs follow the current expectations.
