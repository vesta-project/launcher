# Server modpack redesign (2026-10-28)

Replaces the current single-panel "Client modpack" tab. Builds on SERVER_RESOURCES_PLAN.md.

## Pack sources
1. **Provider pack** (Modrinth / CurseForge project + version). Not hosted: the server only
   records the provider IDs; clients install from the provider. Updating = picking a newer
   provider version. "Customize" forks it into a custom pack (copies entries + overrides).
2. **Custom pack** (draft workspace, Vesta-hosted): built in Vesta, or imported from an uploaded
   archive (.mrpack, CurseForge zip, or a plain zip with mods/config). Uploading asks
   "Use this as <server>'s modpack?" → yes: extract into a custom pack draft and host it on
   publish. If the archive is recognisably a provider pack (mrpack/CF manifest with resolvable
   IDs), offer to link the provider pack instead of hosting files.

## Modpack area (like an instance, but for a pack)
Server main nav gets **Modpack**; inside it, a sub-nav mirroring instance pages:
- **Overview**: pack identity (icon, name, summary), source (provider link or custom),
  Minecraft version (locked to server) + client loader, published revision / minimum,
  draft status ("3 unpublished changes" → Review & publish), "Get the modpack" (local
  instance install/link), "Install on this server".
- **Content**: entries table modelled on the instance Resources tab (search, kind filter,
  bulk select, required/optional, update, remove), suggestions inline as a dismissible
  strip, "Add content" → Browse targeted at the pack.
- **Files**: file manager for pack overrides (configs etc.), reusing the server Files tab
  components + editor; three roots like mrpack: *All* (overrides), *Client only*,
  *Server only*.
- **Versions**: published revisions history, draft diff, publish (optional / required),
  minimum revision.
Provider packs show Overview + read-only Content + Versions (provider versions list);
Files only after "Customize".

## Install a modpack on the server
From Browse (modpack type, target = server) or Modpack → "Install on this server":
plan → review (software/loader + version switch, server-side entries only — client-only
entries skipped —, server overrides, conflicts with existing server content, backup
recommendation) → apply (staged until restart). Optionally also set it as the server's
modpack (default on).

## Browse
Target select becomes a custom dropdown with **Instances** and **Servers** sections
(permission-gated, same rules as the install picker); selecting a server filters results for
its software/loader + Minecraft version, marks already-installed items, and installs default
to that server (destination step still allows modpack/both).

## Work split
- Sol: provider-pack mode (no hosting), pack overrides file CRUD (3 roots), archive inspect +
  "use as modpack" import, server pack install plan/apply, contracts + fixtures + handoff.
- Claude UI: Browse target select (now), then the Modpack area refactor on the new contracts.
- Terra (computer use): end-to-end acceptance in the real app against the dev server.

## Correction (2026-10-29): two independent, optional links
1. **Server modpack link (optional).** A server does not need a modpack. When it has one, the
   server is *linked* to a modpack (Modrinth / CurseForge / uploaded archive) exactly like an
   instance linked to a modpack: install, track version, update, unlink. Server-side content
   comes from it (client-only entries skipped); user-added server content stays separate.
2. **Client pack (optional), independent of (1).** Modes: `none` | `server-modpack` (players get
   the same modpack the server is linked to — provider packs referenced by ID, not hosted) |
   `custom` (a Vesta-built/hosted pack, separate from the server software and server modpack).
3. **Linked instances**: an instance linked to a server behaves exactly like an instance linked
   to a provider modpack (same link model, update checks, update flow, UI) — only the source is
   the server. Reuse the existing instance modpack-link pipeline; no parallel system.

## Addendum (2026-10-31): custom client pack based on a provider modpack
- A custom client pack may be **linked to a Modrinth/CurseForge modpack** (install a modpack into
  the custom pack). It then behaves like an instance linked to a modpack: pack-owned entries and
  overrides come from the provider version, update via version switch, user additions stay separate.
- **Unlink** prompts: *Keep everything* (pack content + configs become custom), *Keep resources
  only* (mods/resource packs/shaders stay, pack overrides/configs dropped), *Remove everything*
  (drop all pack-owned entries and overrides). Mirror the instance unlink flow if one exists.
- Distinct from client mode `server-modpack` (players get the server's own linked pack).
