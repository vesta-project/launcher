# Native server client implementation

Implemented on `feat/server-client-backend`, 2026-10-21. The binding IPC file is
`apps/desktop-solid/src/features/servers/native.ts`; it is unchanged. The core
crate has no dependency on Tauri, the launcher database, piston-lib, or the agent
checkout. Wire fixtures were checked against the implemented transport, including
the compatibility additions at server revision `87e71e7d`.

## Coverage

All 22 `serversNative` commands have native implementations; none is a success
stub or an unconditional unsupported stub:

- Saved connections, first-contact discovery and pairing links, TLS leaf capture,
  explicit pin approval, pairing, device sessions, and Minecraft account enrollment.
- Cached snapshots and subscribed status, console, metrics and operation updates.
- Start/stop/restart, two-step force kill, paged operations and operation tracking.
- Console paging, generation-bound commands and authenticated WebSocket streaming.
- Players, whitelist, operators, bans and all typed moderation actions, including
  two-step OP confirmation. Confirmation tokens never enter an IPC DTO.

The shared host registers these commands for both desktop entry points. Saved
metadata uses the existing profile directory and atomic tempfile replacement in
`server-connections-v1.json`. Device seeds use Windows Credential Manager,
macOS Keychain, or Linux Secret Service through `keyring`; bearer sessions stay in
native memory. No credential service means `credentials_unavailable`, before a
pairing code is redeemed. An explicit `VESTA_SERVER_MEMORY_ONLY=1` launch opts into
ephemeral keys; its connection DTO reports `memoryOnly: true`. Such connections
cannot authenticate after the launcher exits.

One native owner shares each connection between windows. It opens a console
socket only for console subscribers and a metrics socket for metrics/status
subscribers, up to four streaming servers. Status and metrics retain independent
latest values. Native subscriber queues have a 64 KiB/32-event bound, deliver at
most ten channel messages per second, and substitute `resync` after overflow.
Console retention is capped at 5,000 lines/2 MiB. Window close/reload and explicit
unsubscribe release demand; idle producers close after two seconds.

HTTP uses pin-specific pools, disabled redirects, five-second connect and
15-second request deadlines, and a one-MiB body bound. Capture-mode TLS can only
issue the public status GET: it cannot redeem codes or transmit credentials.
Scheduling fails fast under concurrency pressure; it reserves foreground request
capacity and ten of the 40 requests/minute for interactive actions. Replacing a
transport at the same origin shares its budget. Server 429 guidance pauses
background work. WebSocket messages are capped at 64 KiB and reconnect with
bounded exponential backoff/jitter. Long-lived sockets retire before session
expiry, then reopen with the single-flight renewed session.

Older agents use role-default capability hints when GET `/manage/session` returns
404/501, and subscribed status polling starts at ten seconds when no status stream
message is available. Once status streaming is observed, a 30-second conditional
status check confirms freshness/permissions. GET status/metrics validators are
reused when the agent supplies ETags. Permission refusals are retained as hints;
the agent remains authoritative.

Accepted operation IDs are journaled and polled from two to ten seconds until
terminal, independently of the view lifetime. They also appear in the existing
launcher Activity store without a cancellation affordance; failures and recovery
states create an in-app notification. Journal records contain hashes and opaque
IDs, never console text, reasons, keys or confirmation tokens.

## Run against an agent

1. Start an existing configured Vesta agent with HTTPS enabled. The launcher uses
   management v3, not a v2 pack password. Its endpoint must be reachable directly.
2. On the server machine run `vesta-agent pair <name> --role owner`. With the
   compatibility additions and an advertised `listener.public-endpoint`, paste
   the resulting `pairing_link` in the launcher's add-server flow. Otherwise enter
   `hostname:8443`, an IPv4 endpoint or `[IPv6]:port`, compare the displayed leaf
   SHA-256 out of band, then enter the one-time code.
3. Run the rewrite using its existing `bun run tauri:dev` script from
   `apps/desktop-solid`. It selects the rewrite profile and shared native host.
   Navigate to the frontend's server flow when the frontend branch is integrated.
4. Refresh a snapshot, subscribe to status or console, and submit a lifecycle
   action with a fresh intent UUID. Stop/restart, kill and console/moderation
   actions require the exact observed generation. A 202 operation is accepted,
   not completed; its eventual state comes from the operation record.
5. For Minecraft sign-in, use a signed-in Microsoft account that owns Minecraft.
   Configure its server authority via `vesta-agent owner link <name>
   --minecraft-uuid <uuid>` or the agent's access-source policy. Only the fixed
   Mojang session-server join receives the launcher access token; the Vesta agent
   receives the challenge completion and device public key.

Changing a certificate blocks authenticated work until the newly presented
fingerprint is explicitly approved. A different `server_id` cannot take over an
existing connection. Duplicate enrollment for a saved server returns `conflict`;
to replace rejected device credentials, forget that connection and pair anew.
For a lost pairing reply, request a fresh code and inspect/revoke the orphaned
device with the server CLI. Its native vault key reference is retained.

## Verification and remaining limits

Required checks are `cargo test -p vesta-server-client`,
`cargo clippy -p vesta-server-client -- -D warnings`,
`cargo check -p vesta-launcher`, and `cargo check` from
`apps/desktop-solid/src-tauri`. Native adapter tests can be run with
`cargo test -p vesta-launcher --lib servers::`.

Windows validation for this implementation: all 23 client tests pass, client
Clippy passes with warnings denied, and both host entry points pass Cargo check.
The native `servers::` test filter passes 15 tests (four new adapter tests plus
11 existing settings-sync tests). Host builds retain existing warnings in
piston-lib, instance_file, launcher_import and resources/ledger; no new server
adapter warnings are emitted. A source audit finds all 22 frontend command names
defined and registered. `apps/desktop-solid/src/**` is unchanged.

The HTTPS fixtures exercise real rustls handshakes, Ed25519 verification, legacy
auth JSON, v3 management envelopes, session renewal under concurrency, ETags,
authenticated console/status sockets, lifecycle idempotency, confirmation binding,
lost replies, rate limits and permission refusals. They run without Minecraft or
a sibling checkout. Packaged UI, a separately running real agent, actual OS vault
round-trips, macOS/Linux execution, and a live Mojang account still require manual
integration evidence.

- Explicit launcher proxy configuration currently returns `unsupported`; the
  client never silently bypasses it. Reverse-proxy path prefixes, file follow,
  and pack realtime are outside this frontend contract.
- An uncertain initial mutation response may contain no operation ID. The native
  journal blocks replay of that intent across restarts. The operator must inspect
  server operations before making a new intent; no guessed association or fresh
  automatic start is submitted. Known IDs reconcile through GET `/operations/{id}`.
- Metadata is bounded to 100 connections, 32 pending enrollment keys, 4,096 intent
  records and 32 concurrent operation trackers. Full metadata stores return `server_busy`;
  there is no automatic eviction of unresolved intent or orphan-key evidence.
  Tracking pressure preserves an already accepted receipt and emits `resync`.
- Tauri's channel API has no frontend acknowledgement in this IPC contract. The
  native queues, batch size and delivery frequency are bounded, but an indefinitely
  suspended WebView can still accumulate framework-owned IPC work. Hard end-to-end
  acknowledgement/backpressure would need a future frontend contract extension.
- The agent exposes no native operation result/error detail or remote cancellation;
  neither is invented. Metrics not supplied by the wire remain null.
