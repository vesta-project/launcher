# Quilt Installation (in-progress)

This document will be populated after examining Quilt metadata and Modrinth / launcher handling.

Planned sections

- Quilt loader installer types and recommended endpoints
- Quilt version mapping to Minecraft versions
- Installation steps (client, server)

Notes

- Quilt is a fork of Fabric; installers and metadata are often similar but use different artifact coordinates. We'll extract definitive patterns during the next pass.

Findings from Quilt repositories and site

- Quilt loader repo: `https://github.com/QuiltMC/quilt-loader` — official loader repository; releases/tags are published there.
- Quilt installer repo: `https://github.com/QuiltMC/quilt-installer` — contains source for the Quilt installer targeting the official Minecraft launcher and servers.

Quilt installer notes (from `quilt-installer` repo)

- The installer is written in Java (GUI via Swing) with optional native launchers for Windows and macOS (native folder). The native launchers present user-friendly error dialogs when a suitable JRE is missing.
- The installer targets the official Minecraft launcher: it installs loader artifacts into the standard Minecraft `versions/` area or performs the necessary modifications to make the official launcher recognize the Quilt profile.
- Linux: the repo mentions there is no native solution currently and that Linux will be handled differently (package manager or future special launch process).

Implications for launcher/installer

- The Quilt installer behaves like Forge/Fabric installers in that it prepares a `version.json` and required libraries for the official launcher.
- Because Quilt provides native launchers for Windows/macOS, a bundled shim/executable may be offered to users; otherwise the Java installer JAR can be run with `java -jar`.

Next steps

- Extract canonical Quilt installer CLI options from the `quilt-installer` README and code, and enumerate which Quilt artifacts (loader + Quilt API) are required in `mods/` or as libraries.

CLI / headless installer (from `CliInstaller.java`)

Findings

- The Quilt installer includes a `CliInstaller` entrypoint that accepts commands and options as a single-space separated string; it supports `help`, `listVersions`, and `install` actions.
- `listVersions` options:
	- `--snapshots` : include Minecraft snapshot versions when listing
	- `--loader-betas` : include loader beta versions
- `install` syntax:
	- `install client <minecraftVersion> [<loaderVersion>] [--install-dir="<path>"] [--no-profile]`
	- `install server <minecraftVersion> [<loaderVersion>] [--install-dir="<path>"] [--create-scripts] [--download-server]`

Behavior and options

- `--install-dir=<path>` : required for specifying the installation directory; must be provided as `--install-dir="..."` when the path contains spaces (the CLI expects the `=` and quoted value).
- `--no-profile` : when installing client side, prevents creating a launcher profile.
- `--create-scripts` (server) : create start/stop scripts for the server install.
- `--download-server` (server) : download the vanilla server jar alongside the installer output.

Error handling

- The CLI validates option format strictly: options must start with `--`, repeated options are reported as errors, and missing `=`/quotes in `--install-dir` will produce a help/error message.

Examples (PowerShell)

```powershell
# Install Quilt client for MC 1.20.1 with latest loader into default location
java -jar quilt-installer.jar install client 1.20.1

# Install Quilt client for MC 1.20.1 specifying loader and install dir, and don't create a launcher profile
java -jar quilt-installer.jar install client 1.20.1 0.9.3 --install-dir="C:\Users\You\AppData\Roaming\.minecraft" --no-profile

# Install Quilt server and download vanilla server jar
java -jar quilt-installer.jar install server 1.20.1 --install-dir="C:\minecraft-servers\myserver" --download-server --create-scripts
```

Notes

- The installer attempts to detect the platform default Minecraft installation directory (see `OsPaths.getDefaultInstallationDir()`), so `--install-dir` is optional when installing to a standard location.
- The CLI reconstructs options using a quoted-splitting routine that respects quoted segments; ensure paths with spaces are quoted and passed after the `=` as shown above.

Integrity verification (checksums & signatures)

- Verify Quilt installer jars and any downloaded artifacts prior to running them. Recommended steps:
  - Compare SHA256 checksums against values published in Quilt releases or on the mirror hosting the artifact.
  - Validate any PGP signatures when supplied by the project or mirror.

Pre-install backup & rollback

- Back up `mods/`, `saves/`, `versions/`, and `config/` before installing Quilt.
- To roll back a broken Quilt install: close the launcher, restore the backed-up `versions/` and `mods/` folders, and remove incomplete `versions/<id>/` directories created by the installer.

Uninstallation / cleanup

- Remove Quilt by deleting the Quilt-created `versions/<id>/` folder and removing the Quilt loader/mods from `mods/` if they are not shared with other installs.
- If the installer created a launcher profile, remove the profile entry instead of removing the entire `.minecraft` directory.

Server / headless installation notes

- Quilt's CLI supports `install server` and options such as `--install-dir` and `--download-server`. Use these options to perform headless installs on server hosts.

PowerShell example:

```powershell
& 'C:\Program Files\Java\bin\java.exe' -jar quilt-installer.jar install server 1.20.1 --install-dir="C:\minecraft-servers\myserver" --download-server --create-scripts
```

POSIX example:

```bash
java -Djava.awt.headless=true -jar quilt-installer.jar install server 1.20.1 --install-dir="/opt/minecraft/myserver" --download-server --create-scripts
```

Server tips:

- Use a dedicated server account and run the installer as that user to avoid file-permission issues.
- Prepare processed artifacts on a desktop if the installer requires processors that are difficult to run in a headless environment, then transfer artifacts to the server host.



