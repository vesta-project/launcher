# Scale benchmark and concurrent editing â€” 2026-11-01

## Reproduction and scope

Launcher: `bun run scripts/scale-benchmark.ts` (default 12,000 names; `PLAYERS` overrides it). Agent: `cargo run -p vesta-game-runtime --release --example scale_benchmark`. Run on Windows in the supplied worktrees. These are repeatable component microbenchmarks, not a claim of 12,000 connected Minecraft clients. The Rust harness executes the real console capture, paging and roster parser. The TS harness executes merge/filter/count, the real console buffer, and console-to-log conversion. UI row counts are verified through the paging model, not browser DOM timings.

## Results

| Launcher measure | Before | After (representative rerun) |
| --- | ---: | ---: |
| Roster merge/filter/count p50, ms | 26.26 | 11.84 |
| Slowest of 12 iterations, ms | 35.21 | 21.50 |
| Entire workload wall time, ms | 338.69 | 166.07 |
| Process CPU time, ms | 515 | 312 |
| Process RSS, bytes | 117,706,752 | 94,453,760 |
| JS heap, bytes | 9,556,659 | 10,358,133 |
| Console input lines | 20,000 | 20,000 |
| Console retained entries | 5,000 | 5,000 |
| Mixed-workload console lines / wall second | 59,052 | 120,433 |
| Full roster JSON, bytes | 276,011 | 276,011 |
| Maximum Players page rows | 12,000 | 100 |

Timings vary with other builds on this shared machine. Rates divide console lines by the entire mixed workload, including roster passes; they are not network event throughput. RSS is process-level and does not imply a lower heap allocation count. A first post-change run measured p50 8.58 ms, but the table uses the later rerun.

Previously, a 156,036-byte 12K seed exceeded both the 8 KiB parser input limit and 1,024-token limit, and would be truncated by the 16 KiB console line limit. The new parser accepts up to 16,384 tokens and 256 KiB. Console lines share the 256 KiB ceiling, pages now also cap text at 256 KiB, and retention remains 2 MiB / 10,000 lines. The release harness initially measured seed capture/parse 2.223 ms and 20K captured/paged console events in 20.353 ms (982,656 lines/s); a later run under concurrent builds measured 4.316 ms and 26.484 ms (755,162/s). After replacing the console snapshot prefix scan with binary search, a final run measured 2.616 ms seed and 18.558 ms console (1,077,726 lines/s). Agent CPU and RSS have not been instrumented separately.

## Implemented scale changes

- Reuse one Intl.Collator rather than constructing locale comparison options for every sort comparison.
- Paginate Players at 100 rows, reset page on search/filter changes, clamp slices when a roster shrinks. Overview previews 100 names and says how to see everyone.
- Add opt-in `GET /api/v3/manage/players?limit=200`; follow `next_cursor`. Cursors include server, generation and console revision. A changed snapshot rejects the old cursor rather than assembling inconsistent pages. Responses include `revision`; legacy requests without query preserve full-snapshot behavior. The native client still uses the legacy snapshot route.
- Preserve existing console eviction, cursor deduplication and parsed-row caches. Add 12K roster traversal and 20K console flood regression tests.

## Concurrent editing audit and contract

These resources already had compare-and-swap protection before this work. Do not replace those transactional checks with a process-local revision map.

| Resource | Existing base revision |
| --- | --- |
| Server name/description | `expected_revision` string on ServerPatch |
| server.properties | `expected_sha256`, checked again at file publication |
| Software | `expected_revision` and plan/confirmation binding, rechecked on apply |
| Backup configuration | `expected_revision`, transactional policy update |
| Sleep and MOTD settings | expected policy revision |
| User roles, role definitions, access sources | opaque expected version |
| Pack publication/minimum | expected release revision |

The identified gap was inconsistent conflict responses (often only 412 / precondition_failed) and incomplete current-value recovery. The changed properties, branding/access, backup-config, sleep/MOTD and software routes return HTTP 409 with:

```json
{"api_version":"3","request_id":"...","error":{"code":"conflict","reason":"<fixed domain cause>","current":{"revision":"..."}}}
```

`current` is the resource-specific authorized projection, not a universal schema; properties use sha256 and values, permissions use their versioned projection. Read authorization is rerun for properties, permissions and software. Idempotency conflicts and unrelated operation conflicts retain their existing semantics. Current is reread after the failed write and may advance again before a retry, so the retry must still carry its reviewed base revision and a fresh intent.

The native Rust error and TS error contract now preserve `current`. The common error UI can expand the current value. Properties, profile and backup editors recognize the new conflict category, refresh the server copy, and preserve their existing explicit review path. Branding fixtures now return conflict/current; tests verify the losing write preserves the winner. Existing native mutation handling invalidates read caches on 409/412.

## Validation and remaining scope

Passed: launcher typecheck and production build; 24 targeted launcher checks; native client library 41/41; runtime 124/124; transport library 52/52. Targeted HTTPS properties, branding, sleep, permission-version and roster pagination tests pass. Final launcher checks: 441 pass, 0 fail. Initial launcher checks: 437 pass, 2 fail (existing modpack:context WASTED_RECOMPUTE; console-check:rows HOT_SCOPE_TIME 9.1 ms against an 8 ms budget). Isolated reactivity checks subsequently pass. Full initial HTTPS run: 102 pass, 23 fail, 1 ignored, including socket/timing failures and old conflict assertions; targeted reruns are required to distinguish environmental failures. No merge performed.

Still required for the complete requested acceptance criteria: persisted editor display name/time and â€œChanged by <user> just nowâ€; resource-change events and live refresh of other admins' forms; pack-draft concurrency audit beyond release revisions (pack install/workspace and server modpack page intentionally untouched); roster delta events and native client consumption of paginated APIs; integrated management-roster/status responder/status ping/metrics-history load benchmark, agent CPU/RSS, network latency percentiles and event rates; browser rendering measurements. The current harness does not exercise those paths, and the opt-in paging route still clones the management roster before projection.