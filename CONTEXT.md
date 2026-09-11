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

### Sandbox Policy

The user-facing confinement settings for an Instance's Play process graph:
hooks, game JVM, and child processes, plus an optionally enclosed wrapper. On
Windows, the launcher-owned exit handler is a trusted supervisor outside the
AppContainer and starts the hooks and game through separate restricted helper
invocations.
Launcher-owned installation, repair, Java management, and loader processors are
trusted work outside this boundary. Presets are Trusted (default, no sandbox),
Modded (filesystem and exec allowlists; network and mic on), and Paranoid (same
filesystem/exec/USB as Modded; network and mic off). Global app defaults and
per-instance overrides follow the existing `use_global_*` pattern. Shared
runtime caches (`assets/`, `libraries/`, and `versions/`) plus the
selected Java runtime are readable but not writable. Native-image load is a
distinct portable authority from child-process execution: the selected Java
runtime, shared natives, Instance game directory, and private sandbox temp are
loadable. Windows redirects runtime extraction and validation writes into private
sandbox temp and keeps shared natives read-only. Linux and macOS retain writable
natives for runtime extraction. The Instance game directory and exact
pre-created session-log file are read-write. Optional global and instance extra
paths grant read-write access.
Shared frontend path parsing lives in `src/utils/sandbox-policy.ts`, below both
settings persistence and UI. Browser previews cannot attest OS enforcement and
therefore leave enforced presets unavailable. On Linux, microphone denial also
withholds audio-server sockets and disables playback; the preset UI explains
this limitation.
Paths are canonicalized before
the Adapter builds its policy. Wrapper nesting (sandbox-outside vs
wrapper-outside) is configurable. Hooks run inside the Play sandbox and may use
the shell, but external executables remain subject to the exec allowlist. The
Vesta app process itself is not sandboxed; it continues to observe PID, exit
sidecars, playtime, kill, and crash handling from outside.

Primary modules:

- `crates/vesta-sandbox`
- `vesta-launcher/src-tauri/src/utils/sandbox_policy.rs`
- `vesta-launcher/src-tauri/src/instance/launch_preparation.rs`
- `docs/adr/0010-instance-os-sandbox-vesta-sandbox-crate.md`

### Sandbox Adapter

The OS-specific Implementation inside `vesta-sandbox` that turns a portable
`RunPlan` and resolved `SandboxPolicy` into a confined spawn (Seatbelt,
Landlock/`bwrap`, Windows job/AppContainer, or equivalent). Adapters report
what was actually enforced. If a control required by the policy cannot be
enforced, launch fails closed. The Windows Implementation has a bundled sidecar,
an AppContainer plus an atomically inherited kill-on-close Job, and a stable
per-Instance profile whose synchronized NTFS grants are recorded in a protected
ACL journal without traversing reparse points. Declared roots also receive
journaled, non-inheriting resolution ACEs on their private ancestor chain so
Win32 canonicalization (including Java `Path.toRealPath`) can reach them. These
permit traversal, metadata, and ancestor-name enumeration, but no child-file
reads or writes. Because a standard user cannot grant the package SID on shared
profile parents such as `C:\Users`, sandboxed Java receives a short-lived,
mutex-reserved DOS drive rooted at its user profile. Java-visible classpath,
argument, environment, and working-directory paths are rewritten through that
alias while NTFS policy remains attached to their canonical roots; the mapping
is removed when the launch ends. Each restricted invocation uses a fresh
writable/loadable directory beneath its AppContainer package temp. The trusted
helper copies JNA's architecture-specific `jnidispatch.dll` from the active,
read-allowlisted classpath JAR into that directory and configures
`jna.boot.library.path`; Java, JNA, LWJGL, and Netty temp paths are otherwise
directed there. The directory is removed after exit. A trusted in-container trampoline
can create one target with Windows' token-level no-child policy, an exact stdio
handle list, and a broker DACL that denies all access to both Everyone and Owner
Rights so the target cannot rewrite or bypass the broker boundary;
this blocks both System32 and loadable-root child execution. The trusted exit
supervisor delegates the pre-hook shell, game JVM, and post-hook shell to
separate helper invocations. A per-profile named mutex covers each invocation's
complete lifetime, closing the same-profile broker startup race. A second named
mutex serializes the complete ACL journal/DACL transaction across profiles so
concurrent Instances cannot lose one another's shared runtime grants. The
reusable policy file is stored beside the protected ACL journals, outside all
accepted writable sandbox roots. Windows reports exec
enforcement as Enforced and exposes playable presets. Its no-child policy is intentionally
stricter than the portable maximum-authority allowlist: game descendants are
denied even when their executable is listed. Generic sandbox-outside wrappers
are rejected; wrapper-outside remains an explicit weaker compatibility mode.
The Runtime launch Adapter never logs full command arguments or hook bodies,
which can contain account tokens and user secrets. Instance Lifecycle treats
the game-writable PID sidecar as an untrusted hint: Unix recovery must verify
membership in the original isolated process group; Windows does not adopt a
host PID from that file. Process-group identity survives replacement of a dead
wrapper PID during recovery.

Primary modules:

- `crates/vesta-sandbox`
- `crates/piston-lib/src/game/launcher/process.rs` (thin `sandbox_prefix` spawn hook)
- `docs/adr/0010-instance-os-sandbox-vesta-sandbox-crate.md`

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

After the file rollback journal is durably committed, successful update
finalization reconciles filesystem truth and modpack ownership in the Installed
Resource Ledger before publishing the new Instance version: missing rows and
obsolete bundled files are pruned, surviving manifest rows receive the new
provenance version, and new local rows are published. Read-only hashing may run
before the journal commit, but no Ledger mutation crosses that boundary.
Known bundled/custom duplicates are resolved before the completion event:
selected pack versions win on both upgrade and downgrade, including disabled
bundled copies with enabled custom duplicates. No provider release ranking is
needed. Provider enrichment remains a silent background Task that starts from
those coherent local facts and follows verified enabled/disabled renames.
Updates wait cancellably in Task Manager readiness for the instance's running
game to exit before acquiring a worker permit, planning, or pausing its watcher.
Readiness shares per-instance launch/update conflict exclusion with launch,
which reloads authoritative Instance status under that lock. Process state is
revalidated after the permit and before live mutation; a process that appears
after planning discards that plan. Updates then publish only
`core://instance-updated`. Duplicate resolution retains losing user-owned files
only after a successful Ledger enablement batch (disable losers, then enable
winners, with rename compensation on database failure); missing synthetic rows
are pruned on the next Resource/Versioning repair load. A committed pack version
is not rolled back solely because derived Ledger reconciliation fails.

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
Versioned task failure signals preserve provider and target identity alongside
encoded remote IDs, so frontend reconciliation clears only the exact failed
install. The explicit format marker prevents provider names from being confused
with World-folder text; the matcher retains provider-less legacy task-ID support
for work interrupted before an upgrade.
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

Opening a modpack from Browse may populate its Instance Draft before the
project-version request settles. That lookup is joinable: Install immediately
enters its starting state, awaits or retries the lightweight release lookup,
merges the concrete downloadable version into the payload, and queues exactly
one Task. Archive summary parsing remains independent background presentation
work and never gates submission.

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

The first-Instance onboarding Adapter uses the same payload builder for its
one-click modpack path. It resolves the latest stable download, queues the
existing modpack install command with 2–4 GB defaults, and only then completes
onboarding; failure leaves the Draft step available for retry. There is no
parallel global modpack-dialog state.

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
