# Shell material system and titlebar/sidebar merge

Status: proposal (design first, not yet implemented). For review before any code changes.
Scope: `apps/desktop-solid` (SolidJS 2 + Tauri) plus the shared native crate `vesta-launcher/src-tauri`.
Mock: `V:/tmp/round8/shell/mock.html` (open with `#dark-mica-library`, `#dark-mica-settings`,
`#light-mica-library`, `#dark-mica-library-inactive`, `#dark-mica-library-split`, `#light-mica-settings-split`,
`#dark-none-library`). Screenshots for those states are saved next to it as `*.png`.

The user raised two problems:

- **A.** Window effects (Mica, Acrylic, blur, transparent) can't be seen. In the old launcher the library's
  instance wrapper was mostly see-through, so the effect felt like part of the background. Normal pages were
  more solid, and the effect showed only around the edges.
- **B.** On Windows the sidebar (rail) and titlebar should merge again. The profile picture and buttons move up
  into the titlebar, so the two read as one connected piece. When the two have different colours, the junction
  has to blend: the titlebar keeps its colour and the rail keeps a clear separation of its own.

The two problems are the same problem: **the shell has no single idea of "frame" and "content".** Right
now the
titlebar, the rail, the canvas and the board are four painted layers stacked on top of each other, with
borders between them. Both the invisible effect and the disconnected chrome come from that.

---

## 0. What exists today (findings)

| Area | Where | What it does |
|---|---|---|
| Effect preference | `src/features/settings/window-effects.ts` | Reads `theme_window_effect` and calls `set_window_effect`. On success it publishes `data-vesta-window-effect` on `<html>`. Capabilities come from `get_window_effect_capabilities`. |
| Native apply | `vesta-launcher/src-tauri/src/commands/app.rs` `set_window_effect` | Windows: `window-vibrancy` 0.7.1. Mica is applied as `apply_mica(Some(true))`, which is **always dark**. Acrylic and blur use a fixed tint `(18,18,18,125)`. Acrylic extends the DWM frame by `-1`. macOS: `HudWindow` vibrancy or liquid glass. |
| Capabilities | `vesta-launcher/src-tauri/src/utils/window_effects.rs` | Win11: none, transparent, acrylic and mica, plus blur on builds below 22621. Win10: none, transparent, blur and acrylic. macOS: none, transparent and vibrancy, plus liquid_glass on 26+. Linux: none and transparent. |
| Window | `vesta-launcher/src-tauri/src/startup/shell.rs` | `transparent(true)` and `decorations(false)`. On macOS: overlay titlebar with native traffic lights. **On every platform except Windows: `background_color(20,20,20,255)`, which is opaque.** |
| Opacity math | `src/features/settings/theme-model.ts` `resolveThemeTokens` | `canvas`, `chrome`, `panel` and `overlay` opacities come from material and translucency only. **The effect type plays no part.** |
| Tokens | `src/styles/tokens/semantic.css`, `src/features/settings/theme-runtime.css` | `--vesta-color-canvas-fill`, `-chrome` and `-panel` all use `color-mix(... var(--vesta-theme-*-opacity))`. |
| Shell | `src/app/shell.tsx/.css` | The titlebar is a full-width row. Below it, `shell-body` holds the rail and the scene. The shell paints the canvas plus the theme background. |
| Titlebar | `src/app/titlebar.tsx/.css` | 32px tall with `border-block-end`. Grid of start (back and destination menu), centre (breadcrumb) and end (status, update, inbox, compact add and account, window controls). Small rounded ghost `IconButton`s act as min, max and close. |
| Rail | `src/app/rail.tsx/.css` | 64px wide with `border-inline-end`. Holds the account at the top, then nav, pins and settings. |
| Board | `src/components/board.css` | `board-frame` has a 16px inset on all sides, filled with `--vesta-color-panel`. Every page renders a `<Board>`. Some pages override `--board-bg`: the instance page uses `chrome`, the project page uses `surface`. |
| Old launcher | `vesta-launcher/src/components/pages/home/*.module.css`, `page-root/titlebar/titlebar.module.css` | Grid `64px 1fr / 32px 1fr`. The sidebar spans both rows and the titlebar starts after it (`.titlebar--right` with a gradient that fades in from transparent). `.instance-wrapper` is `hsl(0 0% 30% / 20%)`, which is very see-through. |

### Why the effect is unnoticeable (root causes)

1. **Stacked alpha.** At the defaults (glass material, translucency 60) the shell paints the canvas at 52%.
   The titlebar and rail paint chrome at 72% *on top of it*, and the board paints its panel at 87% on top of
   the canvas. Effective coverage over the native effect works out to:
   titlebar and rail = 1 − 0.48 × 0.28 = **87%**; board = 1 − 0.48 × 0.13 = **94%**; the 16px gutter = 52%.
   So the only place the effect is clearly visible is a 16px moat around the board.
