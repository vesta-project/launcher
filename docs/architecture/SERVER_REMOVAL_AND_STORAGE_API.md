# Vesta Server: removed servers, permanent deletion and storage

Status: proposed. Owner of the server side: Vesta Server (agent). Owner of the client side:
`vesta-host-client`, `commands/hosts.rs`, `features/servers/native-hosts.ts` and the Servers UI.

## Why

Today an owner can remove a server from a machine (`DELETE /v1/host/servers/{id}`). The machine
stops it and keeps it for 7 days by default. The launcher cannot:

- see which servers are waiting in the retention window, or when each one goes for good;
- bring one back;
- delete one for good before the window ends (to free the disk now, or because it must go);
- see how much disk the machine has, what is using it, or free space.

So "Remove" reads as final while it isn't, nothing can be undone from the launcher, and a full
disk is only found out when an install or backup fails with `storage_low`.

## Scope

In: listing removed servers, restoring one, deleting one permanently (from the removed list or
straight from a live server), machine storage (volumes, per server, backups, caches), a per
server storage breakdown, and owner cleanup of things that are safe to delete.

Out: moving servers between volumes, quotas per person, resizing disks, deleting files inside a
server (the Files tab and its trash already do that), backup policy (already in `backups.*`).

## Conventions (same as the rest of the machine API)

- Base path `/v1/host`. Device session auth as today. JSON bodies, camelCase fields.
- Owners only (`primary_owner` and `owner`) for every endpoint here. Anyone else gets
  `403 forbidden`. Nothing here is exposed on the per server management API except
  `GET /api/v3/manage/storage` (see 6), which follows that API's capability gates.
- Lifecycle writes use owner- and operation-scoped UUID keys. Reuse the key for a retry.
  A completed retry returns the original status and receipt. Changing the input returns
  `409 idempotency_conflict`. Endpoint 0 keeps the existing JSON `idempotencyKey`.
  Restore and purge use the `Idempotency-Key` header. Measurement coalesces by host.
- Single-server deletion compares the exact typed `confirmName` with the stored name.
  A mismatch returns `422 confirm_name_mismatch`.

- Sizes are integers in bytes. Times are RFC 3339 UTC strings.
- Paths are never sent raw. Anything location-like is a short label (`"Data drive"`,
  `"/srv/vesta"` is allowed only for owners and only as `displayPath`), consistent with
  `FolderRoot`.
- Machines advertise support in `HostInfo.capabilities`. The launcher shows a feature only when
  its capability is present, and says "needs a newer Vesta Server" otherwise:
  - `removed-servers`: endpoints 1 and 2
  - `server-purge`: `permanently` on endpoint 0, and endpoint 3
  - `storage`: endpoints 4 and 5
  - `storage-cleanup`: endpoint 7
  - `server-storage`: endpoint 6 (per server API)
  - `removed-server-retention`: owner-editable retention
  - `host-events`: owner-only event channel on host realtime

## Server states

```
active ──remove──▶ removed (restorable until restoreUntil)
   │                  │ restore ──▶ active (same serverId)
   │                  │ purge / restoreUntil passes ──▶ purging ──▶ gone
   └──remove permanently──────────▶ purging ──▶ gone
```

A removed server releases its name and game port. Its directory lives in an ID-scoped
location outside the active server root. Purging runs in the background. A removed
server stays visible as `purging` until deletion finishes. Permanent removal of an
active server skips the removed list.

The registry retains a tombstone indefinitely after purge. Allocators check the
registry and pending reservations and retry already-used UUIDs. Unique registry
and reservation keys prevent collisions. Restore reactivates the original row.

### Retention setting

Owners read `removedServerRetentionDays` in `GET /v1/host` and update it through
`PATCH /v1/host` with `{ "removedServerRetentionDays": integer }`. The response
echoes the effective setting alongside the settings revision. The default is 7,
with an inclusive range of 1 through 365. Invalid values return `400 invalid_request`.
Each removal captures a fixed `restoreUntil`, so changes apply to future removals.
Expiry disables restore at the deadline and queues purge using the default backup policy.

## Endpoints

### 0. Remove a server (existing, extended)

`DELETE /v1/host/servers/{serverId}`

Body: `{ "confirmName": string, "idempotencyKey": string, "permanently"?: boolean, "keepBackups"?: boolean }`.

- Recoverable removal stops the server and returns `200 ServerRemoved { serverId, removedAt, restoreUntil }`.
- `permanently: true` requires `server-purge`, stops the server, queues purge and returns
  `202 ServerPurging { serverId, purgeStartedAt, bytes }`. The estimate `bytes` is null
  until measured.
- `keepBackups` applies to permanent deletion and defaults to `true` for manual and
  scheduled purge. The host keeps server-owned local backups outside the purged tree,
  under the server ID. `false` also deletes the exclusive managed repository.
  External and shared repositories remain separately managed: deleting for good never
  touches them (decided 2026-11-21), only backups Vesta manages for that server.

