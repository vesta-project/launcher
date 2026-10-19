# Activity data layer

No UI is included. Import the public API from `features/activity`. The existing
`platform/desktop.startDesktop()` owns the ref-counted native subscription and cleanup.
Do not register another listener in the titlebar.

## UI contract

Types are defined in `activity-model.ts`:

- `ActivityKind = 'task' | 'background'`
- `ActivityState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'`
- `Activity`: id, kind, state, title, optional subtitle/icon/iconFallback,
  optional progress (0–1; undefined means indeterminate), optional weight
  (remaining work estimate), optional step/currentStep/totalSteps, startedAt,
  optional finishedAt/error, cancellable, optional target `{ instanceId?, route? }`,
  optional action `'play' | 'open'`, optional seen/pillDismissed.
- `ActivityPatch`: partial Activity with required id.
- `PillState`: discriminated by `state`:
  - idle: no additional data
  - quiet: `activities`
  - running: `activities`, `count`, `icons` (up to three Activity records),
    `extraCount`, optional `progress`
  - success/failed: `activity` (includes action and target)
- `UpdaterState`: idle (optional error), available (version, optional error),
  downloading (version, optional progress), ready (version, optional error).
- `HostNotification`: host's snake_case inbox row, including read and actions.

Reactive accessors:

```ts
activities(): readonly Activity[]
visibleTasks(): readonly Activity[]
backgroundActivities(): readonly Activity[]
overallProgress(): number | undefined
pillState(): PillState
activityError(): string | undefined
updaterState(): UpdaterState
notifications.list(): readonly HostNotification[]
notifications.unreadCount(): number
```

Commands:

```ts
cancelActivity(id: string): Promise<void>
dismissActivity(id: string): void
clearFinished(): void
markSeen(ids?: readonly string[]): void
checkForUpdates(): Promise<void>
downloadUpdate(): Promise<void>
restartToUpdate(): Promise<void>
notifications.markRead(id: string): Promise<void>
notifications.dismiss(id: string): Promise<void>
notificationKey(row: HostNotification): string
```

Use `notificationKey(row)` for inbox commands. Host client keys take precedence over
numeric ids. Cancellation waits for the host's terminal event; it never fabricates
completion. Rejections are exposed through activityError and rethrown to callers.
Updater command failures are on updaterState.error and rethrown; check failures are
represented in updaterState without rejecting. The legacy Settings updateStatus
accessor remains supported by the same updater owner.

`dismissActivity` suppresses pill presence and marks a failure seen; the panel row
remains. `markSeen()` acknowledges all existing failures; pass only displayed IDs
when the panel shows a subset. Opening a panel should acknowledge its displayed
failures. `clearFinished` explicitly removes all terminal rows, including failures.
Success expires from the pill 6000ms after completion, independently of panel history.
Quiet work appears after 1500ms of running (queue time does not count). Cancelled work
has no success flash. Running work takes pill priority, then unseen failures, then
recent task success, then quiet work. Unseen background failures also get attention.

Overall progress uses `sum(progress * remainingWeight) / sum(remainingWeight)` over
active foreground tasks. Unknown progress makes the aggregate indeterminate. Known
step counts estimate remaining weight as max(1, total-current); unknown weights use
one unit. These are estimates across heterogeneous operations, not byte-accurate
predictions. Installer tasks now provide `overallProgress` separately from their stage-local
`progress`. The panel bar and pill use that overall estimate; stage text carries item or byte
counts, with no second percentage reading. The Ledger prevents overall regressions within
one task attempt, and only authoritative completion reaches 100%. Pipeline ranges compose
nested runtime/modpack work; download ranges publish only changed integer estimates. Older
producers without an overall value retain their existing progress behavior. Native activity
recovery uses TaskManager snapshots with both values, never persisted progress notifications.
The Clear finished action appears only when displayed terminal rows can actually be removed.

The adapter batches progress per id for 100ms, immediately publishes lifecycle events,
and uses boundary timers (no polling loop) for quiet/success visibility. Memo equality
avoids publishing unchanged selections. History retains 50 terminal rows **plus**
unseen failures; active work and unacknowledged failures are never evicted.
Nothing in this feature writes localStorage or caches operation results/credentials.

## Producer API

`receiveActivity(patch, coalesce?)` supports future native or client producers.
`runBackgroundActivity<T>(localizedTitle, work): Promise<T>` wraps a client-side
operation, rethrows failures, and stores only lifecycle metadata. Call it inside a
request-cache loader so cache hits and joined requests do not create duplicate work.
Java inventory and Minecraft version metadata use this wrapper.

## Fixtures

Browser development only; Tauri and production calls are inert. No fixture starts
automatically. From a browser devtools console on the Vite app:

```js
const { simulateActivity } = await import('/src/features/activity/activity-fixtures.ts');
const stop = simulateActivity('multiple');
// stop() clears simulation timers. clearFinished() is independent.
```

Scenarios: `single`, `multiple` (five installs), `background` (crosses threshold),
`success` (Play action and six-second expiry), `failure`, `update-ready`.
A new scenario replaces the previous fixture history; call the previous `stop()`
before starting the next one. Fixture actions point at synthetic instance IDs;
render these actions but do not invoke native launch for those IDs.

