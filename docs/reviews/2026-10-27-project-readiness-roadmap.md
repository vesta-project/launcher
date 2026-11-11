# Vesta project assessment and proposed roadmap

Assessment date: 2026-10-27. This is a planning proposal, not a claim of production readiness or an approved implementation backlog.

Evidence snapshot: Launcher `52db3ead` on `feat/frontend-rewrite`; Server `cc1dd76` on `feat/launcher-compat`. The active server checkout is `V:/server-connections-mvp`. Website and extension source were inspected read-only. Luna assisted with the launcher, website and extension inventory. No builds, tests, live website visual audit or new implementation were performed for this assessment. Earlier test reports establish only their recorded environments and revisions.

## Assessment

Vesta has progressed well beyond a launcher prototype. It has substantial instance, content, update and server-management implementations. The main risk is now the distance between implemented components and a complete, supported user journey. Several large features are simultaneously present in code, partially integrated, and described as future work elsewhere.

My recommendation is a consolidation release, followed by a server-management web client and inexpensive sharing. Resource inspection and world tooling should grow in smaller stages after those foundations are dependable.

The strongest product direction is **a local-first Minecraft launcher that also makes operating your own server and distributing its client setup straightforward**. Keep ownership, recoverability, interoperability and a small host footprint central. Do not expand into a general commercial hosting platform or arbitrary game ecosystem before this works well.

### What is already substantial

- Launcher: separate instances, accounts/onboarding, Java and loader workflows, resource browsing/import, themes, task infrastructure and a recoverable modpack-update design.
- Server: Rust agent, independent supervisor support, scoped CLI, signed setup/update staging, management authority, console recovery, files/SFTP, software switching, world metadata/datapacks, backups, automation and client-pack foundations.
- Recent server work includes provider-aware resource management and a bounded hosted-resource-pack backend. This is not yet a finished launcher feature.
- Existing theme tokens, icon catalogs, update review, task progress, trusted provider resolution and server client-pack machinery are assets to reuse rather than replace.

### Concrete gaps found

| Area | Evidence | Consequence |
| --- | --- | --- |
| Launcher release cutover | `.github/workflows/release.yml` installs/builds `vesta-launcher`; the active frontend is `apps/desktop-solid` | A successful release workflow can still ship the older frontend. |
| Rewrite data and identity | Rewrite README uses a separate identifier/dev profile and explicitly defers release profile handling | Decide migration, rollback, app identity and updater channels before distributing a normal release. |
| Host onboarding | Server `docs/operations/host-setup.md` says setup prepares a pending host; app provisioning/pairing/activation is unfinished | The installer is not yet a complete install-to-launcher experience. The scoped CLI path is separate. |
| Vesta executable updates | Server `docs/operations/signed-updates.md` implements verification/staging, not activation, executable rollback or remote update routes | Development rebuild/restart is not a supported production updater. |
| Hosted resource packs | Server `docs/operations/resource-pack-hosting-api.md` lists missing automatic format lookup, native IPC, retirement/disable and deployment compatibility work | Finish the existing feature before adding more resource-management surfaces. |
| Isolation | Server README explicitly says same-account portable operation is not a sandbox for hostile plugins | Separate processes do not establish a containment boundary. A hardened deployment profile needs explicit OS isolation and permissions. |
| Platform proof | WSL boot test passed; physical Linux boot and ARM64 are not established. Windows machine-boot registration is unsupported | Publish a precise support matrix; do not equate sign-in startup, WSL restart and machine boot. |
| Release trust | Launcher workflows have signing-related wiring, while README describes unsigned distribution | Verify the actual shipped artifacts. Updater signatures and OS publisher signing/notarization are different checks. |

Source entry points: [launcher architecture](../architecture/ARCHITECTURE.md), [rewrite README](../../apps/desktop-solid/README.md), [release workflow](../../.github/workflows/release.yml), [server README](../../../server-connections-mvp/README.md), [host setup](../../../server-connections-mvp/docs/operations/host-setup.md), [signed updates](../../../server-connections-mvp/docs/operations/signed-updates.md), [boot validation](../../../server-connections-mvp/docs/reviews/2026-10-27-agent-boot-validation.md), [resource-pack contract](../../../server-connections-mvp/docs/operations/resource-pack-hosting-api.md).

## Linear needs reconciliation

Linear is connected and readable. Its current statuses should not be treated as a readiness score:

