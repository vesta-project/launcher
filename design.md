---
name: Vesta Launcher
description: A customizable desktop Minecraft launcher for players and modpack creators.
colors:
  primary-hue: "180"
  primary: "hsl(var(--color__primary-hue) 70% var(--button-lightness))"
  primary-hover: "hsl(var(--color__primary-hue) 70% 55%)"
  secondary: "hsl(var(--hue-secondary) 60% 50%)"
  surface-base: "hsl(var(--color__primary-hue) 10% var(--lightness-surface-base) / var(--effect-opacity))"
  surface-raised: "hsl(var(--color__primary-hue) 15% var(--lightness-surface-raised) / var(--effect-opacity))"
  surface-overlay: "hsl(var(--color__primary-hue) 20% var(--lightness-surface-overlay) / var(--effect-opacity))"
  surface-sunken: "hsl(var(--color__primary-hue) 5% var(--lightness-surface-sunken) / 0.98)"
  text-primary: "hsl(var(--color__primary-hue) 5% var(--lightness-text-primary))"
  text-secondary: "hsl(var(--color__primary-hue) 5% var(--lightness-text-secondary))"
  border-subtle: "hsl(var(--color__primary-hue) 10% var(--lightness-border) / 0.4)"
  success: "hsl(140 60% 50%)"
  warning: "hsl(45 90% 50%)"
  error: "hsl(0 70% 50%)"
  info: "hsl(210 70% 50%)"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Inter, Avenir, Helvetica, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Inter, Avenir, Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Inter, Avenir, Helvetica, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
rounded:
  control: "6px"
  container: "8px"
  window: "12px"
  hero: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.container}"
    padding: "40px"
---

# Design System: Vesta Launcher

## Overview

**Creative North Star: "The Personal Game Command Center"**

Vesta is a polished, approachable desktop workspace for configuring and launching a personal Minecraft setup. Its interface organizes complex player and modpack work into clear, familiar controls while leaving meaningful room for the user to make the app their own.

The default expression is dark-first liquid glass: layered, hue-tinted surfaces over a configurable gradient, with restrained grain adding material texture. Glass and grain are an experimental default, not an inflexible brand rule; the system also supports frosted and fully flat modes, and must remain effective when an operating system makes texture or translucency less appropriate.

**Key Characteristics:**

- Personalization is structural: hue, gradient harmony, material mode, opacity, grain, borders, and window effects are theme inputs.
- Hierarchy comes from surface layering, subtle borders, and selective elevation rather than visual noise.
- The default teal is a balance of calm technical clarity, vibrant game energy, and personal customization.
- Native desktop conditions and accessibility preferences take precedence over decorative effects.

## Colors

Vesta uses a user-selected primary hue—teal (`180`) by default—to generate a coherent interface palette; the secondary hue is derived from the chosen gradient harmony.

### Primary

- **Personal Teal** (`hsl(var(--color__primary-hue) 70% var(--button-lightness))`): Primary actions and configurable accent treatment. Its default hue is teal, but it is intentionally user-adjustable.
- **Active Teal** (`hsl(var(--color__primary-hue) 70% 55%)`): Hover treatment for primary controls.

### Secondary

- **Harmony Accent** (`hsl(var(--hue-secondary) 60% 50%)`): A secondary color generated from the selected harmony; use it in background gradients and supporting accent moments, not as an unrelated fixed brand color.

### Neutral

- **Base Surface** (`hsl(var(--color__primary-hue) 10% var(--lightness-surface-base) / var(--effect-opacity))`): Main translucent workspace layer.
- **Raised Surface** (`hsl(var(--color__primary-hue) 15% var(--lightness-surface-raised) / var(--effect-opacity))`): Cards and elevated regions.
- **Overlay Surface** (`hsl(var(--color__primary-hue) 20% var(--lightness-surface-overlay) / var(--effect-opacity))`): Dialogs and active overlays.
- **Primary Text** (`hsl(var(--color__primary-hue) 5% var(--lightness-text-primary))`): Main readable content.
- **Secondary Text** (`hsl(var(--color__primary-hue) 5% var(--lightness-text-secondary))`): Supporting labels and metadata.

### Semantic

- **Success** (`hsl(140 60% 50%)`), **Warning** (`hsl(45 90% 50%)`), **Error** (`hsl(0 70% 50%)`), and **Info** (`hsl(210 70% 50%)`): Fixed hues reserved for status and feedback.

**The Personal Palette Rule.** Derive new visual color from the active theme variables. Do not hard-code a competing product palette into a component.

## Typography

**Display Font:** System UI stack, up to `2rem` at `700` weight.

**Body Font:** System UI stack, `0.95rem` for standard controls and body copy.

**Label/Mono Font:** System UI at `0.75rem` for compact labels; `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` for technical values.

