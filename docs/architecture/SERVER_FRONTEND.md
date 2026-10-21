# Launcher Server Frontend

Date: 2026-10-21. Implementation plan, not implemented coverage. It builds on
[Server Client Backend](SERVER_CLIENT_BACKEND.md), including its review
corrections, and on [ADR-0011](../adr/0011-server-client-crate-and-native-host-adapters.md).
The server baseline is commit `28d9ba81`. Requirement references point to
`docs/SERVER_SOFTWARE_REQUIREMENTS.md` in the server repository by section name.

## Goals and boundaries

The launcher is the server's operator panel. A user can host a server on their
own computer, connect to a server elsewhere and manage it day to day without
learning TLS, IPC or role internals. It must also not misrepresent what the
server reports.

- **Solid owns interaction only.** Keys, session tokens, sockets, retries,
  request budgets and operation reconciliation stay native. The frontend never
  constructs URLs, holds bearer tokens or retries a mutation itself.
- **Honest state.** Unknown is shown as unknown: player counts, readiness,
  operation outcomes and capabilities. Nothing is fabricated as zero, "online"
  or "allowed".
- **Server-authoritative permissions.** Capability gating hides or disables
  controls as a convenience. A 403 is always handled; the UI never treats a
  local guess as authority.
- **Explicit effects.** Nothing restarts, wakes, restores or kills as a side
  effect of navigation, reconnection or a settings change. Every destructive
  action uses the server's exact-target confirmation.
- **Bounded rendering.** Every list is paged or virtualized, and every buffer
  has a cap. Only the affected server and topic update.
- Follows `apps/desktop-solid/AGENTS.md`: Solid 2 semantics, named reactive
  scopes, `@vesta/ui` components, `cursor: default`, Fluent localization and
  fixture stores for browser previews.

Out of scope here: the server agent itself, a web panel, multi-server hosts,
relays, SFTP and Discord configuration (no implemented routes), and pre-1.7
Minecraft.

## Information architecture

Add a `servers` rail destination between Browse and Settings. Routes reuse the
existing `parseRoute` shape (`page/section/detail/item/rest`):

| Route | View |
| --- | --- |
| `#/servers` | Server list: saved connections, coarse status, add/host actions, empty state |
| `#/servers/add` | Connect-to-server flow |
| `#/servers/host` | Host-on-this-computer flow (stage 5) |
| `#/servers/<connectionId>` | Redirects to the last tab, default `overview` |
| `#/servers/<connectionId>/<tab>[/<item>…]` | Server workspace tab; `item` selects a file path, job, workflow or user |

`connectionId` is the launcher's local opaque ID, never the endpoint or
`server_id`. Remote file paths are encoded per segment in routes and passed
unchanged as game-root-relative strings over IPC.

Server workspace tabs, mirroring the instance page (section sidebar on wide
windows, tab strip on narrow ones):

| Tab | Contents | Gate |
| --- | --- | --- |
| Overview | Agent, Minecraft and access state; lifecycle controls; players summary; live metrics; pack summary; pending-restart notice; recent operations | `status.view` |
| Console | Live console, history paging, command input | `console.read`, `console.write` for input |
| Players | Online players, whitelist, operators, bans, moderation actions and history, activity | `players.view`, `players.moderate`, `players.operator` |
| Files | Browser, text editor, log viewer, uploads/downloads, trash, content install | `files.*`, `content.install` |
| Backups | Profiles, jobs, snapshots, restore, storage, policy | `backups.*` |
| Automation | Workflows, runs and steps | `automation.view`, `automation.manage` |
| Pack | Hosted and minimum revision, publish, required update | `status.view`, `pack.publish`, `pack.force_update` |
| Access | Users, roles, invitations, devices, access sources | `principals.*`, `roles.*`, `invitations.create`, `devices.revoke`, `access-sources.manage` |
| Settings | `server.properties`, sleep, MOTD, metrics policy | `config.view`/`config.edit` and route-specific capabilities |
| Activity | Operations, audit tail, server notifications | `tasks.view`, `audit.view`, notifications |
| Connection | Endpoint, trust/fingerprint, network profile, this device, remove | Always (local) |

