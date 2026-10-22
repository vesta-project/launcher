# Launcher server integration review — 2026-10-22

Baseline: `24fb0eeb`. Scope: server client, Tauri server integration, and desktop server UI paths requested. Source-only review; no tests or production changes were made. The previously noted identity memoization and serialized interactive admission behavior were treated as fixed and are not repeated here.

## Findings

### 1. Picked upload files can stay staged for the rest of the app process

- **Trigger:** A user picks files, uploads or abandons them, and then leaves the launcher open without starting another upload/pick operation. Each candidate can be 16 MiB; the candidate table permits 64 entries.
- **Evidence:** [`transfers.rs`](../../crates/vesta-server-client/src/files/transfers.rs:43) copies every picked file to a `NamedTempFile`; pruning only occurs during a later `pick` at line 88 and a later `begin` at line 123. `finish` and `abort` leave the candidate/upload entries intact (lines 263–307). There is no timer cleanup path in this transfer manager. Thus up to roughly 1 GiB of staged file data can remain in temp storage, and idle entries are not released until another operation prunes them or the process exits.
- **Impact / confidence:** Local disk exhaustion is plausible after repeated large uploads or abandoned picks; **high confidence** from the bounded capacities and cleanup paths.
- **Minimal fix:** Add explicit lifecycle cleanup for terminal uploads and expired candidates, plus a periodic/triggered sweep that runs without requiring another picker action. Preserve enough state briefly for safe retry after an uncertain finish response.
- **Regression idea:** Fill the candidate table with maximum-size staged files, complete/abort them, then verify staged bytes and map entries are reclaimed on the documented cleanup deadline even when no subsequent picker/begin call occurs.

### 2. A transient run-history error silently stops automatic polling

- **Trigger:** The Run List contains a queued/running run, then one poll fails due to a flaky network or temporary server pressure.
- **Evidence:** [`automation-runs.tsx`](../../apps/desktop-solid/src/pages/servers/tabs/automation-runs.tsx:36) clears the existing timer before each load. It schedules the next poll only after a successful response containing active runs (line 46); the catch at line 47 displays an error but schedules no retry. The list therefore stops following active runs until the user manually reloads or another parent refresh occurs.
- **Impact / confidence:** Active run state can remain stale indefinitely after one intermittent failure; **high confidence** from control flow.
- **Minimal fix:** Re-arm a bounded retry after transient errors while active runs are still known, with backoff/jitter and disposal cleanup; stop for terminal/auth/unsupported errors.
- **Regression idea:** Return active runs, fail one subsequent poll with a temporary network error, then recover and verify another poll updates the run without user input.

### 3. Run detail refreshes can apply out of order

- **Trigger:** A run changes state/current step while its detail and paginated attempts are loading; the effect starts another load, and the older request finishes last.
- **Evidence:** [`automation-runs.tsx`](../../apps/desktop-solid/src/pages/servers/tabs/automation-runs.tsx:116) captures the run ID, fetches the run and attempts in parallel, then unconditionally writes detail at line 124. The reactive effect at line 127 can start another load for updated run state, but there is no request sequence or current-props check. An earlier snapshot can overwrite the newer detail and remain displayed until another effect/load.
- **Impact / confidence:** Users can see stale step state or attempt output after a newer response; **medium confidence** (requires overlapping loads and out-of-order completion).
- **Minimal fix:** Guard each load with a monotonically increasing request ID, and only publish the latest result; optionally clear or mark the existing detail as refreshing when the run key changes.
- **Regression idea:** Delay the first run/attempt response, let a second refresh complete with newer progress, then release the first and verify the newer detail remains visible.

### 4. Started downloads have no cancellation path