2. **Mica forced to dark.** `apply_mica(Some(true))` sets `DWMWA_USE_IMMERSIVE_DARK_MODE` on every time. With a
   light scheme, dark Mica sits under a light tint and turns grey. Acrylic on Win11 22H2+ is
   `DWMSBT_TRANSIENTWINDOW`, which **ignores the tint colour** and follows the immersive-dark attribute. That
   attribute is never set for acrylic, so acrylic is light or dark depending on which effect happened to run
   last.
3. **Mica is subtle by design**, and Mica Alt (`DWMSBT_TABBEDWINDOW`, `window_vibrancy::apply_tabbed`) is the
   stronger variant Microsoft intends for apps whose content reaches into the titlebar. That is exactly the
   layout B asks for.
4. **Non-Windows hosts get an opaque webview background** (`background_color(20,20,20,255)`), so vibrancy on
   macOS and "transparent" on Linux most likely can't show through at all. This needs checking on real hardware.
5. The frontend default `theme_window_effect: "none"` (`config.ts`) disagrees with the native default (`mica`
   on Win11). This is minor, but worth deciding on purpose.

---

## A. Material system

### A1. Principle: one translucent layer per pixel, and tiers defined by *effective* coverage

Each pixel has exactly **one** layer that we tune against the native effect. Tokens state the target
**effective coverage** C, meaning how much of our tint covers the effect. When a layer has to sit on top of
another translucent layer, its own alpha is *derived* from the target:
`a_layer = 1 − (1 − C_target) / (1 − a_below)`.
This keeps the numbers people reason about ("the sheet is 94% solid") equal to what actually reaches the
screen.

Tiers, from back to front:

| Tier | What it covers | Intent |
|---|---|---|
| **frame** | Titlebar row, rail column, sheet gutters (right and bottom 8px). One continuous surface painted by the shell. | The effect is clearly visible here. Only short labels and icons sit on it. |
| **showcase** | The library instance grid wrapper (the old "instance wrapper"). Possibly the instance overview hero (open question). | Semi-see-through, so the effect feels like part of the background. Holds **cards only**: no running text directly on it. |
| **sheet** | Every other page body (settings, browse, create, servers, instance tabs). | Mostly solid. The effect is a faint hint. |
| **solid** | Cards, inputs, tables, consoles, project page, log views (existing `--vesta-color-surface*`). | Opaque. Unchanged. |
| **overlay** | Menus, popovers, dialogs, select content. | Near-opaque with its own `backdrop-filter`, as today. |

**Readability rule (hard):** text sits on frame (labels and icons only, protected by contrast floors), on
sheet, or on solid. **Text never sits directly on showcase.** Any heading or toolbar inside a showcase page
sits on a sheet-tier strip. In the library that is the toolbar row, as in the mock.

### A2. Coverage targets per effect and scheme

The translucency slider (`theme_translucency`, 0–100, default 60) stays the **only** control. It moves the
frame and showcase tiers between an opaque-ish ceiling at t=0 and a per-effect **floor** at t=100. The sheet
moves very little. Formula: `C(t) = ceiling − (ceiling − floor) × t/100`, with frame ceiling 90 and showcase
ceiling equal to the sheet value.

| Effect | Scheme | frame floor → @60 | showcase floor → @60 | sheet | overlay | Notes |
|---|---|---|---|---|---|---|
| mica (rendered as Mica Alt) | dark | 28 → **53** | 50 → **67** | 94 | 90 | Mica dark caps luminance, so a low floor is safe. |
| mica | light | 40 → **60** | 58 → **72** | 95 | 92 | |
| acrylic (Win11 transient) | dark | 45 → **63** | 62 → **74** | 95 | 92 | The backdrop is real blurred content, so the floor is higher. |
| acrylic | light | 50 → **66** | 66 → **77** | 96 | 94 | |
| blur / acrylic legacy (Win10, 21H2) | both | 50 → **66** | 66 → **77** | 96 | 94 | The native tint is raised so the OS does part of the readability work (A5). |
| transparent | both | 85 → **87** | 90 → **92** | 100 | 96 | No blur at all: the raw desktop shows through, so content stays opaque. |
| vibrancy (macOS HudWindow) | both | 40 → **60** | 58 → **72** | 95 | 92 | |
| liquid_glass (macOS 26) | both | 35 → **57** | 55 → **70** | 95 | 92 | |
| none, or material = flat | – | 100 | 100 | 100 | 100 | |

How the material setting modifies these:

- **Glass:** uses the table as is.
- **Frosted:** frame and showcase +8. Keeps the existing milky lift, which is also applied to the frame tint.
- **Flat:** forces "none" (the current behaviour, kept).

Grain stays on the frame only.

For comparison, the default frame on Mica dark goes from 87% to 53% effective coverage. That means about
3.6× more of the effect gets through (13% → 47%). The board stays at roughly the same solidity.

