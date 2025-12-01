# JRE / Java requirements and detection notes

Summary

- Minecraft historically required Java 8, but modern versions (1.17+) ship with and require newer Java runtimes; many modded environments require specific Java versions or vendor builds.
- Launchers typically detect a Java runtime via a configured `java_path` in the profile or search system paths.

Notes from Modrinth code (`packages/app-lib/src/launcher/mod.rs`)

- The launcher checks a `profile.java_path` first; if provided it runs `api::jre::check_jre` to validate the JRE.
- If no explicit path is provided, the launcher consults `version_info.java_version` (if present) to select a target Java major version. The code maps missing `java_version` to Java 8 by default.
- The launcher stores `JavaVersion` information (including parsed version and architecture) and uses it to set JVM flags and module opens for modern Java versions.

Examples of JVM arg handling (from launcher code)

- If `java_version.parsed_version >= 9`, the launcher adds: `--add-opens=java.base/java.lang.reflect=ALL-UNNAMED`.
- If `java_version.parsed_version >= 25`, it adds: `--add-opens=jdk.internal/jdk.internal.misc=ALL-UNNAMED` (for JEP 512 support).

Recommendations for launcher implementers

- Validate `java_path` when provided; fall back to an auto-discovered system JRE if absent.
- Respect `version.json`'s `javaVersion` field to select the required Java major (and provide guidance to users to install a matching runtime).
- Consider bundling an embedded JRE for known-good compatibility, or provide automatic download/install of an AdoptOpenJDK/Temurin build for the required version.

Next steps

- Enumerate concrete JRE builds per Minecraft version (e.g., which MC versions ship with bundled runtimes, and which modloaders require which Java major).

References

- `packages/app-lib/src/launcher/mod.rs` in Modrinth code — Java selection and JVM flags.

Concrete Java version guidance (summary)

- Up to and including Minecraft 1.16.x: Java 8 is the common and recommended runtime for older versions and modpacks (most mods for these versions target Java 8).
- Minecraft 1.17: Mojang moved the game to require Java 16 as the minimum runtime, but many community/launcher recommendations standardised on Java 17 for stability with modding stacks.
- Minecraft 1.18 → 1.20.4: Java 17 is the practical recommended runtime for these versions (modloaders and mods expect Java 17 features/compatibility).
- Minecraft 1.20.5 and higher: Fabric's documentation currently recommends Java 21 for best compatibility and performance (see Fabric wiki notes); launchers should prefer Java 21 where available for these latest releases.

Note: these are practical recommendations — some launchers or servers may support running with a slightly different Java major if the JARs are compatible, but modded ecosystems (Fabric/Forge/Quilt) and native libraries often require matching the Minecraft-major Java runtime.

Authoritative source examples

- Fabric wiki (Installing Fabric) — explicit recommendations:
  - "For Minecraft 1.17-1.20.4 we recommended using Java 17. For Minecraft 1.20.5 and higher we recommend using Java 21." (Fabric docs / installer pages)
  - Modrinth launcher code (`packages/app-lib/src/launcher/mod.rs`) — launcher uses `version_info.java_version` when present and defaults to Java 8 when absent; it also adjusts JVM flags for modern Java versions (adds `--add-opens` lines for >=9 and >=25 for JEP 512 cases).

Detecting and validating Java on Windows (recommended checks)

- Check `java` on PATH:

```powershell
java -version
```

- Validate a specific Java binary:

```powershell
&C:\path\to\java.exe -version
```

- Parse the major version from the `java -version` output (example outputs):

  - OpenJDK 17 example: `openjdk version "17.0.x" 2023-...`
  - OpenJDK 21 example: `openjdk version "21.0.x" 2024-...`

Automatic detection guidance for launchers

- Prefer explicit `java_path` in the profile and run a quick check (`java -version`) to verify the major version and architecture. If it fails, present a clear UI message telling the user which JRE major is required for the selected Minecraft version.
- If `version_info.java_version` is present in the `version.json`, use that major version where possible. If missing, fall back to the launcher default (Modrinth falls back to Java 8).

Installing a JRE on Windows (suggested options)

- Recommended vendor distributions: Eclipse Temurin (Adoptium), Azul Zulu, BellSoft Liberica, Microsoft Build of OpenJDK. Choose an LTS major matching the target (17, 21, etc.).
- Manual install: download the MSI/ZIP from the vendor site and install or extract.
Package managers (optional):

Chocolatey (if installed):

```powershell
choco install temurin17 -y
# or for Java 21
choco install temurin21 -y
```

Winget example (Windows 10/11):

```powershell
winget install EclipseAdoptium.Temurin.17.JRE
# substitute 21 for Java 21 if available
```

Bundled runtimes and launcher behavior

- Some launcher distributions bundle a private runtime for convenience; check the launcher settings or bundled runtime path. If a bundled runtime exists and is compatible with the selected Minecraft/modloader version, prefer it for reproducible behavior.

Recommendations for pack builders and server hosts

