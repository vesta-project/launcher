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

### Authentication Session and Availability

The boundary between persisted Microsoft/Minecraft account state and the
current availability of remote authentication services. `piston-lib` owns
protocol and HTTP failure classification for Microsoft, Xbox Live, and
Minecraft Services. Tauri owns account persistence, refresh policy, launch
fallback, and setup-aware notification policy.

A persisted Microsoft account with a Minecraft UUID and username is proof of a
previous successful authentication. Only such an account may launch offline
automatically. Guest, Demo, and unknown account types never qualify. Network
failures and retryable service responses may make authentication temporarily
unavailable; they do not invalidate the account. Generic HTTP responses such as
`404 Not Found` are never proof that a session is unauthenticated.
Authentication-service warnings are reserved for service-only failures while
general connectivity is online. A known device-offline state uses the single
Instance offline-launch notification instead.

Primary modules:

- `crates/piston-lib/src/auth/mod.rs`
- `crates/piston-lib/src/api/mojang.rs`
- `vesta-launcher/src-tauri/src/auth/mod.rs`
- `vesta-launcher/src-tauri/src/instance/launch_preparation.rs`
- `vesta-launcher/src/utils/auth.ts`

### Startup Orchestrator

The Tauri startup sequence that initializes app services in dependency order.
`setup.rs` remains the visible orchestrator and chooses failure policy; named
startup phases own cohesive work with explicit inputs and outputs. Interrupted
operation recovery is the first extracted phase: database recovery runs before
the Notification Manager exists, then recovered facts are published after it is
created. Pending modpack update transactions are recovered in this phase before
normal interrupted-operation handling: committed transactions finish cleanup,
uncommitted transactions restore the previous playable version, and incomplete
restores use the existing resumable `interrupted` Instance lifecycle with
`last_operation = update`.

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
runtime/Java follow-up, and Instance event emission. An update keeps a
versioned `.update_rollback/manifest.json` transaction through finalization.
Affected active paths and world/config rotations are preserved with
same-filesystem renames, making rollback proportional to metadata operations
rather than file copying. Any task failure restores the prior files and
runtime/modpack metadata before returning the Instance to `installed` and
publishing a persistent notification. A restore failure preserves its journal,
sets the existing `interrupted` status, and exposes a resume action that retries
restoration without retrying the update.

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

Datapack rows remain Ledger-owned file facts, but their management scope is the
exact World derived from the row's normalized path. They are intentionally
absent from Instance Resource overviews, matching, batch actions, and update
snapshots. The same remote datapack may therefore have independent rows in
several Worlds.

When a managed datapack bundle includes a companion resource pack, the World
Manifest is the portable ownership link and the Ledger remains the file fact.
Removing one datapack removes its companion only when no other bundle in the
same World or any other discovered World may reference that exact relative
path. Unreadable/corrupt metadata and hash mismatches retain the companion.
Generic Instance Resource actions cannot remove or disable a linked companion.

Primary modules:

- `vesta-launcher/src-tauri/src/resources/ledger.rs`
- `vesta-launcher/src-tauri/src/resources/update_policy.rs`
- `vesta-launcher/src-tauri/src/resources/watcher.rs`
- `vesta-launcher/src-tauri/src/tasks/resource_download.rs`

### World

A Java Edition folder world discovered as an immediate child of an Instance's
`saves` directory. The filesystem is authoritative: a stable root `level.dat`
or recovery `level.dat_old` establishes the world boundary, while all internal
region, player, dimension, datapack, conversion, and future-version layouts are
opaque to Vesta and preserved verbatim. Listing a World is read-only and does
not create Vesta metadata.

Primary modules:

- `vesta-launcher/src-tauri/src/worlds/level_dat.rs`
- `vesta-launcher/src-tauri/src/worlds/mod.rs`
- `vesta-launcher/src/stores/worlds.ts`
- `vesta-launcher/src/components/pages/mini-pages/instance-details/tabs/WorldsTab.tsx`

### World Manifest

The optional portable `<world>/.vesta/world.json` document that stores only a
Vesta world identity, source provenance, and managed component links. It never
stores absolute paths, database identifiers, or derived presentation facts.
The manifest is created only by a Vesta management action. Move preserves world
and bundle identities; copy and duplicate regenerate them.

Primary modules:

- `vesta-launcher/src-tauri/src/worlds/manifest.rs`
- `vesta-launcher/src-tauri/src/resources/ledger.rs`
- `docs/adr/0009-filesystem-owned-worlds-and-portable-world-manifests.md`

