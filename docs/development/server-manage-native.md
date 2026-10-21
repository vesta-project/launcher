# Native server management

The Rust client and shared Tauri backend implement all 21 commands in
`apps/desktop-solid/src/features/servers/native-manage.ts`. No frontend source or
contract changes are required. Both launcher shells use the shared registration.

Implemented commands:

- Backups: overview/cursor, merged normal and safety snapshots, storage, run,
  verify, inspection restore, in-place prepare/confirm, recovery resolution.
- Access: users/offset, roles, user-role changes, devices/revoke,
  invitations/create/revoke, access-source settings/update.
- Pack: publish and raise minimum revision.

DTOs are explicit camelCase allowlists. Backup result paths, repository details,
unrecognized extra fields and confirmation tokens are never forwarded to IPC.
`requestedBy` is resolved from the users projection; principal IDs are never
substituted for names. Names (including a denied lookup) are cached per client for
one minute, with at most ten 100-user pages.

Mutations use the existing device/server-scoped UI intent key algorithm and
hash-only profile journal. Successful mutations invalidate pre-mutation read
coalescing entries, including results from older in-flight reads. Backup work
appears in launcher activity and uses bounded background tracking; synchronous
access/pack mutations record completed activity without response contents.

## Restore confirmation

Prepare never uses the session-renewal retry path or an operation replay cache.
Its intent is reserved before sending, including across profile restarts. The
zeroizing token stays only in the enrolled native Client, expires with its
confirmation, and is removed before confirmation is sent. Repeated prepare with
the same intent returns `outcome_unknown`; repeated confirmation cannot resubmit
the token. A new preparation requires a new explicit UI intent.

The UI confirm and resolve-recovery contracts have no `intentId`. Confirm derives
its wire key from a domain-separated hash of the original prepare intent;
recovery resolution derives a stable job-scoped intent. No IPC type correction
was made. App restart or repinning discards confirmation tokens and requires a
new preparation. The durable journal still prevents replay of an old preparation.

Backup mutation receipts contain a job ID, rather than a full job. Native fetches
the job detail to return authoritative facts. If that read fails after acceptance,
the result is `outcome_unknown`; for prepare, its token remains native so a job
discovered by refreshing the overview can still be confirmed. No timestamp,
requester name or result is fabricated from submitted input.

## Compatibility and bounds

- Missing global devices route: aggregate the visible users' per-user device
  lists, at most ten user pages, 100 user requests and 1,000 device records.
  Rank-scoped 403s are skipped without marking the whole capability unavailable.
  A global 403 is returned directly. Budget/admission refusals return errors,
  rather than silently returning partial results.
- Old invitations GET returns `unsupported`, including the real older adapter's
  400 `invalid_request` response to the fixed inventory query. Old invitation
  DELETE returns `unsupported` for an unimplemented route; a current agent's
  missing invitation remains `not_found`.
- Old invitation creation without ID or link returns null for both. Native does
  not invent a public endpoint. Issued codes are returned once and never journaled.
  Replaying a successful agent receipt that omits its code returns `outcome_unknown`.
- Global device/invitation inventories follow at most ten 100-item pages. Missing
  old device timestamps stay null; current device identity comes from enrollment.
- Snapshot lists accept old unpaginated responses and follow newer `next_before`
  cursors, at most twenty pages per list. Cursors cannot repeat. Both kinds are
  merged by parsed RFC3339 instant, newest first, preserving `safety`.
- Role/access-source 412 and revision-related 409 map to `stale_target`;
  idempotency conflicts remain `conflict`. Backup-specific errors map to the
  existing closed error set.

## Verification

Run from the worktree root:

```powershell
cargo test -p vesta-server-client
cargo clippy -p vesta-server-client --all-targets -- -D warnings
cargo check -p vesta-launcher
```

Run `cargo check` in `apps/desktop-solid/src-tauri` (the same shared backend).
Its lockfile, like the root lockfile, adds only the existing chrono dependency
edge used for chronological snapshot merging. Launcher checks have existing
warnings in unrelated modules.

Seven HTTPS management scenarios exercise every route, request casing,
idempotency, DTO mapping/redaction, pagination, display names, compatibility,
expired/consumed tokens, 401/lost prepare replies, failed detail reads, cache
invalidation and bounded fallback admission. Production storage tests also
verify that a preparation intent stays non-replayable after a profile restart.

The opt-in `live_management_access_pack_and_backups` test initializes only its
scratch host's local backup repository and stopped `daily` profile. It checks
users/roles, invitation create/list/revoke, a second enrolled device and its
revocation, access sources, backup/run/verify/storage/snapshots, inspection
restore, in-place prepare/confirm with a safety snapshot, and pack publish/minimum.
It does not deliberately damage a live restore to force recovery-required state;
recovery resolution has HTTPS fixture coverage.

Use the binary setup in `server-client-followup.md`, then:

```powershell
$env:VESTA_LIVE_SCRATCH = "$PWD/target/live-agent"
cargo test -p vesta-server-client --test live_agent live_management_access_pack_and_backups -- --ignored --nocapture
```

Observed passing on 2026-10-22 against the available `feat/launcher-compat`
working-copy binary. The source checkout was at
`cf28984e38e5e1daded4c6ab1077aab34044e392` when inspected; concurrent agent work
means this is not a claim of a clean exported release. The fixture pins binaries
and records their hashes. First successful run: agent SHA-256
`0332c7633a90514e8ab73e64e41163c0346e403ed69263b703748c2a0ca68c56`;
inert fixture SHA-256
`53693e9a5ea40478f8594313f3c89092b0b8e51988ada146e457685b70be3100`.
