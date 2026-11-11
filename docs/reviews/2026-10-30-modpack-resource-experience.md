# Modpack and resource management experience

Reviewed 30 October 2026. This pass preserves the existing layout and improves loading, feedback, consistency and failure handling. It is a functional and source assessment, with targeted fixes. Visual sign-off is incomplete.

## Result

The separation is sound: a server can run without a modpack; its installation link and the optional pack players receive are independent. Custom client packs retain the familiar Content, Files and Versions structure. Browse retains the chosen server and its compatibility filters.

The largest avoidable waits were reads the current action did not need, cache gaps after confirmed writes, and controls waiting for acknowledgement before responding. This pass removes those costs without declaring installations or publications complete early.

## Flow assessment

| Step | Experience and health | Evidence and remaining scope |
| --- | --- | --- |
| 1. Browse and choose a destination | Healthy within the checked scope. Returning from the server's Browse modpacks action retains Riverside SMP as the target. | Browser fixture walkthrough and permission, destination and pinned-version regressions. A fresh live provider installation through the desktop app was not repeated in this pass. |
| 2. Link or update a server modpack | Healthy within the checked scope. Version choice precedes a review; planning remains cancellable. The client offering stays separate. | With an injected 1.8 s planning delay, Cancel closed the dialog. The late response did not reopen it; one plan and zero apply calls were recorded. Review/apply, runtime mismatch and ownership behavior also have contract tests. |
| 3. Client-pack identity and compatibility | Improved. Current settings remain the starting point. Content now explains Minecraft version drift and offers the existing repair path before an edit can fail. | Walked Content to Overview, used the server-version repair action, then saved and published. The default browser fixture deliberately has differing runtime and draft versions; it was repaired through the UI. |
| 4. Client-pack Content | Improved. Required switches, removals and pinned version edits respond locally while saving. The confirmed workspace stays authoritative. Update discovery is explicit. | Injected delayed success and unreachable responses. The editor rolled back on failure, showed the error, and retained keyboard focus after the focus fix. No automatic dependency review or suggestions scan is needed to open the list. |
| 5. Client-pack Files | Healthy for the checked text workflow. Roots distinguish shared, client and server overrides. Saves use the existing revision-guarded editor. | Created a config directory and settings.json, entered and saved JSON, and saw the override in publication review. Backend tests cover durable blobs, hashes and override precedence. Large uploads and native drag/drop were not practically repeated. |
| 6. Review and publish | Improved. Publication review runs on request; concurrent requests share a read. Confirmed publication updates the header/cache immediately. History no longer flashes an empty result while loading. | Published fixture revision 15 with one override; header, published revision, history and pending state agreed. New regressions ensure publication does not mark a newer, unreviewed draft as published. |
| 7. Server Resources | Improved. Local inventory is visible without fetching every provider's version catalogue. Names still enrich in batches. | DOM walkthrough confirmed grouped plugin/datapack rows, staged-change feedback, named controls and no document overflow at the checked viewport. Explicit update scans deduplicate projects, run two catalogues at a time, report partial failure and stop admitting work when the view leaves. |
| 8. Install or link a local instance | Contract coverage retained; practical native verification remains. | Server-source linkage, consent, pinned versions and separate dependency scopes are covered by existing checks. This browser pass did not create a real Minecraft instance. |

## Implemented changes

- Warm workspace data is available synchronously on entry. A normal status event does not restart loading or dependency resolution.
- Confirmed draft and file edits seed the shared workspace cache, so reopening a view keeps the acknowledged edit.
- An older workspace refresh cannot overwrite a newer acknowledged mutation. Late writes and uploaded icons cannot cross server identity or disposal. Permission changes still invalidate access.
- Draft-only edits are optimistic in the Content editor. Saving is announced, conflicting writes are prevented, and a rejection restores confirmed data. The publication path never reads an optimistic manifest.
- Pending switches remain focusable and read-only, avoiding lost keyboard focus when a save starts.
- Expensive publication dependency resolution waits for Review. It no longer runs automatically after each draft edit.
- Content suggestions and server-wide version scans are explicit Check for updates actions. Suggestion project enrichment is grouped by provider. Stale suggestions are discarded.
- Hover and keyboard focus share the existing bounded project prefetch queue. Server Resources warms both inventory and ownership data. Server-modpack navigation no longer warms an unrelated full loader catalogue.
- A failed provider version list offers Retry; an empty list and a pending list have distinct messages.
- Published history uses the existing shared resource cache, keyed by published revision, with explicit loading and retry states.
- A confirmed publication immediately updates published/minimum revisions and the pending badge. Background reconciliation remains in place.
- Review controls are hidden when there is no unpublished draft.
- The metadata regression harness now resolves Windows file URLs and path separators correctly.

New interface copy: “Check for updates”, “Checking for updates…”, “Some updates couldn't be checked. Try again.”, “Couldn't load versions.”, “No versions are available.”, “Saving changes…” and “Loading published versions…”. The existing version-drift warning and repair label are reused. No em dashes were added.

