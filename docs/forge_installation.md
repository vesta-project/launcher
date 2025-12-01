# Forge Installation (notes & installer formats)

Source: extracted from Modrinth App code (`apps/daedalus_client/src/forge.rs`) and launcher handling code.

Summary

- Forge uses multiple installer "formats" historically. Modern Forge uses an installer JAR that contains an `install_profile.json` and (often) embedded libraries and processors.
- Modrinth's code recognizes at least three formats:
  - Format 0: Legacy (pre-1.5.2) — binary patch/zip style (unsupported by Modrinth App currently).
  - Format 1: Forge Installer Legacy (roughly the 1.5.2–1.12.2 era) — requires extracting `install_profile.json` and library paths from the installer archive.
  - Format 2: Forge Installer Modern — extract `install_profile.json` and `version.json`, extract embedded libraries and processor data; the launcher or installer needs to run processors or use the processed output.

Installer URLs (examples used by Modrinth code)

- Maven central paths are used, for example:
  - `https://maven.minecraftforge.net/net/minecraftforge/forge/{version}/forge-{version}-installer.jar`
  - `https://maven.minecraftforge.net/net/minecraftforge/forge/{version}/forge-{version}-universal.zip` (older/legacy)

User-facing install steps (high-level)

1. Download the Forge installer JAR for the desired loader/game version.
2. Run the installer with Java: `java -jar forge-<loader>.jar` — choose "Install client" (or use CLI options where supported).
3. The installer will create or modify a Minecraft version directory under `%APPDATA%/.minecraft/versions/<version>-forge-<loader>/` and place the modified client JAR and version JSON.
4. Launch Minecraft with the created Forge profile (the launcher reads the version JSON and required libraries).

Notes from Modrinth implementation

- The Modrinth app fetches Forge metadata from Forge maven metadata (`maven-metadata.json`) and parses loader versions.
- The code accepts multiple version string formats (examples: `1.14.4-28.1.30`, `1.9-12.16.0.1886`, `1.20.1-31.1.87`). It parses out the loader component.
- For format 2 installers, Modrinth extracts `install_profile.json` and embedded `version.json`, then extracts libraries and processors. Processors in modern Forge installers may produce extra libraries (for example, BINPATCH outputs) which are then added to the final version profile.
- Some Forge releases are blacklisted in Modrinth's code due to malformed archives; these cannot be installed automatically.
- When preparing artifacts for distribution, Modrinth rewrites library URLs to point to mirrored maven endpoints so launchers can fetch them from mirrors.

Edge cases / legacy formats

- Format 0 (very old): required applying patches to the vanilla client JAR and deleting `META-INF` entries — unsupported by the Modrinth app and uncommon today.

Recommendations

- Prefer modern Forge installers (format 2) where possible.
- If building a launcher/mirroring pipeline: extract `install_profile.json` and `version.json`, extract embedded libraries and processors, and register the resulting libraries with a mirrored artifact server for reliable downloads.

References

- Modrinth code: `apps/daedalus_client/src/forge.rs` (loader parsing, installer formats, extraction/mirroring).

Detailed installer formats & steps

Format 0 — Legacy (very old, unsupported)

- Description: Very early Forge used binary patching of the vanilla client JAR or distributed client/server zips. Installation required patching the vanilla client JAR (apply a binary patch) and removing or editing `META-INF/*` entries. This is obsolete and unsupported by modern tooling and the Modrinth app.

Format 1 — Forge Installer Legacy (1.5.2 → ~1.12.2 era)

- Description: Installer archive contains an `install_profile.json` which references a Forge library embedded in the installer and includes instructions for building a compatible `version.json` (version profile).

- Typical manual install steps (if not using the official installer GUI):
  1. Download the `forge-{loader_version}-installer.jar` or `forge-{version}-universal.zip` for the target loader/game version from the Forge Maven repository.
  2. Open the archive (JAR/ZIP) and extract `install_profile.json`.
  3. Read `install_profile.json` to discover the `install.path` (location of the embedded forge library in the JAR) and the `versionInfo` entry which contains data representing the final `version.json`.
  4. Extract the Forge library JAR from the archive at the path given by `install.install.path` and place it in the target `.minecraft/libraries/` area, or reference it from your launcher/profile.
  5. Convert `versionInfo` into a `version.json` in the target `versions/<id>/` folder (the legacy installer used a different layout; modern launchers expect a `version.json` with `libraries` and `mainClass`).
  6. Ensure libraries referenced by the converted `version.json` are present (download from their `url`s) and add natives if necessary.

