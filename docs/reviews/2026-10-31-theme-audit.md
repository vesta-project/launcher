# Theme audit — 2026-10-31

Scope: `apps/desktop-solid/src` and `ui`, Windows 2000 contract-1 theme, branch `triage2/terra` from `65e3c9a9`.

## Theme surface

- `ui/foundation/tokens.css` supplies complete UI defaults. `src/styles/tokens/{palette,semantic,brand}.css` maps launcher palettes onto those roles. Both schemes inherit the shared geometry, typography and media defaults.
- The cascade is reset ? UI ? launcher ? theme ? preferences. `theme-runtime.ts` emits generated values in `theme.generated`, then applies native-validated imported CSS in `theme.author`. Imports supply a base mode/material/hue/translucency/grain/gradient/border configuration. Portals use the document root's theme.
- Authors can override semantic `--vesta-color-*`, fonts, radii, border/focus widths, shadows and component custom properties. Public `data-vesta` parts, state attributes (`data-tone`, `data-status`, `data-source`, checked/disabled/selected attributes), and root scheme/material hooks support component-specific rules. Rust `author_css.rs` validates selectors, declarations, functions, system fonts and resource-free variable references; uploads cannot use arbitrary resources or `!important`.
- The Windows 2000 story stylesheet is the source; `bun scripts/classic-theme.mjs` regenerates both `examples/windows-2000.css` and `.vestatheme`.

## Fixed leaks

| Area / files under `apps/desktop-solid` | Fix |
| --- | --- |
| `src/features/instances/instance-card.css`, `src/pages/library/library-page.css` | Card/folder borders, scrims, ink, gradients, state washes and shadows use shared semantic/media roles. Card actions use accent/on-accent. |
| `src/pages/library/instance/{instance-header,instance-page,overview-tab,resources-tab,versions-tab,settings-tab}.css` | Header artwork and screenshot overlays use the media contrast pair. Category/source badges use the theme accent; tabs, indicators, borders and popup shadows use existing geometry/elevation roles. |
| `src/pages/browse/project/{project,rich-text}.css` | Banner ink/scrims, source switches, icon borders/shadows and inline-code/tab corners follow tokens. Source badges on artwork use solid accent/on-accent to remain readable in classic light mode. |
| `src/pages/servers/{servers,server-settings}.css` | Online/problem/offline/sleep status, success/error callouts, invalid inputs and blocking notices use semantic colours. Artwork labels/status marks use media ink. MOTD preview/editor canvases, caret and framing use media/geometry tokens; formatted Minecraft text remains content. Console/code fonts use `--vesta-font-mono`. |
| `src/pages/servers/tabs/{automation-tab,files-tab}.css`, `src/pages/servers/pack/modpack.css`, `src/pages/servers/hosting/{java-panel,world-section}.css` | Automation output/grips, file status badges, MOTD previews, pack source badges/overlays, warning fallbacks and world masking use existing roles. Private tab corners and fixed border widths now follow theme geometry. |
| `src/features/accounts/{account-menu,account-login}.css`, `src/app/{rail,status/status-pill}.css` | Profile borders, fallback artwork, avatar corners/shadows, rail framing and activity-icon contrast follow tokens. |
| `src/pages/settings/{parts,sections/about,sections/account,sections/appearance,sections/java,sections/sandbox}.css` | Avatar/logo/keycap corners, shadows, preview decoration, Java framing and preset highlights follow tokens. The hue editor retains its actual spectrum. |
| `src/components/{icon,log-view}.css`, `src/pages/create/create-page.css`, `src/pages/welcome/{welcome.css,intro-steps.tsx}` | Provider branding uses overridable brand roles, including TSX inline colour values. Create sections and log separators use border tokens; decorative corners follow radius tokens. |
| `ui/components/{icon-picker,image-viewer}` | Image overlay backgrounds, controls, ink, shadows and borders use media/semantic tokens. |
| `ui/components/skeleton/{skeleton.tsx,skeleton.css}` | Kobalte's inline numeric radius bypassed theme CSS. Preferred numeric radii now scale with `--vesta-radius-factor`, while `--skeleton-radius` remains the override hook. Avatar circles retain their shape. |

New shared roles are only `--vesta-color-media-text`, `--vesta-color-media-shade` and `--vesta-shadow-text`: artwork needs a light/dark contrast pair independent of the page scheme. They have shared light/dark UI defaults and explicit classic values. Existing provider-brand hooks now have token-file defaults and classic values. Windows 2000 also explicitly removes normal elevation shadows and supplies semantic warning/success fills plus its mono font.

## Retained literals and guard

`checks/theme-tokens.test.js` scans all component CSS under `src`/`ui`, including nested colour functions, hex, named endpoints and literal fallbacks. Token definitions and authored theme fixtures own literals. Seven narrowly enumerated exception groups cover user-selected folder colours, project artwork fallback hues, storage segment channel hooks, software/dimension illustrations and the hue editor spectrum. No component file is wholly exempted; unused exception expressions also fail. Theme-relative colour formulas remain allowed.

The TSX search found provider-credit colours (fixed) and Minecraft MOTD formatting colours (intentional protocol/content values). Images, illustration colours, selected folder hues, the hue spectrum, and circular status/spinner/avatar shapes retain their meaning rather than becoming launcher surface colours.

## Browser evidence

102 PNGs (51 before/after pairs) are in `V:/tmp/triage2/theme/`, named `before-*.png` / `after-*.png`. Captures use installed Playwright with Chrome, 1280×860, light scheme, guest browser fixtures, `vesta.fixtures.modpack=linked,overrides`, and injected `examples/windows-2000.css`, matching the earlier design capture method. First-time backup setup uses `vesta.fixtures.backups=off`.

Visited library; all standard instance tabs and settings; Browse description/versions; all launcher settings; server catalogue; all eight server main tabs; server/client pack overview/content/files/versions; all nine server settings sections; create instance; export; install review; backup profile editing and first-time setup. Primary before images were captured before edits; supplemental before images replay the base revision's component/theme CSS. `capture.cjs` and `capture-extra.cjs` beside the PNGs preserve the capture procedures; run from `apps/desktop-solid` with the dev server on port 1453. No native export/install/backup operation was submitted.

Reviewed representative library, server pack/game settings, resource versions, create and export images for readability. Existing `runThemeSurfaces()` browser checks pass for normal light/dark contrast, classic surfaces, live radius overrides, highlighted links and folder hue updates. Added `checks/theme-skeleton.browser.tsx` verifies explicit loading radii at factors 1 and 0 and the component override hook.

## Validation

- `bun run typecheck`: pass.
- `bun run build`: pass; existing large-chunk advisory remains.
- `bun test` over `checks/servers-*.test.js`, `checks/browse-*.test.js`, `checks/ui-alignment.test.js`, `checks/theme-tokens.test.js`: **492 pass, 0 fail** across two groups (483 + 9), with the timing-sensitive `servers-reactivity.test.js` isolated. Results are recorded in `V:/tmp/triage2/theme/validation-tests.txt` and `validation-reactivity.txt`.
- Two aggregate runs hit the unchanged console reactivity test's 8 ms timing budget (8.1 ms and 8.4 ms), including one without browser capture. Its isolated suite passed without changes; no diagnostic or budget was suppressed. Aggregate failure logs are retained as `validation-timing-run.txt` and `validation-aggregate-repeat.txt`.
