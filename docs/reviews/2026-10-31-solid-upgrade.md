# Solid upgrade review — 2026-10-31

The desktop manifest specifies Solid, web and diagnostics ^2.0.0-rc.14; the desktop lock resolves all three to rc.15. Upgrade together to rc.20. The Solid Vite plugin resolves 3.0.0-next.50 (manifest ^next.48); target next.54. The Solid 2 props primitive is 4.0.0-next.3; target next.5. Kobalte is 2.0.0-alpha.2, patched locally; alpha.4 exists but pins Solid rc.16 exactly, so evaluate its patch and peer compatibility before upgrading. The old vite-plugin-solid and babel-preset-solid are not direct dependencies: this application uses @solidjs/vite-plugin and its @solidjs/compiler/babel-plugin dependencies. Root Solid integrations include @niobrix/solidjs-skinview3d and @tauri-controls-v2/solid; their compatibility should be checked separately.

## Release changes and impact

- RC.16 removes experimental server-component binding slots and makes a derived-store seed a complete value. Search for BindingSlot, SlotOutput, SlotError and derived stores before relying on those APIs; this client-rendered Tauri app does not use server-component binding slots. Existing two-argument effects already follow the Solid 2 signature (e.g. src/app/preferences.ts); this is not a new rc.15?20 change.
- RC.17 runs remaining cleanups even when one throws and warns in development when a bound form property overwrites an uncommitted edit. Effects rerun their callback even if the computed result is equal. Inspect input bindings and cleanups in interactive testing.
- RC.18 changes serialization failure handling and synchronously dispatched event diagnostic context. RC.19 rejects asynchronously computed JSX during SSR hydration, and fixes Repeat double creation; RC.20 changes shallow-store list diffing and hydration. These are mainly SSR or reactive behavior changes; fragments (`<>` in workbench/kit.tsx and browse-page.tsx) and lists are used, so verify UI behavior. No server rendering is configured here.
- The existing Kobalte patch changes one-argument effects and opts collection signals into `ownedWrite` during cleanup; ui/internal/props.ts also handles Solid 2 ref arrays. Preserve these workarounds unless verified upstream. ui/components/breadcrumb/breadcrumb.tsx documents explicit undefined merge behavior; ui/components/slider/slider.tsx works around alpha slider dragging.

Review sources: [Solid releases](https://github.com/solidjs/solid/releases), [Solid 2 RC announcement](https://github.com/solidjs/solid/discussions/2995), [Vite plugin releases](https://github.com/solidjs/solid-meta/releases), [Solid primitives releases](https://github.com/solidjs-community/solid-primitives/releases), [Kobalte releases](https://github.com/kobaltedev/kobalte/releases). RCs remain prereleases; validate runtime interactions as well as compilation.

## Follow-ups

TypeScript 7 is a major upgrade from 5.9 and needs a separate migration. Root @types/node 26 is a major from 25. Kobalte alpha updates need local patch and exact peer compatibility verification.
