# Theming System

## Overview

Vesta uses a theme engine that converts persisted config + optional JSON theme payloads into validated runtime theme values and CSS custom properties.

Current implementation supports:

- Built-in presets and custom themes
- Template and advanced configuration modes
- Gradient harmony (none, analogous, complementary, triadic)
- OS-aware native window effects
- Per-theme custom CSS (sanitized)
- Typed theme variables (`number`, `color`, `boolean`, `select`)

## Architecture

### Theme modules

- `vesta-launcher/src/themes/types.ts`
Defines `ThemeConfig`, `AppThemeConfig`, `ThemeDataPayload`, and variable types.
- `vesta-launcher/src/themes/presets.ts`
Public theme API and registry (`getAllThemes`, `getThemeById`, `configToTheme`, re-exports).
- `vesta-launcher/src/themes/presets/builtin.ts`
Built-in preset definitions.
- `vesta-launcher/src/themes/engine/parser.ts`
Parses `theme_data` JSON and normalizes camel/snake_case keys.
- `vesta-launcher/src/themes/engine/validation.ts`
Validation/clamping, user variable normalization, custom CSS sanitization.
- `vesta-launcher/src/themes/engine/themeToCSSVars.ts`
Maps `ThemeConfig` to CSS variables (palette, gradients, effects, borders).
- `vesta-launcher/src/themes/engine/applier.ts`
Applies CSS variables and data attributes to `:root`, updates custom CSS style tag, dispatches window effect.
- `vesta-launcher/src/themes/engine/effects.ts`
OS hint detection and effect normalization.

### Runtime flow

1. Read persisted config (`AppThemeConfig`) from backend.
2. Parse optional `theme_data` JSON.
3. Merge config + parsed payload + base preset in `configToTheme`.
4. Validate/clamp and sanitize with `validateTheme`.
5. Generate CSS vars with `themeToCSSVars`.
6. Apply to `:root` with `applyTheme`.
7. Set root data attributes (`data-style`, `data-gradient`, `data-window-effect`, etc.).
8. If in Tauri runtime, call `set_window_effect` with normalized effect.

## Backend Theme Fields

Persisted in backend config model (`src-tauri/src/utils/config/mod.rs`):

- `theme_id`
Preset identifier.
- `theme_mode`
Current mode label (currently used as `template` or `advanced`).
- `theme_primary_hue`
Primary hue base.
- `theme_primary_sat`
Optional advanced saturation override.
- `theme_primary_light`
Optional advanced lightness override.
- `theme_style`
`glass`, `satin`, `flat`, `bordered`, `solid`.
- `theme_gradient_enabled`
Enable gradient background path.
- `theme_gradient_angle`
Gradient rotation in degrees.
- `theme_gradient_type`
`linear` or `radial`.
- `theme_gradient_harmony`
`none`, `analogous`, `complementary`, `triadic`.
- `theme_border_width`
Border thickness value.
- `theme_window_effect`
Requested native window effect.
- `theme_background_opacity`
Background tint opacity control.
- `theme_advanced_overrides`
Legacy advanced CSS override string.
- `theme_data`
Optional JSON payload for richer theme metadata and variable data.

## ThemeData JSON (`theme_data`)

Supported keys include:

- identity: `id`, `name`, `author`, `description`
- color/effect: `primaryHue`, `primarySat`, `primaryLight`, `opacity`, `borderWidth`, `backgroundOpacity`
- style/gradient: `style`, `gradientEnabled`, `rotation`, `gradientType`, `gradientHarmony`, `windowEffect`
- css: `customCss`
- variable definitions: `variables`
- variable values: `userVariables`

Parser accepts both camelCase and snake_case aliases (for import compatibility).

## Built-in Presets

Built-ins are defined in `src/themes/presets/builtin.ts`:

- `vesta`
- `solar`
- `neon`
- `classic`
- `forest`
- `sunset`
- `prism`
- `midnight`
- `oldschool`
- `custom`

Presets can lock or allow controls via:

- `allowHueChange`
- `allowStyleChange`
- `allowBorderChange`

## CSS Variables Produced by Theme Engine

`themeToCSSVars` generates runtime variables including:

### Core state

- `--color__primary-hue`
- `--background-opacity`
- `--rotation`
- `--gradient-type`
- `--gradient-enabled`

### Harmony hues

- `--hue-secondary`
- `--hue-accent`

### Palette families

- primary: `--primary-base`, `--primary-hover`, `--primary-active`, `--primary-transparent`, `--primary-low`, `--text-on-primary`
- secondary: `--secondary-base`, `--secondary-hover`, `--secondary-active`, `--secondary-transparent`, `--secondary-low`, `--text-on-secondary`
- accent: `--accent-base`, `--accent-hover`, `--accent-active`, `--accent-transparent`, `--accent-low`, `--text-on-accent`

### Effect and blur controls

- `--effect-opacity`
- `--effect-blur`
- `--liquid-frost-blur`
- `--liquid-backdrop-filter`

### Border controls

- `--border-width-subtle`
- `--border-width-strong`

### Optional advanced overrides

- `--background-color` (set when gradient is disabled)
- `--primary-saturation`
- `--primary-lightness`

### User variables

- `--theme-var-<key>` for each variable key in `variables`/`userVariables`

## Theme Variable System

Theme variables are typed and validated:

- `number`
Clamped to `[min, max]`, optional `step` and `unit`.
- `color`
String value.
- `boolean`
True/false.
- `select`
String constrained to provided `options`.

When applied:

- User-supplied values are normalized against definitions.
- Missing values fall back to variable defaults.
- Final values are emitted as `--theme-var-*` CSS variables.

## Validation and Security

### Value safety

- Hue, saturation, lightness, opacity, rotation, and border width are clamped.
- Unsupported select values are rejected and replaced by defaults.

### Custom CSS sanitization

Custom CSS is blocked if it contains unsafe patterns such as:

- `@import`
- `javascript:`
- `expression(`
- `<script` / `</script`
- `-moz-binding`
- `behavior:`

Rejected CSS resolves to an empty string.

## Window Effects

The requested effect is normalized against current OS support:

- macOS: `none`, `vibrancy`, `liquid_glass`
- Windows: `none`, `mica`, `acrylic`, `blur`
- fallback platforms: `none`

OS hint source order:

1. `document.documentElement[data-os]`
2. `window.__VESTA_OS__`

Applied value is written to `data-window-effect` and sent to backend via `set_window_effect` in Tauri runtime.

## Root Attributes Set by `applyTheme`

Theme application sets or updates:

- `data-theme-id`
- `data-theme-var-keys`
- `data-window-effect`
- `data-gradient`
- `data-style`
- `data-gradient-type`
- `data-theme` (when color scheme is forced)
- `data-bordered` (for bordered mode)
- `data-solid` (for solid mode)

## Notes for Component Authors

- Prefer semantic CSS vars from `src/styles.css` and theme-generated variables.
- Do not hardcode preset IDs in component styling logic when a semantic var can be used.
- For custom per-theme styling, use `customCss` through theme config instead of component-local hardcoded hacks.

## Last Verified Against

- `vesta-launcher/src/themes/*`
- `vesta-launcher/src/themes/engine/*`
- `vesta-launcher/src-tauri/src/utils/config/mod.rs`