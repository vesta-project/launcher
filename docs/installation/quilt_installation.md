# Quilt Installation

Quilt is a fork of Fabric that provides an alternative modding toolchain for Minecraft. Like Fabric, it offers a lightweight and efficient mod loading system. This document details the installation process as implemented in Vesta Launcher's piston-lib crate.

## Overview

Quilt installation follows the same process as Fabric, using identical installation logic but with Quilt-specific metadata sources and Maven repositories. The process creates a new version profile that inherits from the vanilla Minecraft version while adding Quilt-specific libraries and launch arguments.

## Metadata Sources

- **Quilt Meta API**: `https://meta.quiltmc.org/v3/versions/loader` - Provides loader version information and compatibility data
- **Quilt Maven**: `https://maven.quiltmc.org/repository/release/` - Hosts Quilt artifacts and libraries
- **Profile Endpoint**: `https://meta.quiltmc.org/v3/versions/loader/{mc_version}/{loader_version}/profile/json` - Returns the loader profile for specific versions

## Installation Process

The Quilt installation process is identical to Fabric's:

### 1. Install Vanilla Base

First, the vanilla Minecraft version is installed as the base. This ensures all core Minecraft libraries and assets are available.

### 2. Determine Loader Version

The installer determines which Quilt loader version to use:

- If a specific version is requested, it verifies compatibility with the target Minecraft version
- If no version is specified, it selects the latest stable loader version compatible with the Minecraft version
- Version compatibility is checked against metadata from the Quilt Meta API

### 3. Prepare Client Jar

A temporary client jar is prepared in the installed version folder for use by any processors.

### 4. Download Loader Profile

The installer fetches the Quilt profile JSON from the meta API, which contains:

- Loader-specific libraries
- Main class for launching
- JVM arguments
- Inheritance information

The profile is cached locally to avoid repeated downloads.

### 5. Download Libraries

All libraries specified in the profile are downloaded concurrently (up to 8 parallel downloads):

- Libraries are downloaded to the shared `libraries/` directory
- Each library includes name, URL, and Maven repository information
- SHA1 verification is not performed as Quilt profiles don't provide hashes

### 6. Create Merged Version Manifest

A new version manifest is created that:

- Inherits from the vanilla Minecraft version
- Includes all Quilt loader libraries
- Sets the correct main class and launch arguments
- Is saved as `{quilt-loader-{version}-{mc_version}}.json`

## Version Compatibility

- Quilt maintains compatibility matrices between loader versions and Minecraft versions
- The installer checks metadata to ensure the requested loader version is available for the target Minecraft version
- Unsupported combinations generate warnings but don't block installation

## Libraries and Dependencies

Quilt loader adds several key libraries:

- `org.quiltmc:quilt-loader:{version}` - The core loader
- Quilt-specific mappings and toolchain libraries
- Compatible with Fabric mods through intermediary mappings

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

- `QUILT_META_URL`: `https://meta.quiltmc.org/v3/versions/loader`
- `QUILT_MAVEN_URL`: `https://maven.quiltmc.org/repository/release/`
- Request timeout: 120 seconds
- Concurrent downloads: 8 parallel connections

## Caching

- Loader profiles are cached in `data/metadata/loader_profiles/quilt/{mc_version}/{loader_version}.json`
- Cached artifacts can be restored from backup locations
- Library artifacts are shared across installations

## Launch Integration

Once installed, Quilt versions can be launched like any other Minecraft version. The merged manifest ensures all necessary libraries and arguments are included in the launch process.

## Differences from Fabric

While Quilt uses the same installation infrastructure as Fabric:

- Different metadata API endpoints
- Separate Maven repository
- Quilt-specific loader artifacts
- Independent version compatibility matrices

## Official Quilt Installer

Quilt also provides an official Java-based installer that can be used as an alternative:

- Repository: `https://github.com/QuiltMC/quilt-installer`
- Supports both GUI and CLI modes
- Can install client and server versions
- Creates launcher profiles for the official Minecraft launcher

## Troubleshooting

Common issues:

- **Version Incompatibility**: Ensure the loader version is compatible with your Minecraft version
- **Network Issues**: Check internet connection and firewall settings
- **Corrupted Cache**: Clear the metadata cache and retry installation
- **Missing Libraries**: Verify Maven repository accessibility

For more information, refer to the official Quilt documentation at https://quiltmc.org/.
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



