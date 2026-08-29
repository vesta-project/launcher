# ADR-0010: Instance OS Sandbox Via `vesta-sandbox`

Date: 2026-08-16

Amended: 2026-08-29

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
- The sandbox Interface applies to the **Play process graph**: an optionally
  enclosed wrapper, hooks, game JVM, and descendants. On Windows, the
  launcher-owned exit handler is a trusted supervisor outside AppContainer and
  creates separate restricted invocations for hooks and the game. Launcher-owned
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
- Natives under Vesta data: read/load as required; they are not members of the
  portable process-exec allowlist. On Windows, the load/execute file-right
  limitation documented below prevents exact enforcement of that distinction.
- Native-image load is represented separately from portable process-exec intent.
  The selected Java runtime, shared natives, Instance game directory, and private
  sandbox temp are loadable so the JVM and mods can map their required native
  libraries. This does not make those paths members of the portable exec
  allowlist.
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
- Windows rejects a generic sandbox-outside wrapper because the no-child target
  cannot start Java. Wrapper-outside remains supported as the explicit weaker
  compatibility mode.
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

### Windows AppContainer implementation

- The Windows Adapter uses a bundled `vesta-sandbox-exec` sidecar. The sidecar
  launches each untrusted Play target under an AppContainer token and places
  itself in a
  kill-on-close Job before target creation, so descendants join the Job without
  a create-then-assign race. The sidecar relays stdout/stderr and piston locates
  visible windows belonging to the helper's descendants for graceful close.
- A deterministic, per-Instance AppContainer profile is derived from the
  canonical writable Instance root. Required NTFS grants are synchronized
  before launch and recorded in a protected per-user ACL journal; removed
  policy roots have their package-SID grants revoked. Recursive synchronization
  never traverses reparse points. Keeping the profile stable avoids recursively
  rewriting large Java and game trees on every launch.
- Network-off and microphone-off are enforced by omitting AppContainer
  capabilities. Network-on grants internet, client/server, and private-network
  capabilities, but Windows loopback remains unavailable without a machine-level
  administrator-managed exemption; the Adapter does not silently create one.
- Windows maps portable native-image load to NTFS `FILE_EXECUTE`, because Windows
  exposes no load-only file right. Consequently, loadable roots also have
  OS-level execute access even though they are not members of the portable exec
  allowlist. Process creation is independently blocked by the target token's
  no-child policy.
- The Adapter's trusted sidecar enters AppContainer as a hardened
  trampoline/supervisor and creates one real target with
  `PROCESS_CREATION_CHILD_PROCESS_RESTRICTED`. It supplies an exact inherited
  stdio handle list and, before starting the target, adds broker-process deny
  ACEs for both Everyone and Owner Rights. Denying Owner Rights suppresses the
  process owner's otherwise implicit ability to rewrite the DACL. Adversarial
  probes cover System32 executables, writable/loadable-root executables, and
  broker ACL replacement, ownership, termination, process creation, handle
  duplication, memory-injection rights, and access to an unsandboxed same-user
  supervisor.
- The launcher-owned exit handler stays outside AppContainer. `piston-lib`
  passes it a structured, repeated argument vector for the sandbox prefix; the
  handler prepends that exact vector independently to the pre-hook shell, game
  JVM, and post-hook shell. The helper validates each initial target against the
  exec allowlist before applying AppContainer and the token-level no-child rule.
  Log relay, exit code/status, descendant-window discovery, graceful close, and
  forced tree termination continue through the trusted supervisor/helper chain.
- The policy JSON is stored outside the AppContainer-writable scratch directory,
  preventing the game from broadening the later post-hook invocation. A named
  per-profile mutex is held for each helper invocation's full lifetime, so a
  running same-profile target cannot race a newly created trampoline before it
  hardens its DACL. This intentionally serializes simultaneous launches of the
  same Instance profile.
- The Windows primitive is deny-all, not an exact descendant allowlist. The
  portable exec list is a maximum-authority policy, so denying even listed game
  descendants is secure but may be less compatible than macOS/Linux. Hooks get
  a separately validated shell target and can use shell built-ins; their external
  child processes remain denied. Generic sandbox-outside wrappers fail closed
  because they must create Java; wrapper-outside remains explicitly weaker.
- With these production boundaries, the Adapter reports exec as `Enforced`,
  `sandbox_enforcement_ready()` is true, and Modded/Paranoid pass the parity
  gate on supported Windows systems. AppContainer still cannot use localhost
  without an administrator-managed loopback exemption; Vesta does not silently
  create or request that machine-level exemption.

## Consequences

- Locality: OS sandbox mechanics stay in `vesta-sandbox`; Vesta settings stay in
  Tauri; Minecraft launch correctness stays in `piston-lib`.
- Leverage: one prepare/apply Interface confines the untrusted Play process
  graph while trusted lifecycle supervision stays observable to the launcher.
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
