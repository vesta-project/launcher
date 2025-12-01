# Test Catalog & How To Run Tests

This document explains where tests live in the repository, how to run them, and highlights a few notable, environment-dependent tests to watch for when running the suite locally.

Overview
- Tests in this workspace are primarily Rust unit and integration tests distributed across crates under `crates/` and integration tests under `tests/` folders. The frontend (`vesta-launcher/`) may contain its own JS/TS tests (Vite/Vitest), but the core launcher logic is tested in Rust.

Where tests live
- `crates/piston-lib/` — unit tests and module tests for installers, processors, and launcher logic (primary location for installer-related tests).
- `crates/piston-lib/tests/` — integration-style tests (e.g., installer flow tests).
- `crates/piston-macros/` — tests for the procedural macros (derive behavior, sqlite helpers).
- `src-tauri/` — may contain tests for Tauri-specific or migration logic.
- `playground/` and `rust-playground/` — small example projects and can contain tests used for experimentation.

Notable tests (examples you may encounter)
- `game::launcher::arguments::tests::build_variables_canonicalize_paths` — verifies path canonicalization behavior; can fail on systems with unusual filesystem setups.
- `game::launcher::process::tests::test_verify_java` — checks that `java` is available and usable; fails when Java is not on `PATH`.
- `crates/piston-lib` tests around `prepare_data_files` — these tests validate extraction of `data/*` entries from installer JARs and library artifacts (e.g., `prepare_data_files_handles_maven_and_jar_entries`, `prepare_data_files_extracts_data_from_library_jars`).
- Integration tests in `crates/piston-lib/tests/` such as `integration_natives_flow.rs` — can emulate platform-native behavior and validate multi-step flows.

How to run tests
- Run all tests in the workspace (may be slow):

  cargo test

- Run tests for a single crate (example: `piston-lib`):

  cargo test -p piston-lib --lib

- Run a single test by name (example):

  cargo test -p piston-lib --lib prepare_data_files_extracts_data_from_library_jars

- Run the example installer (useful for manual end-to-end checks):

  cargo run -p piston-lib --example test_install

Environment-dependent tests and tips
- Java: Tests that verify Java or run Java-based processors require `java` on `PATH`. On Windows, ensure the JRE/JDK `bin` directory is in your environment `PATH`. Verify with:

  java -version

- Filesystem canonicalization: Some tests assert canonicalized paths. If a test like `build_variables_canonicalize_paths` fails, check platform-specific path behaviors and filesystem permissions.
- Network requirements: Some tests that validate artifact downloads require network access to Maven repositories or asset servers. If tests fail due to network timeouts, re-run in a connected environment.

Debugging failing tests
- Increase verbosity when running tests:

  RUST_LOG=debug cargo test -p piston-lib --lib

- Inspect test-specific temporary directories printed by the tests (look for `tempdir` or `target/` outputs) to see extracted files like `data/client.lzma` or downloaded artifacts under `libraries_dir`.
- When a Java processor fails with `FileNotFoundException` for `data/*`, inspect the instance `data_dir` and the library paths; ensure the installer extracted the `data/*` entry from the JAR or that a library-provided resource was downloaded.

Adding tests
- Add unit tests alongside the module under `src/` using `#[cfg(test)]` and `mod tests { ... }`.
- For integration tests, add files under the crate `tests/` directory (they are compiled as separate binaries). Use `tempfile` or `assert_fs` crates for safe temporary files and directories.

CI and automation
- CI should run `cargo test --workspace` or crate-targeted tests as appropriate. Consider marking Java-dependent tests as conditional in CI if Java is not available on the worker images.

References in code
- Installer logic & tests: `crates/piston-lib/src/game/installer/` and `crates/piston-lib/tests/`.
- Processor invocation tests: `crates/piston-lib/src/game/installer/forge_processor.rs` and related unit tests that assert argument normalization and file extraction.
- Migration and DB tests: `src-tauri/src/utils/migrations/` and `crates/piston-macros/` tests for `SqlTable` derive behavior.

If you want, I can also:
- Generate a machine-readable list of all test names in the workspace (requires running `cargo test -- --list` or parsing `cargo metadata`).
- Add a CI-friendly script that runs the non-Java tests quickly and the Java tests only when `java` is present.