- Notes: This format frequently required manual conversion and can be error-prone because older installers encoded different expectations. Where possible, prefer using the Forge installer to perform the conversion and processor steps automatically.

Format 2 — Forge Installer Modern

- Description: Modern Forge installers include `install_profile.json` and (often) a `version.json` embedded. They also contain "processors" — small tools/data (e.g., BINPATCH) that modify or generate the final client/server jars and additional libraries. The official installer runs processors during installation so the final `version.json` and libraries are produced.

- What a launcher or mirror pipeline must handle:
  - Extract the `install_profile.json` and embedded `version.json` from the installer JAR.
  - Extract embedded libraries and any processor files that the installer would run.
  - If the installer is executed on the user's machine, let the installer run processors (installer does this normally) so the final files are produced in-place in the user's `versions/` directory.
  - If you are building a mirror or preparing artifacts server-side (like Modrinth does), you must either run the processors server-side to produce the final artifacts, or extract the processor output files from the installer archive (some installers embed processed outputs under `data/` or similar paths) and publish them. Modrinth's code contains logic to extract processor outputs and convert them into library entries (e.g., BINPATCH entries become libraries like `[net.minecraftforge:forge:...:shim:client@lzma]`).

- Typical installer-run steps (normal user):
  1. Download `forge-{loader_version}-installer.jar` from Forge maven URLs (e.g., `https://maven.minecraftforge.net/.../forge-{loader_version}-installer.jar`).
  2. Run the installer with Java: `java -jar forge-{loader_version}-installer.jar` and select "Install client" (the installer GUI) or use a CLI option (installer behaviour varies by Forge version; if a CLI exists, check that installer JAR's `--help`).
  3. The installer runs processors, writes the resulting `version.json` and modified client JAR into `%APPDATA%/.minecraft/versions/<version>/`, and places any generated libraries/natives into the launcher-managed directories.
  4. Start the launcher and select the newly created Forge profile/version.

- Important processor notes:
  - Processors can do things like binary patching (BINPATCH) or LZMA-compressed patches and produce shim libraries. If processors are not run, the launcher may be missing the patched client JAR and some libraries, causing launch failures.
  - Modrinth's server-side pipeline extracts processors and uploads their outputs so their launcher can serve the final processed artifacts directly to clients. If your launcher expects to install Forge by just downloading the installer JAR and not invoking it, the launcher must either emulate/run the processors, or obtain the processed files from a trusted mirror that has already run them.

Version parsing and blacklists

- Forge version strings are inconsistent historically (examples: `1.10.2-12.18.1.2016-failtests`, `1.9-12.16.0.1886`, `1.14.4-28.1.30`, `1.20.1-31.1.87`). Modrinth's code parses these strings to extract the loader version portion (the second hyphen-separated component in many formats) to derive a canonical loader version.
- Modrinth also maintains a blacklist of known-broken Forge releases which cannot be automatically installed due to malformed archives — a launcher should be prepared to surface helpful error messages or skip those versions.

Mirroring and library URL handling

- Forge libraries and resources are distributed from multiple maven endpoints (`maven.minecraftforge.net`, `libraries.minecraft.net`, other mirrors). Modrinth's implementation rewrites `lib.url` entries to point to their internal `maven/` mirror (`format_url("maven/")`) and inserts mirrored artifact metadata so that clients can attempt multiple fallback URLs.
- For launchers: prefer supporting multiple configured Maven mirrors and a fallback to the canonical hosts; treat some library download failures as non-fatal if those libraries are optional, but fail loudly for missing required libraries or natives.

Launcher implementation checklist for Forge installs

- If the launcher runs the official Forge installer on the user's machine, the installer will handle processors — the launcher must then:
  - Wait for the installer to finish and detect the created `versions/<id>/` and corresponding `version.json`.
  - Download any libraries referenced by `version.json` which are not already present (use mirrors where possible).
  - Extract native libraries for the user's OS/arch into the `natives` directory.
- If the launcher does not run the installer and instead wants to install Forge programmatically (download & assemble), it must either:
  - Run the installer processors locally (some processors are platform-specific), or
  - Use a server-side processed artifact repository (like Modrinth) to obtain final `version.json` and libraries already processed.

Common CLI / run examples

User-run (GUI):

```powershell
java -jar forge-<loader_version>-installer.jar
# then choose "Install client" in the GUI
```

If an installer exposes a CLI on a specific Forge version, check for `--help` on that jar; flags vary across releases. When in doubt, use the GUI installer which reliably runs processors.

NeoForge differences and notes

- NeoForge artifacts are hosted on `https://maven.neoforged.net/` and Modrinth treats them as a distinct channel. NeoForge's loader releases are parsed differently (their version format is not the same as traditional Forge), but the installation steps are conceptually similar — download installer JAR, run it to perform processors or obtain a processed artifact set from a mirror.

Troubleshooting

- If launching fails after installation:
  - Verify the `version.json` exists under `versions/<id>/` and that it contains an accurate `mainClass` and `libraries` list.
  - Ensure native libraries are extracted to the `natives` dir and that the JVM is launched with an appropriate `-Djava.library.path` or that the launcher populates the `java.library.path` environment correctly.
  - If the client fails with missing classes or NoClassDefFoundError, check that shim libraries (Forge `:shim:` libraries) produced by processors are present.

  Server / headless installation notes

  - Many installers offer a headless or CLI mode to install server artifacts without a GUI. Because Forge installer flag support varies between releases, always check `--help` on the installer jar before automation.
  - Common patterns:
    - Forge may support `--installServer` or similar flags (varies by installer). If present, run the installer on the server host and point `--installDir` at the target server directory.
    - If the installer lacks a reliable CLI, run the installer once on a machine with a GUI to produce the final processed artifacts, then copy the resulting `versions/` and `libraries/` to the server host as a prepared install.

  PowerShell example (Forge server headless, vendor flags vary):

  ```powershell
  & 'C:\Program Files\Java\bin\java.exe' -jar forge-<loader_version>-installer.jar --installServer --installDir="C:\minecraft-servers\myserver"
  ```

  POSIX example (Linux server):

  ```bash
  java -jar forge-<loader_version>-installer.jar --installServer --installDir="/opt/minecraft/myserver"
  # If installer tries to open GUI components on headless systems, consider:
  java -Djava.awt.headless=true -jar forge-<loader_version>-installer.jar --installServer --installDir="/opt/minecraft/myserver"
  ```

  Server best-practices:

  - Run installers under a dedicated server account (e.g., `minecraft` user on Linux) and keep ownership/permissions consistent for runtime.
  - For repeatable server deployments, prefer preparing processed artifacts (run processors once) and distribute the processed `versions/` and `libraries/` to server hosts rather than running installers on every host.

References & source snippets

- Modrinth: `apps/daedalus_client/src/forge.rs` — format detection, extraction, processor handling, and artifact mirroring.
- Forge Maven endpoints: `https://maven.minecraftforge.net/` (used by Modrinth to fetch installer jars and manifests).

Integrity verification (checksums & signatures)

- Always verify downloaded installer artifacts before running them. Preferred verification steps:
  - Compare the downloaded file's SHA256/SHA1 checksum with the value published on the Forge release page or Maven metadata when available.
  - When a PGP/ASCII signature is published, verify it using the publisher's public key.
  - On Windows, use `Get-FileHash -Algorithm SHA256 path\to\file` in PowerShell to compute and compare checksums.
- If an installer fails verification, do not run it; report the mismatch and suggest re-downloading from an alternate mirror.

Pre-install backup & rollback

- Before running a Forge installer (or any modloader installer) instruct users to back up their existing `%APPDATA%\.minecraft` (or the custom game directory) directory. A minimal backup checklist:
  - Copy the running profile's `saves/`, `mods/`, `resourcepacks/`, and `versions/` subfolders to a dated backup directory.
  - Export the `launcher_profiles.json` or note active profile settings so they can be re-created if needed.
- Rolling back after a faulty install:
  1. Close the launcher and the game process.
  2. Restore the `versions/` and `libraries/` folders from backup, or restore specific missing jars.
  3. Remove the newly-created `versions/<id>-forge-*/` directory if it's incomplete and re-run a verified installer or use a mirrored processed artifact.

Uninstallation / cleanup steps

- To remove a Forge installation safely:
  - Remove the Forge-created `versions/<id>/` folder and any custom profile referencing it in `launcher_profiles.json`.
  - Remove Forge-specific libraries under `.minecraft/libraries/` if they are not shared with other versions (careful: only remove artifacts known to be Forge-specific or created during the failed install).
  - Restore backed-up `mods/` and `saves/` as needed.
- Note: Do not blindly delete the entire `.minecraft` folder — this will remove saves and user data. Prefer targeted restores.


