# Developer Guide

This document covers typical developer workflows, code conventions, and where to make common changes.

## Prerequisites
- **Rust:** Stable toolchain (Cargo).
- **Bun:** Required for frontend tasks and project scripts. [Install Bun](https://bun.sh/).
- **Java:** Required for certain installer processors and tests.

## Workflows

### Setup & Dependencies
- **Install All Dependencies:**
  ```bash
  bun install
  ```
  (This runs `bun install` in the `vesta-launcher` directory as well.)

### Development
- **Start Development Server (Frontend + Backend):**
  ```bash
  bun run vesta:dev
  ```
  (Runs Tauri + Vite with hot-reloading.)

- **Frontend Only:**
  ```bash
  cd vesta-launcher
  bun run dev
  ```

- **Run Backend Unit Tests:**
  ```bash
  cargo test -p piston-lib --lib
  ```

### Building & Versioning
- **Build for Production (Installer/Executable):**
  ```bash
  bun run vesta:build
  ```

- **Bump Version:**
  ```bash
  bun run version:bump
  ```

### Linting & Formatting
We use **Biome** for JavaScript/TypeScript and standard Rust formatting.
- **Check/Fix Frontend Code:**
  ```bash
  bunx biome check --apply .
  ```
- **Format Rust Code:**
  ```bash
  cargo fmt
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
