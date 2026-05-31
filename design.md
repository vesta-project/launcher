# Vesta Launcher — Design System

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SolidJS 1.9 |
| Meta-framework | Vite 7 |
| Desktop | Tauri 2 (Rust) |
| Routing | @solidjs/router |
| UI Primitives | @kobalte/core |
| Styling | CSS Modules + CSS Custom Properties |
| Color Utils | chroma-js |
| 3D Rendering | skinview3d + three.js |
| Testing | vitest + @solidjs/testing-library |

---

## Theming Architecture

Dynamic CSS variable engine. Theme config → `themeToCSSVars()` → inline styles on `<html>` → CSS modules consume `var(--token)`.

**Built-in presets:** Vesta (teal), Solar (warm orange), Neon (electric pink), Classic (clean), Forest (green), Sunset (purple-orange), Midnight (ultra-dark), Old School, Custom.

**User customization:** Primary hue, style mode, opacity, grain, gradient rotation & harmony, border thickness, window effect, custom CSS injection.

---

## Style Modes

| Mode | Opacity | Backdrop | Use case |
|---|---|---|---|
| `glass` | 0.5–1.0 | `blur(16px) saturate(1.45)` | Default — vibrant frosted glass |
| `frosted` | 0.64–0.88 | `blur(22px) saturate(1.09)` | Softer, more obscured |
| `flat` | 1.0 | none | Solid opaque, max contrast |

---

## Color Palette (Dark Mode Default)

All colors derive from a configurable `--color__primary-hue` (default **180 / teal**). Secondary hue calculated via gradient harmony (default: complementary = +180).

### Surfaces (semi-transparent)
| Token | Value |
|---|---|
| `--surface-base` | `hsl(hue 10% 12% / 0.8)` |
| `--surface-raised` | `hsl(hue 15% 18% / 0.8)` |
| `--surface-overlay` | `hsl(hue 20% 20% / 0.8)` |
| `--surface-sunken` | `hsl(hue 5% 8% / 0.98)` |

### Text
| Token | Value |
|---|---|
| `--text-primary` | `hsl(hue 5% 90%)` |
| `--text-secondary` | `hsl(hue 5% 70%)` |
| `--text-tertiary` | `hsl(hue 5% 50%)` |
| `--text-inverse` | `hsl(hue 5% 10%)` |

### Interactive / Accent
| Token | Value |
|---|---|
| `--accent-primary` | `hsl(--color__primary-hue 70% 35%)` |
| `--interactive-base` | `hsl(hue 60% 50%)` |
| `--interactive-hover` | `hsl(hue 70% 55%)` |
| `--interactive-active` | `hsl(hue 80% 60%)` |

### Semantic
| Token | Hue |
|---|---|
| Success | 140 (green) |
| Warning | 45 (amber) |
| Error | 0 (red) |
| Info | 210 (blue) |

### Borders
| Token | Value |
|---|---|
| `--border-subtle` | `hsl(hue 10% 30% / 0.4)` |
| `--border-strong` | `hsl(hue 20% 30% / 0.7)` |
| `--border-focus` | `hsl(hue 70% 50% / 0.8)` |

### Shadows
| Token | Value |
|---|---|
| `--elevation-soft` | `0 2px 10px hsl(0 0% 0% / 0.18)` |
| `--elevation-medium` | `0 6px 20px hsl(0 0% 0% / 0.22)` |
| `--elevation-strong` | `0 12px 32px hsl(0 0% 0% / 0.3)` |

### Icons
| Token | Value |
|---|---|
| `--icon-primary` | `hsl(hue 5% 90%)` |
| `--icon-secondary` | `hsl(hue 5% 70%)` |
| `--icon-muted` | `hsl(hue 5% 50%)` |

---

## Typography

**Font stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", Inter, Avenir, Helvetica, sans-serif`

**Mono:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### Sizing
| Token | Size | Usage |
|---|---|---|
| `--font-xxsmall` | 0.75rem (12px) | Labels, timestamps |
| `--font-xsmall` | 0.85rem (13.6px) | Secondary text, dropdown items |
| `--font-small` | 1rem (16px) | Body, card titles |
| `--font-medium` | 1.25rem (20px) | Section headings |
| `--font-large` | 2rem (32px) | Large headings |
| `--font-xlarge` | 4rem (64px) | Hero/display text |

### Weights
- **400–500:** Body, tab labels
- **600:** Dialog titles, section headers
- **700–800:** Brand, card names, badge text