- **Trigger:** A user starts a large download over a slow or failing link and then wants to stop it after the save dialog closes or navigates away from the Files page.
- **Evidence:** [`server_files.rs`](../../vesta-launcher/src-tauri/src/commands/server_files.rs:267) runs the transfer inline until completion; [`transfers.rs`](../../crates/vesta-server-client/src/files/transfers.rs:340) loops through streamed/resumed chunks with a one-hour request deadline and accepts no cancellation signal. The task activity is published with `cancellable: false` in `server_files.rs` around line 408, and the UI-facing `DownloadResult::Cancelled` applies only to save-dialog dismissal. Dropping the page does not cancel the Tauri invocation.
- **Impact / confidence:** A user cannot stop an unwanted transfer without exiting the launcher; a slow transfer can occupy the bulk slot and write to a staging file for a long time. **High confidence** from the command and client signatures.
- **Minimal fix:** Give downloads an owner-scoped transfer handle and cancellation command/token; ensure cancellation drops the response/permits and removes the staged file while leaving any existing destination intact.
- **Regression idea:** Cancel midway through a streamed response and verify the task ends as cancelled, the destination is unchanged, temporary bytes are removed, and another bulk transfer can start immediately.

## Second pass — connection lifecycle, persistence, and credential handling

### 5. A temporary client/vault failure can permanently stop an existing subscription worker

- **Trigger:** The OS credential vault is temporarily unavailable when a server topic worker first starts (or another transient error prevents `client()` construction), then becomes available while the same window remains subscribed.
- **Evidence:** [`worker.rs`](../../vesta-launcher/src-tauri/src/servers/worker.rs:100) handles any `client()` error by attempting one refresh and then breaking out of the worker loop. [`mod.rs`](../../vesta-launcher/src-tauri/src/servers/mod.rs:900) restarts a finished worker only from `ensure_worker`, which is called when a new subscription is added (line 897); existing subscribers do not trigger another ensure. A later manual refresh can recover the snapshot but does not restart the stream worker.
- **Impact / confidence:** Existing windows can remain subscribed with no live status/console/metrics updates after a recoverable credential-vault outage, until they unsubscribe and resubscribe; **high confidence** from the exit/restart paths.
- **Minimal fix:** Retry transient credential/client construction errors with bounded backoff inside the worker, or add a demand-aware supervisor that restarts a finished worker while subscriptions remain. Keep permanent access/trust failures visibly blocked.
- **Regression idea:** Make the first client construction fail with a recoverable credential error, restore the credential service without changing subscriptions, and verify the worker reconnects and emits an update.

### 6. The durable intent journal has a hard lifetime cap with no terminal-entry compaction

- **Trigger:** A profile accumulates 4,096 distinct accepted management operations over time, even though the old operations have all reached terminal states.
- **Evidence:** [`store.rs`](../../vesta-launcher/src-tauri/src/servers/store.rs:193) refuses new intents once the profile-wide vector reaches 4,096. Terminal tracking only sets `terminal = true` in [`tasks.rs`](../../vesta-launcher/src-tauri/src/servers/tasks.rs:184); no code prunes terminal intents except removing the entire server connection. New mutations are therefore refused as `server_busy` after the lifetime cap, across all servers in the profile.
- **Impact / confidence:** A long-lived or heavily used profile eventually loses the ability to submit new mutations; **high confidence** in the cap/no-prune path, with likelihood depending on usage volume.
- **Minimal fix:** Compact terminal receipts under a documented retention/idempotency policy while preserving uncertain and active entries; expose a clear recovery path if the store is already at capacity.
- **Regression idea:** Fill the journal with terminal entries, then verify the compaction policy frees capacity without evicting an uncertain active intent or allowing an unsafe replay.

### 7. Removing a server deletes its vault key before the metadata transaction succeeds

- **Trigger:** The credential service deletes the key successfully, then the profile store cannot save the removal (for example, disk full or profile directory temporarily unwritable).
- **Evidence:** [`mod.rs`](../../vesta-launcher/src-tauri/src/servers/mod.rs:834) deletes the keyring entry at lines 836–841 before calling `edit_store` to remove the record at line 843. The store write is atomic but can fail at [`store.rs`](../../vesta-launcher/src-tauri/src/servers/store.rs:252). On that error, `remove` returns failure while the saved connection remains and its credential has already been destroyed.
- **Impact / confidence:** The UI reports removal failure but leaves a listed server that can no longer authenticate; **high confidence** in ordering, conditional on a persistence failure.
- **Minimal fix:** Make key deletion and metadata removal recoverable as a two-phase operation, such as persisting a deletion marker/removing the connection first and retrying vault cleanup separately.
- **Regression idea:** Inject a store-save failure after successful key deletion and verify the record is either recoverably removed or the key remains available; the current partial state should never be observable.
