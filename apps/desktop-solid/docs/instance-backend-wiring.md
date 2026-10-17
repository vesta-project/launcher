# Instance backend wiring

The Solid 2 instance catalog and management Adapter use the existing shared Rust host. All implementation changes for this task are under `apps/desktop-solid`. Browser previews retain their isolated fixture stores. No Rust commands were added.

## Connected behavior

- Play and kill, install retry, interrupted-operation resume and update recovery. Numeric database IDs identify mutations; process/log commands receive the backend-compatible name slug. Launch controls use the authoritative running check. Catalog events reconcile installation, crash and process states.
- Settings persist name, uploaded/builtin icons, Java selection/path, memory, JVM arguments, resolution, hooks/wrapper, environment variables, launcher action, and sandbox preset/wrapper nesting. Existing native inheritance flags round-trip. Fresh records preserve settings and imported/provenance fields that the form does not own.
- Duplicate, repair, reset, delete, open instance/logs folders. Export has a file-selection review, format/version/author controls and a native save destination; the backend owns archive creation.
- Installed mods, resource packs and shaders read the local ledger/project overview, check updates, and support enable/disable, remove and exact-version replacement installs. Read-only/untracked datapack entries cannot be mutated through invented resource IDs.
- Worlds list, import, delete, duplicate, copy/move and open folder. Imports use the native resource-drop and archive-selection protocols. Transfer acknowledgements cover Minecraft version, modloader, linked-pack and saved-world-version risks, including modded duplicates. World directory names are encoded only in routes and passed unchanged in `WorldRef` IPC.
- Per-world datapacks list, update checks, enable/disable, remove and replacement installs.
- Screenshots list/view/copy, reveal in folder, and confirmed deletion; playtime, last-played and configured memory use native instance records.
- Console attaches its log listener before reading retained capture, filters every incoming line by instance slug, caps output at 5,000 lines, and disposes listeners on tab exit. Historical files (including gzip) are read by the backend on selection. Catch-up preserves repeated messages and merges only overlapping history/live output. Per-instance console preferences survive navigation; six sessions are retained.
- Crash reports use persisted diagnosis/evidence/suggestions and real report files, support opening/copying, clear crash state, and upload on the explicit Share action.
- Linked modpacks display provider releases/current version, invoke the delta update engine, and unlink with either retained files or removal of ledger-owned bundled resources. Destructive unlink awaits provenance backfill before selecting owned files.

## IPC commands

Existing lifecycle/settings commands: `list_instances`, `get_instance`, `get_running_instances`, `is_instance_running`, `launch_instance`, `kill_instance`, `resume_instance_operation`, `update_instance`, `install_instance`, `duplicate_instance`, `repair_instance`, `reset_instance`, `delete_instance`, `open_instance_folder`, `open_logs_folder`, `get_system_memory_mb`. The existing Java picker/test helpers continue using `select_java_file` and `verify_java_path`.

Resources: `get_instance_resource_overview`, `get_installed_resources`, `check_instance_updates_lightweight`, `toggle_resource`, `delete_resource`, `install_resource`, `list_world_datapacks`, `check_world_datapack_updates`, `toggle_world_datapack`, `delete_world_datapack`.

Worlds/import: `list_instance_worlds`, `open_world_folder`, `delete_world`, `transfer_world`, `start_resource_drop`, `submit_resource_drop_choice`, `cancel_resource_drop`, `submit_world_archive_selection`.

Screenshots: `get_screenshots`, `copy_screenshot_to_clipboard`, `open_screenshot_in_folder`, `delete_screenshot`.

Console/crashes: `read_instance_log`, `get_instance_log_history`, `read_specific_log_file`, `clear_instance_crash`, `open_crash_report`, `upload_crash_to_mclogs`.

Linked packs/export: `get_resource_project`, `get_resource_versions`, `start_modpack_update`, `backfill_modpack_resource_provenance`, `clear_modpack_resource_provenance`, `list_export_candidates`, `export_instance_to_modpack`.

Existing Minecraft/loader metadata reads remain owned by `metadata.ts`.

## Events

Catalog: `core://instance-created`, `core://instance-updated`, `core://instance-installed`, `core://instance-deleted`, `core://instance-delete-queued`, `core://instance-launch-request`, `core://instance-launched`, `core://instance-killed`, `core://instance-exited`, `core://instance-crashed`. Existing notification error routing uses `core://notification` and `core://notification-progress`.

Details: `core://instance-resource-rows-changed`, `core://instance-resource-metadata-changed`, `core://instance-worlds-changed`, `core://world-datapacks-changed`, plus installed/exited events and focus revalidation.

Console: `core://instance-log`, `core://instance-launched`, `core://instance-exited`.

Import decisions: `core://manual-resource-drop-choice`, `core://manual-resource-drop-choice-closed`, `core://world-install-selection-required`, `core://world-install-selection-closed`.

## Remaining preview-only or unavailable data

- The Rust Instance model has no memory-inheritance flag. Native memory remains explicit; the existing preview-only inheritance simulation is retained in browsers.
- `WorldSummary` exposes no game-mode or days-played values. Browser fixtures retain those fields; native worlds use unknown mode and omit days rather than fabricate them.
- There is no whole-instance disk-usage command. Only world/resource sizes are native; the existing fixture statistic remains browser-only.
- The overview's Play world action launches the instance. No command selects/opens a particular save automatically.
- Individual resource reveal remains disabled: the existing host commands open the instance/logs/world folders, not an individual installed-resource path. Pin ordering remains the existing local preference.

## Validation and ownership

`bun run typecheck && bun run lint && bun test checks && bun run build` passes. New Bun tests cover resource mapping, escaped world identity, transfer acknowledgement rules, legacy/structured crash data and repeated-line log catch-up.

A temporary, removed browser harness mocked the Tauri boundary and verified rendered native resources, resource toggle payloads, launch/kill payloads, linked releases, escaped world navigation/datapack payloads, crash-file reads, live-log filtering and listener disposal. This did not execute real filesystem mutations or start a Minecraft JVM. Ordinary browser console/overview preview was also checked. Development diagnostics still report existing Kobalte dependency issues; UI internals were outside this task's permitted scope. The production build retains the existing large-chunk warning.

Architecture areas touched: rewrite Instance Catalog/management Adapter, Instance Lifecycle observation, Resource Manager/Installed Resource Ledger Adapter, world resource flows, console/crash observation, and Modpack Update Engine Adapter. This document records the changed Interfaces and ownership. The external architecture atlas was read but was not edited because this task permits edits only under `apps/desktop-solid`.