### Rendering
```css
font-synthesis: none;
text-rendering: optimizeLegibility;
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

---

## Spacing

Consistent `rem` rhythm: 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 (4–32px).

| Context | Gap |
|---|---|
| Instance grid | 20px |
| Button padding (md) | 8px 16px |
| Dialog padding | 24px |
| Dropdown items | 0 12px, height 32px |
| Select trigger | min-height 40px, padding 0 12px |
| Card padding | 40px |

---

## Border Radius

| Radius | Used for |
|---|---|
| 9999px / 50% | Switches, pills, badges, avatars |
| 12px | Window corners (macOS), Driver.js popovers |
| 8px | Instance cards, dropdown menus, context menus |
| 6px | Buttons, selects, text fields, checkboxes, tabs, badges |
| 4px | Dropdown items, select items |
| 3px | Scrollbar thumb |

---

## Border Widths (themed)

| Token | Default |
|---|---|
| `--border-width-subtle` | 1px |
| `--border-width-strong` | `min(6, borderWidth + 1)px` |
| `--button-border-width` | `max(1, borderWidth)px` |

Configurable 0–6px.

---

## Transitions & Animation

| Element | Duration | Easing |
|---|---|---|
| Buttons (bg, border, color, transform) | 180ms | ease |
| Cards (shadow, transform) | 150–180ms | cubic-bezier(0.4, 1, 0.7, 1) |
| Dialogs (fade + scale) | 200ms | ease-out |
| Dropdowns / selects / tooltips | 200ms | ease |
| Switches (thumb slide) | 180ms | ease-in-out |
| Checkboxes (bg, border, color) | 150ms | ease |
| Tabs (active indicator) | 200ms | cubic-bezier(0.4, 0, 0.2, 1) |
| Theme transitions (preset switch) | 140ms | — |

**Reduced motion:** Supported via `prefers-reduced-motion` and `[data-reduced-motion="true"]`.

---

## Focus Styles

```css
:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
```
Inputs get a `3px` ring via `box-shadow` + border color shift.

---

## Liquid Glass System

Distinctive visual effect composed of:
- **Backdrop blur** — variable blur + saturation
- **Grain texture** — SVG `<feTurbulence>` fractal noise overlay
- **Inner shadow** — subtle inset glow via `color-mix` with `--primary-low`
- **Glass border** — `1px` `var(--border-glass)`
- **Utility classes:** `.liquid-glass`, `.grain-overlay`

---

## Background System

| Feature | Description |
|---|---|
| Solid bg | `--app-background-tint-with-opacity` overlay |
| Linear gradient (default) | 3 stops (hue, primary, secondary) at configurable rotation |
| Radial gradient | `[data-gradient-type="radial"]` farthest-corner |
| Window effects | Mica (Win11), Acrylic (Win10), Vibrancy (macOS), Blur, Transparent |
| Gradient harmonies | none, analogous (±30), complementary (+180), triadic (+120, +240) |

---

## Z-Index Hierarchy

| Token | Value |
|---|---|
| `--z-sidebar` | 200 |
| `--z-floating-action` | 190 |
| `--z-modal` | 2000 |
| `--z-toast` | 9999 |
| `--z-loader` | 9999 |
| `--z-popover` | 10000 |
| `--z-select-dropdown` | 10001 |

---

## Layout Grid (Home)

```
grid-template-columns: 64px 1fr
grid-template-rows: 32px 1fr
```

- **Column 1:** Sidebar (64px)
- **Column 2:** Main content
- **Row 1:** Titlebar (32px)
- **Row 2:** Content area

---

## Component Patterns

### Button
- Props: `color` (none/primary/secondary/destructive/warning), `variant` (solid/outline/ghost/shadow/slate), `size` (sm/md/lg/xl/icon)
- Hover: `translateY(-1px)`
- Disabled: `opacity: 0.5`, `cursor: not-allowed`, `filter: grayscale(50%)`

### Dialog
- Overlay: `hsl(0 0% 0% / 0.6)` + backdrop blur
- Content: centered, `max-width: 32rem`, glass bg, `border-radius: 0.5rem`
- Enter: fade-in + `scale(0.96 → 1)`

### Switch
- Track: 44×24px, `border-radius: 9999px`
- Thumb: 18×18px pill

### Select
- Trigger: `min-height: 40px`, `border-radius: 6px`
- Dropdown: glass, `box-shadow: 0 4px 12px rgba(0,0,0,0.4)`

### Tabs
- List: `--surface-base` bg, `border-radius: 8px`, `gap: 4px`
- Active: `--surface-overlay` bg + elevation shadow
- Sliding indicator: animated 200ms

### Dropdown Menu
- Glass backdrop
- Items: 32px height, `border-radius: 4px`
- Highlighted: `--accent-primary` bg
- Group labels: uppercase, 0.75rem, 600 weight, 0.05em letter-spacing

### Toast
- Fixed bottom-left, 400px wide
- Animated slide-in from left
- Severity-based coloring (error/warning/success/info)

### Badge
- Tiny variant: 0.7rem, 800 weight, uppercase, 0.05em letter-spacing
- Pill variant: `border-radius: 99px`, normal case
- Variants: default, secondary, outline, success, warning, error, info, accent, surface, theme

---

## Accessibility

- `:focus-visible` outlines on all interactive elements
- Dynamic text-on-primary contrast check via chroma-js (min 4.5:1)
- Reduced motion: `prefers-reduced-motion` + `[data-reduced-motion="true"]`
- High contrast: `prefers-contrast: more` adjusts text lightness and border opacity
- Screen reader: hidden native inputs, `aria-label` on icon buttons, `aria-busy`, `aria-pressed`
- `user-select: none` globally with opt-in `.selectable` class

---

## Aesthetic Summary

**"Modern Liquid Glass"** — Sleek, translucent glass-morphism with hue-based personalization. Dark-first with complete light mode. Grain texture adds tactile richness. Three material modes (glass/frosted/flat) shift from vibrant translucency to solid flat. OS-native window integration (Vibrancy on macOS, Mica on Windows 11).
