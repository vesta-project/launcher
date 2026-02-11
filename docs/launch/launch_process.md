# Launch Process (download, prepare, JVM args)

Source: `packages/app-lib/src/launcher/*.rs` in Modrinth repo (notably `mod.rs`, `download.rs`, `args.rs`).

High-level launcher responsibilities

- Download Minecraft `version.json` (and modded variant `version-id-loaderid.json`).
- Download assets (from `resources.download.minecraft.net`) and legacy assets when needed.
- Download and extract libraries, handling native classifiers for the target platform and `java_arch`.
- Prepare the classpath and launcher classpath, including special launcher jars if required.
- Construct JVM arguments, including module opens for modern Java versions, main class, and game arguments.
- Spawn the Java process and manage process metadata (logging, post-exit hooks).

Relevant behaviors from Modrinth code

- `download_version_info` forms a version id using loader information: if a loader is present the version id becomes `minecraftVersion-loaderId`.
- Asset fetching uses a path with the first two chars of the hash as subdirectory: `https://resources.download.minecraft.net/{sub_hash}/{hash}`.
- Library download logic tries multiple mirror URLs and treats download failures non-fatally for some optional libraries.
- Native libraries are detected by `library.natives_os_key_and_classifiers(java_arch)` and the server fetches native classifier archives, extracts them into the version natives dir, and records success/failure.
- Classpath is constructed via `get_class_paths` which canonicalizes paths and collects library paths unless rules exclude them.
- Launcher sets env vars, removes `_JAVA_OPTIONS`, and handles platform-specific env tweaks (e.g., `DYLD_FALLBACK_LIBRARY_PATH` on macOS when `CARGO` is set).

Minecraft argument construction

- The launcher uses `args::get_minecraft_arguments` to merge argument templates from `version.json` with launcher-provided substitutions (credentials, asset paths, profile paths, resolution, QuickPlay options, etc.).

Process lifecycle

- The launcher ensures only one instance per profile, records process pid/uuid, and optionally minimizes the app window and updates presence (RPC) when starting.

## Frontend Launch Integration

The frontend plays a crucial role in initiating and monitoring the launch process, providing user interaction and real-time feedback through the UI.

### Launch Initiation

- Launch is triggered from the UI via a launch button or action, which calls the `launchInstance()` function.
- This function invokes the Tauri command `launch_instance` with the instance data: `invoke("launch_instance", { instanceData: instance })`.
- The frontend immediately updates the UI to reflect the launching state, preventing multiple concurrent launches for the same instance.

### State Tracking

- Launching instances are tracked in the `launchingIds` store, which maintains a set of instance IDs currently in the process of launching.
- Once launched successfully, instances transition to the `runningIds` store to indicate active running processes.
- These stores enable the UI to display appropriate status indicators (e.g., loading spinners, disabled buttons) and prevent conflicting actions.

### Event Handling

- The frontend listens for Tauri events to receive updates on instance state changes:
  - `core://instance-launched`: Confirms successful launch and triggers UI updates.
  - `core://instance-exited`: Handles process termination and cleans up running state.
  - `core://instance-updated`: Receives general instance status updates.
- Event listeners ensure the UI stays synchronized with backend state without constant polling.

### Notifications and Progress

- The notification system provides real-time feedback during launch:
  - Progress notifications track download, preparation, and JVM startup phases.
  - Error notifications alert users to launch failures with actionable details.
  - Success notifications confirm when instances are ready to play.
- Notifications use a `client_key` for tracking and updating progress bars, converting to dismissible "Patient" type upon completion (progress >= 100).

### Error Handling and Recovery

- Launch failures are communicated through notifications and UI state changes.
- The frontend handles various error scenarios:
  - Missing dependencies or corrupted files.
  - JVM compatibility issues.
  - Network failures during asset/library downloads.
- Users are provided with clear error messages and potential remediation steps.

### Post-Launch UI Updates

- Upon successful launch, the UI updates to show the instance as running.
- Window management may occur (e.g., minimizing the launcher window).
- Presence/RPC updates reflect the active game session.
- The launch button becomes available again for other instances.

This integration ensures a seamless user experience from launch initiation through gameplay, with robust error handling and real-time status updates.

Recommendations

- Mirror libraries and assets where possible for reliability.
- Extract and include native files in the `natives` directory and ensure `java` process includes `-Djava.library.path` or equivalent when launching.

References