### World Management

The provider-neutral workflow for installing archive-contained Java worlds,
selecting a World as a datapack target, and moving, copying, or duplicating a
World between Instances. The World Module owns archive safety, discovery,
metadata, transfer verification, and publication. The Installed Resource Ledger
owns installed datapack and companion resource-pack files. Resource source
Adapters describe artifacts but do not choose filesystem destinations.
The dedicated World Datapack Interface lists direct ZIP/JAR and directory-form
packs for one validated WorldRef, exposes no absolute paths, and validates the
exact World again before file mutations. Directory-form packs are visible but
read-only. Instance Resource commands reject datapack rows.
World transfers do not infer file availability from Instance process state;
actual filesystem reads, copies, verification, and publication are authoritative,
and inaccessible files surface as Task failures.

World mutations participate in Task Manager conflict coordination. Logical
keys cover exact Worlds, each Instance's `saves`, and each Instance's
`resourcepacks`; multi-key reservations publish as one atomic set so waiting
Tasks do not monopolize unrelated resources. Filesystem watcher bursts reconcile
their final on-disk state after managed staging rather than racing Ledger rows.
World archive publication uses no-replace filesystem primitives, and preflight
enforces portable names, Unicode-aware collision detection, bounded candidate
counts/expansion, compression-ratio limits, and regular file/directory entries.

Primary modules:

- `vesta-launcher/src-tauri/src/worlds/archive.rs`
- `vesta-launcher/src-tauri/src/worlds/datapacks.rs`
- `vesta-launcher/src-tauri/src/worlds/transfer.rs`
- `vesta-launcher/src-tauri/src/tasks/world_install.rs`
- `vesta-launcher/src-tauri/src/tasks/world_transfer.rs`
- `vesta-launcher/src-tauri/src/commands/worlds.rs`
- `vesta-launcher/src/components/worlds/WorldSelectionDialog.tsx`
- `vesta-launcher/src/components/pages/mini-pages/instance-details/tabs/WorldDatapacksView.tsx`

### Resource Reconciliation

The Tauri workflow Module between Resource Watcher discovery, Resource Manager
remote lookup, and Installed Resource Ledger persistence. Passive watcher and
startup reconciliation stats files and publishes local rows in one transaction
without hashing or provider traffic. Install-owned enrichment and explicit
unresolved-row identification collect hashes in a bounded pass, identify files
through provider batch Interfaces, select the canonical platform, persist
authoritative peer links, and emit at most one typed rows event plus one typed
metadata event per completed batch. Install-owned enrichment is a silent
deduplicated Task; explicit identification is available only from an unresolved
row's action menu and reports its busy state there. The Module owns offline and
partial results, while permanently
unidentifiable local files are not retried by overview reads or filesystem
bursts. The Ledger remains unaware of remote lookup, event, retry, and
notification policy.

Primary modules:

- `vesta-launcher/src-tauri/src/resources/reconciliation.rs`
- `vesta-launcher/src-tauri/src/tasks/resource_reconciliation.rs`
- `vesta-launcher/src-tauri/src/resources/watcher.rs`
- `vesta-launcher/src-tauri/src/resources/manager.rs`
- `vesta-launcher/src/stores/instance-resource-overview.ts`
- `vesta-launcher/src/components/pages/mini-pages/instance-details/`

### Resource Browse Session

The frontend state around browsing Resources. It includes query text, filters,
source platform, selected Instance, categories, sort, pagination, project
version lists, session-cached version details, router state, nested version
focus, and search timing. The selected Instance is the only persistent install
destination context: Resource browsing and details never retain a preferred
World. A datapack chooses its World within the active install interaction, and
the selected World is passed explicitly to the backend for that operation.
Provider project objects and their cache entries retain the provider's canonical
classification. A route or World-originated install type is carried beside that
object and must not mutate cached project metadata. In-flight installation state
is keyed by provider, project, version, and exact Instance or World target; a
Ledger refresh clears only the target it proves was published.
Task failure signals preserve provider and target identity alongside encoded
remote IDs, so frontend reconciliation clears only the exact failed install;
the matcher retains legacy task-ID support for work interrupted before an
upgrade.
Instance-selection eligibility is built from fresh per-Instance Ledger reads.
Version and Ledger lookups use latest-request publication, and an Instance stays
unavailable while its installed state is unknown or could not be verified.
Provider Adapters normalize changelog format and
availability so missing release notes do not erase already-available file
metadata, and distinguish CurseForge client/server environment labels from
Minecraft versions. Provider switching accepts only peer lookups keyed to the
current source/project identity, and only the latest project request may publish
details into the active route. The page viewer supplies visible loading feedback
while the lazy resource-details route module is fetched. Once mounted, Resource
details uses the established project-fetch overlay for an uncached project, then
hydrates the description, version list, sidebar, and focused-version regions
behind independent loading boundaries; background refreshes do not unmount
already-available regions.

