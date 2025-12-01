# Fabric Installation (in-progress)

This document will be populated from `apps/daedalus_client/src/fabric.rs` and Fabric's own metadata sources.

Planned sections

- Fabric installer types (Vanilla installer, Fabric API, loader) and recommended installer
- Metadata sources and version endpoints (Fabric meta, maven URLs)
- Step-by-step install: client, server, and verifying `fabric-loader` + `fabric-api` compatibility
- JVM and library considerations

Next steps

- Extract `fabric.rs` from Modrinth repo and add implementation notes and URLs.

Findings from Modrinth `fabric.rs`

- Sources: Modrinth fetches Fabric manifests (loader + intermediary) and compares against existing Modrinth database entries to decide which versions to import.
- Intermediary mappings: Fabric uses intermediary mappings; Modrinth avoids re-importing game versions already present and will also import intermediary versions when needed.
- Library handling:
	- Special-case: If a library is `net.minecraft:launchwrapper:1.12`, Modrinth forces its `url` to `https://libraries.minecraft.net/` to ensure correct legacy routing.
	- For each library/artifact, Modrinth will either insert a mirrored artifact entry (so the launcher can fetch from a mirror) or rewrite the `lib.name` and set `lib.url` to the internal `maven/` mirror path via `format_url("maven/")`.
- Version manifest patching:
	- Modrinth produces patched `version.json` manifests by replacing placeholder `DUMMY_GAME_VERSION` tokens with the loader/game identifiers (it uses `DUMMY_REPLACE_STRING` to perform safe substitutions).
	- After patching, the code serializes the modified manifests for upload.
- Upload behavior:
	- Extracted or mirrored artifacts are added into `upload_files` so the Modrinth pipeline can host these assets on mirrored endpoints.

Implications for a launcher/installer

- Fabric manifests include additional artifacts and intermediary mappings that a launcher must incorporate into the generated `version.json` and library list used for launching.
- Mirror support: when packaging or distributing Fabric versions, ensure libraries/artifacts are mirrored or provide fallback URLs, because some artifact hosts may be unreliable.

Next steps (recommended)

- Fetch Fabric's official installer docs and Fabric meta endpoints (e.g., FabricMC manifests) to extract canonical installer URLs and CLI usage.
- Extract the `fabric-api` artifact patterns and compatibility rules for loader versions vs game versions.

Official Fabric notes (site & installer)

- Fabric's official site: `https://fabricmc.net/` — main entry for downloads, docs and tooling.
- Installer landing: `https://fabricmc.net/use/installer/` — official Fabric installer download and information.
- Fabric Loader: download the loader (or use the installer) then pair it with `fabric-api` placed in the `mods/` folder to enable most mods.

Practical installer flow (high level)

1. Get Fabric installer from `https://fabricmc.net/use/installer/` or GitHub releases for the `fabric-installer` project.
2. Run the installer (it provides a GUI and typically a CLI) to install the chosen loader version for a target Minecraft game version into the local Minecraft `versions/` directory.
3. Install `fabric-api` (if required) by placing the `fabric-api` mod jar in the `mods/` folder for the installed loader version.

Notes

- Fabric uses a loader + optional API (fabric-api) model; many mods require both loader and API.
- Intermediary mappings are part of Fabric's ecosystem — launchers need to honor them when constructing patched version manifests.

Fabric installer CLI (extracted from `Main.java`, `ArgumentParser.java`, `ClientHandler.java`, `ServerHandler.java`)

- The Fabric installer supports a GUI mode (default when no command is provided and not headless) and a CLI mode. The first non-flag argument is treated as a command (e.g., `Client` or `Server`).
- Global/optional flags recognized by the installer (case-sensitive per parser):
	- `-metaurl <url>`: Use a custom Fabric meta URL (for hosting or mirrors).
	- `-mavenurl <url>`: Use a custom maven URL for libraries/artifacts.
	- `-snapshot`: (used when querying latest versions) include snapshot versions when determining latest game version.

- Client command flags (from `ClientHandler.cliHelp()` and `installCli`):
	- `-dir <install dir>`: Path to Minecraft install directory (default: discovered launcher directory).
	- `-mcversion <minecraft version>`: Target Minecraft version (default: latest).
	- `-loader <loader version>`: Fabric loader version (default: latest).
	- `-launcher [win32, microsoft_store]`: When creating a launcher profile, choose launcher type.
	- `-noprofile`: Do not create a launcher profile after installing.

- Server command flags (from `ServerHandler.cliHelp()`):
	- `-dir <install dir>`: Server directory (default: current directory).
	- `-mcversion <minecraft version>`: Target Minecraft version (default: latest).
	- `-loader <loader version>`: Fabric loader version (default: latest).
	- `-downloadMinecraft`: Download the vanilla server JAR alongside the installer output.

Examples (run from a terminal):

```powershell
java -jar fabric-installer.jar client -dir "C:\Users\You\AppData\Roaming\.minecraft" -mcversion 1.20.1 -loader latest

java -jar fabric-installer.jar server -dir "C:\minecraft-servers\farm" -mcversion 1.20.1 -loader latest -downloadMinecraft
```

Notes

- When running headless (no GUI), the installer defaults to the `help` command.
- The installer uses the system certificate store on Windows (`WINDOWS-ROOT`) and sets `java.net.useSystemProxies=true`.


Integrity verification (checksums & signatures)

- Verify the Fabric installer and any downloaded artifacts before executing them. Typical steps:
  - Compare SHA256 checksums published on Fabric's release pages or GitHub releases with `Get-FileHash -Algorithm SHA256` on Windows.
  - If a signature is available, validate it with the project's public key.
- For custom meta/maven mirrors, validate the index JSON checksums if the mirror publishes them.

Pre-install backup & rollback

- Back up critical folders before installing: `mods/`, `config/`, `saves/`, `resourcepacks/`, and `versions/`.
- Rollback steps if the install breaks a profile:
  1. Close the launcher and restore the backed-up `versions/` and `mods/` folders.
  2. Recreate or restore the launcher profile (`launcher_profiles.json`) if necessary.

Uninstallation / cleanup

- To remove Fabric from a profile: delete the Fabric-installed `versions/<id>/` folder and remove `fabric-loader` entries from `mods/` if present (only if not used by other profiles).
- If using an installer GUI that created a launcher profile, remove the profile instead of deleting the entire `.minecraft` directory.

Server / headless installation notes

- Fabric installer supports `client` and `server` commands in CLI mode. For automated server installs use the `server` command and `-dir` to set the target directory. Example (PowerShell):

```powershell
& 'C:\Program Files\Java\bin\java.exe' -jar fabric-installer.jar server -dir "C:\minecraft-servers\myserver" -mcversion 1.20.1 -loader latest -downloadMinecraft
```

- For headless Linux servers:

```bash
java -Djava.awt.headless=true -jar fabric-installer.jar server -dir "/opt/minecraft/myserver" -mcversion 1.20.1 -loader latest -downloadMinecraft
```

- If you need to bundle a prepared server (processed artifacts), run the installer once on a desktop to produce the final `versions/` and `libraries/` and then copy those to the server host to avoid per-host processing.



