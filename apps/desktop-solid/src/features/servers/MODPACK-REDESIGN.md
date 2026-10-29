# Modpack redesign backend handoff

Implemented on agent `feat/launcher-compat` and launcher `feat/frontend-rewrite`.
The approved design is `docs/architecture/SERVER_MODPACK_REDESIGN.md`.
No pages or browse feature files were edited.

## Available contracts

All methods below are spread into `serversApi()` through `native-pack.ts`, including
browser fixtures. Existing pack and sync methods remain supported. Revision values
remain decimal strings. Keep the original payload and durable intent for retries.

| Method | Agent route | Result |
| --- | --- | --- |
| `packProviderPublish(id, request, intent)` | POST `pack/provider/publish` | published/minimum revisions |
| `packFileRead(id, request)` | POST `pack/files/read` | revision, SHA-256, base64 UTF-8 text |
| `packFileMutate(id, request, intent)` | POST `pack/files/mutate` | updated draft |
| `packArchiveInspect(id, uploadId)` | POST `pack/archive/inspect` | archive inspection |

### Provider mode

`packDraft(id).providerPack` is null/absent for custom releases or
`{provider, projectId, versionId}` for a provider catalogue release. Show a provider
Overview, read-only Content, and Versions when this field is present.
`packProviderPublish` takes the provider reference, `expectedRevision` (published),
`draftRevision`, `requiredUpdate`, and `acknowledgeLowerVersion`. The current draft's
name/display version supply presentation. Publication stores a small native catalogue
pointer only; it does not download or host the provider archive or entries. It reuses
the existing signed release policy and native provider modpack resolution pipeline.
Selecting another provider version publishes a new monotonic revision. Required
publication advances the minimum. Authority and draft/release revisions are checked
again at commit. Existing custom drafts remain intact.

Customize uses existing `packImport({source:'published',expectedRevision,
expectedPublishedRevision},intent)`. For a provider catalogue this fetches and imports
the provider pack rather than copying a stale custom workspace snapshot. Publication
of that draft through `packPreview`/`packBuildPublish` switches back to hosted custom
mode. Customize does not publish automatically. The active provider release remains
active until explicit custom publication. The durable draft revision and
`pendingPublication` flag expose the customized draft after reload; show its editor
while keeping the active provider release visible separately.

### Override files

List from `packDraft(id).draft.manifest.overrideFiles ?? []`. Each row contains
`root`, `path`, `sha256`, `trashed`. Roots are `overrides`, `client-overrides`, and
`server-overrides`; paths are relative to the selected root. A null hash is an explicit
directory. Hide trashed rows from the normal listing; bytes and metadata are retained.
Implicit parent directories can also be derived from paths.

`packFileMutate` takes `{expectedRevision,change}` with operations:

- `write`: root, path, contentBase64 (UTF-8 text).
- `attach`: root, path, sha256 from a completed non-archive `uploadPackBytes` upload.
- `mkdir`: root, path.
- `rename`: root, path, destination (same root, includes descendants).
- `trash`: root, path (includes descendants).

All operations advance the same draft revision and use durable exact-payload replay.
Read requires root, path and expectedRevision. Binary files should use chunked upload
and attach. Text is limited to 1 MiB; individual binary blobs to 16 MiB; all retained
workspace blobs to 64 MiB; override metadata including trash to 256 rows. HTTP body
limits may require chunked upload even for text. Paths use the existing portable game
file allowlist, reject traversal, case aliases, reserved paths, and file/directory
collisions. Paths never become direct filesystem write authority.

Publishing overlays shared overrides, then client overrides, over client entries.
Server-only overrides are retained in the draft/published metadata and excluded from
client artifacts. Linked pack sync consumes the resulting normal Vesta file index,
including executable-change consent and ordinary ownership/conflict checks. Empty
directories are workspace metadata; they are not included in the client artifact.
The preview reports rooted override paths and marks override changes in its metadata
diff. Existing custom packs with no overrideFiles deserialize unchanged.

### Archive inspection and custom import

Use existing `uploadPackBytes(api,id,bytes,true,intent)` and pass the completed
receipt's uploadId to `packArchiveInspect`. Inspection is read-only and does not consume
the upload or advance the draft revision. It reuses authenticated upload ownership,
bounded ZIP expansion, path validation, and the actual import parser.

The result includes format (`mrpack`, `curseforge`, `zip`, `vesta`), manifest (name,
Minecraft and loader versions), entryCount, providerEntries, unresolvedFiles, rooted
overrides, providerPack, and warnings. Standard manifests identify individual mods;
they do not establish the identity of the entire pack. Only offer Link provider when
providerPack is non-null. Exact whole-archive Modrinth SHA-512 identification can
produce that reference. CurseForge manifest mod IDs alone cannot establish the pack
project/version; that case offers custom import only.

