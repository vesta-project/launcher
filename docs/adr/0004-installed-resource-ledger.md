# ADR-0004: Put Installed Resource Facts In The Tauri Resource Ledger

Date: 2026-07-09

Status: Accepted

## Context

Installed Resource rows were changed directly by resource commands, watcher
discovery, and download completion. Each caller had to know local path
normalization, `.disabled` naming, row removal, remote identity, and modpack
provenance details.

## Decision

`vesta-launcher/src-tauri/src/resources/ledger.rs` owns the local file and
`installed_resource` row invariants: recording manual and remote files,
recording downloaded files, toggling enabled state, file-plus-row deletion,
dead-row cleanup, path unlinking, provenance clearing and diffs, and
launch-resource presence lookup.

The Resource Watcher remains the discovery Adapter. Resource Manager remains
the remote metadata Adapter. Installer, import, and download Modules keep their
workflow and file-transfer behavior, then call the Ledger to record the final
local fact.

## Consequences

The Ledger gives commands, watcher, and download completion one deep Interface
for installed Resource facts. Remote lookup, manifest matching, event policy,
and notification policy remain outside this seam, so the Ledger does not become
an application workflow Module.

Modpack override conflict resolution remains outside the Ledger because it
combines remote version comparison, notifications, and filesystem mutation.

## Related

- Domain vocabulary: `CONTEXT.md`
- Tauri Module: `vesta-launcher/src-tauri/src/resources/ledger.rs`
- Discovery Adapter: `vesta-launcher/src-tauri/src/resources/watcher.rs`
- Command Adapter: `vesta-launcher/src-tauri/src/commands/resources.rs`
