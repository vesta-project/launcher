# Modpack installation: diagnosis and replacement plan

## Confirmed on this machine

- The running agent executable was built 30 October at 15:05 Sydney. It predates the 31 October provider filename fixes.
- The screenshot identifies a dependency, not COBBLEVERSE itself: CurseForge 1173260/6060565 is `Cobblemon 3D Poké Rods 1.0.zip`. The old validator rejects the Unicode filename. Live authenticated metadata and a live CDN download work; the provider SHA1 matches. Current code accepts this metadata, covered by server commit `8ac6b35`.
- `PackWorkspace::install_plan` downloads the pack archive, parses it, resolves all server resources, and downloads/verifies those resources before returning review. A CurseForge server pack can require a second archive. Both file hashes and review state are built around verified payloads, so simply deleting this work would break apply preconditions.
- Replanning only reuses resource payloads from the latest unexpired completed plan. It does not provide a durable checkpoint for a preparation that failed halfway through. Archive downloads are repeated.
- Native requests give preparation an hour-long HTTP timeout. That does not make it a durable job: the request remains the result channel, and closing the dialog or losing the connection loses the caller's result.
- Pack uploads use 512 KiB chunks and durable server receipts, but previously failed immediately on a single temporary capacity, pacing, timeout, or connection error. Authenticated chunks consume launcher and server request budgets alongside page refreshes.

## Changes made now

The native client retries only upload begin/chunk/finish, at most four attempts per request. It preserves the exact body, offset and idempotency key, honors Retry-After up to 30 seconds, and backs off when there is no pacing hint. Conflict, permission, validation and TLS/trust refusals stop immediately. This covers dropped-file native uploads and the frontend byte uploader through their shared client. It does not persist upload progress across launcher restarts.

The latest agent binaries build. The automatic update did not replace the running process: the legacy staging directory lacks the current session marker, and using a fresh staging directory then found no registered server in the selected registry. Neither attempt stopped the old agent. Do not claim this user's live install is fixed until a current agent is running and the whole pack completes.

## Replacement flow

1. **Inspect the selected version.** Fetch provider metadata and the pack manifest/index, identify Minecraft/loader and a server pack if present, and show a compact source/version/runtime summary. Do not fetch individual mod JARs here. For uploaded archives, transfer once and retain the resulting archive reference. When the provider supplies no standalone manifest, archive inspection still needs archive bytes. HTTP range extraction can be an optional later optimization with a complete-download fallback; do not promise instant inspection for every ZIP.
2. **Install starts durable preparation.** The Install action returns a persisted operation ID promptly. Agent workers fetch and verify resources, with byte/file progress and per-file retry. The UI observes that operation through existing activity mechanisms. Closing/reopening the dialog or reconnecting attaches to the same operation; it must not start another preparation.
3. **Review only actual decisions.** A fresh server needs no second generic review. Stop for a software change, overwritten user file, removed owned file or unresolved provider restriction. Counts computed from metadata are estimates until preparation finishes. If a conflict requires byte-level inspection, present it after preparation. Never fabricate hashes or reuse the existing verified-file plan DTO as a metadata preview.
4. **Apply verified payloads.** Recheck authority, software revision and file preconditions just before effects. Preserve backup choice, owned-file tracking, client/server pack separation and software switching. New conflicts return the same operation to a decision state. Success updates the server link only after the corresponding effect succeeds.

## Implementation boundaries

- Split `install_plan` into manifest inspection, durable preparation and verified apply. Introduce distinct inspection and operation DTOs; retain compatibility for old callers while migrating the dialog.
- Persist source identity, actor, request fingerprint, archive references, progress, failure details and cancellation in the existing operation framework. Reauthorize on resume and before effects. Worker capacity belongs to the job, not the HTTP waiter. Restart recovery must distinguish resumable preparation from an interrupted apply.
- Add a digest-addressed download cache that retains verified completed files across failed attempts. Resolve authoritative provider metadata afresh; a cache hit requires digest verification. Partial bytes need a strong server validator before range resume. Bound cache storage and collect unreferenced data.
- For uploads, retain the upload ID and committed offset, provide an authenticated status query, and resume after reconnect/reopen. Separate bounded transfer admission from status/control requests. Keep per-device/session pacing; do not solve congestion by removing limits or increasing every timeout.
- Expose cancellation and retry on the durable operation. Cancellation stops network work and prevents apply; it must not merely hide the dialog while a blocking worker keeps running.

## Acceptance evidence required for the replacement

- Large-pack inspection downloads no individual mod payloads before Install.
- Connection loss and launcher restart during preparation reattach to the same operation; completed files are not downloaded again.
- A lost chunk reply is replayed with the same key and offset without duplicate bytes; sustained busy/rate-limit responses are bounded and preserve resumable state.
- Status and lifecycle remain available during upload and preparation.
- Agent restart during preparation resumes safely; restart during apply uses existing recovery rather than replaying effects blindly.
- Tests cover an unavailable provider file, hash mismatch, missing runtime tags, Unicode names, client-only dependencies, server packs and concurrent target-file changes.
- Run an end-to-end COBBLEVERSE install on a current agent. The exact dependency metadata regression alone is not proof of whole-pack installation.

Status: diagnosis and upload retry improvement implemented; the inspection/job split above is a proposed architectural replacement, not implemented in this change.
