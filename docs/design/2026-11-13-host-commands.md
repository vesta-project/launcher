# Native host commands (2026-11-13)

Canonical frontend binding: `apps/desktop-solid/src/features/servers/native-hosts.ts`.
All argument objects use camelCase. All command failures use the existing
`ServerCommandError` shape `{code, reason?, retryAfterMs?, localPressure?}`.
Private keys and host/PAKE/session bearers never cross IPC or enter JSON persistence.

## State and management targets

Hold `hosts: VestaHost[]`, `discovered: HostDiscovery[]`, `selectedHostId`,
`serversByHost: Record<string, HostServer[]>`, `pendingLink: LinkResult | null`,
`importJob: {hostId, jobId, idempotencyKey} | null`, and transient wizard inputs.
Keep setup/link codes and import confirmations transient. Do not save them in browser storage.
`VestaHost` contains `{id,name,fingerprint,endpoints:string[],deviceId,keyReference,
accountId,authRevision}`. `keyReference` is an opaque OS-vault reference, not key material.
`ServerRef` is `{hostId,serverId}`. Use `hostConnectionId(ref)` to pass the stable
`hostId:serverId` connection ID (one router segment) into **all existing server commands and subscriptions**.
Call `hostsNative.servers(hostId)` first to materialize native server projections.
Existing server command signatures/events remain unchanged. A host's servers share one
session-renewal mutex and device key; their resource caches and stream cursors remain separate.
Plain saved game servers and Modrinth records are not modified.

Metadata is profile-local `hosts-v1.json`; server projections remain in
`server-connections-v1.json`. Existing per-server records remain readable but are not
converted into hosts. Keys use the existing profile-scoped OS vault. Sessions are memory-only.
Removing a server ref does not delete the shared device key. Removing the host removes
its refs, local credentials and sessions; this is a local forget operation, not remote revocation.

## IPC and TS signatures

The exported object is `hostsNative`; methods return promises:

| IPC | Binding signature | Result |
|---|---|---|
| `host_discover` | `discover()` | `HostDiscovery[]` after bounded 3s mDNS browse plus probes |
| `host_probe` | `probe(address:string)` | `HostDiscovery` |
| `hosts_list` | `list()` | `VestaHost[]` |
| `host_remove` | `remove(hostId:string)` | `void` |
| `host_claim` | `claim(address,code,accountUuid,deviceName)` (all string) | `VestaHost` |
| `host_sign_in` | `signIn(hostId:string)` | `HostInfo` (automatically proves device possession) |
| `host_link_start` | `linkStart(address,code,accountUuid,deviceName)` | `LinkResult` |
| `host_link_poll` | `linkPoll(linkId:string)` | `LinkResult`; poll at most once/second |
| `host_servers` | `servers(hostId:string)` | `{servers:HostServer[],nextCursor:string|null}` |
| `host_request` | `request(hostId,action,options)` (internal binding helper) | action-specific JSON |

`host_request` takes `{hostId,action,id?,body?,revision?,idempotencyKey?}`. Native
code selects a closed route; the frontend cannot supply URLs or authorization.
All wrapper methods below take `hostId:string` first:

| Action / wrapper | Remaining TS arguments | Method / host suffix |
|---|---|---|
| `info` | none | GET host root |
| `devices` | none | GET `/devices` |
| `linkCode` | `targetAccountId:string` | POST `/link-codes` |
| `linkStatus` | `id:string` | GET `/links/{id}` |
| `linkApprove` | `id:string,requestHash:string` | POST `/links/{id}/approve` |
| `deviceRevoke` | `id:string` | DELETE `/devices/{id}` |
| `ownerChange` | `action:'owner_promote'|'owner_demote'|'ownership_transfer',accountId:string,revision:string` | PUT/DELETE `/owners/{id}` or POST `/ownership/transfer` |
| `folderRoots` | none | GET `/folders/roots` |
| `folderResolve` | `rootId:string,relativePath:string` | POST `/folders/resolve` |
| `folderList` | `folderToken:string,cursor:string|null=null` | POST `/folders/list` |
| `importCandidates` | none | GET `/imports/candidates` |
| `importInspect` | `folderToken:string,gamePort:number|null=null` | POST `/imports/inspect` |
| `importResources` | `gamePort:number|null,memoryMiB:number|null` | POST `/imports/resources` |
| `importPlan` | `body:ImportPlan,idempotencyKey:string` | POST `/imports/plan` |
| `importApply` | `body:ImportApply,idempotencyKey:string` | POST `/imports/apply` |
| `importJob` | `id:string` | GET `/imports/jobs/{id}` |
| `importCancel` | `id:string,idempotencyKey:string` | POST `/imports/jobs/{id}/cancel` |
| `importResume` | `id:string,idempotencyKey:string` | POST `/imports/jobs/{id}/resume` |
| `importStart` | `id:string,idempotencyKey:string` | POST `/imports/jobs/{id}/start` |
| `importReadiness` | `id:string` | GET `/imports/jobs/{id}` (status observes readiness) |

