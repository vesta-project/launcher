# One "server" concept: join, pack, manage

Status: proposal for review (Sol). Author: Claude Opus 5.5. Inputs: docs/research/2026-11-02-quick-play-and-modrinth-servers.md (Terra).

## Problem

Vesta has three server ideas that grew separately:

1. **Linked servers**: an instance whose pack comes from a server (signed pack link; `LinkedPack`, `pack_sync*.rs`).
2. **Vesta servers**: servers run by the Vesta agent, which Vesta can manage (Servers area, `features/servers/*`).
3. **Modrinth servers**: Modrinth Hosting. Today there's nothing for them. At minimum we want pack sync; maybe management later.

Next we're adding **join a server / open a world on launch** (Quick Play). If each of these gets its own page, tab and list, the launcher feels bolted together. Both obvious answers are bad:
- A per-instance "Servers" tab means maintaining lists by hand.
- One global list shared by every instance means every instance shows servers it can't join.

## Core idea: one server object with three optional capabilities

A **server** is an address people join. What Vesta can do with it depends on what it knows. The UI shows capabilities, never "types":

| Capability | Means | Where it comes from |
|---|---|---|
| **Join** | Has an address. Vesta can ping it (status/MOTD/players) and launch an instance straight into it. | Any address: typed, from an instance's `servers.dat`, from a Vesta agent, from Modrinth. |
| **Pack** | The server defines the client content. Vesta can create and keep an instance in sync. | Vesta signed pack (exists today). Modrinth: a modpack project + version, phase 1 picked or confirmed by the user. Later, advertised by Modrinth Hosting if a supported API exists. |
| **Manage** | Vesta can control it (console, files, settings). | Vesta agent (exists). Modrinth Hosting later, only via a supported, authorised API. |

So a Vesta server you own = join + pack + manage. A friend's Vesta server = join + pack. A random SMP = join. A Modrinth-hosted modpack server = join + pack (phase 1).

The Servers area stays the single home for servers. Today it's mostly "manage". It becomes "all servers you play on or run", with the management pages shown only when the manage capability exists. No second list anywhere.

## Instances and servers: derived, not curated

There's no "assign servers to an instance" step. The relationship is computed:

- **Linked instance**: if a server has the pack capability, the instance created from it is *its* instance (one-to-one, as today). Playing the server always uses it.
- **Compatible instances**: for a join-only server, an instance qualifies if it has the server in its `servers.dat`, or has joined it before (Quick Play log). A server ping reporting a protocol/version match is a weaker signal.
- **Choosing on Play**: the linked instance wins. Next is the most recent compatible instance. Next comes a one-time chooser ("Play SMP with…", compatible instances first) that remembers the answer per server. If the pack is known and no instance exists, Play becomes **Get pack & play** (the existing create-from-server flow).

Answer to "server tab in the instance page vs all instances share servers": neither. The instance page shows **where this instance plays**, derived as above, and the server list shows **which instance each server plays with**. Each side is a view of the same link, so they can't drift apart.

## UX

### Instance page

