# NeoForge (notes)

Source: Modrinth `apps/daedalus_client/src/forge.rs` (NeoForge parsing/upload logic).

Summary

- NeoForge publishes installer/artifacts on `https://maven.neoforged.net/` (Modrinth code references this domain).
- NeoForge version strings use formats like `20.2.29-beta`, `20.6.119`, or `47.1.82`. Modrinth maps these to Minecraft game versions by parsing the version string (splitting the first numbers into major/minor components) and building a `game_version` string (e.g., `1.<major>` or `1.<major>.<minor>`).

Installer URL examples (from code)

- `https://maven.neoforged.net/net/neoforged/neoforge/{loader_version}/neoforge-{loader_version}-installer.jar`
- NeoForge Forge installer artifacts may appear under `https://maven.neoforged.net/net/neoforged/forge/{loader_version}/forge-{loader_version}-installer.jar` (NeoForge-managed Forge builds).

Notes

- Modrinth treats NeoForge as a separate channel and transforms NeoForge version strings to derive the corresponding Minecraft version.
- Some NeoForge versions are blacklisted in code due to being unreachable or malformed.

Installation steps (user)

- Same general approach as Forge: download the NeoForge installer JAR and run with Java; the installer will produce a version profile and libraries similar to Forge.

# NeoForge (notes)

Source: Modrinth `apps/daedalus_client/src/forge.rs` (NeoForge parsing/upload logic).

Summary

- NeoForge publishes installer/artifacts on `https://maven.neoforged.net/` (Modrinth code references this domain).
- NeoForge version strings use formats like `20.2.29-beta`, `20.6.119`, or `47.1.82`. Modrinth maps these to Minecraft game versions by parsing the version string (splitting the first numbers into major/minor components) and building a `game_version` string (e.g., `1.<major>` or `1.<major>.<minor>`).

Installer URL examples (from code)

- `https://maven.neoforged.net/net/neoforged/neoforge/{loader_version}/neoforge-{loader_version}-installer.jar`
- NeoForge Forge installer artifacts may appear under `https://maven.neoforged.net/net/neoforged/forge/{loader_version}/forge-{loader_version}-installer.jar` (NeoForge-managed Forge builds).

Notes

- Modrinth treats NeoForge as a separate channel and transforms NeoForge version strings to derive the corresponding Minecraft version.
- Some NeoForge versions are blacklisted in code due to being unreachable or malformed.

Installation steps (user)

- Same general approach as Forge: download the NeoForge installer JAR and run with Java; the installer will produce a version profile and libraries similar to Forge.

References

- `apps/daedalus_client/src/forge.rs` in Modrinth repo — NeoForge parsing and fetch logic.

Practical examples and mapping rules

- NeoForge version format examples and how they map to Minecraft game versions:
	- `20.2.29-beta`  -> NeoForge loader `20.2.29-beta` maps to Minecraft `1.20.2` (the `20` → `1.20` rule).
	- `20.4.237`      -> NeoForge loader `20.4.237` maps to Minecraft `1.20.4`.
	- `47.1.82`       -> NeoForge loader `47.1.82` maps to Minecraft `1.47` (rare; check the project mapping rules for older numbering).

- Mapping rule (practical): NeoForge's first numeric component typically represents the Minecraft minor/major (e.g., `20` in `20.2.x` → `1.20.x`). When in doubt, derive the game version from the NeoForge string by taking the first two numbers as `major.minor` and prefixing with `1.` unless the project documents an explicit mapping.

Installer URL patterns

- Public installer URL pattern used by Modrinth-derived code:

	`https://maven.neoforged.net/net/neoforged/neoforge/{full_version}/neoforge-{full_version}-installer.jar`

	where `full_version` is either the provided NeoForge version or an augmented string that includes the Minecraft version when the installer naming requires it (some code paths do `minecraftVersion-neoforgeVersion`).

Practical download + run (Windows PowerShell examples)

- Download the installer into a cache folder:

```powershell
$url = 'https://maven.neoforged.net/net/neoforged/neoforge/20.2.29-beta/neoforge-20.2.29-beta-installer.jar'
$out = "$env:USERPROFILE\Downloads\neoforge-20.2.29-beta-installer.jar"
Invoke-WebRequest -Uri $url -OutFile $out
```

- Run interactively (GUI):

```powershell
& 'C:\Program Files\Java\jre1.8.0_341\bin\java.exe' -jar $out

# NeoForge (notes)

Source: Modrinth `apps/daedalus_client/src/forge.rs` (NeoForge parsing/upload logic).

Summary

- NeoForge publishes installer/artifacts on `https://maven.neoforged.net/` (Modrinth code references this domain).
- NeoForge version strings use formats like `20.2.29-beta`, `20.6.119`, or `47.1.82`. Modrinth maps these to Minecraft game versions by parsing the version string (splitting the first numbers into major/minor components) and building a `game_version` string (e.g., `1.<major>` or `1.<major>.<minor>`).

