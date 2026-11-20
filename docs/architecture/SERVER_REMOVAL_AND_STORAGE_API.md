# Vesta Server: removed servers, permanent deletion and storage

Status: proposed. Owner of the server side: Vesta Server (agent). Owner of the client side:
`vesta-host-client`, `commands/hosts.rs`, `features/servers/native-hosts.ts` and the Servers UI.

## Why

Today an owner can remove a server from a machine (`DELETE /v1/host/servers/{id}`). The machine
stops it and keeps it for 7 days. The launcher cannot:

- see which servers are waiting in that 7 day window, or when each one goes for good;
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
- Writes take `Idempotency-Key` (the client sends one key per attempt, as `server_remove` does
  now). A replay of the same key returns the first receipt, never a second effect.
- Destructive writes take `confirmName`: the server's name typed exactly. The machine compares
  it to its own record. Mismatch is `422 confirm_mismatch`.
- Sizes are integers in bytes. Times are RFC 3339 UTC strings.
- Paths are never sent raw. Anything location-like is a short label (`"Data drive"`,
  `"/srv/vesta"` is allowed only for owners and only as `displayPath`), consistent with
  `FolderRoot`.
- Machines advertise support in `HostInfo.capabilities`. The launcher shows a feature only when
  its capability is present, and says "needs a newer Vesta Server" otherwise:
  - `removed-servers`: endpoints 1 to 3
  - `server-purge`: `permanently` on endpoint 0, and endpoint 3
  - `storage`: endpoints 4 and 5
  - `storage-cleanup`: endpoint 7
  - `server-storage`: endpoint 6 (per server API)

## Server states

```
active ──remove──▶ removed (restorable until restoreUntil)
   │                  │ restore ──▶ active (new or same serverId, see 2)
   │                  │ purge / restoreUntil passes ──▶ purging ──▶ gone
   └──remove permanently──────────▶ purging ──▶ gone
```

`purging` is short but real (large worlds take time to delete). A purging server is listed with
`state: "purging"` until its files are gone, then disappears. Purging never blocks other work on
the machine.

## Endpoints

### 0. Remove a server (existing, extended)

`DELETE /v1/host/servers/{serverId}`

Body: `{ "confirmName": string, "permanently"?: boolean }`. Header `Idempotency-Key`.

- Without `permanently` (or `false`): unchanged. Stops the server, moves it to the removed list.
  `200 ServerRemoved { serverId, removedAt, restoreUntil }`.
- With `permanently: true` (needs `server-purge`): stops it and deletes it for good, skipping
  the removed list. Backups made by the server's own backup profiles go with it unless
  `keepBackups: true` is also sent (see Open questions). `202 ServerPurging { serverId,
  purgeStartedAt, bytes }`.

Errors as today (`busy` while a job owns the server, `forbidden`, `not_found`), plus
`confirm_mismatch`.

### 1. List removed servers

`GET /v1/host/servers/removed`

`200 { "servers": RemovedServer[] }`, newest removal first.

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
  restoreBlockers: RestoreBlocker[];  // empty when it can come back as it was
}
type RestoreBlocker =
  | { kind: 'name_taken' }               // an active server now has the same name
  | { kind: 'port_taken'; port: number } // its game port is used by an active server
  | { kind: 'storage_low'; needBytes: number; freeBytes: number };
```

### 2. Restore a removed server

`POST /v1/host/servers/removed/{serverId}/restore`

Body: `{ "name"?: string, "gamePort"?: number }` (only needed to resolve `name_taken` or
`port_taken`). Header `Idempotency-Key`.

`200 ServerRestored { serverId, name, gamePort, restoredAt }`. The server comes back stopped,
with the same `serverId`, roles, backups and settings. Devices that knew it see it again on their
next `GET /servers`.

Errors: `409 restore_blocked { blockers: RestoreBlocker[] }` when a blocker is not resolved by
the body, `409 purging` once purge has started, `410 gone` after purge, `404 not_found`.

### 3. Delete a removed server for good

`DELETE /v1/host/servers/removed/{serverId}`

Body: `{ "confirmName": string }`. Header `Idempotency-Key`. Needs `server-purge`.

`202 ServerPurging { serverId, purgeStartedAt, bytes }`. Replays while purging return the same
receipt. After purge, `410 gone`.

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
`retryAfterMs`).

### 5. Measuring progress

Not a separate endpoint: poll `GET /v1/host/storage` while `measuring` is true (the existing
host sync cadence is enough), or listen for the `storage.measured` event on the existing
machine event stream if the machine has one by then.

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

Same envelope as the rest of the machine API (`{ code, message?, ... }`). New codes:

| code | status | when |
| --- | --- | --- |
| `confirm_mismatch` | 422 | `confirmName` is not the server's name exactly |
| `restore_blocked` | 409 | a `RestoreBlocker` remains; body has `blockers` |
| `purging` | 409 | the server is already being purged |
| `gone` | 410 | the server was purged |
| `rate_limited` | 429 | measure asked again too soon; body has `retryAfterMs` |

Existing codes keep their meaning (`forbidden`, `not_found`, `busy`, `storage_low`).

## Launcher plan (once the machine side exists)

- Machine settings gets a Storage section: one bar per volume (used, free, the low threshold),
  then servers largest first with their parts, removed servers, backups and caches. Each server
  row opens that server's storage.
- Machine settings gets Removed servers: name, size, "Deleted for good in 4 days", Restore and
  Delete now. Restore resolves blockers inline (new name, new port).
- The Remove dialog offers "Remove" (keeps it 7 days, the default) and "Delete permanently"
  (needs the typed name, says the size freed).
- Server settings gets a Storage section from endpoint 6.
- Cleanup is one sheet: tick what to clear, see the dry run total, confirm.
- Everything is hidden behind the capabilities above, so older machines keep today's UI.

Native: new `HostRequest` actions `ServersRemoved`, `ServerRestore`, `ServerPurge`, `Storage`,
`StorageMeasure`, `StorageCleanup`, mapped in `commands/hosts.rs` like the existing ones, and a
`server_storage` command on the per server client. Fixtures in `host-fixtures.ts` should cover:
a removed server two days from purge, one with `name_taken`, one purging, a volume under its
low threshold, and a machine without the capabilities.

## Tests the server side should have

- Remove then restore returns the same `serverId`, roles and backups; a second restore with the
  same key returns the same receipt.
- Purge removes files and the record; restore after purge is `410`.
- `permanently: true` never leaves the server in the removed list.
- `restoreUntil` passing purges without a request, and the list stops showing it.
- Storage numbers add up per volume within measurement tolerance, and `GET /storage` never
  blocks on a walk.
- Cleanup dry run and real run report the same items when nothing changed in between; in-use
  caches are skipped.
- Non-owners get `403` on every `/v1/host` endpoint here; `storage.view` gates endpoint 6.

## Open questions

1. Should permanent deletion keep backups by default (safer) and offer to delete them too? The
   draft deletes them with the server unless `keepBackups: true`; keeping them by default is the
   safer choice if backups can live outside the server folder.
2. Is 7 days still right once permanent deletion exists, and should it be a machine setting?
3. Should restore be allowed into a different name automatically (e.g. "Survival (restored)")
   instead of returning `name_taken`?
4. Does the machine event stream exist yet for `storage.measured`, or is polling enough for now?
