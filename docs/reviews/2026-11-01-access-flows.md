# Access flows, 2026-11-01

## Confirmed by automated tests and implementation tracing

- Microsoft enrollment proves a Minecraft profile through Mojang and attaches it to one canonical principal. The existing identity test links two device keys to the same profile, redeems a pairing code with the authenticated session, and confirms the original device immediately gains the new authority.
- Launcher re-enrollment now loads the saved key for a pinned server. Pairing an already connected Microsoft user uses the authenticated pairing endpoint, preserving the principal and device. Replacing a saved connection with the same key never queues that key for deletion.
- Owners can grant Administrator and Owner to a lower-ranked principal with a verified Microsoft/Minecraft account mapping. The new agent test covers both grants. Owner promotion is deliberately separate from invitations: invitations remain strictly below the issuer and cannot grant either protected top tier. Existing rank, self-edit and owner-removal protections remain.
- People access controls derive the caller's rank from the current session role list, including Microsoft sessions whose legacy connection role is empty. The role dialog exposes the two top tiers to owners for Microsoft-linked targets. Successful changes seed the users cache.
- Device labels include a short device ID. Re-enrolling an existing connection retains its key; genuinely distinct keys with the same label remain distinguishable. Historical rows are not merged by label.
- Bulk invite is a single shareable code/link, player by default, with role, bounded expiry and optional positive maximum uses. Each redemption and use increment is transactional. Exhaustion invalidates the code. Current issuer authority is checked at redemption. Single-use remains the default wire behavior.
- Join rules has a separate opt-in for Vesta-to-Minecraft whitelist sync. Reconciliation considers explicit effective play/pack roles, ignores the whitelist-derived automatic role to avoid a circular grant, excludes bans, and removes only entries the service added. It uses the enabling person's current moderation authority. Stopped games use the existing journaled editor; running games use generation-bound moderation operations. Disabling sync removes service-owned entries when the whitelist is enabled. If the enabling device loses authority, re-enable from a currently authorized account to resume reconciliation.

## Verification limits

No live Microsoft credentials or running authenticated Minecraft server were provided. External Mojang sign-in, interactive UI role changes, and observed vanilla whitelist commands still need a live smoke test. Automated proof fixtures exercise the real identity/session/policy paths after the external profile proof boundary; they do not claim a live Microsoft login.

## Create instance investigation

Launcher normalization had a 256-file ceiling and preview a 257-file ceiling, below the agent's supported thousands of files. Both now allow 4,096 files while retaining archive, byte, hash and path checks. Pack validation failures also receive pack-specific messages instead of a generic optimistic concurrency conflict. There is no prepare-write revision in the preview path. The reported server/artifact was not available, so its exact failure reason is not independently reproduced.

## Validation

- Desktop typecheck and production build pass.
- Server checks plus localization: 449 passed; one workspace-loading test failed in the combined run and passed in isolation (4/4). The changed create-instance error tests and localization also pass together (7/7).
- Launcher client: 43 unit, 25 HTTPS, and 22 management tests pass, including bulk invitation wire fields.
- Agent identity: 253 passed.
- Native launcher check passes. The 4,096-file regression and all 10 store tests pass after embedding the existing scripts/windows-native-tests.manifest in the disposable test executable. Unmodified Windows test binaries hit the repository's documented STATUS_ENTRYPOINT_NOT_FOUND loader issue.
- Agent HTTPS initially hit global password-budget/rate and timeout failures under full concurrency alongside other builds. A serial full-suite rerun is used for the final result below.
- Final serial agent HTTPS result: 126 passed, 0 failed, 1 ignored (interactive laboratory).
