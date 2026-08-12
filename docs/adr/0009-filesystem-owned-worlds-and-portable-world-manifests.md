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

Datapack presentation and mutation are World-scoped. Instance Resource
overviews, installed matching, batch actions, and update snapshots exclude
datapacks even though their file facts remain in the Ledger. The World Module
joins direct entries under a validated `<world>/datapacks` directory to exact
Ledger paths and revalidates the WorldRef and row containment before mutations.
Directory-form datapacks are listed read-only until the Ledger gains explicit
directory ownership.

Datapack install type is explicit user intent and is not inferred from a
provider project's primary classification. Modrinth mixed projects use their
version-level `datapack` loader while CurseForge uses its datapack project class.
Quick selection is permitted only for a provider version explicitly tagged for
the selected World's saved Minecraft version. Other versions remain available
through manual selection and compatibility acknowledgement; provider version
tags do not become filesystem validation rules. Resource browsing persists only
an Instance destination. It never stores a preferred World: each datapack
install selects and validates its World within that install interaction, while
direct row updates pass their exact World target explicitly. Opening provider
details from a managed row may carry immutable source-row identity for
replacement, but it does not preselect a World; replacement applies only when
the user later chooses that same World.

World transfer availability is determined by the filesystem operation itself,
not by whether Vesta observes a source or destination Instance process. A
running process is not a transfer precondition; inaccessible or changing files
fail through the transfer Task's normal copy, verification, or publication
errors.
The same rule applies to datapack publication: observed Instance process state
is informational, while actual filesystem access determines success.

Managed datapacks and companion resource packs share a bundle identity in the
World Manifest. Removing a datapack removes the exact companion file and Ledger
row only when no other bundle in the same World or any other discovered World
may reference its relative path and its content still matches the recorded
hash. Ambiguous topology, corrupt/future metadata, and content mismatch retain
the companion. Generic Instance Resource actions refuse to remove or disable a
linked companion; bundle lifecycle is initiated from the owning World.

World and bundle mutations use Task Manager conflict keys for an exact World,
an Instance's `saves`, and an Instance's `resourcepacks`. A Task reserves its
complete normalized key set atomically. This serializes overlapping archive
installs, transfers, datapack publication, toggles, and removals without making
unrelated Worlds wait or allowing a waiting multi-key Task to hold partial
locks. Watcher reconciliation resolves debounced paths from final disk state.

Archive preflight rejects traversal and link entries, Unicode/case-colliding or
non-portable names, excessive candidate counts or expansion, and suspicious
per-entry or aggregate compression ratios. Publication uses an atomic
no-replace rename where the operating system provides one, preserving any World
that appears after preflight rather than overwriting it.

## Consequences

Existing Java folder worlds can be listed without modification and remain
usable outside Vesta. Root `level.dat` is the stable discovery boundary, so
MCRegion, Anvil, custom dimensions, and newer reorganized dimension layouts do
not require version-specific traversal. Installed world archives never overwrite
or merge an existing world. Transfers can preserve or regenerate portable
identity while the Ledger keeps managed component provenance consistent.
The same datapack project can be installed independently in several Worlds, and
an update, toggle, or removal is resolved against only the selected World.
Companion files may be reused across bundles, so their lifetime is reference-
safe rather than coupled to one Instance Resource row action. Concurrent World
mutations are coordinated by logical filesystem ownership, while process state
remains informational.

Standalone Classic and Indev save files, arbitrary NBT editing, deletion,
backups, restore, and staged creation of worlds are outside this decision.

## Related

- Domain vocabulary: `CONTEXT.md`
- World Module: `vesta-launcher/src-tauri/src/worlds/`
- Command Adapters: `vesta-launcher/src-tauri/src/commands/worlds.rs`
- Task Adapters: `vesta-launcher/src-tauri/src/tasks/world_install.rs`
  and `vesta-launcher/src-tauri/src/tasks/world_transfer.rs`
- Installed Resource Ledger: ADR-0004
