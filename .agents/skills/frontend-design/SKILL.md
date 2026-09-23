---
name: frontend-design
description: Design, implement, and review frontend UI for Vesta Launcher. Use for pages, components, dialogs, navigation, settings, instance views, theme controls, resource views, account flows, and any visual frontend work in vesta-project/launcher. Follow Vesta's existing design system, component library, runtime theme engine, desktop constraints, accessibility requirements, and anti-generic UI rules. Do not introduce a separate visual language or generic AI-generated dashboard patterns.
---

# Frontend Design

## Purpose

Build Vesta Launcher UI that is consistent with the existing product, works across the runtime theme system, and avoids generic generated-interface patterns.

This skill is the design standard for Vesta. Do not apply a separate design style, anti-AI style, or Uncodixify layer on top of it. The rules below already include those requirements.

Vesta is a Tauri desktop Minecraft launcher with a SolidJS frontend. It supports dynamic visual configuration. UI must remain usable and visually coherent when users change supported theme settings.

## Required project context

Before making non-trivial UI changes, inspect the relevant current implementation.

Start with these files when applicable:

- `design.md`
- `PRODUCT.md`
- `vesta-launcher/src/styles.css`
- `vesta-launcher/src/themes/types.ts`
- `vesta-launcher/src/themes/engine/`
- `vesta-launcher/src/components/theming.tsx`
- `vesta-launcher/src/assets/`
- `vesta-launcher/tsconfig.json`
- `vesta-launcher/ui/`
- `vesta-launcher/src/components/page-root/`
- `vesta-launcher/src/components/page-composition/`
- `vesta-launcher/src/components/page-sidebar/`
- `vesta-launcher/src/components/page-viewer/`
- the closest existing page or component to the requested feature

Current code takes priority over old screenshots, stale requirements, generic frontend conventions, or assumptions about how the launcher used to work.

Before creating a new primitive, search for an existing one. Reuse or extend existing components where possible.

Do not create duplicate buttons, cards, dialogs, fields, dropdowns, tabs, badges, navigation shells, or page layouts because writing a new one is easier.

## Design priorities

Use this order when making design decisions:

1. Existing Vesta component and page patterns.
2. Existing Vesta semantic tokens and theme behavior.
3. Clear information hierarchy and task completion.
4. Desktop usability and accessibility.
5. Visual polish.

Do not trade usability or consistency for decoration.

## Theme system

Vesta UI must support the current theme model, including where applicable:

- `glass`, `frosted`, and `flat` styles
- light and dark schemes
- configurable primary hue
- configurable saturation and lightness
- configurable background and surface opacity
- gradient enabled or disabled
- linear and radial gradients
- gradient harmony modes
- configurable gradient rotation
- grain strength
- configurable border width
- platform-dependent native window effects
- custom CSS
- theme-defined variables
- user-provided theme variable values

Do not design only for the default teal glass appearance.

A component must preserve its information hierarchy, action priority, selected state, focus state, semantic status, and readability across supported theme configurations.

Theme changes may change appearance. They must not change the meaning of the UI.

## Colors

Use Vesta's semantic CSS variables and component tokens.

Prefer existing tokens such as:

```css
color: var(--text-primary);
background: var(--surface-raised);
border: var(--border-width-subtle) solid var(--border-subtle);
box-shadow: var(--elevation-soft);
```

Use existing token families including:

- `--surface-base`
- `--surface-raised`
- `--surface-overlay`
- `--surface-sunken`
- `--text-primary`
- `--text-secondary`
- `--text-tertiary`
- `--border-subtle`
- `--border-strong`
- `--border-focus`
- `--interactive-base`
- `--interactive-hover`
- `--interactive-active`
- `--accent-primary`
- `--accent-secondary`
- semantic success, warning, error, and info tokens
- shared elevation tokens
- page layout tokens
- component-specific tokens where they already exist

Do not create a private palette for a component.

Do not hard-code decorative colors when a semantic or theme-derived token exists.

Do not assume the primary hue is teal, blue, or any other fixed color.

Do not use a fixed complementary accent because it looks good with the default theme.