- [SERVER](https://linear.app/vestaproject/project/server-cab2f9359eb3) is In Progress but has no issues or milestones. Its description still refers to the earlier Java wrapper.
- [Launcher Beta Release](https://linear.app/vestaproject/project/vesta-launcher-beta-release-a2b774b56e6c) and its [roadmap document](https://linear.app/vestaproject/document/roadmap-54d3c73b5a41) predate much of the current implementation. Some unchecked roadmap items already exist in code; some Done issues need acceptance against the rewrite.
- Server integration and world management still sit in [Optional Tasks](https://linear.app/vestaproject/project/optional-tasks-92595745202b), despite becoming major product areas.
- [Extension](https://linear.app/vestaproject/project/extension-2b7a7a5d2bf4) has three open, overlapping browser-install issues.

Keep existing project identities where practical. Give Launcher and Server separate release milestones, then distinguish **implemented**, **integrated**, **verified**, and **accepted for release** in issue checklists. Every release gate needs an evidence link, tested revision and platform scope. Do not reopen every historical issue or infer completion percentages from issue counts.

Suggested milestones: release cutover; complete daily-use journeys; update/recovery and security; platform/low-end acceptance; private beta. Web/PWA and ecosystem tools should have their own later milestones. This assessment has not changed Linear.

## Competitive position

This is a comparison of documented workflows, not a performance ranking or an exhaustive absence/presence matrix. Features not discussed here may still exist in the other products. Current official sources were checked on the assessment date.

| Reference | What it establishes | What Vesta should learn or emphasize |
| --- | --- | --- |
| [Prism Launcher](https://prismlauncher.org/about/) | Broad instance/loader/content management, logs and customization | Reliable everyday launching, recovery and interoperability are baseline expectations. Avoid needing server ownership to make Vesta useful as a launcher. |
| [Modrinth shared instances](https://modrinth.com/news/article/shared-instances/) | Invites/share links, owner-managed content, selected files and reviewed updates | Sharing is now a competitor baseline. Focus on clear differences, personal additions and owner-controlled hosting. |
| [Modrinth Server Projects](https://modrinth.com/news/article/introducing-server-projects/) | Server-linked instances that install required content and receive compatibility updates | Server linkage alone is not unique. Vesta can combine this with operating a server the user owns. |
| [AMP](https://discourse.cubecoders.com/t/amp-proteus-2-8-0-release-notes/40953) | Established server lifecycle, sleep and backup/permission workflows | Learn from operational completeness and state handling rather than reproducing every panel screen. |
| [Crafty](https://docs.craftycontrol.com/) | Web management, PWA documentation, backups, schedules, metrics, API and webhooks | Browser/mobile control is an expected server-panel capability. Vesta should make setup and recovery simpler, not merely add another dashboard. |
| [Pterodactyl](https://pterodactyl.io/) | Self-hosted panel/node model and per-server Docker resource isolation | Use it as an isolation and deployment reference. Do not adopt a hosting-company architecture for the first personal-server release. Its 2.0 extension features are currently labeled beta, distinct from 1.x stable. |
| [packwiz](https://packwiz.infra.link/) | Git-friendly metadata, provider references, HTTP distribution and auto-updating packs | Shared instances need not require Vesta to host every mod file or run a social platform. |

Vesta's advantage should be the complete workflow: discover resources, build the server, publish a reviewed client setup, join, diagnose and recover. None of the pieces alone justifies broad claims of uniqueness. There are no matched-hardware competitor benchmarks supporting a speed or memory ranking.

## What stable should mean

Launcher and Server should be releasable independently. A stable Launcher can expose Server as an explicitly experimental capability until the Server gates pass. Do not make world editing, resource-pack previews or a web client prerequisites for a dependable launcher.

### Launcher release gates

1. **Ship the intended app.** Move the release entrypoint deliberately; decide product identity, data migration/backup, supported OS versions, update channels and rollback. Verify downloaded artifacts rather than only a successful CI build.
2. **Prove the core journey.** Fresh install, Microsoft sign-in/session refresh, Java detection/download, game/loader installation, launch/stop, import/export and a reviewed content update must work in the real native app. Cancellation, disk exhaustion, interrupted downloads and restart recovery are part of acceptance.
3. **Make states trustworthy.** Consistent current settings, capability-aware actions, useful errors and last-known data during disruption. Controls should not silently revert; graphs, player counts and connection state must represent the same event timeline. Hide unavailable capabilities rather than fill pages with unusable controls.
4. **Control background work.** No heavy scans or repeating requests for hidden pages. Bounded caches, coalesced refreshes, lazy views and measured low-end behavior. Preload only likely next views; do not prefetch all providers on every hover.
5. **Release/support basics.** Publish accurate install/update documentation, diagnostics export with secret redaction, known limitations and completed privacy/terms materials. Verify platform signing/notarization and actual updater trust. Do not label all platforms stable based on compilation alone.

### Server release gates

1. **Install to first managed game.** Fresh host setup, owner pairing, create/adopt server, Java/software selection, EULA decision, start/stop/sleep and a clear choice of agent startup policy. Keep agent startup separate from Minecraft autostart.
2. **Safe Vesta updates.** Verified staging followed by owned activation, coordinated supervisor/agent handoff, health proof, persisted recovery and rollback of binaries/state where supported. Define schema migration compatibility before promising rollback. Interrupted activation must remain diagnosable and recoverable.
3. **Operational recovery.** A backup restored into a disposable copy must start correctly. Test agent/supervisor interruption, disk full, changed config, expired/revoked access, failed software install and uninstall verification. Server-software rollback must not imply a safe world downgrade.
4. **Deployment security.** Define trusted portable use versus a hardened profile. Keep game/plugin code away from management credentials, release keys and unrelated servers. Dedicated identities, narrow mounts/ACLs, service hardening and optional containers are implementation candidates. A container alone is not a complete security model.
5. **Finish current resources.** Validate Browse destinations, world/datapack paths for supported layouts, client-pack linkage and hosted resource-pack publication end to end. Complete native IPC, safe disable/retirement and public HTTPS guidance before advertising the latter as turnkey.
6. **Host/platform acceptance.** Physical Linux boot, supported Windows startup semantics and ARM64 need explicit results. WSL restart is useful evidence, not a substitute. A stopped agent cannot start itself remotely: any later machine-level controller must have separately scoped authority.

The prior eMudhra review records patched Rust verifier/root dependencies and distinguishes exact leaf pins from initial discovery. Remaining release work is distributing rebuilt artifacts and accounting for OS/WebView/native-TLS trust. Treat it as a maintained dependency/release gate, not an unresolved reason to redesign all signing. See [the existing review](../../../server-connections-mvp/docs/reviews/2026-10-23-review-results.md).

### Performance acceptance, not optimistic claims

Use an actual 1-core/2 GiB and 2-core/4 GiB Linux VM, plus representative Windows hardware. Measure release builds separately from Minecraft, then together. Record revision, host, active features, warm/cold caches and measurement method.

Measure idle CPU/RSS, thread/task counts, requests/minute, metadata bytes, reconnect time, active control latency, console backlog recovery and bounded disk growth. Test slow/variable bandwidth, latency, loss and disconnect separately: a label such as "3G" is not a reproducible condition. Include a slow/full disk and concurrent server operations.

Candidate targets to validate, not claims: below 1% of one core at idle for agent plus supervisor, an initial combined idle RSS budget around 64 MiB, and control responsiveness maintained during console/metadata/build traffic. Define percentile latency targets relative to the tested network; do not promise sub-second completion on every connection. Existing short CPU/RSS samples are not proof these budgets hold under all enabled features.

Priority tuning opportunities:

- Single-flight provider lookups; bounded persistent caches with ETag/TTL, short negative caching, explicit stale state, backoff and cancellation. Client and server may share schemas/resolvers while retaining independent authoritative verification. A client-supplied URL or digest must not become the server's trusted metadata.
- Reserve urgent stop/auth capacity through transport and server executors. Keep console streaming independent of slow observations and render in batches.
- A machine-wide budget for expensive builds/downloads across multiple agents. Hosted resource-pack workers currently do not share a machine-wide CPU/disk build permit.
- Request-driven world-size/map work, incremental scans and client-side heavy processing. Do not render maps or inspect all archives on an idle game host.
- Evaluate resumable/conditional public artifact delivery under interrupted networks. Hosted packs currently restart downloads and lack range/304 support. Consider optional caching/offload for immutable public packs only; never expose management routes for convenience.
- Measure first, then adapt to pressure conservatively. Keep fixed upper bounds; more detected RAM should not silently enlarge all queues or consume the game's reserve.

## Future feature proposals

### 1. Browser and phone management: high value, after protocol foundations

Your static-frontend idea is feasible. Recommended split:

- `www.vestalauncher.com`: marketing, downloads and documentation.
- `manage.vestalauncher.com`: static server-management PWA, connecting directly to an explicitly paired HTTPS agent.
- Optional self-hosted deployment of the same management build for owners who prefer it.

Reuse frontend components and domain logic through native and browser transport adapters. Start with server management, not browser-based Java launching. A desktop launcher requires capabilities ordinary web pages do not have.

The current native transport deliberately rejects browser WebSocket `Origin` headers (`crates/vesta-transport/src/realtime.rs`). It also assumes native trust/auth behavior. This is protocol work, not merely uploading a Vite build:

1. Explicit per-agent origin allowlists/CORS/preflights and bounded browser authentication. The browser [WebSocket constructor](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket) does not accept arbitrary authorization headers; design short-lived connection authentication without putting long-lived credentials in URLs.
2. Browser-compatible trusted TLS and an operator reachability story. Native certificate pinning is not a general browser-JavaScript feature. Domain hosting does not solve NAT, firewall rules or a stopped agent.
3. Phone/browser suspend, reconnect and cursor resync. Cache the shell, not sensitive API responses or deferred destructive operations.
4. Safari/Firefox/Chromium real-device testing. [Local-network permissions](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access) and mixed-content handling vary by browser and deployment; do not promise every public page can silently reach a private host.
5. Treat the management origin as privileged software distribution. Compromised JavaScript can abuse active sessions even with non-exportable keys. Separate it from marketing scripts, minimize third parties, enforce a restrictive CSP and offer versioned/self-hosted builds.

A narrow read-only architecture spike can happen early. Full remote control should wait for the authentication/origin/recovery gates. No mandatory Vesta relay or cloud account is required for the direct-connect model, but network reachability still belongs to the operator.

### 2. Shared instances: high value, feasible on a small budget

Start with an owner-published manifest and a subscription URL, reusing the server client-pack and update-review architecture. The launcher follows revisions and shows a diff before applying them. Link existing [update-from-file work](https://linear.app/vestaproject/issue/VES-207/feat-update-from-file) to this design.

Store provider identities and verified hashes rather than rehosting every mod. Download provider files through supported official mechanisms. Host only selected custom configs/files and the manifest on an owner's agent or ordinary HTTPS storage, respecting redistribution permissions. Reuse cached unchanged content.

Keep three layers explicit: upstream pack, shared owner changes and personal additions. Preserve personal settings, expose conflicts, and allow clone/unfollow. Never include accounts, keys, worlds or logs by default. Preview non-provider files and executable content. Private sharing still needs authentication and a durable place to host its private files; it is inexpensive infrastructure, not zero infrastructure.

Versioned signed manifests, reviewed updates and manual file export/import should precede centralized accounts, friend graphs, discovery, cloud synchronization or a CDN. [packwiz](https://packwiz.infra.link/) is a strong interoperability reference; assess importing/exporting its manifests rather than inventing another closed format.

### 3. Resource-pack inspection: staged, useful differentiation

First deliver texture browsing, metadata/format compatibility and an effective-file conflict view across the ordered pack stack. Then preview a defined subset of vanilla block/item JSON models, parent resolution, texture animation and lighting. Identify unsupported custom formats clearly.

Reuse the trusted asset cache, archive admission and bounded background jobs. Parse untrusted inputs without executing pack/mod code. Provide a 2D fallback and GPU/memory budgets. Full shader, custom entity and mod-engine parity is a much larger rendering product. [Blockbench](https://www.blockbench.net/) already provides editing; Vesta should initially inspect and open external tools rather than replace it. This extends [VES-75](https://linear.app/vestaproject/issue/VES-75/asset-browser).

### 4. Advanced world tools: start read-only, editing later

Sequence: metadata/backup/import/export, then a viewport-driven 2D map, chunk inspection/selection, and eventually reviewed offline edits. Work on a consistent downloaded copy or a stopped world. Heavy processing should normally run on the launcher computer, with bounded tile caches and visible cancelable jobs.

World editing needs backup, change preview, file-version checks and tested rollback. Never patch live region files. Modded registries, custom dimensions and version conversion make this a separate large subsystem.

There are already free tools: [MCA Selector](https://github.com/Querz/mcaselector), [Amulet](https://github.com/Amulet-Team/Amulet-Map-Editor), [Chunker](https://github.com/HiveGamesOSS/Chunker), and [BlueMap](https://bluemap.bluecolored.de/). Chunker documents conversion limitations including entities and structure data. Prefer adapters where licensing and compatibility permit. The value is a coherent workflow, not the assumption that capable alternatives are all paid. Conversion belongs after reliable read-only inspection and offline editing.

### 5. Browser extension: bounded near-term work

The source already has WXT/Solid integration, narrow Modrinth/CurseForge permissions and `vesta://` install links. Restore it around a versioned shared deep-link contract and the launcher's central destination resolver. Pass provider IDs, not arbitrary trusted download URLs. Confirm the target and plan in Vesta.

Test SPA navigation, changed site DOM, duplicate injection, missing launcher behavior, and current Chrome/Firefox store builds. Keep permissions narrow. A working small extension is more useful than supporting every download site. Preserve the existing user edit in `entrypoints/index.content.tsx` during implementation.

### 6. Website: release communication first, visual work separately

The current source is a SolidStart marketing/download/waitlist site, not a management panel. Consolidate Launcher, Server, Docs and Downloads around accurate release channels, platform support and actual screenshots. Reconcile early-access/subscription claims and waitlist copy with the chosen release plan. Make installation, support, privacy and security reporting easy to find.

The live site could not be inspected in this assessment. Its present visual quality is not independently judged here. A later visual pass should use the actual deployed pages. Keep website and management origins separate.

### 7. Icons: foundational consistency work

Extend the existing icon catalog into one semantic action API. Separate app action icons from software/provider brand assets. Set optical baselines, view boxes, 16/20/24 sizes, stroke/tint rules, loading dimensions, light/dark examples and accessible labels. Remove duplicate aliases after migrating callers. This is a small shared foundation before more page-specific polishing, not a reason to redesign every page.

### 8. VS Code themes: contained enhancement after token stability

Import theme JSON/JSONC data, map supported workbench colors into Vesta tokens and preview fallbacks before saving. Syntax token colors belong to an editor preview, not every application surface. [VS Code's theme model](https://code.visualstudio.com/api/extension-guides/color-theme) distinguishes workbench colors from syntax colors.

Do not execute VSIX extension code. Keep any includes/archive parsing bounded and explain partial mappings. A useful palette import is realistic; exact compatibility with every VS Code UI setting is not.

### 9. Developer integration: prioritize contracts and reproducibility

First: reliable human CLI plus `--json`, documented exit codes and shell completion; versioned schemas/typed client; optional scoped webhooks/events; secret-redacted diagnostics; optional Prometheus/OpenTelemetry output. Verify existing coverage before duplicating commands.

Next: pack manifest validation, reproducible/headless build and review/publish workflows, packwiz interoperability, disposable test-server clones and configuration diffs. A small IDE integration can reuse those contracts for logs and tasks later.

Defer arbitrary in-process extension execution, unrestricted remote shells, a plugin marketplace and broad admin-capable agent/MCP interfaces. Those add a security/platform-maintenance commitment before the core product is stable.

## Proposed sequence

| Phase | Launcher | Server | Shared/ecosystem |
| --- | --- | --- | --- |
| A: release consolidation | Rewrite release/data/updater cutover; native core acceptance | Complete host-to-app onboarding; define executable activation/recovery | Reconcile Linear; support matrix; icon contract; accurate website copy |
| B: private beta gates | Failure recovery, resource destinations, low-end/cross-platform acceptance | Complete safe updates, backup restore drill, resource-pack integration and deployment hardening | Versioned protocol/deep links; read-only browser feasibility spike |
| C: useful expansion | Shared instance subscriptions; theme import | Direct browser/PWA management with explicit trust; optional immutable-download offload | Refresh extension; developer CLI/schema/pack tooling |
| D: deeper tools | Resource texture/model inspection; local world map | Optional map integration and scoped deployment automation | Reviewed offline world edits, conversion adapters and larger developer ecosystem |

These phases express dependencies and priority, not dates or effort estimates. Website accuracy and icons can improve during consolidation. Read-only web feasibility can be evaluated early without announcing production browser control.

### Recommended next work

Make a small release-acceptance board and finish **two bounded delivery slices**:

1. Launcher: prove the release workflow ships the rewrite with a deliberate profile migration and verified update path.
2. Server: finish setup-to-app onboarding, followed by a reviewed activation/recovery design and implementation for Vesta binary updates.

Meanwhile close the native bridge and real-client acceptance for the resource-pack backend already built. Resist starting another large resource or world subsystem until that feature can be exercised through the intended user path.

After those slices, choose PWA management and inexpensive instance sharing as the next major features. They reinforce the core Launcher + Server promise more directly than full world conversion or an extensible plugin platform.