**Character:** Familiar operating-system typography keeps a customizable interface approachable and readable. Type is functional and compact, with stronger weights reserved for names, headings, and clear actions.

### Hierarchy

- **Display** (`700`, `2rem`): High-emphasis page or feature titles.
- **Heading** (`600–700`, `1.5rem`): Section and dialog titles.
- **Body** (`400–500`, `0.95rem`): Main UI text, controls, and explanatory copy.
- **Supporting text** (`400–500`, `0.9rem`): Secondary controls and metadata.
- **Label** (`600`, `0.75rem`): Dense supporting UI; uppercase and tracking are used selectively for group labels and badges.

## Layout

The launcher shell uses a compact desktop grid: a `64px` sidebar beside the main workspace, with a `32px` title bar above it. Content pages use a `24px` horizontal and bottom gutter, with `960px` and `1200px` maximum content widths for standard and wide layouts.

Spacing follows a `4 / 8 / 12 / 16 / 24 / 32px` rhythm. Keep workflows dense enough to operate quickly without collapsing important labels or state. The app has a `450px` minimum width; responsive work must preserve the desktop operating context rather than simulate a mobile website.

## Elevation & Depth

Vesta is softly layered by default, using translucent tonal surfaces, a fine glass border, backdrop blur, and modest shadows. A small set of elements—dialogs, popovers, floating controls, and hoverable cards—may clearly float when that separation helps a user act or recover context.

### Shadow Vocabulary

- **Soft** (`0 2px 10px hsl(0 0% 0% / 0.18)`): Gentle separation for resting surfaces.
- **Medium** (`0 6px 20px hsl(0 0% 0% / 0.22)`): Hovered cards and raised interactive regions.
- **Strong** (`0 12px 32px hsl(0 0% 0% / 0.3)`): Dialogs and clearly floating layers.

**The Depth-With-Purpose Rule.** Elevation signals hierarchy or interaction; it is not a substitute for structure. In flat mode, preserve the same hierarchy through opaque tonal surfaces and borders.

## Shapes

Controls use `6px` corners, cards and menus generally use `8px`, and macOS window surfaces use `12px`. Hero regions can use `16px`; toggles, badges, and compact status indicators use pill or circular forms. Borders are theme-controlled (`0–6px` inputs, typically `1px`) and stay low-contrast until an active or focused state requires clarity.

## Components

### Buttons

Polished and direct action controls with a compact, reliable desktop footprint.

- **Shape:** `6px` radius; `sm`, `md`, `lg`, `xl`, and icon sizes.
- **Primary:** Theme-derived color with `8px 16px` medium padding.
- **Variants:** Solid, outline, ghost, shadow, and slate use the same semantic color inputs.
- **Hover / Focus:** Hover lifts by `1px`; transitions last `180ms`; keyboard focus uses a `2px` focus outline offset by `2px`.
- **Disabled:** `0.5` opacity, grayscale, and a not-allowed cursor.

### Cards / Containers

Cards use raised theme surfaces, subtle borders, and typically `8px` corners; larger settings cards use generous internal padding. Hoverable cards use medium elevation only when the interaction benefits from a stronger affordance.

### Inputs / Fields

Fields inherit the system type stack and control radius. Their focused state must use the theme focus color and a clearly visible ring or border shift; error and disabled states use the shared semantic and disabled tokens.

### Navigation

The primary desktop shell places navigation in a narrow `64px` sidebar. Active and hover states move through base, raised, and overlay surface tokens rather than introducing a disconnected navigation color system.

### Dialogs and Overlays

Dialogs use the overlay surface, subtle border, rounded container form, and a dark translucent backdrop. They are a clear floating layer with short fade-and-scale entry motion; dialogs should respect the reduced-motion setting.

### Theme Controls

Theme controls expose the product's personalization system: primary hue, gradient type and harmony, glass/frosted/flat material, opacity, grain, border width, and supported window effects. These are not superficial presets; components must continue to consume their semantic variables after a theme change.

## Do's and Don'ts

### Do:

- **Do** use semantic CSS variables so each interface remains coherent under every supported theme.
- **Do** give a surface only the depth it needs: softly layered by default, clearly floating when it is a modal, popover, or important active control.
- **Do** treat flat mode, light mode, reduced motion, and higher-contrast preferences as complete presentations, not degraded fallbacks.
- **Do** keep desktop controls compact, legible, and recognizable before adding decoration.

### Don't:

- **Don't** hard-code decorative colors that bypass the theme engine.
- **Don't** require grain, blur, or a particular window effect for hierarchy or readability.
- **Don't** add elevation, gradients, or animation merely to make an otherwise unclear control feel interactive.
- **Don't** let personalization make text contrast, focus visibility, or semantic status ambiguous.
