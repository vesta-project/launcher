# Server UI cleanup: checkpoint and non-UI handoff

Updated after the second Claude rate-limit stop on 2026-10-23.
Scope: `launcher` server integration and `server-connections-mvp` only.
The user asked Sol to finish non-visual work and preserve the UI work for Claude.
No new Claude agents were started. No development server was restarted.

## Agent and branch state

- **Behavior investigation / first Sol implementation:** finished. Server commit
  `ea5d5f3` and launcher `c8f25791` are already committed. Includes agent-side
  roster observations, request admission/pacing, console recovery, join address,
  backup configuration and restart-notice observations.
- **Server shell and navigation:** finished and merged through `4ce283c1`.
- **Shared primitives:** finished and merged through `c51701bc`.
- **Sol shell review follow-up:** finished at `44ad5770`, confirmed through T3
  task status. Shared retries/Retry-After, resource-specific pressure, cache
  metadata cleanup, backup polling and router normalization are complete.
- **Settings and People (Claude native agent `a69695ad074e0d026`):** failed at
  the provider rate limit. WIP is preserved as `6ef70d33` on `ui/server-settings`
  in `V:\launcher-wt-settings`. Not merged or visually accepted.
- **Automation (Claude native agent `a6cdaf4c788d17c54`):** failed at the provider
  rate limit. WIP is preserved as `ef8fefb1` on `ui/server-automation` in
  `V:\launcher-wt-auto`. Not merged or visually accepted.
- **Sol takeover:** non-UI follow-up is committed as `e8e3f7b7` on
  `feat/frontend-rewrite`. Layout, styling and visual design were left alone.

The two interrupted worktrees were clean after their WIP checkpoint commits.
Their checkpoints deliberately retain incomplete code; they are recovery points,
not reviewed implementation milestones. Do not cherry-pick them onto main as
finished UI.

## Non-UI follow-up completed

1. **One live roster owner.** The native status worker already reads the agent
   roster and delivers same-count changes using the roster revision. The Overview
   panel now consumes that shared store rather than issuing a second players read
   keyed only on player count. Hover prefetch no longer duplicates roster reads.
   `useServerRoster` consumes existing workspace status demand; it creates no
   additional network request or subscription.
2. **Generation and authority boundaries.** Roster ingestion rejects late replies
   for previous game generations and disconnected/unpaired state. List refreshes
   now use the same snapshot ingestion path, clearing obsolete roster data.
3. **Moderation completion.** Store invalidation occurs when a moderation
   operation first becomes terminal and reconciled, including partial failure.
   Older/duplicate operation observations cannot force repeat list reloads. No
   callback registry or unbounded completion watcher is needed.
4. **Native cache coherence.** Submission acceptance can precede a change by
   minutes. The native client now retires cached projections before delivering a
   newly observed terminal operation. The completion-ID history is capped at 256
   per client. A real HTTPS regression proves a ten-second player-list cache stops
   returning old data after completion, and repeated reports preserve read caching.
5. **Fixture parity.** Browser fixtures replay and update roster events through
   the status topic, matching the native contract without requiring a competing
   `players` call. Unchanged rosters do not emit again on every fixture tick.
6. **Reactive equality.** Installed Solid diagnostics exposed equivalent arrays
   from the pinned-server memo during status updates. Snapshot-list memos now use
   reference-aware array equality, preserving real changes while closing the gate
   on equivalent outputs. The new captured scenarios have no diagnostics.

## Resume instructions for Claude

Merge current `feat/frontend-rewrite` into each UI branch before continuing.
Resolve conflicts deliberately; do not restore pre-takeover store/resource code.

### Settings / People

- WIP TypeScript currently fails with **97 errors** tied to unfinished typed
  localization messages in People, properties and MOTD views. Add the missing
  English messages and generated message IDs using the repository workflow.
  The WIP's 14 pure Settings/MOTD/People model tests pass.
- Keep main's `store.ts` roster and operation-completion implementation. The WIP's
  `syncRoster` duplicates native roster fetching and its `settleWatchers` registry
  has no disposal/removal bound. Remove those additions during merge.
- WIP callers may continue using `serverPlayers` and `useServerRoster` from main.
  Replace `whenOperationSettles`/`refreshListsWhenDone` with main's centralized
  completion invalidation; no extra callback or acceptance-time reload is needed.
- Preserve main's `backupStorageResource` force-refresh behavior and
  `backupSnapshotsResource` when merging `server-resources.ts`.
- Finish Access, UUID identity UX, MOTD consistency, sizing, localization and
  screenshots. The current People model merges by lowercased name; review its
  behavior for renamed accounts/UUID identity rather than treating names as
  authenticated identity.

### Automation

- WIP TypeScript passes. It introduces `pages/servers/automation/` resources,
  templates, triggers, step details and step flow, plus editor/run rewrites.
- Merge the shared retry/cache fixes from `44ad5770`; inspect run polling,
  pagination, terminal refresh and disposal against them before UI acceptance.
- Finish keyboard alternatives to drag/reordering, unsaved-change handling,
  empty states and actual browser/native screenshots. No visual acceptance is
  inferred from a TypeScript pass.

### Original feedback coverage

Main already contains grouped navigation/offline gating, shared cache and hover
intent, one header notice, configured-backup visibility, Minecraft join address,
refresh/restart icons, contextual empty-state primitives and header file saving.
The roster/moderation issues identified in the second review are now fixed too.
The remaining work is chiefly Settings/People/MOTD/UUID and Automation experience,
consistent control sizing in those screens, visual review, and live/native
acceptance of all 16 reported scenarios. Console retention still has finite
bounds; history recovery cannot invent lines already evicted by the agent.

## Fresh verification

- Main TypeScript passes.
- **164 frontend checks pass**, across all ten `servers-*.test.js` files plus
  localization, icon references and log view-model checks.
- **35 native HTTPS checks pass:** 23 in `https`, 12 in `management`, including
  the new asynchronous-completion cache regression.
- `cargo check -p vesta-launcher --locked` passes with four existing warnings.
- Focused Oxlint: zero errors, two existing reactive-callback warnings in the
  Players component. The new captured store scenarios are diagnostic-free.
- Touched Rust files pass rustfmt. Whole-workspace format checking also reports
  pre-existing differences in unrelated files; those were not rewritten.
- Existing shell-test bundles warn about multiple Solid instances because each
  scenario imports another bundled runtime into the test process. This is a test
  harness limitation, not visual/native acceptance evidence. Isolate those
  bundles before using their console output as an application diagnostic audit.
- UI WIPs were not merged. Settings model checks pass, Settings typecheck fails
  as recorded above, Automation typecheck passes. Neither received new screenshots.

On PowerShell, enumerate check files instead of passing a literal wildcard to Bun:

```powershell
$checks = @(rg --files checks -g 'servers-*.test.js')
bun test @checks checks/localization.test.mjs checks/icon-references.test.js checks/log-view-model.test.js
```

The commands run from `apps/desktop-solid`. A literal wildcard on this host ran
only the three explicitly named files, so the complete enumeration was rerun and
its actual 164-test total is reported above. No release, push, public listener,
global PATH edit or runtime deployment was performed.