Installer URL examples (from code)

- `https://maven.neoforged.net/net/neoforged/neoforge/{loader_version}/neoforge-{loader_version}-installer.jar`
- NeoForge Forge installer artifacts may appear under `https://maven.neoforged.net/net/neoforged/forge/{loader_version}/forge-{loader_version}-installer.jar` (NeoForge-managed Forge builds).

Notes

- Modrinth treats NeoForge as a separate channel and transforms NeoForge version strings to derive the corresponding Minecraft version.
- Some NeoForge versions are blacklisted in code due to being unreachable or malformed.

Installation steps (user)

- Same general approach as Forge: download the NeoForge installer JAR and run with Java; the installer will produce a version profile and libraries similar to Forge.

References

- `apps/daedalus_client/src/forge.rs` in Modrinth repo — NeoForge parsing and fetch logic.

Practical examples and mapping rules

- NeoForge version format examples and how they map to Minecraft game versions:
  - `20.2.29-beta`  -> NeoForge loader `20.2.29-beta` maps to Minecraft `1.20.2` (the `20` → `1.20` rule).
  - `20.4.237`      -> NeoForge loader `20.4.237` maps to Minecraft `1.20.4`.
  - `47.1.82`       -> NeoForge loader `47.1.82` maps to Minecraft `1.47` (rare; check the project mapping rules for older numbering).

- Mapping rule (practical): NeoForge's first numeric component typically represents the Minecraft minor/major (e.g., `20` in `20.2.x` → `1.20.x`). When in doubt, derive the game version from the NeoForge string by taking the first two numbers as `major.minor` and prefixing with `1.` unless the project documents an explicit mapping.

Installer URL patterns

- Public installer URL pattern used by Modrinth-derived code:

  `https://maven.neoforged.net/net/neoforged/neoforge/{full_version}/neoforge-{full_version}-installer.jar`

  where `full_version` is either the provided NeoForge version or an augmented string that includes the Minecraft version when the installer naming requires it (some code paths do `minecraftVersion-neoforgedVersion`).

Practical download + run (Windows PowerShell examples)

- Download the installer into a cache folder:

```powershell
$url = 'https://maven.neoforged.net/net/neoforged/neoforge/20.2.29-beta/neoforge-20.2.29-beta-installer.jar'
$out = "$env:USERPROFILE\Downloads\neoforge-20.2.29-beta-installer.jar"
Invoke-WebRequest -Uri $url -OutFile $out
```

- Run interactively (GUI):

```powershell
& 'C:\Program Files\Java\jre1.8.0_341\bin\java.exe' -jar $out
# or if java is on PATH
java -jar $out
```

- Headless / scripted runs: many Forge-derived installers support headless flags or CLI modes (e.g., `--installServer`, `--installClient`, or `--installDir`), but support varies by build. If the installer supports `--help` or `--options`, query that first:

```powershell
java -jar $out --help
```

If there are headless flags documented in the installer manifest, use them; otherwise invoking the jar interactively remains the most compatible approach.

Handling unreachable or blacklisted NeoForge versions

- Symptom: Modrinth and some launchers contain an internal blacklist of NeoForge/Forge builds that are malformed or unreachable (HTTP 404/5xx when attempting to download installer/artifacts).

- Detection strategy (launcher-side):
  - Attempt to download the installer URL. If the HTTP status is not 200, mark the version as unreachable.
  - On download failure, try the following fallbacks in order:
    1. Retry the same URL (transient network errors can happen).
    2. Try the alternate artifact path pattern (some projects publish under both `/neoforge/` and `/forge/` paths).
    3. If available, query a metadata endpoint (Modrinth/NeoForge API) for alternate download URLs.
    4. Surface a clear error to the user explaining the installer is unreachable and suggest selecting a different NeoForge version.

- Blacklist guidance for pack authors and launchers:
  - Maintain a per-version health check that periodically attempts to fetch core installer artifacts and marks broken versions as blacklisted to avoid presenting them as installable.
  - When presenting NeoForge versions to users, hide or flag versions that fail health checks with a clear message such as: "Installer artifact not available (404) — choose another version or check the NeoForge Maven site.".

Launcher implementer notes (integration tips)