## Responsiveness evidence

These measurements are observations of injected latency in browser fixtures, not production benchmarks or a simulated 3G throughput test.

- Delayed success: the switch displayed its new value at 46 ms; the saving state cleared on acknowledgement at 2,270 ms. A 2,200 ms delay was injected into the write.
- Failed write: the editor returned to its confirmed value and exposed the unreachable error after the injected delay.
- After the keyboard fix, a Space-triggered failed save retained focus on the same switch throughout the pending state and rollback. The recorded pending update appeared at 177 ms and rollback at 2,036 ms with a 1,800 ms injected write delay.
- Planning cancellation: the dialog closed while planning remained in flight, ignored the late completion and made no apply request.
- Cache tests verify immediate warm data, no unsolicited preview reads, stable loading over 60 status updates, uncertain-intent replay, server identity isolation, permission revocation and acknowledged mutation precedence.

Raw functional observations: [functional-evidence.json](../../audit/modpack-experience-2026-10-30/functional-evidence.json).

## Validation

- Latest focused frontend run: **50 passed, 0 failed**, across eight files covering loading/cache, Browse handoffs, target selection, pack CRUD, server installation, files and localization. The updated loading suite subsequently passed all four tests, including permission revocation and immediate publication projection.
- Additional domain run: **65 passed, 0 failed**, covering modpack decisions, resource models, metadata and localization.
- Broader frontend run: **183 passed, 1 failed** across 22 files. The failure was the existing console performance assertion: console-check:rows accumulated 9.9 ms against an 8 ms budget under the combined run. The console suite passed separately. Its budget and implementation were not changed.
- Backend: **31 pack workspace tests passed**, including durable/revisioned edits, hashed uploads, migration, override precedence, atomic publication and concurrent-edit refusal. No real Minecraft process was started.
- Type checking passed. Scoped oxlint reported no errors and one existing reactivity warning at ServerResourcesTab's stableConnectionId wrapper. Diff whitespace checks passed.
- Isolated test bundles emit the existing multiple-Solid-instance warning. New area regressions capture reactive diagnostics and assert none for their scenarios. The running app also has broader Kobalte/reactivity warnings; this is not a clean bill of health for the entire application.

## Visual and accessibility limits

The first saved screenshots were visibly blurred and were rejected as fine-detail evidence. Two later preview snapshot requests timed out after 15,000 ms. This pass therefore does not certify typography, contrast, spacing, animation, zoom layouts or pixel alignment.

Keyboard checks covered switches and menu/dialog paths. DOM checks covered names, status/error feedback, busy states and the inspected viewport's document overflow. A real screen reader, mobile web presentation and the native file picker were not exercised. The native desktop flow still needs a practical pass with a real server and real provider failures.

## Next useful work

1. Complete the visual pass once reliable screenshot capture is available, including narrow windows, zoom and long provider/version names.
2. Measure large archive upload and planning over an actual constrained network. Native progress should expose verified stages/bytes; completion must continue to mean confirmed completion.
3. Exercise the complete desktop journey from Browse through real installation, restart application and linked-instance update. Keep server files, custom client drafts and published releases distinct in feedback.

The initial pass above did not change a live installation, Minecraft runtime, provider credentials or agent startup policy. Source changes remain uncommitted alongside the pre-existing work.

## Follow-up: real installations and connection state

The report's original fixture assessment did not establish that either provider installed successfully. The follow-up adds real provider downloads, scratch-server file installation and authenticated HTTPS checks. These are distinct from the desktop UI, which remains unverified.

### Fixes

- Full launcher API testing exposed a second installation blocker: Fabric's `stable` flag identifies the current recommendation, so older pinned releases such as 0.16.5 and 0.19.5 were rejected as experimental. Exact numeric release selections now remain available after the recommendation moves. Default selection still follows the recommended flag; prerelease names still require explicit approval. Mirror membership, official server profiles, library sources and published hashes remain checked. Regression coverage installs an older non-recommended release and retains the beta-refusal test. Published-release evidence: [Fabric Loader 0.16.5](https://github.com/FabricMC/fabric-loader/releases/tag/0.16.5) and [Fabric for Minecraft 26.3](https://www.fabricmc.net/2026/09/15/263.html).
- The full CurseForge flow then exposed the obsolete Intermediary entry in the generic Fabric client profile for Minecraft 26.3. For numeric Minecraft releases from 26.1 onward, the installer may omit that exact placeholder entry when Fabric's official server profile also omits it. Missing other libraries, duplicate entries, concrete unexpected coordinates and untrusted repositories still fail. Older Minecraft versions and Quilt do not receive this exception. Fabric documents the removal of obfuscation and mapping requirements in [its migration guide](https://docs.fabricmc.net/develop/porting/mappings/).
- A timed-out management operation no longer changes the entire connection to unreachable. The action still returns its error; actual connection/TLS failures, status probes, permission changes and rate-limit guidance retain their existing behavior.
- Provider-dependent pack reads, archive processing, pack apply and resource inventory scans use the bounded content workers. They cannot occupy the normal status worker. This changes scheduling, not authorization or concurrency limits.
- Pack apply receives the same bounded extended request budget as review. A verified pack can take longer to decode and stage than a status read, particularly on a busy disk.
- Applying a pack no longer serializes and writes a second full copy of its verified bytes merely to remember the idempotency key. The consumed review is deleted in the same transaction that stages the files, stores the link and commits the durable receipt. Replaying the same intent still returns the original receipt; using the consumed token with a different intent fails. Applied plans no longer occupy the eight pending-review slots for thirty days.
- Agent listener startup now reports its fixed diagnostic code, distinguishing unavailable TLS material, bind failures and runtime failures. No certificate/key contents or arbitrary system errors are exposed.

