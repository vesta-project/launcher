# Native operation detail projection

`vesta-server-client` maps the authorized operation list/detail projection added
by agent commits `60c4cb4` / `b904e31` into the existing Solid native contract.
No frontend source or command signature changes are required.

| Agent projection | Native DTO |
| --- | --- |
| `kind`, `outcome` | Passed through, including null outcomes before completion |
| `{principal_id, display_name, device_name}` | `{kind: "principal", principalId, displayName, deviceName, self}` |
| Principal ID equals this connection's GET `/session` principal ID | `self: true`, independently of the actor's device |
| `{kind: "workflow" / "system", name}` | Same tagged actor |
| Console `{command}` | `{kind: "console.command", command}` |
| Console `{command_redacted: true}` | `{kind: "console.command", command: null}` |
| Moderation `{action, player, reason?, duration_seconds?}` | `{kind: "players.moderate", action, player, reason, durationSeconds}` |
| Moderation `{details_redacted: true}` | `summary: null` |
| Lifecycle generation fields | `{kind: "lifecycle", action, targetGeneration, resultGeneration}`; action derives from `kind` |
| `summary_purged: true` | `{kind: "purged"}`, with precedence over any supplied summary |
| Missing/unknown/unavailable summary | `summary: null`; never reconstructed from submitted input |

Missing optional fields on older agents decode to null. Native refresh caches the
authenticated principal from its existing capabilities GET `/session`. A
standalone or reconstructed client can make one lazy session projection lookup
when first encountering a principal actor. A failed lookup leaves `self: false`
until a successful capabilities refresh supplies the identity.

All accepted mutations, including confirmed kill/OP, use the same decoder. If a
receipt lacks any detail projection field, the client attempts one detail GET.
Read refusal, request-budget exhaustion or network failure preserves the accepted
receipt and operation ID. Complete receipts avoid that GET. Confirmation
preparation makes no detail request. Existing reconciliation, subscription list
polling and operation trackers all use the same list/detail decoder, so their
`ServerEvent::Operation` payloads include the same fields. No additional event
poller or mutation retry is introduced. Only identity and in-memory operation
DTOs are cached; the persistent intent journal remains input-free.

The TypeScript lifecycle summary accepts only start/stop/restart/kill. The agent's
`lifecycle.sleep` kind is retained with a null summary. Kill's `confirmed` has no
TypeScript field and is omitted. The agent's backup/file/workflow journals are
separate APIs and do not become fabricated operation summaries. Optional
`actor=me` and `kind` command filters are deliberately deferred.

Tests cover legacy/additive decoding, all mapped summaries, redaction/purge
precedence, self across devices, workflow/system actors, list/detail/event parity,
all mutation paths, exact detail request counts and accepted-receipt preservation
when detail reads are forbidden. The opt-in real-agent test additionally submits
`say Hello, players!` and checks exact command text, principal/device/self, list
parity and the final `stdin_written` outcome.

## Verification (2026-10-22, Windows)

- `cargo test -p vesta-server-client`: 38 passed; one opt-in live test ignored.
- `cargo clippy -p vesta-server-client -- -D warnings`: passed.
- `cargo check -p vesta-launcher`: passed with existing unrelated warnings.
- `cargo check` in `apps/desktop-solid/src-tauri`: passed with existing unrelated
  warnings after the main launcher generated its required sandbox sidecar.
- Opt-in `real_agent_pair_lifecycle_console_reconnect_revoke`: passed in 14.17s,
  including exact console command, actor/device/self, list parity and outcome.
  Agent source was read-only at `e79b85fa8397f725b7fc62e65acf8ede5707433b`;
  a fresh `--locked` agent build wrote only to this worktree's `target/live-agent`.
  Runtime scratch: `target/live-scratch/launcher-UGGq8F`.
  Agent SHA-256: `a3e49feda20f437ff87dc3e9af69732f4342ef052d5cfb454fd85a11269852eb`.
  Inert-child SHA-256: `d9bfda532249f9ad7a90307078d6e3b646323d2004443885a34867d1543a7cac`.
  This used the real TLS/session/OS-vault paths and an owned inert child; it did
  not launch Minecraft or Java.
