# Vesta Launcher

A desktop Minecraft launcher with real users. It installs, updates and launches local instances (vanilla, loaders, modpacks). It also manages remote Hosts.
Never compromise on: users' instances, data and migrations; desktop performance; Windows, macOS and Linux.

## How it fits together
- Rust backend (Tauri) does the work: installs, downloads, launching and the database.
- The frontend is a thin UI over Tauri commands and events. Long work runs in the backend as tasks with progress events.
- Hosts are separate machines running Vesta Server. The linked-device clients (`vesta-server-client`, `vesta-host-client`) connect to Vesta Server. The launcher must never run remote processes itself.

## Where things are (only the non-obvious)
- `apps/desktop-solid`: active Solid frontend and desktop entry point. Put new UI here and follow its AGENTS.md.
- `vesta-launcher/src-tauri`: Rust launcher backend reused by the desktop app.
- `vesta-launcher/src`: legacy frontend. Don't build new UI there.
- Workspace crates include piston-lib (install/launch), vesta-sandbox, modpack-engine, vesta-server-client and vesta-host-client.
- `.claude/skills/` is not mirrored: Git has core.symlinks=false on this Windows checkout; use `.agents/skills/` as the source of truth.

## Commands
- Package manager is bun (never npm/yarn). `bun i`, `bun run check`, `bun run typecheck`, `bun run format`.
- Dev: `bun run vesta:dev`. Never run `bunx tauri dev` directly.
- Targeted Rust tests: `cargo test -p <crate>` from the workspace root.

## Ways to hurt yourself
- Use an isolated dev profile. The Tauri dev wrapper defaults to `apps/desktop-solid/.dev-profile` unless `VESTA_DEV_PROFILE_DIR` is already set. Verify the effective data directory before launching. Never point at a real launcher profile.
- SQLite has a single writer; keep transactions short.
- Tauri args are camelCase in JS and snake_case in Rust.
- Diesel migrations need both `up.sql` and `down.sql`, and must migrate existing user data safely.
- Windows paths: use native path/URL helpers, never string concatenation. Watch spaces, `&`, `\\?\` and 8.3 paths.
- Account UUIDs are normalized without dashes in backend/cache references.
- Notifications use `client_key` to identify updates to an existing notification.

## Hit every surface
- A long-running job (install, update, import) owns its target until it finishes. Show its state before any "broken" or "not ready" error.
- Every way in needs a way out: cancel, undo, restore, and recovery after restart.
- Build from the shared UI primitives (buttons, inputs, sliders, dialogs, form patterns). A genuinely new screen design is fine; restyled one-off basics are not.

## When the task involves Hosts
- Read the relevant `docs/architecture/SERVER_*.md` documents and ADRs first.
- Hosts are remote. Design and test connections and onboarding for a different machine.
- Gate each action on the permission it needs. A missing optional capability must not hide unrelated settings.

## Glossary
- **Instance**: a local Minecraft install managed by the launcher.
- **Vesta Server**: the self-hosting product.
- **Host**: a machine running Vesta Server. Owns devices and ownership.
- **Device**: a launcher linked to a Host.
- **Minecraft server**: one game server managed by a Host, with its own roles.
- **Software**: loader and version (Vanilla, Fabric, Paper...).
- **Job / operation**: long-running work with a durable state (queued, running, cancelling, succeeded, failed).
More terms: `CONTEXT.md`, `docs/adr/`.
