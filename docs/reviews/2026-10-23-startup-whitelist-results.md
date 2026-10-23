# Startup whitelist desired membership

Implemented the agreed behavior: show an accepted addition/removal in the existing list without a pending badge; cancel opposite changes before dispatch; reconcile ordered inverse changes after dispatch. Fully stopped edits keep the existing recoverable file path. Running/starting whitelist changes share a durable agent coordinator to prevent ready-server edits from overtaking pending startup work.

## What changed

The agent journals generation-bound desired membership and immutable request receipts before acknowledging it. It does not modify Minecraft's file during startup. On matching-generation readiness it admits typed moderation commands through the existing policy/idempotency/native guards. A durable pre-admission marker and stable operation key recover a lost receipt without writing stdin twice. Current-generation desires overlay the file-backed whitelist read; terminal failure removes that overlay.

After the command's stdin acknowledgment, the coordinator checks fresh file membership by resolved UUID (and name absence for removals). It allows twenty seconds for persistence after observing delivery. It does not treat delivery alone, a missing operation, or a replacement generation as verified application. File confirmation establishes persisted membership; it cannot certify arbitrary plugins, identity proxies or client admission. The earlier real vanilla 26.3 test found profile-casing behavior that can produce a different UUID in offline mode; such a mismatch fails verification rather than silently succeeding.

The existing host loop processes at most four of 32 desires per tick, with per-player ordering and rotating windows. It shares one bounded file read within a tick and performs no feature-specific disk/SQLite work when empty. No agent thread or long-held lifecycle lock was added. Portable recovery excludes these runtime intents.

The launcher retains uncertain intent/generation bindings, watches exact receipt IDs in batches of up to 32, backs off unchanged work, invalidates list caches on terminal outcomes and delivers a coalesced change event. Failed/unknown results create patient notifications. There are no new badges, dialogs or settings. The native observer shares the existing 32-task registry; at saturation the agent still completes durable work and native observation can resume later.

## Validation

- Seven owned inert-process lifecycle tests pass: pre-dispatch cancellation, immediate projection, readiness deferral, file confirmation, admission-receipt crash recovery without duplicate commands, ordered inverse edits, timeout rollback, current-authority revocation, Stop independence/generation expiry and queue capacity.
- New real HTTPS fixture test passes for projected membership, unchanged file during startup, cancellation, receipt replay, exact receipt selection, unknown IDs and malformed selection refusal. This fixture does not run Minecraft.
- Recovery export/import regression passes, excluding runtime state and refusing forged imports.
- Client library 14 and management HTTPS 15 tests pass, including new generation/receipt/uncertainty validation and the list-change event wire tag. All-target client Clippy passes.
- Frontend fixture/model/manage/files checks: 82 pass. Typecheck passes. Lint passes via `bun --bun run lint` with existing warnings.
- Agent control/transport/state all-target strict Clippy passes. Native integrated compilation passes with incremental compilation disabled, with existing warnings.
- Added an IPC coalescing regression, but its native test executable could not be rebuilt: rustc-LLVM failed with “no space on device.” Automatic approval review rejected deletion of two disposable launcher compilation-cache directories, returning only “blocked by policy.” No deletion occurred. That new IPC test remains unexecuted; this is a validation limitation, not a test pass.

During implementation an initial lifecycle test exposed the short gap between process publication and readiness publication; admission now accepts a proven live generation during that gap while dispatch still waits for its own readiness. An initial test build also had a missing enum import and a fixture-only UUID crate reference; those were corrected. No production bounds or permissions were relaxed to get tests passing.

No development agent, Minecraft server or launcher was restarted. The prior standalone vanilla 26.3 test establishes whitelist loading/save behavior, but this entire desired-state path has not yet been exercised against a live Minecraft process or UI session. Rebuild both sides for that acceptance pass.

Agent API and detailed limits: `server-connections-mvp/docs/operations/queued-whitelist.md`.
