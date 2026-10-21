# Server client follow-up contract and verification

The Rust DTO and Tauri commands implement `apps/desktop-solid/src/features/servers/native.ts` as of the server-client follow-up. No Solid source changes are required.

## Credentials and restart

`Discovery.secureStorageAvailable` probes a fresh credential entry using a real write/read/delete round trip. This is an observation, not a guarantee of future OS-store availability. Persistent enrollment writes and verifies the actual signing seed before redeeming the pairing code. Minecraft sign-in probes before requesting a challenge or contacting Mojang, and stores/verifies the actual device key before completing the challenge. A failure returns `credentials_unavailable`; no silent fallback occurs.

`server_pair` and `server_sign_in_minecraft` accept the explicit `memoryOnly` boolean. The old `VESTA_SERVER_MEMORY_ONLY` environment switch has been removed. In memory-only mode the signer and session live in this process, `ServerConnection.memoryOnly` is true, and the connection and its intent journal are excluded from profile storage. Restart **drops** that connection. Legacy stored memory-only metadata is also dropped when loading. Pair again after restart. The remote device can remain enrolled until the operator revokes it; forgetting local credentials cannot revoke a device without contacting the agent.

Keys and bearer sessions never enter profile JSON or IPC. Persistent signing seeds use the OS credential service. Failed one-shot enrollments can retain only the existing orphan-key reference for recovery; uncertain pairing is never automatically retried.

## Read and event semantics

Console pages pass through the agent's `GET /console` semantics: null starts the bounded retained tail, oldest first; a cursor continues strictly after that line. Evicted content cannot be recovered. Both pages and stream lines preserve the agent's opaque line cursors without translation. Content is the agent's redacted text, not raw child stdout.

The global `core://servers-changed` event signals saved-list edits and coarse phase/access or lifecycle/generation/readiness changes. It excludes uptime, player-count samples, observation timestamps and per-server detail. A shared trailing 250 ms coalescer limits bursts to at most four events per second; subscriptions carry the detail. Once a metrics socket proves support for `status` frames, it supplies status without periodic HTTP polling. Disconnected sockets and older agents retain the ten-second fallback.

The client already consumes authoritative `GET /api/v3/manage/session` capabilities (`source = session`, `granted = capabilities`), status/metrics ETags and `If-None-Match`, integer delta-seconds `Retry-After` on HTTP/upgrade refusals (successful HTTP and stream status observations preserve the active backoff deadline), and `vesta://pair?endpoint=...&code=...&fp=...&sid=...` links. Fingerprint and server-ID mismatches are refused before enrollment.

## Explicit intent retries

New Idempotency-Keys hash a versioned domain plus length-delimited server ID, enrolled device ID, and UI intent ID. Reconstructing the same connection preserves the key. Identical explicit retries after cancellation, timeout, unreachable, internal or uncertain replies can reach the agent's durable receipt. Accepted operations can be reconciled by their known operation ID. The manager journal and client cache reject a changed action or payload with `conflict`. There is no automatic mutation retry loop.

Journal entries from the earlier implementation retain their original wire-key derivation during upgrade, including after trust-pool retirement. This avoids creating a new operation under a new key for an uncertain pre-upgrade request. The profile persists hashes and operation IDs, never mutation bodies, player names, command lines or confirmation tokens. Agent receipt retention still bounds how long an unknown intent can be replayed safely.

## Reproducing the real-agent tests (Windows)

Build the agent and its owned inert-child test executable in the read-only source checkout:

```powershell
cd V:\server-connections-mvp
cargo build -p vesta-agent
cargo test -p vesta-transport --test https --no-run
```

Use the printed `https-<hash>.exe` path below. The test copies that executable to a new scratch instance. Its `management_inert_child` accepts stop/list and echoes other stdin; it downloads no Minecraft or Java. The fixture copies the agent binary into scratch and records both input binary SHA-256 hashes in `fixture-binaries.json`, keeping CLI calls stable if another task rebuilds the source checkout. The fixture creates fresh test TLS material, a loopback listener, an explicit advertised HTTPS endpoint, registry metadata, and test-only EULA acceptance for this inert process. All agent state and logs stay outside either checkout. The fixture stops the inert child and agent on completion or failure. Scratch is retained for inspection; its private TLS key and server database are test artifacts and should not be published.

