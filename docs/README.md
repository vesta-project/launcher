# Documentation Index

This folder contains developer-facing documentation for Vesta Launcher. Use this index to find guides, reference material, and deep dives into the codebase.

Core docs
- `docs/ARCHITECTURE.md` — architecture overview and key patterns.
- `docs/INSTALLATION.md` — how to run and build the app locally.
- `docs/DEVELOPMENT.md` — developer workflows, conventions, and troubleshooting.
- `docs/CONTRIBUTING.md` — contribution workflow and maintainer notes.

Repository guides (root)
- `MIGRATION_GUIDE.md` — database migration guidance.
- `DATABASE_GUIDE.md` — how the SQLite schema and `SqlTable` derive macro work.
- `NOTIFICATION_USAGE.md` — notification / task reporting patterns.
- `QUICK_REFERENCE.md` — assorted quick commands and shortcuts.

How to use
- Start local dev (frontend + Tauri):

  bun run vesta:dev

- Build the backend:

  cd src-tauri
  cargo build

- Run tests for the core crate:

  cargo test -p piston-lib --lib

Adding docs
- To add more documentation, add a file under `docs/` and update this index with a short summary.

Contact / help
- If you need help, open an issue or a draft PR describing what you'd like to add or change.
