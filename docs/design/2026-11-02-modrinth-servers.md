# Modrinth servers: browse, details, linked instances

Status: build contract (2026-11-02). Owner: Claude Opus 5.5 (orchestrator). Backend: GPT-6.1 Sol. Frontend: Claude Opus.
Builds on docs/design/2026-11-02-servers-unified.md (+ review, slice 1).

## What Modrinth actually exposes (verified live, 2026-11-02)

- `GET /v2/tag/project_type` includes `minecraft_java_server`.
- v2 search works: `facets=[["project_type:minecraft_java_server"]]` (2,415 hits). It returns the usual hit fields (title, icon, gallery, categories such as `smp`/`pvp`, loaders such as `neoforge`, `versions`).
- **Server data needs v3.** `GET /v3/project/{id|slug}` and `GET /v3/search?new_filters=project_types = minecraft_java_server` include:
  - `minecraft_java_server.address`, e.g. `play.aerosmp.com`.
  - `minecraft_java_server.content`:
    - `{ kind: "vanilla", supported_game_versions[], recommended_game_version }`, or
    - `{ kind: "modpack", project_id, version_id, project_name, project_icon }`.
  - `minecraft_java_server.ping`: `{ when, data: { players_online, players_max, version_name, version_protocol, description, latency } }`.
  - `verified_plays_2w` / `verified_plays_4w`.
  - `minecraft_server`: `{ region, country, languages[], max_players }`.
- The modpack is normally a version of the **server's own project** (Aero SMP: `project_id` = the server's id, `version_id` = an `.mrpack` modpack version). It can also point to another modpack project.
- **The pack version is authoritative and owner-set.** That resolves the review's "advisory pin" concern for Modrinth listings. An instance linked to a Modrinth server follows `content.version_id`: when the listing changes it, that's an update; it's required when the instance's version no longer matches. Vanilla servers have no pack, only game versions.

## Product

1. **Browse:** "Servers" is a new resource type next to Modpacks (Modrinth only, hidden for CurseForge).
   - Cards show icon, name, summary, players online / max, a ping freshness dot, region, Minecraft version (or "Modpack: <name>"), and categories.
   - Filters: categories, game version, loader, region/language if cheap.
2. **Resource details:** the existing project page with a server variant.
   - Header: address with Copy, live players, version, region.
   - Primary action: **Play** (vanilla), **Install & play** (modpack, no linked instance yet), or **Play with <instance>** (when linked), with a "Change" option.
   - The Overview shows a content card: the vanilla versions, or the modpack card (icon, name, version) that opens the modpack.
   - Versions tab: the modpack versions, as for modpacks today.
3. **Linking:** "Install & play" creates an instance from the server's pack version, using the existing modpack install engine 1:1. It links the instance to the server and saves the address as the instance's join destination, so Play joins it via Quick Play where supported (slice 1 targets). Linking an existing instance is also allowed when its pack is the same modpack project. Vanilla servers: pick or create a vanilla instance at the recommended version.
4. **Instance:** the linked-pack card is the **same UI as Vesta server links** (`LinkedPack`): source "Server", the server name and icon, an update when the listing's `version_id` changes (reviewed on Versions like any linked pack), and the server's live status. Play on the instance joins the server.

## Contract (backend ⇄ frontend)

Rust (`vesta-launcher/src-tauri`, resources + instances):
- `ResourceType` gains `server` ↔ Modrinth `minecraft_java_server`. `search_resources` with type `server` uses the v3 search (or v2 for the hits, then v3 for server fields) and returns `ResourceProject`s with an optional `server` block.
- `ResourceProject.server?: ServerListing`:
  ```ts
  interface ServerListing {
    address: string;
    content: { kind: 'vanilla'; gameVersions: string[]; recommendedVersion: string | null }
           | { kind: 'modpack'; projectId: string; versionId: string; projectName: string | null; projectIcon: string | null };
    ping: { at: string; online: number; max: number; versionName: string | null; latencyMs: number | null } | null;
    region: string | null; languages: string[]; plays2w: number | null;
  }
  ```
  `get_resource_project('modrinth', id)` fills `server` for server projects.
- Instance link: extend the existing provider modpack link with an optional `server: { platform: 'modrinth', projectId, address }`. The pack source stays the modpack project/version, so all update/review code is reused. A server-linked update check reads the listing's current `content.version_id` instead of "latest version".
- Commands:
  - `install_server_pack(projectId) -> instanceId`: resolves `content`, installs via the existing modpack path, records the link and destination.
  - `link_instance_to_server(instanceId, projectId)`: validates that it's the same modpack project, or a vanilla version match.
  - `unlink_instance_server(instanceId)`: keeps content and drops the server link only.
  - `instance_server_status(instanceId)`: cached listing ping, plus `update_available` / `update_required`.
- Play: a server-linked instance launches with the server target (slice 1 `LaunchTarget::Server`) when supported, and otherwise launches normally.
- Cache listings (ping included) for about 60 s. Never hammer v3 search per keystroke beyond what Browse already does.

Frontend (`apps/desktop-solid`): extend `browse-model.ts` `ResourceType` with `'server'` and mirror the TS types above in `browse-model.ts`. In a plain browser, fixtures in `browse-fixtures.ts` (one vanilla, one modpack server) keep the UI explorable before the backend lands.

## Backend deviations

- The existing provider link is stored as flat `Instance.modpack*` columns, not a link object. The optional server extension is persisted in `instance_server_link` (one row per instance, cascade on delete) and exposed by `instance_server_status(instanceId) -> InstanceServerStatus | null`. This avoids changing every Instance constructor and keeps provider content intact on unlink. Status uses `{ server: { platform: 'modrinth', projectId, address }, listing: ServerListing, update_available: boolean, update_required: boolean }`. The four command names and arguments above are unchanged. Vanilla links have no provider modpack fields.
- `install_server_pack` returns the created instance ID after scheduling the existing asynchronous install, just like `install_modpack_from_url`; it does not launch the game. Vanilla uses the existing `create_instance` and `install_instance` paths.
