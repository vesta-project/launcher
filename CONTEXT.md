# Vesta Launcher Context

This file is the repo-level domain map for architecture reviews and future agents.
It names the concepts that should be used when discussing modules, interfaces,
seams, adapters, leverage, and locality in this codebase.

## Domain Vocabulary

### Vesta Launcher

The desktop Minecraft launcher in this repository. It is built from a SolidJS
frontend, a Tauri/Rust host, and the `piston-lib` launcher library.

### Instance

A playable Minecraft installation managed by Vesta. An Instance includes game
version, modloader, local game directory, launch settings, icon state, playtime,
installation status, and optional modpack links.

Primary modules:

- `vesta-launcher/src/utils/instances.ts`
- `vesta-launcher/src/stores/instances.ts`
- `vesta-launcher/src-tauri/src/models/instance.rs`
- `vesta-launcher/src-tauri/src/commands/instances.rs`
- `vesta-launcher/src-tauri/src/instance/`

### Instance Lifecycle

The behavior around starting, observing, stopping, and reconciling a running
Instance inside the Vesta app. It includes process state, startup reattach,
exit reconciliation, crash persistence, playtime updates, Discord presence, and
instance events. `piston-lib` owns game/runtime launch correctness; Tauri owns
app-specific lifecycle policy around the running process.

Primary modules:

- `vesta-launcher/src-tauri/src/instance/lifecycle.rs`
- `vesta-launcher/src-tauri/src/commands/instances.rs`
- `vesta-launcher/src-tauri/src/setup.rs`
- `vesta-launcher/src-tauri/src/utils/process_state.rs`
- `crates/piston-lib/src/game/launcher/`

### Runtime Preparation

The work required to make an Instance ready for install, repair, update, import,
or launch. `piston-lib` owns Minecraft/runtime readiness facts such as
installed version id, manifests, client jar, libraries, natives, assets,
verification, and repair. Tauri owns app-specific launch adaptation such as Java
selection, modloader mapping from persisted Instance state, game directory
choice, app notifications, installation status restoration, account/offline
identity, GPU/env/hooks, and construction of launch/runtime specs.

Primary modules:

- `crates/piston-lib/src/game/runtime_preparation.rs`
- `crates/piston-lib/src/game/runtime_plan.rs`
- `vesta-launcher/src-tauri/src/instance/launch_preparation.rs`
- `vesta-launcher/src-tauri/src/tasks/installers/`
- `vesta-launcher/src-tauri/src/tasks/maintenance.rs`
- `vesta-launcher/src-tauri/src/tasks/update_modpack.rs`
- `vesta-launcher/src-tauri/src/tasks/installers/external_import_resync.rs`

### Startup Orchestrator

The Tauri startup sequence that initializes app services in dependency order.
`setup.rs` remains the visible orchestrator and chooses failure policy; named
startup phases own cohesive work with explicit inputs and outputs. Interrupted
operation recovery is the first extracted phase: database recovery runs before
the Notification Manager exists, then recovered facts are published after it is
created.

Current phases:

- `vesta-launcher/src-tauri/src/setup.rs`
- `vesta-launcher/src-tauri/src/startup/accounts.rs`
- `vesta-launcher/src-tauri/src/startup/metadata.rs`
- `vesta-launcher/src-tauri/src/startup/processes.rs`
- `vesta-launcher/src-tauri/src/startup/recovery.rs`
- `vesta-launcher/src-tauri/src/startup/resources.rs`
- `vesta-launcher/src-tauri/src/startup/shell.rs`
- `vesta-launcher/src-tauri/src/startup/updates.rs`
- `vesta-launcher/src-tauri/src/logging.rs`

### Modpack

A curated set of Minecraft files, metadata, dependencies, and version links from
Modrinth, CurseForge, or a local archive.

Primary modules:

- `vesta-launcher/src-tauri/src/tasks/installers/modpack.rs`
- `vesta-launcher/src-tauri/src/tasks/update_modpack.rs`
- `crates/piston-lib/src/game/modpack/`

### Modpack Instance State

The installed state of a modpack-linked Instance. Its only persisted manifest is
`<game directory>/modpack_manifest.json`; the former `.vesta` manifest copy is
not read or written. It includes hash backfill, resource ledger, resource
presence checks, repair state, update finalization, pending-update recovery,
runtime/Java follow-up, and Instance event emission.