Do not use semantic success, warning, error, or info colors as decoration. Use them only when the corresponding meaning is present.

Do not add random cyan, purple, blue, or neon accents to make the UI look modern.

Do not use gradients inside controls or cards unless the product behavior or existing component pattern specifically requires them. The application theme already controls background gradients.

Do not create gradient borders.

Do not use colored shadows or glows as hierarchy.

If a user-selected hue causes a contrast problem, fix the token relationship or theme computation. Do not patch the component with a fixed color.

## Surfaces and materials

Vesta intentionally supports glass, frosted, and flat material modes. These are part of the theme system.

Use shared surface and material behavior. Do not implement separate component-local glass systems.

Glass or translucency is allowed when:

- it comes from Vesta's shared theme system,
- it corresponds to an established surface level,
- text and controls remain readable,
- the same component still works in frosted mode,
- the same component still works in flat mode,
- the component does not depend on a platform-specific window effect.

Do not:

- add blur because an empty card looks unfinished,
- add a custom translucent shell around a page,
- create a second blur/tint/shadow system inside a component,
- use glass as the only indicator of hierarchy,
- make content unreadable when blur or native effects are unavailable,
- add decorative haze behind content,
- add unrelated frosted panels inside already layered surfaces.

A flat rendering of the same UI must remain structurally clear.

## Typography

Use Vesta's existing system typography unless the project intentionally changes typography globally.

Use size, weight, spacing, placement, and contrast to create hierarchy.

Use semantic headings where a page or section requires them.

Headers and labels must be direct, minimal, and literal. Name the page, section, setting, state, or action. Do not rename ordinary concepts to make the interface sound more distinctive.

Prefer:

- `Settings` over `Control Center`
- `Instances` over `Your Worlds at a Glance`
- `Mods` over `Mod Management Hub`
- `Account` over `Player Identity`
- `Memory` over `Performance Allocation` when the control specifically changes memory
- `Install` over promotional or descriptive action text

Do not create marketing-style headline compositions inside launcher screens.

Do not use:

- eyebrow labels above headings,
- `<small>` elements as decorative headers,
- uppercase labels with wide letter spacing by default,
- gradient text,
- a serif display font paired with a system sans font to imply quality,
- a novelty font for one page or feature,
- oversized page titles that consume unnecessary vertical space,
- decorative subtitles that restate the heading,
- clever, metaphorical, branded, or elaborate replacements for ordinary UI terminology,
- generic copy such as "Everything you need in one place," "Stay in control," or "Operational clarity without the clutter."

A heading should normally be a short noun or noun phrase. An action label should normally be a short verb or verb phrase. A setting label should state exactly what is being configured.

Do not add a subtitle, description, or helper sentence when the heading or control label already makes the purpose clear.

Compact group labels are allowed only when they match an existing Vesta pattern and provide real structure.

Body text should remain readable and compact. Do not shrink supporting text until contrast or legibility suffers.

## Layout

Vesta is desktop application UI. Do not structure internal screens like a marketing website or generic SaaS dashboard.

Use the established launcher shell and page composition primitives.

The current design uses a compact desktop shell with a narrow primary sidebar, title bar region, shared page gutters, and bounded content widths. Follow the current implementation rather than inventing a new shell.

Use predictable grid and flex layouts.

Keep alignment consistent within a page.

Use the existing spacing scale where possible:

- 4px
- 8px
- 12px
- 16px
- 24px
- 32px

Do not use arbitrary gaps when an existing spacing value works.

Do not overpad pages, panels, settings groups, or dialogs.

Do not create large areas of empty space to make the UI appear expensive or minimal.

Do not center content that should align with the rest of the application.

Do not mix left-aligned operational content with centered decorative blocks without a functional reason.

Do not create overlapping layouts or asymmetry for visual interest.

Do not add a second left navigation rail if the existing information architecture already handles navigation.

Do not add a right-side activity rail, "Today" rail, or secondary dashboard rail unless the feature specifically requires persistent secondary navigation or context.

Do not invent a new page layout when a close existing Vesta layout already exists.

## Internal page structure