- `packages/app-lib/src/launcher/download.rs`
- `packages/app-lib/src/launcher/mod.rs`
- `packages/app-lib/src/launcher/args.rs`


Deeper explanation — detailed launcher logic and edge cases

	- Version/manifest resolution
		- Vanilla and modded manifests: launchers download the vanilla `version.json` (from Mojang) but for modded instances they often fetch a patched manifest named like `minecraftVersion-loaderId` (Modrinth composes this in `download_version_info`). Loader installers (Fabric/Quilt/Forge) typically produce or require a modified `version.json` that points at extra libraries, tweaked mainClass, or patched arguments.
		- Fabric/Quilt behavior: installers and mirror tooling sometimes patch the `version.json` placeholders (Modrinth's `fabric.rs` replaces dummy tokens), so a launcher must treat patched manifests as authoritative for runtime composition when present.

	- Libraries, rules, and classifiers
		- Each library entry in `version.json` can include a `rules` block that controls whether the library is included on the current runtime (OS name, features, architecture, or custom conditions). Launchers must evaluate these rules exactly as defined (allow/disallow precedence) before adding the library to the classpath or native download list.
		- Native libraries use an entry under `natives` with platform keys; the launcher should select the classifier matching the target OS and architecture (e.g., `natives_windows` + `classifier` such as `natives-windows` or `natives-windows-arm64`). Modrinth's `library.natives_os_key_and_classifiers(java_arch)` indicates that it selects appropriate keys/classifiers by `java_arch`.
		- Classifiers and optional artifacts: some libraries publish multiple classifiers or optional artifacts. Download failures for non-essential artifacts should not fail the entire launch; the launcher should follow the manifest's `optional` semantics (several launcher libraries treat certain libs as optional). Retry and mirror fallback logic improves robustness.

	- Asset system
		- The asset index (`objects` map) references resource file hashes. The download URL pattern is `https://resources.download.minecraft.net/{sub}/{hash}` where `{sub}` is the first two hex chars of the hash. Launchers should verify downloaded file hashes and sizes before use.
		- Legacy assets and resource merging: older versions and third-party mods sometimes require additional asset overlay semantics—ensure the launcher supports asset index merging and optional resource packs in the right order.

	- Native extraction and security
		- Natives are delivered as zip archives (classifiers). Launchers must extract native files into a version-scoped `natives/` directory and set `-Djava.library.path` or pass native paths via JVM options. Extraction must be done carefully: reject paths with `..`, normalize paths to prevent directory traversal, and set appropriate file permissions on Unix.
		- Windows specifics: extracted natives may be locked by the JVM; avoid deleting or overwriting native DLLs for running instances. Also canonicalize paths to avoid Windows path-length issues (use the short path or UNC if needed) and be cautious of spaces in paths.

	- JVM arguments and modern Java compatibility
		- Older `version.json` files use `minecraftArguments` (a space-separated template) while newer manifests use `arguments.jvm` and `arguments.game` arrays — a launcher must support both and merge accordingly.
		- Placeholders (e.g., `${auth_player_name}`, `${version_name}`, `${game_directory}`) must be replaced with runtime values (profile paths, credentials, asset paths, window size, etc.). The launcher should escape values containing spaces or special characters.
		- Module openness: for Java ≥ 9 the launcher may need to add `--add-opens=java.base/java.lang.reflect=ALL-UNNAMED` and other `--add-opens` flags. Modrinth's code adds these for `parsed_version >= 9` and additional opens for `>= 25` (JEP 512 related internals). Ensure those flags are included when the JRE is modern and when mods or libraries require reflective access.

	- Classpath construction and long-command workarounds
		- The launcher builds a classpath from all included library jar paths plus the main Minecraft client jar. On Windows, command-line length can become problematic; some launchers mitigate this by creating a small launcher bootstrap jar with a `Class-Path` manifest entry listing every library, or by launching via a JVM option file when supported.
		- Paths should be canonicalized (absolute) and deduplicated; Modrinth's `get_class_paths` canonicalizes library paths to avoid duplicates and OS quirks.

	- Authentication and session data
		- The launcher injects auth/session fields (UUID, accessToken, clientToken, userType) into the `arguments.game` placeholders or environment variables as required by the launcher protocol. For offline mode, substitute minimal placeholders (username) but skip the network auth checks.
		- Account migration: newer auth systems may require additional tokens (e.g., XSTS/Microsoft flows); the launcher must supply the correct token form to the `sessionserver`/`authentication` fields expected by the runtime or modded frameworks.

	- Process lifecycle, logging, and crash handling
		- Spawn the JVM process with redirected stdout/stderr to capture logs. Many modded launchers capture and forward log lines to a console view and parse known exception patterns to produce useful error messages or links to crash reports.
		- Record process PID/UUID and attach post-exit hooks to update UI state, mark the instance as no-longer-running, and optionally upload telemetry/crash logs (only with user consent).

	- Modloader and installer processor implications (Forge, NeoForge)
		- Forge installers run processors that modify or generate library artifacts (BINPATCH, LZMA expanded artifacts, etc.). If a launcher simply downloads a Forge `version.json` but the server/mirror hasn't run processors, the runtime may be missing libraries or have broken jars. Two options:
			1. Run the official Forge installer on the host (it runs processors locally and writes the final `version.json` and libraries).
			2. Use a mirror that runs processors server-side and provides fully-processed libraries and a patched `version.json` (this is Modrinth's approach for reliability).
		- When processors are required, the launcher must either execute installer processing steps or prefer processed artifacts to avoid runtime failures.

	- Mirrors, blacklists, and health checks
		- Mirror libraries and assets to improve availability and performance. Modrinth rewrites artifact URLs to internal maven mirrors when ingesting installers.
		- Maintain a health-check cache of known-broken installer versions (blacklist) so the launcher UI can hide or flag those versions and guide users to alternatives.

	- Security and sandboxing notes
		- Launching unverified modded code implies running third-party native binaries and arbitrary Java code. Consider sandboxing policies where practical (running in a separate user account, isolating filesystem paths) and always warn users when running unsigned or untrusted installers.

	- Append guidance

	- Add the above details to `docs/launch_process.md` so implementers know the edge cases to handle. The core checklist for a robust launcher is:
		1. Fetch and prefer processed/patched `version.json` for modded instances.
		2. Evaluate `rules` for every library before including it.
		3. Resolve native classifiers precisely and extract safely.
		4. Construct JVM args with placeholders replaced and include `--add-opens` for modern Java as needed.
		5. Provide retry/mirror fallbacks for downloads and maintain a blacklist/health cache for broken installers.

# Launch Process — Addendum (integrity, backups, Java/ARM, server notes)

This addendum provides missing conceptual guidance for launchers and installers. It intentionally contains no command examples — only high-level, copyable guidance and operational notes.

## Integrity verification (checksums and signatures)

- Treat integrity checks as a core part of any download/retrieval pipeline. For each installer, library, asset index, or processed artifact the launcher accepts, require an integrity assertion (checksum or cryptographic signature) prior to executing or permanently installing it.
- Make verification visible: surfaces success/failure and the verification method (SHA256, PGP) in the UI so users and pack authors can validate provenance.
- Fail-safe behavior: refuse to execute or install artifacts that cannot be verified or that fail verification; present clear remediation (retry mirror, obtain publisher key, select different release).

## Pre-install backups & rollback strategy

- Always offer a pre-install backup option for actions that mutate user directories (`versions/`, `libraries/`, `mods/`, `config/`, `saves/`). Keep backups minimal and targeted to the scope of change.
- Use atomic replacement where possible: write generated or downloaded processed outputs to a temporary location, verify integrity, then atomically replace existing files/directories to avoid half-completed installs.
- Provide an explicit rollback action in the launcher that restores the previous state from the backup snapshot or reverses the atomic swap.

## Uninstallation and targeted cleanup

- Prefer targeted cleanup over destructive deletions:
  - Remove only the `versions/<id>/` folder and libraries that are provably unused by other installed versions.
  - Use quarantine for suspect files rather than immediate deletion to allow user inspection and restore.
- Expose a recoverable uninstall that records what was removed so that users can restore from backups if needed.

## Java architecture & ARM (aarch64) considerations

- Resolve architecture as part of runtime selection and native classifier decision-making:
  - Detect runtime architecture and map it to available native classifiers. Surface mismatches (e.g., aarch64 runtime with only x86 natives) as warnings and document compatibility trade-offs.
  - Prefer aarch64 runtimes on ARM hosts; if a pack lacks aarch64 natives, provide guidance to obtain a matching pack or use an x86 runtime with translation where practical.
- Document which libraries are architecture-dependent and which are cross-platform to help pack authors supply compatible artifacts.

## Server and headless install considerations (conceptual)

- Treat servers as a build + deploy environment rather than a place to run arbitrary GUIs or processors:
  - If installers require processors that are not suitable for headless execution, recommend creating processed artifact bundles in a build environment and distributing the prepared bundle to server hosts.
  - Ensure installation runs under a dedicated service account with appropriate file ownership and permissions to avoid runtime permission errors.
- Provide guidance for automation: record the minimal set of files to transfer for prepared deployments (`versions/`, `libraries/`, `server.jar`, `start scripts`) and how to validate integrity after transfer.

## Cross-references and operational notes

- Surface these checks in a pre-launch gate or debug mode (see `docs/launch_quickcheck.md`) so users and pack authors can validate readiness before launching.
- Telemetry: record verification and install outcomes in an opt-in, privacy-preserving manner (status codes and timestamps rather than file contents).

## Rationale

These conceptual policies help reduce user-facing failures caused by corrupted downloads, misplaced or missing native libraries, incomplete processor runs, or permission/ownership issues on servers. They are intentionally non-prescriptive and avoid platform-specific commands — they are intended to be applied by launcher implementers to match their UI and automation models.



Troubleshooting checklist (quick run-through)

- Download & manifest checks:
  - Confirm `versions/<id>/version.json` exists and its `libraries` list is non-empty.
  - Validate checksums of the client jar and key libraries against known-good hashes where available.
- JVM & natives:
  - Run the same `java` binary the launcher will use with `-version` to confirm major & bitness.
  - Verify native DLLs / SOs are extracted to the `natives/` dir and that `-Djava.library.path` points there.
- Classpath & missing classes:
  - If you see NoClassDefFoundError / ClassNotFoundException, ensure `libraries/` contains the jar referenced by the missing class and check `rules` that might have excluded it.
- Asset errors:
  - For missing textures or resources, check the asset index at `assets/indexes/<version>.json` and verify asset objects were downloaded and have matching hashes.
- Installer & processor failures:
  - If a Forge/NeoForge install fails, check installer logs and verify processors either ran or that you obtained a pre-processed `version.json` from a trusted mirror.

Windows permissions & antivirus guidance

- Permissions:
  - On Windows, prefer installing to the standard `%APPDATA%\.minecraft` path or a user-writable directory. If a user attempts to write to `Program Files` or other protected locations, require elevation or prompt for an alternative path.
  - When extracting natives or writing large numbers of small files, avoid creating files as SYSTEM or another user — keep ownership as the current user to prevent later permission conflicts.
- Antivirus / Defender interactions:
  - Native DLLs or modified client jars may trigger Windows Defender/AV heuristics. When this happens:
    - Recommend the user temporarily whitelist the launcher folder or add an exclusion for the specific `natives/` path and installer cache.
    - Provide guidance on verifying files (checksums/signatures) before whitelisting.
  - For distributions or launchers, sign native helper executables/launchers where possible to reduce AV false positives.


## Frontend Launch Hooks

The frontend integrates with the launch process through event-driven communication with the Tauri backend. The SolidJS UI listens for launch-related events emitted by the Rust backend to update the user interface in real-time.

### Event Flow

Launch events are emitted from the `instances.rs` command handlers and received by the frontend via Tauri's `listen` API:

- **`core://instance-launched`**: Fired when the Minecraft process starts successfully
  - Payload: Instance metadata including process ID and launch configuration
  - UI Response: Update instance status to "running", enable stop/kill buttons, start log monitoring

- **`core://instance-exited`**: Fired when the Minecraft process terminates normally
  - Payload: Exit code and final statistics
  - UI Response: Update instance status to "stopped", disable control buttons, display exit summary

- **`core://instance-log`**: Fired for each line of output from the Minecraft process
  - Payload: Log line with timestamp and source (stdout/stderr)
  - UI Response: Append to log display, apply filtering/coloring based on log level

- **`core://instance-killed`**: Fired when the process is forcibly terminated
  - Payload: Termination reason and signal used
  - UI Response: Update status to "killed", show termination notification

### Frontend Integration

The frontend uses SolidJS `createSignal` and `createResource` to manage launch state:

```typescript
// Listen for launch events
const [instanceStatus, setInstanceStatus] = createSignal<InstanceStatus>('stopped');

listen('core://instance-launched', (event) => {
  setInstanceStatus('running');
  // Update UI state
});

listen('core://instance-exited', (event) => {
  setInstanceStatus('stopped');
  // Handle cleanup
});
```

Events are processed in the main application component (`app.tsx`) and propagated to instance-specific components through SolidJS's reactive system.
