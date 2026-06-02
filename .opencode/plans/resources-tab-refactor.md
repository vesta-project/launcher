# Resources Tab Refactor Plan

## Current State Summary

The resources tab (`ResourcesTab.tsx` + `instance-details.tsx` + `instance-details.module.css`) uses:
- **TanStack Table** for data rendering (5 columns: select, name, version, enabled, actions)
- **HTML `<table>`** with `overflow-x: auto` for horizontal scroll
- **Sticky column hacks** (left: 0 and left: 48px) for select + name columns
- **Filter group** = horizontal button row for resource types
- **Search input** = always-visible text field
- **Toolbar** = 2-row layout: top = filter + search, bottom = actions / selection bar
- Hardcoded column sizes via `grid-template-columns` in CSS AND `size` in TanStack column defs

### Key Problems
1. Horizontal scroll on narrow screens (requirement: no horizontal scroll)
2. Filter buttons overflow on small screens
3. Search bar takes constant space regardless of width
4. Action buttons (update, delete) are per-row, always visible = cluttered
5. Name column doesn't truncate with tooltip
6. No responsive breakpoints for the toolbar or table
7. Browse button hover uses non-themed styles (`!important`, `translateY`)
8. "Check Updates" button prioritizes text over icon, feels bulky
9. Table rows are 56px fixed height regardless of content
10. `.res-path` styles defined multiple times, inconsistently

---

## Refactor Plan

### 1. Keep Table but Make Responsive (Decision: keep `<table>`)

Keep TanStack Table's `<table>` rendering for accessibility and column features (sorting, filtering, selection). Fix the responsive issues with CSS:

- Remove `overflow-x: auto` — no horizontal scroll
- Make columns responsive:
  - **Select/Icon** (48px): always visible, sticky left
  - **Name** (`flex: 1`): `min-width: 140px`, truncation + tooltip
  - **Version**: auto-hide below 700px (moves into ⋯ menu)
  - **Enabled switch**: always visible (priority requirement)
  - **Actions ⋯**: always visible, single icon button
- The name column gets `overflow: hidden; text-overflow: ellipsis; min-width: 140px`
- Version column hidden at `<700px` via CSS `@media` or conditional rendering

### 2. Action Menu (⋯) replacing per-row buttons

Create a `DropdownMenu` UI component at `ui/dropdown-menu/` based on `@kobalte/core/dropdown-menu`. Convert the provided Tailwind reference component to CSS modules, matching existing Vesta UI patterns (liquid glass, border variables, `--text-*` tokens, `--surface-*` tokens).

**Menu items per row:**
1. **Update to vX.X.X** (shown only when update available) — highlighted, primary action
2. **Check for Updates** — per-item update check; greyed out while checking or after check completes
3. **Version info** — display-only line: "Current: v1.0.0" (muted, non-interactive)
4. Separator
5. **Delete** — destructive, styled red

