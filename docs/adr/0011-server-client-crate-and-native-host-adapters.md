# ADR-0011: Server Client Crate And Native Host Adapters

Date: 2026-10-21

Status: Accepted architecture; implementation planned

## Context

The active frontend is `apps/desktop-solid`, whose native entry point calls
`vesta_launcher::run`. The shared Tauri host still lives under
`vesta-launcher/src-tauri`. Server integration must work through this existing
host without depending on the retained frontend or importing the discarded
`launcher-server-mvp` experiment.

Server connections have different trust, retry, streaming and resource limits
from provider downloads and local Minecraft installation. Several windows can
observe the same server, and a remote host may have limited CPU, bandwidth or an
intermittent connection.

## Decision

- Introduce one framework-independent workspace crate,
  `crates/vesta-server-client`, for the remote Vesta protocol, trust verification,
  device sessions, connection scheduling, bounded streams and operation tracking.
- The crate uses the caller's async runtime. It does not depend on Tauri,
  `piston-lib`, server runtime crates, Diesel, frontend code or a sibling checkout.
- The shared Tauri host owns one profile-scoped server manager, persistence,
  native credential-store/signing adapters, task/notification integration and
  window-scoped IPC subscriptions. Commands remain thin adapters.
- Solid owns interaction, localization and reactive presentation. Private device
  keys and session tokens stay native. Windows share connections and snapshots.
- `piston-lib` retains client-game installation and launch responsibilities.
  Remote installation requests execute through the server agent. A future local
  host setup adapter is a separate explicit boundary.
- Start with internal modules in one client crate. Split another crate only when
  an independently used contract or implementation requires it.
- Connection budgets, backpressure and uncertain mutation outcomes are part of
  the client API, rather than optional optimizations added after the UI.

The [backend plan](../architecture/SERVER_CLIENT_BACKEND.md) defines the proposed
module map, initial budgets, compatibility rules and implementation gates.

## Consequences

Protocol and scheduling tests run without a WebView or Minecraft process. The
rewrite can add server features without another backend migration, and a future
UI can reuse the same client.

The client needs a dedicated, trust-aware transport instead of directly reusing
the provider HTTP singleton. Existing launcher proxy preferences still inform
its explicit connection policy. Native storage adapters and both Cargo workspace
entry points need integration tests.

This accepts the ownership boundary, not a claim that the client, onboarding or
platform/network support matrix is already implemented.

## Related

- [Domain vocabulary](../../CONTEXT.md)
- [Authentication versus availability](0005-authentication-availability-offline-fallback.md)
- [Batched, scoped events](0006-batched-resource-reconciliation-and-scoped-instance-events.md)
- [Runtime preparation ownership](0003-runtime-preparation-piston-launch-adaptation-tauri.md)
