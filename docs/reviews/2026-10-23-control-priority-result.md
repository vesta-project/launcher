# Bounded urgent control admission — 2026-10-23

Implemented in the shared `feat/frontend-rewrite` checkout; no commits or worktrees.

Files owned/changed:
- `crates/vesta-server-client/src/scheduler.rs`
- `crates/vesta-server-client/src/transport.rs`
- `crates/vesta-server-client/tests/scheduler_concurrency.rs`
- `crates/vesta-server-client/tests/transport_priority.rs` (new)
- This findings document.

Admission and classification:
- Exact POST allowlist: `/api/v3/manage/lifecycle/{stop,kill,restart}` and `/api/v3/auth/session[/challenge]`. Pairing, start, all GETs, unknown methods/routes, suffixes and query variants remain ordinary.
- Hard request caps remain 3/origin and 12/process. Ordinary foreground/background share 2/origin and 10/process; urgent has 1/origin and 2/process. Capacity is partitioned, not borrowed: slow reads cannot occupy the last origin slot, and urgent floods cannot consume ordinary capacity. This deliberately reduces idle ordinary throughput rather than pretending extra concurrency solves overload.
- Background retains fail-fast 2/origin and 8/process caps. Bulk remains independent at 1/origin and 2/process. Legacy boolean APIs/signatures remain; `true` is ordinary foreground, not authority to claim urgent priority. The old ability to occupy three slots with ordinary `admit(true)` calls is intentionally removed.
- Foreground has at most 8 waiting admissions/origin, urgent 2; both have a five-second deadline. Local lane semaphores are FIFO and cancellation-safe. Global contention is bounded best-effort retry, backing off from 20 to 100 ms only while contended. Background still has no queue; it can be refused by sustained foreground load, but urgent traffic cannot starve its lane. There is no global FIFO guarantee or preemption.
- No new production tasks/spawns. Existing transport GET coalescing retains its 128-entry bound. Scheduler waiters consume no tokens before admission; global and origin capacity is released before token waits. Urgent traffic shares the existing anonymous 40/min or authenticated 240/min origin bucket, remote pause, TLS pinning and authorization semantics. Auth classification supplies capacity only, not a session or permission. No new mutation retries.

Validation:
- `cargo test -p vesta-server-client --test scheduler_concurrency --test management`: PASS, 9 scheduler + 12 management tests.
- `cargo test -p vesta-server-client --test transport_priority`: PASS. TLS fixture holds two foreground GETs and proves stop and both session-auth POSTs progress; remote 503 retains Retry-After, remote 429 pauses subsequent urgent admission.
- `cargo test -p vesta-server-client --test scheduler_concurrency --test https --test management --lib`: library 13/13 PASS; HTTPS 22/23 PASS, then Cargo stops on the failure described below.
- `cargo clippy -p vesta-server-client --all-targets -- -D warnings`: PASS (including the new TLS test).
- `git diff --check` for assigned tracked Rust files: PASS.

Parent integration item: `tests/https.rs::concurrent_settings_style_control_and_properties_reads_wait_for_inflight_work` explicitly collects three `scheduler.admit(true).unwrap()` permits at line 530. The third now correctly fails because ordinary capacity is two. Change that fixture's `(0..3)` to `(0..2)` (and its comment to “ordinary slots”), then rerun HTTPS. Left untouched because the assigned test ownership was scheduler_concurrency.rs/new dedicated tests. All other HTTPS scenarios passed, including trust refusal, session renewal, remote guidance, cancellation and bulk/control isolation.

Remaining server-side gap (inspection only, no edits): in `V:/server-connections-mvp/crates/vesta-transport/src/lib.rs`, `WORKERS = 2`; `BlockingJobs` uses two permits, 32 waiters, and a 500 ms wait timeout. Bearer session live-identity validation in `handle` uses `state.jobs.run`. In `src/routes.rs`, ordinary dispatch including expensive reads, lifecycle and auth uses the same `state.jobs.execute_for`; only content install selects `install_jobs`. Realtime/install have separate pools, but lifecycle/auth has no reserved HTTP blocking worker. Two expensive reads can therefore delay/refuse controls on the server even though the client now sends them promptly. This requires separately scoped server admission work; client priority cannot bypass it or server rate limits.
