# Server management: reset plan (2026-10-25)

Why: recent work drifted into breadth (new sections, defensive plumbing) while the core
experience stayed rough. This plan re-anchors on the target: **an individual hosting their
own Minecraft server, managed comfortably from the launcher, feeling like the rest of the
app** (instance pages are the reference). Facts below come from the 2026-10-25 Luna scans
of both repos.

Roles: Claude Opus = planning, UI design and review; Claude UI agents = page work;
GPT Sol = agent/native/backend + reviews; GPT Luna = research and code scans.

## Decisions (D = decided, P = proposed, needs owner sign-off)

- **D1. One world, presented like an instance page.** No "create new world" in scope
  (remove `world/new` from the UI). Show: name, size, last played, seed hidden until
  hover/click (copyable), datapacks, dimensions (Overworld/Nether/End as parts of one world
  even when the software splits folders). Stats/map later.
- **D2. Software page stays, presentation changes.** Inline picker (no popup) like the
  instance Versions tab: software → software version → Minecraft version, review, apply.
  "Previous version" becomes a quiet "Previous: Paper 1.21.3 · Restore" line with confirm.
- **D3 (approved). Sleep is a first-class state (AMP model).**
  `Running` → **Sleep** → `Sleeping` (Minecraft off, agent answers the server list, a real
  join or a permitted launcher user **Wakes** it) / **Stop** → `Stopped` (listener off; only a
  permitted launcher user can Start). Idle timer only ever moves Running → Sleeping.
  Primary button while running = Sleep (Stop in the menu) when sleep is configured.
  "On agent start": stay stopped / sleep / start (replaces `start-on-agent-start`).
  Today the responder can wake a merely *stopped* server if `wake_on_join` is on — that
  changes: wake applies only in Sleeping.
- **D4 (approved: owner + admin with confirm; becomes configurable once fine-grained user permissions exist). Owners/admins can edit protected Minecraft files raw.** Today `server.properties`,
  `whitelist.json`, `ops.json`, `banned-*.json` are refused even for owners. Proposal: owner
  (and admin) get raw read + write through the editor with a confirmation and a hint
  ("also editable in Settings → Players"); validators still run where they exist; Vesta's own
  private paths (`.vesta`, wrapper files, VCS dirs) stay hidden for everyone.
- **D5 (approved: detected list + local allowlist for custom paths; plus proper JRE management modelled on the launcher Settings → Java page — detect, download/manage runtimes per required major version). Backlog: encrypt agent state at rest (identity/management DB). Java selection.** Agent detects Java installs on the host (well-known locations +
  `JAVA_HOME`/`PATH`), lists them with version/vendor; owner picks one per server or enters
  a custom path. Security: a custom path is an arbitrary executable, so it requires the
  owner role and either (a) the path to pass the existing probe and live under an allowlist
  configured locally, or (b) a local confirmation on the host. Recommend (a) with
  detected-list as the default UX.
- **D6 (deferred until phases 0–2 land). Process model today: `vesta-setup` host (starts at sign-in, launches the agent) → `vesta-agent serve` → optional per-server `vesta-supervisor` (keeps Minecraft alive across agent exits). Missing piece is a remote API on the existing host. Machine host for agent lifecycle.** Keep per-server connections, add a small
  per-machine **host service** (from `vesta-setup`, starts at sign-in) that knows every
  instance in the registry and exposes, to paired owners: agent online/offline, start/stop
  agent. Launcher shows "Agent offline · Start agent" when the host is reachable but the agent
  isn't. Dev: a short `vesta dev start|stop|status` wrapper around today's script.
- **D7. Devices:** devices are recorded when a key is enrolled — management users *and*
  pack users who download through Vesta (pack-user role). Plain Minecraft players are not
  recorded. UI: Access lists people with management roles by default; pack users collapse
  into one "Pack users (N)" group.
- **D8. Players from events.** One `list` per Minecraft run to seed, then join/leave events;
  never periodic. (Bug being fixed now — ~15k `list` replies at 2–3 s cadence observed.)
- **D9. Overview.** Separate graphs for TPS, CPU, memory, players — each only when the server
  reports it (TPS is opt-in and unknown on 26.x). Use server-side history (raw / 5-min /
  daily aggregates) so graphs aren't empty on open. "Updated N s ago" only while disrupted.
- **D10. Files:** drag-and-drop upload from the OS (files and folders), with progress and
  conflict prompts using the existing upload path.

## Phases

### Phase 0 — correctness (Sol, in progress)
- `list` spam root cause; roster tracks real joins/leaves.
- Sleep with 60 s idle never triggered: root cause + `sleep_blocker` diagnostic in the
  contract so the UI can explain "why isn't it sleeping".

