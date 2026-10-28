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
