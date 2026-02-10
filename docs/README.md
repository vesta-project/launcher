# Documentation Index

This folder contains developer-facing documentation for Vesta Launcher. Use this index to find guides, reference material, and deep dives into the codebase.

## Core Docs
- `docs/ARCHITECTURE.md` — architecture overview and key patterns.
- `docs/DEVELOPMENT.md` — developer workflows, conventions, and troubleshooting.
- `docs/CONTRIBUTING.md` — contribution workflow and maintainer notes.

## Repository Guides (Root)
- `MIGRATION_GUIDE.md` — database migration guidance (Diesel).
- `DATABASE_GUIDE.md` — how the SQLite schema and Diesel ORM work.
- `NOTIFICATION_USAGE.md` — notification / task reporting patterns.
- `QUICK_REFERENCE.md` — assorted quick commands and shortcuts.
- `INSTALLATION_FLOW_ANALYSIS.md` — analysis of installation flows.
- `INSTALLER_IMPLEMENTATION.md` — installer implementation details.

## How to Use
- **Start Local Dev (Frontend + Tauri):**
  ```
  bun run vesta:dev
  ```
- **Build the Backend:**
  ```
  cd vesta-launcher/src-tauri
  cargo build
  ```
- **Run Tests for the Core Crate:**
  ```
  cargo test -p piston-lib --lib
  ```

## Adding Docs
- To add more documentation, add a file under `docs/` and update this index with a short summary.

## Contact / Help
- If you need help, open an issue or a draft PR describing what you'd like to add or change.