Import hosted custom with the existing uploaded_archive `packImport` request and the
reviewed draft revision. Standard archives preserve the three override roots. Plain
ZIPs accept supported mods/config/resource paths, retain their bytes as uploaded
entries, and use the server Minecraft version; their loader remains none because it
cannot be established from file names. Show the runtime-inferred warning. Unsupported
files and unsafe paths refuse; imported URLs never become download authority. Cancel
unused uploads with packUploadCancel. Import does not publish automatically.

## Fixtures and verification

`fixtures-pack.ts` exports `seedRedesignWorkspace('provider'|'overrides')` and
`seedArchiveInspection('mrpack'|'curseforge'|'zip'|'vesta')`. The normal fixture API
implements provider publication, file operations, and inspection of completed archive
uploads. Fixture parsing is deterministic; actual ZIP parsing is covered by agent Rust
tests. `checks/servers-pack-files.test.js` covers the new UI contract behaviors.

Agent workspace tests include pointer policy/replay, retained trash, client override
precedence, server-file exclusion, path collisions and plain ZIP import. Native client
tests and clippy, launcher check, frontend typecheck and server/localization tests are
run separately. The full frontend suite has an existing console HOT_SCOPE_TIME budget
failure under compilation load; diagnostic thresholds were not changed.

## Install on this server (item 4)

`packInstallPlan(id,{source})` calls POST `pack/install/plan`; `packInstallApply(id,
request,intent)` calls POST `pack/install/apply`. Native commands are
`server_pack_install_plan` and `server_pack_install_apply`. Both are in serversApi().
Only owner/administrator with content.install and pack.edit may use them; file scope
permissions are checked again when staging and at restart. No UI pages were changed.

Source is one of `{source:'provider',provider,projectId,versionId}`,
`{source:'uploaded_archive',uploadId}` (complete archive upload; inspect first),
`{source:'draft',revision}`, or `{source:'published',revision}`. Note the nested DTO:
`packInstallPlan(id,{source:{source:'draft',revision:workspace.draft.revision}})`.
Planning does not edit the workspace or consume the archive upload. Provider archives
and entry downloads use authenticated provider resolution and digest checks.

Only enable Apply when `valid` is true. Review `minecraftVersion`, `software`, `loaderVersion`, `softwareSwitchRequired`,
`files`, `skipped`, `warnings`, and `backupRecommended`. Software/version switching
uses the existing softwarePlan/softwareApply review flow FIRST: pass the required
software, Minecraft version and loader version, review Java/warnings, confirm it and
wait for its job to finish. Then apply this pack before plan expiry (15 minutes), or
replan. Apply rechecks installed Minecraft/software/loader, including inside its
transaction. A plain archive with mods infers the current installed loader and warns. If no mod
loader/version is established, valid is false: choose software first, then replan.

Each file exposes its pinned SHA-256, expected existing SHA-256 and conflict category
(project_version, same_filename, unidentified_jar). A project version replacement
keeps the existing destination path. Supply exactly one `{path,choice:'replace'|'keep'}`
for each conflicting file in `choices`; no extra or duplicate choices are accepted.
Keep skips that incoming file. Other existing content is retained. Unidentified content
outside a colliding destination is reported as a retained-content warning. Unknown
server-side metadata includes the file with a warning; explicit client-only entries
and resource/shader packs are excluded. Shared overrides are applied first, then server
overrides. Client overrides are excluded. Unsafe/protected paths are refused.

Apply payload: `{planId,confirmationToken,choices,setAsModpack}`. Default the checkbox
`setAsModpack` ON. Preserve this exact request and durable intent for retries. Result:
`{state:'staged_until_restart',pendingIds,modpackRevision}`. Files are inserted as one
bounded transaction into the existing content queue even when the server is stopped;
restart applies them through the file journal with preconditions, trash and audit.
Show the returned pending IDs with existing content cancel/restart controls. Restart
can refuse changed files or revoked authority; report the content error and replan.
Limits: 128 pending files, 64 MiB per reviewed pack, existing queue 128 MiB total,
16 MiB per file, eight retained plans. Cancel unused uploads separately.

Optional assignment is a resumable SECOND step after atomic file staging. Provider
sources publish a provider pointer; archive/draft sources publish a hosted custom pack;
an already published source keeps its existing release. This also requires the normal
pack build/publish permissions and complete client publication metadata. Publication
can refuse lower display versions or incomplete client dependencies. If assignment
fails, files remain staged: retain intent and retry, or manage/cancel pending content.
Do not present assignment and file installation as a single atomic publication.
Concurrent draft/release edits cause a conflict rather than being overwritten.