- Document the required Java major for a modpack (e.g., "Requires Java 17").
- Provide an installer script or guidance to install a matching Temurin/Adoptium runtime, or bundle a tested JRE for the platform (beware licensing and footprint).

Next steps

- I can enumerate per-Minecraft-version mappings into a small table (1.7→1.12 → Java 8; 1.13–1.16 → Java 8; 1.17 → Java 16/17; 1.18–1.20.4 → Java 17; 1.20.5+ → Java 21) with citations per-version if you want absolute precision across every minor release.

Concrete mapping table (quick reference)

| Minecraft range | Recommended Java major | Notes |
|---|---:|---|
| <= 1.16.x | 8 | Older mods and modpacks still expect Java 8. |
| 1.17 | 16/17 | Mojang moved to Java 16+, community prefers Java 17. |
| 1.18 → 1.20.4 | 17 | Most modloaders and mods expect Java 17. |
| 1.20.5+ | 21 | Fabric and some modern stacks recommend Java 21. |

Bitness, architecture, and Apple Silicon

- Use a 64-bit JRE for modern Minecraft and modded stacks. Symptoms of a 32-bit JVM mismatch include frequent OutOfMemory errors and failing native loads.
- On ARM (Apple Silicon / Linux aarch64): many native libraries may be unavailable. Detect `os.arch` from the JVM or `java -XshowSettings:properties -version` and warn users when ARM natives are missing. Provide guidance to use Rosetta (macOS) or an x86 JRE where appropriate, or choose a compatible native provider.

Checksum/signature verification (recommended)

- Verify installer and artifact integrity where checksums or PGP signatures are provided. For example:
  - Check SHA256/SHA1 from the vendor page and compare the downloaded file hash.
  - Where projects publish PGP signatures (Forge/GitHub releases), verify with the project's public key.
- If verification fails, do not run the installer; surface a clear error and avoid using the artifact.

Java architecture & Apple Silicon / aarch64 guidance

- Detecting Java architecture and properties (PowerShell examples):

```powershell
# Show version and properties including os.arch
& 'C:\path\to\java.exe' -XshowSettings:properties -version 2>&1 | Select-String 'os.arch','java.vendor','java.runtime.name'

# Simple version check
& 'C:\path\to\java.exe' -version
```

- Interpretation:
  - `os.arch` will be `amd64`/`x86_64` for 64-bit x86, `aarch64` for ARM64 (Apple Silicon/Linux aarch64). Use this value to select native classifiers when downloading libraries.
  - If a user has an x86 JRE on Apple Silicon and wants to run x86 natives, they may run the JRE under Rosetta (macOS). Prefer an aarch64 JRE when available for best performance and native compatibility.

- Recommended vendor builds and notes:
  - Eclipse Temurin (Adoptium): provides macOS/aarch64 and Linux/aarch64 builds for modern Java majors (17, 21). Prefer Temurin aarch64 builds on Apple Silicon when available.
  - BellSoft Liberica and Azul Zulu: both publish aarch64 builds for macOS and Linux; useful if Temurin packages are unavailable for a specific major.
  - Microsoft Build of OpenJDK: available on some platforms; check for aarch64 packaging.

- Practical guidance for launchers:
  - Prefer an aarch64 JRE on Apple Silicon and Linux aarch64. If the selected modpack uses native libraries that lack aarch64 builds, either:
    - provide an x86_64 runtime (run under Rosetta on macOS) and ensure x86 native libraries are available, or
    - prefer a pack / mirror that publishes aarch64 natives.
  - Detect `os.arch` and the platform at runtime and warn the user on mismatch (for example, aarch64 JRE but only x86 natives available).

Headless & server install guidance (brief)

- General advice:
  - Many installers provide a CLI or headless mode for server installs. Check `java -jar installer.jar --help` before automating — flags vary by installer and release.
  - Run server installs on the target server host (not on developer machine) and ensure the user account running the installer owns the installation directory.

- PowerShell examples (Windows) and POSIX examples (Linux/macOS):

```powershell
# Example: run Forge installer headless (check --help for this installer)
& 'C:\Program Files\Java\bin\java.exe' -jar forge-<version>-installer.jar --installServer --installDir="C:\minecraft-servers\myserver"

# Example: Fabric installer (CLI server mode)
& 'C:\Program Files\Java\bin\java.exe' -jar fabric-installer.jar server -dir "C:\minecraft-servers\myserver" -mcversion 1.20.1 -loader latest -downloadMinecraft
```

```bash
# Linux/macOS: run Quilt installer server (headless)
java -jar quilt-installer.jar install server 1.20.1 --install-dir="/opt/minecraft/myserver" --download-server --create-scripts

# Use -Djava.awt.headless=true if the installer attempts to open GUI components on headless hosts
java -Djava.awt.headless=true -jar installer.jar install server ...
```

- Service account recommendations for servers:
  - Create a dedicated `minecraft` user on Linux and run the installer under that account to avoid permission issues and to simplify backups and upgrades.
  - On Windows, create a service or scheduled task that runs under a specific service account if you plan to automate server lifecycle.



