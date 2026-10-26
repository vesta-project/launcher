# Linked client pack sync — Stage 3 UI handoff

Implemented on `feat/frontend-rewrite`, with the matching signed consumption
transport on agent `feat/launcher-compat`. The approved scope is
`docs/architecture/SERVER_RESOURCES_PLAN.md`. No pages or
`features/browse/server-install.ts` were edited.

## Contract and server page

`native-pack-sync.ts` is spread into `serversNative` and browser `serversApi()`.
All revision/minimum/byte counters stay decimal strings. Instance IDs are local
database integers; connection IDs are opaque launcher IDs. UI never supplies a
download URL, destination directory, fingerprint approval or signing key.

1. “Join with Vesta” / “Get the modpack”: call
   `packSyncPreview(connectionId, null)`. Native verifies a fresh signed release,
   downloads/hash-verifies the archive and resolves verified client files before
   returning a review. New installations select the current published revision.
   Server software and client loader are independent: Paper can publish Fabric.
2. Show the returned name, Minecraft/loader versions, server identity,
   `revision`, `minimumRevision`, `artifactSha256`, full `changes`, and
   `executableChanges`. When `consentRequired`, require an explicit user action
   naming that revision and the executable additions/removals/updates. Pass
   `consentRevision: preview.revision` only after that action. Scripts are also
   classified as executable. Symbolic links are rejected rather than consented.
3. Call `packSyncApply({reviewId, consentRevision, name})`. It resolves to the
   new instance ID after the durable local commit and Minecraft/loader
   installation through the existing piston instance installer. Await it with
   an install-pending state; this command currently exposes completion/error,
   not a new task/progress handle. Navigate to the returned instance. Native
   emits the existing instance-created/updated events and restarts resource
   watching after the commit.
4. “Link an existing instance”: choose a local instance, then call
   `packSyncPreview(connectionId, instanceId)`. MC, loader and loader version
   must match. `packSyncApply({reviewId, linkOnly:true})` accepts only an exact
   matching pack file set, adopts those files as pack-owned, and records the
   verified revision. Extra user mods remain outside that ownership. If files
   differ, offer the reviewed installation path (`linkOnly:false`) with consent.
   Do not label a mismatching existing instance as linked before success.

Reviews are native-owned, bound to their target instance, server ID, TLS pin,
revision, artifact and file diff. They expire after 15 minutes and are single-use,
including after refusal. At most eight are retained. Call
`packSyncDiscard(reviewId)` on cancellation; obtain a new review after expiry,
changed files, changed publication, or any rejected apply. No blanket or
cross-revision executable consent is stored. On uncertain IPC completion, inspect
the instance list and link/check state before offering another new installation.

## Instance page and launch flow

- `packSyncLink(instanceId)` returns the paired binding and observed revision/
  minimum high-water marks, or null. These high-water marks are **not** the
  installed revision; use `packSyncCheck(instanceId).installedRevision` for that.
- `packSyncCheck(instanceId)` is a cheap signed status call; it downloads neither
  the archive nor provider files. Null means unlinked. Show installed, published
  and minimum revisions separately. `current` can launch; `update_available`
  offers an optional update and can launch; `update_required` blocks launch.
- Native polls linked instances every 60 seconds while the launcher runs and
  emits `PACK_SYNC_STATUS_EVENT` with `PackSyncCheck`. Listen once in the instance
  store and dispose the listener normally. `PACK_SYNC_CHANGED_EVENT` contains the
  instance ID after a successful local commit; refresh its link/status/details.
  Browser fixtures expose stateful calls; they do not start a timer themselves.
- Every native launch path already passes through the guard in `launch_instance`
  under its play lock. UI checking is presentation, not enforcement. Optional
  updates may be deferred. Required updates cannot be bypassed with a stale UI
  snapshot. The existing string launch IPC uses `pack_sync:<JSON>` for a blocked
  pack launch; `parsePackSyncLaunchBlock(error)` extracts a `PackSyncCheck` or
  `ServerCommandError`. Other launch errors keep their existing handling.
- `availability:server_offline|verification_failed` has `canLaunch:false`,
  `status:null`, and a typed `error`. Show retry/repair/trust actions; never turn
  a previously cached optional result into current launch permission. Offline
  cannot confirm whether the server raised its minimum. No auto-update or game
  restart occurs. A running instance must stop before apply.
- Updating uses the same preview/apply calls with the instance ID. A different
  MC/loader identity refuses with `pack_incompatible_runtime`; offer creating a
  new compatible instance. This stage does not silently migrate its runtime or
  rebind a link to another server/fingerprint.

## Integrity, ownership and failure behavior

The agent signs a fresh request nonce, server ID, TLS fingerprint, installed/
latest/minimum revisions, status, artifact size/hash/format using its active TLS
key. Native verifies the leaf DER against the already approved pair, signature,
nonce and policy. Persisted high-water marks reject older releases, decreased
minimums and different artifacts under the same revision. Pack possession is a
compatibility signal, not attestation to the Minecraft server.