```powershell
cd V:\launcher-server-followup
$env:VESTA_LIVE_AGENT = '1'
$env:VESTA_AGENT_BIN = 'V:\server-connections-mvp\target\debug\vesta-agent.exe'
$env:VESTA_AGENT_INERT_BIN = 'V:\server-connections-mvp\target\debug\deps\https-<hash>.exe'
$env:VESTA_LIVE_SCRATCH = 'V:\tmp\vesta-e2e'
cargo test -p vesta-server-client --test live_agent -- --ignored --nocapture
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-server-manager-live.ps1
```

The Windows runner builds the ignored launcher lib-test and embeds the committed Common Controls v6 test manifest using Windows SDK `mt.exe`. The bare lib-test executable has no manifest/resource section and fails to load its `TaskDialogIndirect` import with `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` in this environment. This affects the test executable; the helper changes only the generated artifact and leaves production packaging untouched. On other supported desktops, run the second test directly with `cargo test -p vesta-launcher --lib servers::tests::live_manager_storage_events_retry_and_restart -- --ignored --nocapture`.

The first test covers discover/pin, real code redemption, signed session, session capabilities, conditional status reads, pushed status, start, console output and matching cursors, generation-bound stop, a fresh-client stop receipt replay, changed-payload refusal, two-step kill, stored-vault reconnect and CLI revocation classification. The second uses the actual `ServerManager` and a windowless Tauri handle to cover unavailable-store preflight (including Minecraft), same-code memory-only redemption, restart dropping temporary connections, durable uncertain retries, coarse-event behavior and persistent-manager restart/revocation.

Both live tests are ignored by default and require explicit opt-in. Normal `cargo test -p vesta-server-client` also compiles/runs the actual production storage/credential adapter's focused tests without a Tauri runtime. OS-vault persistence in the live tests is real; only the manager test's unavailable-store case uses a test-only denied adapter.

## Observed verification (2026-10-21, Windows)

- `cargo test -p vesta-server-client`: 29 passed, one live test ignored by default.
- `cargo clippy -p vesta-server-client -- -D warnings`: passed.
- `cargo check -p vesta-launcher`: passed, with pre-existing unrelated warnings.
- `cargo check` in `apps/desktop-solid/src-tauri`: passed, with pre-existing unrelated warnings.
- Opt-in client live E2E: all 12 logged steps passed, including 60 authoritative capabilities, identical console page/stream cursors, a fresh-client stop receipt replay, two-step kill, stored OS-vault reconnect and CLI revocation. Scratch instance: `V:\tmp\vesta-e2e\launcher-0Y5sYT`; log: `V:\tmp\vesta-live-client.log`.
- Actual `ServerManager` live E2E via the Windows test runner: all five logged groups passed. An unavailable-store rejection left the same code usable for memory-only pairing; restart removed it. Persistent enrollment and uncertain-intent recovery worked; changing action/payload conflicted. Twenty detail samples emitted zero global events and twenty invalidations coalesced to one event. Successful interactive status preserved an active Retry-After deadline. A new manager immediately reloaded the OS-vault device after a recent persisted observation, reconnected, then classified and published CLI revocation. Scratch instance: `V:\tmp\vesta-e2e\launcher-zyR9A4`; log: `V:\tmp\vesta-live-manager-run.log`.

The agent was built on `feat/launcher-compat` at `15ce227176fd154b99079e16f95c19fb4f1e027c`. No agent source was edited by this task. Its worktree had unrelated uncommitted changes when final status was read; verification used the working-copy binary, not a clean exported release. No Minecraft distribution or Java was downloaded or launched. The live child was the repository's `management_inert_child` fixture. Minecraft/Mojang enrollment success and Linux/macOS vault behavior were not exercised. Console content was redacted by the real agent (for example, `[redacted] say [redacted]`); matching raw marker text would be an incorrect test expectation.

The final client and manager runs used identical pinned inputs: agent SHA-256 `1fa10154bc3cb32c51b36fef836ae4139b55bea8c3d9cf7d7a0639b55c3f0694`, inert-test executable SHA-256 `b2f58d43f202008b4e30ca9a729a93aa092fe5260694c469aa659ad517e5bea0`. Transient `server_busy` admission/read refusals were observed during repeated runs with streams and concurrent builds; operation observation retries bounded read refusals with backoff. The final successful client run took 15.11 seconds; the final manager run took 12.59 seconds.