The "Check for Updates" option:
- Enabled by default
- After clicking: becomes disabled/greyed while the check is in progress
- After the check completes: stays disabled (we now know if there's an update or not)
- If an update is found: the "Update to vX.X.X" item appears/updates

**Implementation**: `ResourceRowActions` component renders the ⋯ icon button as `DropdownMenuTrigger`, with the menu items wired to the row's resource data.

### 3. Resource Type Filter — Responsive Switcher

**Current**: Horizontal `<For>` of `<button>` elements in `.filter-group`

**Proposed**:
- **Wide screens (≥600px)**: Keep current horizontal button group
- **Narrow screens (<600px)**: Replace with `<Select>` dropdown from `@ui/select`

Use `createMediaQuery` signal to toggle between the two via `<Show>`.

### 4. Search — Collapsible on Small Screens

**Current**: Always-visible search input

**Proposed**:
- **Wide screens (≥600px)**: Keep search input always visible
- **Narrow screens (<600px)**: Show a search icon button. Clicking it expands the search bar and hides the filter buttons. Press Escape or clear search to collapse back.

Pattern already partially exists in the codebase (`.mobile-search-trigger` + `.console-search-wrapper.expanded` at CSS lines 972-999). Extend this pattern.

### 5. Name Column — Truncation + Tooltip

**Proposed**:
- Keep `text-overflow: ellipsis` with `min-width: 140px`
- Wrap the name in `<Tooltip>` from `@ui/tooltip` showing the full `display_name`
- The `.res-path` line also truncates with its own tooltip showing the full `local_path`
- Use conditional rendering: always show tooltip on hover (no JS truncation detection needed)

### 6. Browse Button Hover Fix

**Current**: `browse-java-btn` (and `browse-resources-btn`) uses `!important` overrides, `transform: translateY(-1px)`, hardcoded HSL backgrounds.

**Proposed**: Remove the custom CSS class entirely. Use the standard `Button` component with `variant="outline"` and let the theme handle hover states. If specific styling is needed, use theme tokens without `!important`:
- Remove `transform: translateY`
- Use `--interactive-hover` / `--interactive-active` tokens for hover states
- Add `cursor: pointer`

### 7. Check Updates Button — Size Reduction

**Current**: Full text "Check Updates" with reload icon, `flex: 1` stretching it.

**Proposed**:
- Remove `flex: 1` from `.check-updates-btn`
- On narrow screens (<600px): show just the icon with a tooltip
- On wide screens: keep icon + text but without stretching behavior

### 8. Responsive Toolbar Layout

#### Wide (≥800px):
```
[All | Mods | Packs | Shaders | Datapacks]  [🔍 Search...]  [↻ Check Updates] [+ Browse]
```

#### Medium (600-799px):
```
[All | Mods | Packs | ...]  [🔍]  [↻] [+ Browse]
── expanded search (overlay): ──
[🔍 Search...                              ]  [✕]
```

#### Narrow (<600px):
```
[▼ All ▾]  [🔍]  [↻] [+]
── expanded search (overlay): ──
[🔍 Search resources...                   ]  [✕]
```

### 9. Light & Dark Mode Support

**Current issues**: Hardcoded dark-mode values:
- `.resources-toolbar` background: `hsl(var(--color__primary-hue) 15% 8% / 1)`
- `.vesta-table th` uses same hardcoded dark
- Hover backgrounds use hardcoded low-lightness HSL values

**Proposed**: Replace with semantic tokens:
- Toolbar bg → `var(--surface-raised)`
- Table header bg → `var(--surface-medium)` or `var(--surface-raised)`
- Hover → `var(--interactive-hover)`
- Selected → `var(--interactive-active)`
- Works across all themes (dark/glass/light/flat)

### 10. Spacing Standardization

**Current**: Inconsistent spacing throughout.

**Proposed standardized spacing**:
- Row padding: `10px 16px`
- Column gaps in rows: `12px`
- Toolbar padding: `12px`
- Toolbar element gaps: `8px`
- Filter button gaps: `4px`
- Section gaps: `12px`

### 11. Sticky Header

**Current**: Uses `position: sticky; top: 0` on `<th>` with hardcoded opaque backgrounds and z-indices.

**Proposed**: Keep sticky `<thead>` approach:
- Use `var(--surface-raised)` for background (works in light/dark)
- Proper `z-index` using existing z-index tokens
- Toolbar above also stays sticky

---

## Component Architecture

### New Files

1. **`ui/dropdown-menu/dropdown-menu.tsx`** + `dropdown-menu.module.css`
   - Wraps `@kobalte/core/dropdown-menu` primitives
   - Exports: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuGroupLabel`, `DropdownMenuItemLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuGroup`, `DropdownMenuPortal`
   - Styled with CSS modules using Vesta theme tokens (`--surface-raised`, `--border-subtle`, `--text-primary`, `--interactive-hover`, etc.)
   - Liquid glass effect for the content panel (matching context-menu, popover patterns)
   - No Tailwind — all styles via CSS module classes

2. **`instance-details/tabs/ResourcesTab.tsx`** — Major rewrite
   - Add responsive breakpoint detection (`createMediaQuery` hook or signal)
   - Search expand/collapse state
   - `ResourceRowActions` sub-component with dropdown menu
   - Responsive filter group (button row / Select toggle)
   - Per-row "checking updates" state tracking

3. **`instance-details/instance-details.module.css`** — Refactor resources section
   - Keep `<table>` structure but add responsive column rules
   - Add `@media` rules for column hiding and toolbar reflow
   - Replace hardcoded dark colors with theme tokens
   - Standardize spacing
   - Fix Browse button hover

### Modified Files

1. **`instance-details/instance-details.tsx`**
   - Update TanStack column definitions:
     - Keep select column with icon overlay (checkbox/icon)
     - Merge version info into dropdown menu on small screens
     - Replace actions column with ⋯ DropdownMenu trigger
   - Add per-row "checking" state for individual update checks
   - Add tooltip wrapping for truncated names
   - Add responsive column visibility (hide version below breakpoint)

### Removed Code
- `.vesta-table td:nth-child` sticky column hacks (simplify to just first column if needed)
- `overflow-x: auto` from `.vesta-table-container`
- Hardcoded `hsl(var(--color__primary-hue) 15% 8%)` backgrounds
- Duplicate `.res-path` / `.res-title` CSS definitions
- `.browse-java-btn` custom hover styles (replaced by standard Button)

---

## Implementation Order

### Phase 1: Foundation
1. Create `DropdownMenu` UI component (convert from Tailwind ref to CSS modules)
2. Add `createMediaQuery` utility hook for responsive breakpoints

### Phase 2: Row & Column Refactor
3. Refactor TanStack column defs:
   - Replace actions column with ⋯ DropdownMenu trigger
   - Add tooltip wrapping for name column
   - Make version column conditionally rendered based on breakpoint
4. Create `ResourceRowActions` component with per-item menu
5. Add per-row "checking updates" state tracking
6. Update `<table>` CSS: remove horizontal scroll, add responsive column hiding

### Phase 3: Toolbar Responsive
7. Implement responsive filter group (button row → Select dropdown below 600px)
8. Implement collapsible search on small screens
9. Fix Browse button hover — use standard Button component
10. Reduce Check Updates button weight — remove `flex: 1`, add responsive icon-only mode

### Phase 4: Polish
11. Replace all hardcoded dark-mode color values with theme tokens
12. Standardize spacing throughout resources section
13. Test sticky header behavior
14. Test across theme presets (vesta/dark, classic/light)
15. Test at various viewport widths (320px → 1920px+)

---

## Detailed DropdownMenu Component Spec

Based on the provided reference component, adapted for Vesta's design system:

### Structure
```
ui/dropdown-menu/
  dropdown-menu.tsx     — Component exports
  dropdown-menu.module.css  — Styles using Vesta theme tokens
```

### Style Tokens Used
- `--surface-raised` — content panel background
- `--border-subtle` — panel border
- `--text-primary` — item text
- `--text-secondary` — secondary text
- `--interactive-hover` — item hover background
- `--interactive-active` — item active/pressed background
- `--semantic-error` — destructive item color
- `--z-popover` — z-index for portal content

### Animations
- Open: `fade-in` + `zoom-in` (0.95 → 1.0) with 150ms ease-out
- Close: `fade-out` + `zoom-out` (1.0 → 0.95) with 100ms ease-in
- Match existing context-menu/popover animation style

---

## Risks & Considerations

- **TanStack Table**: Kept for sorting/filtering/selection. Responsive layout achieved via CSS on `<table>` and conditional column rendering. No change to the data layer.
- **DropdownMenu**: Uses `@kobalte/core/dropdown-menu` (confirmed available in Kobalte v0.13+. If `dropdown-menu` subpath doesn't exist, fall back to `@kobalte/core/menu` primitives).
- **Checkbox + Icon overlay**: The hover-to-reveal-checkbox pattern is retained in the first column.
- **Row click navigation**: Clicking a row → resource details. Menu clicks use `stopPropagation()`. Pattern continues.
- **Selection bar**: Batch action overlay pattern works well, kept as-is.
- **Performance**: IntersectionObserver lazy icon loading in `ResourceIcon` is retained.
- **Per-item update check**: Needs a per-resource loading state. Can use a `Set<number>` signal keyed by resource ID to track which resources are currently checking. Once checked, the option stays disabled for that resource.
- **Version in ⋯ menu on small screens**: When the version column is hidden, the "Current: v1.0.0" text in the menu shows this info. On wider screens, the column is visible so this can be more subtle (or omitted from the menu).