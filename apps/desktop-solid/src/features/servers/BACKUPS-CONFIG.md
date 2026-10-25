# Backup setup integration

The implementation intentionally leaves `src/pages/**` to the UI agent.

- `serversApi()` now provides `backupConfiguration(connectionId)` and
  `backupConfigure(connectionId, draft, expectedRevision, intentId)` in native and
  browser fixture modes. DTOs/defaults are in `native-backups-config.ts`.
- Keep the Backups entry reachable when `backupsConfigured` is false and the user
  has `backups.configure`. That flag describes the effective profile set, not the
  availability of setup. Owners and administrators have the capability; maintainers
  and viewers cannot configure. Existing backup view/create permissions still apply.
- Load configuration before editing. An unconfigured instance returns `profiles:[]`,
  `revision:null`, and its fixed repository location with `initialized:false`.
- Build a setup wizard showing storage location/readiness, online versus stopped
  mode, retention and scope. `defaultBackupProfile()` includes the entire game,
  including custom worlds and configs. Empty include means all game files; nonempty
  include lists literal relative roots. Exclude adds gitignore-subset patterns.
- Save with `initializeRepository:true` for first-time setup. Repository path and
  S3 credentials cannot be edited remotely. No backup runs automatically. Online
  mode requires separate supervision and a running game; stopped mode requires an
  already stopped game. The save does not start or stop Minecraft.
- The profile editor submits the complete set: add to create, replace to update or
  rename, omit to delete. Saving `profiles:[]` disables backups and preserves snapshots.
  Reusing a deleted name makes its old snapshots visible again. Explain retention
  pruning and that changing profile names leaves Automation references unchanged.
- Pass the loaded revision and a fresh intent ID for each edit. Retry an identical
  uncertain request with the same intent ID; changing its payload requires a new ID.
  `stale_target` means reload before resubmitting. After success invalidate configuration,
  overview and storage resources and load the current configuration. A replay returns
  the original accepted revision, which can be older than current state. Native updates
  the connection's `backupsConfigured` from the agent's server projection after saving.
- Scheduling remains in Automation (`scheduleOwner:'automation'`): offer a link to
  an interval/cron workflow with a backup step, gated by `automation.manage`. Do not
  add schedule fields to backup drafts.
- Preview setup with `createFixtureServers({backupsConfigured:false})`: this makes
  the owner connection `fixture-survival` unconfigured. The default fixtures also
  include an unconfigured viewer connection to exercise permission gating.

Native commands: `server_backup_configuration` and `server_backup_configure`.
Wire routes: GET/PUT `/api/v3/manage/backups/config`; PUT uses normal Idempotency-Key,
`expected_revision`, full profiles/limits and `initialize_repository`.
