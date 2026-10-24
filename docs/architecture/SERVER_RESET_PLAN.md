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
- **P3. Sleep is a first-class state (AMP model).**
  `Running` → **Sleep** → `Sleeping` (Minecraft off, agent answers the server list, a real
  join or a permitted launcher user **Wakes** it) / **Stop** → `Stopped` (listener off; only a
  permitted launcher user can Start). Idle timer only ever moves Running → Sleeping.
  Primary button while running = Sleep (Stop in the menu) when sleep is configured.
  "On agent start": stay stopped / sleep / start (replaces `start-on-agent-start`).
  Today the responder can wake a merely *stopped* server if `wake_on_join` is on — that
  changes: wake applies only in Sleeping.
- **P4. Owners/admins can edit protected Minecraft files raw.** Today `server.properties`,
  `whitelist.json`, `ops.json`, `banned-*.json` are refused even for owners. Proposal: owner
  (and admin) get raw read + write through the editor with a confirmation and a hint
  ("also editable in Settings → Players"); validators still run where they exist; Vesta's own
  private paths (`.vesta`, wrapper files, VCS dirs) stay hidden for everyone.
- **P5. Java selection.** Agent detects Java installs on the host (well-known locations +
  `JAVA_HOME`/`PATH`), lists them with version/vendor; owner picks one per server or enters
  a custom path. Security: a custom path is an arbitrary executable, so it requires the
  owner role and either (a) the path to pass the existing probe and live under an allowlist
  configured locally, or (b) a local confirmation on the host. Recommend (a) with
  detected-list as the default UX.
- **P6. Machine host for agent lifecycle.** Keep per-server connections, add a small
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

### Phase 1 — state model + contracts (Sol), after P3/P4/P5 sign-off
- Sleep/Stop/Wake lifecycle (agent state machine, routes, native, TS contract, fixtures),
  "on agent start" policy, wake only from Sleeping.
- Protected-file raw access for owner/admin (P4) with audit + confirmation token.
- Java detection list + selection (P5); world details: size, datapacks list/toggle,
  dimensions (D1); remove world/new from launcher contract usage.
- Metrics history route consumption in native (D9).

### Phase 2 — UI (Claude UI agents, reviewed by Opus, one owner per area)
- Lifecycle: Sleep/Wake/Stop/Start buttons + states in header, card, rail pin.
- World page (D1), Software page (D2 + Java picker P5).
- Overview graphs + freshness rule (D9).
- Files drag-and-drop (D10) + raw protected-file editing UX (P4).
- Access: people vs pack users grouping (D7).
- Visual pass: less bland — use server art/icon, accent colour from the server icon,
  consistent panel rhythm with instance pages.

### Phase 3 — machine host (P6) — larger; spec first (Sol), then build.

## Working rules
- Every UI change is screenshotted (dark + light) and compared with the instance page.
- No new section/tab without an owner-visible reason; prefer fewer, richer pages.
- Opus does not scan code; Luna scans, Sol implements backend, Claude agents do UI.
