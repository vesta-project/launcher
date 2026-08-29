# Developer Guide

This document covers typical developer workflows, code conventions, and where to make common changes.

## Prerequisites
- **Rust:** Stable toolchain (Cargo).
- **Bun:** Required for frontend tasks and project scripts. [Install Bun](https://bun.sh/). Node.js is not required; Tauri and package scripts use Bun.
- **Java:** Required for certain installer processors and tests.

### Linux system packages (Tauri / WebKit)

Install the WebKitGTK and related development libraries before `bun run vesta:dev` or `cargo test` for the Tauri crate.

**Fedora / RHEL-family:**
```bash
sudo dnf install \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel \
  openssl-devel \
  gcc make pkgconf-pkg-config \
  curl file xdg-utils \
  bubblewrap
```

**Ubuntu / Debian-family** (matches CI):
```bash
sudo apt-get install --yes \
  build-essential \
  file \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  pkg-config \
  xdg-utils \
  bubblewrap
```

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
  (Runs Tauri + Vite with hot-reloading. Uses Bun for the Vite frontend; npm is not required.)

**Linux sandbox (Modded / Paranoid presets):** requires `bubblewrap` (`bwrap`), working unprivileged user namespaces, Landlock (Linux 5.13+), and the bundled `vesta-sandbox-exec` helper for exec allowlists. The launcher checks all of these at launch and in settings.

**Windows sandbox (Modded / Paranoid presets):** uses the bundled
`vesta-sandbox-exec.exe`, AppContainer, NTFS package-SID grants, and a no-child
target policy. Rebuild the helper with
`cargo build -p vesta-sandbox --bin vesta-sandbox-exec` before running sandbox
tests. The bundled `exit-handler.jar` must be rebuilt with
`vesta-launcher/resources/exit-handler/build.bat` after changing its Java source.
Windows serializes launches of the same Instance profile. Sandbox-outside user
wrappers are unsupported; select wrapper-outside when compatibility requires a
wrapper. AppContainer localhost access requires an administrator-managed
loopback exemption and is not enabled automatically.

### CrabNebula DevTools (development only)

Debug builds can include [CrabNebula DevTools](https://devtools.crabnebula.dev) for inspecting invoke calls, console output, and Tauri config. Use `vesta:dev:tools` to enable the `devtools` Cargo feature; production builds exclude the crate entirely.

1. Run `bun run vesta:dev:tools`
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