### Phase 1 — state model + contracts (Sol)
- Sleep/Stop/Wake lifecycle (agent state machine, routes, native, TS contract, fixtures),
  "on agent start" policy, wake only from Sleeping.
- Protected-file raw access for owner/admin (D4) with audit + confirmation token.
- Java detection list + selection + managed JRE downloads (D5); world details: size, datapacks list/toggle,
  dimensions (D1); remove world/new from launcher contract usage.
- Metrics history route consumption in native (D9).

### Phase 2 — UI (Claude UI agents, reviewed by Opus, one owner per area)
- Lifecycle: Sleep/Wake/Stop/Start buttons + states in header, card, rail pin.
- World page (D1), Software page (D2 + Java picker D5).
- Overview graphs + freshness rule (D9).
- Files drag-and-drop (D10) + raw protected-file editing UX (D4).
- Access: people vs pack users grouping (D7).
- Visual pass: less bland — use server art/icon, accent colour from the server icon,
  consistent panel rhythm with instance pages.

### Phase 3 — machine host (P6) — larger; spec first (Sol), then build.

## Working rules
- Every UI change is screenshotted (dark + light) and compared with the instance page.
- No new section/tab without an owner-visible reason; prefer fewer, richer pages.
- Opus does not scan code; Luna scans, Sol implements backend, Claude agents do UI.

## Phase 2 completion checkpoint (2026-10-25)

The current UI reset is integrated on `feat/frontend-rewrite`: P2A at `918fcd54`,
P2B plus independent Sol review fixes at merge `6ad24a46`. World details/datapacks,
masked seed, Java selection/download controls, protected-file confirmation and
people/device grouping now accompany the lifecycle controls, graphs, inline
software selection and native file-drop support.

Review fixes (`378c2256`) preserve submitted datapack state across stale saved
observations and bounded operation-history eviction, let expired file confirmations
be reviewed again, and resume Save-and-leave only after a confirmed write applies.
The independent review and dispositions are preserved outside the repo at
`V:/tmp/reset-sol-review.md`; dark/light fixture screenshots are in
`V:/tmp/reset/p2a` and `V:/tmp/reset/p2b`.

Combined validation: 300 server/localization/icon checks passed; TypeScript and
lint passed (existing warnings remain). The seven pre-existing native Rust failures
were repaired in `dd2a9e22`: six portable path fixtures and a real Windows ZIP world
icon lookup defect. The rebuilt launcher library passed 579 tests, zero failed,
seven ignored. See `docs/development/server-files-native.md` for native evidence.

This checkpoint completes phases 0-2 implementation and source/fixture checks;
a live launcher/agent walkthrough remains necessary. Phase 3 machine-host design
and implementation remain separate, deferred work. Nothing was pushed or deployed.

## Feedback follow-up (2026-10-25)

- Preserve the existing page structure. Remove the redundant software hero; keep job/rollback feedback secondary. Start from the installed selection (including unsupported installed providers), retain the observed Minecraft version for unmanaged installations, and show Discard only for a changed selection.
- Extend the Players graph with the same authoritative live status count used by the header. Historical samples remain historical; unknown/offline counts do not become zero, and this adds no network request.
- Show the empty-server countdown without normal players-online/extra warning copy. Group MOTD preview/edit actions and clarify that the server preview renders the message rather than testing reachability.
- Keep World artwork square; remove the dimensions filler copy. Anchor segmented selection backgrounds inside their selected item, avoiding delayed indicator measurements after resets/resizes.
- New launcher enrollments use a bounded computer hostname instead of a hard-coded application name, for both pairing and Microsoft authentication. Existing generic current-device names display as This device; stored/custom names are preserved.

Validation: TypeScript, production build, lint (existing warnings), native cargo check, strict client-library Clippy and all 24 client HTTPS tests pass. Browser fixture checks cover pristine/change/discard, square artwork, grouped actions and exact selected-background bounds in dark/light. An empty-server fixture countdown was observed decreasing from 60 to 59 seconds. Screenshots and browser results: V:/tmp/ui-feedback-20261025.

The full frontend check run has 300 passing tests and one existing console HOT_SCOPE_TIME budget failure; its unchanged eight-test reactivity file passes separately after builds stop. The 8ms console threshold was not relaxed. Logs: V:/tmp/ui-feedback-tests-idle.log and V:/tmp/ui-feedback-reactivity-final.log. Live Minecraft join/leave timing was not exercised by this fixture pass.