### A3. Contrast guarantee

The guarantee is *computed*, not eyeballed. A new pure module, `material-model.ts`, has a unit test. For each
(effect, scheme) pair it assumes a **backdrop luminance envelope** `[Ymin, Ymax]`: the worst the native effect
can show. Starting estimates, to be **measured** (see Verification):

| Effect | Dark envelope (Y) | Light envelope (Y) |
|---|---|---|
| Mica / Mica Alt | 0.00–0.06 | 0.55–0.92 |
| Acrylic (Win11) | 0.00–0.25 | 0.35–0.95 |
| Legacy blur/acrylic with raised tint | 0.00–0.30 | 0.30–0.95 |
| Vibrancy / liquid glass | 0.00–0.25 | 0.35–0.95 |
| Transparent | 0–1 | 0–1 |

The worst-case composite at the floor (t=100) must meet all of the following:

- `--vesta-color-text-muted` on frame: **≥ 4.5:1** (breadcrumb, status pill text).
- Rail and caption icons (`text-muted`) on frame: **≥ 3:1**.
- `text-muted` on sheet: **≥ 4.5:1**, and `text` on sheet ≥ 7:1.
- Showcase carries no text (rule A1). Card titles sit on `surface`, which is opaque.

If a floor fails the test, the floor is raised. Accessibility always beats see-through. Two further cases are
handled the same way:

- **`prefers-reduced-transparency: reduce`** (maps to Windows "Transparency effects: off", and Chromium
  supports it) and **`forced-colors: active`** both resolve every tier to 100%. Same for battery saver, where
  DWM already drops the backdrop.
- **Retro and author themes** (e.g. the `windows-2000` example) that set literal colours on
  `--vesta-color-frame/titlebar/rail/sheet` are opaque on purpose and simply show no effect. That is correct
  for a retro look. The Appearance page already explains this for flat material. The same note should show
  when an author theme pins opaque frame colours, which can be detected by computing alpha at runtime.

### A4. Unfocused window

On Windows, Mica, Mica Alt and acrylic all switch to a solid system fallback when the window is inactive.
Without handling, our partly see-through tint would sit on a flat system grey that doesn't match the theme.

- New root hook: `data-vesta-window-active="true|false"`, driven by `getCurrentWindow().onFocusChanged`.
- Inactive: frame coverage → `min(100, C_frame + 25)`, so the frame converges on our own theme colour rather
  than system grey.
- Inactive: caption and rail icon glyphs → `text-subtle`. The breadcrumb stays `text-muted` so it still passes
  4.5:1. This copies the Windows convention that inactive titlebars dim.
- Sheet, showcase and overlay are unchanged, so content never shifts.
- 200ms transition, done by registering `--vesta-material-frame-alpha` with `@property { syntax: '<percentage>' }`
  so the colour animates. Disabled under reduced motion.
- macOS: `NSVisualEffectView` follows the window's active state by itself. The same hook dims the titlebar
  icons to match.

### A5. Native changes for A

All in `vesta-launcher/src-tauri/src/commands/app.rs`. The crate is shared with the old app, so the change is
additive:

1. `set_window_effect(window, effect, dark: Option<bool>)`. When `dark` is given, set
   `DWMWA_USE_IMMERSIVE_DARK_MODE` **before any backdrop is applied, for every effect including none.** This
   also themes the system menu and resize border. `window-effects.ts` passes the resolved scheme and re-applies
   when the scheme changes.
2. "mica" → `apply_tabbed` (Mica Alt) on build 22621 and later, falling back to `apply_mica` on 22000. There is
   no new user option; the label stays "Mica". Mica Alt is the variant made for content in the titlebar, and it
   carries more wallpaper colour.
3. Legacy acrylic and blur (the SWCA path, Win10 and 21H2): tint per scheme, dark `(18,18,18,170)` and light
   `(243,243,243,150)` instead of the fixed `(18,18,18,125)`.
4. `startup/shell.rs`: stop setting an opaque `background_color` on non-Windows platforms when an effect other
   than none is active (or set alpha 0). This must be checked on macOS and Linux (see risks).
5. Win10 default: the capabilities default should be `blur`, not `acrylic`. `window-vibrancy` documents acrylic
   as laggy on resize and drag on Win10 1903+ and Win11 22000. This is an open question.
6. Linux: advertise only `none` unless a compositor with a transparent visual is detected. When only `none` is
   supported, the Appearance page hides the effect row instead of showing a single-option select. That is one
   less dead control.

### A6. Tokens

Resolver outputs (`theme-model.ts` → new `src/features/settings/material-model.ts`, a pure function of
`{ theme, effect, scheme, active }`):

