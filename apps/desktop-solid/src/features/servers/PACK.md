# Client modpack workspace UI handoff — Stage 2

`native-pack.ts` is spread into `serversNative`, so all methods are available from
`serversApi()` in native mode and browser fixtures. No pages or
`features/browse/server-install.ts` were edited. The approved model remains in
`docs/architecture/SERVER_RESOURCES_PLAN.md`; agent operations/HTTP details are in
`V:\server-connections-mvp\docs\operations\pack-workspace.md`.

## Editing and release flow

1. Gate the editor/Browse target on `pack.edit` (default owner/administrator).
   `packDraft(id)` returns `PackWorkspace`: draft revision/manifest, authoritative
   server Minecraft version/drift, published/minimum revisions, pending-publication
   and safety-snapshot advice. Client loader choices are
   `none|fabric|quilt|neoforge|forge`, independent of server software. Do not disable
   Fabric because the server is Paper/vanilla. Lock MC to `serverMinecraftVersion`;
   expose an explicit repair when `minecraftDrift` is true.
2. Save with `packWrite(id,{expectedRevision,manifest},intentId)`. Full manifest
   replacement also removes omitted entries. `packDelete(id,expectedRevision,
   intentId)` clears entries/loader while retaining presentation. Both return the
   new `PackDraft`. A stale revision requires rereading and reconciling edits.
3. Read `packSuggestions(id)` explicitly. Suggested missing client requirements,
   newer compatible pins, removed both-side mods and MC drift are never applied.
   Unknown/provider-unavailable metadata remains a warning. Display persistent
   draft/publication mismatch from returned state; require an explicit edit to
   accept a suggestion. A wildcard JAR environment does not itself mean clients
   require the mod.
4. `packPreview(id,draft.revision)` runs the **same native resolver as instances**
   and then the agent's authoritative validation. Required dependencies are
   automatically included/promoted in the preview; optional dependencies remain
   explicit selections. It returns complete manifest, `resolvedEntries`, issues,
   diff, server mismatch suggestions, `reviewSha256`, warnings, `valid`, and safety
   snapshot advice. The draft is unchanged. Block publication for `valid:false`;
   show per-entry errors/manual downloads and uploaded-compatibility warnings.
5. Display the full diff and recommend a configured backup/safety snapshot before
   destructive replacement/publication. For `display_version_lower`, require the
   user's explicit acknowledgement. Then call:

   ```ts
   api.packBuildPublish(id, {
     expectedRevision: preview.publishedRevision,
     draftRevision: preview.draftRevision,
     resolvedEntries: preview.resolvedEntries,
     reviewSha256: preview.reviewSha256,
     requiredUpdate: requiredUpdateChoice,
     acknowledgeLowerVersion: acknowledgedLowerVersion,
   }, intentId);
   ```

   `pack.build` and `pack.publish` are required; Required Update additionally needs
   `pack.force_update`. Optional retains minimum, required raises it to the new
   monotonic release. Refresh workspace and existing pack summary after success.
   The existing `packPublish` remains configured-source publication;
   **use `packBuildPublish` for the draft**. It maps to
   `server_pack_build_publish`, avoiding the legacy Tauri command name.

Keep one durable intent ID and the exact original payload for retries, including
after a draft/release has advanced. A different body must get a different intent.
412 maps to stale target; `pack_release_revision_mismatch`,
`pack_release_version_not_increasing`, `pack_unresolved_file`,
`idempotency_conflict` and `pack_too_large` remain fixed error reasons. No tokens,
API credentials or caller download URLs cross the webview contract.

## Entries, images and import

`PackManifest` carries name/summary/icon/displayVersion/Minecraft/client loader and
entries. Kinds are `mod|resource_pack|shader|datapack|config_override`. Each entry
has a stable ID, portable game-relative path, `required`, environment client/server
requirements and provider/upload/manual source. Draft and published revision
strings must never be converted through JavaScript `Number`.

Use `uploadPackBytes(api,id,bytes,archive,intentId)` for file picker/drop bytes. The
helper hashes immutable input, derives stable upload/chunk intents, sends bounded
32 KiB chunks and finishes with verified bytes. Persist the intent and bytes while
the outcome is uncertain; repeat the helper unchanged to resume. File receipts
provide SHA-256 for `{type:'upload',sha256}`. Icons are PNG/JPEG <=256 KiB; save the
SHA-256 as `manifest.icon`, and read `packIcon(id)` to render
`data:${mimeType};base64,${contentBase64}` after reload. Summary and the embedded
icon also survive publication in the Vesta index.

