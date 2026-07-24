# ADR-0005: Keep Localization Catalogs With The Launcher

Date: 2026-07-24

Status: Accepted

## Context

The SolidJS frontend and the Tauri host both present user-facing text. Crowdin
needs a repository integration for source uploads and translation pull
requests. A separate translations repository would decouple catalog changes
from the code and release that consumes them, and would require a second
synchronization or packaging step.

## Decision

Source and translated Fluent catalogs live in
`vesta-launcher/locales/` in the launcher repository. The frontend and Tauri
host consume the same catalog tree through runtime-specific Fluent libraries.

Crowdin connects to this repository in source-and-translation-files mode using
the root `crowdin.yml`. Crowdin owns translated catalog content after the
initial import and returns it through reviewable service-branch pull requests.
It never commits directly to the release branch.

`locales/manifest.json` is the release gate for a locale. A catalog may be
present while disabled; setting `enabled` to `true` exposes it to the launcher.
English remains the source and final fallback locale.

## Consequences

Every launcher revision contains the exact source and translated catalogs used
by its frontend and native shell. Translation pull requests run the same checks
as code changes and can be reverted atomically.

Crowdin service branches contain generated translation changes, so maintainers
should not hand-edit translated catalogs after Crowdin becomes their source of
truth. Large translation-only updates remain visible in the main repository,
but they do not require a separate dependency, submodule, or release pipeline.

## Related

- Domain vocabulary: `CONTEXT.md`
- Runtime guide: `docs/development/LOCALIZATION.md`
- Frontend Module: `vesta-launcher/src/localization/`
- Tauri Module: `vesta-launcher/src-tauri/src/localization/`
- Catalogs: `vesta-launcher/locales/`