`seedPackInstallPlan('provider'|'archive'|'conflicts'|'software_switch')` supplies review
fixtures. `checks/servers-pack-install.test.js` covers fixture review and exact replay;
the agent file test covers real override precedence, token/version rejection, durable
staging while stopped, restart application, and request mismatch rejection.

## Validation results

- Agent focused workspace: 17 passed, including a built-archive byte check proving
  client override precedence and server-only exclusion. Final archive parser recheck:
  four passed, including CurseForge modlist metadata.
- Agent control broad parallel run: 1,033 passed, 34 failed, two ignored. Every one
  of the 34 failures passed on a serial recheck. Failures were gzip admission or
  player/runtime/startup timing assertions under parallel contention. No thresholds,
  assertions, or unrelated runtime/file implementations were changed.
- Agent transport: 47 unit and 122 HTTPS tests passed; one manual laboratory ignored.
- Agent control/transport all-target clippy with `-D warnings`: passed.
- Native server client full suite passed; the added wire migration/closed DTO test
  also passed on its focused recheck. Native all-target clippy: passed.
- `cargo check -p vesta-launcher`: passed with existing unrelated warnings.
- Frontend typecheck and focused pack checks: passed (10 tests).
- Full servers/localization selection: 366 passed, one console HOT_SCOPE_TIME
  failure (8 ms memo budget); it also reproduced in an isolated run while Rust
  validation was active. The installed Solid repair guide was read. No console
  implementation, diagnostics, or page changes were made for this task.

### Item 4 verification (2026-10-29)

- Control broad run: 1,067 passed, two failed, two ignored. One failure was the
  new protected-path regression test before the explicit allowlist fix; both it
  and the content-download admission failure passed focused rechecks. Pack-focused
  selection: 59 passed. Final install regression pair: two passed. Control
  integration targets: 28 passed.
- Control/transport and native client all-target clippy with `-D warnings`: passed.
- Native client full suite and install wire/path preservation tests: passed.
- Launcher cargo check: passed with existing unrelated warnings.
- Frontend typecheck: passed. Focused pack checks: six passed. Full expanded
  servers/localization selection: 368 passed, one existing console HOT_SCOPE_TIME
  failure; isolated recheck reproduced the 8 ms console-check:rows budget failure.
  No diagnostics, thresholds, console files, pages, or browse files were changed.
- Real-provider/live-server acceptance remains a separate end-to-end check.
- Transport recheck, serial: 47 unit tests and 122 HTTPS tests passed; one manual
  laboratory test ignored. The initial parallel HTTPS run had 25 timeout/pressure
  failures; the complete serial recheck passed without changing thresholds.

Backend commit: `a2c8153567631b6dc07eab73f9078c05aded3dc5`.


## Correction implementation checkpoint (2026-10-29)

This checkpoint is **not the complete redesign**. Do not enable the `server-modpack`
player-offering choice yet: the independent delivery release stream remains to be
implemented. The agent fails closed with `pack_unavailable` for that mode rather
than serving an unrelated custom publication. Automatic provider update discovery,
archive-backed player delivery, and full removal of the old sync UI contract remain.

### Contracts now available

`packDraft` returns additional `serverModpack` (nullable) and `clientPack` fields.
`serverModpack` contains `source` (same discriminated source as install planning),
`displayVersion`, `files` (literal path -> SHA-256 ownership map), `state`
(`staged_until_restart` or `installed`) and `pendingIds`. Source version and file
ownership are persisted independently of the custom draft/publication. State only
becomes installed after every associated content intent is applied.

`packInstallPlan` / `packInstallApply` now link or update the **server installation**.
Each reviewed file has `operation` (`added`, `updated`, `unchanged`); `removed` is an
array of `[path, expectedSha256]` pairs. Only prior pack-owned paths absent from the
new pack are removed, through the restart journal with hash preconditions and trash.
User additions are retained. Modified owned files require review for replacement;
a removal encountering a local edit refuses at restart and retains the file.
`setAsModpack` is a deprecated compatibility input: it no longer publishes or
replaces a client draft. Apply returns `serverModpack`; `modpackRevision` is null.