A tab whose capabilities are known to be absent is hidden. One whose
capabilities are unknown is shown and resolves on first refusal. The Connection
tab is always visible because it manages local state.

Global surfaces:

- **Rail pins.** Servers can be pinned like instances, with a compact status dot
  built from the composed state below.
- **Activity pill and panel.** Remote operations become activity rows
  (`kind: 'remote'`) keyed by connection and operation ID. They survive window
  closure because the native manager owns them. Wording separates "Accepted by
  server" from "Completed".
- **Notifications.** Server inbox items appear in the existing notification
  panel, grouped by server, with read and acknowledge mapped to the inbox
  routes. Unread counts are fetched on demand and on reconnect, not polled
  across every saved server.
- **Pending changes.** A persistent status control at the bottom of the server
  section sidebar shows "Restart required" when a properties change returned
  `restart_needed`, which is what the requirements ask for under pending changes.
  It is a reminder with a Restart button, never an automatic action.

## State presentation

The three native states are shown as separate facts, never one merged badge:

| Fact | Example copy | Source |
| --- | --- | --- |
| Connection | Connecting · Online · Retrying in 20 s · Can't reach server | Native connection state |
| Access | Needs approval · Paired as Maintainer · Sign-in rejected · Not allowed | Trust and credential state, learned refusals |
| Minecraft | Stopped · Starting · Ready · Degraded (console gap) · Sleeping · Crash loop · Recovery required | `/server/status` `state`, `readiness`, `lifecycle` |

Rules:

- When the connection is not online, the Minecraft fact shows the last known
  value with its age ("Ready · 4 min ago") and controls are disabled. A
  reachable agent with a stopped game reads "Agent online · Minecraft stopped".
- Player counts show "3 online · seen 40 s ago", or "Player count unknown" when
  `player_count_known` is false. A stopped game never shows a carried-over count.
- Readiness reasons map to fixed copy (`startup_timeout`, `probe_failed`,
  `fatal_output`, `console_gap`). Supervisor flags (`orphan_running`,
  `launch_unresolved`, `crash_loop`, `restart_state_unsaved`) render as a
  degraded-control banner.
- Every closed error code from the client error model has one localized message
  and one recovery action. A test checks this mapping is exhaustive.

## Flows

### Connect to a server (stage 2)

1. **Address.** Accept one field: a pairing link, an `https://` URL, a hostname,
   an IPv4 address, `[IPv6]:port` or `host:port` (default port 8443). LAN and VPN
   addresses work even when the launcher reports being offline. A pasted pairing
   link pre-fills the remaining steps.
2. **Discover.** Native code makes an unauthenticated contact and returns the
   server name, `server_id` and TLS fingerprint, all labelled as unverified.
3. **Verify.** Show the fingerprint as grouped hex next to the instruction "Compare
   with the value shown on the server (`vesta-agent owner link` or the pairing
   output)". A pairing link that carries the fingerprint auto-matches and still
   shows it. Rejecting the comparison ends the flow without sending a code.
4. **Sign in.** There are two methods:
   - **Pairing code.** For codes from `vesta-agent pair` or an invitation, accept
     43-character input with paste normalization and show the expiry hint.
   - **Minecraft account.** Use an existing launcher account from the accounts
     feature. Copy states that the account proves identity, that the server
     decides the access level, and that the Microsoft token is not sent to the
     server.
5. **Result.** Show the role returned by pairing ("Paired as Owner"). Minecraft
   sign-in may grant only public or pack access, and that is said plainly
   ("Signed in. This account has no management access on this server").
6. **Uncertain outcome.** If the pairing response is lost, show: "We couldn't
   confirm pairing. The code may already be used. Ask for a new code." Offer
   retry with a new code. The flow never resubmits the old code automatically.
7. **Credential storage unavailable.** Offer "Use for this session only" or
   cancel. Never fall back silently to plaintext storage.

### Trust and endpoint changes

- **Fingerprint changed.** Show a blocking full-tab state on that server:
  old and new fingerprint, "Management is paused until you verify this change",
  Verify or Disconnect. Public status may still display, marked unverified.
