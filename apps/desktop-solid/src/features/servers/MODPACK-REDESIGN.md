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

## Outstanding approved scope

**Install on this server (item 4) is not implemented in this handoff.** There is no
server whole-pack plan/apply command or conflict-plan fixture. Do not enable that action
from these methods. Existing per-resource server installs remain available.

The current content staging queue admits JARs and datapacks only, and can apply
immediately while stopped. Completing the approved flow requires durable config-file
staging through restart, a bounded reviewed multi-file plan bound to source/upload,
software-plan and file validators, server-side provider metadata filtering (unknown
side included with warning), shared/server override precedence, conflict/backup review,
and optional pack assignment with exact retry outcomes. Simply calling per-entry
contentInstall would not provide those guarantees.

Full end-to-end live acceptance, provider downloads with real credentials, and the
server-install flow remain outstanding.

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