| Token | Meaning |
|---|---|
| `--vesta-material-frame-alpha` | Frame layer alpha. It is painted directly on the effect, so it equals the coverage. |
| `--vesta-material-sheet-alpha` | Sheet layer alpha, *derived* over the frame. |
| `--vesta-material-showcase-alpha` | Showcase layer alpha, derived over the frame. |
| `--vesta-material-overlay-alpha` | Rename of `--vesta-theme-overlay-opacity`. |
| `--vesta-material-overlay-blur` | Rename of `--vesta-theme-overlay-blur`. |
| `--vesta-material-frame-alpha-inactive` | Frame coverage when the window is unfocused. |

Semantic tokens (`src/styles/tokens/semantic.css`). These are a public theme contract, so author themes may
override them:

| Token | Default |
|---|---|
| `--vesta-color-frame` | Opaque base: today's chrome mix (neutral-2 + 5% accent, or neutral-4 in light). |
| `--vesta-color-frame-fill` | `frame` at `--vesta-material-frame-alpha` (or the inactive alpha when unfocused). |
| `--vesta-color-titlebar` | `var(--vesta-color-frame-fill)` |
| `--vesta-color-rail` | `var(--vesta-color-frame-fill)` |
| `--vesta-color-sheet` | Opaque base: today's panel mix. |
| `--vesta-color-sheet-fill` | `sheet` at `--vesta-material-sheet-alpha`. |
| `--vesta-color-showcase-fill` | `sheet` at `--vesta-material-showcase-alpha`. |
| `--vesta-sheet-edge` | 1px hairline: `text` at 8% in dark, 9% in light. |
| `--vesta-sheet-shadow` | Contact shadow: `0 1px 3px` plus a 0.5px outer line. The theme `shadows: none` resolves it to the edge only. |
| `--vesta-sheet-radius` | `var(--vesta-radius-container)` |
| `--vesta-sheet-gutter` | 8px |
| `--vesta-color-caption-close` | The platform close-hover red (`#c42b1c`). A token so that `theme-tokens.test.js` stays literal-free in components. |

Changed or removed:

- `--vesta-color-chrome` → becomes an alias of `--vesta-color-frame-fill`. Author themes that set `chrome`
  keep working, because `titlebar` and `rail` fall back to `chrome` when an author sets it.
- `--vesta-color-panel` → alias of `--vesta-color-sheet-fill`.
- `--vesta-color-canvas-fill` and `--vesta-canvas-alpha` → no longer painted as a layer when an effect is on.
  The canvas only exists under effect `none`, where it equals the frame.
- `--vesta-theme-{canvas,chrome,panel,overlay}-opacity` → still emitted for one release as derived aliases
  (deprecated) so imported author themes don't break.

Root hooks: the existing `data-vesta-window-effect` stays. New ones are `data-vesta-window-active`,
`data-vesta-window-maximized` and `data-vesta-platform`. The platform hook moves up from the titlebar so the
shell, rail and board can read it.

---

## B. Titlebar + rail merge

Constraints every concept must respect:

