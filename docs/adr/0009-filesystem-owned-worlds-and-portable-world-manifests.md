# ADR-0009: Keep Worlds Filesystem-Owned With Portable Vesta Manifests

Date: 2026-08-09

Status: Accepted

## Context

Java Edition worlds are directories whose contents and internal dimension
layouts vary across Minecraft releases. Vesta needs to discover existing worlds,
install downloaded worlds and datapacks, and transfer worlds between Instances
without treating volatile NBT fields or database rows as the authoritative world
record. Resource providers also need to describe artifacts without knowing the
filesystem destination selected by the user.

## Decision

World directories under an Instance's `saves` directory are filesystem-owned.
The World Module discovers only immediate child directories with a readable root
`level.dat`, falling back to `level.dat_old`, and otherwise preserves every
internal file verbatim. No World database table is introduced.

The optional `<world>/.vesta/world.json` manifest stores only Vesta identity and
portable provenance. It is created on the first Vesta management action, never
during listing. Derived display facts such as size, date, icon, and name remain
outside the manifest. Unknown manifest fields and schema versions never hide a
world, and corrupt manifests are preserved diagnostically before a management
action recreates them.

The Installed Resource Ledger continues to own installed files and their rows.
It records world-scoped datapacks and instance-scoped companion resource packs,
including subtree remap and clone operations during world transfers. The World
Module owns discovery, archive validation and extraction, portable metadata,
and move/copy/duplicate workflows. Resource sources remain unaware of local
destinations; the shared installer resolves provider-neutral artifacts against
an explicit Instance or World target.

World transfer availability is determined by the filesystem operation itself,
not by whether Vesta observes a source or destination Instance process. A
running process is not a transfer precondition; inaccessible or changing files
fail through the transfer Task's normal copy, verification, or publication
errors.

## Consequences

Existing Java folder worlds can be listed without modification and remain
usable outside Vesta. Root `level.dat` is the stable discovery boundary, so
MCRegion, Anvil, custom dimensions, and newer reorganized dimension layouts do
not require version-specific traversal. Installed world archives never overwrite
or merge an existing world. Transfers can preserve or regenerate portable
identity while the Ledger keeps managed component provenance consistent.

Standalone Classic and Indev save files, arbitrary NBT editing, deletion,
backups, restore, and staged creation of worlds are outside this decision.

## Related

- Domain vocabulary: `CONTEXT.md`
- World Module: `vesta-launcher/src-tauri/src/worlds/`
- Command Adapters: `vesta-launcher/src-tauri/src/commands/worlds.rs`
- Task Adapters: `vesta-launcher/src-tauri/src/tasks/world_install.rs`
  and `vesta-launcher/src-tauri/src/tasks/world_transfer.rs`
- Installed Resource Ledger: ADR-0004
