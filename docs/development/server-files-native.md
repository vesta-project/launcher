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
hashes it with SHA-256, and rejects files over 16 MiB. Local paths never enter
returned IPC DTOs, activity events, errors, logs or agent requests. Handles bind
to the calling window; upload sessions additionally bind to the connection. Collections are
bounded to 64 entries and expire after one hour (pruned on subsequent admission).
Snapshots are also removed when their owning native state is dropped.

`server_file_upload_dropped` accepts only exact paths observed in the most recent
native OS drop on the calling window. Enter/hover and frontend-emitted events do
not authorize uploads. Each accepted drop is consumed once; a newer drop or window
destruction revokes the previous selection. Dropped directories are walked with
the same 64-file admission cap and use the same snapshot/transfer store as the
picker. Symlinks, Windows reparse points (including junctions), linked ancestors,
non-regular files and nesting deeper than 64 levels are rejected. Nested
candidates add a portable relative `folder` starting with the dropped directory's
name; loose files retain the picker DTO. Native paths never appear in returned
candidates or errors. Existing begin/chunk/finish commands are unchanged.

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

### Dropped uploads (Windows, 2026-10-25)

- `cargo test -p vesta-launcher servers::files::dropped::tests:: -- --test-threads=1`:
  seven passed, covering native drop/window admission, stale/unobserved paths,
  nesting and candidate serialization, file count/size caps, and junction refusal
  as a root, nested entry, or ancestor. Unix symlink coverage is compiled only on
  Unix and was not run on this host.
- `cargo check -p vesta-launcher`: passed with existing unrelated warnings.
- Desktop Solid `bun run typecheck`: passed; server Bun tests: 237 passed across
  17 files. PowerShell requires expanding `checks/servers-*.test.js` into paths.
- `cargo test -p vesta-launcher`: 572 passed, seven ignored, seven failed in
  untouched modules. Cargo's disposable test executables needed the repository's
  `scripts/windows-native-tests.manifest` embedded with Windows SDK `mt.exe`, as
  described by `scripts/test-server-manager-unit.ps1`, to avoid the existing
  `STATUS_ENTRYPOINT_NOT_FOUND` loader failure. The failing tests were:
  - `launcher_import::providers::modrinth_app::count_tests::count_uses_only_identities_without_profile_metadata_or_icons`
  - `resources::ledger::tests::malformed_optional_source_evidence_does_not_hide_installed_rows`
  - `resources::ledger::tests::migration_loads_existing_rows_with_nullable_source_evidence`
  - `resources::ledger::tests::source_only_evidence_cannot_be_used_as_installed_release_identity`
  - `resources::manual_drop::tests::path_counts_defaults_and_zero_accepted_summary_are_safe`
  - `resources::source_enrichment::tests::checked_targets_accept_declared_aliases_and_canonical_publication`
  - `worlds::archive::tests::summaries_assign_descendants_once_and_preserve_ids_backup_and_icons`

### Windows library test follow-up (2026-10-25)

The seven failures above are resolved. Five assertions/fixtures assumed Unix
path spelling or absoluteness; they now use native paths and the ledger's
existing normalized storage contract. The source-enrichment traversal fixture
now preserves a literal parent component: joining onto a Windows verbatim
canonical path had removed `..` before validation could inspect it. The test
still requires traversal refusal and acceptance of declared/canonical aliases.

The archive failure exposed a production bug: world icon marker lookup used
native backslashes to query slash-separated ZIP central-directory names on
Windows. Marker lookup now joins path components with `/`, retaining rejection
of non-UTF-8 paths. The existing nested-world summary test verifies the parent's
icon survives, the child has no icon, and ownership/installation remain intact.

Verification on Windows: all seven focused tests passed; the complete
`vesta-launcher` library suite passed **579 tests, zero failures, seven ignored**
with `--test-threads=1`. Built using `cargo test --locked -p vesta-launcher --lib
--no-run --message-format=json`, `CARGO_INCREMENTAL=0` and two build jobs;
embedded the same repository manifest into Cargo's reported disposable test
executable with SDK `mt.exe` before running it. Existing unrelated compiler
warnings remain. Unix-only cases and ignored live fixtures were not run.
