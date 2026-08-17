# macOS Sandbox Hardening Plan

## Goal

Make the macOS Play sandbox a real read, write, exec, network, and microphone boundary without changing launcher-owned installation or repair behavior.

The sandbox protects the Play process tree: the exit handler, the optional wrapper when configured inside the sandbox, hooks launched by the exit handler, and Minecraft/mod code. Installer and repair processors remain launcher-owned trusted work and do not use the sandbox.

## Policy decisions

- Trusted remains unchanged and unsandboxed.
- Modded and Paranoid deny filesystem reads and writes by default, then allow only declared roots plus the minimum macOS/JVM compatibility roots.
- Only the shared runtime roots (`assets`, `libraries`, `versions`, and `natives`) are readable and not writable by Play; other launcher state is unreadable.
- The instance game directory and exact pre-created Vesta session-log file are readable and writable by Play.
- The selected Java runtime and exit-handler resources are readable and executable but not writable by Play.
- Extra paths remain readable and writable. Their UI copy must state that explicitly.
- Launcher-owned installation, repair, Java installation, and Forge/NeoForge processors stay outside the sandbox.
- Wrapper-outside remains an explicit user-selected weaker posture. Wrapper-inside must resolve and allow its executable.
- Required controls continue to fail closed. There is no automatic unsandboxed fallback.

## 1. Correct the architecture contract

- Amend ADR-0010 so the sandbox applies to the Play process tree, not installer/repair JVMs.
- Replace the old "Vesta data + game directory both read-write" rule with:
  - Shared runtime roots: read-only; other launcher state unreadable.
  - Instance game directory: read-write.
  - Session logs: read-write.
  - Java runtime and exit handler: read/execute only.
  - User extra paths: read-write.
- Update `CONTEXT.md` with the same durable definition.
- During implementation, update the Sandbox Policy/Sandbox Adapter entries in the external architecture atlas, including the currently stale "Planned" status and installer-JVM wording.

## 2. Build a least-privilege Play policy

- Change `build_sandbox_policy_for_roots` to emit separate access entries for shared runtime roots, game directory, exact log file, Java runtime root, exit handler, and extras.
- Pass the actual session-log file into policy construction rather than relying on the writable data root.
- Keep the selected Java runtime root read-only while allowing only the selected `java` and required `jspawnhelper` executable.
- Canonicalize the complete combined filesystem list in one operation so overlapping logical roots are validated together. Deduplicate canonical entries while preserving the most restrictive intended access for protected subtrees.
- Treat launcher-selected Java and launcher-owned installer artifacts as trusted inputs. Remove or avoid the redundant unsandboxed `java -version` execution inside the final process Adapter when launch preparation has already validated Java.

## 3. Remove the mutable profile-file race

- Stop writing `seatbelt-{pid}.sb` under the writable temp directory.
- Pass the generated profile directly to `/usr/bin/sandbox-exec` with `-p`.
- Remove profile-file creation, profile paths from reports, and stale-file cleanup concerns.
- Ensure logs describe the active controls without logging the full profile or sensitive allowlisted paths unnecessarily.

This removes concurrent policy overwrites, the symlink/TOCTOU path, cross-instance allowlist mixing, and accumulated profile files.

## 4. Enforce both read and write access in Seatbelt

- Preserve the JVM-compatible targeted-denial shape rather than switching immediately to `deny default`.
- Add filtered `file-read-data`, `file-read-metadata`, and `file-write*` denials.
- Generate read allows from every `PathAccess` with `read = true`.
- Generate write allows only from entries with `write = true`.
- Add a small adapter-owned macOS compatibility allowlist for immutable operating-system resources needed by Java/LWJGL, such as system frameworks, system libraries, configuration, devices, and fonts. Keep these constants in the macOS Adapter rather than the portable policy.
- Allow only an atomically created private per-launch directory beneath the system temporary root plus individually verified compatibility paths. Remove the blanket writable `/private/var/folders` rule and clean the private directory after exit/failure.
- Add specific device-file access needed for a playable JVM without granting arbitrary filesystem writes through `/dev`.
- Validate the profile on supported macOS versions with real file operations. If Java requires another read root, add the narrow root with a comment explaining the observed dependency.

