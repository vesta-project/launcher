# Stopped-server feedback, 26 October 2026

- Overview hides Online Players when Minecraft is stopped.
- Backup retention help now says: "For example, 7 days keeps one backup from each of 7 days."
- Backup profiles describe contents and retention. Automation determines when backups run. Retention selects the newest restore point from each of N distinct days, ISO weeks or months that contain snapshots, plus any configured newest-N rule. Rules combine without duplicating snapshots.
- Regular ZIP and folder datapacks can be enabled or disabled while stopped. A new native command uses the agent's guarded offline endpoint and refreshes world metadata after receiving its durable receipt. Running Minecraft continues to use console commands. Starting/stopping transitions block edits.
- Built-in packs show their saved state while stopped, without an inactive switch. Their lack of an external file does not by itself make them untoggleable; experimental feature flags and built-in requirements need separate handling. No world feature flags are modified.
- First-ever player visits are not supported as an automation trigger. The existing `first_player_joined` enum has no identity/history semantics and currently has no event producer in the host bridge. A genuine first-visit trigger needs authoritative UUID evidence and durable per-world visit history. No new automation event was introduced in this change.

Validation: focused fixture/model/localization tests, production build, TypeScript check and native launcher library check. Agent tests use disposable worlds; the selected-live-world read-only test remains opt-in. No live agent or Minecraft process was restarted.