Primary modules:

- `vesta-launcher/src/stores/resources.ts`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-browser.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-toolbar.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/filter-popover.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-details.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-details-loading.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-details-loading-state.ts`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-version-focus.tsx`
- `vesta-launcher/src/utils/resource-install-progress.ts`
- `vesta-launcher/src/utils/resource-task-id.ts`
- `vesta-launcher/src-tauri/src/resources/sources/mod.rs`
- `vesta-launcher/src-tauri/src/resources/manager.rs`

### Resource Install Intent

The user intent to install, update, remove, or navigate from a Resource into an
Instance or World flow. It includes an explicit install type, target,
compatibility, installed matching, update availability, and action feedback.
The install type is user intent rather than provider project classification.
Compatible-version selection first constrains a provider's release feed to that
intent. Provider metadata is not interchangeable: Modrinth's explicit datapack
loader distinguishes mixed builds, while CurseForge's project class supplies the
Resource type. Destination scope is decided only after an explicit version has
been selected, so a combined datapack/resource-pack release cannot accidentally
use an Instance-only target. Download availability is validated before asking
for an Instance or World. Datapack quick selection uses the selected World's saved version,
ignores its Instance loader, and requires an exact provider Minecraft-version
tag; other tags remain manually installable after a confirmation that identifies
the selected datapack release, provider-listed Minecraft versions, target World,
and saved World version. Downloaded
datapacks remain subject to root `pack.mcmeta` validation before publication.
Opening a managed datapack from World Management navigates to its provider
project without preselecting a World target. Immutable source-row context allows
a later install into that same World to replace the exact managed row; choosing
another World creates an independent installation.

Primary modules:

- `vesta-launcher/src/utils/resource-install-intent.ts`
- `vesta-launcher/src/utils/datapack-compatibility-confirm.ts`
- `vesta-launcher/src/utils/resources.ts`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-card.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-details.tsx`
- `vesta-launcher/src/components/pages/mini-pages/resources/resource-instance-selection-dialog.tsx`

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
persisted payload lookup, and default auto-dismiss behavior. The Module that
owns the command registers its Action Adapter and may keep an asynchronous
action notification visible until the result replaces it. Update recovery uses
that opt-out so a repeated restore failure refreshes, rather than removes, its
resumable notification. Task actions, for example, live beside Task Manager
rather than inside Notification Manager.

Primary modules:

- `vesta-launcher/src-tauri/src/notifications/manager.rs`
- `vesta-launcher/src-tauri/src/tasks/notification_actions.rs`
- `vesta-launcher/src-tauri/src/instance/notification_actions.rs`
- `vesta-launcher/src-tauri/src/startup/update_actions.rs`
- `vesta-launcher/src-tauri/src/auth/notification_actions.rs`

### Localization

The shared user-language boundary for frontend and native launcher surfaces.
Fluent catalogs are repo-owned release inputs synchronized through Crowdin.
The frontend Module owns reactive language application, document direction,
browser formatting, and English fallback. The Tauri Module embeds the same
catalogs for native shell text and owns persisted preference validation and
system-locale negotiation.

Primary modules:

- `vesta-launcher/locales/`
- `vesta-launcher/src/localization/`
- `vesta-launcher/src-tauri/src/localization/`
- `vesta-launcher/src/components/pages/mini-pages/settings/general/GeneralTab.tsx`
- `crowdin.yml`

### Keyboard Command Catalog

The app-local command and shortcut system. Frontend command definitions own
executable handlers, availability, and defaults. The config database owns the
materialized command metadata and each user's current, customized, or explicitly
unbound shortcut. Tauri command Adapters reconcile definitions, enforce global
shortcut uniqueness, persist mutations, and broadcast updates to every WebView.

Page-local navigation such as arrow movement within a grid remains owned by the
page or control Module rather than the global Keyboard Command Catalog.

Primary modules:

- `vesta-launcher/src/keybindings/`
- `vesta-launcher/src/components/pages/mini-pages/settings/keyboard/`
- `vesta-launcher/src-tauri/src/commands/keybindings.rs`
- `vesta-launcher/src-tauri/migrations/config/`

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