Internal pages should start with the information or controls needed for the task.

Do not automatically add:

- hero sections,
- marketing banners,
- giant introductory headings,
- eyebrow + heading + paragraph compositions,
- feature grids,
- KPI cards,
- fake metrics,
- activity feeds,
- testimonials,
- CTA rails,
- decorative quote blocks,
- explanatory cards that tell the user what the page already shows.

A page title, short description, or prominent feature region is allowed when the real workflow needs it. Keep it concise and consistent with existing pages.

Do not add internal copy only to fill visual space.

## Sidebars and navigation

Use the current Vesta navigation structure.

Do not replace the current compact sidebar with a generic 240-280px dashboard sidebar containing a brand card, text links, workspace selector, usage meter, or promotional block.

Do not create a floating detached sidebar with rounded outer corners.

Do not add decorative sidebar blobs, gradients, glows, or background art.

Do not add navigation badges such as "Live" or counts unless the value is functional and current.

Do not animate navigation items with horizontal movement.

Navigation hover and active states should use existing surface and interaction tokens.

Navigation must remain clear in light, dark, glass, frosted, and flat presentations.

## Containers and cards

Use a card or raised container only when content needs grouping, selection, elevation, or separation from surrounding content.

Do not wrap every piece of content in a card.

Do not place cards inside cards without a clear structural reason.

Do not create multiple visually different generic panel types such as `panel`, `panel-2`, `rail-panel`, and `table-panel` to manufacture depth.

Do not use card grids as the default solution for settings, metadata, or statistics.

Do not create a large card for a small amount of content.

Do not use shadows or glows to make an unnecessary card feel justified.

Do not create decorative note cards such as:

```html
<div class="team-note">
  <small>Focus</small>
  <strong>Keep updates brief and blockers visible.</strong>
</div>
```

Use normal text, help text, an alert, or no additional element depending on the actual need.

## Shape and border radius

Follow the current Vesta radius hierarchy instead of applying the same radius everywhere.

Typical current intent:

- controls: about 6px
- cards and menus: about 8px
- page or window containers: about 12px
- rare larger feature regions: about 16px
- pills and circles: only where the control semantics require them

Do not use 20-32px radii across normal application UI.

Do not apply the same large rounded rectangle treatment to sidebars, cards, buttons, inputs, dialogs, and panels.

Do not make ordinary buttons pill-shaped.

Do not wrap ordinary text in rounded `span` elements.

Do not wrap every icon in a rounded square or circle.

Use subtle borders from the theme system. Do not add thick decorative borders.

## Buttons

Use `vesta-launcher/ui/button` where possible.

Use established sizes and variants.

Primary styling is for the primary action, not for decorative emphasis.

Secondary actions should not compete visually with the primary action.

Do not:

- create gradient buttons without an existing product reason,
- make all buttons pills,
- add glowing button shadows,
- add large icon tiles inside buttons,
- animate buttons with large movement,
- use multiple competing primary actions in the same local workflow,
- create one-off button styles when an existing variant is sufficient.

Hover feedback should be subtle and must not shift surrounding layout.

Keyboard focus must remain clearly visible.

Disabled state must remain distinguishable without relying only on color.

## Inputs and forms

Reuse existing Vesta input, text-field, select, combobox, checkbox, switch, slider, and related primitives.

Place clear labels where the field meaning is not obvious.

Do not use placeholder text as the only label.

Do not use animated floating labels.

Do not use morphing field shapes or animated underline-only fields.

Use simple focus treatment based on existing focus tokens.

Group settings by task and meaning. Do not place each setting in its own card by default.

Keep descriptions concise. Do not add a paragraph under every setting when the label is sufficient.

Validation, error, disabled, pending, and saved states must be clear.

## Dialogs, popovers, menus, and overlays

Use existing Vesta primitives and overlay tokens.

Dialogs and popovers may use stronger elevation because they are real overlay layers.

Keep dialogs focused on one task.

Do not add decorative hero content inside dialogs.

Do not use slide-in motion for a normal centered modal unless the existing component already uses that behavior.

Do not create different dialog visual systems for individual features.

