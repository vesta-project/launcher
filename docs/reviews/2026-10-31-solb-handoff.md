# Sol B implementation handoff

Implemented on triage2/solb and triage2-agent. No merge.

- Shared deferred Undo toast: file manager trash, workflow delete, forget connection, device/invitation/SFTP revocation. Deferred requests survive view cleanup. Undo and failures restore UI; file/connection refreshes keep pending items hidden. Restores retain their existing flow.
- Native maps known upstream pack refusals before the HTTP 502 fallback. Previously that fallback produced server_busy alongside the retained content_pack_source_unsafe reason. A provider download failure also must not mark the launcher-to-agent connection unreachable.
- Provider archive display names no longer pass through the game-root ASCII/portable-name validator. CurseForge imported filenames get portable storage aliases; HTTPS sources no longer require the old two-host CDN allowlist. Traversal, absolute names and credential-bearing/non-HTTPS URLs still refuse.
- Pack review warning acknowledgement crosses TS/native/agent/fixtures. Large staged pack totals (>64 MiB) emit a warning. Client config persists allowCustomContent and includes it in signed player release policy.
- Provider-backed server client packs retain provider project/version/icon in the existing update engine and retain their independent server binding. Provider identity uses provider project ID; custom server identity uses the agent server ID. The local binding alone owns the launcher connection ID. Instance updates consult this binding and offer only signed server revisions.
- Daily and weekly retention already exist in the backend.

Validation: typecheck and production Solid build pass; 125 selected checks tests pass; 37 server-client tests pass; agent content tests 40 pass/1 ignored, workspace tests 37 pass/4 ignored, client-mode tests 2 pass, policy regression 1 pass; cargo check for launcher and agent transport pass.

Remaining work: this does not complete the full row 6/7 audit. Legacy archive/count/size limits and all non-hard import refusal bypasses still need a complete classification and plan-time acknowledgement design; errors still need a structured offending URL/rule across every refusal. The specific live CurseForge 1173260/6060565 request was not reproduced with authenticated metadata. Custom-content checks cover provider mod installation, not every local import/write path. Theme screenshots were not captured. Generic DeleteDialog consumers outside the server file manager still need optimistic callbacks. The complete UI/agent error-code inventory still needs audit.

Dependency setup: root frozen install rejected lockfile changes. App frozen install eventually succeeded after 525 seconds. While it was resolving, missing packages were repaired locally from npm and local CLI wrappers restored for validation. Tracked dependency files were not changed.