Workspace Vesta packs, hosted `.mrpack`, CurseForge ZIP and pinned platform
catalogues feed one native file diff. Legacy archives use the existing instance
archive parser/provider resolver and are normalized privately. Provider URLs in
archives are descriptive; native resolves pins/hashes through configured providers,
uses restricted CDN redirects, verifies bytes and stages all client-eligible
entries. Files unsupported on the client are excluded. Provider/manual-download
failures require repair at the source. Already matching local files are reused.
Limits follow the workspace: 16 MiB/file, 64 MiB/file set, 68 MiB/archive, 256 pack
entries plus the workspace icon. Portable paths and aliases/tree collisions are
checked; links/reparse points on touched game paths are refused.

Pack-owned files and their hashes/runtime/revision live in the game directory's
`.vesta-server-pack.json`; paired identity and revision high-water marks live in
the protected profile's `pack-sync/<instanceId>.json`. User-added files outside
the receipt remain untouched. A conflicting user file or locally edited owned
file refuses instead of overwriting it. Restore/reconcile that file explicitly,
then review again. A missing receipt blocks launch and requires explicit
reinstallation review; it is never inferred from matching version labels.

Apply rechecks publication, identity, runtime, running state, receipt and diff
under existing play/resource locks. It stages only changed files, then uses the
existing `.vesta/pending_update.json`/`.update_rollback` journal and same-filesystem renames.
The receipt participates in rollback. A failure restores previous files/receipt;
a durable commit marker makes startup retain the new result. This is a recoverable
multi-file transaction, not a claim of one atomic directory-wide operation.

Fixed `error.reason` values relevant to UI include:

| Reason | UI action |
|---|---|
| `pack_executable_consent_required` | New review and explicit consent for its revision |
| `pack_review_expired`, `pack_review_stale` | Discard old review; refresh and review again |
| `pack_integrity_failure`, `pack_server_binding_mismatch`, `pack_rollback_rejected` | Block install/launch; explain verification failure; never offer bypass |
| `pack_incompatible_runtime` | Create a compatible new instance |
| `pack_existing_files_mismatch` | Offer reviewed install instead of link-only |
| `pack_user_file_collision`, `pack_owned_file_modified` | Explain conflicting local files; preserve them |
| `pack_instance_running` | Stop instance before updating |
| `pack_recovery_required`, `pack_receipt_missing`, `pack_invalid_receipt` | Complete recovery or explicitly review a repair install |
| `pack_download_unavailable`, `pack_missing_file`, `pack_invalid_source`, `pack_invalid_index` | Repair/re-publish the source pack or provider access |
| `pack_unsafe_path`, `pack_unsafe_archive`, `pack_symbolic_link_rejected`, `pack_file_collision`, `pack_too_large` | Explain why the pack is refused; source needs correction |
| `pack_preview_limit` | Discard unused reviews |

## Fixtures and validation

`fixtures-pack-sync.ts` exports `seedPackSync` scenarios `optional_update`,
`required_update`, `server_offline`, `integrity_failure`, and the stateful
`createPackSyncFixtures`. Tests can inject a shared instance map, published
manifest and scenario. Regular server fixtures share the actual published
workspace manifest and server publication/minimum, keeping draft edits separate.
The fixture instance map is local to this API unless injected; it is not an OS
filesystem or browser library installation. Cryptographic and journal guarantees
come from Rust tests, not simulated fixture hashes.

`checks/servers-pack-sync.test.js` covers all four scenarios, large revision
strings, required/optional/current states, consent, create/link, stale reviews,
identity/rollback/runtime failures, diff preservation, failed apply and cancellation.
Native tests cover signature tamper/replay/pair binding, monotonicity, portable
paths, hash checks, owned-file conflicts and rollback/recovery. Agent HTTPS tests
exercise signed optional/required/current status, minimum-only changes, pack-user
authority and exact current-artifact download. No production pairing/publication,
provider download or Minecraft launch is performed by validation.

### Validation on 2026-10-26

- Eight native pack-sync regressions passed. The Windows test harness needed the
  existing Common-Controls v6 manifest workaround on its disposable executable.
  A later PDB-limit/disk-full rebuild used
  `cargo test -p vesta-launcher --lib pack_sync --no-run --config 'profile.test.package.vesta-launcher.debug=0'`,
  then ran that executable after embedding the manifest. Project build settings
  were not changed. Generated PDB/incremental caches were relocated from `target`
  to `C:\Users\eatha\AppData\Local\Temp\vesta-pack-sync-*` to recover workspace space.
- The full `vesta-server-client` suite passed; environment/live tests retain their
  existing ignores. Client and agent transport all-target Clippy with
  `-D warnings` passed. Agent transport unit tests: 47 passed; HTTPS: 121 passed
  with `--test-threads=1`. The default parallel HTTPS run exhausted shared
  password KDF/rate budgets; no production budget was changed.
- `cargo check -p vesta-launcher` passed with existing unrelated warnings.
  Full-launcher strict Clippy is blocked by 37 existing findings outside these
  modules (including Windows-only unused imports/dead code and older Clippy
  style findings); no diagnostic was suppressed to claim a clean full-app run.
- Desktop `bun run typecheck` passed. Full server/instance/localization selection:
  377 passed across 32 files. The existing shortcut harness used URL `.pathname`,
  which produced `/V:/...` on Windows; its test-only entrypoint now uses
  `fileURLToPath`. No page or Browse install implementation was changed.
