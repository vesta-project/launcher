# Vesta Preferences — storage, naming, and stylistic conventions

Purpose

This file documents repository-wide conventions Vesta uses for storing data, naming artifacts, and stylistic choices for generated files and runtime behaviour. Keep these preferences consistent across the launcher, backend (Tauri/Rust), and frontend (TypeScript) code.

Principles

- Predictability: file locations and names are deterministic so tools and scripts can find them reliably.
- Least surprise: prefer OS conventions for user data locations and avoid requiring global elevation.
- Safety: use atomic writes, integrity checks, and quarantine for risky operations.
- Cross-language consistency: map naming styles to language ecosystems (snake_case for Rust, camelCase for JS/TS) while keeping on-disk artifacts canonical and language-agnostic.

Top-level layout conventions

- Config / app data (per-user):
  - Windows: `%APPDATA%\\VestaLauncher` (example: `C:\\Users\\You\\AppData\\Roaming\\VestaLauncher`).
  - macOS: `~/Library/Application Support/VestaLauncher`.
  - Linux: `$XDG_CONFIG_HOME/vesta-launcher` or `~/.config/vesta-launcher`.
- Cache / downloads (per-user):
  - Use `cache/` under the app data folder: e.g., `%APPDATA%\\VestaLauncher\\cache`.
  - Subfolders: `cache/downloads`, `cache/installers`, `cache/processed`.
- Logs:
  - Use `logs/` under app data. Rotate using date-stamped files: `YYYY-MM-DD_HHMMSS.log`.
- Backups:
  - Use `backups/<iso-timestamp>/` under the app data folder; backups must be minimal (only files likely to be overwritten) and named clearly.
- Runtimes (optional bundled JREs):
  - `runtimes/<vendor>-<major>-<arch>/` (e.g., `runtimes/temurin-17-x86_64/`).

File naming and manifest rules

- Version ids for modded manifests: use the canonical `minecraftVersion-loaderId` pattern where applicable (e.g., `1.20.4-fabric-0.16.0`). This matches launchers and Modrinth ingestion patterns.
- Installer filenames: deterministic, include loader/project and full version: `forge-<loader_version>-installer.jar`, `fabric-installer-<version>.jar`, `quilt-installer-<version>.jar`, `neoforge-<version>-installer.jar`.
- Checksums and signatures:
  - Prefer sidecar checksum files named `<filename>.sha256` or a JSON manifest `checksums.json` mapping filenames → SHA256.
  - PGP signatures should use the convention `<filename>.asc` and be stored alongside the artifact when available.
- Processed artifact naming: processed artifacts produced by installers should be published with clear suffixes or metadata so clients may prefer already-processed artifacts over raw installers (e.g., `version-<id>-processed.json` stored in `cache/processed/`).

On-disk JSON and schema conventions

- Application config: `vesta.config.json` at the app config root. Include a `schema_version` field to allow migration logic.
- Mirror / repository config: `mirrors.json` listing configured maven/asset mirrors and priorities; prefer JSON arrays with objects `{ "name": "Creeperhost", "url": "https://maven.creeperhost.net", "priority": 100 }`.
- Checksums manifest: `checksums.json` with a top-level object mapping relative paths to checksum metadata: `{ "path/to/file.jar": { "sha256": "...", "size": 12345 } }`.

Naming conventions across code

- Rust (backend crates): snake_case for functions and files; types in PascalCase. SQL table models use Diesel derives and schema definitions.
- TypeScript / frontend: camelCase for identifiers and JSON keys when used by the frontend. When transferring data between Rust and TypeScript use the agreed conversion layer (Tauri argument conversion).
- On-disk artifacts and URLs: lowercase, hyphen-separated when multi-word (e.g., `neoforge-20.2.29-beta-installer.jar`).

Atomicity, integrity & verification

- Atomic writes: always write to a temporary path and rename into place (atomic rename) after verification.
- Integrity checks: prefer SHA256 checksums for artifact verification. If a PGP signature is available, validate signature before marking an installer as trusted.
- Verification policy: launchers must refuse to run or install artifacts that fail checksum/signature verification. Present a clear remediation path (try other mirrors, re-download, or abort).
- Quarantine on failure: move suspicious downloads to `quarantine/` (same app data root) instead of deleting permanently.

Backup & rollback conventions

- Minimal backups: back up only the directories/files that will be touched by an operation (e.g., specific `versions/<id>/`, changed `libraries/` entries, `mods/` for that profile).
- Backup naming: `backups/<ISO-8601-timestamp>-<operation>` (e.g., `backups/2025-12-01T15-30-install-forge-1.20.4`).
- Rollback model: prefer an atomic-swap + backup rollback action that can be executed automatically or by user request.

Permissions & security

- Avoid requiring elevation: default install and cache directories should be user-writable. Only request elevation for operations that must write to system-protected locations and explicitly explain why.
- File ownership: ensure extracted natives and installed libraries are owned by the current user; do not create files owned by SYSTEM or root under normal operations.
- Telemetry & privacy: opt-in only for telemetry. If health checks are recorded, record only minimal metadata (operation type, success/failure, timestamp, non-identifying error codes).

Mirrors, retries and health checks

- Mirror config: allow multiple mirrors with priorities and health status. Store mirror config in `mirrors.json` and use runtime health checks to downgrade failing mirrors.
- Retries: use exponential backoff for transient network errors and attempt alternate mirrors before failing the install.
- Blacklist: maintain a per-version health cache for installers/artifacts that are known-broken and hide or flag them in the UI.

Logging & diagnostics

- Structured logs: produce structured logs (JSON-lines) in addition to human-readable text logs when verbose/debug mode is enabled.
- Log location: `logs/<iso-timestamp>.log`. Keep a configurable retention policy (e.g., last N logs or last X days).
- Crash reports: collect JVM stdout/stderr and `game/crash-reports` and package them with a short diagnostics manifest that lists the verification state and system info (only with user consent).

Server / headless operation preferences

- Separate prepared bundles: for headless servers prefer distributing processed bundles (prepared `versions/` + `libraries/`) instead of requiring the installer to run processors on the server.
- Ownership and service account: run server installs under a dedicated service account and ensure the file ownership and permissions are set to that account.
- Non-interactive operations: prefer idempotent, resumeable download/installation steps and provide clear non-interactive error codes for automation.

Style / documentation and PR conventions

- Documentation: keep machine-facing docs under `docs/` with clear file names (e.g., `forge_installation.md`, `launch_process.md`, `vesta_preferences.md`).
- Commits: keep commits focused; use conventional commit messages (optional) and include a short description of schema/migration changes when altering on-disk formats.
- Migrations: when adding or changing on-disk schemas, use Diesel CLI to generate migrations in `src-tauri/migrations/vesta` or `src-tauri/migrations/config`, edit `up.sql` and `down.sql`, update Rust structs, and run migrations automatically on startup.

Appendix: quick rules

- Keep all user-data under the OS standard application data path for user-writable data.
- Use `SHA256` by default for checksums; PGP signatures when available.
- Always perform atomic writes and verify before swap/replace.
- Prefer processed artifacts where available to avoid running installers/processors on the client.
- Telemetry must be opt-in and minimal.

If you want, I can add a small JSON `vesta.config.example.json` and a sample `mirrors.json` schema next. Tell me if you want those added now.