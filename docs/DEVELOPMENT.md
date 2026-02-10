# Developer Guide

This document covers typical developer workflows, code conventions, and where to make common changes.

## Workflows
- **Start Development Server (Frontend + Backend):**
  ```
  bun run vesta:dev
  ```
  (Runs Tauri + Vite from the root directory.)

- **Frontend Only:**
  ```
  cd vesta-launcher
  bun run dev
  ```

- **Run Backend Unit Tests:**
  ```
  cargo test -p piston-lib --lib
  ```

- **Build Backend for Release:**
  ```
  cd vesta-launcher/src-tauri
  cargo build --release
  ```

## Key Places to Change
- **Database Schemas:** Generate Diesel migrations in `src-tauri/migrations/vesta` or `src-tauri/migrations/config`, then update models in `src-tauri/src/models` or `utils/config`.
- **Installer Logic:** `crates/piston-lib/src/game/installer/` (loader-specific logic and shared helpers).
- **Frontend Components/Styles:** `vesta-launcher/src/`

## Coding Conventions & Notes
- Prefer `anyhow::Result` for fallible functions in the backend.
- Tasks report progress via the `NotificationManager`. Use `client_key` to update existing notifications.
- When changing the installer model (e.g., altering where files are extracted), add unit tests in `crates/piston-lib/tests` or matching module tests.

## Troubleshooting
- **Environment Dependent Tests:** Ensure Java is installed and PATH entries are correct.
- **File Not Found in Processors:** Processors often expect resources under `data/` — the installer extracts `data/*` entries into the instance `data_dir`.