Returns `409 server_busy` while a job owns the server. Other errors include `forbidden`,
`not_found` and `confirm_name_mismatch`.

### 1. List removed servers

`GET /v1/host/servers/removed[?cursor=<opaque>]`

`200 { "servers": RemovedServer[], "nextCursor": string | null }`. Up to 100 entries per
page, newest first with server ID as the tie breaker. Follow `nextCursor` for older entries.

```ts
interface RemovedServer {
  serverId: string;
  name: string;
  removedAt: string;
  restoreUntil: string;            // when the machine purges it on its own
  removedBy: string | null;        // accountId of the owner who removed it, if known
  state: 'restorable' | 'restoring' | 'purging';
  bytes: number | null;            // on disk now; null while not yet measured
  minecraftVersion: string | null;
  software: { kind: string; version: string | null } | null;
}
```

### 2. Restore a removed server

`POST /v1/host/servers/removed/{serverId}/restore`

Body: `{ "name"?: string, "gamePort"?: number }`. Header `Idempotency-Key`.

`200 ServerRestored { serverId, name, gamePort, restoredAt }`. The server returns stopped
with the same ID, settings and backups. Owner access follows the current machine role.
Server grants and invites were revoked on removal. Owners can grant access again.

On a clash with an active server or pending reservation, try `Survival (restored)`, then
`Survival (restored 2)`, and continue until the name is free. Trim the base to fit the
registry name limit. Try the original port first, then the standard host port search.
An explicit port must be available or returns `409 game_port_in_use` or
`port_state_unknown`. An exhausted automatic search returns `409 port_unresolved`.
The machine reserves the chosen name and port with the registry update and applies
the port to the game configuration before start.

Returns `409 purging` after purge begins, `410 gone` after completion and `404 not_found`
for an unknown ID. A completed retry returns its receipt even after the lifecycle advances.

### 3. Delete a removed server for good

`DELETE /v1/host/servers/removed/{serverId}`

Body: `{ "confirmName": string, "keepBackups"?: boolean }`. Header `Idempotency-Key`.
Needs `server-purge` and uses the backup policy from endpoint 0.

Returns `202 ServerPurging { serverId, purgeStartedAt, bytes }`. Completed retries
return the original receipt. A new request after purge returns `410 gone`.

### 4. Machine storage

`GET /v1/host/storage`

`200 HostStorage`. Answered from the last measurement, so it returns fast. Measuring walks the
disk, so it runs in the background (on start, after each job that writes server files, and at
most every 15 minutes), never inline in this request.

```ts
interface HostStorage {
  measuredAt: string | null;       // null before the first measurement finishes
  measuring: boolean;              // a measurement is running now
  volumes: StorageVolume[];        // every volume that holds Vesta data
  servers: ServerStorage[];        // active servers, largest first
  removed: { count: number; bytes: number };        // the removed list (1)
  backups: { bytes: number; outsideServers: number };// repositories not counted in a server
  caches: StorageCache[];          // things Vesta can download again
  other: number;                   // Vesta data not in any group above
}
interface StorageVolume {
  volumeId: string;
  label: string;                   // e.g. "Data drive"
  displayPath: string;             // owners only
  totalBytes: number;
  freeBytes: number;
  holds: Array<'servers' | 'backups' | 'caches' | 'state'>;
  lowAt: number;                   // the machine's own storage_low threshold for this volume
}
interface ServerStorage {
  serverId: string;
  name: string;
  volumeId: string;
  bytes: number;
  parts: StorageParts;
}
interface StorageParts {           // all bytes; parts may sum to less than the total ("other")
  worlds: number;
  backups: number;                 // this server's backup repository, if it lives with the server
  content: number;                 // mods, plugins, datapacks, resource packs
  logs: number;
  software: number;                // server jar / loader files
  trash: number;                   // the Files tab's recoverable trash
  other: number;
}
interface StorageCache {
  kind: 'java' | 'software_downloads' | 'catalogue' | 'pack_staging' | 'temp';
  bytes: number;
  removable: boolean;              // false while something is using it (e.g. a Java a server runs)
}
```

`POST /v1/host/storage/measure` asks for a fresh measurement now: `202 { measuring: true }`. It
is coalesced (a running measurement is reused) and rate-limited (`429 rate_limited` with
a `Retry-After` header in seconds).

### 5. Measuring progress

Poll `GET /v1/host/storage` while `measuring` is true. The host sync loop also polls
the active and removed lists. Refresh affected snapshots after a lifecycle write.

### Machine events

The future `host-events` capability enables an owner-only `host` channel at
`GET /v1/host/realtime` using the native bearer-authenticated WebSocket. The route
currently returns `501 realtime_multiplexer_deferred`. Existing per-server WebSockets
for console, files, metrics and packs continue at their current URLs.

