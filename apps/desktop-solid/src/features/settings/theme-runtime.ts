import { createEffect, createMemo, onCleanup } from "solid-js";
import { setThemeSchemeOverride, type SchemePreference } from '../../app/preferences';
import { appearanceSnapshot, authorThemePreview, authorThemesAvailable, authorThemesError, authorThemesReady, useAuthorThemeSync } from './author-themes';
import { generatedThemeStyles, selectedAuthorTheme } from './author-theme-model';
import { setting } from "./config";
import {
  resolveThemeTokens,
  themeDefinition,
  type ThemeValues,
} from "./theme-model";
import "./theme-runtime.css";

/**
 * Tiled monochrome noise as a PNG data URL. Generated on a canvas because an SVG feTurbulence
 * background is low-contrast and renders inconsistently in WKWebView; a PNG is identical everywhere.
 */
function createGrainImage(size = 128): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.floor(Math.random() * 256);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** One application-level bridge; the independent UI library only consumes its public tokens. */
export function useThemeRuntime() {
  let finishStartup!: () => void;
  const ready = new Promise<void>((resolve) => { finishStartup = resolve; });
  useAuthorThemeSync();
  const grain = createGrainImage();
  // Three sheets with different lifetimes, so frequent edits never reparse the others:
  // the grain image (once), the generated tokens (each theme change, e.g. a hue drag) and
  // the author theme (only when the chosen import or its preview changes).
  const grainSheet = document.createElement('style');
  grainSheet.dataset.vestaThemeStyles = 'grain';
  if (grain) grainSheet.textContent = generatedThemeStyles({ '--vesta-theme-grain-image': `url("${grain}")` });
  const generated = document.createElement('style');
  generated.dataset.vestaThemeStyles = 'generated';
  const author = document.createElement('style');
  author.dataset.vestaThemeStyles = 'author';
  document.head.append(grainSheet, generated, author);
  const activeAuthor = createMemo(() => {
    const snapshot = authorThemePreview()?.candidate ?? appearanceSnapshot();
    return selectedAuthorTheme(snapshot);
  }, {
    name: 'activeAuthorTheme',
    // Snapshots are replaced on every refresh; only a different theme is a change.
    equals: (a, b) => a?.id === b?.id && a?.css === b?.css && JSON.stringify(a?.base) === JSON.stringify(b?.base),
  });
  const theme = createMemo<ThemeValues>(
    () => activeAuthor()?.base ?? ({
      id: setting("theme_id"),
      mode: setting("theme"),
      hue: setting("theme_primary_hue"),
      material: setting("theme_style"),
      translucency: setting("theme_translucency"),
      grain: setting("theme_grain"),
      gradient: setting("theme_gradient_enabled"),
      gradientType: setting("theme_gradient_type"),
      gradientAngle: setting("theme_gradient_angle"),
      gradientHarmony: setting("theme_gradient_harmony"),
      borderWidth: setting("theme_border_width"),
    }),
    { name: "resolvedThemeSettings" },
  );
  let clearedInline = false;
  createEffect(
    () => generatedThemeStyles({ ...resolveThemeTokens(theme()), '--vesta-accent-hue': String(theme().hue) }),
    (text) => {
      if (!clearedInline) {
        // Earlier builds (and HMR upgrades) set tokens inline on <html>; inline would win.
        clearedInline = true;
        const style = document.documentElement.style;
        // Copy first: removing properties changes the live declaration while iterating.
        for (const key of Array.from(style)) if (key.startsWith('--vesta-')) style.removeProperty(key);
      }
      if (generated.textContent !== text) generated.textContent = text;
    },
    { name: 'applyGeneratedTheme' },
  );
  createEffect(
    () => activeAuthor(),
    (entry) => {
      const root = document.documentElement;
      // Host-canonical output, already wrapped in the author layer. Never raw file text.
      const css = entry?.css ?? '';
      if (author.textContent !== css) author.textContent = css;
      if (entry) root.dataset.vestaAuthorTheme = entry.id;
      else delete root.dataset.vestaAuthorTheme;
      setThemeSchemeOverride(entry?.base.mode as SchemePreference | undefined);
    },
    { name: 'applyAuthorTheme' },
  );
  onCleanup(() => {
    grainSheet.remove();
    generated.remove();
    author.remove();
    delete document.documentElement.dataset.vestaAuthorTheme;
    setThemeSchemeOverride(undefined);
  });
  // Structural hooks for CSS. The applied native window effect is published by window-effects.ts
  // as data-vesta-window-effect (only after the native call succeeds).
  createEffect(
    () => {
      const definition = themeDefinition(theme().id);
      return [
        definition.id,
        theme().material,
        definition.accentChroma.dark === 0 ? "neutral" : "hue",
      ];
    },
    ([id, material, accent]) => {
      const root = document.documentElement;
      root.dataset.vestaTheme = id;
      root.dataset.vestaMaterial = material;
      root.dataset.vestaAccent = accent;
    },
  );
  // Presentation also waits for a paint after this promise, so the generated sheet,
  // canonical author sheet, root hooks and scheme have all reached the document.
  // A failed initial read allows the existing fallback UI and theme error to appear.
  createEffect(
    () => !authorThemesAvailable || authorThemesReady() || authorThemesError() !== undefined,
    (settled) => { if (settled) finishStartup(); },
    { name: 'initialThemeReady' },
  );
  return ready;
}
