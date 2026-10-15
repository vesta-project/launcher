# Manual resource drop: device testing

Use a disposable instance and save folder. The generated fixtures are **inert import fixtures**, not functioning mods or complete playable worlds. Do not launch Minecraft with them. Provider recognition/dependency tests need real, known provider-listed artifacts as a separate step.

## Start the native path

Native file drops are enabled by default in the main window in both debug and release builds. From the **repository root**, with the project's normal Bun/Rust/Tauri prerequisites installed, start normally on macOS, Linux or Windows PowerShell:

```sh
bun run vesta:dev
```

Test first with `VESTA_NATIVE_FILE_DROP_PROBE` **unset**. Repeat the checklist with a normal packaged release: no environment variable is required. Dormant legacy sniffer code is not an active fallback. A browser preview is not a native-drop test.

### Optional debug diagnostics

For event counters and coordinate calibration only, set the variable when **starting a debug build**:

```sh
# macOS / Linux
VESTA_NATIVE_FILE_DROP_PROBE=1 bun run vesta:dev
```

```powershell
# Windows PowerShell
$env:VESTA_NATIVE_FILE_DROP_PROBE = "1"
bun run vesta:dev
# After closing the test app:
Remove-Item Env:VESTA_NATIVE_FILE_DROP_PROBE
```

This flag controls diagnostics, not file delivery. Release builds keep diagnostics disabled even when the variable is set; compiling with it does not embed enablement.

## Generate portable fixtures

From the repository root:

```sh
python3 -I scripts/generate-drop-fixtures.py --performance
```

On Windows, use `py -3 -I scripts/generate-drop-fixtures.py --performance` if `python3` is unavailable. The command creates a **new private temporary directory** and prints its location. `--parent <existing-directory>` places that new directory somewhere convenient; it never overwrites an existing fixture directory. Each run writes checksums to `SHA256SUMS.txt`.

Transfer the generated files to another test device without extracting their contents. Keep the intentionally unsafe ZIP intact and use it only for the rejection test. Do not extract archives with a shell, or run scripts/interpreters from the fixture directory.

## Expected imports

| Fixture | Expected outcome |
| --- | --- |
| `inert-mod-a.jar` | One local JAR in `mods/`; no synthetic provider/dependency identity |
| `mod-collection.zip` | Two JARs, not the enclosing ZIP, in `mods/` |
| `resource-rooted.zip` | Resource pack preserved byte-for-byte |
| `resource-double-wrapper.zip` | Resource pack with `pack.mcmeta` and `assets/` at installed ZIP root |
| `datapack-rooted.zip`, `datapack-double-wrapper.zip` | Existing world picker; one selected world's `datapacks/`, not an instance-wide pack |
| `shader-double-wrapper.zip` | ZIP normalized to `shaders/` at root; no engine/loader changes |
| `world-double-wrapper.zip` | One new world directory; no merge/overwrite; its opaque datapack remains inside that world |
| `two-worlds.zip` | Existing multi-world archive picker; install only selected worlds |
| `ambiguous-pack.zip` | Explicit datapack/resource-pack type choice; world selection only for datapack |
| `mixed-resources.zip` | Review, independent selected resources, one world for the datapack; no shared enclosing provider identity |
| `owned-opaque-zip.zip` | Resource pack includes its inner ZIP unchanged; no second resource inferred from that ZIP |
| `unowned-inner-zip.zip` | Unsupported layout/inner-archive note; no recursive discovery |
| `unsupported-layout.zip` | Nothing installed, explanatory outcome |
| `modpack-rejected.zip` | Modpack excluded; no import-as-new-instance button/navigation |
| `unsafe-path-rejected.zip` | Rejected; no files published or escaped paths created |
| `perf-10000-entries.zip`, `perf-16mib-payload.zip` | Supported packs; compare inspection separately from provider latency |
| `perf-32-worlds.zip` | Thirty-two selectable worlds; cancel or select a small subset |

The synthetic world contains metadata only, with no real region chunks. Synthetic packs may have game-version-specific compatibility warnings if launched; their purpose here is routing, normalization and publication.

## Interaction checklist — repeat on each device

Record OS/version, CPU/architecture, build/debug state, display scaling, and input method. Mark every item **pass / fail / not tested**; silence is not a pass.

