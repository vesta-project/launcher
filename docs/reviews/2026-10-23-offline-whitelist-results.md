# Offline whitelist implementation

2026-10-23. Scope: whitelist add/remove while Minecraft is stopped and the Vesta agent remains reachable. Running-server commands are unchanged. No proxy, game-port or MOTD architecture changes; bans and OP remain outside this increment.

## Behavior

The launcher enables the existing whitelist controls for reachable stopped servers. It reads a fresh revision, submits one structured offline edit, then reports “Whitelist saved for the next start.” Native request journaling preserves uncertainty, and the dialog retains its revision/intent for retry. If Minecraft starts meanwhile, an uncertain offline request is replayed against the offline receipt endpoint; it is not silently converted into a console command. Successful receipts invalidate cached list reads. Malformed successful receipts remain outcome-unknown rather than authorizing a new mutation.

The agent adds bounded GET/POST `/api/v3/manage/players/whitelist/offline`. It reuses the existing recoverable single-file journal, current scoped file permissions plus player authority, optimistic hashes, audit, atomic replacement and prior-byte recovery. Local starts are excluded; supervised games also use the existing renewed stopped-game maintenance hold. The guard checks process/hold facts and unchanged identity-mode properties immediately before replacement. Running, draining or uncertain ownership refuses. Stale revisions never overwrite newer bytes. Completed receipts can replay under current authority without rewriting the file or repeating identity lookup.

Online-mode additions use the fixed Mojang HTTPS profile endpoint with an eight-second deadline, no redirects, bounded headers and a 4-KiB body limit. Reply names/UUIDs must be valid and match the requested player. Vanilla offline-mode additions use Java's case-sensitive `OfflinePlayer:<name>` UUID construction. Removal needs no external lookup. No new cache or persistent polling loop was added. Custom authentication/forwarding setups that use online UUIDs with `online-mode=false` are not certified by that setting; this increment supports the vanilla identity rules.

The exact root whitelist exception does not expose other admission files through the generic file browser. Files are limited to 1 MiB and 10,000 entries. Duplicate required fields/identities and malformed data refuse; unrelated entries and extension fields survive the structured edit.

## Validation

- Client library 14 and management HTTPS 14 tests pass, including explicit revision transport, cache invalidation, invalid input and ambiguous receipt handling.
- Agent real HTTPS moderation tests: 2 pass, covering existing running moderation plus offline create/remove, idempotent replay, replay after startup, changed-input conflict, stale revision, running refusal, unauthenticated/unauthorized refusal and malformed-file preservation.
- All five new offline service tests and the protected-root exception test pass: offline UUID/profile parsing, local start exclusion, property-mode changes, actual supervisor hold/start refusal/lost hold, malformed duplicates and extension preservation.
- Launcher fixture/model/manage/files checks: 81 pass across four files. Typecheck passes. Lint passes using `bun --bun run lint`, with existing warnings. Plain `bun run lint` cannot load the TypeScript lint config on this machine's Node 22.14; no runtime/toolchain files were changed to work around it.
- Client and agent control/transport strict all-target Clippy pass. Integrated native check passes with incremental compilation disabled and four existing warnings.
- Broad file-suite validation: the first run passed 134/135 and exposed a Windows raw-vs-canonical path mistake in the new exception test; that fixture was corrected. The rerun passed 134/135 with the expensive sequential-write test excluded (it had passed previously), but an existing archive-bomb size test returned `file_unavailable` instead of `file_too_large` under load. That archive test passed alone. All new offline/exception tests passed in the rerun. No production deadlines or bounds were relaxed.
- An initial supervisor test teardown waited for an active hold to expire; teardown was corrected to release the hold and close the observer before joining. A fixture test hostname accidentally matched its deliberate “offline/unreachable” rule; it was corrected. Initial receipt/status assertions were corrected to compare receipt data rather than per-request IDs and to use the existing HTTP 412 precondition contract.

No development agent, Minecraft process or launcher session was restarted. No live Mojang request was made. Rebuild both sides before live testing. The server's full API/safety contract is `docs/operations/offline-whitelist.md` in `server-connections-mvp`.