`serversNative.serverModpackUnlink(connectionId, removeOwnedFiles, intentId)`
unlinks and either keeps files or stages deletion of recorded pack-owned files.
It leaves a custom client offering intact; a following offering becomes `none`.
`serversNative.clientPackMode(connectionId, {mode, requireUpdate}, intentId)` stores
`none` / `server-modpack` / `custom` separately. Publish authority is required;
`requireUpdate` also requires `pack.force_update`. New state defaults durably to
`none`. `none` suppresses v2/v3 player pack status/downloads while retaining custom
publication history. Custom publication/minimum-revision behavior stays intact.

Migration creates no server link without a verified installation receipt. Existing
publications, including provider pointers, remain custom offerings. No legacy
provider pointer is claimed as an installed server pack. Existing file provenance
is not silently adopted as pack ownership. Existing plans without a link snapshot
may conflict and must be reviewed again.

### Exact page handoff (no pages edited in this checkpoint)

- Separate server installation/link controls from client offering controls. A server
  with neither link nor offering remains fully usable. Use `serverModpack`, not
  `providerPack`, as the server installation identity.
- Server Overview: show source and selected version; show restart-pending separately
  from installed. Review updates using added/updated/removed entries and overrides.
  Offer unlink with explicit keep/remove-owned choices. Inventory rows can display
  a linked-pack ownership badge from `modpackOwned`.
- Client settings: show `none` and `custom`; retain a disabled/pending
  `server-modpack` choice until delivery completion. Preserve the custom workspace
  when changing modes. Required publication/minimum-revision controls belong to
  custom; following mode will expose only the require-players-to-update policy.
- Remove the install dialog's "also set as modpack" option. Installation now creates
  the server link and never publishes a client offering.
- Instance linked-pack UI: recognize `modpackPlatform === 'server'`, with modpackId
  = server ID and modpackVersionId = installed server-offering revision. TLS
  fingerprint, connection and rollback high-water marks remain in the protected
  adapter receipt. Do not offer provider browsing for this source.
- `check_modpack_update` now dispatches server links through signed server checks
  and returns the existing version/update contract (`release_type` is `required`
  or `optional` for a server). Verification/offline failures remain errors.
  `start_modpack_update` returns `modpack_review_required:<JSON preview>` for a
  server source; present its file review and use `packSyncApply` with explicit
  consentRevision. Retain native launch blocking and never synthesize consent.
  The compatibility adapter still owns apply/polling; this is not yet complete
  retirement of `native-pack-sync`.

Fixtures: `seedServerModpackModel('none' | 'linked-follow' | 'linked-custom' |
'unlinked-custom')`; existing `seedPackSync('optional_update' | 'required_update')`
provides server-sourced instance policy states. `servers-modpack-model.test.js`
checks independence, install-without-publication, unlink, and required-update policy.

### Remaining backend implementation before acceptance

1. Independent player offering release selection, including provider ID-only
   catalogues following the linked version and uploaded-archive client artifacts.
   Preserve custom publication history and monotonic signed rollback policy across
   mode switches; do not reuse the custom release as a server-link publication.
2. Latest provider-version discovery/status and installed-vs-staged source identity
   during an update (this checkpoint exposes the selected source plus pending state).
3. Finish the common linked-pack review/apply contract and migrate the legacy
   receipt/metadata lifecycle, including unlink and recovery, then retire separate
   server sync controls in pages.
4. Real-provider and live-server acceptance after these remaining changes.


Checkpoint launcher validation:
- `cargo check -p vesta-launcher` passed with four existing launcher warnings and
  one existing piston-lib warning.
- Full `vesta-server-client` suite passed, including the new owned-path wire test;
  all-target client clippy with `-D warnings` passed.
- Desktop typecheck passed. Expanded servers/instance/localization run: 404 passed,
  one `HOT_SCOPE_TIME` console-check:rows failure (8.1482 ms against 8 ms).
  The Solid repair guide was consulted; the real servers-reactivity test file
  passed all nine checks in isolation without threshold or console changes.
- Focused pack/model/install/sync/workspace checks: 22 passed.
- No page or unrelated user changes were staged.

## Resume checkpoint: installed identity and update discovery (2026-10-29)

