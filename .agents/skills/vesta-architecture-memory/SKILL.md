---
name: vesta-architecture-memory
description: Keep the Vesta Launcher architecture atlas current while changing code or docs. Use when working in /Users/eatham/Vesta/launcher on refactors, feature changes, bug fixes that reveal Module ownership, docs/tests cleanup, architecture review follow-ups, questions like "where does this area live?", or any change that creates, removes, renames, deepens, splits, or connects Modules, Interfaces, seams, Adapters, events, task flows, persisted models, resource flows, runtime preparation, launch lifecycle, or frontend state.
---

# Vesta Architecture Memory

Use this skill to keep the external Vesta architecture memory aligned with code changes.

## Canonical Locations

- Repo: `/Users/eatham/Vesta/launcher`
- Stable domain vocabulary: `/Users/eatham/Vesta/launcher/CONTEXT.md`
- Load-bearing decisions: `/Users/eatham/Vesta/launcher/docs/adr/`
- External architecture workspace: `/Users/eatham/Documents/Vesta Architecture Reviews/`
- Current atlas dashboard: `/Users/eatham/Documents/Vesta Architecture Reviews/architecture-atlas-20260708/index.html`
- Current atlas pages:
  - `architecture-map.html` - current Module map and area ownership
  - `area-finder.html` - path-to-area lookup
  - `findings.html` - deepening candidates and evidence
  - `slop-cleanup.html` - stale docs, disconnected implementations, and navigability debt
  - `roadmap.html` - sequence, ADR candidates, and next work
- Earlier report and notes:
  - `/Users/eatham/Documents/Vesta Architecture Reviews/architecture-review-20260613-122500.html`
  - `/Users/eatham/Documents/Vesta Architecture Reviews/architecture-review-20260613-122500-files/`

Keep exploratory findings outside the repo. Move only stable vocabulary into `CONTEXT.md`. Move only accepted or rejected load-bearing decisions into `docs/adr/`.

## Workflow For Every Code Change

1. Identify touched architecture areas before editing.
   - Use `area-finder.html` first.
   - If the path is not listed, infer the closest Module from `architecture-map.html`, then add the new area or path pattern to `area-finder.html`.
2. Read current memory for those areas.
   - Read the relevant atlas page(s).
   - Read matching sidecar notes when the area already has one, such as `02-instance-lifecycle.md`, `03-runtime-preparation.md`, `04-instance-draft.md`, `05-resource-browse-session.md`, or `06-modpack-instance-state.md`.
   - Read `CONTEXT.md` and relevant ADRs if the change affects vocabulary or decisions.
3. Make the code change using normal repo practices.
4. Update architecture memory immediately after the change if any of these changed:
   - Module responsibility, Interface, invariant, ordering, error mode, event, persisted model, task lifecycle, Adapter, or seam
   - File ownership or path organization
   - Candidate status, evidence, priority, or recommended sequence
   - Docs/tests truthfulness or navigability
5. Choose the right update target.
   - Update `architecture-map.html` when the current shape of the app changes.
   - Update `area-finder.html` when new files, folders, or areas are discovered.
   - Update `findings.html` when a shallow Module is deepened, a candidate is retired, or new evidence appears.
   - Update `slop-cleanup.html` when stale docs, broken links, dead drafts, or disconnected implementations are fixed or discovered.
   - Update `roadmap.html` when priorities or ADR candidates change.
   - Update sidecar Markdown notes when the work continues an existing candidate in detail.
6. Promote only durable knowledge into the repo.
   - Add or update `CONTEXT.md` only for stable domain terms.
   - Add an ADR only for a load-bearing decision future agents must not re-litigate.
   - Do not copy exploratory atlas text into the repo.

## Architecture Language

Use the shared vocabulary from `improve-codebase-architecture`:

- Module
- Interface
- Implementation
- Depth, deep, shallow
- Seam
- Adapter
- Leverage
- Locality

Avoid substituting other architecture terms when writing findings. It is fine for source paths to contain existing folder names.

## Area Finder Shortcut

Use this first-pass lookup, then confirm with `area-finder.html`.

| Paths or files | Area | Main update target |
| --- | --- | --- |
| `vesta-launcher/src/app.tsx`, `mini-router*`, `page-viewer*` | Frontend shell and route state | `architecture-map.html`, `findings.html` |
| `vesta-launcher/src/stores/settings.ts`, theme files | Settings and theme | `architecture-map.html` |
| `vesta-launcher/src/stores/resources.ts`, resource browser UI files | Resource Browse Session and Resource Install Intent | `findings.html`, `area-finder.html` |
| Install form, install page, instance details UI files | Instance Draft and instance edit/install UI | `findings.html` |
| `src-tauri/src/main.rs`, `src-tauri/src/setup.rs` | Tauri shell and Startup Orchestrator | `architecture-map.html`, `roadmap.html` |
| `src-tauri/src/commands/instances.rs`, `utils/process_state.rs`, crash/process files | Instance Lifecycle | `findings.html`, sidecar lifecycle notes |
| `src-tauri/src/commands/resources.rs`, `resources/*`, resource watcher files | Resource sources, Resource Manager, Installed Resource Ledger | `findings.html`, `architecture-map.html` |
| `src-tauri/src/tasks/*`, installer tasks, update tasks | Task manager, installers, Modpack Update Engine | `findings.html`, `roadmap.html` |
| `src-tauri/src/sync/*` | Sync Modules | `architecture-map.html`, `findings.html` |
| `src-tauri/src/launcher_import/*` | Launcher Import Lifecycle | `architecture-map.html`, `findings.html` |
| `src-tauri/src/notifications/*` | Notification persistence and action routing | `findings.html` |
| `src-tauri/src/schema/*`, `models/*`, migrations | Persisted models and database knowledge | `architecture-map.html`, `slop-cleanup.html` |
| `crates/piston-lib/src/game/installer/*` | Runtime install and Runtime Preparation | `findings.html`, sidecar runtime notes |
| `crates/piston-lib/src/game/launcher/*` | Runtime launch and process Adapter | `findings.html` |
| `crates/piston-lib/src/unified_manifest.rs`, manifest cache, metadata fetcher | Manifest vocabulary and metadata path | `architecture-map.html`, `slop-cleanup.html` |
| `docs/*`, `README*`, `TESTS.md`, requirements docs | Docs/tests navigability | `slop-cleanup.html`, `roadmap.html` |

## Completion Check

Before finishing a code or docs task in this repo:

- State which architecture area(s) were touched.
- State whether the external atlas was updated.
- If not updated, state why no Module, Interface, seam, Adapter, event, model, task flow, or docs truth changed.
- Include the absolute atlas path when the update is useful for the user:
  `/Users/eatham/Documents/Vesta Architecture Reviews/architecture-atlas-20260708/index.html`
