# Author themes (contract 1)

Native desktop Appearance → **Imported themes** accepts a local UTF-8 theme file. Import adds an inactive entry. **Try theme…** paints a transient preview in that window, then asks through an OS-native Keep/Revert dialog. The host deadline is 30 seconds; a late Keep is ignored. Browser/workbench mode does not provide native import or persistence.

The simplest form is a plain stylesheet whose first comment is a `@vesta-theme` header:

```css
/* @vesta-theme
 * name: My theme
 * contract: 1
 * base: {"mode": "light", "material": "flat"}
 */
@layer theme {
  :root { --vesta-color-canvas: #d4d0c8; }
}
```

`name` is required; `contract` defaults to 1; `base` is optional and may list only the built-in settings you want to change (the rest use Vesta's defaults; unknown keys are rejected). Header problems are reported with their line number. See `windows-2000.css`.

The JSON envelope (`.vestatheme`) is also accepted and takes the same partial `base`:

```json
{
  "type": "vesta-author-theme",
  "formatVersion": 1,
  "contractVersion": 1,
  "name": "My theme",
  "css": ":root { --vesta-color-canvas: #d4d0c8; }"
}
```

An imported base supplies the effective colour mode without replacing the user's retained built-in choices. Native window effects are separate and are never imported.

## Supported CSS

- Ordinary, non-nested selector/declaration rules, optionally inside one exact `@layer theme { … }` wrapper. The host parses and canonicalizes these into its owned `theme.author` sublayer, after `theme.generated`.
- Root `--vesta-*` tokens and public `data-vesta` component parts; real `:focus-visible`, hover, checked, expanded, highlighted and disabled states. See [the UI contract](../ui/README.md) and the classic sample for concrete hooks.
- CSS colours, gradients, geometry, system font stacks and supported resource-free value functions. Unsupported functions/syntax fail closed; this first version is deliberately narrower than the browser's CSS grammar.
- No `!important`, imports, font definitions, resource URLs (including data/file URLs), image-set sources, author layer reordering, conditional rules, nesting or keyframes. No downloaded stylesheets, image/font bundles, archives or network assets. Escaped syntax and custom-property values are inspected too.

Limits: 256 KiB envelope, 128 KiB CSS, 128-character name and 16 saved imports, with additional host parser/store complexity budgets. Invalid imports leave the current selection unchanged. Identical names are not an instruction to overwrite a saved theme. Legacy `vesta-theme` files are not translated.

Set aliases where they are consumed: changing an input in a descendant does not recompute an inherited alias. `--vesta-radius-full` is independent of the radius factor. Root author tokens override generated stylesheet declarations without `!important`; component inline measurements/overlay positioning remain owned by the application. The final `preferences` layer retains accessibility preference behavior.

Generated classes and incidental DOM nesting are **not** compatibility APIs. Do not replace controls, change keyboard semantics or reorder workflows. Contract version 1 identifies the token/part contract; unsupported versions are rejected rather than guessed.

## Recovery and trust

CSS validation enforces the supported syntax/resource policy. It is **not a CSS sandbox**, a guarantee of readable UI, or a theme-wide accessibility certification. A theme can hide or visually spoof controls. Only import files you trust.

Choose **Use built-in appearance**, select any built-in preset, or remove the active import to return to built-in appearance. For an unusable theme, launch Vesta with:

```text
--disable-custom-theme
```

The argument also works when another instance is already running. It clears custom selection without deleting the library, retained built-in choices or unrelated launcher data. Preview is never a durable selection until confirmed through the native dialog. Hidden windows refetch authoritative state before reapplying author CSS.

## Classic acceptance sample

`windows-2000.css` (and the equivalent `windows-2000.vestatheme`) demonstrates the required restyling depth; it is not a default or a built-in Classic preset. Regenerate it from the trusted workbench fixture with:

```sh
bun scripts/classic-theme.mjs
```

The generator only converts our trusted fixture scope to `:root`; it is **not** the untrusted-input validator. A focused test checks exact derivation so the fixture and both example files cannot silently drift. Native end-to-end acceptance remains a separate verification gate from generation or parser tests.
