# Installing Each Minecraft Version / Loader

This guide explains how Vesta Launcher installs different Minecraft runtimes and loaders (Vanilla, Fabric, Forge/NeoForge, Quilt). It focuses on the installer's responsibilities and what the launcher performs automatically.

Terminology
- `instance` — the folder containing a single game installation (game jars, libs, assets, `data/`, and config).
- `data_dir` — a per-instance folder where `data/*` entries from installer JARs are extracted. Java-based processors expect resources here.
- `libraries_dir` — folder where runtime libraries (Maven artifacts) are stored.
- `InstallSpec` — internal object that describes which version/loader to install and where to place files.

Vanilla
- What installer does: downloads the Minecraft version manifest, fetches the client (and server) JARs and required libraries, downloads assets, and writes the `version` metadata into the instance.
- Files placed: `versions/<version>/<version>.jar`, libraries under `libraries_dir`, assets under `assets/`.
- How to run: the launcher uses the `Vanilla` installer implementation in `crates/piston-lib` which performs the above steps. No Java is required for the launcher to fetch files (Java is required only to run Minecraft itself).

Fabric
- What installer does: downloads the Fabric loader + mappings and sets up the runtime by adding loader libraries and updating the version metadata so the client runs with Fabric.
- Remapping/mappings: Fabric uses mappings/merge steps; the launcher obtains loader JARs and libraries for the selected Fabric loader+version.
- How to run: the Fabric installer implementation downloads the Fabric installer metadata and dependencies. The resulting instance contains the Fabric loader libraries and an updated version descriptor.

Quilt
- What installer does: similar to Fabric — the launcher downloads Quilt loader files, injects the loader libraries, and updates the instance metadata accordingly.
- How to run: the Quilt implementation follows the same pattern as Fabric in the `installer/` folder; it places loader-specific libraries and updates the `versions` metadata.

Forge / NeoForge (processors and Java execution)
- Overview: Forge/NeoForge installs often include Java-based processors (external JAR files) that must be executed to transform or patch the Minecraft client JAR. These processors receive command-line arguments and may reference files under `data/*`.
- Key steps the launcher performs:
  - Download the base Minecraft client JAR and required libraries (Maven coordinates are resolved and libraries downloaded into `libraries_dir`).
  - Extract any `data/*` entries found in installer JARs into the instance `data_dir` so processors can access them at `data/<name>`.
  - Reserve library paths for Maven coordinates referenced by the installer and download the artifacts.
  - Invoke processors (Java processes) with normalized arguments so file paths referencing `data/*` point to `data_dir` locations. Processors run using the system `java` executable and the classpath constructed from the downloaded artifacts.
- Requirements and notes:
  - Java: Processors are Java programs — ensure `java` (JRE/JDK) is available on `PATH` when running Forge/NeoForge installs. Tests that validate Java will fail if `java` is missing.
  - `data/*` extraction: processors commonly pass arguments like `/data/client.lzma`. The installer extracts such entries into `data_dir` so processors can open them via `FileInputStream`.
  - Missing `data` entries: if a processor fails with FileNotFoundException for a `data/*` file, check `data_dir` and `libraries_dir` for the resource. The installer tries to extract from installer JARs; if the resource was expected from a remote library, the library resolution code must fetch it (see `crates/piston-lib/src/game/installer/forge_common.rs`).
  - Logging: processor stdout/stderr is captured and surfaced by the installer's progress reporting. Look at logs for detailed Java stack traces when a processor fails.

Modpack / Server Packs
- For modpacks or curated packs, the launcher follows the pack's manifest which may include pre-built runtime jars, resources, or instructions to run pack-provided installers. The launcher tries to honor the manifest by extracting `data/*` and resolving library references as above.

Troubleshooting
- Java fails or not found: verify that `java -version` works in your shell. On Windows, ensure the JRE/JDK bin directory is on `PATH`.
- Processor FileNotFoundException for `data/<file>`: inspect the instance `data_dir` and `libraries_dir`. If the file is absent, confirm the installer JAR contains the `data/<file>` entry or that the maven artifact providing it was downloaded successfully.
- Library resolution issues: check that the launcher can access the network and the configured Maven repositories. See `crates/piston-lib` logic for `maven_to_path` and artifact downloading.

Developer notes & references
- Installer implementations: `crates/piston-lib/src/game/installer/` (per-loader implementations and shared helpers such as `forge_common.rs`).
- Processor invocation and normalization: `crates/piston-lib/src/game/installer/forge_processor.rs`.
- Example runner: `crates/piston-lib/examples/test_install.rs` demonstrates running an install end-to-end in a development environment.
- Tests: Add unit tests under the appropriate crate to validate extraction and processor behavior. Some tests are environment dependent (Java presence).

Running an install locally (quick example)
1. Ensure Rust toolchain and (optionally) `java` are installed.
2. From the repository root run:

  cargo run -p piston-lib --example test_install

This example performs a test install and prints progress to the console — useful when developing installer logic.