## Progress-source map

- `tasks/installers/mod.rs`: InstallInstanceTask, Minecraft/runtime preparation,
  embedded Java, loader/libraries/assets downloads. TauriProgressReporter funnels
  phase text, percentages and counts through TaskContext. Success action: Play.
- `tasks/installers/modpack.rs`: InstallModpackTask, pack fetch/extraction, resources,
  runtime install and finalization. Uses TaskContext; success action: Play.
- `tasks/installers/java.rs`: DownloadJavaTask, managed Java downloads. Uses
  TaskProgressReporter → TaskContext; java-paths-updated invalidates inventory.
- `tasks/installers/external_import.rs`: ImportExternalInstanceTask, copy/import,
  reconciliation/runtime install. `external_import_resync.rs`: ImportResourceResyncTask.
  TaskContext progress; external import completion action: Play.
- `tasks/maintenance.rs`: CloneInstanceTask, ResetInstanceTask, RepairInstanceTask,
  DeleteInstanceTask. TaskContext progress and instance lifecycle invalidations.
- `tasks/resource_download.rs`: ResourceDownloadTask, instance/world mods, packs,
  shaders, datapacks, world downloads, including resource updates. TaskContext plus
  resource-install-error and Ledger row-change invalidations. Target instance and Open
  action are now explicit in activity events, including world installs.
- `tasks/update_modpack.rs`: UpdateModpackTask, readiness waiting for game exit,
  plan/stage/merge/runtime/finalization. TaskContext progress; preserves queued state
  during readiness and worker waiting.
- `tasks/modpack_export.rs`: ModpackExportTask; `tasks/world_transfer.rs`:
  WorldTransferTask. TaskContext progress/cancellation.
- `tasks/manifest.rs`: GenerateManifestTask/forced refresh. Background activity.
- `tasks/sync_profiles.rs`: SyncAccountProfilesTask. Background TaskContext profile-sync progress.
- `tasks/resource_reconciliation.rs`: ResourceEnrichmentTask. Suppresses notifications;
  now visible as quiet background work through dedicated activity events.
- `commands/resources.rs::rescan_instance_resources`: private Channel<ProgressUpdate>
  Step/Progress/StepCount/Finished; not submitted to TaskManager. The rewrite currently
  has no caller of this command. See remaining host work below.
- Rewrite `settings/resources.ts`: Java detection/inventory checks; wrapped quiet work.
  Rewrite `instances/metadata.ts`: cached version metadata fetch; wrapped quiet work.
- Rewrite `browse/browse-api.ts::onInstallEvents` consumes
  core://instance-resource-rows-changed and resource-install-error, which invalidate
  installed rows rather than carrying numerical progress. `new-instance-install.ts`
  and `instances/native-service.ts` consume notification and instance lifecycle events
  to reconcile creation/failures; they retain that domain responsibility.
- Launcher self-update: startup/updates.rs emits core://check-for-updates; the shared
  rewrite settings/updates.ts now retains plugin Update, downloads through plugin
  progress callbacks, installs then invokes existing restart_app action. Separate
  updaterState; never fed into activities. Download/install action events are wired.
- Legacy `src/utils/notifications.ts`, notification store and `src/utils/updater.ts`
  mix progress into notifications. New inbox filters progress and updater notifications;
  it hydrates list_notifications and follows notification/notification-progress plus
  notification-updated (read/deleted/cleared_all). Failures remain inbox items.

## Host contract and remaining gaps

Added without command registration changes:

- `core://activity-state`: epoch, revision and one full native activity row, emitted from
  the same in-memory owner as `get_activity_snapshot`. The rewrite consumes this stream;
  progress notifications remain inbox-only. Initial load and window focus fetch a snapshot,
  sharing in-flight requests; no progress polling or disk mirror.
- `core://activity`: legacy id and partial state; queued includes title, kind, cancellable,
  context, target, action, initial step and totalSteps. Terminal events explicitly
  report done/failed/cancelled and error, independently of notification deletion.
- `core://activity-progress`: id, optional overallProgress estimate, and optional percent (host 0–100, -1 unknown), step,
  title, currentStep and totalSteps. TaskContext emits even for silent tasks.
- Task trait policies: activity_kind, activity_instance_id, completion_action.
  Instance icons/version subtitles use the already-loaded rewrite catalog; resource
  icons use existing NotificationContext.iconUrl. Missing images have a fallback.

Still needed for richer/fully recoverable telemetry:

1. TaskManager snapshot recovery is implemented: `get_activity_snapshot` and
   `core://activity-state` share a backend epoch and revisions. Full rows preserve state,
   timestamps, overall/local progress, attempt, counters, target/action and context. The
   frontend subscribes before hydration, rejects stale rows, compacts revisions on focus,
   and retires vanished active rows without touching client-owned work or finished history.
   Retrying the same logical ID uses a new attempt; old reporter callbacks are ignored.
   Native terminal history is capped at 50; active work is never evicted. This is recovery
   of the running backend's presentation, not persistent execution/restart of Tasks.