- Windows caption buttons sit in the top-right corner (Fitts's law when the window is maximised).
- macOS traffic lights sit in the top-left corner, roughly 78×32.
- Drag regions use `data-tauri-drag-region="deep"`; interactive elements opt out.
- The narrow layout (container under 640px) hides the rail.
- View transitions keep the chrome still.

### Concept 1: "One frame, one sheet" (L-frame + inset content sheet), recommended

The titlebar and rail are **not surfaces at all**. They are regions of a single frame painted once by the
shell. All content sits on one rounded **sheet** that tucks into the corner of the L. The sheet's edge
(hairline plus contact shadow) is the *only* separation line in the shell. The account avatar moves up into
the titlebar row, directly above the rail column.

```
x 0      64                                                     W-138      W
  ┌──────┬────────────────────────────────────────────────────┬────┬────┬────┐
  │ [av] │ ‹  Library › Fabulously Optimized       ● Running  🔔│ —  │ ▢  │ ✕  │ 40px, frame
  │      ╭──────────────────────────────────────────────────────────────╮    │
  │  ▦   │ Library                         [Search……]  [New instance]  │    │ toolbar strip = sheet tier
  │  ⌕   │──────────────────────────────────────────────────────────────│    │
  │  ＋  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                                  │    │ showcase tier (library)
  │ ──── │  │card│ │card│ │card│ │card│                                  │    │
  │ [p1] │  └────┘ └────┘ └────┘ └────┘                                  │    │
  │ [p2] │                                                              │ 8px│
  │  ⚙   ╰──────────────────────────────────────────────────────────────╯    │
  └──────────────────────────── 8px gutter (frame) ─────────────────────────┘
```

- **Geometry:**
  - The titlebar row is 40px (up from 32).
  - The sheet starts at `(rail-width, titlebar-height)`. Its inset is 0 at top and left and 8px at right and
    bottom. All four corners use `--vesta-sheet-radius`.
  - The top-left corner is the "hinge": the frame flows around it, so the titlebar and rail read as one
    L-shaped piece.
  - The back button's left edge lines up with the sheet's left edge, so the titlebar content reads as the
    sheet's header line.
- **Distinct colours** (author theme, or a future preset sets `--vesta-color-titlebar` ≠ `--vesta-color-rail`;
  see `#dark-mica-library-split` and `#light-mica-settings-split`):
  - The titlebar colour runs the full width of the top row, including the avatar cell, so **the titlebar keeps
    its colour**.
  - In the rail column only, a 48px vertical gradient below the row turns the titlebar colour into the rail
    colour. There is no horizontal seam line in the rail column, and the avatar sits on titlebar colour.
  - Across the content width, the titlebar's lower boundary is the sheet's top edge. That gives a crisp
    separation exactly where it matters, while the rail gets its **own distinct separation** from content
    along the sheet's left edge.
  - The concave corner of the sheet sits precisely where the two colours meet, so the blend is hidden in the
    fillet.
- **Materials (A):** this is the natural fit. The frame tier covers the L plus the gutters, so the effect
  frames the window. The library page swaps the sheet to the showcase tier and the effect comes through behind
  the cards. One translucent layer per pixel.
- **Pros:**
  - The fewest lines (zero borders between chrome pieces).
  - One mental model for theming.
  - Restores the old "avatar up in the titlebar" feel without the old gradient hack.
  - Matches the Win11 idiom (Mica Alt frame plus content layer, as in new Outlook, Teams and Explorer) without
    copying any one app.
  - The gutters give the effect a guaranteed visible border on every page.
- **Cons:**
  - The titlebar grows by 8px.
  - The content loses 8px at right and bottom but gains 16px at left and top compared with today's 16px board
    inset (net larger).
  - Pages that relied on `--board-bg` overrides need migrating to a tier.
  - On macOS the avatar can't take the top-left cell (traffic lights; see below).

### Concept 2: "Spine" (full-height rail, titlebar belongs to the content side)

This is a refinement of the old Vesta layout. The rail runs the full window height as its own column, with the
avatar at its top at titlebar height. The titlebar starts at the rail's right edge and spans only the content
width. The titlebar and the content form one column, and the rail is a separate spine.

```
  ┌──────┬────────────────────────────────────────────┬───┬───┬───┐
  │ [av] │ ‹  Library › Fabulously Optimized   ● Run 🔔│ — │ ▢ │ ✕ │  titlebar colour
  │      ├────────────────────────────────────────────┴───┴───┴───┤
  │  ▦   │                                                         │
  │  ⌕   │                 content (board)                         │
  │  ⚙   │                                                         │
  └──────┴─────────────────────────────────────────────────────────┘
   rail colour, one uninterrupted vertical edge
```

- **Distinct colours:** this is the cleanest case. There is one straight vertical boundary for the full height
  and no corner seam to blend at all. The titlebar keeps its colour to its left end.
- **Materials:** the rail is frame tier (effect visible). The titlebar is either frame tier, which brings back
  the stacking problem where it meets the content, or sheet tier, which hides the effect at the top. The effect
  shows down one side only, so it reads as "a translucent sidebar", not "a translucent window".
- **Pros:** simple. Familiar from the old launcher and from Discord or Slack's server column. Allows a strong
  colour split.
- **Cons:**
  - Less drag area (the rail's top cell is a button).
  - On macOS the traffic lights collide with the rail top. The spine has to start at y=32, which breaks the
    concept on one platform.
  - The titlebar's left end butts against the rail with a T-junction. With similar colours this looks like two
    bars that don't quite meet.
  - The effect is lopsided.

### Concept 3: "Location tab" (Explorer/Edge-style tab rising out of the sheet)

The frame is the same as in Concept 1, but the sheet sends up a **tab-shaped bump** into the titlebar row. The
bump holds back and the breadcrumb, with inverted-radius fillets where it meets the sheet. The current location
*is* the top of the page, like File Explorer's tabs on Mica Alt.

```
  ┌──────┬─────────╭──────────────────────────────╮─────────────┬───┬───┬───┐
  │ [av] │        ╱ ‹  Library › Fabulously Opt.   ╲   ● Run 🔔 │ — │ ▢ │ ✕ │
  │      ╭────────╯                                ╰────────────────────────╮
  │  ▦   │                     sheet                                        │
```

- **Distinct colours:** the titlebar colour surrounds the tab. The tab is sheet-coloured, so the seam problem
  becomes "the page rises into the titlebar". The rail separation comes from the sheet edge, as in Concept 1.
- **Materials:** same as Concept 1, plus a strong cue tying location to content.
- **Pros:** very "Windows 11". The breadcrumb gains a home, and the location reads as part of the page.
- **Cons:**
  - A single tab **implies tabs**: users will try to close, drag or middle-click it, and we have no tab model.
    That is the feature-that-feels-unfinished trap.
  - The fillet shapes need SVG or masks, and the bump's width changes with the breadcrumb (animation, hit
    testing, ugly when the breadcrumb is long).
  - It eats drag area in the middle of the bar.
  - Worth revisiting only if real tabs ever ship.

### Recommendation: Concept 1

It is the only concept where A and B reinforce each other: the frame *is* where the effect lives, and the
sheet *is* where reading happens. It also handles the distinct-colour case without adding a seam line. The
rest of B1 is the exact proposal.

#### B1. Layout details

- **Account:** a new `titlebar-account` cell, as wide as `--rail-width`, with the avatar at 28px and
  `--profile-radius` matching the rail tiles. `AccountMenu` placement changes from `right-start` to
  `bottom-start`.
  - The `rail-account` block is removed from the rail.
  - The second `AccountMenu` in `titlebar-compact` is removed. In the narrow layout the account cell simply
    shrinks to auto width, so there is **one** account button in every layout.
- **Lead cell:** back, then the breadcrumb, **left-aligned** (it moves out of the centred column). The centre
  is left as empty drag space and reserved for a future command and search field (not part of this work).
  Narrow windows still swap the breadcrumb for the destination menu.
- **Forward:** not added. Mouse button 4 and the shortcuts already go back, and a lone forward arrow adds
  clutter.
- **End cell:** unchanged order (status pill, update, inbox, guest chip, compact add), then the caption
  buttons.
- **Caption buttons (Windows):**
  - New `CaptionButtons`, replacing `WindowControls` on Windows: 46×40 each, square, flush against the top
    and right edges, no gap.
  - Glyphs from `Segoe Fluent Icons` with `Segoe MDL2 Assets` as the fallback: E921 minimise, E922 maximise,
    E923 restore, E8BB close, at 10px.
  - Hover is `text` at 8%, pressed 5%. Close hover is `--vesta-color-caption-close` with a white glyph.
  - Maximise swaps to the restore glyph and label when `data-vesta-window-maximized`.
  - The DWM rounded corner clips the close button's hover fill, the same as in native apps.
- **Caption buttons (Linux):** keeps today's compact rounded ghost buttons (GNOME/KDE style).
- **Rail:**
  - Starts below the row with 4–6px top padding.
  - No background and no `border-inline-end`. Its separation is the sheet edge.
  - Pins, divider and settings are unchanged.
  - **Not** a drag region, to avoid accidental drags while reaching for pins.
- **Sheet:**
  - The persistent `[data-vesta=scene]` becomes the sheet: padding `0 gutter gutter 0`, and an inner
    persistent `scene-sheet` element paints fill, edge, shadow and radius.
  - `board-frame` drops its 16px inset, and `Board` becomes the scroll container with no background.
  - Because the sheet is persistent, page transitions no longer cross-fade two translucent boards. That
    avoids an opacity dip mid-transition.
  - Pages pick a tier declaratively with `<Board tier="showcase|sheet|solid">` (default `sheet`). The scene
    reads it through `:has([data-vesta=board][data-tier=showcase])` and transitions `background-color` over
    200ms.
  - Migration:
    - The library grid becomes `showcase`.
    - The project page `--board-bg: surface` becomes `solid`.
    - The instance page `--board-bg: chrome` becomes `showcase` on its overview and `sheet` on its tabs
      (open question).
- **Service-error notice:** `instance-service-error` moves from between the titlebar and `shell-body` to the
  top of the sheet, so it can no longer break the L.
- **Narrow (under 640px):**
  - The rail is hidden.
  - The sheet gains an 8px left gutter.
  - The account cell is auto width.
  - The compact add stays.
- **Maximised:**
  - Same layout (no jump). The caption glyph swaps.
  - The 8px gutters are kept for consistency (open question: drop them when maximised).
  - Insets stay in logical pixels at every DPI.
- **macOS:**
  - The traffic lights keep the top-left corner. Use `WebviewWindowBuilder::traffic_light_position` (available
    in tauri 2.11) to centre them in the 40px row, at about (16, 20).
  - `--titlebar-lead` becomes 78px and **the avatar returns to the top of the rail**, under `data-platform=macos`.
  - The sheet still starts at x = rail width. The extra 14px of lead is padding before the back button.
  - In fullscreen the traffic lights are hidden, so the lead becomes the rail width again and the avatar moves
    back up. The old app handled `macosFullscreen` the same way.
- **Drag:**
  - The header stays `data-tauri-drag-region="deep"`, covering the empty parts of the account cell, the lead,
    the centre and the end. Double-click maximises (Tauri default).
  - The gutters and the rail are not drag regions.
  - The current `pointer-events: none` on the current crumb is kept.
  - Keep a 4px non-drag strip along the very top edge when restored, so resizing from the top edge works (the
    workaround for tauri issue 9510, which the old titlebar had). It is removed when maximised.

#### B2. Files

| File | Change |
|---|---|
| `apps/desktop-solid/src/app/shell.tsx` | Move the notice into the scene. Add a persistent `scene-sheet` wrapper. Call the window-state hook. |
| `apps/desktop-solid/src/app/shell.css` | Shell paints the frame (titlebar band, rail column gradient, rail fill, theme background, grain). Remove the chrome backgrounds on titlebar and rail. Sheet styles. Tier `:has()` rules. |
| `apps/desktop-solid/src/app/titlebar.tsx` | Account cell. Left-aligned breadcrumb. Single `AccountMenu`. `CaptionButtons` (Windows) and `WindowControls` (Linux). Restore glyph state. |
| `apps/desktop-solid/src/app/titlebar.css` | 40px height. Grid `var(--titlebar-lead) minmax(0,1fr) auto`. No border. Transparent background. Top resize strip. Caption styles. macOS lead. |
| `apps/desktop-solid/src/app/rail.tsx/.css` | Remove `rail-account`. No background or border. Top padding. Platform rule for the macOS avatar. |
| `apps/desktop-solid/src/app/window-state.ts` (new) | Focus, maximised and platform → root data attributes. One subscription each, cleaned up on dispose. |
| `apps/desktop-solid/src/components/board.tsx/.css` | `tier` prop → `data-tier`. Inset 0, transparent, scroll container only. |
| `apps/desktop-solid/src/pages/library/library-page.*`, `pages/library/instance/instance-page.css`, `pages/browse/project/project.css` | `--board-bg` overrides → `tier`. Library toolbar on a sheet strip. |
| `apps/desktop-solid/src/features/settings/material-model.ts` (new) | Coverage table, derivation, inactive and reduced-transparency handling. Pure. |
| `apps/desktop-solid/src/features/settings/theme-model.ts` | Delegate the opacity outputs to the material model and emit deprecated aliases. |
| `apps/desktop-solid/src/features/settings/theme-runtime.ts/.css` | Feed effect, scheme and active state into the resolver. Register `@property`. Reduced-transparency and forced-colors rules. |
| `apps/desktop-solid/src/features/settings/window-effects.ts` | Export an `appliedWindowEffect` signal. Pass the scheme. Re-apply when the scheme changes. |
| `apps/desktop-solid/src/styles/tokens/semantic.css` | New semantic tokens and aliases (A6). |
| `apps/desktop-solid/src/pages/settings/sections/appearance.tsx` + `en/preferences.ftl` | Hide the effect row when only `none` is supported. Note when an author theme is opaque. Translucency description: "How much of the window effect shows around the edges." |
| `vesta-launcher/src-tauri/src/commands/app.rs` | `dark: Option<bool>`. Immersive dark mode for every effect. Mica Alt. Per-scheme legacy tint. |
| `vesta-launcher/src-tauri/src/utils/window_effects.rs` | Win10 default `blur`. Linux list. |
| `vesta-launcher/src-tauri/src/startup/shell.rs` | macOS `traffic_light_position`. Non-Windows background alpha. |
| `apps/desktop-solid/workbench/*` | A "Shell materials" story with a simulated backdrop (wallpaper + `backdrop-filter` per effect), with switches for scheme, effect, active, maximised, split colours and narrow. It generalises the mock. |

#### B3. Risks

- **Drag and resize:** with "deep" drag on the header, the top-edge resize can break (tauri 9510), and so can
  the corner resize next to the close button. Mitigated by the top strip; needs manual testing at 100%, 125%
  and 150% DPI.
- **Hit-testing:** the avatar cell is now inside a drag region. `AccountMenu`'s trigger is a button, so Tauri
  exempts it, but its popover anchor and tooltip must not inherit the drag. Check that a right-click on the
  titlebar does nothing odd. There is no system menu with `decorations(false)`; Alt+Space still works.
- **Snap Layouts:** custom caption buttons don't show the Win11 Snap Layouts flyout on hover (unchanged from
  today; Win+Z still works). Proper support needs `WM_NCHITTEST` to return `HTMAXBUTTON` over the maximise
  rect. WebView2 owns the input HWND, so this needs either WebView2 non-client-region support (recent runtimes
  expose non-client region kinds; check whether caption-button kinds are available in the runtime we ship) or
  a native subclass with a JS-reported rect. **Proposed as a separate spike, not a blocker.**
