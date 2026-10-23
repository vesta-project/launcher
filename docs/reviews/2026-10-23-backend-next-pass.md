# Backend opportunities after the UI cleanup follow-up

Read-only code review of current launcher and Rust agent, 2026-10-23.
These are proposed changes, not new benchmark results or completed fixes.
Target remains 1–2 cores / 2–4 GB host RAM with room left for Minecraft.

## 1. Separate delivery, applied state and readiness

The operation model already carries outcomes such as `stdin_written` and
`process_exited`, plus reconciliation and independent Minecraft readiness.
Preserve those distinctions throughout command responses and activity state.

For console/moderation, a successful stdin write is weaker evidence than the
Minecraft main thread actually applying the request. Consequently the recent
completion-triggered cache invalidation removes one stale layer but an immediate
list reread can still precede Minecraft applying a whitelist/ban/operator change.

Add bounded, generation-bound read-back for structured actions with observable
targets. Retire affected native reads between observations, coalesce checks,
honor pressure guidance, and stop on authority loss or game generation change.
An expired observation deadline means “delivered; change not yet verified”, not
proof that the command failed. Arbitrary console commands remain delivery-only.
Restart completion and Minecraft readiness remain separate observations too.

Acceptance: queued operation, acknowledged stdin write, delayed list mutation,
missing acknowledgment, game restart, permission loss, and repeated same intent.
Keep durable receipts/idempotency/audit semantics intact.

## 2. Keep stream delivery independent of slow reads

`vesta-launcher/src-tauri/src/servers/worker.rs` awaits players, refresh and
operation-list requests in the same loop that drains buffered console messages.
The transport has a 15-second request timeout and a five-second connection timeout.
A slow read can therefore delay stream delivery, irrespective of Minecraft living
in another process. Larger buffers help absorb a burst but do not remove this
head-of-line wait.

Use a bounded observation coordinator and a separate stream-draining path.
Coalesce refreshes and reject stale generations/epochs when completions arrive.
Only one owned read per projection should be pending; no task-per-console-line
or unbounded background spawns. Preserve explicit console-gap recovery.

Acceptance: delay a player/list response while console lines keep arriving;
measure console delivery latency and memory bounds through disconnect and disposal.

## 3. Share active-operation observation

`servers/tasks.rs` permits up to 32 trackers and polls each accepted operation,
eventually every ten seconds. `servers/worker.rs` additionally reads the visible
operation list every ten seconds. At that tracker cap, the individual loops alone
can attempt about 192 requests/minute before list/status/other reads. This is a
calculated request pattern, not a measured normal workload. Current admission
limits can refuse/delay some of it.

Use one coordinator per server with a bounded active-ID set and durable intent
recovery. Prefer change notifications if the protocol supports them; otherwise
batch/list-poll and reconcile individual IDs that fall outside the returned page.
Start promptly after admission, then back off unchanged observations and hidden
views without abandoning accepted work. Retain uncertainty across disconnection.

Acceptance: 1/8/32 active jobs, two windows, long jobs, history pagination, reconnect,
tracker saturation and rate-limit guidance. Compare requests/job and completion lag.

## 4. Give urgent controls a distinct budget and deadline

`vesta-server-client/src/scheduler.rs` currently distinguishes interactive versus
background traffic, has three local permits, bounded interactive waiters and a
five-second admission deadline. An urgent stop shares that interactive category
with ordinary panel reads. Bulk transfers already have an independent budget.

Introduce bounded classes for control, foreground observation, prefetch and bulk;
reserve control capacity at the client and ensure server-side expensive reads
cannot occupy every control admission slot. Maintain fairness and bounded waiting.
Carry an intent deadline across admission, auth and transport rather than adding
independent waits invisibly. Client timeout must preserve admitted mutation
uncertainty; it does not cancel an already accepted remote operation.

Acceptance: Stop/Reconnect during slow panel loads, backup scans, large transfers,
expired authentication and packet loss. Measure queue wait separately from RTT,
server execution and state-verification time.

## 5. Adapt observations and wakeups to measured conditions

The agent driver sleeps five milliseconds on the running-game path; the supervisor
has 50ms polling/synchronization paths. Idle waiting already uses notifications.
Profile wakeups and native IO before changing cadence, then extend notification /
deadline-driven waiting to quiet running servers where process observation allows.
Keep prompt command delivery, process-exit handling, authorization and recovery.

Use hysteresis and bounded profiles based on observed RTT, errors, backlog and
memory pressure: reduce prefetch/telemetry/concurrent reads on weak links or small
hosts, and expand cautiously on healthy hosts. Wall-clock freshness remains
visible. Keep safety deadlines and durable state guarantees explicit. Changing
running Minecraft heap settings is outside automatic adaptation.

Acceptance: quiet and chatty servers, burst output, slow disks, latency/jitter,
suspend/resume, 1-core/2GB and 2-core/4GB. Report p50/p95 control latency, idle CPU,
RSS/private bytes, wakeups, disk writes and queue bounds. This host alone cannot
establish acceptance on actual low-end hardware.

## 6. Make recovery and stale state explain themselves

The recent marker incident required manual archive after deliberate verification.
A scoped recovery inspection command could explain the guard, show non-secret
evidence and offer an explicit recoverable archive action. Reuse per-instance
locks, PID/start-time identity and liveness proof; preserve ambiguity and all
evidence. It must never silently delete a marker or infer shutdown from a PID alone.
Separate-supervision mode can simplify agent replacement; it remains an explicit
configuration choice with a coordinated supervisor upgrade path.

Expose compact diagnostics for local admission pressure, remote rate limiting,
network failure, stale cache and unavailable game observations. Existing fixed
error codes can drive actionable messages without exposing credentials or paths.

## Recommended sequence

First clarify outcomes and add delayed-effect/slow-link regression fixtures. Then
decouple stream draining and consolidate operation tracking. Add measured control
priority/deadline handling before adaptive profiles and recovery ergonomics.
The current UI worktrees can resume independently against those stable contracts.
