# Vesta UI

Independent Solid 2 component library built on Kobalte. It never imports launcher code (`src/`), native APIs or the workbench — `oxlint` enforces this. The launcher themes it through tokens and hooks; customisation lives in the launcher, not here.

```
ui/
  index.ts                 public exports (also loads foundation CSS)
  foundation/              tokens.css, base.css (tones, focus), types.ts
  components/<name>/       <name>.tsx, <name>.css, <name>.stories.tsx, index.ts
```

Run the visual workbench with `bun run workbench` (http://localhost:1431).

## Cascade layers

`@layer reset, ui, launcher, theme, preferences;` is declared once by the host page. The library fills `ui.tokens`, `ui.base` and `ui.components`. Later layers override normal declarations in earlier stylesheet layers, so the launcher and advanced themes can override library styles **without `!important` or specificity tricks**. Within `theme`, the launcher declares `theme.generated, theme.author`: generated root inputs are stylesheet declarations, and native-validated author output goes into the later owned sublayer. This does not defeat conflicting inline properties on the same element; inline control measurements and overlay positioning remain application-owned. Never use `!important` in the library.

## Tokens

One vocabulary, `--vesta-*`. The library ships complete defaults; the launcher redeclares the same names in `launcher.tokens` (it does not invent parallel ones).

| Family | Examples |
| --- | --- |
| Colour roles | `--vesta-color-{canvas,surface,surface-raised,surface-sunken,text,text-muted,text-subtle,border,border-strong,fill,fill-hover,fill-active,focus,overlay,overlay-text,tooltip,tooltip-text}` |
| Tones | `--vesta-color-{accent,danger,warning,success}`, `-hover`, `-active`, `-text`, `-border`, `--vesta-color-on-{tone}` |
| Space | `--vesta-space-{0-5,1,1-5,2,3,4,5,6,8,10,12}` from `--vesta-space-unit` |
| Sizing | `--vesta-size-control-{sm,md,lg}` (24/28/32), `--vesta-size-icon-{sm,md,lg}` |
| Type | `--vesta-font-{sans,mono}`, `--vesta-text-{xs…2xl}`, `--vesta-leading-*`, `--vesta-weight-*` |
| Radii | `--vesta-radius-{sm,md,lg,xl}` scaled by `--vesta-radius-factor`; `--vesta-radius-{control,container}` aliases; `--vesta-radius-full` is an independent pill radius |
| Lines, states | `--vesta-border-width`, `--vesta-focus-{width,offset}`, `--vesta-state-{hover,active,soft}`, `--vesta-opacity-disabled` |
| Elevation | `--vesta-shadow-{sm,md,lg}` |
| Motion | `--vesta-duration-{fast,normal,slow}`, `--vesta-ease-{standard,out}` (zeroed for reduced motion) |
| Layering | `--vesta-z-{dropdown,overlay,modal,toast,tooltip}` |

Colour tokens are declared on scheme roots, `:where(:root, [data-vesta-scheme])`; `data-vesta-scheme="light|dark"` can switch a subtree. Add a token only when a component needs it.

## Hooks

Every stable node carries `data-vesta="<component>"` or `data-vesta="<component>-<part>"`. State is exposed through `data-variant`, `data-tone`, `data-size` and Kobalte's state attributes (`data-disabled`, `data-invalid`, `data-expanded`, …). Generated class names and DOM nesting are not part of the contract.

## Author-theme capability example

Open **Foundations / Theme contract / Author stylesheet capability** in the workbench (`bun run workbench`, port 1431). The current reference and candidate render the same real controls; the development-only switch applies/removes a Windows 2000–inspired stylesheet without replacing them or resetting their state.

- `src/styles/theme-contract.stories.tsx` owns the demo, its scope marker and an `OverlayMount` inside each sample. Dialogs, menus and a select nested in a dialog must inherit the owning sample's theme, not the neighbouring sample or workbench chrome.
- `src/styles/themes/windows-2000.css` is a trusted, bundled author-style example in `@layer theme`. Its `[data-vesta-theme-example='windows-2000']` marker is fixture-owned, **not** a production preset or public import format. The benchmark intentionally uses a fixed light palette, including in a dark workbench surround.
- Theme authors use semantic tokens for broad appearance and documented `data-vesta` parts/states for bevels, pressed controls, disabled treatment and focus. Do not target generated classes, depend on incidental nesting, inject replacement controls, or reorder the logical workflow. Keyboard focus uses real `:focus-visible`; popup highlighting uses the primitive's actual state.
- A descendant's changed inputs do not recompute aliases already resolved on an ancestor: when scoping type or geometry, set the consumed aliases at that scope too. For example, setting only `--vesta-radius-factor: 0` on a subtree does not reset inherited control radii or the independent pill radius. Local `--tone-*` roles resolve on each toned control from the semantic colours; component knobs can then refine individual parts.

This is a **styling capability fixture**, not an accessibility certification or a replacement for native verification. There is no new normal-settings control or shipped Classic preset. The native Imported themes integration has a separate parsed CSS/resource policy and Keep/Revert recovery flow; see [author format and recovery](../examples/README.md). `examples/windows-2000.vestatheme` is deterministically derived from this trusted fixture at document scope. Neither the fixture nor its generator validates untrusted CSS.

## Component checklist

Follow `button` (reference implementation) and `field` (shared form anatomy):

1. Wrap the matching Kobalte primitive; never re-implement keyboard, focus or ARIA behaviour.
2. Axes are independent props: `variant`, `tone` (`Tone`), `size` (`ControlSize`). Reuse existing values before adding new ones.
3. Colour comes only from the tone roles (`--tone-solid`, `--tone-on-solid`, `--tone-text`, `--tone-border`, `--tone-soft`, `--tone-hover`, `--tone-active`) or `--vesta-color-*` roles — no literal colours.
4. Each component exposes `--<component>-*` knobs. Variant/size/state rules only reassign knobs; one base rule turns knobs into properties.
5. Selectors are `:where(...)` attribute selectors inside `@layer ui.components`, preceded by the `@layer ui.tokens, ui.base, ui.components;` order statement.
6. Heights use `--vesta-size-control-*` so mixed rows align; text never wraps inside controls; desktop cursor (`default`).
7. Focus uses the shared ring from `base.css`. Hover/active never move the element.
8. Apply prop defaults with `??` where they are used (`data-size={props.size ?? 'md'}`), not with `merge()`: wrappers forward optional props as explicit `undefined`, which `merge()` treats as set.
9. Never forward an optional `id` as `id={props.id}` when it may be unset — Kobalte stringifies `undefined` into the literal id `"undefined"`, colliding every instance. Spread only when present: `{...(props.id != null ? { id: props.id } : {})}`.
10. Add a story file that shows every axis plus long labels and an in-context composition.

### Overlays and composition

- Overlays (menu, popover, dialog, tooltip) take a `trigger` render prop and spread its props onto any library control: `trigger={(props) => <Button {...props}>Options</Button>}`.
- They portal into the nearest `<OverlayMount>` (default `document.body`); wrap a themed or `[data-vesta-scheme]` subtree in one so overlays inherit its tokens.
- They share the `--overlay-*` surface knobs (`overlay/overlay.css`). Enter/exit motion must be keyframe animations on `data-expanded`/`data-closed`; Kobalte waits for `animationend` before unmounting.
- When one element receives two sets of Kobalte props (e.g. an IconButton's tooltip plus a menu trigger), merge them with `mergeElementProps` (`internal/props.ts`) so handlers chain and Solid 2 ref arrays survive.
- Form toggles share `choice/choice.css`; labelled inputs share `field/field.css`.

## Accessibility rules

- Hover-only actions also show on `:focus-within`, so keyboard users reach them.
- Icon-only buttons take a `label`; it is the accessible name and the tooltip.
- Dialogs take a `title`, and callers pass a localized `closeLabel` (the English default is a fallback only).
- Never `outline: none` without a replacement `:focus-visible` ring from `base.css`.
- Use native controls (`button`, `a href`), not clickable `div`s. Desktop cursor is `default`.
- State is not colour-only: pair it with text, a shape, or an ARIA attribute.
- Forced colours drop background and border tints, so background-only state also needs an outline under `@media (forced-colors: active)`.
- Reduced motion: use `--vesta-duration-*` tokens, never literal durations; they zero out under `prefers-reduced-motion`.
- Timed UI is explained where it lives. The image viewer hides its chrome after 3.5 s idle, but not while hovered or focused; any key or pointer brings it back.
- Shared UI never imports launcher i18n. Localized strings arrive as props (`closeLabel`, `previousLabel`, `nextLabel`).