Import job flow: `importPlan` returns 202 `{jobId,state:"planning"}`; poll `importJob` (about 1/s)
until `review`/`blocked`/`failed`. `importApply` returns 202 `{jobId,serverId}`; poll until `ready`
(phase `register`). `importStart` returns the job (202); while `starting`, each `importJob`/
`importReadiness` poll checks game readiness and moves to `online`. `ImportJob` is
`{jobId,state,phase,error,progress,review,serverId}`; `review.confirmation` is null when blocked.
`importResume` is valid only for `interrupted`. Start failures return the job to `ready` with
`error` set. After `online` (or `ready`), call `servers(hostId)` to materialize the new server.

Owner changes fetch a fresh challenge, sign the exact host/device/action/target/revision
natively, and send matching If-Match. Refetch host info after owner changes or ambiguous
responses. The server has no separate owner-list route; role/revision come from host info.
Folders refer to remote machine directories. Apply is the copy/register commit; start is
explicit. Generate one UUID idempotency key per plan/apply/resume/cancel/start intent and
retain it for retry. After a definitive start failure, a new attempt uses a new key.
Import payloads/results are passed through unchanged; the frontend must display blockers,
require warning/EULA/source-stopped consent, and never infer support from inspection alone.

## Discovery, trust, sessions and events

Probe accepts `host[:port]` (default 25500), bracketed IPv6, or an HTTPS origin.
Discovery returns `{hostId,name:string|null,fingerprint,address,state:string|null}`.
Discovery and mDNS are hints. Only PAKE authenticates a new host; a stored pin authenticates
subsequent endpoints. mDNS never replaces a pin. Verified new addresses are prepended to
an eight-entry fallback list, and live clients are retired so the next request resolves anew.
A bounded background browse runs roughly once per minute; explicit discover also refreshes
on demand. There is no permanent multicast subscription. Known endpoints do not retire clients.

Claim/link use TLS 1.3, disabled resumption/early data, one non-reconnecting HTTP connection,
and the actual leaf/exporter for PAKE. Minecraft tokens go only to fixed Mojang join HTTPS;
Vesta receives a signed account proof. Linked devices sign in offline against the pin.
Bearer renewal happens two minutes before expiry, shared across all servers on a host;
a rejected bearer triggers one concurrency-safe renewal and one retry. Endpoint fallback
retries connection establishment failures, never an uncertain mutation after dispatch.
Existing management JSON, binary file headers and WebSocket upgrade authentication are
retained with `/v1/servers/{serverId}` routing. Host server routes have no anonymous access,
so public status is also fetched with the host bearer. Per-server pairing, `auth/*`
routes and fingerprint re-pinning return `unsupported` for host server refs. Console/metrics streams close locally at
25s, reconnect with current bearer and reuse existing polling/snapshot/cursor reconciliation.
The host realtime multiplexer is deliberately unused.

`core://servers-changed` and existing server subscription channel events continue to signal
server projection changes. Host discovery/link polling/claim results are returned directly;
refresh the host list after these promises resolve. There are no new host push events.

## Errors and limitations

Closed `code` values include `invalid_address`, `invalid_input`, `tls_failed`,
`fingerprint_mismatch`, `credentials_unavailable`, `credentials_rejected`, `unreachable`,
`not_found`, `forbidden`, `conflict`, `rate_limited`, `server_busy`, `unsupported`,
`outcome_unknown`, `internal`. Bounded server wire codes are preserved in `reason`, e.g.
`pairing_failed`, `account_verification_unavailable`, `imports_unavailable` (host has no
import service), `import_job_not_found`, `idempotency_key_required`, `eula_required`,
`warnings_unacknowledged`, `source_stop_confirmation_required`, `import_jobs_saturated`,
`worker_unavailable`, `source_changed`, `game_port_in_use`, `source_running`, `start_failed`.
Other job conflicts arrive as `conflict` with the server code in `reason`. Do not retry
unknown outcomes with a new import key. No raw OS/network messages are returned.

Pending link PAKE capabilities live in memory and require the original TCP connection;
restart/disconnect requires restarting the link flow. PAKE-proven pending enrollments are journaled before claim/link dispatch. After a lost reply,
call `signIn(discovery.hostId)` to recover deviceId using device-key lookup followed by fresh
possession proof. Unsuccessful pre-proof enrollments clean up their vault keys. Pending
enrollments are not shown as successfully linked hosts until proof succeeds. A dedicated
pending-enrollment listing/cancellation UI is not included.
Host list pagination and owner enumeration are not available in the current server slice.
The server explicitly excludes legacy identity/security/SFTP suffixes; those feature
commands reach the host prefix but receive unsupported/not-found where excluded.
The ignored `host_agent` integration test uses disposable loopback state and the local
setup-code CLI, plus an explicit online Minecraft test account. It never reads launcher accounts.