For a pack archive, use `archive:true`, then
`packImport(id,{source:'uploaded_archive',expectedRevision,uploadId},intentId)`.
Small inline archives can use `{source:'archive',expectedRevision,contentBase64}`.
To start from the active release, use
`{source:'published',expectedRevision,expectedPublishedRevision}`. Import replaces
only the draft. It accepts `.mrpack`, CurseForge ZIP and Vesta/current published
sources. Unidentified/manual files stay visible and block publication until
replaced with a provider pin or an explicit uploaded file. Unsupported/unsafe
paths refuse instead of silently disappearing.

Limits: 256 entries, 16 MiB per embedded file, 64 MiB retained file bytes, 68 MiB
uploaded archive, eight outstanding transfers / 128 MiB reserved. Provider-fetched
archives retain the shared 16 MiB download cap. Cancel an unused transfer with
`packUploadCancel`; do not abandon known pending IDs. Paths use the normal resource
directories, config/defaultconfigs/kubejs/scripts/resources and supported Minecraft
root option files. This is not a general server file upload API.

## Browse “In the modpack” / “Both”

`MODPACK_TARGET_READY` is now exported as `true` from `native-pack.ts`. The UI agent
owns the Browse flag/glue and may enable it after mapping these methods:

- `packDependencies(id,project.source,project.id,version.id)` returns the target
  workspace, resolved root/entry, dependency rows `{project,version,entry,
  required,installed}` and warnings. Use the draft's loader/MC, not server software
  or the local instance loader. Required rows start ticked; optional rows start
  unticked. Every selected row must have a resolved version.
- `packAdd(id,{expectedRevision,provider,projectId,versionId,required:true,
  dependencies:[{provider,projectId,versionId,required}]},intentId)` adds the pinned
  root and chosen dependencies in **one atomic draft edit**. Use target draft
  revision from dependency preview, canonical provider IDs, and explicit required
  flags. This command does not publish or install server files. Retry exact IDs
  and choices with the original intent; do not silently resolve a new selection.
- For Both, use the existing content install commands and `packAdd` as two
  separately reported destinations. They have different revisions and can succeed
  independently. Keep intents for completed destinations and retry the failed one;
  do not tell the user that a draft was changed when only server installation
  succeeded. Preserve capability gates for each destination.

## Fixture coverage and boundaries

`fixtures-pack.ts` exports `seedPackWorkspace` scenarios `fabric`, `paper`,
`vanilla`, `suggestions`, `diff`, `validation_failures`, plus stateful
`createPackFixtures`. Regular fixtures select server software independently of
client loader. They share the actual fixture content inventory, publication
summary/minimum, capabilities, revision conflicts and idempotency. Checks cover
draft CRUD/import, read-only suggestions, dependency preview without draft edits,
added/removed/metadata diffs, compatibility/manual-download/drift failures,
optional/required publication and chunk retry/override attachment.

Archive fixture import uses a deterministic imported manifest; actual archive
parsing/confinement and authenticated publication are covered by agent Rust/TLS
tests. No production provider download or publication is performed by tests.
Linked client-instance sync, signing/server binding, rollback rejection and consent
for executable changes remain Stage 3. Do not promise those guarantees in this UI.

## Validation on 2026-10-26

- Native client: 112 tests passed, seven environment/live tests ignored;
  all-target clippy with `-D warnings` passed.
- `cargo check -p vesta-launcher` passed with existing unrelated warnings.
  `bun run typecheck` passed; all six new pack checks and localization pass.
- Full server/localization selection: 330 passed / one failure, reproduced on a
  second full run. The existing console reactivity test exceeds its 8 ms
  `HOT_SCOPE_TIME` budget in the combined run and passes alone. The installed
  Solid diagnostic guide was consulted; no threshold/diagnostic suppression or
  unrelated console/page edits were made.
- Agent latest workspace tests: 12 passed. Protocol 85, state 114, control
  integration 28, transport 47 unit + 120 HTTPS passed. The full serial control
  unit run had 1,026 passes / two ignored / one simulated-old-schema fixture
  failure; its v8 downgrade fixture was corrected and passed its targeted rerun.
  Touched agent crates pass all-target clippy with `-D warnings`.
- PowerShell does not expand Bun's wildcard itself here. The full selection was
  run with `Get-ChildItem checks/servers-*.test.js` paths explicitly enumerated,
  together with `checks/localization.test.mjs`.
