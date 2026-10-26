# Server resources UI handoff — Stage 1

The approved model is in `docs/architecture/SERVER_RESOURCES_PLAN.md`. Resources
are live server content, independent of the client pack draft. This backend never
modifies that draft. All additions are feature/native files; pages are untouched.

## Contracts

`native-content.ts` is spread into `serversNative` and therefore `ServersApi`:

| Method / Tauri command | Agent route |
|---|---|
| `content` / `server_content` | GET `content` |
| `contentInstall` / `server_content_install` | POST `content/install` or `content/update` when path + validator supplied |
| `contentMutate` / `server_content_mutate` | POST `content/mutate` |
| `contentCancel` / `server_content_cancel` | POST `content/cancel` |
| `contentIdentify` / `server_content_identify` | POST `content/identify` |
| `contentDependencies` / `server_content_dependencies` | Native-only shared dependency resolver preview |
| `customJarPlan` / `server_custom_jar_plan` | POST `software/custom-jar/plan`, or `software/restore-managed/plan` for null path |
| `customJarApply` / `server_custom_jar_apply` | POST `software/custom-jar/apply` |

Agent paths are under `/api/v3/manage/`. IPC DTOs use camelCase. Sizes and validators
remain decimal strings / SHA-256. A provider reference is only
`{provider,projectId,versionId}`; install requests add `kind: mod|plugin|datapack`.
No caller-supplied URL/digest is used to authenticate provider downloads.

Main types: `ServerContentInventory`, `ServerContentEntry`, `ContentCapabilities`,
`ContentProvider`, `ContentDeclared`, `ContentPending`, `ContentInstallRequest`,
`ContentMutation`, `ContentChange`, `ServerDependencyPreview`, `ServerDependency`,
`CustomJarPlan`. `SoftwareLaunch.customJar` reports `{path}`; software job kinds
include `custom_jar` and `restore_managed`.

## Resources behavior

- Render groups by `kind`, including unknown-provider/unknown-metadata rows.
  Nullable identity/loader/version/side are unknown, not incompatible.
- Show `pending`, `pendingId`, `pendingError` independently of actual enabled
  state and provider version. Install/update/remove/enable/disable while running
  remain staged until the next start/restart. Never promise a hot reload or
  implicitly restart. Refresh inventory after mutations and lifecycle changes.
- Use the returned capability flags and software support flags, plus current
  server access/role state. These are UI hints; the server rechecks exact scopes.
  Unknown/custom software has no inferred loader. Never use the client pack loader
  as the server's loader. Incompatible installs report `content_mods_unsupported`
  or `content_plugins_unsupported` in `ServerCommandError.reason`.
- JAR toggles rename `.jar`/`.jar.disabled`. Datapack toggles reuse
  `worldDatapackOffline` or `worldDatapackToggle` with `file/<filename>` from the
  world details, its revision or current generation. Gate on
  `datapackToggleOffline` / `datapackToggleRunning`. Saved datapack state can lag
  a running Minecraft command. Do not call `contentMutate` for datapack toggles.
- Removal/update retains ordinary files in existing file trash. Folder datapack
  removal returns `trashPath`, a journaled retained directory under `content-trash/`.
  It can be restored through an authorized SFTP directory rename; it is not an
  ordinary single-file trash entry and is not automatically purged.
- Cancellation is for unstarted queued work. A current owner can also cancel
  another actor's queue entry. Started/uncertain effects cannot be cancelled.
- `sha256 === null` means a bounded inventory scan did not fingerprint the whole
  item; avoid constructing a destructive request with a guessed validator.
- Identification is explicit/optional, one bounded JAR lookup. Show a quiet
  unknown-provider state on failure. Listing has no provider network work.

## Browse and dependency preview