1. Drop onto both grouped and ungrouped instance cards. Hovering should not start archive parsing. Dropping should create one operation notification, not duplicate native/DOM imports.
2. Verify group dwell/open/close, card borders/glow, card text, scrolling, and internal pointer reordering with native drops enabled. Include reduced motion. Also verify right-click/context menus and ordinary clicking.
3. Try drops with a modal open and while the instance is preparing. They must not import into an unintended target.
4. Import rooted and double-folder-wrapped packs. Check installed ZIP roots and original rooted-file checksums. Do not infer success only from a toast.
5. Select a world for a datapack; cancel the picker; try an instance with no worlds. Check that no datapack enters an instance-level `datapacks/` folder or the normal instance resource list.
6. Select one of two worlds, then all worlds. Repeat an import and check new no-clobber names. Existing worlds must not be merged or overwritten.
7. Drop the same JAR twice: a byte-identical active mod is skipped. Different same-name files must not overwrite existing files. Disabled copies are not silently enabled.
8. Drop a mixture containing a separate valid pack/JAR and `modpack-rejected.zip`. The modpack stays excluded while the independent resources remain selectable. Ordinary new-instance modpack import is unchanged.
9. Cancel during queued inspection, resource review, world selection, application and recognition where possible. Already published resources remain usable; unpublished staging is cleaned up; no stale choice replaces a newer one. Let a choice expire (15 minutes) and verify it retires.
10. Repeat with networking disabled. Imported files remain successful and local. Restart and confirm persisted source evidence has not become a fabricated provider identity.

## Recognition and dependency checks with real files

Obtain known Modrinth/CurseForge files yourself through the normal provider workflow. Use compatible versions in a separate disposable instance. Provider hash recognition proves a listed artifact match, **not the website a file was actually downloaded from**.

- Drop a real provider-listed mod, resource pack, shader, datapack and world ZIP when available. Inspect source/version information after publication and after restart.
- Test a provider-listed wrapped archive **as distributed**. Do not manually re-zip it and expect its hash still to match. If Vesta normalizes its installed ZIP, the original-source match is separate from installed-file integrity; it must not authorize an automatic provider replacement by itself.
- A changed/repacked artifact may legitimately remain local/unidentified. A mixed collection must not assign an enclosing archive's project identity to all children.
- For a mod with a missing required dependency, test **Ask each time / Always / Never**, both remember choices, closing/cancelling, and an offline provider. These preferences are separate from provider-browser automatic dependency installation.
- Verify queued dependencies are reported as **queued**, then complete through their own task notifications. Do not treat queuing as completed downloading.
- While recognition is pending, delete/replace a target or move its world through the app. Late results must not attach source metadata to unrelated replacement content or another world.

## Results template

```text
Device / OS / architecture:
Build and startup command:
Native delivery confirmed (probe variable unset):
Fixture / action:
Expected:
Observed:
On-disk result checked:
Notification / choice result:
Restart result (where applicable):
Timing (inspection vs application vs network):
Pass / fail / not tested:
```

## Automated validation snapshot — 2026-10-14

- Full frontend suite: **631 passed** across 89 files (`bun run --cwd vesta-launcher test --run --maxWorkers=2`).
- Full launcher Rust suite: **534 passed**, no failures (`cargo test -p vesta-launcher -- --test-threads=1`). Six tests were intentionally ignored: the archive benchmark and five live-provider tests.
- `cargo check -p vesta-launcher`, production frontend build/locale validation, all five portable fixture-generator tests, new-import frontend lint and whitespace checks passed.
- Added regressions cover malformed optional source evidence in SQLite/resource JSON and world manifests, plus late world enrichment through symlinked metadata directories/files.
- Typecheck still fails only on the existing asynchronous Vite configuration typing at `vesta-launcher/vite.config.ts:7`. Workspace Rust format-check still reports the existing macro layout in `src-tauri/src/schema/config.rs:96`; the metadata files changed in this final pass are formatted.
- No new real desktop-drop verification was performed in this pass. macOS UI automation accessibility reports disabled; Windows/Linux OS delivery and live provider recognition still require the device checks above.

Native drag-and-drop has been confirmed during device testing and is now enabled by default. Cross-platform/build-mode coverage remains **unverified until these checks are performed for that platform and build**. Automated tests and an app/browser smoke test cannot substitute for real file-manager drops; record exactly which device and build was tested.
