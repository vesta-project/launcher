# Presence and branding native contract

Implemented in `crates/vesta-server-client` and registered in the shared launcher
library used by both Tauri applications. Frontend additions are contract/fixture
modules only; there is no new UI.

## Commands

- `server_sleep_policy`, `server_sleep_policy_update`: GET/PUT `sleep/policy`.
  Revision is the frontend's numeric revision, starting at zero.
- `server_motd_policy`, `server_motd_policy_update`, `server_motd_preview`:
  GET/PUT `motd/policy`, POST `motd/preview`.
- `server_branding`, `server_branding_update`: GET/PATCH `server`; projections
  contain only `{name, description, revision}`. Revision stays an opaque string.
  Omitted patch fields are preserved; `description: ""` clears the text. The agent
  does not accept null description patches. Read descriptions can be null.
- `server_icon`, `server_icon_set`, `server_icon_clear`: GET/PUT/DELETE
  `server/icon`. IPC is base64 PNG without a data URI prefix, or null on GET when
  no custom icon exists. Set/clear return void.
- `server_device_rename`: PATCH `devices/{id}` with `{name}`; returns `{id,name}`.
  The agent enforces that the target belongs to the caller, including revoked
  devices. A rank/ownership refusal is not learned as a global capability refusal.

Mutations use the existing connection-scoped intent key, payload-hash journal,
failure synchronization and activity integration. Journals retain no policy
contents, branding text, image data, invitation codes or bearer tokens.

## MOTD adapter

Verified against the runtime types in the agent at `85aca9a`, rather than assuming
the preview has the same structure as the TypeScript DTO:

- GET policy has a nullable numeric i64 revision. IPC converts it to a decimal
  string (or null). PUT converts that string back to an exact JSON integer;
  noncanonical, zero/negative and overflowing revisions are refused. No JavaScript
  number conversion occurs, including above 2^53.
- PUT returns only a revision and apply hints. Native returns the accepted draft
  with that revision, resolving nullable fields to concrete agent defaults.
- The agent requires `version_name: string` and `maximum_players: u16`.
  Frontend null means `"Vesta"` and `0`, matching the agent's default document.
  Agent template validation and player-cap limits remain authoritative.
- `states` is a keyed map. `crash_loop` and `recovery_required` are preserved
  literally; the generic recursive snake-to-camel converter is not applied to
  these keys.
- Preview wire data is `{preview:{description:{text:"",extra:[...]},plain_lines,
  favicon_data_uri,...},placeholders,...}`. Each flat extra component contains
  text plus optional named color and style flags. Native splits component text at
  newlines, assigns line 0/1, maps all 16 Minecraft color names to the standard
  uppercase hex palette, defaults absent style flags to false, pads a missing
  second plain line, and strips `data:image/png;base64,` from the rendered icon.
  Generated fallback icons are returned faithfully. The agent's placeholder
  catalogue is copied, and segment text must agree with the supplied plain lines.
- `sleep_policy_conflict` and `motd_policy_conflict` (409) map to `stale_target`.
  Template/preview validation refusals (400) map to `invalid_input`.

The temporary/offline presentation does not alter the live Minecraft MOTD;
`server.properties` remains the separate live configuration route.

## Icon concurrency and bounded reads

Native validates standard base64, the PNG signature and at most 256 KiB of decoded
data before uploading. The agent validates dimensions (64–512 per side), CRCs,
pixel format and decompressed data, and normalizes away ancillary metadata.
The fixture models the signature/size boundary without reimplementing PNG decoding.

Before an icon mutation, native reads the current icon and keeps its strong ETag
inside native code. Create uses `If-None-Match: *`; replace/delete use `If-Match`.
A missing icon makes clear a successful no-op. Concurrent edits return
`stale_target` (412); there is no automatic validator refresh and overwrite.
Native icon commands reserve one-shot journal intents: repeated calls with the
same intent return `outcome_unknown`, since reconstructing headers after a lost
reply could change that intent. Reconcile via `icon()` before a new user intent.
Known 401 session renewal retains the original headers and key.

Invitation/device lists use `{invitations|devices,next_offset}` and explicit
`limit=100`, with four pages maximum. Snapshot lists use `limit=100`, `before`,
and `next_before`, with a shared four-page maximum across normal and safety lists.
Exhaustion fails `server_busy` instead of silently returning a partial list.
The legacy per-user device fallback also has four user pages and a separate
100-request bound. Invitation create preserves the issued `id` and `pairing_link`;
revoke uses DELETE `invitations/{id}`. The client also exposes snapshot detail via
GET `backups/snapshots/{id}?profile=...`, mapping its nullable size/count fields.

## Verification

- All required Rust tests, client Clippy with `-D warnings`, both Tauri checks,
  frontend typecheck, and the server/localization Bun checks pass.
- Added Rust mapping, HTTPS wire, icon conditional-request, and pagination-budget
  tests; added three branding Bun fixture tests (96 server/localization tests total).
- The opt-in `live_presence_branding_and_icons` test passed against the local
  `feat/launcher-compat` binary: sleep update/stale revision, MOTD render/styles,
  save/stale revision/invalid placeholder, branding update/stale revision,
  icon create/replace/delete/missing clear, and own-device rename/list readback.
  Runtime data stayed under `target/live-agent/launcher-Gxm3br`; the fixture records
  hashes of the pinned binaries. No agent source or target files were modified.
- Existing warnings in piston-lib and launcher import/resource code remain.

Windows PowerShell does not expand `checks/servers-*.test.js` for Bun. To execute
the complete requested set, use:

```powershell
$checks = @(Get-ChildItem checks/servers-*.test.js | ForEach-Object { './checks/' + $_.Name })
bun test @checks ./checks/localization.test.mjs
```
