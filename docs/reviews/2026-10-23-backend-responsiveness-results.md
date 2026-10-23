# Backend responsiveness implementation — 2026-10-23

Scope: launcher server integration and `server-connections-mvp`; no frontend redesign, live agent restart, Minecraft restart or UI worktree merge. Target host remains 1–2 cores and 2–4 GB RAM. This records implemented changes and their limits, not measured low-end hardware acceptance.

## Review decisions

1. Verify whitelist semantics before adding state or polling. Vesta's management endpoint reads `whitelist.json` afresh. Minecraft/Paper holds a `StoredUserList` map and saves it to disk; these are different observations. A successful console/moderation operation reports `stdin_written`, not proof the game applied it. Keep the existing completion-triggered cache invalidation; do not add optimistic authoritative membership or perpetual verification requests.
2. Decouple console delivery from slow observations, keeping bounded queues, explicit loss recovery and owned cancellation.
3. Share operation observations by server, retain durable unresolved intents, and request known IDs directly rather than repeatedly traversing oldest-first history.
4. Reserve urgent capacity through the client, HTTP body buffers and blocking dispatch, preserving authorization, rate limits and overall resource bounds.
5. Back off unchanged/hidden observations and reduce quiet game-driver wakeups; leave broader adaptive profiles and actual hardware benchmarking for a measured follow-up.

The second review checked cancellation/permit lifetime, escaped console sizes, stale-generation roster results, history pagination, backlog starvation, tracker idle-exit races, current authorization and upload pressure. It added exact-ID operation reads, reserved body buffers and rotating backlog windows rather than relying on a first history page or capacity at only one layer.

## Implemented

- Independent console drain/controller/socket ownership. Slow player, status and history reads cannot suspend the drain. Ingress remains 1,024 messages; each turn drains at most 64, then yields. IPC batches are at most 64 lines / 48 KiB including escaping. Local retention remains 5,000 lines / 2 MiB. Oversized content truncates safely and retains its cursor. Cursor recovery, bounded deduplication and explicit gaps survive overlap/disconnect; disposal aborts owned work. See [console implementation report](2026-10-23-console-drain-result.md).
- One active-operation coordinator per connection, at most 32 coordinators. Each observes at most 32 IDs per window, rotating a larger durable backlog. New agents support `GET /api/v3/manage/operations?ids=...` in one current-authority database snapshot, with strict maximum/duplicate/input/result validation. Older agents fall back to history plus bounded rotating detail reads. Missing evidence never means success. Terminal journal writes are batched; unchanged activity events are coalesced. Visible history polling skips while this coordinator is active.
- Observation delay starts at two seconds and backs off unchanged work to ten seconds when visible / thirty seconds when hidden, respecting retry guidance. Accepted work remains tracked after a tab closes.
- Client ordinary requests have 2/origin and 10/global slots; urgent controls/session authentication have 1/origin and 2/global. Total bounds remain 3/origin and 12/global. Closed route classification prevents arbitrary reads claiming priority. Shared token buckets, remote pauses, trust and auth still apply. See [priority report](2026-10-23-control-priority-result.md).
- Server preserves two HTTP blocking workers in total: one ordinary and one control/auth worker. Cancelled HTTP waiters do not release capacity while synchronous IO still runs. Of the existing 4 MiB aggregate request-body budget, 16 KiB is reserved for control/auth; those bodies are capped at 8 KiB each. No auth, capability, idempotency or remote rate-limit exemption was added.
- Quiet running-game driver waits increase from 5 ms to 25 ms when no operation or player/tick write is pending. Admission notifications interrupt the wait. Active work retains the 5 ms path; stopped idle waiting is unchanged. This reduces scheduled idle checks, not a demonstrated CPU percentage.
- Added a whitelist regression proving fresh disk observations and that rendering a command does not predict its effect.

## Validation

- Final client suite: 60 passed (library 14, HTTPS 23, management 13, scheduler 9, priority TLS 1).
- Server transport library: 45 passed. Runner: 41 passed with two test threads. Fresh-whitelist regression: 1 passed. Full server HTTPS suite: 111 passed with one test thread, including selected-ID reads, auth refusal, malformed selections and upload-budget reservation.
- Parallel server HTTPS runs initially failed password-authentication fixture admission (18 failures at default parallelism; five with two threads). Serialized execution passed all 111 without weakening production limits. An initial parallel runner run had one sleep/login-burst failure; isolated and subsequent two-thread runner runs passed. Parallel fixture isolation remains a testing concern.
- Console worker validation: 29 native server tests passed, one explicit live-agent test ignored, including seven new console tests. These ran before final coordinator integration; final integrated native compilation also passes. On Windows the disposable test executable required a Common-Controls v6 manifest; no repository build configuration was changed.
- Strict all-target Clippy passes for the client and agent control/transport crates. Native check passes with `CARGO_INCREMENTAL=0`; ordinary incremental compilation hit a rustc fingerprint ICE outside the changed code. Existing native warnings remain.
- Touched-file formatting and `git diff --check` verified. No real server/UI session or low-end hardware benchmark was performed.

## Remaining limits and next measurements

Finite retention cannot promise zero console loss under sustained overload. Explicit gap/truncation markers remain necessary. Non-console observations still serialize; one slow recovery GET can delay reconnect work while the live drain remains independent. More than 32 unresolved operations require multiple observation windows.

Reserved slots do not bypass exhausted local token budgets, remote rate limits, failed authentication, a dead network or a game that cannot process stdin. The ordinary server worker partition may reduce ordinary parallel throughput; measure panel/control latency under slow storage before changing the budget.

Next measure console and control p50/p95 latency, idle CPU/wakeups, memory, disk writes and request rates on 1-core/2-GB and 2-core/4-GB hosts, with latency/jitter, suspend/resume and sustained logs. Broader RTT/memory-based profiles and a unified end-to-end control deadline remain future work; no speculative automatic heap tuning was added. Recovery inspection/marker automation was not added in this pass, avoiding extra recovery work or changed startup guarantees.

Both launcher native code and agent must be rebuilt to exercise the full changes. They have not been applied to the running development server.

## Whitelist sources

- [Paper StoredUserList source patch](https://raw.githubusercontent.com/PaperMC/Paper/main/paper-server/patches/sources/net/minecraft/server/players/StoredUserList.java.patch): in-memory map, lookup and persistence.
- [Paper PlayerList source patch](https://raw.githubusercontent.com/PaperMC/Paper/main/paper-server/patches/sources/net/minecraft/server/players/PlayerList.java.patch): held whitelist instance.
- [Paper vanilla data files](https://docs.papermc.io/paper/reference/vanilla-data-files/): whitelist persistence context. Plugin/custom-server behavior can differ; disk reads alone do not establish universal running-game state.