This remains an incomplete implementation checkpoint. Player server-modpack delivery
still fails closed. No files under src/pages/** were edited.

### Added contracts

serverModpack.installed and serverModpack.pending are nullable
{source, displayVersion} identities. Existing top-level source/displayVersion remain
the selected target for compatibility; do not label them as installed. During an
update installed stays at the preceding confirmed version; pending identifies the
reviewed incoming version and state remains staged_until_restart. Once EVERY
associated content intent is applied, installed becomes the target and pending is
null, including after reopening the workspace. Initial installation has installed
null until completion. Cancelled/missing/failed/partly applied entries never promote.
Legacy installed receipts populate installed on read. Legacy staged receipts with
no preceding-version snapshot return installed null rather than inventing history.

Second install plans and unlink refuse while pending is non-null, preventing orphaned
journal writes or replacement of a receipt before restart. Recovery after cancelling
part of an installation remains unfinished: the receipt stays pending and needs an
explicit transactional cancellation/recovery operation before replan/unlink is safe.
Do not present cancellation as a completed unlink or installed update.

serversApi().serverModpackUpdate(connectionId) invokes native server_modpack_update,
client server_modpack_update(), and authenticated GET
/api/v3/manage/pack/server-link/update (pack.edit). Result is
{installed, pending, available}; available is a nullable provider InstallSource.
Discovery binds metadata to both linked project and current version, considers only
newer publication dates, requires current server Minecraft and exact loader, and
skips unavailable downloads. Fixed provider endpoints have a 20-second deadline;
installation identity/authority is rechecked after fetching. Provider failures stay
errors. Pending suppresses network discovery; non-provider links have available null.
Candidates must still pass packInstallPlan software/file review and apply.

Discovery uses the existing bounded metadata adapter: at most 256 Modrinth rows and
the first 50 CurseForge files. Pagination and live-provider acceptance remain.
available null means no candidate in that bounded response, not proof that the
complete provider history was searched.

### Exact UI handoff changes from the preceding checkpoint

- Server Overview: use installed.source/displayVersion for the installed section;
  installed null means no confirmed version. Show pending separately with restart
  and pendingIds. Applying a plan must not replace the installed version label.
- Check for updates calls serverModpackUpdate. Review update is available only when
  available is non-null. Pass that source to packInstallPlan, retaining software
  switching first, file conflicts, removals and choices. Show metadata errors with
  retry. Suppress second install/unlink while pending. Do not claim cancelled pending
  work has been recovered.
- Browser fixtures retain both identities. fixtureRestartServerModpack(id) is a
  fixture-only helper simulating successful restart; discovery returns a deterministic
  next provider version after restart.
- Client settings: keep server-modpack disabled/pending. Custom/none are unchanged.
  Required-update launch blocking and signed binding/high-water verification remain.
- Instance linked-pack UI is unchanged: start_modpack_update still emits
  modpack_review_required and the compatibility packSyncApply path remains.
  This does not complete the common review/apply lifecycle.

### Exact remaining implementation

1. Independent player-offering artifact/revision storage and monotonic signed
   selection across custom/follow/none switches. Retain client manifests/blobs from
   archive installs beyond upload/plan lifetime. Publish archive-backed hosted
   releases and provider ID-only catalogues from the confirmed installed identity
   after restart. Wire required-update policy, downloads, unlink and old-client
   behavior; add end-to-end transport tests.
2. Provider pagination/live acceptance and recovery of cancelled/failed server
   installs. Installed/pending identity and bounded discovery are implemented.
3. Replace server-specific apply/receipt lifecycle with the existing instance
   modpack-link review/apply pipeline: executable-change consent, journal, rollback,
   unlink and recovery. Preserve protected binding/signatures and required-update
   launch checks. Retire parallel pack sync only once exercised end to end.

Validation results for this resume checkpoint follow below.

### Resume validation (2026-10-29)

- Native client full suite passed, including the installed/pending wire regression;
  all-target client clippy with -D warnings passed.
- cargo check -p vesta-launcher passed with the same four launcher warnings and
  one piston-lib warning recorded at the preceding checkpoint.
- Desktop typecheck passed. Full expanded servers/instance/localization recheck:
  409 passed, zero failed across 36 files. Initial run had 408 pass and the existing
  console HOT_SCOPE_TIME failure (8.2 ms / 8 ms); an isolated run under build load
  also reproduced it. The installed Solid repair guide was read; no diagnostic,
  threshold, console or page code was changed. Focused model/install: six passed.
- V: filled while linking broad Rust validation. Final agent/client builds used
  temporary C: targets with dev/test debug info disabled and incremental disabled.
  No Cargo profile, dependency, or test assertions were changed. Only generated
  artifacts from this turn were removed to reclaim working space.
- Agent control unit suite: 1,074 passed, one failed, two ignored. The sole failure
  is the previously recorded original-v8 host fixture at host_tests.rs:729 with
  state_migration_failed. Both new identity/journal and provider-discovery
  regressions passed. All six control integration targets passed (28 tests).
- Full vesta-agent tests passed (77 tests across unit/integration targets).
- Control/transport all-target clippy with -D warnings passed.
- Transport: 47 unit and 122 HTTPS tests passed; one manual laboratory test ignored.
  vesta-dev: eight passed, one manual ignored. HTTPS was run serially.