Primary modules:

- `vesta-launcher/src-tauri/src/modpack/state.rs`
- `vesta-launcher/src-tauri/src/modpack/update.rs`
- `vesta-launcher/src-tauri/src/modpack/engine.rs`
- `vesta-launcher/src-tauri/src/sync/manifest_bootstrap.rs`
- `vesta-launcher/src-tauri/src/sync/manifest.rs`
- `vesta-launcher/src-tauri/src/tasks/installers/modpack.rs`
- `vesta-launcher/src-tauri/src/tasks/update_modpack.rs`

### Resource

A downloadable project or file from a remote platform, such as a mod,
resourcepack, shader, datapack, modpack, or world.

Primary modules:

- `vesta-launcher/src/stores/resources.ts`
- `vesta-launcher/src/components/pages/mini-pages/resources/`
- `vesta-launcher/src-tauri/src/resources/`
- `vesta-launcher/src-tauri/src/models/resource.rs`

### Installed Resource Ledger

The Tauri Module that owns the local filesystem and persisted-row facts for an
installed Resource: normalized path, enabled/disabled filename, remote/manual
identity, file metadata, provenance fields, row cleanup, and local presence
lookup. Resource discovery, remote metadata lookup, manifest matching, and
workflow notifications remain outside the Ledger.

Primary modules:

- `vesta-launcher/src-tauri/src/resources/ledger.rs`
- `vesta-launcher/src-tauri/src/resources/watcher.rs`
- `vesta-launcher/src-tauri/src/tasks/resource_download.rs`

### Resource Browse Session

The frontend state around browsing Resources. It includes query text, filters,
source platform, selected Instance, categories, sort, pagination, router state,
and search timing.

Primary modules:

- `vesta-launcher/src/stores/resources.ts`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-browser.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-toolbar.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/filter-popover.tsx`

### Resource Install Intent

The user intent to install, update, remove, or navigate from a Resource into an
Instance flow. It includes compatibility, installed matching, update availability,
and action feedback.

Primary modules:

- `vesta-launcher/src/utils/resource-install-intent.ts`
- `vesta-launcher/src/utils/resources.ts`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-card.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-details.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/instance-selection-dialog.tsx`

### Instance Draft

The in-progress editable state for creating or updating an Instance. It includes
initial values, dirty state, memory defaults, version compatibility, modpack
sync, and final payload construction.

Primary modules:

- `vesta-launcher/src/utils/instance-draft.ts`
- `vesta-launcher/src/components/pages/mini-pages/install/components/InstallForm.tsx`
- `vesta-launcher/src/components/pages/mini-pages/instance-details/instance-details.tsx`
- `vesta-launcher/src/components/pages/init/steps/first-instance-step.tsx`

### Task

A long-running Rust operation submitted to the task manager. Tasks report
progress through notification and channel adapters and may be cancellable or
pausable.

Primary modules:

- `vesta-launcher/src-tauri/src/tasks/manager.rs`
- `vesta-launcher/src-tauri/src/tasks/`
- `vesta-launcher/src-tauri/src/notifications/`

### Notification Action

A command attached to a Notification. Notification Manager owns dispatch,
persisted payload lookup, and auto-dismiss behavior. The Module that owns the
command registers its Action Adapter; Task actions, for example, live beside
Task Manager rather than inside Notification Manager.

Primary modules:

- `vesta-launcher/src-tauri/src/notifications/manager.rs`
- `vesta-launcher/src-tauri/src/tasks/notification_actions.rs`
- `vesta-launcher/src-tauri/src/instance/notification_actions.rs`

### Architecture Memory

The repo-owned memory for domain language and load-bearing decisions.

Primary modules:

- `CONTEXT.md`
- `docs/adr/`

Architecture review reports are external snapshots. They stay outside the repo
unless a finding becomes a domain term or a decision.

## Review Discipline

- Use this file for domain vocabulary before naming a new deep module.
- Use `docs/adr/` for accepted or rejected load-bearing decisions.
- Keep exploratory architecture findings in external HTML review reports.
- When a finding becomes a decision, record it in an ADR.
- When a term becomes load-bearing, add it here.
- Prefer area folders with short module filenames when an area contains multiple
  related Modules. Avoid top-level single-file folders with only `mod.rs`
  unless the folder is expected to grow.
