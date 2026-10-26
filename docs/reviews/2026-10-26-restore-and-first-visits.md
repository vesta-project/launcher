# Restore and first visits, 26 October 2026

## Previous installations

The original baseline stores its launch document but has no managed artifact hashes or software/version label. It must not be presented as a verified installation rollback. The agent now exposes `previous_restorable`, rejects ordinary rollback without artifact evidence, and checks the same condition in the worker. The launcher hides the unknown/unverified previous-installation row and Restore action. Managed candidates retain their exact software/version/build label and are hash-checked before activation.

Interrupted changes still need an escape route. Only while recovery is required may the old unverified launch document be reapplied. The UI calls this "Recover the saved launch configuration?" and explicitly says it does not restore or verify old software files. This preserves recovery without advertising a normal installation restore. A successful recovery keeps the existing world, settings, mods and plugins.

## Player visits

Added the distinct `player_first_joined` trigger, name/UUID event context and "Welcome new players" template. The existing empty-to-occupied trigger now has separate wording and a real local console producer, as does the final-player-leaving trigger.

The agent imports existing world player-data/stat UUID filenames incrementally, persists join history by UUID, and atomically records visits with matching workflow runs. Duplicate log lines, reconnects and renamed accounts do not create new visits. Missing identity evidence or a console gap suppresses classification rather than guessing. There are no identity-service requests or player-list commands.

See the agent's `docs/operations/player-join-automation.md` for bounds and uncertainty behavior. This is recorded history plus available world evidence, not a way to reconstruct visits whose history was already deleted before Vesta observed the server. Command placeholder substitution is not added; template commands remain literal.

Validation: 53 automation/backend tests, 10 software/restore tests and 43 focused frontend tests pass. Strict backend Clippy, TypeScript, production build and the native launcher library check pass. Frontend lint passes with existing warnings. No running agent or Minecraft process was restarted.
