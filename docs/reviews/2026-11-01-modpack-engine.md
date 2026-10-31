# Modpack engine investigation — 2026-11-01

## Existing implementations

Launcher initial installs live in `vesta-launcher/src-tauri/src/tasks/installers/modpack.rs`. Archive parsing and ownership receipts are in `crates/piston-lib/src/game/modpack/{parser,types,manifest}.rs`. Updates run through `modpack/engine.rs` and `sync/differ.rs`: a three-way comparison of old ownership, current hashes and incoming ownership. Untracked additions remain outside that diff; modified binaries are protected; unchanged pack-owned files can be replaced or removed. Overrides have separate hashes and config merge/preservation rules. Settings and world safeguards are launcher-specific.

Agent installs live in `crates/vesta-control/src/packs/workspace/{install,import,server_link}.rs`, dispatched by `vesta-transport/src/manage_pack_workspace.rs`. Planning currently fetches archives, resolves provider entries and downloads all payloads before returning a confirmation token. Apply journals payloads and removals with `staged_until_restart`; software changes already use asynchronous software jobs. Import has separate server archive handling, provider server-pack selection, environment filtering and protected runtime paths. This is a parallel engine today, not piston-lib reuse.

## Implementation plan

1. Enforce stopped Minecraft at the authoritative file admission boundary and transport, including unlink. Apply modpack journals immediately while stopped and report installed counts, without asking for restart.
2. Move expensive preparation behind Install into the existing job lifecycle. Keep pre-install inspection to metadata/manifest; report archive, metadata, download, writing and completion with file and byte counters. Keep network work outside database writers and request deadlines.
3. Replace the default modal with the existing page/card flow: version, Install, inline job progress and result. Keep optional changes and one software acknowledgement; block all entry points while Minecraft is active.
4. Extract reusable parser/filter/ownership decisions into a small dependency-free shared crate rather than depend on the Tauri application. Both launcher and agent should consume it. Preserve user additions and modified owned files; remove obsolete owned files only against their recorded hash; retain override precedence and environment rules. Do not claim full engine parity until the launcher's config merge/world safeguards and the agent adapter have regression coverage.

A direct dependency on piston-lib would reuse parsing but not the update engine (which is in the Tauri crate), and would pull authentication, graphics and runtime dependencies into the agent. A small shared crate is the preferred long-term boundary. Repository coupling must use a committed source/dependency, not an absolute path into a developer worktree.

## Validation

Run UI typecheck/build and server/Browse checks, agent file/workspace/transport tests and touched native tests. Exercise CurseForge COBBLEVERSE 1173260/6060565 and RLCraft 285109/4612979 with the configured key kept out of logs. Record failures honestly, including whether validation reached actual file application.
