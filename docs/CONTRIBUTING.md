# Contributing

We welcome contributions. This file captures a short workflow for contributing changes.

## How to Contribute
1. Fork the repository and create a feature branch.
2. Implement tests for behavior you change (unit tests or integration tests under the appropriate crate).
3. Run the relevant test suites locally (see `docs/DEVELOPMENT.md` for commands).
4. Open a pull request describing the change, the motivation, and any breaking changes (migrations required, API changes, etc.).

## Notes for Maintainers
- **Migrations:** When database schema changes, generate a new migration using `diesel migration generate` in `src-tauri/migrations/vesta` or `src-tauri/migrations/config`. Do not edit old migrations; add a new one.
- **Backwards Compatibility:** During active development, small breaking changes are acceptable — document them in the PR description and in `MIGRATION_GUIDE.md`.
