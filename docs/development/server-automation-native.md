# Native server automation

The 13 `server_automation_*` commands in `servers_automation.rs` implement
`apps/desktop-solid/src/features/servers/native-automation.ts` using the shared
pinned-TLS management client and native management intent journal.

Contract checked against `V:/server-connections-mvp`, branch
`feat/launcher-compat`, `docs/operations/management-api-contract.md` section 4A,
`vesta-transport/src/manage_automation.rs`, the automation engine/model, and the
session projection implementation.

- Automation mutations use `Idempotency-Key` derived from the UI intent and
  native server/device identity. Update, delete and enabled mutations send
  `expected_revision` in JSON. These automation routes do **not** use `If-Match`.
- Pages request `limit=100` with an optional exclusive `after`. A full final page
  can return a cursor followed by an empty page. Numeric step cursors are adapted
  to IPC strings; canonical decimal inputs are restricted to 0..191.
- The agent's schedule `occurrence` is already UTC epoch milliseconds. It becomes
  `occurrenceMs`; known events retain their event payload; unknown triggers or
  unknown event variants become `{kind:"other"}`.
- Serde DTOs accept snake_case observations and emit camelCase, including nested
  definition fields. Preset parameters use a raw string map. Step outputs and
  branch comparison JSON values also keep their keys unchanged.
- Run and step state strings remain open. Definition/action/branch/severity
  unions are closed in TypeScript, so an unknown variant returns `unsupported`
  for the detail rather than presenting a definition the editor cannot preserve.
- Discard goes directly to the agent, which atomically accepts only suspended
  runs. Other states return 409 `automation_conflict`; native never cancels an
  underlying operation.
- Existing error mapping agrees: 412 -> `stale_target`, 409 automation/idempotency
  conflict -> `conflict`, 400 -> `invalid_input`, 404 -> `not_found`, 403 ->
  `forbidden`, 503 -> `server_busy`. No TypeScript or fixture changes were needed.
- `automation_self` checks session server identity and returns the principal and
  maximum current role rank (zero if no role is assigned); this is informational.

Coverage includes Rust mapping tests and agent-shaped loopback TLS tests for all
13 client methods, request bodies, intent headers, pagination, unknown states,
opaque JSON and discard conflicts. `live_automation_workflow_lifecycle` is an
opt-in test using the existing real-agent inert process fixture (no Minecraft or
EULA acceptance). It creates, replays, lists, reads, updates, toggles, runs,
inspects steps, checks invalid discard, deletes, and verifies pinned run history.

Run it with `VESTA_LIVE_AGENT=1`, `VESTA_AGENT_BIN` pointing at `vesta-agent.exe`,
and `VESTA_AGENT_INERT_BIN` at the agent transport HTTPS test executable:

```powershell
cargo test -p vesta-server-client --test live_agent live_automation_workflow_lifecycle -- --ignored --nocapture
```

All build and frontend commands should run inside this worktree. In particular,
install Solid dependencies here with `bun install --frozen-lockfile`.

Verification on 2026-10-22 (Windows):

- `cargo test -p vesta-server-client`: 66 passed, 5 opt-in tests ignored.
- `cargo clippy -p vesta-server-client -- -D warnings`: passed.
- `cargo check -p vesta-launcher`: passed with existing unused/dead-code warnings.
- `cargo check` in `apps/desktop-solid/src-tauri`: passed with the same warnings.
- `bun install --frozen-lockfile` and `bun run typecheck`: passed in this worktree.
- Server/localization Bun checks: 121 passed across 9 files. PowerShell requires
  expanding `checks/servers-*.test.js` before passing the paths to Bun.
- Live test against the `feat/launcher-compat` agent: passed using the real-agent
  process fixture and its inert child executable. No agent-side bugs found.