- **Maximised geometry:** check that an undecorated maximised window doesn't overhang the monitor by the frame
  thickness, so the caption buttons stay fully on screen and the close button sits in the corner pixel. Check
  the auto-hide taskbar.
- **Light Mica forced dark:** fixed natively (A5). Until then, light themes look grey. Both must land in the
  same PR.
- **macOS and Linux transparency:** the opaque `background_color` may currently hide every effect. Changing it
  could expose a white flash at startup (the window is created hidden, so the risk is low). Verify.
- **Performance:** `backdrop-filter` on overlays above a translucent window. Win10 acrylic lags during
  resize, hence the blur default.
- **`:has()` support:** fine in WebView2 and WKWebView. WebKitGTK needs 2.42+. Fall back to a route-derived
  attribute if Linux distros lag behind.
- **View transitions:** the titlebar and rail are captured as their own layers today. Once they become
  transparent regions of the shell's frame, confirm the frame doesn't cross-fade or shimmer
  (`plus-lighter` should keep identical pixels stable).
- **Author themes:** anything that relied on `--board-bg`, `--rail-bg` or chrome being on separate elements
  changes behaviour. Aliases cover the tokens, not selector-level rules. `windows-2000.css` line 249 targets
  titlebar and rail and needs a pass. It's also a good showcase for split colours: a navy titlebar over a grey
  rail.