## 5. Tighten executable confinement

- Remove the implicit parent-directory expansion in `push_exec_rules`; a file entry allows that file, and a directory entry allows that directory tree.
- Remove the unconditional `/usr/libexec`, `/bin/bash`, and `/bin/sh` grants.
- Add `/bin/sh` only when a configured pre- or post-launch hook requires the exit handler's shell execution.
- When sandbox-outside wrapping is selected, parse and resolve the configured wrapper executable during launch preparation and add that exact executable to the policy. Fail preparation with a clear error if it cannot be resolved.
- Keep `/usr/bin/open` denied: LaunchServices can otherwise start a process outside the Seatbelt profile.
- Keep game-directory binaries denied unless a future explicit capability is designed for them.

## 6. Make enforcement reporting accurate

- Report filesystem enforcement as Enforced only after both read and write restrictions are present.
- Include concise notes for read-only shared data, writable game/log/extra roots, hook-shell allowance, and wrapper-outside posture.
- Mark wrapper-outside as partial command-tree confinement in the report, while preserving the explicit user override behavior.
- Surface sandbox preparation failures as actionable launch errors; never retry without the sandbox.

## 7. Add security-focused tests

- Unit-test policy construction:
  - Shared data is read-only.
  - Game and logs are read-write.
  - Java and exit handler are read-only and executable where appropriate.
  - Extra paths are read-write.
  - Installer specs and processor execution remain unchanged.
- Unit-test profile generation:
  - Read and write are denied by default.
  - Read-only entries never receive write rules.
  - No blanket `/private/var/folders`, shell, or `/usr/libexec` grant exists.
  - File exec entries do not widen to their parent.
  - Hook and wrapper capabilities add only their required executables.
- Add tests for all command compositions: no wrapper, wrapper inside, wrapper outside, with and without exit handler and hooks.
- Add a macOS-only integration probe that launches a small helper through the generated profile and verifies:
  - Allowed reads succeed.
  - Reads outside the allowlist fail.
  - Game/log writes succeed.
  - Shared-data/JRE/outside writes fail.
  - Unlisted exec fails.
  - Paranoid network access fails.
- Run two preparations concurrently and confirm each argv carries its own inline profile.

## 8. Compatibility validation and rollout

- Smoke-test representative vanilla, Fabric, Forge, and NeoForge instances under Modded and Paranoid.
- Exercise LWJGL window creation, audio output, controllers, asset loading, native loading, log/exit-status writes, resource-pack folder opening, voice chat under Modded, and denied voice/network under Paranoid.
- Test custom Java paths, paths containing quotes/spaces, extra paths, pre/post hooks, and both wrapper nesting modes.
- Use macOS sandbox-denial logs to identify missing compatibility reads; add only reproducible narrow exceptions.
- Keep Linux and Windows behavior unchanged: Trusted passes through and enforced presets fail closed until their Adapters exist.
- Update the UI description so users understand that extra paths grant read-write access and that wrapper-outside leaves the wrapper beyond the sandbox boundary.

## Completion criteria

- A sandboxed game cannot read or write a fixture outside declared and adapter-owned roots.
- A sandboxed game cannot modify the managed JRE or shared runtime roots, or read unrelated launcher state.
- Concurrent launches cannot share or mutate sandbox profiles.
- Exec access is limited to the selected Java/runtime helper, explicitly resolved enclosed wrapper and absolute shebang interpreter, and hook shell interpreter when needed.
- Installer and repair processors continue to run through their existing launcher-owned path.
- The enforcement report, UI, ADR, `CONTEXT.md`, and architecture atlas all describe the implemented boundary accurately.
