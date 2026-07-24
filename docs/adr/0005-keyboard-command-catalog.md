# ADR-0005: Keep Command Execution In Frontend And Persist Keybindings In SQLite

Date: 2026-07-24

Status: Accepted

## Context

Keyboard shortcuts were registered independently by the app entrypoint, page
viewer, and flat navigation controls. This duplicated commands, ignored editable
targets, and provided no persistent user customization or cross-window updates.

Executable functions cannot be safely persisted, while keeping all shortcut
state only in a WebView would make reusable mini windows disagree and lose user
choices between launches.

## Decision

Keep the seam split:

- TypeScript command definitions own stable command and handler IDs, executable
  handlers, availability, labels, categories, ordering, and default chords.
- The config SQLite database materializes that metadata and owns the current
  chord, customization state, explicit unbinding, and availability history.
- Tauri command Adapters reconcile definitions, enforce one app-wide chord per
  command, persist mutations transactionally, and broadcast applied changes to
  every WebView.
- One frontend dispatcher resolves persisted chords to the currently registered
  handler and ignores editable targets and repeated key events.

Shortcuts are app-local; Vesta does not register operating-system global
shortcuts that could fire while Minecraft or another application has focus.
Page-local arrow and roving-focus behavior stays within the owning UI Module.

## Consequences

New global commands require a code definition and handler but do not require a
handwritten data migration. Startup reconciliation inserts missing definitions,
refreshes metadata, preserves user customization, and marks absent definitions
unavailable for downgrade compatibility.

The Keyboard settings page can query and mutate one catalog regardless of which
Vesta window hosts it. Future command scopes would extend this Interface and
must be decided separately.

## Related

- Domain vocabulary: `CONTEXT.md`
- Frontend Module: `vesta-launcher/src/keybindings/`
- Tauri Adapter and persistence policy:
  `vesta-launcher/src-tauri/src/commands/keybindings.rs`
- Persisted schema: `keybinding_commands` in the config database
