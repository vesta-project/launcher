# Resource loading and server-pack installation

## Installation finding

The screenshot's `pack_join_address_missing` occurs after the shared update task
commits the pack. The saved management endpoint is `localhost:8443`; parsing it
directly with `Url::parse` interprets `localhost` as a scheme and finds no host.
The pack is present and its receipt verifies, but the outer task fails while
adding the Minecraft server. This explains the contradictory success/failure UI.

Fixed: use the validated Endpoint parser and Minecraft's advertised game port,
including IPv6 brackets. Server integration now runs inside shared finalization,
before Installed is published, with the existing file/metadata rollback path.
Failed or unfinished instances also withhold the overview's Up to date indicator.

## Actual install paths

Ordinary initial pack: InstallModpackTask -> provider archive -> piston-lib
ModpackInstaller -> parallel resource download -> manifest/Java/resource indexing.

Server-linked pack: InstallModpackTask::Server -> signed server release ->
prepare_new_install -> pack_sync_legacy::normalize -> UpdateModpackTask::Server
-> shared modpack engine -> signed receipt and instance metadata.

For catalogue releases, the server sends provider/project/version references;
the launcher fetches the pack archive and resources from the provider. Resource
downloads use the same piston-lib run_batch concurrency constant as other packs.
This does **not** mean the complete initial-install pipelines are identical.
Normalization downloads to a private directory; server_source::plan then hashes
and writes those files into an uncompressed private ZIP; engine staging opens
that archive for individual entries and writes the files again. Server approval
and local rollback checks are additional work. No throughput improvement from
removing this path has been implemented or benchmarked in this change.

## Resource-list paths

| Surface | First read | Parsing and rendering | Existing reuse |
| --- | --- | --- | --- |
| Instance resources | One local get_instance_resource_overview IPC; installed rows, cached project metadata, cached update results | Rust SQL rows -> IPC JSON -> JS resource models | 30-second RequestCache, shared in-flight reads, retained rows, virtualized rendering |
| Instance live updates | Separate check_instance_updates_lightweight call | Exact versions mapped onto existing rows after first paint | Separate 60-second cache, invalidation by resource events |
| Server resources | contentResource -> native server_content -> authenticated content_inventory HTTP -> server file inventory | Bounded HTTP JSON -> serde Value -> typed inventory -> IPC JSON -> JS; row identities retained for virtual list | Per-server 30-second cache, stale visible rows, request coalescing, resource-change events; native transport cache/validators |
| Pack resource preview | Signed compact catalogue/details when available; normalized archive fallback | Provider references and display metadata become dependency-style rows | Provider metadata cache; icons can remain independent of the first list |

The local overview already filters project IDs and avoids filesystem scans and
network calls. It previously selected entire cached project records, including
image blobs and long descriptions, then discarded image bytes before IPC.
Fixed: select list fields and an icon-presence expression in SQL; omit detail
descriptions and image blobs at the database boundary, preserving safe icon URLs.

The server list verifies up to 64 MiB / 128 initial resources, reads bounded JAR
metadata, and separately inspects datapacks. It previously acquired a database
read and prepared a provenance query per hashed file. Fixed: finish file reads
first, then resolve all provenance in one read with one reused prepared query.
Only exact fresh path/hash matches receive provider identity. Pending changes
and permission projections remain fresh; no permission cache was introduced.

## Further optimization order

Follow-up: cold Server Resources navigation now requests `content?view=summary`
first, with no file hashing, JAR parsing or datapack tree hashing. It then loads
the existing verified inventory in the background. Both views use the `content`
cache namespace with separate argument keys, so mutation/event invalidation
retires both. Summary rows carry no fresh-file hash or verified provider claim;
existing action guards require verified hashes. The modpack preview still shares
the full inventory cache, explaining why navigation from that preview was warm.
The typed client/native IPC/HTTP endpoint and tab have all been wired for this
flow; an older server rejecting the query falls back to the existing full read.
A core regression and real HTTPS test cover summary rows, fresh-hash provenance,
unauthorized reads and malformed query refusal. Live cold-page latency remains
unmeasured.

1. **Remove the private ZIP round trip.** Let the common engine accept verified
   staged files directly, while preserving config merging, rollback journaling,
   owned-file hashes, cancellation, and future update baselines. Use one shared
   archive index for ordinary archive sources rather than reopening it per file.
2. **Separate list freshness from expensive verification.** Maintain a versioned
   inventory snapshot updated by filesystem notifications and explicit mutations.
   Cache parsed JAR metadata separately. Key verified results by file identity,
   size and change token; invalidate on rename/replacement, metadata changes,
   watcher gaps, and restart. A TTL or mtime alone must not establish provenance.
   Revalidate exact bytes before mutations even when display rows are cached.
3. **Serve compact versioned list DTOs.** Include revision and cheap display fields;
   hydrate provider details/verification independently. Add conditional responses
   or revision deltas. Keep permission checks ahead of every cached response;
   scope caches to server and account/auth revision. Do not transfer descriptions,
   readmes, dependency graphs, or base64 icons with list rows.
4. **Reduce native serialization.** Profile bounded bytes-to-Value-to-typed-model
   and IPC encoding. Prefer a typed response decoder for large inventories after
   envelope/error handling, while retaining response-size and row-count limits.
5. **Keep first paint independent.** Use cached rows immediately, deduplicate
   mount/focus/event reads, batch mutation invalidations, and defer update checks,
   icon loading and metadata enrichment. Warm a list on actual navigation intent
   only; prefetching every instance/server competes with the requested page.
6. **For very large inventories**, use stable sorting, snapshot-bound pagination
   or deltas, and virtual rows. Benchmark transfer/parse costs before choosing a
   binary wire format or compression; these will not fix hashing and archive I/O.

Measure cold/warm first rows, IPC/HTTP payload bytes, server scan/hash/ZIP time,
native decode time, JS mapping time and visible-row render time separately.
Measure provider download and staging/commit time separately for installation.
Existing overview logs expose local elapsed_ms; no live before/after page latency
claim is made from compilation or unit-test results.

## Validation

- Launcher cargo check and frontend typecheck passed.
- Endpoint regression covers saved host:port, HTTPS, IPv4 and IPv6.
- 28 frontend mapping/resource/linked-pack checks passed.
- Three focused server inventory tests passed, including stale-hash provenance
  rejection, staged JAR metadata and sidecar filtering.
- The broader server file suite passed 36/37 tests. Its failure was the
  software-switch acknowledgement assertion in
  `files::tests::pack_install_applies_overrides_immediately_and_replays`; that
  policy was not modified to make the suite pass.
- No live install or cold/warm UI latency benchmark was run for this change.

## Image loading review

The initial scheduling change did not address cache reads waiting behind remote
downloads or the extra hidden-image decode before displaying native image bytes.
The shared resource image component now batches local cache reads separately,
starts four visible icon requests concurrently, limits speculative requests, and
keeps full-resolution banners in a separate queue/cache. Raster list icons are
bounded to 192px; SVG and small icon bytes are preserved. In-memory entries are
bounded by count and size, and failing URLs have a retry cooldown.

Cached project list queries project only display fields rather than loading image
blobs. Concurrent metadata warmups await the same local reply before deciding
whether provider requests are needed. This avoids a page/tab warmup race.

Validation: 21 focused frontend checks, typecheck, production build, and native
cargo check passed. The thumbnail helper's two tests passed using a standalone
Rust test harness against the workspace's compiled dependencies. Live page paint
latency has not been measured; these checks establish behavior and compilation,
not a user-visible speedup.