2. Rescan should emit these same lifecycle/progress events (including error exits), or
   its future rewrite caller should bridge its private Channel into receiveActivity.
   Do not infer success from resource-row changes or notification deletion.
3. Structured progress is implemented below. Existing producer estimates remain coarse;
   unknown totals stay omitted rather than inventing byte totals.
4. Include an image URL and version subtitle in task presentation metadata for icons
   even before the instance catalog loads. Currently these are best-effort enrichment.
5. Other host Java discovery/metadata callers and ordinary resource-watcher scans have
   no global lifecycle telemetry. Only the wrapped rewrite calls and TaskManager
   enrichment/manifests are represented; add quiet producer events at those boundaries.
6. Known host kinds use the structured Fluent formatter below. Legacy and unknown
   kinds preserve host title/subtitle/step text for compatibility.

## Structured naming and progress contract

TaskManager owns the native contract in `tasks/activity.rs` and the epoch/revision
snapshot. Producers declare `ActivityKind` explicitly; no kind or stage is inferred
from English strings. Legacy `title`, `step`, `progress`, `currentStep`, `totalSteps`,
context, notification descriptions and private progress channels remain available.

Full native rows carry:

- `kind`: `instance_install`, `modpack_install`, `modpack_update`, `modpack_export`,
  `resource_install`, `java_download`, `launcher_import`, `import_resync`,
  `resource_enrichment`, `manifest_refresh`, `profile_sync`, `instance_duplicate`,
  `instance_reset`, `instance_repair`, `instance_delete`, `world_transfer`, `drop_apply`.
  Generic/test tasks retain `task`. Client-only legacy `task`/`background` also work.
- `subject`: `{ id, name, iconUrl?, instanceId? }`. Missing database labels are
  resolved once at queue time, before deletion. Resource subjects keep project identity
  and target instance. Java uses the major version. Export has an explicit instance ID.
- Duplicate `subject` is the target (ID absent until created), with separate `source`.
  Its requested/unique name updates before copying; creation updates subject and route
  to the new instance. It never navigates to the source as its completion target.
- World transfer uses `mode: copy|move` (same-instance duplicate is copy), a world
  subject, and `source`/`destination` instance subjects. Routes target the destination.
- `stage`: stable snake_case keys, scoped by kind. Runtime stages include
  `loading_metadata`, `downloading_client`, `downloading_libraries`,
  `downloading_assets`, `running_processors`, `installing_java`, `verifying`,
  `finalizing`. Archive/resource workflows use `analyzing`, `extracting`,
  `downloading_resources`, `copying_files`, `reconciling`, `matching_resources`,
  `saving_records`. Maintenance uses `locating_files`, `removing_files`,
  `removing_records`, `stopping_watcher`; updates can use `waiting_for_exit`.
  Other stable keys are `preparing`, `installing`, `downloading`, `applying`,
  `exporting`, `syncing_profiles`. Stage changes clear old counters and filenames.
- `items: { done, total? }` and `bytes: { done, total? }` are independent counters.
  Legacy step counts remain logical workflow steps and are not promoted to item
  counts. Only actual producer item counters enter `items`; byte percent never becomes an item count. Resource bytes describe the current artifact; items count completed artifacts.
  Profile sync uses the account count from initialization onward.
- `overall`: integer 0..100, mirrored by legacy `overallProgress`. Whole-task
  estimates are monotonic within an attempt, clamped to 99 while active, and reach
  100 only on successful completion. Stage-local `progress` may restart. Nested
  repair/reset installs map into a TaskContext range; piston ProgressRange composes
  runtime/modpack estimates. A retry resets overall; stale attempt callbacks are ignored.
- `visibility: foreground|background`: explicit policy independent of notification
  silence. Import resync, resource enrichment, manifest refresh and profile sync are
  background. User-started installs, maintenance actions, exports, transfers and
  dropped-resource apply are foreground, including notification-silent drop tasks.
- Optional `fileName` is a basename for the panel only, with ellipsis/overflow tooltip.
  Structured title/step text excludes paths and usernames.

`activity-text.ts` is a pure formatter supplied the current Fluent translator/locale.
`activity-sync.ts` normalizes native overall percentages and formats known kinds from
`locales/en/activity.ftl`/`messages.ts`. Unknown kinds alone fall back to legacy copy.
Unknown stage keys show the localized generic working label. Byte text uses decimal
SI units and localized number formatting; bytes take precedence when both counters
exist. Example: `Downloading libraries · 47/112` or `Downloading · 12 MB / 38 MB`.
The bar is the sole progress percentage; step text never repeats it. Quiet idle faces
retain their spinner and never borrow a successful completion check mark.

Checks: `checks/activity-text.test.js` covers all production kinds, unknown/legacy
fallback, subjects/modes, byte and item units, visibility and monotonic/retry behavior.
Rust activity contract tests cover snapshot counter resets, completion clamps and stale
attempt rejection. These are non-visual tests; real installation runs remain manual.
