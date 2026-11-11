# Live modpack practical pass — 30 October 2026

## Outcome

Incomplete: no real Modrinth or CurseForge pack installation was performed. There is no evidence here of successful planning, apply, launch readiness, connection-loss timing, concurrent status responsiveness, or a root cause for the reported disconnect. Do not treat the earlier browser fixtures or these provider metadata requests as installation evidence.

## Observations

- The existing Vite page at http://localhost:1430/ opened as Vesta Launcher in T3 preview. Two snapshot attempts each failed with `Preview automation snapshot timed out after 15000ms.` No UI action or live server install was observed. The preview tab was closed. A fallback computer-use inventory reported no available browsers or native apps, so the native desktop journey was not exercised.
- A dedicated scratch registry was created at `V:/launcher/audit/modpack-live-2026-10-30/scratch-servers`. Using the existing provider-target debug binary, `vesta create terra-scratch --install-root <scratch-servers> --minecraft-version 1.21.1 --java <local JDK 25 java.exe> --loader vanilla --agent-startup manual --approve-install --ack-warnings --ack-legacy-checksum` completed in 7.14 seconds. It reported `created; eula=pending; owner_must_read_and_accept_eula_txt_themselves; no_game_started`. Agent startup was manual. This is a vanilla scratch server, not a pack install; its runtime does not match the requested 26.3 Fabric pack.
- Direct Modrinth search returned HTTP 200 in 417 ms, one hit (project `5FFgwNNP`). This does not validate a particular version, archive, or install.
- Direct CurseForge file metadata for project `1714524`, file `9024763`, using the locally configured provider credential without printing it, returned HTTP 200 in 270 ms and reported a download URL. This does not validate download permissions for its dependencies, archive processing, compatibility, or installation.
- Source inspection shows `pack/install/plan` calls `workspace.install_plan` synchronously, which resolves the provider archive, downloads it, parses it and resolves server candidates under a 120-second deadline. This is an observation about code, not proof that it caused the reported failure or that status requests are blocked; the transport also has dedicated blocking job machinery.

## Limits and next steps

A paired, remotely accessible scratch agent and a working desktop/browser automation path are still needed to submit real plan and apply requests for both providers, measure simultaneous status, capture backend error/response and timings, and inspect resulting files and launch readiness. The created server is stopped and its EULA was not accepted. Existing dev-server content and identity were not modified. No Minecraft process was launched. No startup registration was changed. The scratch registry remains for follow-up.
