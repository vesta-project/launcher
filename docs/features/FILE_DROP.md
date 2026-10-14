# File drops and manual resource imports

## Native delivery is still opt-in

The native Tauri 2 path uses WebView drag/drop events, a single frontend bridge and a central drop-target controller. It is enabled only in a **debug build launched with** `VESTA_NATIVE_FILE_DROP_PROBE=1`:

```sh
# From the repository root
VESTA_NATIVE_FILE_DROP_PROBE=1 bun run vesta:dev
```

Normal release builds do **not** enable native dropping. Setting the variable only while compiling does not embed it into the executable. The retained legacy sniffer is not removed by this resource-import feature; replacement cleanup and packaged-build enablement are separate work. Native and DOM handlers must never both process the same desktop drop.

Actual OS delivery and internal organisation with native dropping enabled require target-machine verification. Browser/unit tests do not establish Windows, macOS or Linux native compatibility.

## Instance-card imports

Instance cards accept `.jar` and `.zip` files through one contained **Add resources** target. Existing group dwell, glow, reduced-motion handling and pointer-driven internal reordering are independent of import processing. Instance preparation states reject drops.

After release, the backend immediately creates an operation notification and inspects private snapshots. Archive contents are not parsed during hover. Straightforward contents route automatically:

| Content | Recognition | Destination |
| --- | --- | --- |
| Mod | Individual valid JAR or unowned JARs inside a ZIP | Instance `mods/` |
| Datapack | Valid `pack.mcmeta` and `data/` | One chosen existing world's `datapacks/` |
| Resource pack | Valid `pack.mcmeta` and `assets/` | Instance `resourcepacks/` |
| Shader pack | `shaders/` with shader source evidence | Instance `shaderpacks/` |
| Java world | Readable `level.dat` or `level.dat_old`, using the existing world inspector | A new folder in instance `saves/` |

One or more enclosing **folders** are supported, including repeated names such as `my-pack/my-pack/*`. Folder names do not determine resource type. ZIPs inside ZIPs are **not** recursively discovered or staged; inner ZIPs belonging to a recognized pack/world remain opaque payloads. Correctly rooted packs remain byte-for-byte ZIPs; wrapped packs are stream-repacked with their selected root at archive root. Worlds are extracted safely as directories, never merged into an existing world.

A coherent pack/world owns its subtree: its incidental JARs or embedded datapacks are not installed separately. Multiple worlds reuse the existing archive-world picker. A datapack batch chooses one world once, using the existing world picker and no-world guidance.

Mixed resource kinds, ambiguous packs (including both `data/` and `assets/`) and inspection warnings trigger a compact review. Unknown layouts are not automatically guessed. Recognized Modrinth/CurseForge modpacks are excluded: they cannot be applied over the target instance, and this dialog does not navigate to a new-instance import. Independent valid resources in the same drop remain selectable. Ordinary new-instance modpack import is unchanged.

Packs are installed, not automatically enabled in Minecraft. Shader-engine installation and loader changes are not authorized by dropping a shader pack. Configuration files, arbitrary folders and non-ZIP archives are not supported by instance-card imports.

## Decisions, tasks and notifications

The backend owns operation IDs, immutable source snapshots and resource candidate IDs. The renderer submits a single-use decision token, candidate ID/type and, for datapacks, a typed `WorldRef`—not an arbitrary destination path.

Pipeline:

**inspect → choose resources/worlds → apply local files → recognize imported sources → plan mod-only required dependencies → obtain consent → queue downloads → summarize**

At most eight manual-drop operations can be pending; inspection is serialized on a separate cancellable coordinator gate. Choice waits occur in the coordinator, outside TaskManager conflict locks and worker permits. Local application uses a Task with the same mod/shader/resource-pack/world/saves conflict keys as provider downloads. Imports wait for both root choice listeners to register before starting backend work. New manual choices are serialized; both choice UIs retire cancelled/expired backend requests. Decisions expire after 15 minutes once presented. Cancellation discards unpublished staging; already published resources remain installed and are reported as such.

Operation notices own stable keys independent of apply/download task notifications. Completion distinguishes additions, byte-identical active mods already present, skipped/failed items, cancellation, and queued dependencies. Queued dependency downloads have their own task notifications; queued is not reported as downloaded.

