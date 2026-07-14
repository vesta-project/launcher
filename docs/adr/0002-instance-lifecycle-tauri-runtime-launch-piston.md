# ADR-0002: Split Instance Lifecycle From Runtime Launch

Date: 2026-07-08

Status: Accepted

## Context

Instance launch behavior had two different kinds of complexity mixed together:

- `piston-lib` complexity: Minecraft version metadata, classpath, assets,
  libraries, natives, Java/runtime facts, arguments, hooks, process spawn, and
  process registry.
- Tauri app complexity: busy state, persisted running-process state, startup
  reattach, exit reconciliation, crash persistence, playtime updates, Discord
  presence, and frontend events.

Mixing these made the Instance Lifecycle Module shallow: changing app lifecycle
policy required reading game-runtime launch code, command code, and startup
setup code together.

## Decision

Keep the seam split:

- `piston-lib` owns game/runtime launch correctness.
- Tauri owns app-specific Instance Lifecycle.

The Tauri Instance Lifecycle Module may call `piston-lib` launch, kill,
registry, and stop-intent Interfaces, but `piston-lib` must not learn about
Tauri app policy, notifications, Discord, windows, Diesel models, or frontend
events.

The accepted Tauri implementation lives at
`vesta-launcher/src-tauri/src/instance/lifecycle.rs`.

## Consequences

This creates locality for app lifecycle policy while preserving leverage in
`piston-lib` for Minecraft launch correctness.

Future Runtime Preparation work should deepen `piston-lib` around installed
version, manifest choice, Java requirement, artifacts, natives, and readiness
facts without moving app-specific lifecycle behavior into `piston-lib`.

Future Tauri work should keep commands and startup setup as Adapters at the
Instance Lifecycle seam.

## Related

- Domain vocabulary: `CONTEXT.md`
- Tauri Module: `vesta-launcher/src-tauri/src/instance/lifecycle.rs`
- Command Adapter: `vesta-launcher/src-tauri/src/commands/instances.rs`
- Startup Adapter: `vesta-launcher/src-tauri/src/setup.rs`
- Runtime Adapter: `crates/piston-lib/src/game/launcher/`