### Real evidence

- CurseForge Echoes of the Sift, project `1714524`, file `9024763`: downloaded and verified, reviewed, staged, replayed, applied to an isolated scratch filesystem, and every installed SHA-256 checked. Fifteen server files installed; four client files skipped. No client pack was published.
- Modrinth Pure Vanilla Server, project `cm9Ke4UE`, version `G2xrUEZf`: the same workflow installed and verified seven server files. No client pack was published.
- Both workflows left the user's existing server content untouched. No Minecraft process was started.
- A separate real agent/TLS test used the launcher's production Rust client to plan both packs while querying status every second. All 31 concurrent status reads succeeded; the slowest took 123 ms. This measures planning responsiveness, not the full desktop install journey.
- The full production-client API sequence now passes for both providers against freshly created Java servers: pair as owner, review the pack, plan and activate its exact Fabric/Minecraft software, review again, apply the pack, stop and restart the agent, establish a fresh authenticated client and verify the durable server link and stopped state. Modrinth staged seven files on Fabric 0.16.5 / Minecraft 1.21.1; CurseForge staged fifteen on Fabric 0.19.5 / Minecraft 26.3. The combined live run passed in 162.15 seconds, including fresh server provisioning, downloads and reconnects. This is an observation under concurrent development builds, not a performance target. EULAs remained pending and Minecraft was never started.
- The repeatable full-flow harness is [live_pack_install.rs](../../crates/vesta-server-client/tests/live_pack_install.rs). Run its ignored test with `VESTA_LIVE_AGENT=1`, `VESTA_AGENT_BIN` pointing to a built agent and `VESTA_TEST_JAVA` pointing to a compatible installed Java executable. It creates its own temporary registries and uses only its own child handles. Successful scratch servers are removed; a failed scratch run is retained for diagnosis.
- Regression checks: 145 pack/resource-pack tests passed; the three opt-in live pack tests were then explicitly run and passed. Client unit tests passed 36/36; HTTPS, scheduler and priority suites passed 35/35. Targeted frontend checks passed 112/112, and TypeScript checking passed.
- The final broad installer suite passed 208 tests. Its opt-in Windows volume/space/file-identity test was explicitly run against a new owned temporary directory and passed. The only remaining unrun installer check inspects a separately supplied completed BuildTools JAR; no new Bukkit/Spigot build was needed for this Fabric modpack flow.
- Final server/agent/dev-tool Clippy passed with warnings denied. The real `dev-server` agent was rebuilt, restarted and independently confirmed online with Minecraft still stopped. Existing worlds, installed content, identity, credentials and startup registration were preserved. The source changes remain uncommitted.
- Strict client Clippy still reports the existing `result_large_err` warning from the inline provider-error details. With only that lint excluded, the checked client library and live-planning harness pass the remaining warning checks. The warning was not hidden in source.
- The broad installer run exposed a timing race in its monitor-error fixture: a 150 ms process-start deadline could win before the intentional `StorageLow` monitor error on a busy machine. That case now uses the same ordinary startup allowance as the other error cases; the separate hang/deadline test keeps its 150 ms deadline. Production deadlines were not changed by this test fix.

### Native and remaining scope

After the user requested computer use instead of browser automation, Terra attempted the native Computer Use integration twice. Both calls to `sky.list_apps()` failed before any window was selected: `Computer Use native pipe is unavailable: failed to connect native pipe: The system cannot find the file specified. (os error 2)`. No browser automation was substituted. See [native test report](2026-10-30-modpack-native-terra.md).

This still does not certify pixel alignment, narrow/zoom layouts, native drag/drop, screen-reader use, launching Minecraft, or linked-instance updates. The implementation also retains its existing bounded pack-import limits; these small real packs do not prove that arbitrary large modpacks fit those limits. Installation completion remains distinct from staged content waiting for the next Minecraft start.

The API tests were used instead of further UI automation after the user's follow-up. Their results and raw logs are saved in [the API evidence directory](../../audit/modpack-api-2026-10-30/results.json). PowerShell 5 wraps native stderr in `NativeCommandError` records even when Cargo prints normal build progress; process exit codes and the final test result lines determine each recorded outcome.