## Post-import source recognition

Successful local imports are checked against provider-listed artifacts **after publication**, not while hovering or initially classifying archives. Mods reuse their existing reconciliation/dependency path; resource packs, shaders, world-scoped datapacks and worlds receive source enrichment independently. Recognition does not install shader engines, change loaders, create managed bundles/companions, or plan non-mod dependencies.

A provider identity requires an exact primary or alternate advertised SHA-1 match. A CurseForge whitespace-insensitive fingerprint alone is insufficient. Names are not identity evidence, and Smithed does not supply this hash lookup. Recognition means matching provider-listed content, not proving the website a file came from. Provider outages or cancellation leave already imported resources installed and usable.

Installed-file integrity hashes and original-archive hashes remain separate. Rooted packs and selected JARs can match their installed bytes. Wrapped packs retain original snapshot evidence alongside the normalized installed hash; a source-only match does not become ordinary installed-release identity or authorize automatic replacement. Only a sole coherent source candidate can inherit original-container evidence: a mixed bundle's outer identity is not propagated to its children. Datapacks retain their chosen destination type and world scope.

Typed optional `manualSourceEvidence` metadata is persisted with installed resources; optional `archiveEvidence` is persisted in world manifests. Malformed optional evidence is ignored independently, so it cannot hide an installed-resource row or invalidate an otherwise valid world manifest. Unmatched original evidence can survive an offline import/restart without provider IDs. World source identity is populated only after an exact compatible original-archive match. Network requests run outside mutation locks; targets are checked again before late enrichment writes, including rejection of symlinked `.vesta` directories and `world.json` files. The resource, world and datapack views display confirmed source metadata without adding implicit update actions.

## Manual mod dependencies

Copied JARs are identified through existing provider hash/fingerprint reconciliation. Local installation remains successful even when a provider is offline or identification/dependency resolution fails.

**Settings → General → Resources → Manual mod dependency downloads** has three independent policies:

- **Ask each time** (default): ask only when actionable missing required dependencies are found.
- **Always**: queue compatible required additions after identification.
- **Never**: identify the dropped mods but do not plan dependency downloads.

The contextual prompt offers **Download dependencies** / **Keep only dropped mods** and **Remember my choice**. Remembered Download stores `always`; remembered Keep stores `never`; closing or cancelling does not store consent. The provider-browser **Automatically Install Dependencies** preference remains separate.

The manual planner uses authoritative project/peer identities, verified content, enabled state, existing files, version/loader compatibility, and exact pins. Current-batch mods count toward satisfaction. It deduplicates recursive required requirements, bounds recursion, and reports missing metadata or conflicts. Optional dependencies, replacement/downgrade of installed mods, enabling disabled mods and loader switching are not implicit permissions. Approval is revalidated before guarded dependency-only download tasks are queued; dropped roots are never downloaded again.

## Safety and limits

The Rust boundary revalidates sources independently of renderer extension checks. Each operation uses a private empty staging directory. Archives and dropped files are data, never executed by inspection/import.

Limits per inspection:

- 50 sources; 2 GiB per file and 4 GiB total raw snapshots.
- 100,000 cumulative ZIP entries and 64 MiB central-directory data per archive.
- 8 GiB cumulative declared expansion; streamed preparation and bounded evidence reads have an independent cumulative 8 GiB work limit.
- 1 MiB per JSON evidence entry, 8 MiB total JSON, bounded JSON depth/node count.
- 32 world roots and 64 MiB total level metadata.
- Stored/Deflated UTF-8 ZIP entries only; compression-ratio checks reject suspicious expansion.

Classification indexes central-directory paths and reads only bounded evidence entries. It does not inflate every payload to infer type. Selected payloads are streamed/CRC-checked during preparation; selected bundled JARs receive bounded directory validation before coordinator ZIP allocation, without resource inference from their incidental metadata. Rooted pack validation preserves the original archive bytes. Inner ZIP payloads are not parsed for resource discovery.

