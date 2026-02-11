# Forge Installation

Source: extracted from Vesta's piston-lib crate (`crates/piston-lib/src/game/installer/modloaders/forge/`).

## Summary

Forge installation in Vesta follows a streamlined approach based on Modrinth's patterns but adapted for the piston-lib architecture. It supports modern Forge installers (format 2) that contain `install_profile.json` and embedded libraries/processors.

The installer downloads the Forge installer JAR, extracts and parses the install profile, downloads required libraries concurrently, runs any processors, and creates a merged version manifest.

## Installation Process

### 1. Validate Version
- Load metadata to verify Forge version compatibility with the target Minecraft version
- If no version specified, use the latest available from metadata
- Warn if version may not be officially supported

### 2. Install Vanilla Base
- Install the base vanilla Minecraft version first
- This ensures all core libraries and assets are available

### 3. Parse Installer
- Extract and parse `install_profile.json` from the Forge installer JAR
- Parse the embedded `version.json` for the Forge-specific version data
- Log the profile spec version and version ID

### 4. Extract Embedded Libraries
- Extract Maven libraries embedded in the installer JAR
- Place them in the shared `libraries/` directory

### 5. Download Libraries
- Collect all required libraries from the install profile and version info
- Download concurrently (up to configured concurrency limit)
- Handle Forge-specific library overrides and checksums

### 6. Run Processors
- Execute any processors specified in the install profile
- Processors may generate additional libraries or modify existing ones
- Common processors include BINPATCH for client/server JAR modifications

### 7. Create Merged Version Manifest
- Merge vanilla manifest with Forge-specific data
- Include all libraries, main class, and arguments
- Save as `{version}-forge-{loader}.json`

## Library Handling

Forge libraries are handled with special care:
- Libraries can have checksums for verification
- Some libraries override vanilla ones (e.g., modified client JAR)
- URLs may point to Forge's Maven repository or custom mirrors

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

- Installer JARs cached locally
- Extracted libraries shared across installations
- Metadata used for version validation

## Compatibility

- Supports Forge installers with spec version 1+ (modern format)
- Handles both client and server installations
- Compatible with NeoForge (shared installer logic)

## Troubleshooting

- **Version Incompatibility**: Check metadata for supported versions
- **Processor Failures**: Ensure Java is available and processors can execute
- **Library Download Issues**: Verify network and mirror accessibility
- **Corrupted Installer**: Re-download the installer JAR

For more details, see the implementation in `crates/piston-lib/src/game/installer/modloaders/forge/`.


