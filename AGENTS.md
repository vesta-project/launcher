# AGENTS.md — Vesta Launcher

Mandatory rules for coding agents. Humans: see `CONTEXT.md`, `docs/adr/`, and `docs/development/CONTRIBUTING.md`.

If this file conflicts with nearby fat files or habits in `commands/*.rs` / mega-pages, **this file wins**. Prefer extracting into the named Module over growing the fat file.

## Read order (before non-trivial edits)

1. This file
2. `CONTEXT.md` — domain vocabulary and primary Module paths
3. Relevant ADRs under `docs/adr/` (especially 0002, 0003, 0004, 0010 for launch/instance/resources/sandbox)
4. Only then the code under those primary paths

Do **not** invent parallel architecture docs. Stable vocabulary → `CONTEXT.md`. Load-bearing decisions → new/updated ADR. Exploratory atlas stays out of the repo (ADR-0001).

Optional skill: `.agents/skills/vesta-architecture-memory` (external atlas on the maintainer machine; not required for every agent).

## Crate seams (do not cross)

| Crate | Owns | Must not know |
| --- | --- | --- |
| `crates/piston-lib` | Minecraft/runtime install, launch protocol, metadata, auth protocol | Tauri, Diesel, notifications, UI |
| `crates/vesta-sandbox` | OS confinement / `RunPlan` → spawn | piston, Tauri, Diesel |
| `vesta-launcher/src-tauri` | App policy, Diesel, Tauri commands, lifecycle around a running game | Re-implementing piston parser / sandbox OS details |

Dependency direction: **commands → domain Modules → db / piston / sandbox**. Never the reverse.

## Rust / Tauri rules

### Commands are thin Adapters

- `vesta-launcher/src-tauri/src/commands/*.rs` may orchestrate and map errors for IPC.
- They must **not** own Diesel repositories, shared mutators, ZIP/manifest parsing, hashing, or redaction stacks.
- Template: `commands/worlds.rs` → logic in `worlds/`.
- Anti-template: growing `commands/instances.rs`, `commands/modpacks.rs`, `commands/resources.rs`, `commands/app.rs`.

### Where new behavior goes

| Concern | Put it in |
| --- | --- |
| Instance CRUD / install status / icons | `instance/` (e.g. repository + focused modules) — **not** only under `commands/instances.rs` |
| Lifecycle / process reconciliation | `instance/lifecycle.rs` and related |
| Launch adaptation (Java, env, sandbox presets) | `instance/launch_preparation.rs`, `utils/sandbox_policy.rs` |
| Modpack match / cache / install orchestration | `modpack/` consuming `piston-lib` parsers — **do not** re-parse ZIPs in commands |
| Resources / ledger / sources | `resources/` |
| Worlds | `worlds/` |
| Long-running work | `tasks/` implementing the `Task` trait |

If domain code needs `get_instance`, status updates, or icon processing, call an **`instance/` Module API** — do not import `crate::commands::instances` from non-command modules.

### Before adding a helper

Search first: `utils/` (especially `utils/hash.rs`), `piston-lib`, and the owning domain Module. Do **not** add a local `calculate_sha*`, ZIP/`modrinth.index.json` parser, or one-off `normalize_*` / `sanitize_*` if one already exists.

### Errors and persistence

- Prefer structured errors (`anyhow` / shared error types) over new `Result<T, String>` domain APIs.
- Dual DBs stay: `get_vesta_conn` / `get_config_conn` with migrations under `migrations/vesta` and `migrations/config`. Schema lives in `schema/{vesta,config}.rs` (not a single `schema.rs`). Diesel only — ignore stale “rusqlite” mentions in old docs.

### Size budget

If a command or domain file is already huge, **extract** a focused Module rather than appending. Do not use file size as permission to add more of the same kind of logic.

## Frontend rules (`vesta-launcher/`)

### Module homes

| Kind | Home |
| --- | --- |
| Domain types / pure helpers | `src/utils/` (e.g. `Instance` from `@utils/instances`) |
| Global session / persistence signals | `src/stores/` |
| Feature UI | `src/components/pages/...` (+ colocated hooks) |
| Shared primitives | `vesta-launcher/ui/` |
| Catalog-only alias `@resources` | `src/resources/` — **not** the store or utils |

### Forbidden patterns

1. **Dual imports for the same domain**
   - `Instance` and instance helpers: prefer `@utils/instances` for types; do not re-grow parallel type ownership via `@stores/instances`.
   - Resources: do not import both `@stores/resources` and `@utils/resources` in the same file unless you are wiring browse session to pure compatibility helpers — and never duplicate fields or compatibility logic in the page.
2. **Raw `invoke` in pages** under `components/pages/**` — call a store or utils Adapter instead. Add typed wrappers near the domain (prefer a thin `src/ipc/` or per-domain command helper) rather than scattering command strings.
3. **Copy-paste optimistic `update_config_field` / toast `String(e)` blocks** — extend a shared helper; do not clone the settings-store pattern for each new field.
4. **Growing mega-pages** (`instance-details`, `resource-details`, `AccountTab`, `InstallForm`) past necessity — extract section modules / hooks (install feature’s `hooks/` is the model).

### i18n

User-visible strings go through Fluent (`locales/`, `src/localization/`). Do not add new hardcoded English UI strings in areas already on Fluent; prefer Fluent for new UI.

### Tests and gates

- Run relevant checks before finishing: FE `bun run typecheck`, `bun run check`, `bun run test -- --run`; Rust `cargo fmt --check`, `cargo test --workspace --locked` as appropriate.
- Colocate tests with the Module you changed. Do not invent fictional store APIs in docs/tests.

## Docs drift (fix when you touch the area)

Known stale claims to correct when nearby:

- “rusqlite” / single `schema.rs` in `docs/architecture/ARCHITECTURE.md` and `.github/copilot-instructions.md`
- Generic/wrong FE maps in `FRONTEND.md` / `TESTS.md` (Tauri v1 imports, invented stores)
- Missing `vesta-sandbox` in high-level architecture blurbs

## PR expectations for agents

- Prefer deepen-existing-Module over new parallel Module with a similar name.
- Say what Module/ADR you followed in the PR body.
- No drive-by refactors unrelated to the task; targeted extracts to restore the seams above are in scope when the task would otherwise thicken a god file.
- Breaking changes are currently acceptable if documented in the PR (see copilot-instructions).
