# Software metadata responsiveness

Version and release resources now retain five minutes of freshness rather than
the default thirty seconds. They continue using the same bounded 256-entry,
ten-minute-retention cache, request de-duplication, explicit invalidation and
Retry-After handling. No durable catalogue cache or background polling is added.

Software navigation intent warms the selected provider's versions and likely
Minecraft release choices after the page state arrives. Hover/focus on a
supported software tile waits 150 ms before warming that selection. At most one
speculative catalogue sequence per connection runs at once, and the tile warmup
waits while visible metadata is refreshing. Running-server navigation does not
warm editor metadata. Unsupported descriptor entries are absent from the picker;
the installed-software summary remains available.

Validation: 47 cache/hosting/shell checks plus one Solid diagnostics scenario
pass. Twenty concurrent catalogue readers and a subsequent warm read invoke the
loader once, with no reactive diagnostics. TTL tests cover expiry, explicit
invalidation and retention limits. Typecheck and production build pass. Lint
runs under Bun with existing warnings; the default Node 22.14 runtime cannot
load the repository's TypeScript lint configuration. Cold upstream requests
still depend on network latency; no end-to-end latency improvement is claimed
without measurements from the running launcher.