Dropdowns and context menus should be simple lists with clear hover, focus, selected, and disabled states.

Do not add unnecessary descriptive headers or decorative sections to small menus.

## Tabs

Use existing Vesta tabs.

Tabs must clearly show the selected state.

Do not make tabs into large segmented pill controls unless the existing component or interaction specifically uses that pattern.

Do not add sliding decorative indicators or large animated transforms.

Do not use tabs where normal navigation or a select control is more appropriate.

## Tables and lists

Use tables for genuinely tabular information.

Keep alignment consistent. Text is generally left-aligned unless the data type requires another alignment.

Use simple row separation and hover states.

Do not add zebra striping unless it materially improves scanning for a dense table.

Do not turn every status value into a colored tag.

Use lists for repeated items that do not need column alignment.

Do not add decorative bullets or leading icon tiles without a reason.

For instance, mod, resource, or account lists, prioritize identity, important state, and available actions.

## Badges and status

Use badges only for compact categorical or state information.

Do not create a badge for ordinary metadata.

Do not use pill badges for every status, version, category, or count.

Do not create decorative colored status dots with pseudo-elements when text or an existing status component communicates the state more clearly.

Do not use trend-up or trend-down color conventions for data that is not actually a trend.

Do not use semantic colors for non-semantic labels.

## Icons, SVGs, and avatars

Prefer visual communication over explanatory text when a standard, recognizable visual can communicate the same action, state, or content type clearly. Do not add paragraphs or decorative labels to explain something that a clear icon, layout, state treatment, or existing component already communicates.

Do not remove necessary text merely to make the interface more visual. If an icon alone would be ambiguous, use a direct text label. Icon-only controls must still have an accessible name and should use a tooltip where the interaction needs visible clarification.

Use the project's existing SVG asset library before creating anything new. Vesta uses `vite-plugin-solid-svg`, so imported `.svg` files are compiled into Solid components. Do not reference reusable UI SVGs with long relative paths, raw public URLs, or inline SVG markup when an asset import is appropriate.

The configured asset alias is:

```ts
@assets/* -> ./src/assets/*
```

Import SVGs through `@assets` and render them as components:

```tsx
import AddIcon from "@assets/icons/actions/add.svg";

<AddIcon aria-hidden="true" />
```

This behavior is provided by `vite-plugin-solid-svg` in `vite.config.ts`, with the matching component types configured in `tsconfig.json`.

The current asset structure is:

```text
vesta-launcher/src/assets/
  branding/
  icons/
    actions/
    content/
    controls/
    navigation/
    security/
    status/
  illustrations/
  images/
```

There is no `@/assets/svg` alias and no `src/assets/svg` directory in the current repository. Do not introduce that path unless the repository structure is intentionally changed first.

For normal UI icons, use the appropriate existing category and import through `@assets`, for example:

```tsx
import AddIcon from "@assets/icons/actions/add.svg";
import HomeIcon from "@assets/icons/navigation/home.svg";

<AddIcon class={styles.icon} aria-hidden="true" />
```

Do not use paths such as `../../../assets/...` when the `@assets` alias can address the file directly. Do not create a second asset alias for the same directory.

When an SVG is needed:

1. Search `src/assets/icons/`, `src/assets/branding/`, and `src/assets/illustrations/` first.
2. Reuse an existing asset when its meaning and visual form are correct.
3. If a simple generic UI icon is missing, create a new SVG in the correct existing asset category.
4. If the required visual is product-specific, brand-specific, unusually detailed, or cannot be drawn accurately from the available requirements, create an empty `.svg` file at the correct asset path and tell the user which file needs the final artwork. Do not invent vague or misleading artwork just to avoid leaving a placeholder.
5. Do not place page-specific inline `<svg>` markup in TSX when the artwork should be a reusable asset.
6. Do not introduce a new icon package to solve a single missing icon when the local SVG library is the established pattern.

Generic reusable UI SVGs must use `currentColor` for their normal fill or stroke so color is controlled by the component and theme. Use one of these patterns as appropriate:

```svg
<svg viewBox="0 0 24 24" fill="currentColor">...</svg>
```