`ResourceType` includes `plugin`. `pluginLoaderIds` and `loadersForType` expose
Paper/Spigot/Bukkit/Purpur/Folia without changing the client instance loader list.
Modrinth plugin projects and CurseForge Bukkit class 5 are mapped natively.
Client-instance installation refuses plugins. Folia compatibility requires explicit
Folia support; Paper/Bukkit compatibility is not assumed for Folia.

`environment` preserves existing client/server booleans and adds nullable
`client_requirement` / `server_requirement`: `required|optional|unsupported`.
Unknown stays unknown. `defaultServerInstallDestination` supplies a smart
server/modpack/both default; allow the user to override it. Pack-draft install is
Stage 2, so these resource commands implement the server destination only.

Call `contentDependencies(connectionId, provider, projectId, versionId)` before
the install dialog. Native fetches the authoritative inventory, managed server
Minecraft version and software, then calls `ResourceManager`'s same traversal
used by instance installs. It returns the root project/version, target snapshot,
dependency rows and warnings. Required rows start selected; optional rows start
unselected; already-installed exact provider versions are identified. Present
the root and selected dependencies, then call `contentInstall` separately with
each chosen provider version and a fresh durable intent ID. There is no agent-side
dependency resolver or atomic multi-resource install transaction.

## Custom launch

Owner-only Software action: choose an existing game-relative JAR via server file
listing, prepare with the software revision, show manifest Main-Class and risks,
then confirm via `customJarApply`. Tokens stay native. Activation requires stopped
Minecraft; Java selection and JVM flags continue to apply. Show customJar.path
instead of claiming a managed family. "Restore managed software" prepares with
null path and confirms through the same apply method. Poll existing software jobs
and refresh software status after completion.

## Fixtures and page-owned integration

`fixtures-content.ts` exports isolated `seedContentInventory('fabric'|'paper'|'vanilla')`
scenarios: identified Fabric mod, unidentified JARs, disabled JAR, pending install,
pending remove, Bukkit plugins, pending update, and a world datapack. The regular
fixture API uses Paper for Riverside, vanilla for Build team, Fabric for Friends
modded, and follows fixture software changes. Dynamic staged changes persist
through a stop and apply when a new generation is observed. `fixtures-hosting.ts`
also implements custom selection/managed restore plans and software jobs.

The expanded union exposes two exhaustive page label maps that the UI agent must
extend (this implementation is forbidden from editing `src/pages/**`):

- `src/pages/browse/toolbar.tsx`: add `plugin: 'browse.type-plugin'` to the resource-type map.
- `src/pages/browse/project/project-shared.tsx`: add `plugin: 'browse.kind-plugin'` to the kind map.

The Fluent labels and typed IDs are already supplied. These are the only TypeScript
errors produced by the backend contract expansion at handoff.

## Validation notes

- Agent control library: 1,015 passed / two ignored in the full serial run;
  the final content/metadata suite passed 36 tests, and the updated staging/cancel
  regression also passed separately. Custom-JAR selection/restoration passed.
- Agent touched-crate clippy (`vesta-control`, `vesta-transport`,
  `vesta-supervisor`, all targets, `-D warnings`) passed.
- Supervisor suites passed 23 unit and 21 integration tests; the new durable
  barrier/disconnected-client regression passed separately. Transport unit tests
  passed 47 tests; HTTPS passed 117 tests and exposed one pre-body capability
  admission regression, which was fixed and passed its targeted rerun.
- Native client tests and all-target clippy with `-D warnings` passed.
  `cargo check -p vesta-launcher` passed with existing unrelated warnings.
- Full requested Bun selection: 355 passed, one console `HOT_SCOPE_TIME`
  performance-budget failure. The console recovery/reactivity selection passes
  alone; new content/plugin checks and localization checks pass. The full-run
  diagnostic threshold was not weakened or suppressed.
- Typecheck requires the two page map entries listed above; no page files were edited.
- Extra provider Rust tests compiled, but the launcher test executable could not
  start on this Windows environment (`STATUS_ENTRYPOINT_NOT_FOUND`). This does
  not affect the passing native-client tests or launcher cargo check.
