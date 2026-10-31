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

## Implementation status and validation handoff

This branch is a **partial implementation**, not completion of the shared-engine requirement.

Implemented: the default launcher flow uses existing server panels inline, defers preparation until Install, shows preparation file counters and waits for software jobs before showing Done. Stopped-state gates cover Browse cards/version actions and server pack controls. Start shows Starting in its primary action. Agent transport holds stopped process ownership and refuses active Minecraft with `modpack_requires_stopped`; confirmed pack journals apply immediately, including unlink, with an installed outcome. Protected Minecraft settings cannot enter pack writes.

Still required: extract and use the same launcher install/update engine; metadata/manifest-only planning in the agent; a durable download job with byte progress; diagnose/fix upload busy/connection errors. The current agent `install_plan` still downloads synchronously. Deferring its invocation in the UI is not a substitute for that backend change. Internal durable file intents remain for recovery, though the successful modpack flow no longer waits for restart.

Validation so far: UI typecheck and `bun run build` pass; full server/Browse checks: 501 pass, one console timing/diagnostics failure. All 27 focused reactivity/pack-loading/Browse target checks and four error/review checks pass in isolation. Agent `cargo check -p vesta-transport` and five HTTPS pack-workspace integration tests pass. A broad library run was interrupted; final focused native results are recorded in the implementation handoff.

Live provider checks used the configured key without logging it. CurseForge identifies the supplied 1173260/6060565 as **Cobblemon 3D Poke Rods**, class 12 (resource pack), not COBBLEVERSE; its 206-file install reached application successfully. The existing correct COBBLEVERSE reference is project 1210677, file 8488030 (COBBLEVERSE 1.7.42); its live install has not been validated here. RLCraft 285109/4612979 prepared successfully in about 435 seconds, selecting its server archive; application was progressing (504 of 3,554 journaled files applied) when the lengthy attempt was stopped. This is not an end-to-end pass, and no Minecraft launch was attempted. Tests use a real local temporary agent engine/database/filesystem, not a running development agent over TLS.
