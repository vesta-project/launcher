# Phase 1 implementation results (2026-10-25)

Read [the UI contract handoff](SERVER_RESET_PHASE1_CONTRACTS.md) for routes,
commands, TS fields, fixture behavior and remaining UI work.

Both repos were clean before this task. All commits below are unsigned and carry
Co-Authored-By: GPT-6.1 Sol <noreply@openai.com>. Integrate the full branch heads;
the follow-up commits contain safety checks and validation, not optional features.

## Commit map

- Item 0 (agent): 318514c, 5d8b758. The dev startup override/wait also lives in
  86eda83 under D3.
- D3 (agent): 6625a0a, 86eda83, 1a19243. Launcher: ab938208, debffabb, a82f8879.
- D4 (agent): 49a88eb, 72b61ad, ae74f9b. Launcher: 2c3c0c18, 3a69b934.
- D5 (agent): cf1fb4a, 92f05be, a1bc940, 856228a. Launcher: 47acce01.
- D1 (agent): 715139a, 5681b01. Launcher: 6b16eb66.
- D9 (agent docs; existing route reused): abea4fc. Launcher: 3f7517c2, 46d10751.
- Shared launcher documentation/formatting: 698ae13a, 563d8838, plus this results
  document. The new servers-reset.test.js covers contracts across all five decisions.

## Validation

- Agent binary/session/CLI/process suite: 74 tests passed, including supervised
  continuity and legacy automatic-start behavior.
- Control tests: Sleep/lifecycle 12; world 11; metrics 28; raw protected-file receipt
  tests; Java path/version/archive/probe tests; custom-runtime restart provenance.
- Transport library: 46 passed. Full HTTPS suite: 116 passed with
  `--test-threads=1`, as TESTING.md/CI require. Initial parallel execution hit shared
  password KDF/rate limits; serial execution passed. The obsolete protected-read
  refusal assertion was updated and owner/admin raw confirmation was tested over TLS.
- Real Windows Adoptium Java 21 download, SHA-256 verification, version/vendor/arch
  probe and immutable-install reuse passed. This explicit network smoke is ignored
  in ordinary offline tests. Linux/macOS detection and TAR paths were not run live.
- Agent/control/transport/installer and native-client clippy passed with -D warnings.
- Native client tests passed, including metrics map-key preservation, nulls/gaps and
  aggregate counts. Launcher cargo check passed; existing unrelated warnings remain.
- Solid `bun run typecheck` passed. All server/localization checks: 225 passed,
  zero failed. The focused six reset-contract checks also passed after fixture polish.
- Agent formatting check passed; changed native Rust code was formatted. The
  unrelated pre-existing native test formatting was preserved.

## Real development instance

The stale in-process shutdown marker for `%TEMP%/vesta-dev-server` was archived
only after the JVM/agent/supervisor absence checks and locked scratch-root checks.
The actual launch was inspected: a literal installed Java 25 executable and the
existing Minecraft 26.3 world. Game data, identity and TLS material were retained.
The final debug agent was rebuilt, staged outside Cargo target and restarted.
Live local status reported agent online, generation=null, readiness=stopped,
state=stopped. No Minecraft Java process remained. Later source-only changes
were formatting/borrow cleanup; runtime behavior is unchanged.

From PowerShell:

```powershell
Set-Location V:\server-connections-mvp
.\scripts\dev.ps1 status
# Routine agent restart, leaving Minecraft stopped:
.\scripts\dev.ps1 stop
.\scripts\dev.ps1 start
```

`start` rebuilds/stages the agent, applies conservative recovery when eligible,
and forces the trusted local stay-stopped startup override. `stop` gracefully
shuts down the game/agent and waits for exit. `recover` only archives the stale
marker without starting anything. Inert/native wrapper or linked Java launches
are refused by automatic orphan recovery because absence of JVMs is insufficient
proof for those layouts. See the agent's docs/operations/dev-test-server.md.

## Scope and UI handoff

No new UI pages were built. Only header action labels and removal of the obsolete
world creation action changed page code. The concurrently owned software section,
files tab/CSS, files-model.ts, hosting-model.ts and overview freshness files were
not edited. Remaining UI work is listed per decision in the linked contract handoff:
lifecycle/startup controls, confirmed protected-file editing, Java picker/download
jobs, one-world details/datapacks, and separate history-seeded metric graphs.
