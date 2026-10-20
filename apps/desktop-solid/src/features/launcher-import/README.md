Launcher Import owns discovery, candidate mapping/cache and serialized task enqueueing.
The Create import page and onboarding consume this module; the Rust host owns record
creation, name allocation, copying, notifications and activity task execution.

- `detectedLaunchers()` is a reactive cached accessor, initially undefined.
- `refreshLaunchers()` refreshes discovery and invalidates candidate scans. Concurrent
  refreshes join one request; errors reject and retain the previous discovery result.
- `loadCandidates(launcher, basePathOverride?)` caches by launcher and trimmed root,
  joining in-flight scans. Failed reads are retried. `raw` is the unchanged host payload.
- `detectedLauncherPaths(launcher)` retains all roots for the existing Create picker.
- `importMany(launcher, candidates, basePathOverride?)` returns enqueue successes and
  per-candidate failures. All batches share a serial enqueue queue. It does not navigate
  or wait for copying; later task failures appear through the host activity system.
  It attempts every selection, including candidates marked already imported. Cached
  scans are invalidated after a batch so subsequent reads refresh persisted origins.

`alreadyImported` compares exact `importLauncherKind` and `importInstancePath` from
`list_instances`; it describes an existing import record, including pending/failed
imports, rather than completed copying. No filesystem canonicalization is attempted.
External changes become visible after `refreshLaunchers()`.

The host `import_external_instance` creates a record, submits an
`ImportExternalInstanceTask` (`LauncherImport` activity), then returns its instance ID.
The task has a unique per-instance ID and uses the task manager's worker limit; it
does not override the default empty conflict keys. Serial frontend enqueueing avoids
overlapping name allocation within this module. Other host writers are outside this
queue. The host appends ` (2)`, ` (3)`, etc. to case-insensitive name collisions and
allocates a unique directory slug against database entries and disk paths. A failed
task submission can leave its already-created record behind; enqueue errors are
reported without automatic retry to avoid duplicating such records.

Non-Tauri calls use two launcher fixtures, eight candidates, and one pre-existing
import. Fixture imports update an in-memory origin list without filesystem activity.
Onboarding's `importMany` authorizes, queues, and sets `chosen()` with the queued count;
it leaves advancement/navigation to its caller. `importFrom` preserves the old route
handoff for the current welcome UI.
