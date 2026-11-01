# Quick Play and Modrinth servers

Research date: 2026-11-02. Source review only; no game or hosting integration was tested.

## Findings and open questions

- Java Quick Play arrived in 23w14a, in the 1.20 release line; it can target a world, multiplayer server or Realm and record joins.
- Vesta merges manifest arguments but rejects unknown feature rules, so Quick Play needs feature state and substitutions as well as a target.
- Older Java clients have legacy multiplayer arguments; exact loader/version compatibility needs testing. Vanilla has no documented pre-1.20 direct singleplayer switch.
- World saves and saved servers are local NBT files; Quick Play logs are a supplementary source of recency, not an inventory.
- Modrinth Hosting sells hosted servers. A hosted server, modpack project and Minecraft server address are distinct objects.
- Public content APIs resolve a known modpack version. A supported third-party API to discover the pack from an arbitrary server address or administer hosting was not verified.
- Open questions: old loader compatibility; log retention and concurrency; hosted-server pack metadata and supported third-party authentication/scopes; exact linked-server sync behavior.

## Minecraft launch targets

[Mojang's 23w14a notes](https://www.minecraft.net/en-us/article/minecraft-snapshot-23w14a) introduced these arguments, included in the 1.20 release line. Later releases generally support them; verify custom manifests and clients individually.

| Argument | Value |
| --- | --- |
| `--quickPlaySingleplayer` | World save folder name, not display name. |
| `--quickPlayMultiplayer` | Address, optionally including port, e.g. `localhost:25565`. |
| `--quickPlayRealms` | Realms ID. |
| `--quickPlayPath` | Join log path; relative paths resolve against the game run directory. |

Choose at most one target and pass each flag and value as separate process arguments. Joining can still fail due to authentication, connectivity, compatibility, or world errors. The `arguments.game` manifest entries are conditional: `has_quick_play_support` gates the path; `is_quick_play_singleplayer`, `is_quick_play_multiplayer`, and `is_quick_play_realms` gate their corresponding target arguments. Provide the applicable feature booleans and substitutions such as `${quickPlayPath}` and `${quickPlaySingleplayer}`; inspect the actual merged manifest instead of assuming identical rules across versions. Evaluate required boolean values and allow/disallow rule ordering correctly. See [launcher argument documentation](https://minecraft-launcher-lib.readthedocs.io/en/stable/command.html).

### Older clients and loaders

The [Java argument reference](https://minecraft.wiki/w/Java_Edition_client_command_line_arguments) lists `--server <host> --port <port>` through 23w13a. Parse host and port carefully, including IPv6. Its earliest supported version and the complete version matrix were not verified. Do not assume legacy flags work in newer versions. Vanilla before 1.20 has no documented direct singleplayer switch. Community [QuickPlay](https://modrinth.com/mod/quickplay) may provide a mod-based alternative; check each release's supported versions, loaders and invocation.

Fabric, Quilt, Forge and NeoForge use loader entry points and manifests around the game. The underlying Minecraft version and actual merged manifest matter. Passing target arguments through the game argument vector is the likely integration point, but passthrough has **not been verified** for every loader. In particular test Forge 1.12.2 and representative older Fabric versions; Fabric does not normally target 1.12.2. Test vanilla and each loader with world names containing spaces and server addresses with and without ports.

### Recent activity, worlds and servers

Mojang says the optional Quick Play log records joins with type, identifier, multiplayer port, name, gamemode and lastPlayedTime. A launcher can use it for a recent-join view for sessions where it supplied the path, including ordinary joins during those sessions. It is not a complete historic list. Exact schema, retention, overwrites and concurrent writes were not independently verified. Treat names and addresses as user data. [Mojang notes](https://www.minecraft.net/en-us/article/minecraft-snapshot-23w14a).

Enumerate `saves/*/level.dat` in the instance game directory. It is gzip-compressed NBT; normally `Data.LevelName` is the display name, `Data.LastPlayed` a millisecond timestamp, and `Data.GameType` the default game mode. The directory name is the launch identifier and `icon.png` alongside the file is optional. Tolerate missing and malformed saves. See [level format](https://minecraft.wiki/w/Java_Edition_level_format) and [NBT reference](https://c4k3.github.io/wiki.vg/NBT.html).

`servers.dat` in the game directory is uncompressed NBT with a `servers` list. Entries contain `name`, `ip`, optional base64 PNG `icon`, and optional byte flags `hidden` and `acceptTextures`. An absent `acceptTextures` is distinct from false. This is a saved list, not a history; direct-connect and LAN servers are not fully represented. Respect hidden entries and handle missing or malformed fields. [servers.dat format](https://minecraft.wiki/w/Servers.dat_format).

### Other launchers

- [Prism Launcher](https://prismlauncher.org/wiki/getting-started/command-line-interface/) has `-s` to launch an instance into a server and a join-on-launch UI setting; a [reported regression](https://github.com/PrismLauncher/PrismLauncher/issues/2396) illustrates compatibility limitations.
- [Modrinth App](https://modrinth.com/news/changelog?filter=app) describes Quick Play for worlds and servers, and server information in the app. Exact current tab labels and introduction version were not verified.
- [ATLauncher](https://atlauncher.com/) manages modpack instances; a specific direct-join UX was not verified.
- [CurseForge app](https://support.curseforge.com/en/support/solutions/articles/9000196904-creating-a-custom-profile) manages Minecraft profiles and modpacks; a specific direct-join UX was not verified.

### Vesta integration points

- `crates/piston-lib/src/game/launcher/version_parser.rs` merges parent and child legacy and modern arguments.
- `crates/piston-lib/src/game/launcher/unified_manifest.rs` combines vanilla and loader arguments; it also has separate library rule logic.
- `crates/piston-lib/src/game/launcher/arguments.rs`: `build_game_arguments` processes manifest arguments and appends `spec.game_args`; `evaluate_rules` handles demo/resolution and rejects unknown features; `build_game_variables` constructs substitutions. Thread target and path through the launch spec, implement the feature booleans and substitutions, and avoid duplicate manual and manifest flags. Raw extra flags alone do not activate manifest-gated entries.
- Trace `LaunchSpec` construction during implementation to carry the selected instance game directory and target to this code. No implementation was changed.

## Modrinth servers

[Modrinth Hosting](https://modrinth.com/hosting) sells managed Minecraft servers and supports installing modpacks. Its [modpack guide](https://support.modrinth.com/en/articles/8802250-modpacks-on-modrinth) also identifies third-party client and server installers. The app links a local instance to a modpack project and supports version changes; [unlinking](https://support.modrinth.com/en/articles/8797558-unlinking-an-instance) removes that relationship. That does not prove an arbitrary server address advertises a pack. The hosted-server-specific client sync mechanism and its permissions were not independently verified.

### Content API and discovery

Labrinth's documented v2 base is `https://api.modrinth.com/v2`. Examples include `GET /search`, `GET /project/{id|slug}`, `GET /project/{id|slug}/version`, and `GET /version/{id}`. Consult the [API reference](https://docs.modrinth.com/api/) for schemas; Modrinth's [API client source](https://github.com/modrinth/code/tree/main/packages/api-client) also contains v3 project and version modules. A third-party launcher can resolve an accessible known project/version and install its modpack, subject to metadata and file permissions; that does not identify the pack running on an arbitrary server.

Most public reads do not need authentication. Private reads and mutations generally require a user-bound PAT or OAuth2 token in `Authorization`, with the relevant scope and access; some operations cannot use either token type. See [authentication documentation](https://docs.modrinth.com/api/). Hosting-specific scopes and eligibility were not verified.

The [project type list](https://docs.modrinth.com/api/operations/projecttypelist/) and [search schema](https://docs.modrinth.com/api/operations/searchprojects/) do not list `server` as a project type. Server-side environment facets describe where content runs, not a directory of playable servers. No public server-listing project type or schema linking such a listing to a modpack was verified; recheck the live schema before implementing.

### Hosting panel / Archon

Modrinth's open-source [API client documentation](https://github.com/modrinth/code/blob/main/packages/api-client/AGENTS.md) identifies Archon server v0/v1 modules and WebSocket events for logs, stats, power, installation and filesystem activity. The [app source](https://github.com/modrinth/code/blob/main/apps/app-frontend/src/App.vue) lists hosted servers through `archon.servers_v0.list`. A public [issue](https://github.com/modrinth/code/issues/5824) shows `POST https://archon.modrinth.com/modrinth/v0/servers/{server_id}/power` with a `Start` action. This is evidence of an implementation, not a stable public contract. The client documentation describes obtaining a WebSocket JWT and using it to authenticate the socket and send commands. File-management modules exist, but precise endpoint contracts, permissions and supported third-party authentication are unverified.

A launcher can sync when it already knows an accessible project and version. Whether an authorized Archon response exposes the installed pack/version for a given hosted server remains unverified; no unauthenticated lookup by ordinary Minecraft address was established. Start/stop, console, files and settings exist in Modrinth's own panel, but third-party support, token scopes and server membership permissions need official confirmation and authorized testing. A Modrinth login alone should not be assumed to grant server management rights.