#### B4. Verification plan

1. **Unit** (`bun test`, under `apps/desktop-solid/checks/`):
   - New `material-model.test.js`:
     - Ordering: frame ≤ showcase ≤ sheet ≤ 100.
     - none and flat → 100 everywhere.
     - Derived layer alpha reproduces the target coverage within 0.5%.
     - Inactive ≥ active.
     - Reduced transparency → 100.
     - The worst-case contrast floors from A3 pass for every effect, scheme and built-in theme.
   - Update `theme-runtime.test.js`: swap the canvas < chrome < panel assertion for the tier assertions.
   - `theme-tokens.test.js` stays green: the close red is a token.
2. **Browser fixture** (`checks/theme-surfaces.browser.mjs` or a new `shell-geometry.browser.mjs`):
   - The account cell width equals the rail width.
   - The sheet's left x equals the rail's right x, and its top y equals the titlebar height.
   - Computed borders between the titlebar and rail are 0.
   - The back button's left equals the sheet's left.
   - Exactly one `[data-vesta=profile-button]` in both wide and narrow layouts.
   - The library scene resolves `data-tier=showcase`, and settings resolves `sheet`.
   - The notice renders inside the sheet.
3. **Workbench story:** a visual review of every effect × scheme × active × split combination over three
   wallpapers (white, black, busy saturated). This is the reviewer harness.
