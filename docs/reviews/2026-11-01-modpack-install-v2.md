# Modpack install v2 + round 4 fixes (2026-11-01)

## Modpack install (server) — decisions
- **Simple path:** pick version → Install. No review popup, no staging list to parse. Progress
  (downloading N/M, writing, done) shows on the **Server modpack page** itself (reuse the page;
  it changes state), not in a dialog.
- **Offline only:** installing/updating/unlinking a server modpack requires Minecraft stopped.
  Block everywhere (Browse install buttons, server modpack page, version dropdown) with the
  reason "Stop the server to install". Therefore no "after restart"/staging for modpacks, and no
  restart notices when the server is offline.
- **No downloads before confirmation.** Planning reads metadata/manifest only; file downloads
  happen after Install.
- **1:1 with the launcher.** Server modpack install/update must use the same resolution/update
  logic as launcher instances (find the launcher's implementation — piston-lib or equivalent —
  and share it as a crate both sides use; no parallel engine). Same rules for user-added files
  (kept), pack-owned files (replaced/removed on update), client-only filtering.
- Software/loader switch stays inside the install as one acknowledgement checkbox on the page.
- Optional "Show changes" (collapsed) for people who want detail; never required.
- Notes are not warnings: neutral styling.
- Bugs: "0 files staged" after install; Start shows no status/progress.

## Other fixes
- Resources/content inventory: only real content kinds (mods, resource packs, shaders,
  datapacks, plugins). Docs/licences/configs (`.md`, `.pdf`, `.txt`, `.cfg`, `.json5`…) are files,
  not "Mod" rows — same rules the resource browser used earlier. Verify all forms (Resources,
  "Content from this modpack" grid, client pack content).
- Resource rows open the resource details again on click.
- "Create instance" from a server fails with a bare "not found".
- Start button: no separate "Starting…" spinner; the primary button shows the starting state and,
  on hover only, morphs into **Kill** (stop isn't possible while starting).
- EULA: a toggle in server Settings; when not accepted, Start opens a prompt to accept it
  (link to the Minecraft EULA) instead of failing.
- Custom client pack empty state is text-heavy; add "Use a modpack" (link a provider pack) next to
  upload/scratch, and allow Browse → install modpack with the client pack as target.
- Later: 10K+ player benchmark; concurrent edits by multiple admins (revision checks).