- **Play split button.** The main click launches as today. The arrow opens **Jump back in**: recent worlds and servers for this instance (Quick Play log, then `level.dat` LastPlayed, then `servers.dat`), each with an icon. Choosing one launches straight into it. No new tab.
- **Overview "Jump back in" row.** Up to 4 cards (world icon or server favicon, name, "2 days ago", live player count for servers). Click to launch into it. This replaces dead space rather than adding a section to manage.
- **Worlds tab** stays worlds (already exists). Each world row gets **Play** (direct launch on 1.20+). Older versions get "Open game" with no promise of a direct launch.
- **Servers** are a section inside the Worlds tab ("Worlds & servers"), not a new tab, read from `servers.dat`. Each row shows a status ping, Play, and *Open in Servers* if Vesta knows more (pack/manage). Add/remove/reorder writes `servers.dat` safely (only while the game isn't running).

### Servers area

- One list of joinable servers: Vesta-agent servers, linked servers, and servers imported from instances. Imports are opt-in per server via "Add to Servers" from an instance, so a random `servers.dat` entry doesn't flood the list.
- Each row: favicon, name, MOTD/players ping, the instance it plays with, and **Play**.
- Server detail pages:
  - Manage capability: today's tabs.
  - Pack only (friend's Vesta server, Modrinth server): Overview + Pack. Pack shows the pack, its version and the linked instance's sync status.
  - Join only: a compact page with status and the instance. No empty management tabs.
- **Add server** accepts an address, a Vesta pairing code or invite, or a Modrinth project/server link. Vesta works out the capabilities from what you paste: one input, not three dialogs.

### Copy rules

Never show "Vesta server" / "Modrinth server" / "Linked server" as kinds. Show the source where it matters ("Pack from Modrinth", "Managed by Vesta agent").

## Backend

### Launch targets (piston-lib)

- Add `LaunchTarget { None, World { folder }, Server { host, port }, Realm { id } }` to the launch spec.
- In `arguments.rs`:
  - Implement the features `has_quick_play_support` and `is_quick_play_*`, plus the substitutions `${quickPlayPath}`, `${quickPlaySingleplayer}`, `${quickPlayMultiplayer}` and `${quickPlayRealms}`.
  - Stop rejecting unknown features: evaluate unknown features as false.
- Always set `quickPlayPath` to an instance-local file (`<game dir>/.vesta/quickplay.json`) when supported. That makes recents work even for joins made inside the game.
- Pre-1.20: for a server target, if the manifest has no quick play args, append legacy `--server host --port port`. World targets are unsupported there, and the UI hides them.
- Never duplicate manifest flags.
- Tests: rule evaluation per feature, IPv6/port parsing, world names with spaces, and a merged manifest for vanilla, Fabric and NeoForge on 1.21 and Forge on 1.12.2 (legacy).

### Instance data (Tauri)

- `instance_worlds` (extend if it exists): folder, LevelName, LastPlayed, GameType, icon.
- `instance_saved_servers` / `instance_save_servers`: NBT read/write of `servers.dat`. Round-trip unknown tags, write atomically, refuse while the instance is running.
- `instance_recent_targets`: merges the quick play log, worlds and servers, sorted by recency, de-duplicated by normalised address or folder.
- `server_ping(address)`: Server List Ping with a short timeout and an in-memory cache of about 30 s, shared by the Servers list and instance views.

### Server registry (launcher)

- Generalise saved server connections into a registry entry: `{ id, name, address, icon, capabilities: { pack?: PackSource, manage?: ManageSource }, playsWith?: instanceId }`.
- Existing Vesta connections migrate as `manage: VestaAgent`, and get `pack: VestaSigned` when published.
- `PackSource = VestaSigned { serverId } | Modrinth { projectId, versionId?, followLatest } | CurseForge { projectId, fileId }`. The Modrinth pack path reuses the existing provider modpack link and update review, the same engine 1:1. A "Modrinth server" is mostly a server whose pack source is a Modrinth project. That's why it costs little.
- `ManageSource = VestaAgent { connectionId } | ModrinthHosting { … }` (phase 3, gated on a supported API).

## Phases

1. **Quick Play + Jump back in.** piston-lib targets, worlds/servers reading, recents, the instance Play split button and Overview row. Independent of the registry.
2. **Unified registry.** Join-only and pack-only servers in the Servers area, Add server with one input, Play-with resolution, Modrinth/CurseForge pack sources for servers, `servers.dat` editing.
3. **Modrinth Hosting.** Only if Modrinth offers a supported third-party API with scopes. Until then, don't scrape or use the private panel API.

## Risks and open questions

- Quick Play passthrough on old Forge and Fabric is unverified, so we need a compatibility matrix, with a graceful fallback to "open game" plus a toast.
- Writing `servers.dat` while the game is running would race with the game. We block writes during play and re-read when the game exits.
- Ping cost when many servers are listed: limit concurrency, refresh only what's visible, and cache.
- Should importing `servers.dat` entries into Servers be automatic for servers joined two or more times? Proposal: suggest, don't auto-add.
- Are there pack sources where the server and pack drift? Example: a Modrinth project version updated while the server lags. Proposal: the server's pinned version wins. For non-Vesta servers, the owner can't sign one, so the user confirms.
