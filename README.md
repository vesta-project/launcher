# Vesta Launcher

Vesta Launcher is a desktop Minecraft launcher built with Tauri (Rust) for the backend and SolidJS (TypeScript) for the frontend. This repository contains the launcher, core libraries, installer logic, and supporting tools used by the app.

This README provides a high-level overview and quick developer instructions. More detailed design and developer guides live in the `docs/` directory.

Quick links

- Source root: this repository
- Frontend app: `vesta-launcher/`
- Backend / Tauri: `vesta-launcher/src-tauri/`
- Core Rust library: `crates/piston-lib/`
- Docs: `docs/`
- Launch process addendum: `docs/launch_process_addendum.md`
- Storage & naming preferences: `docs/vesta_preferences.md`

Prerequisites

- Rust toolchain (stable) with Cargo
- Bun (for frontend scripts) or Node.js + npm/yarn/pnpm if you prefer
- Java (optional, required for some installer processors and some tests)

Quick start (development)

- Start frontend + Tauri dev server (recommended):

  bun run vesta:dev

- Build backend crate(s):

  cd vesta-launcher/src-tauri
  cargo build

- Run an example installer (core library):

  cargo run -p piston-lib --example test_install

- Run tests (example: crate `piston-lib`):

  cargo test -p piston-lib --lib

Repository structure (short)

- `vesta-launcher/`: SolidJS frontend (Vite). UI components, styles, and app entrypoints.
- `vesta-launcher/src-tauri/`: Tauri backend integration and Rust-based app entrypoint and configuration.
- `crates/piston-lib/`: Core installer/launcher logic. Contains installers (Vanilla, Fabric, Forge/NeoForge, Quilt), updater logic, and task/reporting abstractions.
- `docs/`: high-level developer documentation (architecture, install, dev workflow, contributing).

Important patterns & conventions

- Database schema: Use Diesel ORM for schema definitions in `src-tauri/src/schema.rs` and models in `src-tauri/src/models`. Migrations managed via Diesel CLI in `src-tauri/migrations/vesta` and `src-tauri/migrations/config`.
- Tasks & notifications: Long-running operations are implemented as `Task`s and reported via `NotificationManager` semantics. Use `client_key` for updating notifications; progress is 0..100 or indeterminate.
- Processor/JAR handling: Installer processors (Java-based) may rely on files in `data/*`. The Rust installer extracts `data/*` entries into the install `data_dir` so Java processors can access them.
- Cross-platform paths: Code normalizes forward/back slashes where necessary; prefer using path abstractions for file operations and canonicalization.

Tests & environment notes

- Some tests are environment-dependent (e.g., Java verification, path canonicalization). If a test fails locally, check that Java is installed and on `PATH` and that the filesystem canonicalization works for your OS.

Where to get help

- See `docs/` for developer-focused documentation and the existing guides in the repo root (e.g., `DATABASE_GUIDE.md`, `NOTIFICATION_USAGE.md`, `MIGRATION_GUIDE.md`).

Configuration references

- Use `docs/launch_process_addendum.md` for integrity, rollback, and server guidance referenced by installers.
- Storage, naming, and path rules live in `docs/vesta_preferences.md`.
- Sample config surfaces live in `docs/vesta.config.example.json` and `docs/mirrors.example.json` (remove `$comment` keys before shipping).

License

- See `LICENSE` at repository root.

--
This README is a concise entrypoint. For architecture and developer workflows, see `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md`.