Safety checks reject traversal, absolute/drive/UNC/backslash paths, unsafe portable filenames, links/special files, encrypted entries, duplicate normalized destinations, Unicode/case and file/directory collisions, split archives and trailing data. Destination/world ownership is checked again before publication. Publication uses private same-directory staging and no-clobber names; existing files/worlds are not overwritten. Disk-space checks are advisory; actual I/O errors remain authoritative. Routine diagnostics do not include dropped absolute paths.

## Code entry points

- Delivery/controller: `src/utils/file-drop/`, `ui/drop-zone/`, `ui/drop-target/`.
- Card adapter: `src/utils/dropped-resources.ts`.
- Root choices: `src/stores/manual-resource-drops.ts`, `src/components/resources/ManualResourceDropDialog.tsx` and existing world dialogs.
- Commands/coordinator: `src-tauri/src/commands/file_drop.rs`, `resources/manual_drop.rs`.
- Inspector/preparation: `src-tauri/src/resources/drop_archive.rs`, shared `worlds/archive.rs` safety checks.
- Strict dependency planning: `src-tauri/src/resources/manual_dependencies.rs`, reconciliation evidence in `resources/reconciliation.rs`.
- Source enrichment: `resources/source_enrichment.rs`; strict artifact resolution in `resources/reconciliation.rs`.
- Persistence: `manual_mod_dependency_policy` config column (migration `2026-10-12-000000_manual_mod_dependency_policy`); typed installed-resource `manual_source_evidence` (vesta migration `2026-10-13-000000_manual_source_evidence`); optional world-manifest `archiveEvidence`.

## Inspection performance

Manual inspection shares its validated entry inventory and bounded world evidence with the world summarizer. World ownership/size aggregation no longer reopens every ZIP entry for every world. Buffered central-directory reads and raw metadata readers avoid unnecessary decoder setup for non-evidence entries; private snapshots and selected payload validation remain mandatory.

Local measurements on 2026-10-13 used synthetic Stored ZIPs in a debug build, median of five inspections, on the shared macOS development machine. They exclude application, provider requests and enrichment:

| Worlds (entries) | Manual inspection before → after | Standalone world inspection before → after |
| --- | --- | --- |
| 1 (501) | 100.161 → 45.743 ms | 43.545 → 28.424 ms |
| 8 (4,008) | 733.797 → 270.872 ms | 449.228 → 132.882 ms |
| 32 (16,032) | 8,853.402 → 1,057.546 ms | 7,806.463 → 495.744 ms |

A diagnostic run confirmed 16,032 ownership assignments and only 32 bounded evidence reads for the 32-world manual inspection. Byte-heavy and entry-heavy results varied materially across reruns, including slower after-runs, so these measurements do **not** establish a general ZIP-speed claim. Release builds, actual-device disks and cold-cache behavior remain unmeasured.

To rerun the ignored benchmark from the repository root:

```sh
cargo test -p vesta-launcher benchmark_archive_inspection -- --ignored --nocapture --test-threads=1
```

Set `VESTA_ARCHIVE_TIMING=1` at debug-app startup for path-free archive phase durations and entry/evidence/byte counters. This diagnostics flag does not enable native drops; `VESTA_NATIVE_FILE_DROP_PROBE=1` remains separate. Cancellation is cooperative in long snapshot/index/evidence/ownership loops, not preemptive inside third-party ZIP construction or bounded NBT parsing.

## Verification

Run frontend tests/build/typecheck and focused Rust resource, config and world tests. Fixtures cover rooted/folder-wrapped resources, opaque owned inner ZIPs, world ownership, malformed/unsafe ZIPs, no-clobber publication, duplicates, strict dependency conflicts, expiry, stale decisions and preference rollback/synchronization. Generate portable inert fixtures with `python3 -I scripts/generate-drop-fixtures.py --performance` from the repository root; see [the device testing checklist](FILE_DROP_TESTING.md) for expected outcomes and platform-specific startup commands.

On a target desktop, launch with the opt-in flag and drop real fixtures onto grouped/ungrouped cards. Verify on-disk contents and resource/world views, world selection, dependency consent/remembering, cancellation, notification completion, internal reordering, modal blocking and reduced motion. Do not remove the legacy delivery path or enable packaged native drops solely because automated tests pass.
