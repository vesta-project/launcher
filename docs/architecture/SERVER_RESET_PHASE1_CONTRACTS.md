# Phase 1 server reset: UI contract handoff

The approved D1/D3/D4/D5/D9 backend/native/fixture contracts are implemented.
No new UI pages were built. The header only gained labels for the new lifecycle
union, and the obsolete world creation action was removed. The concurrently owned
software section, files tab/CSS, files-model.ts, hosting-model.ts and overview
freshness files were not edited.

## D3: Sleep / Wake / Stop / Start

Agent POST /api/v3/manage/lifecycle/sleep `{expected_generation}` reuses
lifecycle.stop; POST /lifecycle/wake `{}` reuses lifecycle.start. Stop accepts an
empty object from Sleeping/Stopped, or the expected generation when running.
Start and Wake recheck the stopped/sleeping distinction in the actual effect gate.
Network wake is possible only while Sleeping. Stop turns off the game-port
responder; the agent HTTPS management listener stays online.

Native: server_sleep, server_wake and the existing server_lifecycle. The existing
TS lifecycle(...) accepts sleep/wake. model.ts lifecycleControls exposes primary
Sleep while sleepAvailable, primary Wake while Sleeping, and menu Stop. The
status process state remains stopped while lifecycle=sleeping; lifecycle=offline
means explicitly Stopped. Status also exposes sleepAvailable, onAgentStart and
the existing sleepBlocker. Sleep needs offlineStatus enabled; enabling an idle
timer without a responder does not silently produce a listener-less Sleeping.

SleepPolicy.onAgentStart is nullable stay_stopped | sleep | start. Null inherits
host.toml. It persists through updateSleepPolicy; startup rechecks the policy
actor's lifecycle authority. Local legacy start-on-agent-start booleans migrate.
The dev shell forces stay_stopped for restarts.

UI work: Sleep primary / Stop menu, Wake while sleeping, startup selection and
idle-blocker explanation. Reuse current capability gates rather than inventing
lifecycle.sleep/lifecycle.wake capability IDs.

## D4: confirmed raw protected files

The generic GET files/content can read server.properties, whitelist.json,
ops.json, banned-players.json and banned-ips.json for config.edit + files.read
(owner/admin defaults). FileEntry.protection is confirm_edit for these root
files. Private Vesta/VCS/wrapper/state paths stay hidden from everyone.

fileWriteProtected(...) / server_file_write_protected wraps the generic PUT.
First call returns PropertiesUpdateResult.awaitingConfirmation; repeat identical
intent/path/text/old hash with the receipt token to confirm. Success returns
applied and restartNeeded; old bytes go to recoverable trash. Properties and JSON
syntax are validated, with file/confirmation audits. Generic rename/delete/upload
remain unavailable for these protected documents.

native-files.ts exports fileProtection() and rawProtectedFile(). Use the server
flag and capability result to allow confirmed editing; the currently owned
files-model.ts still needs the UI engineer's policy update. Show the Settings /
Players hint for player-list files, a clear confirmation, and stale-validator
recovery. Fixtures implement the same two-step write and permission boundary.

## D5: Java on the agent host

GET /java returns ServerJavaInventory: runtimes, selected, customPathsAllowed,
managedMajors. Each ServerJavaRuntime includes id, host path, major, full version,
vendor, arch and managed. Native/TS: server_java_inventory / javaInventory,
server_java_select / javaSelect and server_java_download / javaDownload.

Selection accepts runtimeId or customPath, exactly one. Custom paths must be
inside the locally configured host.toml [java] custom-path-roots allowlist and
pass a real probe. Only owners with content.install can manage Java. Selection
and managed downloads return SoftwareJob (java_select / java_download); use
softwareJobs to follow them and refresh inventory after success. Selection uses
the protected software activation journal and stopped-game hold; download does
not select or start Java. Windows Adoptium Java 21 download, checksum, probe and
reuse were exercised against the official service.

SoftwarePlan now has javaCompatible, selectedJavaMajor and managedDownloadMajor.
A false javaCompatible is a preview that cannot be applied. Offer Download Java N,
then select it and re-plan. Unprobeable Java is an explicit error. Fixtures include
17/21/25, multiple vendors, custom rejection and managed download/selection jobs.

UI work: runtime picker with host metadata, optional allowlisted custom input,
job progress/failure, compatibility hint and managed download action. Keep the
existing inline software picker owned by the UI engineer.

## D1: one world

ServerWorld adds sizeBytes / sizeComplete / sizeObservedAtMs,
lastModifiedAtMs / lastPlayedAtMs, dimensions, datapacks and datapackStateSource.
Seeds and byte sizes remain strings. Unknown timestamps and enabled states are
null. WorldDimension groups overworld/nether/end, with folders and nested/split
layout (including Paper sibling folders). Size scanning is bounded and cached;
incomplete size must be displayed as partial. WorldDatapack covers folder, zip,
builtin and missing packs and saved level.dat Enabled/Disabled lists.

worldDatapackToggle(...) / server_world_datapack_toggle uses POST
/world/datapacks/toggle with packId, enabled and expectedGeneration. It requires a
running game and config.edit + console.write, and returns a ServerOperation for
Minecraft's own quoted datapack command. Command completion proves submission;
check console for Minecraft's result. Saved metadata can lag live changes.

worldNew / server_world_new are removed from the launcher client, TS and fixtures;
the agent route remains for other tools. UI work: instance-like world details,
hidden/reveal-copy seed, dimension grouping, partial/unknown metadata, datapack
controls and operation feedback. No world creation UI should return.

## D9: server-owned history

metricsHistory(connectionId, request) / server_metrics_history reads GET /metrics.
Request: series (tps, game_cpu_percent, game_memory_bytes, players_online), from/to
Unix ms, resolution raw | 5m | daily | auto, maxPoints <= 2000 and optional after
cursor. The raw window is <= 7 days; other windows <= 5 years.

MetricsHistory contains aligned timestamps, series columns avg/min/max/
knownCount/unknownCount, gaps, nullable tickSource, resolution, bucketMillis,
string cursor and retentionGap. Series keys stay snake_case. Null is never zero;
break chart lines at gaps, hide wholly unknown graphs, refresh the full window
on retentionGap and replace mutable five-minute buckets by timestamp.

Fixtures include plausible independent CPU/memory/player/TPS variation, gaps,
five-minute aggregates and fixture-creative with no TPS. UI work: separate graphs
seeded from history, with live/incremental updates and the existing disrupted-only
freshness rule from the UI engineer's worktree.

## Validation and development

Agent relevant sleep/world/Java/metrics/protected-file tests, agent CLI/process
tests, serialized HTTPS tests and clippy -D warnings cover these boundaries.
The native client suite/clippy, launcher cargo check, Solid typecheck and all
checks/servers-*.test.js plus localization checks are the frontend gates.

From V:\server-connections-mvp use .\scripts\dev.ps1 start | stop | status.
start builds/stages the agent and keeps Minecraft stopped; stop gracefully shuts
it down and waits. recover archives a stale shutdown marker only for a marked
scratch instance after locked proof checks. See the agent repository's
 docs/operations/dev-test-server.md, sleep-and-motd.md, java-runtimes.md,
 world-details.md, metrics-history.md and management-api-contract.md for details.
