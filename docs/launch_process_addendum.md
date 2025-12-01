# Launch Process — Addendum (integrity, backups, Java/ARM, server notes)

This addendum provides missing conceptual guidance for launchers and installers. It intentionally contains no command examples — only high-level, copyable guidance and operational notes.

Integrity verification (checksums and signatures)

- Treat integrity checks as a core part of any download/retrieval pipeline. For each installer, library, asset index, or processed artifact the launcher accepts, require an integrity assertion (checksum or cryptographic signature) prior to executing or permanently installing it.
- Make verification visible: surfaces success/failure and the verification method (SHA256, PGP) in the UI so users and pack authors can validate provenance.
- Fail-safe behavior: refuse to execute or install artifacts that cannot be verified or that fail verification; present clear remediation (retry mirror, obtain publisher key, select different release).

Pre-install backups & rollback strategy

- Always offer a pre-install backup option for actions that mutate user directories (`versions/`, `libraries/`, `mods/`, `config/`, `saves/`). Keep backups minimal and targeted to the scope of change.
- Use atomic replacement where possible: write generated or downloaded processed outputs to a temporary location, verify integrity, then atomically replace existing files/directories to avoid half-completed installs.
- Provide an explicit rollback action in the launcher that restores the previous state from the backup snapshot or reverses the atomic swap.

Uninstallation and targeted cleanup

- Prefer targeted cleanup over destructive deletions:
  - Remove only the `versions/<id>/` folder and libraries that are provably unused by other installed versions.
  - Use quarantine for suspect files rather than immediate deletion to allow user inspection and restore.
- Expose a recoverable uninstall that records what was removed so that users can restore from backups if needed.

Java architecture & ARM (aarch64) considerations

- Resolve architecture as part of runtime selection and native classifier decision-making:
  - Detect runtime architecture and map it to available native classifiers. Surface mismatches (e.g., aarch64 runtime with only x86 natives) as warnings and document compatibility trade-offs.
  - Prefer aarch64 runtimes on ARM hosts; if a pack lacks aarch64 natives, provide guidance to obtain a matching pack or use an x86 runtime with translation where practical.
- Document which libraries are architecture-dependent and which are cross-platform to help pack authors supply compatible artifacts.

Server and headless install considerations (conceptual)

- Treat servers as a build + deploy environment rather than a place to run arbitrary GUIs or processors:
  - If installers require processors that are not suitable for headless execution, recommend creating processed artifact bundles in a build environment and distributing the prepared bundle to server hosts.
  - Ensure installation runs under a dedicated service account with appropriate file ownership and permissions to avoid runtime permission errors.
- Provide guidance for automation: record the minimal set of files to transfer for prepared deployments (`versions/`, `libraries/`, `server.jar`, `start scripts`) and how to validate integrity after transfer.

Cross-references and operational notes

- Surface these checks in a pre-launch gate or debug mode (see `docs/launch_quickcheck.md`) so users and pack authors can validate readiness before launching.
- Telemetry: record verification and install outcomes in an opt-in, privacy-preserving manner (status codes and timestamps rather than file contents).


# Rationale

These conceptual policies help reduce user-facing failures caused by corrupted downloads, misplaced or missing native libraries, incomplete processor runs, or permission/ownership issues on servers. They are intentionally non-prescriptive and avoid platform-specific commands — they are intended to be applied by launcher implementers to match their UI and automation models.