- **Endpoint edit.** Changing the address in the Connection tab requires the
  new endpoint to present the same approved fingerprint and `server_id`.
  Otherwise the full verification step applies. Credentials never move silently.
- **Sign-in rejected.** "This device's access was removed or is no longer
  recognized." Offer Pair again or Remove. The word "revoked" is not used.

### Lifecycle (stage 2–3)

- Start, Stop and Restart are enabled only when the state and capability allow
  them. Stop and Restart send the current generation. A 412 refreshes status and
  shows "The server changed state. Review and try again."
- While `stopping` or `draining`, Stop becomes **Force kill…** (gated by
  `lifecycle.force_kill`). A dialog shows the exact target generation, prepares
  the server confirmation and shows its 120-second expiry countdown. The user
  confirms with an exact action. An expired token re-prepares; it never
  auto-confirms.
- Each request shows "Accepted" (202) as soon as the server answers, then follows
  the operation to a terminal state. `recovery_required` renders a persistent
  banner. A network-uncertain submission shows "Checking whether the server
  received this…" while native code reconciles. The button stays disabled for
  that intent until it resolves.
- Closing the view or the window does not cancel accepted work. Remote cancel is
  not offered, because no route exists.

### Console (stage 3)

- Reuse the instance console's virtualized renderer. Cap the frontend at 5,000
  lines per server and apply native batches as deltas.
- A gap renders as an inline marker: "Lines skipped while the server was busy".
  It offers one bounded "Load missed lines" fetch, then falls back to "Open
  latest.log" in Files.
- The input validates on the client for display only: at most 1,024 UTF-8 bytes
  and no control characters (native code validates again). Success copy is
  "Sent to server", because `succeeded` means the line reached stdin.
- A persistent note on first use: console output can contain sensitive data,
  and commands are retained by the server as operation input.
- Input is disabled while the game is stopped or the generation is stale.

### Players (stage 3)

- The online list follows `/players` known/unknown semantics. Whitelist,
  operators and bans are separate sub-views of the server's actual files.
- Moderation uses typed actions only: kick, temporary or permanent ban with
  reason, pardon, whitelist add/remove, OP/de-OP with level, kill and lightning.
  Granting OP goes through the exact confirmation flow. There is no free-form
  command builder here.
- History and activity views are cursor-paged.

### Files, configuration and content (stage 4)

- The browser lists one directory page at a time, with a breadcrumb of
  game-root-relative segments. It does not scan recursively.
- The text editor loads with its `sha256` validator. A stale save opens a
  compare dialog (theirs, mine, latest) with "Overwrite with mine", which uses
  the fresh validator, or "Discard mine". It is never a silent last-write-wins.
- Binary and oversized files offer download only. Downloads stream natively to
  a user-chosen destination with progress in the activity panel. Uploads follow
  the server cap (16 MiB, 1 MiB chunks) with resumable progress.
- Delete moves to trash and shows the trash entry with Restore. Writing `.jar`
  files under `mods/`, `plugins/` or the server JAR shows an executable-content
  warning.
- The log viewer uses tail and paged lines, `.gz` decompression and live follow.
  Follow uses the metrics socket slot (see backend correction 2) and says so if
  metrics pause.
- The `server.properties` editor is schema-driven with typed fields, a raw view
  for authorized users, and validator-based saves. Weakening changes go through
  the server's confirmation. A save sets the pending-restart control.
- Content install reuses Browse with a "Install to server" target. Native code
  sends only the provider, project ID and version ID, never URLs or hashes.

### Backups, automation, access and presentation (stage 6)

- **Backups.** Profiles with run and verify; job progress; snapshot lists;
  inspection restore with path selection; in-place restore with exact
  confirmation, where the safety snapshot is on by default and turning it off
  is a labelled owner override; resolve-recovery for `recovery_required`; a
  storage meter; and the policy editor (owner-reserved) with revision conflict
  handling.
- **Automation.** A workflow list and a sequential step editor with typed step
  inputs and success/failure branches (no loops or parallel branches). It
  includes an execution principal picker and run/step history. Manual Run shows
  admitted or skipped.