The client sends `{ "op": "subscribe", "channel": "host", "after": string | null }`.
A null cursor starts live delivery. The server sends
`{ "channel": "host", "cursor": string, "type": string, "data": object }` in increasing
cursor order. The cursor is a host-scoped decimal string. The durable replay log retains
up to 1,000 events for up to 24 hours. Commit lifecycle events with their state transition.
Publish storage events after the snapshot is available.

| Event | Data |
| --- | --- |
| `server.removed` | `{ serverId, removedAt, restoreUntil }` |
| `server.restored` | `{ serverId, name, gamePort, restoredAt }` |
| `server.purging` | `{ serverId, purgeStartedAt }` |
| `server.purged` | `{ serverId, purgedAt }` |
| `storage.measured` | `{ measuredAt }` |

Events invalidate snapshots. On a replay gap or invalid cursor the server sends
`{ "op": "reset", "channel": "host", "cursor": string }` with the current high-water cursor.
The launcher refetches while receiving invalidations and refreshes again if an event
arrived mid-fetch. After disconnect, reconnect with a current session and the last cursor,
deduplicate replayed cursors and poll until the stream returns. The host checks current
authority during delivery and closes on session expiry or loss of owner access.

### 6. One server's storage (per server management API)

`GET /api/v3/manage/storage`, gated by a new `storage.view` capability (owner and admin role
defaults), so a server admin who is not a machine owner can see their own server.

`200 { measuredAt, bytes, parts: StorageParts, volume: { label, freeBytes, totalBytes },
largest: Array<{ path: string; bytes: number }> }` where `largest` is the ten biggest folders
inside the server, as server-relative paths (the Files tab can open them).

### 7. Cleanup

`POST /v1/host/storage/cleanup`

Body: `{ "targets": CleanupTarget[], "dryRun": boolean }`. Header `Idempotency-Key` (ignored
for dry runs).

```ts
type CleanupTarget =
  | { kind: 'cache'; cache: StorageCache['kind'] }   // only removable caches
  | { kind: 'logs'; serverId: string | 'all'; olderThanDays: number }
  | { kind: 'trash'; serverId: string | 'all' }
  | { kind: 'removed'; serverId: string | 'all'; confirmName?: string }; // purge; name needed for one server
```

`200 CleanupResult { dryRun, items: Array<{ target: CleanupTarget; bytes: number; skipped?:
'in_use' | 'busy' | 'not_found' }>, bytes }`. The launcher always shows a dry run first and sends
the same targets for real.

Never touched by cleanup: worlds, configs, backups of active servers, anything in a server that
a job currently owns.

## Errors

Host errors use `{ "error": { "code": string, "requestId": string } }`. The launcher
translates fixed codes. Endpoint 6 keeps the per-server management envelope.

| Code | Status | When |
| --- | --- | --- |
| `confirm_name_mismatch` | 422 | The typed and stored names differ |
| `server_busy` | 409 | Another job owns the server |
| `purging` | 409 | Purge is in progress |
| `gone` | 410 | Purge finished |
| `rate_limited` | 429 | Measurement requested too soon. Read `Retry-After` |

## Launcher plan (once the machine side exists)

- Machine settings gets a Storage section: one bar per volume (used, free, the low threshold),
  then servers largest first with their parts, removed servers, backups and caches. Each server
  row opens that server's storage.
- Machine settings gets Removed servers: name, size, "Deleted for good in 4 days", Restore and
  Delete now. Show the assigned name and port after restore.
- The Remove dialog shows the current retention. Permanent deletion asks for the typed
  name, defaults "Keep backups" on and shows the measured size estimate when available.
- Server settings gets a Storage section from endpoint 6.
- Cleanup is one sheet: tick what to clear, see the dry run total, confirm.
- Everything is hidden behind the capabilities above, so older machines keep today's UI.

Native: new `HostRequest` actions `ServersRemoved`, `ServerRestore`, `ServerPurge`, `Storage`,
`StorageMeasure`, `StorageCleanup`, mapped in `commands/hosts.rs` like the existing ones, and a
`server_storage` command on the per server client. Fixtures in `host-fixtures.ts` should cover:
a removed server two days from purge, one that will receive the restore suffix, one purging, a volume under its
low threshold, and a machine without the capabilities.

## Tests the server side should have

- Remove then restore returns the same `serverId` and backups, with previous grants revoked; a second restore with the
  same key returns the same receipt.
- Purge removes files and the record; restore after purge is `410`.
- `permanently: true` never leaves the server in the removed list.
- `restoreUntil` passing purges without a request, and the list stops showing it.
- Storage numbers add up per volume within measurement tolerance, and `GET /storage` never
  blocks on a walk.
- Cleanup dry run and real run report the same items when nothing changed in between; in-use
  caches are skipped.
- Non-owners get `403` on every `/v1/host` endpoint here; `storage.view` gates endpoint 6.
