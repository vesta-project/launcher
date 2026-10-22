# Native game-root file commands

Stage 4 of `servers/native.ts` is implemented in `vesta-server-client::files`
and `commands/server_files.rs`. No frontend files were changed. Backups, access
and pack implementation can merge independently of these modules.

## Contract and validators

- Paths are portable game-root-relative resources. Native validation rejects
  traversal, absolute/drive/UNC paths, backslashes, Windows aliases and protected
  documents. The agent remains authoritative for scope and filesystem identity.
- Create uses `If-None-Match: *`; overwrite/delete use the **unquoted content
  SHA-256** in `If-Match`. A range/download metadata ETag is never used as a
  content hash. Read previews are at most 1 MiB and have no mutation validator.
- Listings omit content hashes. A null rename/delete validator hashes a streamed
  download with fixed-size memory, bounded to 256 MiB. Larger sources require an
  explicit content hash. Changes between hashing and mutation produce
  `stale_target`; this observation is not a lock. The materialized hash is retained
  for same-intent retries during the client session, so a successful rename or
  delete does not make a retry depend on the removed source path. These implicit
  validators are not persisted across launcher restart.
- Agent 409 `recovery_required` maps to `outcome_unknown`, 409
  `confirmation_invalid` to `confirmation_expired`, 409 cursor/idempotency
  conflicts to `conflict`, and 412 to `stale_target`. 400/413/416/422 map to
  `invalid_input`; 503 maps to `server_busy`, preserving Retry-After guidance.
- Log pages have a separate 6 MiB JSON ceiling (4 MiB decoded bytes), rather
  than the normal 1 MiB projection ceiling. Property keys are decoded literally;
  recursive snake-to-camel conversion must not rename keys inside `values`.

## Transfers

The native multi-file picker returns only random `localId`, basename and decimal
size. It snapshots each selected regular file to an owner-only temporary file,
hashes it with SHA-256, and rejects totals over 16 MiB. Local paths never enter
IPC, activity events, errors, logs or agent requests. Handles bind to the calling
window; upload sessions additionally bind to the connection. Collections are
bounded to 64 entries and expire after one hour (pruned on subsequent admission).
Snapshots are also removed when their owning native state is dropped.

Begin retains its snapshot and key even when the reply is lost. Chunks are at
most 1 MiB and use stable keys derived from the original intent and requested
offset. A failed/partial append replays identical bytes from the last observed
offset; the next offset always comes from the agent response. Finish/abort use
their original intent, with no new key on retries. Handles/snapshots are
session-local; resuming after a launcher process restart is not implemented.
The agent's own stage expires after one hour.

All upload stages and downloads hold independent bulk permits (two global, one
per origin), through response completion. They do not spend control tokens or
hold control concurrency slots. A shared Retry-After pause still applies.

Download chooses its destination only through a native save dialog. Cancellation
makes no network request. The body streams to a private temporary file in the
destination directory; disk free-space preflight/per-write checks and write
failures enforce the disk budget. There is no 16 MiB download ceiling. Publication
uses an atomic same-directory rename only after full length and successful EOF,
flush and sync. Failure/cancellation removes the stage and preserves the old
destination. Up to two interrupted-body retries use `Range: bytes=N-` and the
original strong `If-Range` ETag; 206 must match the original ETag, total and exact
interval. A 200 fallback truncates/restarts the stage. Gzip decompression is
requested from the agent using `decompress=1`; native never buffers/decompresses
the whole file. Native transfer progress feeds the existing activity panel.

## Properties confirmation concern

The current TS/UI contract **does pass `confirmationToken` through the UI**:
`PropertiesUpdateResult.awaitingConfirmation` exposes it, and
`propertiesUpdate(..., confirmationToken, intentId)` sends it back. This
implementation stays compatible: only a weakening preparation returns the token,
and confirmation uses the same changes, validator and intent. No token is logged,
placed in activity, or saved in connection metadata. Applied changes publish
`restartRequired` without restarting the game.

Proposed future contract: mirror kill/OP by keeping the prepared token and exact
payload in native state, returning only operation ID/expiry, and accepting an
explicit `propertiesConfirm(connectionId, intentId)` command. This reduces token
exposure and prevents UI payload drift. It needs a coordinated UI change; it was
not made in this backend-only branch.

## Verification

`cargo test -p vesta-server-client` includes pinned-TLS file fixtures for content
validators, binary/prefix reads, directory/trash mappings, decoded large log pages,
typed properties/confirmation, immutable local snapshots, 1 MiB chunks, partial
append and lost-begin replay, abort and window/connection binding. A stalled
upload test verifies that control and another server's upload keep progressing.
Download tests cover a file
larger than 16 MiB, interrupted resume, 200 restart, unchanged destination during
transfer, atomic replacement and stage cleanup on repeated failure. Policy tests
cover paths, error mappings, bulk limits and preservation of control tokens.

An additional opt-in real-agent test covers list/read/write/validator conflicts,
null-validator rename replay, trash/restore, upload/download, real gzip log pages
and raw/decoded downloads, typed properties and weakening confirmation, and
device revocation. It uses the existing inert-child
fixture, no Minecraft/Java install:

```powershell
$env:VESTA_LIVE_AGENT = '1'
$env:VESTA_AGENT_BIN = 'V:\server-connections-mvp\target\debug\vesta-agent.exe'
$env:VESTA_AGENT_INERT_BIN = 'V:\server-connections-mvp\target\debug\deps\https-<hash>.exe'
$env:VESTA_LIVE_SCRATCH = 'V:\launcher-server-files\target\live-files'
cargo test -p vesta-server-client --test live_agent_files -- --ignored --nocapture
```

The fixture listener has a 64 KiB body ceiling, so its upload is intentionally
small; multi-MiB chunk/resume boundaries are exercised in pinned-TLS fixtures.
Native dialog appearance/interaction was not exercised by automated tests.

Observed on Windows, 2026-10-22: the default client suite passed (45 tests, two
opt-in tests ignored); the new opt-in file test passed against the actual agent.
`cargo clippy -p vesta-server-client -- -D warnings` and clippy for all new test
targets passed. `cargo check -p vesta-launcher` and the rewrite Tauri `cargo check`
passed with existing unrelated warnings. The optional `--all-targets` clippy run
is blocked by the pre-existing `items_after_test_module` lint in the production
credential adapter included by the older storage/live tests.

The successful live fixture used agent SHA-256
`0332c7633a90514e8ab73e64e41163c0346e403ed69263b703748c2a0ca68c56`
and inert-test SHA-256
`663b39e701009082c491462f1e29df6c1cbd1734f380c28d8c6a12ad6fd63808`.
Agent source was not changed. Private fixture state remains under ignored
`target/live-files`; it is not part of this change.