- Reuse Forge installer flow: NeoForge installers are handled the same way as Forge in many launchers — they produce a `version.json` and associated libraries after running the installer or using server-side processing.
- Cache downloaded installers under a `cache/neoforge_installers` directory to avoid re-downloading the same artifact repeatedly.
- Validate the produced `version.json` after running the installer; ensure native libraries and classifiers exist for the target OS/arch.

Edge cases and troubleshooting

- Some NeoForge builds include `-beta` or other pre-release suffixes. Treat the full string as the artifact version when building download URLs.
- If the installer attempts to run processors (BINPATCH, LZMA, etc.) you may need to run the installer on the host to produce the final libraries, or rely on a mirror that has pre-processed the artifacts (this is what many mod hosting services do).

Integrity verification (checksums & signatures)

- Always verify NeoForge installer artifacts and any mirrored processed outputs before executing them:
  - Compare published SHA256 checksums with your downloaded file using PowerShell's `Get-FileHash -Algorithm SHA256`.
  - When PGP signatures are published, verify them against the project's public key.
  - If a mirror is used, validate the mirror's published checksums or metadata signature.

Pre-install backup & rollback

- Back up the following before installing NeoForge or running processors: `mods/`, `saves/`, `versions/`, `config/`, and the launcher profile file.
- To roll back a problematic NeoForge install: stop the launcher, restore backed-up folders, and remove the incomplete `versions/<id>/` created by the installer.

Uninstallation / cleanup

- Remove NeoForge/Forge artifacts added by the installer by deleting the created `versions/<id>/` folder and removing NeoForge-specific libraries if they are not shared with other installs.
- If uncertain which libraries to remove, prefer restoring from a backup or reinstalling a clean vanilla `versions/` folder and re-applying verified mod files.

Server / headless installation notes

- NeoForge/Forge-style installers sometimes provide a CLI flag for server installation (e.g., `--installServer`) but behavior varies by build. Check `java -jar installer.jar --help` first.
- Example headless usage (PowerShell):

```powershell
& 'C:\Program Files\Java\bin\java.exe' -jar neoforge-<version>-installer.jar --installServer --installDir="C:\minecraft-servers\myserver"
```

POSIX example:

```bash
java -Djava.awt.headless=true -jar neoforge-<version>-installer.jar --installServer --installDir="/opt/minecraft/myserver"
```

- If processors are required and cannot run reliably in your server environment, prepare processed artifacts on a workstation and copy `versions/` and `libraries/` to the server host.


NeoForge selection algorithm (what the website does)

- The NeoForge website (`assets/js/neoforge.js`) queries a Maven API endpoint that returns all NeoForge versions for the GAV `net/neoforged/neoforge`.
- It iterates the returned `versions` list from newest to oldest (the API returns oldest→newest, so the code iterates backwards) and skips any versions that start with `0` (these are April Fools / dummy entries).
- For each NeoForge version string (example `20.4.237` or `20.2.29-beta`) it computes the corresponding Minecraft version as:

  `mcVersion = "1." + getFirstTwoVersionNumbers(neoVersion)`

  where `getFirstTwoVersionNumbers("20.4.237")` → `"20.4"`, so `mcVersion` → `"1.20.4"`.

- The script groups NeoForge versions by the derived `mcVersion` into a Map (`allNeoforgeVersions`) so the UI can present a Minecraft-version → list-of-NeoForge-versions dropdown.
- When presenting the dropdowns, it selects the newest NeoForge version for the chosen Minecraft version by picking the first entry in the per-MC-version list (the list is filled newest-first due to reverse iteration).
- There are helper functions used by the site:

  - `getFirstTwoVersionNumbers(versionString)` — splits on `.` and returns the first two segments joined by a dot (e.g., `"20.4.237"` → `"20.4"`).
  - `getLastTwoVersionNumbers(versionString)` — returns the version string after the first dot (used to convert `1.21.1` → `21.1` when filtering by Minecraft version).

- Fallbacks: if the primary Maven endpoint fails, the site will try a fallback Maven mirror (e.g., `maven.creeperhost.net`) and update download links with a `--mirror` hint for the user when the fallback is in use.

Implication for launchers and tooling

- Use the same mapping rule when translating NeoForge loader strings to Minecraft versions: take the first two numeric components of the NeoForge version and prefix with `1.` to get the game version (but verify for any legacy exceptions).
- Implement the same April-Fools skip rule: ignore NeoForge versions that start with `0` when building lists to show to users.


Edge cases and troubleshooting

- Some NeoForge builds include `-beta` or other pre-release suffixes. Treat the full string as the artifact version when building download URLs.
- If the installer attempts to run processors (BINPATCH, LZMA, etc.) you may need to run the installer on the host to produce the final libraries, or rely on a mirror that has pre-processed the artifacts (this is what many mod hosting services do).
