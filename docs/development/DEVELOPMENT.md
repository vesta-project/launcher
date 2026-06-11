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

### CrabNebula DevTools (development only)

Debug builds include [CrabNebula DevTools](https://devtools.crabnebula.dev) for inspecting invoke calls, console output, and Tauri config. The `vesta:dev` script enables the `devtools` Cargo feature; production builds exclude the crate entirely.

1. Run `bun run vesta:dev`
2. Look for the CrabNebula WebSocket connection URL in the terminal output
3. Open that URL, or go to [devtools.crabnebula.dev](https://devtools.crabnebula.dev) and connect manually

The Settings **Debug logging** toggle still controls log verbosity (`Info` vs `Debug`) and requires an app restart. DevTools receives the same log stream as the existing `tauri-plugin-log` setup (stdout, log files, webview).

### Launcher logs

Launcher diagnostic logs (backend Rust + webview console forwarding) are written under `logs/` in the app data folder:

- macOS: `~/Library/Application Support/VestaLauncher/logs/`
- Linux: `~/.config/VestaLauncher/logs/`
- Windows: `%APPDATA%/.VestaLauncher/logs/`

Each app launch creates a new session file: `vesta-log-YYYY-MM-DD_HHMMSS.log` (local time). If a single session exceeds 10MB, the plugin splits it into additional timestamped files in the same folder. Files older than 30 days are removed on startup.

In-game console output is separate: it lives under each instance's `game_directory/logs/` (for example `latest.log`). Use Settings → Developer → **Open Launcher Logs** for launcher diagnostics, or the instance Console tab for game logs.

- **Frontend Only:**
  ```bash
  cd vesta-launcher
  bun run dev
  ```

- **Run Backend Unit Tests:**
  ```bash
  cargo test -p piston-lib --lib
  ```

### building-&-versioning
- **Build for Production (Installer/Executable):**
  ```bash
  bun run vesta:build
  ```

### Startup & Bootstrap
For details on how the launcher handles window initialization, the initial loading splash, and theme synchronization during startup, see [v:\launcher\docs\architecture\STARTUP_PROCESS.md](v:\launcher\docs\architecture\STARTUP_PROCESS.md).

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