or:

```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">...</svg>
```

Do not hard-code black, white, teal, blue, or another presentation color into a generic UI icon. Semantic status color should normally be applied by the consuming component with Vesta's semantic tokens rather than baked into the SVG.

Fixed or multicolor values are allowed when color is part of the asset itself, such as external brand artwork or an intentional illustration. Do not convert brand colors or intentionally multicolor artwork to `currentColor` without a product reason.

Before adding or accepting an SVG, clean it. Remove export noise and unnecessary markup, including when present:

- editor metadata
- generator comments
- unused `<defs>`
- unused IDs or classes
- unnecessary wrapper groups
- redundant transforms
- redundant width and height when sizing should be controlled by the component
- embedded raster/base64 data unless the asset genuinely requires it
- inline style blocks that can be represented by normal SVG attributes
- hard-coded presentation colors in generic UI icons
- scripts or animation unless animation is explicitly required for that asset
- excessive decimal precision that does not affect the shape
- unrelated namespaces from design tools

Keep the SVG's `viewBox` correct. Do not change path geometry solely to make the file shorter if that changes the visual.

Check the final SVG visually after cleanup. A syntactically valid SVG is not enough; confirm that paths are not clipped, fills and strokes are correct, the viewBox is appropriate, and the icon remains legible at the size where it will actually be used.

Keep icon sizing consistent, usually within the current 16-20px control range where appropriate.

Do not add icon backgrounds for decoration.

Do not mix unrelated icon styles.

Avatars should use simple existing shapes. Do not add decorative borders or rings unless they indicate a real state.

## Toolbars and actions

Toolbars should have a clear purpose and compact desktop sizing.

Keep primary and secondary actions easy to identify.

Do not add decorative labels, metric summaries, or branding inside a toolbar.

Do not create oversized toolbar heights to add visual presence.

Use overflow menus when secondary actions would otherwise crowd the interface.

## Charts and metrics

Do not add charts unless a real Vesta task benefits from visualizing data.

Do not create fake charts to fill empty space.

Do not add donut charts with approximate or invented percentages.

Do not put a canvas chart in a glass card by default.

Do not build KPI card grids by reflex.

Do not invent usage, performance, engagement, storage, or activity statistics that the product does not provide.

If a number can be communicated more clearly as normal text, use normal text.

## Minecraft-specific content

Use real product and domain information instead of generic dashboard content.

Relevant information can include:

- instance name and icon
- Minecraft version
- modloader and modloader version
- last played
- playtime when actually available
- mod or resource counts when actually available
- update availability
- launch state
- account identity
- local path or file information when relevant
- dependency or compatibility warnings
- installation or download progress

Do not fabricate data to make a layout look complete.

Do not replace domain language with generic SaaS terms such as workspace health, pipeline, team focus, operational status, live pulse, or command center.

## Copy

UI copy must describe the actual feature, value, state, or action.

Use the shortest wording that remains clear. Prefer existing Minecraft, launcher, operating-system, and Vesta terminology over newly invented wording.

Headers must state what the page or section is. Labels must state what the control or value is. Buttons must state what the action does. Error text must state what failed and, when useful, what the user can do next.

Do not make ordinary UI language more elaborate. Do not use metaphor, personality copy, promotional wording, or renamed concepts to make a header or label feel designed.

Do not turn a short label into a sentence unless the sentence carries information the user actually needs.

Do not add descriptive prose when the same information can be communicated more clearly through structure, an existing icon, state styling, progress, selection, or the content itself.

Do not add decorative or promotional copy to operational screens.

Do not use generic startup-style slogans.

Do not add mini-notes throughout a page explaining obvious controls.

Do not create ornamental labels such as:

- "Live pulse"
- "Night shift"
- "Operator checklist"
- "Focus"
- "Team command"
- "Recent activity"

unless those phrases are real product terminology.

Do not use copy to compensate for unclear layout. Fix the layout or control instead.

## Motion

Use motion only to communicate state, hierarchy, or spatial change.

Acceptable uses include:

- dialog and popover entry or exit
- expand and collapse
- loading and progress
- selection feedback
- navigation transitions that aid orientation

