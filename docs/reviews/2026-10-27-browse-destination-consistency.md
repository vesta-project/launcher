# Browse destination consistency

Implemented the requested installation behavior without new management screens.

- Plugins and datapacks use the server destination without a destination-choice
  step. Provider client/server side flags apply to mods, not these resource kinds.
- Server-only mods skip that step too. Client-only resources use the saved client
  pack directly; mods compatible with both destinations retain the existing choice.
- A saved unpublished draft qualifies. An untouched revision-zero workspace does
  not. Browse checks setup once per eligible online server per picker opening,
  only for client-capable resources and users with pack-edit permission. It never
  creates a draft or polls for setup. Review rechecks the draft before dependencies.
- Plugins and server-only mods no longer show client instances or a create-instance
  action. Direct install actions also route them back to server selection.
- Datapacks selected for a local instance keep its existing world chooser. For a
  server, the agent already resolves the configured main world. Bukkit dimension
  folders do not add installation destination choices.
- Failed setup reads keep client-pack installation unavailable without blocking an
  otherwise valid server destination. Incompatible destinations are omitted from
  the existing destination screen.

Validation: launcher typecheck passes; 72 focused Browse, pack and localization
tests pass. A server regression test confirms a non-default main-world name is
used for vanilla and supported plugin forks with Nether/End sibling folders.
No real resource installation, live server write or screenshot review was performed.

Resource-pack hosting is still planned separately in the server repository's
`docs/operations/resource-pack-hosting-plan.md`. No hosting destination is exposed
until its service and public download origin exist. Opus retains the UI design work.
