# ADR-0006: Batch Resource Reconciliation And Scope Instance Events

Date: 2026-07-27

Status: Accepted

## Context

Modpack installation and Resource Watcher scans identified files one at a time.
Each successful lookup wrote a row and emitted a generic `resources-updated`
event. The instance-details UI responded by refetching both Resource and
Instance state, which repainted the page, reset retained interaction state, and
made large packs perform provider requests and frontend updates proportional to
their file count.

`resource_project` also used a provider-agnostic primary key even though
Modrinth and CurseForge project IDs occupy separate namespaces. Icon downloads
were coupled to text metadata hydration.

## Decision

Add `resources/reconciliation.rs` as the workflow Module between Resource
Watcher discovery, Resource Manager lookup, and Installed Resource Ledger
persistence.

Modpack installation now persists its manifest, prepares local file facts in
one bounded pass, records all local rows through `Ledger::record_many`, emits
one rows event, attaches the watcher without rescanning, marks the Instance
installed, and submits one silent, deduplicated enrichment Task.

Watcher startup scans and debounced filesystem bursts use only the
reconciliation Module's passive discovery phase: stat local files, publish
changed local rows atomically, and emit one rows event. They do not hash files
or contact providers. Remote identification runs only for an install/update
workflow that owns the new files, or when the user explicitly chooses
**Identify Resource** from one unresolved row's action menu. Overview reads
remain side-effect free.

Remote identification uses provider batch Interfaces. Project metadata is
cached without downloading icons. Icons are hydrated only for project refs
reported near the virtualized viewport. Authoritative Modrinth↔CurseForge
links are persisted only from shared file identity or direct provider external
IDs.

`resource_project` identity is `(source, id)`. `resource_project_peer` stores
source-aware peer identity and evidence.

Replace the generic event with:

- `core://instance-resource-rows-changed`
- `core://instance-resource-metadata-changed`

Rows events coalesce into one local request plus at most one trailing request.
Metadata events update source-aware keys. Instance events carry the full
Instance and mutate the retained Instance resource locally; neither event class
causes the other state class to refetch.

The modpack install Task reports post-download work as indeterminate
finalization rather than leaving the progress bar at 100%. Local fact
collection exposes bounded processed/total progress to Task Adapters, which
report indexing counts before atomic Ledger publication. Background enrichment
does not create a user notification; manual row identification exposes its busy
state only in that row's action menu and reports failures through a toast.

Modpack update finalization follows the same local-first boundary. Candidate
hashing is read-only and may occur while the rollback journal remains live.
Only after that journal is durably committed does finalization prune missing and
obsolete bundled rows, publish newly discovered local rows, match each manifest
entry to at most one physical row, and refresh surviving provenance to the new
modpack version. The new Instance version event follows coherent local
publication, and the prepared candidates are then handed to the silent
enrichment Task. Resource and Versioning loads may repeat this repair safely:
absent rows are removed, real duplicates are re-evaluated, and ambiguous
physical disabled files are preserved.

Duplicate resolution prefers the bundled copy without provider release ranking.
A pack version switch also considers disabled bundled mods against enabled
custom duplicates, enabling the pack copy before completion. Ordinary repair
respects a disabled bundled copy. Cross-provider copies are related only by
exact file hash or persisted peer evidence. Updates emit only
`core://instance-updated`; enrichment follows verified enabled/disabled renames
and skips stale prepared files before publishing facts. A losing file is marked disabled only after its rename succeeds;
missing files are pruned instead of acquiring a synthetic `.disabled` path.

## Consequences

Local filename rows remain usable when providers are offline or partially
failing. They remain unresolved until a later install-owned enrichment or
explicit row identification; opening an overview and ordinary filesystem
activity never create retry traffic. Provider traffic scales with batch count
rather than file count, and UI updates scale with completed batches.

The Installed Resource Ledger continues to own only local file/row invariants,
including atomic batch writes. It does not emit events or perform remote
lookup, preserving ADR-0004.

The instance-details Resource table remains mounted during background work.
Scoped refreshes do not replace its established virtualizer or reset the
table's scroll state.

## Related

- ADR-0004: Installed Resource Ledger
- Domain vocabulary: `CONTEXT.md`
- Reconciliation Module:
  `vesta-launcher/src-tauri/src/resources/reconciliation.rs`
- Retained frontend slice:
  `vesta-launcher/src/stores/instance-resource-overview.ts`
