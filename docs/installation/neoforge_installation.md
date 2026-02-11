# NeoForge Installation

NeoForge is a community-driven fork of Minecraft Forge that provides an alternative modding platform. This document details the installation process as implemented in Vesta Launcher's piston-lib crate.

## Overview

NeoForge installation in Vesta follows the same streamlined approach as Forge, using the shared Forge installer infrastructure. It downloads the NeoForge installer JAR from the official Maven repository and processes it using the same logic as Forge installations.

## Metadata Sources

- **NeoForge Maven**: `https://maven.neoforged.net/` - Hosts NeoForge artifacts and installers
- **Installer URL Pattern**: `https://maven.neoforged.net/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar`

## Installation Process

NeoForge uses the identical installation process as Forge:

### 1. Validate Version
- The NeoForge version must be explicitly specified (no auto-detection of latest)
- Version format examples: `21.1.65`, `21.0.65-beta`

### 2. Install Vanilla Base
- Install the base vanilla Minecraft version first
- This ensures all core libraries and assets are available

### 3. Download Installer
- Download the NeoForge installer JAR from the Maven repository
- Cache the installer locally for future use
- Support artifact restoration from backup caches

### 4. Parse Installer
- Extract and parse `install_profile.json` from the NeoForge installer JAR
- Parse the embedded `version.json` for the NeoForge-specific version data
- Log the profile spec version and version ID

### 5. Extract Embedded Libraries
- Extract Maven libraries embedded in the installer JAR
- Place them in the shared `libraries/` directory

### 6. Download Libraries
- Collect all required libraries from the install profile and version info
- Download concurrently (up to configured concurrency limit)
- Handle NeoForge-specific library overrides and checksums

### 7. Run Processors
- Execute any processors specified in the install profile
- Processors may generate additional libraries or modify existing ones
- Common processors include BINPATCH for client/server JAR modifications

### 8. Create Merged Version Manifest
- Merge vanilla manifest with NeoForge-specific data
- Include all libraries, main class, and arguments
- Save as `{version}-neoforge-{loader}.json`

## Library Handling

NeoForge libraries are handled identically to Forge:
- Libraries can have checksums for verification
- Some libraries override vanilla ones (e.g., modified client JAR)
- URLs point to NeoForge's Maven repository

## Processor Execution

Processors are Java-based tools that run during installation:
- Specified in `install_profile.json` with classpath, main class, and arguments
- May output additional files or modify existing ones
- Run in the context of the game directory with access to extracted data

## Error Handling

- Network timeouts (120 seconds)
- JAR parsing failures
- Processor execution errors
- File system permission issues
- Version compatibility mismatches

## Configuration

- Concurrent downloads: Configurable (default based on spec)
- Request timeout: 120 seconds
- Library extraction: Synchronous in blocking task
- Processor execution: Via Java subprocess

## Caching

- Installer JARs cached locally in `data/cache/neoforge_installers/`
- Extracted libraries shared across installations
- Support for artifact restoration from backup locations

## Compatibility

- Supports NeoForge installers with modern format (spec version 1+)
- Handles both client and server installations
- Uses shared Forge installer infrastructure for consistency

## Differences from Forge

While NeoForge uses the same installation infrastructure as Forge:
- Separate Maven repository (`maven.neoforged.net` vs `maven.minecraftforge.net`)
- Different artifact naming and versioning schemes
- Independent version compatibility matrices
- Community-driven development and support

## Troubleshooting

- **Version Not Specified**: NeoForge requires explicit version specification
- **Network Issues**: Check internet connection and Maven repository accessibility
- **Processor Failures**: Ensure Java is available and processors can execute
- **Corrupted Cache**: Clear the NeoForge installer cache and retry

For more details, see the implementation in `crates/piston-lib/src/game/installer/modloaders/neoforge.rs`.
