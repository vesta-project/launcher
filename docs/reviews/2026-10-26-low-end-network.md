# Low-end network and failure baseline

Date: 2026-10-26. Launcher baseline `347771c7`; agent baseline `99d1373`.

## What changed

Added `crates/vesta-server-client/tests/slow_network.rs`. No production tuning,
UI, dependencies or live configuration changed. No live server was restarted.

The fixture runs the real client transport and scheduler against local pinned
TLS. All async work uses one executor. Large responses and small controls share
a paced downstream byte budget; each request also waits an added response delay.
Sixteen callers request two distinct 32 KiB JSON payloads. The tests verify:

- Exactly two HTTP reads reach the fixture, with shared results for all callers.
- Stop completes before any of those readers finishes, using reserved capacity.
- A reply dropped after a mutation is classified as outcome unknown, with no
  automatic replay. A subsequent explicit control still works.
- Two stalled reads expire at the real 15-second client deadline, do not retry,
  release ordinary capacity and allow another read. Stop works during the stall.

These are application-level simulations. They do not inject packet loss, shape
upload bandwidth or slow the TLS handshake. They are not exact Chrome presets or
a certification of cellular networking. Chromium's [network profiles][profiles]
and Lighthouse's [throttling guidance][throttling] distinguish link targets from
emulation adjustments; packet-level testing remains a separate follow-up.

## Results

| Profile | Added response delay | Shared downstream | Measured result |
| --- | ---: | ---: | --- |
| 3G-like | 400 ms | 50,000 bytes/s | Stop 463 ms; all reads 1.75 s |
| Poor link | 1,200 ms | 8,192 bytes/s | Stop 1.48 s; all reads 9.26 s |
| Stalled body | 100 ms | No body progress | Stop 128 ms; timeout and recovery 15.14 s |
| Dropped mutation reply | 400 ms | Partial reply then abort | No mutation replay; next Stop 433 ms |

Final measurements and exact logs are preserved under
`V:/tmp/low-end-20261026/`, including `client-one-core-metrics.json` and the
client/server logs. One logical CPU affinity was applied to the client test
process, and to both Cargo and the server test executable. The final client
fixture run took 27.85 wall seconds, consumed 0.156 CPU seconds and peaked at
12.64 MiB sampled working set (250 ms samples). Five threads were observed,
restricted to the one logical CPU. No physical RAM cap was applied. Fixture RSS
is not the launcher or agent's production footprint.

Validation:

- New client slow-network suite: 3 passed, 0 failed, 0 ignored.
- Client library: 25 passed. Scheduler concurrency: 9 passed. Wire-level priority:
  1 passed. These 35 existing regressions were not CPU-affinity constrained.
- Server transport library: 47 passed, 0 failed, 0 ignored, on one logical CPU.
  Covers slow consumers, download throughput floors, cancellation, bounded disk
  streaming, worker isolation and shutdown ownership/re-observation.
- Client strict all-target Clippy passed. No warnings were suppressed.

## Process tuning review

The existing server separates ordinary HTTP work, authenticated control/auth,
realtime checks and installation work. The networking runtime has two async
workers. Ordinary dispatch and streamed disk reads share one blocking worker;
control/auth has a separate blocking worker. Realtime and installation each have
two blocking workers. These are concurrency ceilings, not permanently busy CPU
cores. Tokio documents the [separate worker and blocking limits][tokio].

The client reserves urgent request slots without bypassing rate limits or server
Retry-After. In-flight reads are deduplicated; reconnect delays are bounded.
Server request-body memory, concurrent downloads, WebSocket connections, work
queues and throughput are bounded. Periodic realtime/TLS tasks skip missed ticks
instead of catching up with bursts. The tests did not justify changing those
limits or increasing concurrency on a one-core host.

Two limits matter on poor links:

- Ordinary JSON requests have a 15-second total client deadline. Larger metadata
  can still exceed that on slower links. Prefer bounded pages/smaller responses
  before extending deadlines and retaining work longer.
- Artifact streaming requires at least 8 KiB/s over its configured windows, with
  bounded burst credit. Slower or stalled downloads may be disconnected. This
  floor does not apply to small management JSON responses.

## Follow-ups

1. Measure a real agent's idle CPU/RSS and active control latency on a VM with
   one core and 2 GiB, then two cores and 4 GiB. Affinity fixtures do not establish
   full-host or Minecraft capacity, low-memory behaviour or out-of-memory recovery.
2. Measure large file-download setup on slow storage. The opening integrity hash
   scans the full selected interval. Parent review confirmed it already runs via
   `routes.rs`'s blocking dispatcher, not on an async networking worker. It can
   still occupy the ordinary worker and delay metadata/streamed disk reads;
   controls remain separately reserved. Preserve integrity checks. Do not add a
   digest cache or extra workers without measuring this path.
3. Exercise the real agent plus launcher through packet-level latency, jitter,
   loss and temporary outages. This batch did not modify OS networking or use a
   real Minecraft instance.

[profiles]: https://chromium.googlesource.com/devtools/devtools-frontend/+/b2cbf557e71b23f634a169ca7bc782efeb29b6a5/front_end/core/sdk/NetworkManager.ts
[throttling]: https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md
[tokio]: https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html