4. **Native manual matrix:**
   - Win11 24H2: mica, acrylic, transparent and none × dark and light × focused and unfocused × restored and
     maximised × 100% and 150%.
   - Win10 22H2: blur and acrylic.
   - macOS 14 and 26: vibrancy, liquid glass, traffic-light alignment, fullscreen.
   - Linux GNOME and KDE: none.
   - At each cell:
     - Sample colour from screenshots over the white and black wallpapers to **measure the backdrop envelopes**
       and feed them back into A3.
     - Drag from each titlebar zone. Double-click to maximise. Resize from the top edge, the top-right corner
       and the left edge.
     - Win+Z, Aero Shake, Win+arrow snapping.
     - Keyboard: Tab order (account → back → crumbs → status → caption).
     - Screen reader names on the caption buttons.
5. **Performance:** drag and resize at 60fps on Win11 with acrylic, and on Win10 with blur (check the logs for
   dropped frames).

#### B5. Suggested PR order

1. **Material model and native fixes:** A in full, done in the current geometry. It alone fixes "unnoticeable".
2. **Shell geometry:** frame, sheet, account cell, tiers and the notice move.
3. **Caption buttons:** caption buttons, the maximised state and the macOS traffic-light position.
4. **Snap Layouts spike:** a separate, optional PR.

---

## Open questions for the reviewer

1. Titlebar height: 40px (recommended; it fits the avatar and status pill and makes a more generous drag
   target) or keep 32px with a 24px avatar?
2. Breadcrumb: left-aligned to the sheet edge (recommended) or keep centred on the window?
3. Should "Mica" quietly render as Mica Alt (`DWMSBT_TABBEDWINDOW`) on 22H2+? Or keep true Mica and rely on the
   lower coverage alone?
4. The instance page: showcase on the overview hero only, or for the whole instance page as today
   (`chrome`)?
5. Keep the 8px right and bottom gutters when maximised (consistency), or drop them (more content and a
   cleaner corner)?
6. Win10 default effect: `blur` (smooth) or `acrylic` (prettier but laggy on resize)? And should Linux expose
   `transparent` at all?
7. Are the backdrop luminance envelopes in A3 an acceptable basis for the contrast guarantee until measured?
   Or should floors be set conservatively (+10) until native measurements land?
8. Snap Layouts: is a native or WebView2 spike worth scheduling now, or should it be deferred?
9. Should the rail's empty space be a drag region? Discord and Teams don't do this; the old Vesta didn't
   either. This proposal says no.
10. Should the frontend default for `theme_window_effect` follow the native capability default (Mica on
    Win11) instead of `none`?