- **Access.** Users (paged), role assignment within rank rules, and a custom
  role editor that offers only capabilities the actor holds. Invitations show a
  one-time code or pairing link with expiry and copy, and are never shown again.
  Device revocation and access sources (pack policy) are also here. The UI
  explains that Owner and Administrator are granted only on the server machine.
- **Pack.** Hosted and minimum revision; Publish shows the expected revision.
  "Require this update" raises the minimum with confirmation and explains its
  effect on existing players.
- **Sleep and MOTD.** Policy editors with revisions. The MOTD editor has a
  two-line preview, Minecraft colour and style controls, placeholder insertion,
  protocol-limit validation and a server-side preview call.
- **Metrics policy.** The editor includes the explicit console-write consent
  for command polling.

### Host on this computer (stage 5)

This is the easiest hosting path and depends on the onboarding boundary that
backend stage 5 resolves.

1. Detect an installed Vesta host through its local handoff descriptor, or offer
   to download and run the signed setup bundle.
2. Pin the loopback fingerprint from the handoff and confirm the
   `installation_id` against `/api/v3/setup`.
3. Choose a new or existing server directory, software and version (the
   server plans; the review shows EULA, licence and Java requirement), intended
   access (Local, LAN, Internet, Reverse proxy or VPN, composable), and opt-in
   backups. Recommended settings are shown together, with advanced options
   collapsed.
4. Activate. Because the launcher runs as the same OS account as the local owner,
   native code requests a local pairing code from the agent and redeems it with
   no manual typing. The user sees "This computer is the owner".
5. Finish on the new server's Overview, with Minecraft still stopped and a Start
   button. Nothing starts automatically.
6. Interrupted onboarding resumes from the host's recorded phase. The UI never
   reports "ready" before agent management responds.

## Request and socket budgets in the UI

The native scheduler enforces budgets. The frontend is designed not to fight
them:

| View | Data need | Cost at steady state |
| --- | --- | --- |
| Server list | Last-known snapshots; refresh only connected or pinned servers on open | 1 request per server, once |
| Overview | Metrics stream when available; status at 10 s otherwise | 0 requests/min (stream) or about 6 |
| Active operation | `/operations/{id}` from 2 s backing off to 10 s, until terminal | Bounded per operation |
| Console | Console stream; history page on explicit scroll | 0, plus 1 per explicit page |
| Files, players, access, backups | Fetch on navigation and explicit refresh; no timers | Per action |

Hidden windows and background tabs release subscriptions after a short grace
period. On 429, non-interactive work pauses and the server header shows "Server
is limiting requests · resuming in N s". User actions use the reserved share.

## Frontend module map

```text
src/features/servers/
  native.ts            Typed IPC: commands, DTOs, error codes (no tokens, no URLs)
  model.ts             Pure projections: composed state, copy keys, freshness
  capabilities.ts      Built-in role defaults, learned refusals, tab/action gating
  console-model.ts     Bounded ring, delta apply, gap markers (pure)
  operations-model.ts  Accepted/terminal/uncertain projection, activity rows
  address.ts           Address and pairing-link parsing/normalization (pure)
  fingerprint.ts       Display grouping and comparison (pure)
  store.ts             Server-keyed stores; subscription lifetimes per view
  fixtures.ts          Fixture server for browser previews and tests
  errors.ts            Exhaustive error-code → message/action map
src/pages/servers/
  servers-page.tsx     List and empty state
  add/                 Connect flow steps
  host/                Host-on-this-computer flow
  server/              Workspace shell and one file per tab
src/localization/locales/en/servers.ftl
```

Stores are keyed by `connectionId`, then by topic (`status`, `console`,
`metrics`, `operations`, …). A console batch updates only that server's console
store. Large values are kept in plain arrays updated by delta, not reactive
deep proxies. Decimal-string counters, cursors and generations stay strings in
the DTO types.

## IPC surface (proposed)

Commands are verbs on validated references, delegating to the native manager:

- **Connections.** `server_connections_list`, `server_discover(address)`,
  `server_trust_approve(discoveryId)`, `server_pair(discoveryId, code)`,
  `server_sign_in_minecraft(discoveryId, accountId)`,
  `server_connection_update(connectionId, patch)`, `server_connection_remove`.
