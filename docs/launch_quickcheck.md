# Launch QuickCheck

A compact checklist to verify an instance is ready to launch.

- **Java**: Confirm `java -version` uses the recommended major and is 64-bit.
- **Version manifest**: `versions/<id>/version.json` exists and `mainClass` + `libraries` are present.
- **Libraries**: All required jar files referenced in `libraries` are present under `libraries/` or available on mirrors.
- **Natives**: Native archives were downloaded and extracted into `natives/`; `-Djava.library.path` will point to that directory.
- **Assets**: `assets/indexes/<version>.json` exists and asset objects are present in `assets/objects/` with matching hashes.
- **Checksums**: Critical jars (client jar, patched jars) match published checksums if available.
- **Profile**: Launcher profile points to the correct `version` id and uses the intended `java` path.
- **Permissions**: Launcher has write access to install/cache directories; AV exclusions applied if native DLLs are blocked.
- **Fallbacks**: Mirrors configured for major Maven hosts or asset endpoints.
- **Crash logs**: Launcher can capture stdout/stderr and has an accessible crash reports folder for quick debugging.

Use this checklist as a pre-launch gate in debug mode to reduce common launch errors.
