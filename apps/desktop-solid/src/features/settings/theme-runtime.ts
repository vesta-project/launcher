import { createEffect, createMemo } from "solid-js";
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
  const grain = createGrainImage();
  if (grain)
    document.documentElement.style.setProperty(
      "--vesta-theme-grain-image",
      `url("${grain}")`,
    );
  const theme = createMemo<ThemeValues>(
    () => ({
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
  createEffect(
    () => resolveThemeTokens(theme()),
    (tokens) => {
      const root = document.documentElement;
      // Update only changed properties. CSS handles palette derivation; no DOM measurement or rebuild.
      for (const [key, value] of Object.entries(tokens))
        if (root.style.getPropertyValue(key) !== value)
          root.style.setProperty(key, value);
    },
  );
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
}
