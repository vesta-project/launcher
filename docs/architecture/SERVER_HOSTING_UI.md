# Server hosting UI: world, software and SFTP

Date: 2026-10-24. This is the frontend contract for three owner hosting features in
`apps/desktop-solid`. Agent routes are defined in the server repository:
`docs/operations/world-management.md`, `software-management.md` and `sftp.md`.
This document fixes the Tauri IPC that the native bridge
(`vesta-launcher/src-tauri/src/servers` plus `crates/vesta-server-client`) must
expose. The TypeScript source of truth is
`apps/desktop-solid/src/features/servers/hosting-native.ts`.

The rules from `native.ts` apply. Argument and DTO fields are camelCase on the JS
side (`#[serde(rename_all = "camelCase")]` over the agent's snake_case). Revisions,
seeds and ids stay strings. Each mutation takes one UI `intentId`, and native
derives the `Idempotency-Key` from it. Native code never retries a mutation with a
fresh key, and every rejection uses `ServerCommandError`.

## Error detail (one additive field)

The closed `ServerErrorCode` cannot tell "Java not available" apart from "plan
expired". These commands may therefore add a reason to the rejection:

```ts
interface ServerCommandError { code: ServerErrorCode; retryAfterMs?: number | null; localPressure?: boolean;
  /** The agent's fixed, safe wire code, unchanged, e.g. `software_runtime_unavailable`,
   *  `server_install.storage_low`. Never free text, paths or upstream messages. */
  reason?: string | null }
```

The UI maps known reasons to specific copy (`hosting-model.ts`, `reasonMessage`).
When `reason` is missing it falls back to the closed code's message, so the field
is optional and can arrive later. The suggested coarse codes follow `Error::wire`:

| Agent code | `code` |
| --- | --- |
| `software_forbidden` | `forbidden` |
| `software_disabled`, `software_runtime_unavailable` | `unsupported` |
| `software_invalid_request` | `invalid_input` |
| `software_busy` | `server_busy` |
| `software_plan_expired`, `software_confirmation_invalid` | `confirmation_expired` |
| `software_revision_conflict` | `stale_target` |
| `software_idempotency_conflict` | `conflict` |
| `software_previous_unavailable` | `not_found` |
| `software_recovery_required`, `software_state_unavailable` | `conflict` |
| `server_install.*` | by HTTP status |
| world: game not stopped | `conflict` (reason as sent by agent) |
| world: revision mismatch | `stale_target` |

Reasons the UI has specific copy for (see `reasonMessage` in `hosting-model.ts`).
Anything else falls back to the closed code:

- Software: every `software_*` code above, `provider_not_implemented`, and
  `server_install.{unavailable,invalid_metadata,source_refused,transport_failed,deadline,artifact_changed,integrity_conflict,runtime_unknown,runtime_incompatible,runtime_failed,storage_low,storage_unknown,limit_exceeded,busy,expired,approval_mismatch}`.
  `SoftwareJob.error` uses the same table.
- World: `world_not_stopped` (or `world_requires_stopped`). These are proposed
  names, so use whichever fixed code the agent sends and tell the UI.
- SFTP: `sftp_disabled` and `sftp_no_handler` (from `server_sftp_open`), plus
  the proposed `sftp_bind_failed`, `sftp_key_invalid`, `sftp_key_duplicate` and
  `sftp_key_limit`. Rename these to the agent's actual codes when they are fixed.

## World

| Command | Args | Returns | Route |
| --- | --- | --- | --- |
| `server_world` | `{ connectionId }` | `ServerWorld` | GET `/world` |
| `server_world_new` | `{ connectionId, seed, expectedRevision, confirmWorld, intentId }` | `WorldNewResult` | POST `/world/new` |

```ts
interface ServerWorld { name: string; seed: string | null; configuredSeed: string; exists: boolean; revision: string }
interface WorldNewResult { world: ServerWorld; preservedWorlds: string[]; outcome: 'succeeded' }
```

- `seed` is the actual seed read from `level.dat`, a signed 64-bit decimal string.
  `null` means no world has been generated yet. `configuredSeed` is the
  `level-seed` generation setting. Native code passes both strings through
  unparsed and never converts them to f64.
- `server_world_new` sends `seed` as typed, trimmed. `""` means a random seed.
  `confirmWorld` must equal `ServerWorld.name` exactly. The UI disables the action
  unless Minecraft is `stopped`, and the agent rechecks this.
- The agent switches `level-name` to a fresh name. Old worlds stay at their paths
  (`preservedWorlds`) and nothing is moved or deleted. The UI says only that the
  current world is kept and that the next Start creates the new one.
- If the outcome is uncertain, the same `intentId` is replayed. Native code must
  not mint a new key, because that would select a second world.

## Software

| Command | Args | Returns | Route |
| --- | --- | --- | --- |
| `server_software` | `{ connectionId }` | `SoftwareState` | GET `/software` |
| `server_software_versions` | `{ connectionId, software }` | `SoftwareVersions` | GET `/software/versions?software=` |
| `server_software_plan` | `{ connectionId, request: SoftwarePlanRequest }` | `SoftwarePlan` | POST `/software/plan` |
| `server_software_apply` | `{ connectionId, planId, acknowledgeWarnings, acknowledgeLegacyChecksum, intentId }` | `SoftwareJob` | POST `/software/apply` |
| `server_software_jobs` | `{ connectionId }` | `SoftwareJob[]` | GET `/software/jobs` |
| `server_software_rollback` | `{ connectionId, expectedRevision, intentId }` | `SoftwareJob` | POST `/software/rollback` (native sends `confirm: true`) |

```ts
type SoftwareId = 'vanilla' | 'paper' | 'folia' | 'purpur' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
interface SoftwareLaunch { software: SoftwareId | null; version: string | null; build: number | null; installationId: string;
  /** Optional, shown only when the agent reports it. */ loaderVersion?: string | null; javaMajor?: number | null }
interface SoftwareDescriptor { software: SoftwareId; automaticBackend: boolean; unavailableReason: string | null;
  source: string; licence: string; eula: string; caution: string | null }
interface SoftwareState { available: boolean; unavailableReason: string | null; revision: string;
  current: SoftwareLaunch | null; previous: SoftwareLaunch | null; recoveryRequired: boolean; catalog: SoftwareDescriptor[] }
interface SoftwareVersions { software: SoftwareId; versions: string[] }   // newest first, as the agent sends
interface SoftwarePlanRequest { software: SoftwareId; version: string; build?: number; loaderVersion?: string; experimental?: false }
interface SoftwarePlan { planId: string; expiresAtMs: number; expectedRevision: string; software: SoftwareId; version: string;
  build: number | null; java: { major: number; evidence: string }; warnings: SoftwareWarning[]; risks: string[] }
type SoftwareWarning = 'legacy_checksum' | 'unsupported_upstream' | 'experimental_build' | 'region_threading' | 'first_run_effects' | 'proxy_resolution';
interface SoftwareJob { id: string; kind: 'apply' | 'rollback';
  state: 'queued' | 'staging' | 'activating' | 'succeeded' | 'failed' | 'recovery_required';
  createdAtMs: number; updatedAtMs: number; error: string | null }
```

- **Confirmation token.** Native keeps `confirmation_token` keyed by `planId`, as it
  does for kill and restore. The UI never sees it. `server_software_apply`
  rejects with `confirmation_expired` (reason `software_plan_expired`) after
  expiry. The UI then plans again and never confirms automatically.
- **Acknowledgements.** `acknowledgeWarnings` is true only after the user ticks the
  review checkbox. `acknowledgeLegacyChecksum` is true only when the plan carries
  `legacy_checksum` and the user ticks that line.
- **Data needs.** The software list loads when the Software section opens. Versions
  load once per software when that software is picked in the dialog. Jobs load on
  open, then are polled only while a job is queued, staging or activating and
  the section is visible: every 2 s, backing off to 10 s. Polling stops when the
  job reaches a terminal state or the section closes. There is no idle polling.
- Apply never starts, stops or restarts Minecraft, and the UI offers none of
  those. The section requires Minecraft `stopped` before Apply or Restore
  previous are enabled.
- Unknown `risks` and `warnings` codes are shown with a generic line, never
  dropped.

## SFTP

| Command | Args | Returns | Route |
| --- | --- | --- | --- |
| `server_sftp` | `{ connectionId }` | `SftpStatus` | GET `/sftp` |
| `server_sftp_update` | `{ connectionId, patch: SftpConfigPatch, intentId }` | `SftpStatus` | PATCH `/sftp` |
| `server_sftp_keys` | `{ connectionId }` | `SftpKey[]` | GET `/sftp/keys` |
| `server_sftp_key_add` | `{ connectionId, principalId, label, publicKey, expiresAtMs, intentId }` | `SftpKey` | POST `/sftp/keys` |
| `server_sftp_key_revoke` | `{ connectionId, keyId, intentId }` | `void` | DELETE `/sftp/keys/{id}` |
| `server_sftp_open` | `{ connectionId }` | `SftpTarget` | none (local shell open) |

```ts
interface SftpLimits { sessions: number; sessionsPerIp: number; handlesPerSession: number; transfersPerPrincipal: number;
  bytesPerSecond: number; bytesPerSession: number; maxFileBytes: number; idleTimeoutSecs: number }
interface SftpConfig { enabled: boolean; bindAddress: string; port: number; allowCidrs: string[]; denyCidrs: string[]; limits: SftpLimits }
type SftpConfigPatch = Partial<Omit<SftpConfig, 'limits'>> & { limits?: Partial<SftpLimits> };
interface SftpStatus { config: SftpConfig; running: boolean; boundAddress: string | null; hostKeyFingerprint: string | null;
  activeSessions: number; authentication: string[]; username: string }
interface SftpKey { id: string; principalId: string; label: string; fingerprint: string; publicKey: string;
  createdAtMs: number; expiresAtMs: number | null; revokedAtMs: number | null }
/** What `server_sftp_open` handed to the OS, for the details popover. */
interface SftpTarget { host: string; port: number; username: string; hostKeyFingerprint: string | null }
```

- **`server_sftp_open` (native-only derivation).** The frontend passes only the
  `connectionId`, never a URL. Native code:
  1. reads `GET /sftp` (or its fresh projection) and requires `running`;
  2. takes the host from the connection's trusted, approved endpoint hostname,
     never from `boundAddress` or `bindAddress`, which may be a wildcard or
     loopback;
  3. builds `sftp://<username>@<host>:<config.port>/` with an RFC 3986 encoded
     UUID username, a bracketed IPv6 host and a validated port. The URL contains
     no password, key or token;
  4. opens it with the approved shell opener (`tauri-plugin-opener`, sftp scheme
     only).

  It rejects with `unsupported` (reason `sftp_disabled`) when SFTP is not running,
  and `unsupported` (reason `sftp_no_handler`) when no app handles `sftp://`. It
  returns the `SftpTarget` it used.
- `username` is the caller's canonical principal UUID, which an SFTP client uses
  as its username. Native passes it through.
- The UI accepts only a single-line OpenSSH public key (`ssh-ed25519`,
  `ecdsa-sha2-*`, `ssh-rsa`, `sk-*`). Anything that looks like a private key
  (`-----BEGIN`, `PRIVATE KEY`) is refused before the IPC call, and pasted text
  is never stored. The UI offers no password fields and never reads, exports or
  generates private keys.
- The UI gates editing on `security.manage`, keys on `credentials.manage` and
  reads on `config.view`, all behind the owner role. A 403 hides the controls.
- `principalId` is the caller (`SftpStatus.username`).

## Placement

- **Settings → Server → World** shows the world name, the current seed (copy), the
  configured seed for new worlds, and **Create new world…**.
- **Settings → Server → Software** shows current and previous software, a
  **Change software…** dialog (pick → versions → review → apply → progress), and
  **Restore previous…**.
- **Files toolbar → SFTP** is a single button. A click reads `server_sftp` (no
  earlier fetch). If SFTP is running, it calls `server_sftp_open` and the
  default client opens. If SFTP is off, or an owner has no active key of their
  own, it opens one small setup dialog instead: an enable switch and port
  (bind address under "More"), then "Add your public key". Non-owners see that
  SFTP isn't turned on for this server. A chevron menu beside the button offers
  **Connection details** (host, port, username, host-key fingerprint, each with
  copy) and **SSH keys** (list, add, revoke), using the same dialog.

No sidebar entry is added for SFTP. No section is added for capabilities the
caller is known to lack, and no data is fetched until its section, dialog or
button is used.
