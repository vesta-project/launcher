# ADR-0010: Instance OS Sandbox Via `vesta-sandbox`

Date: 2026-08-16

Amended: 2026-08-17

Status: Accepted

## Context

Launching Minecraft runs unverified Java and native code (especially modded
Instances). Users want to confine that process to Vesta and instance data
without Docker, with configurable network and device posture, on macOS, Linux,
and Windows.

Instance Lifecycle (ADR-0002) and Runtime Preparation / launch adaptation
(ADR-0003) already split app policy from game launch. Sandboxing is another
cross-cutting concern: OS enforcement APIs differ sharply, but the product
needs one policy model. Putting Seatbelt, Landlock/`bwrap`, and Windows
AppContainer/Job logic into `piston-lib` or Tauri command code would shallow
both Modules and pull unused OS code into every build.

## Decision

### Crate and seam

- Add workspace crate `crates/vesta-sandbox`.
- OS-specific Implementations live behind `cfg(target_os = …)` (or equivalent
  optional deps) so only the host OS sandbox code is compiled into a binary.
- Public Interface: accept a portable `RunPlan` (program, args, cwd, env) plus
  a `SandboxPolicy`, and return a `SandboxedSpawn` / apply plan. Internally use
  `pre_exec`, wrapper helpers, or Windows spawn attributes as needed.
- `vesta-sandbox` does **not** own pipes, detach, exit-handler composition,
  process registry, playtime, kill, or crash UI. The Vesta app process stays
  unsandboxed and observes the child via PID and allowlisted sidecar files.
- Tauri owns Sandbox Policy persistence and resolution (global defaults +
  per-instance override, same `use_global_*` pattern as hooks/Java).
- `piston-lib` gains only a thin, game-agnostic structured launch hook so
  sandbox composition stays correct with exit-handler and wrappers—not a
  dependency on Vesta presets or OS APIs.
- The sandbox Interface applies to the **Play process tree**: exit handler,
  optionally enclosed wrapper, hooks, game JVM, and descendants. Launcher-owned
  installation, repair, Java management, and Forge/NeoForge processors are
  trusted work and remain outside this boundary.

### Presets

| Preset | Meaning |
| --- | --- |
| **Trusted** (default) | No sandbox |
| **Modded** | FS + exec confinement; network on; mic on; USB/controllers on |
| **Paranoid** | Same FS/exec/USB as Modded; network off; mic off |

### Filesystem policy (Modded / Paranoid)

- Shared runtime roots (`assets/`, `libraries/`, `versions/`, and `natives/`):
  **read-only** during Play. Other launcher state is not readable. Installation
  and repair own shared-runtime mutations outside the sandbox.
- Instance `game_dir`: **read-write**.
- The exact pre-created session log file at `{vesta data}/logs/…`: **read-write**;
  the containing log directory is not granted recursively.
- Java/JRE home and `exit-handler.jar`: read-only; Java/JRE helpers are
  executable.
- Natives under Vesta data: read/load as required; they are not granted arbitrary
  process-exec capability.
- Global extra paths (app defaults) plus per-instance extra paths grant
  read-write access; UI shows inherited globals greyed and allows instance-only
  additions.
- Paths are canonicalized; symlink escapes outside the allowlist are denied.

### Exec, network, capabilities

- Exec allowlist: the selected Java executable, required JRE helpers, an
  explicitly resolved enclosed wrapper (and its absolute shebang interpreter),
  and shell interpreters only when lifecycle hooks are configured. Arbitrary
  shell children, `game_dir` binaries, and LaunchServices helpers such as
  `/usr/bin/open` remain denied because they can escape the process-tree boundary.
- v1 capability knobs: filesystem, network, exec, microphone. Presets set them;
  no full privacy dashboard in v1.
- USB/controllers remain allowed under Paranoid.
- GPU/display/audio output remain allowed for playable presets.

### Wrapper composition

- User-configurable nesting: **sandbox outside** (default) vs **wrapper outside**.
- Wrapper-outside is a documented weaker posture and must be visible in the
  enforcement report.
- An unsandboxed wrapper may not reside under the game directory or an extra
  read-write root, preventing one Play session from replacing trusted code used
  by the next launch.

### Enforcement honesty

- One policy model on all OSes; adapters report what was actually enforced.
- If a control the resolved policy **requires** cannot be enforced, **fail
  closed** (do not launch). Partial enforcement is allowed only for controls
  that are not required by that preset/override, and must be labeled.

### Ship order

1. Crate + policy types + persistence/UI (Trusted default).
2. macOS adapter first, then Linux, then Windows.
3. Platforms without an adapter use capability-gated behavior—never silently
   claim Paranoid/Modded confinement.

### macOS Seatbelt profile shape

- Use `(allow default)` plus **filtered targeted denials** for product controls:
  deny filesystem reads, writes, and process execution only when their paths do
  not match the approved filters; optionally deny `network*` and
  `device-microphone`. Unconditional deny rules cannot be re-opened reliably by
  later allow rules in Seatbelt.
- Do **not** use hard `(deny default)` for the game JVM. That aborts Java during
  `os::init` (SIGABRT / exit 134) before the exit handler can write
  `exit_status.json`, which previously looked like a clean short session.
- Each launch receives an atomically created private system-temp directory. Its
  exact path is the only writable temp allowance and the host removes it after
  the process exits (or launch fails).

## Consequences

- Locality: OS sandbox mechanics stay in `vesta-sandbox`; Vesta settings stay in
  Tauri; Minecraft launch correctness stays in `piston-lib`.
- Leverage: one prepare/apply Interface confines the whole Play process tree.
- Shared runtime roots and managed Java remain readable but cannot be mutated by
  hostile game code. Writable extras that overlap trusted Java or wrapper paths
  are rejected before launcher-owned verification can execute them.
- Tradeoff: device and exec controls will be uneven across OSes; the enforcement
  report is part of the product contract.
- Follow-ups (not required by this ADR): richer per-toggle UI, deny-overrides
  for inherited global extras, stronger per-subdir FS modes if operation kind
  becomes distinguishable later.

## Related

- Domain vocabulary: `CONTEXT.md` (Sandbox Policy, Sandbox Adapter)
- Prior seams: ADR-0002, ADR-0003
- Sandbox crate: `crates/vesta-sandbox`
- Launch adaptation: `vesta-launcher/src-tauri/src/instance/launch_preparation.rs`
- Spawn Adapter: `crates/piston-lib/src/game/launcher/process.rs`
