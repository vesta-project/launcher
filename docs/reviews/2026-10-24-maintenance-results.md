# Server integration maintenance, 24 October 2026

Scope: launcher server integration on `feat/frontend-rewrite`, and
`server-connections-mvp` on `feat/launcher-compat`. Starting checkpoints were
`c8fb59ae` and `5073b1b`. The development agent was not restarted, user data was
not modified and nothing was pushed or deployed.

## Implemented checkpoints

- Launcher `ce937795`: recover console history without evicting newer live lines,
  retain unresolved tail gaps, deduplicate recovery pages, and avoid mutating
  cached row identities. Clear Display follows the source cursor through recovery
  and new generations. Eviction happens once per batch instead of once per line.
  Added an in-process benchmark and a reproducible Windows native IPC test helper.
- Launcher `ac9cd087`: initialize handed-over/saved workflow drafts as the initial
  signal value rather than calling a setter in component setup. Fixed the MOTD
  textarea's enumerated `spellcheck` attribute. These close the two existing lint
  errors found by the broad check.
- Server `9b61177`: an empty automation pulse uses a fresh read-only snapshot
  rather than joining writer admission. Scheduling, live authority, retention,
  durability and active-run transitions keep their existing path.

Luna handled focused scans and reviews. Its console review identified the
unresolved trailing-gap case, which received a regression test and fix. The idle
gate review found no concrete correctness issue. No additional worktree or
duplicate broad review was needed.

## Measurements and validation

The [console measurements and commands](../development/server-performance.md)
and [raw benchmark JSON](../development/performance/server-console-2026-10-24.json)
record the Windows desktop fixture. Append p95 changed from 0.056 to 0.015 ms per
64 lines; unchanged duplicate-page recovery p95 changed from 4.001 to 0.072 ms.
Cached parsing/filtering p95 changed from 0.651 to 0.724 ms: this stage has no
demonstrated gain. These numbers exclude WebView rendering, IPC and network.

The server's `docs/operations/idle-performance.md` records the binary hashes and
individual samples. Paired one-core-affinity release observations were roughly
2.1-2.2% of a desktop core before and 1.7-1.9% after; private memory remained about
4 MiB. No memory limit was imposed. The sub-1% idle target is still unmet, and
neither CPU affinity nor these small samples establish real low-end acceptance.

Checks completed successfully:

- 215 frontend server/localization/icon/log-model checks; typecheck, lint and
  production build. Existing lint and bundle-size warnings remain.
- 64 client tests: library 14, HTTPS 23, management 17, scheduler 9, priority TLS 1.
- Fresh native executable: 30 server-related tests pass; one explicit live-agent
  diagnostic remains ignored. This includes the whitelist event-coalescing test
  previously blocked by disk space. The new Windows helper was also executed.
- 35 automation tests, including the held-writer empty-pulse test, new admission,
  closed-state refusal and retention regressions. Strict control all-target Clippy.
- 13 console capture, adversarial-input and concurrency tests.
- Touched Rust test formatting and Git whitespace checks.

The first broad frontend run exposed a timing diagnostic in the new test's extra
assertion-only filtering scan. That scan now runs outside the reactive
computation; batch update counts and actual helpers remain instrumented. The
separate timed harness still measures full parsing/filtering work. The final broad
run passes without allowing or suppressing diagnostics. Earlier blocked native
test attempts remain historical failures, not retroactive passes.

## Storage inventory and blocked cleanup

At the start, V: had about 33.6 GiB free. The main launcher has no registered extra
worktrees. The old `launcher-wt-console` and `launcher-wt-files` directories have
no `.git` metadata, contain source and reports, and total under 100 MiB. They were
left intact. No branch, source snapshot or worktree was removed.

Build outputs dominate storage. A read-only selection identified 335 older
generated local-crate artifacts totaling about 5.692 GiB under exactly:

- `V:\launcher\target\debug\deps`
- `V:\server-connections-mvp\target\debug\deps`

The selection retains the newest two variants of each crate/artifact kind and
excludes recent outputs, third-party dependencies, release builds, reports and
source. The candidate manifest is outside the build tree at
`V:\tmp\babysit-prune-candidates.json`. It is a proposal, not evidence of deletion.

Four review/manifest files found under `target` were copied to
`V:\tmp\babysit-20261024-preserved-target-evidence`, and each copy was checked
against the source SHA-256: launcher reconnect-test log and test manifest, server
CLI inventory log and Node-test log. The native manifest also now has a durable
checked-in copy in `scripts/windows-native-tests.manifest`.

After source checkpoints, automatic approval review rejected the artifact deletion
command with only `blocked by policy`. The command did not execute. No alternative
deletion method was attempted. All 335 selected files remain, so no reclaimed
space is claimed. After builds, V: has about 32.0 GiB free. Future cleanup must
revalidate the manifest, live processes and clean source checkpoints; it must not
blindly replay an old selection.

## Remaining acceptance work

No real Minecraft session, WebView interaction recording, Linux/ARM run, low-end
hardware, memory-constrained workload or impaired-network experiment was performed.
The running dev agent still uses its previous staged binary. Rebuild/restart it
deliberately in a user testing session to apply the server change. Next measure
remaining idle database work and control latency during actual game/storage load
before introducing a cache or larger adaptive performance mechanism.
