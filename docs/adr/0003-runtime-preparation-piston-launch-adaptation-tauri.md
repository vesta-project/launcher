# ADR-0003: Put Runtime Preparation In piston-lib And Launch Adaptation In Tauri

Date: 2026-07-09

Status: Accepted

## Context

The launch command still mixed two kinds of preparation after Instance
Lifecycle was split out:

- `piston-lib` runtime preparation: installed version id, manifests, client jar,
  assets, libraries, natives, Java/runtime artifacts, verification, and repair.
- Tauri launch adaptation: app config, instance settings, account/offline
  identity, app paths, modpack resource presence, notifications, installation
  status, GPU/env/hooks, and launcher window behavior.

This made `commands/instances.rs` shallow: launching required knowing both
Minecraft runtime readiness and Vesta app policy in one command Adapter.

## Decision

Keep the seam split:

- `piston-lib::game::runtime_preparation` owns runtime readiness verification
  and repair for launch.
- `vesta-launcher/src-tauri/src/instance/launch_preparation.rs` owns app-specific
  launch adaptation into `InstallSpec` and `LaunchSpec`.
- `commands/instances.rs` remains a Tauri command Adapter that sequences
  permission check, busy guard, launch preparation, runtime preparation, actual
  `launch_game`, Instance Lifecycle recording, and launcher window action.

`piston-lib` must not learn about Tauri notifications, Diesel models, frontend
events, launcher windows, Discord, or installation status strings.

## Consequences

Runtime artifact readiness now has a named piston-lib Module and Interface:
`verify_runtime`, `inspect_runtime`, and `prepare_runtime`. `RuntimePlan` now
owns installed-version identity, strict manifest selection, raw inheritance
resolution, client JAR fallback, asset/library/native paths, and Java
requirements. Installer, verifier, repair, and prepared launch consume those
same facts. Missing loader manifests block modded launches instead of silently
falling back to vanilla.

Launch-specific app policy now has locality in the Tauri
Instance Launch Preparation Module. Future cleanup can deepen Runtime
Preparation further without pushing app policy into piston-lib.

Native archive extraction remains in the existing installer and launcher
Implementations. Modern native-layout repair is deferred separately. Tauri-side
modpack resource presence remains a separate app policy check.

## Related

- Domain vocabulary: `CONTEXT.md`
- Prior seam: ADR-0002
- Tauri Module: `vesta-launcher/src-tauri/src/instance/launch_preparation.rs`
- piston-lib Module: `crates/piston-lib/src/game/runtime_preparation.rs`
- Runtime Plan: `crates/piston-lib/src/game/runtime_plan.rs`
- Command Adapter: `vesta-launcher/src-tauri/src/commands/instances.rs`
