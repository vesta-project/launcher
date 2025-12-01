# Developer Guide

This document covers typical developer workflows, code conventions and where to make common changes.

Workflows
- Start development server (frontend + backend):

  bun run vesta:dev

- Run backend unit tests:

  cargo test -p piston-lib --lib

- Build backend for release:

  cd src-tauri
  cargo build --release

Key places to change
- Database schemas: Modify Rust structs with `#[derive(SqlTable)]` and add a migration in `src-tauri/src/utils/migrations/definitions.rs`.
- Installer logic: `crates/piston-lib/src/game/installer/` (loader-specific logic and shared helpers).
- Frontend components/styles: `vesta-launcher/src/`

Coding conventions & notes
- Prefer `anyhow::Result` for fallible functions in the backend.
- Tasks report progress via the `NotificationManager`. Use `client_key` to update existing notifications.
- When changing the installer model (e.g., altering where files are extracted), add unit tests in `crates/piston-lib/tests` or the matching module tests in `src/`.

Troubleshooting
- Environment dependent tests: ensure Java is installed and PATH entries are correct.
- File not found in processors: processors often expect resources under `data/` — the installer extracts `data/*` entries into the instance `data_dir`.
