# Server resources and client modpacks (2026-10-26)

Builds on SERVER_FRONTEND.md ("Install to server" from Browse, Pack area) and the agent
requirements `pack-revisions-and-update-policy-*`, `files-and-content-007/008`.

## Model
- **Server resources**: what is actually on the server — mods, plugins, datapacks (world),
  server resource pack reference. Inventory with provider identity when known, install,
  update, remove (to trash), enable/disable. JAR changes while Minecraft runs are staged and
  applied on the next restart.
- **Client modpack (pack draft)**: separate list that players download. Own client loader
  (any: Fabric/Quilt/NeoForge/Forge or none) — independent of the server software, so a
  Paper/Purpur/vanilla server can ship e.g. a Fabric + Sodium pack. Minecraft version locked
  to the server's. Draft → validate/diff → publish revision; minimum revision makes it
  required. Server changes never silently change the draft; Vesta *suggests* (client-needed
  server mods missing from the pack, outdated versions, removed server mods).
- **Install targets** (Browse and in-app): *server*, *modpack*, or *both*. Smart default
  from project side metadata (client+server → both; server-only/plugins → server;
  client-only → modpack), always overridable per install.
- **Dependencies**: resolved with the same resolver instances use (launcher side), shown in
  the install dialog; required ticked, optional unticked. Agent installs by provider IDs only.
- **Permissions**: servers appear as Browse targets only when the user has the relevant
  capability (content install for server, pack edit for modpack); hidden otherwise.
- **Plugins**: first-class resource type for Bukkit-family servers (Paper/Spigot/Bukkit/
  Purpur/Folia loaders on Modrinth; CurseForge Bukkit plugins), filtered by the server's
  software family.
- **Custom server JAR**: owner can pick a JAR already in the server files as the launch
  target (Software page), with confirmation and validation; restores to managed software.

## Stages (delivered back-to-back)
1. Server resources: agent inventory/update/remove/enable-disable/staging + custom JAR
   launch; native + TS; Browse server targets (permission-gated, Instances/Servers sections,
   server vs modpack target), plugin type; server Resources page.
2. Pack workspace: draft CRUD, loader choice, suggestions, diff, build/publish, minimum.
3. Client sync: linked instances follow the published pack (optional vs required updates,
   signature/server binding, rollback rejection, consent for executable changes).

Roles: GPT Sol = agent/native/contracts + reviews; Luna = scans; Claude UI agents = pages;
Claude Opus = design, supervision, review/merge.