- **Snapshots.** `server_snapshot(connectionId)` returns composed state, last
  known status and learned capabilities.
- **Subscriptions.** `server_subscribe(connectionId, topic, channel)` returns a
  handle, and `server_unsubscribe(handle)`. Topics are `status`, `console`,
  `metrics`, `operations` and `file-follow:<path>`. Delivery is batched, with
  resync markers.
- **Actions.** Typed per feature: `server_lifecycle(connectionId, action,
  expectedGeneration, intentId)`, `server_kill_prepare` and `server_kill_confirm`,
  `server_console_send`, `server_moderate`, `server_file_*`, `server_backup_*`,
  `server_workflow_*`, `server_access_*`, `server_pack_*`, `server_policy_*`.

The frontend generates `intentId` once per user intent, so a re-click of the
same dialog reuses it. Native code maps it to the server's idempotency key and
persists only reconciliation metadata.

## Testing

Tests live in `apps/desktop-solid/checks/servers-*.test.js` (bun test) and target
the pure modules, so they run without a WebView or a server. Each test name
starts with the requirement it covers, for example
`[lifecycle] force kill requires exact prepared confirmation`.

| Area | Representative assertions |
| --- | --- |
| State composition | Agent online with game stopped is distinct; offline shows last-known with age; unknown players never render as 0 |
| Errors | Every client error code has a message and action; "revoked" never appears for `credentials_rejected` |
| Address and pairing | IPv4, `[IPv6]:port`, hostnames, default port, link parsing, rejection of credentials/fragments in URLs |
| Fingerprint | Grouping, comparison, mismatch blocks pairing |
| Capabilities | Built-in role defaults; learned 403 hides action; unknown shows action; Moderator has no raw console |
| Lifecycle | Stop sends current generation; 412 re-prompts; kill confirm expiry re-prepares; stopping swaps Stop for Force kill |
| Operations | 202 is "Accepted", not done; uncertain outcome blocks duplicate intent; terminal states; no cancel affordance |
| Console | 5,000-line cap; gap marker; one recovery fetch; 1,024-byte/control-character validation |
| Files | Stale validator opens compare; upload limits; executable warning paths; encoded route segments round-trip |
| Budgets | View demand maps to subscriptions; release after grace; 429 pause banner |
| Reactivity | `@solidjs/diagnostics` rerun budgets: a console batch reruns only that server's console scope |

Each tab has workbench stories for its loading, empty, forbidden, offline,
gap and conflict states, driven by `fixtures.ts`. The fixture server also backs
browser-preview runs of the full add → pair → start → console → stop flow.
End-to-end evidence against a real agent (pairing, wrong fingerprint,
restart/reconnect, two windows sharing one stream) belongs to the backend
stage gates and is recorded there.

## Milestones

| Milestone | Backend stage | Frontend deliverable |
| --- | --- | --- |
| F1 Connect | 2 | Rail destination, server list, connect flow (code and Minecraft), trust states, Overview with lifecycle and kill confirmation, Connection tab, activity rows |
| F2 Observe | 3 | Console, live metrics, players and moderation, Activity tab, notifications integration |
| F3 Files | 4 | Files, editor and conflicts, logs, transfers, `server.properties`, content install, pending-restart control |
| F4 Manage | 6 | Backups, automation, access, pack, sleep, MOTD and metrics policy |
| F5 Host | 5 | Host-on-this-computer flow and automatic local owner pairing |

F5 is listed last because it depends on an onboarding API that does not yet
exist. It is the flow that makes self-hosting easy, so it is designed now and
built as soon as backend stage 5 resolves the activation boundary.

## Server-side requests

These requests improve the frontend. None of them blocks F1.

1. Print `tls_sha256_fingerprint` from `vesta-agent pair`, and emit a pairing link
   that carries the endpoint, code, fingerprint and `server_id`.
2. Add an authenticated self projection: principal, roles and effective
   capabilities.
3. Make the per-peer rate budget configurable, or exempt authenticated sessions
   from the anonymous budget.
4. Add an operation result/error projection and, where safe, a cancel route.
5. Provide an onboarding API for stage 5 that writes configuration and pairs the
   local owner.
