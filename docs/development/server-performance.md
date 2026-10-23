# Measuring server integration without a live game

Run the bounded in-process console harness from `apps/desktop-solid`:

```powershell
bun scripts/measure-server-console.ts
```

It prints JSON for 64-line batches into a full 5,000-entry buffer, cached parsing
with filtering/counts, and repeated duplicate history pages. Input allocation and
one warmup are outside the timed sections. Each stage records 2,560 samples over
five repeats. `recovery` means an already-retained duplicate page, not reconnect
latency. There is no pass/fail wall-clock threshold. Inspect all stages instead of
inferring application responsiveness from the cheapest buffer operation.

The harness uses synthetic strings only. It excludes WebView rendering, IPC,
network, authentication, actual game commands and a memory limit. Its ending heap
snapshot is the benchmark process, not the launcher's steady-state footprint.

For comparable runs, use the same Bun version and fixture, stop unrelated builds,
and record CPU affinity and host conditions separately. Restricting a desktop CPU
to one logical core does not reproduce a slow 1-core/2-GB machine.

## 24 October 2026 observation

Windows 11 build 26100, Ryzen 7 6800H, Bun 1.4.3, benchmark process pinned to logical
CPU 0. Before source: `c8fb59ae`; after source: the accompanying console change.
Times are milliseconds per batch/page.

| Stage | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Append 64 lines | 0.036 / 0.056 | 0.011 / 0.015 |
| Append, cached parse, filter and counts | 0.528 / 0.651 | 0.537 / 0.724 |
| Duplicate recovery page | 2.093 / 4.001 | 0.051 / 0.072 |

Batch front eviction replaces repeated array shifts. An unchanged duplicate page
can return without rebuilding rows. Cached parsing/filtering remains roughly the
same cost, with a slower p95 in this observation; no rendering or end-to-end
latency improvement is established. GC/scheduling outliers remain in the raw
measurements. A subsequent run during compilation was not used for this table.

Correctness is separate from these numbers: recovery sorts combined history
before eviction, preserves unresolved trailing discontinuities, deduplicates
pages, and creates immutable objects when row ids change. Clear Display stores a
source cursor boundary so rebuilding row ids cannot reveal cleared output. u64
cursors are compared as BigInts, including values beyond safe JavaScript integers.

The Solid diagnostics scenario checks one update per 64-line batch and recovery
while cleared. Assertion-only filtering runs outside the reactive computation;
the timed harness separately measures full parsing/filtering work. This avoids
making the diagnostics test's extra assertion scan part of application cost.

## Windows native IPC tests

From the launcher repository:

```powershell
./scripts/test-server-manager-unit.ps1
# Optionally select another test name within this unit test binary:
./scripts/test-server-manager-unit.ps1 -Filter 'servers::subscriptions::'
```

Requires Cargo and a Windows SDK containing `mt.exe`. The helper builds the exact
Cargo-reported launcher unit test executable, embeds the checked-in Common
Controls v6 manifest in that disposable binary, then runs the selected tests. It
uses one test thread by default and keeps build/test evidence in a unique OS-temp
directory. It restores the caller's working directory and incremental setting.
It does not launch a WebView, enable ignored live tests or operate a real server.

This makes the earlier manual manifest workaround reproducible. On this checkout,
30 native server-related tests pass, one live-profile diagnostic is intentionally
ignored, and the previously disk-blocked whitelist IPC coalescing test now runs
successfully. The helper was itself executed against the fresh test binary.