Keep normal interaction transitions short, generally around the existing 100-200ms range unless the existing component specifies otherwise.

Respect reduced-motion settings.

Do not use:

- bouncy animation,
- spring motion for normal controls,
- constant ambient motion,
- floating decoration,
- large hover lifts,
- horizontal nav movement,
- `translateX` decoration on hover,
- transform effects on every interactive element,
- scroll-reveal animation for normal launcher pages,
- staggered page-load animation as a default pattern.

Do not animate simply because animation is available.

## Shadows and elevation

Use existing Vesta elevation tokens.

Elevation must indicate a real layer, interaction, or overlay relationship.

Do not create dramatic shadows such as large 24-60px blurred shadows on ordinary cards.

Do not add colored shadows.

Do not use glow as a substitute for border, spacing, or contrast.

Do not give every card a hover shadow.

The hierarchy must remain understandable when shadows are reduced or absent.

## Responsive desktop behavior

Vesta is adaptive desktop software, not a mobile-first website.

Support constrained window widths without redesigning the app as a phone interface.

When width becomes limited, preserve this order:

1. primary action
2. item identity
3. critical state
4. essential controls
5. secondary metadata

Allow secondary metadata to wrap, collapse, move, or enter an overflow menu where appropriate.

Do not solve narrow widths by stacking every region into one long single-column page.

Do not introduce a hamburger/mobile website shell unless the actual Vesta shell uses one.

Avoid horizontal overflow unless the content genuinely requires it.

Long localized text and user-provided names must be considered.

## Interaction states

For every interactive component, consider relevant states before declaring it complete:

- default
- hover
- active or pressed
- keyboard focus
- selected
- disabled
- loading or pending
- empty
- error
- success where applicable
- long text
- unavailable image or artwork
- reduced motion

For data-driven views also consider:

- zero items
- one item
- many items
- slow backend response
- partial metadata
- stale data
- destructive action confirmation

Do not design only the ideal populated state.

## Accessibility

Accessibility is required for new UI work even where formal project conformance is not yet defined.

Use semantic HTML and the existing accessible primitives.

Requirements:

- logical heading order
- visible keyboard focus
- labels for inputs and icon-only controls
- adequate text and control contrast
- no critical information communicated by color alone
- reduced-motion support
- usable disabled states
- appropriate ARIA only where native semantics are insufficient
- status updates exposed appropriately when content changes asynchronously
- target sizes appropriate for desktop use

Do not remove focus outlines without replacing them with an equally clear focus state.

Do not hide important text only on hover.

## Native desktop behavior

Vesta runs in Tauri and must account for operating-system behavior.

Consider:

- window effects differ by platform
- requested effects may be unsupported
- startup theme application must not depend on delayed decorative effects
- draggable title-bar regions can affect interaction placement
- file operations and native dialogs have desktop expectations
- keyboard and pointer input are both primary interaction methods

Do not make essential hierarchy depend on a native effect that can be unavailable.

## Forbidden default patterns

Do not use any of the following as a default design move:

- generic dark SaaS dashboard composition
- oversized rounded corners
- pill overload
- floating detached page shells
- decorative glass panels
- soft corporate gradients used only for style
- random glows or blur haze
- decorative sidebar art
- control-room styling
- fake command-center styling
- serif display font plus system sans pairing
- sticky secondary rails without a real information-architecture need
- metric-card grids
- fake charts
- donut charts for decorative percentages
- hero sections inside operational pages
- dead space added to look premium
- overpadded sections
- decorative copy
- uppercase eyebrow labels
- giant heading/subtitle blocks
- status dots added with pseudo-elements for decoration
- gradient-filled progress bars unless the existing progress component requires them
- workspace cards in navigation
- navigation "Live" badges without functional meaning
- decorative quota panels
- decorative footer metadata
- colored trend text without actual trend semantics
- nested generic panel systems
- one-off design systems inside individual pages

If a layout looks like it could have been generated for any unrelated admin dashboard, revise it until it is specific to Vesta's task and existing UI system.

## Required implementation workflow

For frontend design work, follow this sequence.

