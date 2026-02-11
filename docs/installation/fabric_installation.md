# Fabric Installation

Fabric is a lightweight modding toolchain for Minecraft that provides a simple and efficient way to load mods. This document details the installation process as implemented in Vesta Launcher's piston-lib crate.

## Overview

Fabric installation involves downloading and configuring the Fabric loader and its associated libraries for a specific Minecraft version. The process creates a new version profile that inherits from the vanilla Minecraft version while adding Fabric-specific libraries and launch arguments.

## Metadata Sources

- **Fabric Meta API**: `https://meta.fabricmc.net/v2/versions/loader` - Provides loader version information and compatibility data
- **Fabric Maven**: `https://maven.fabricmc.net/` - Hosts Fabric artifacts and libraries
- **Profile Endpoint**: `https://meta.fabricmc.net/v2/versions/loader/{mc_version}/{loader_version}/profile/json` - Returns the loader profile for specific versions

## Installation Process

The Fabric installation follows these steps:

### 1. Install Vanilla Base

First, the vanilla Minecraft version is installed as the base. This ensures all core Minecraft libraries and assets are available.

### 2. Determine Loader Version

The installer determines which Fabric loader version to use:

- If a specific version is requested, it verifies compatibility with the target Minecraft version
- If no version is specified, it selects the latest stable loader version compatible with the Minecraft version
- Version compatibility is checked against metadata from the Fabric Meta API

### 3. Prepare Client Jar

A temporary client jar is prepared in the installed version folder for use by any processors.

### 4. Download Loader Profile

The installer fetches the Fabric profile JSON from the meta API, which contains:

- Loader-specific libraries
- Main class for launching
- JVM arguments
- Inheritance information

The profile is cached locally to avoid repeated downloads.

### 5. Download Libraries

All libraries specified in the profile are downloaded concurrently (up to 8 parallel downloads):

- Libraries are downloaded to the shared `libraries/` directory
- Each library includes name, URL, and Maven repository information
- SHA1 verification is not performed as Fabric profiles don't provide hashes

### 6. Create Merged Version Manifest

A new version manifest is created that:

- Inherits from the vanilla Minecraft version
- Includes all Fabric loader libraries
- Sets the correct main class and launch arguments
- Is saved as `{fabric-loader-{version}-{mc_version}}.json`

## Version Compatibility

- Fabric maintains compatibility matrices between loader versions and Minecraft versions
- The installer checks metadata to ensure the requested loader version is available for the target Minecraft version
- Unsupported combinations generate warnings but don't block installation

## Libraries and Dependencies

Fabric loader adds several key libraries:

- `net.fabricmc:fabric-loader:{version}` - The core loader
- Intermediary mappings for mod compatibility
- Tiny remapper for runtime mapping transformations
- Various Fabric toolchain libraries

All libraries are resolved through Maven repositories and cached locally.

## Error Handling

The installation process includes comprehensive error handling:

- Network timeouts (120 seconds)
- HTTP error responses
- JSON parsing failures
- File system permission issues
- Version compatibility mismatches

## Configuration

Key configuration constants:

- `FABRIC_META_URL`: `https://meta.fabricmc.net/v2/versions/loader`
- `FABRIC_MAVEN_URL`: `https://maven.fabricmc.net/`
- Request timeout: 120 seconds
- Concurrent downloads: 8 parallel connections

## Caching

- Loader profiles are cached in `data/metadata/loader_profiles/fabric/{mc_version}/{loader_version}.json`
- Cached artifacts can be restored from backup locations
- Library artifacts are shared across installations

## Launch Integration

Once installed, Fabric versions can be launched like any other Minecraft version. The merged manifest ensures all necessary libraries and arguments are included in the launch process.

## Troubleshooting

Common issues:

- **Version Incompatibility**: Ensure the loader version is compatible with your Minecraft version
- **Network Issues**: Check internet connection and firewall settings
- **Corrupted Cache**: Clear the metadata cache and retry installation
- **Missing Libraries**: Verify Maven repository accessibility

For more information, refer to the official Fabric documentation at https://fabricmc.net/.

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