### Inspect

Find the closest existing page, component, primitive, tokens, and state/data source.

Do not start by inventing a new visual concept.

### Define the task

Identify:

- what the user is trying to do
- primary information
- secondary information
- primary action
- secondary actions
- exceptional, loading, empty, and error states

Do this before deciding on cards, badges, layout decoration, or animation.

### Reuse components

Use existing `vesta-launcher/ui/` primitives and `src/components/` composition patterns.

Extend existing components when the change belongs there.

Do not duplicate shared behavior in page-local code.

When the design needs an icon or visual asset, inspect `vesta-launcher/src/assets/` before adding text, inline SVG, a package icon, or a new asset. Reuse the existing categorized SVG library where possible.

### Use semantic tokens

Use shared theme variables and component tokens.

Do not create a private palette, private blur system, private shadow system, or private theme assumptions.

### Check the theme matrix

At minimum, reason through:

- glass
- frosted
- flat
- dark
- light
- default primary hue
- a substantially different primary hue
- gradients on
- gradients off
- lower opacity
- higher opacity
- window effect available
- window effect unavailable
- normal motion
- reduced motion
- normal desktop width
- narrow supported desktop width

The same component structure should continue to work.

### Check content states

Check relevant default, loading, empty, error, disabled, selected, long-text, and many-item states.

### Remove unnecessary generated decoration

Before finishing, remove elements that do not support the task.

Common removals include:

- eyebrow labels
- decorative subtitles
- unnecessary wrapper cards
- icon tiles
- fake badges
- random gradients
- redundant shadows
- hover movement
- decorative status dots
- fake statistics
- explanatory note cards
- repeated helper text

## Review checklist

Before accepting a Vesta UI change, verify all applicable items:

- [ ] Existing Vesta primitives were reused where appropriate.
- [ ] No duplicate component was introduced without a clear need.
- [ ] Semantic theme tokens are used instead of hard-coded decorative colors.
- [ ] The UI does not assume the default teal hue.
- [ ] The UI remains coherent in glass, frosted, and flat modes.
- [ ] The UI remains readable in light and dark schemes.
- [ ] The structure still works with gradients disabled.
- [ ] The structure still works without blur or native window effects.
- [ ] Semantic colors are used only for semantic meaning.
- [ ] Focus states are visible.
- [ ] Reduced motion is respected.
- [ ] Narrow desktop widths are handled deliberately.
- [ ] Long text and localization are considered.
- [ ] Loading, empty, disabled, selected, and error states are handled where relevant.
- [ ] The page uses real Vesta or Minecraft information rather than filler.
- [ ] The page does not resemble a generic SaaS dashboard.
- [ ] The page does not use a hero or KPI grid by default.
- [ ] Cards are used only where grouping or interaction requires them.
- [ ] Pills and badges are not overused.
- [ ] Shadows and blur are not used as substitutes for hierarchy.
- [ ] Copy is direct, minimal, literal, and product-specific.
- [ ] Headers and labels use normal terminology instead of invented names or elaborate phrasing.
- [ ] Visual structure or icons are used instead of redundant explanatory copy where appropriate.
- [ ] Existing assets were checked before creating a new SVG.
- [ ] New generic UI SVGs are stored under the existing `src/assets/` structure and imported through `@assets/*`.
- [ ] Generic reusable UI SVGs use `currentColor` instead of hard-coded presentation colors.
- [ ] New or modified SVGs were cleaned of unnecessary editor/export markup and visually checked at their intended size.
- [ ] Specific artwork was not guessed when a placeholder asset and user-provided final SVG would be more accurate.
- [ ] No decorative element was added only because it is a common generated-UI pattern.
- [ ] The result fits the existing Vesta shell and page composition.

## Final requirement

Use the existing Vesta design system as the source of visual decisions. Use the theme engine as the source of dynamic appearance. Use existing components as the source of interaction patterns.

Do not invent a separate visual language for a feature.

Do not add generic UI decoration to make a page look more designed.

Build the simplest layout that clearly supports the task and remains correct across Vesta's supported themes, states, and desktop conditions.
