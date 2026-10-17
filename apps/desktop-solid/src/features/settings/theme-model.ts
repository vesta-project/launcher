/** New rewrite contract. No legacy theme IDs, CSS selectors, or theme_data conversion. */
export const themeFields = {
  theme_id: "id",
  theme: "mode",
  theme_primary_hue: "hue",
  theme_style: "material",
  theme_translucency: "translucency",
  theme_grain: "grain",
  theme_gradient_enabled: "gradient",
  theme_gradient_type: "gradientType",
  theme_gradient_angle: "gradientAngle",
  theme_gradient_harmony: "gradientHarmony",
  theme_border_width: "borderWidth",
} as const;
export const defaultTheme = {
  id: "vesta",
  mode: "system",
  hue: 185,
  material: "glass",
  translucency: 60,
  grain: 20,
  gradient: true,
  gradientType: "radial",
  gradientAngle: 135,
  gradientHarmony: "analogous",
  borderWidth: 1,
} as const;

export function themeSettings(
  theme: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(themeFields).map(([key, field]) => [
      key,
      theme[field] ?? defaultTheme[field],
    ]),
  );
}

export function splitThemeUpdates(updates: Record<string, unknown>) {
  const theme: Record<string, unknown> = {};
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (Object.hasOwn(themeFields, key))
      theme[themeFields[key as keyof typeof themeFields]] = value;
    else config[key] = value;
  }
  return { theme, config };
}

export const THEME_MIRROR_KEY = "vesta:rewrite-theme:v1";

export type ThemeValues = {
  [K in keyof typeof defaultTheme]: (typeof defaultTheme)[K] extends number
    ? number
    : (typeof defaultTheme)[K] extends boolean
      ? boolean
      : string;
};

/** Declarative theme: capabilities decide which controls exist and how tokens resolve. */
export interface ThemeDefinition {
  id: string;
  name: string;
  /** null = the theme has no accent hue (Mono); a number is the default hue. */
  hue: number | null;
  /** Show the hue slider. */
  hueAdjustable: boolean;
  neutral: { hue: "accent" | number; chroma: { dark: number; light: number } };
  /** 0 = achromatic accent (Mono). */
  accentChroma: { dark: number; light: number };
  /** Radius factor and density unit. */
  radius: number;
  spaceUnit: string;
  /** spots = the Vesta signature glow only. */
  background: "spots" | "gradient" | "none";
  /** Default material. */
  material: "glass" | "frosted" | "flat";
  shadows: "soft" | "crisp" | "none";
  /** A fixed palette that ignores colour harmony (Aurora). */
  fixedHues?: [number, number, number];
}

export const themeDefinitions: readonly ThemeDefinition[] = [
  {
    id: "vesta",
    name: "Vesta",
    hue: 185,
    hueAdjustable: true,
    neutral: { hue: "accent", chroma: { dark: 0.01, light: 0.025 } },
    accentChroma: { dark: 0.12, light: 0.16 },
    radius: 1,
    spaceUnit: "4px",
    background: "spots",
    material: "glass",
    shadows: "soft",
  },
  {
    id: "slate",
    name: "Slate",
    hue: 220,
    hueAdjustable: true,
    neutral: { hue: 255, chroma: { dark: 0.004, light: 0.006 } },
    accentChroma: { dark: 0.1, light: 0.13 },
    radius: 0.4,
    spaceUnit: "3.5px",
    background: "none",
    material: "flat",
    shadows: "crisp",
  },
  {
    id: "mono",
    name: "Mono",
    hue: null,
    hueAdjustable: false,
    neutral: { hue: 0, chroma: { dark: 0, light: 0 } },
    accentChroma: { dark: 0, light: 0 },
    radius: 0.75,
    spaceUnit: "4px",
    background: "none",
    material: "flat",
    shadows: "crisp",
  },
  {
    id: "aurora",
    name: "Aurora",
    hue: 285,
    hueAdjustable: false,
    neutral: { hue: 285, chroma: { dark: 0.02, light: 0.03 } },
    accentChroma: { dark: 0.17, light: 0.2 },
    radius: 1.25,
    spaceUnit: "4px",
    background: "gradient",
    material: "glass",
    shadows: "soft",
    fixedHues: [165, 285, 330],
  },
];

/** Unknown stored ids fall back to Vesta. */
export function themeDefinition(id: string): ThemeDefinition {
  return (
    themeDefinitions.find((definition) => definition.id === id) ??
    themeDefinitions[0]!
  );
}

/** Settings written when a preset is chosen. Colour mode and window effect are never touched. */
export function presetUpdates(
  definition: ThemeDefinition,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    theme_id: definition.id,
    theme_style: definition.material,
    theme_gradient_enabled: definition.background !== "none",
    theme_gradient_type:
      definition.background === "gradient" ? "linear" : "radial",
  };
  if (definition.hue !== null) updates.theme_primary_hue = definition.hue;
  return updates;
}

export const themePresets: {
  id: string;
  name: string;
  definition: ThemeDefinition;
  values: ThemeValues;
}[] = themeDefinitions.map((definition) => ({
  id: definition.id,
  name: definition.name,
  definition,
  values: {
    ...defaultTheme,
    id: definition.id,
    hue: definition.hue ?? defaultTheme.hue,
    material: definition.material,
    gradient: definition.background !== "none",
    gradientType: definition.background === "gradient" ? "linear" : "radial",
  },
}));

const wrap = (hue: number) => ((hue % 360) + 360) % 360;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const pct = (value: number) => `${Math.round(value * 10) / 10}%`;

/** Hue the accent palette really uses: adjustable themes follow the setting, others are fixed. */
export function effectiveHue(definition: ThemeDefinition, hue: number): number {
  if (definition.hueAdjustable && Number.isFinite(hue)) return wrap(hue);
  return definition.hue ?? 0;
}

/** Pure application token resolver. No UI library, DOM, native API or persistence dependency. */
export function resolveThemeTokens(theme: ThemeValues): Record<string, string> {
  const def = themeDefinition(theme.id);
  const hue = effectiveHue(def, theme.hue);
  const material = theme.material;
  const flat = material === "flat";
  const frosted = material === "frosted";
  const t = clamp(
    Number.isFinite(theme.translucency) ? theme.translucency : 0,
    0,
    100,
  );

  // Structure: canvas (most transparent) < chrome < panels < overlays; dense surfaces are opaque in CSS.
  const canvas = flat ? 100 : frosted ? 80 - 0.2 * t : 70 - 0.3 * t;
  const chrome = flat ? 100 : frosted ? 94 - 0.15 * t : 90 - 0.3 * t;
  const panel = flat ? 100 : frosted ? 97 - 0.1 * t : 96 - 0.15 * t;
  const overlay = flat ? 100 : frosted ? 94 - 0.2 * t : 92 - 0.37 * t;

  // Colours of the three background accents.
  const harmony = theme.gradientHarmony;
  const secondary =
    harmony === "complementary"
      ? hue + 180
      : harmony === "triadic"
        ? hue + 120
        : harmony === "analogous"
          ? hue + 30
          : hue;
  const end =
    harmony === "triadic"
      ? hue + 240
      : harmony === "analogous"
        ? hue - 30
        : hue;
  const vestaSignature = def.id === "vesta" && harmony === "analogous";
  const colors: [string, string, string] = def.fixedHues
    ? [
        `oklch(0.74 0.14 ${def.fixedHues[0]})`,
        `oklch(0.62 0.2 ${def.fixedHues[1]})`,
        `oklch(0.76 0.16 ${def.fixedHues[2]})`,
      ]
    : [
        `oklch(0.74 0.13 ${hue})`,
        vestaSignature
          ? "oklch(0.6 0.2 285)"
          : `oklch(0.6 0.12 ${wrap(secondary)})`,
        vestaSignature
          ? "oklch(0.76 0.15 60)"
          : `oklch(0.76 0.12 ${wrap(end)})`,
      ];
  // Strength scales with --vesta-bg-strength (stronger in light mode); see theme-runtime.css.
  const mix = (color: string, strength: number) =>
    `color-mix(in oklab, ${color} calc(${strength}% * var(--vesta-bg-strength, 1)), transparent)`;
  const strengths: [number, number, number] =
    def.background === "gradient" ? [20, 18, 20] : [13, 13, 12];
  const spot = (x: number, y: number) => {
    const angle = ((theme.gradientAngle - 135) * Math.PI) / 180;
    return `${50 + (x - 50) * Math.cos(angle) - (y - 50) * Math.sin(angle)}% ${50 + (x - 50) * Math.sin(angle) + (y - 50) * Math.cos(angle)}%`;
  };
  const radians = (theme.gradientAngle * Math.PI) / 180;
  let background = "none";
  if (def.background !== "none" && theme.gradient) {
    background =
      theme.gradientType === "radial"
        ? def.background === "spots"
          ? `radial-gradient(55% 50% at ${spot(0, 0)}, ${mix(colors[0], strengths[0])}, transparent 72%), radial-gradient(50% 55% at ${spot(100, 100)}, ${mix(colors[1], strengths[1])}, transparent 72%), radial-gradient(30% 30% at ${spot(62, 108)}, ${mix(colors[2], strengths[2])}, transparent 75%)`
          : `radial-gradient(ellipse at ${50 + 40 * Math.cos(radians)}% ${50 + 40 * Math.sin(radians)}%, ${mix(colors[0], strengths[0])}, ${mix(colors[1], strengths[1] * 0.6)} 55%, ${mix(colors[2], strengths[2] * 0.4)} 100%)`
        : `linear-gradient(${theme.gradientAngle}deg, ${mix(colors[0], strengths[0])}, ${mix(colors[1], strengths[1])}, ${mix(colors[2], strengths[2])})`;
  }

  const neutralHue = def.neutral.hue === "accent" ? hue : def.neutral.hue;
  const shadows =
    def.shadows === "soft"
      ? [
          "0 1px 2px oklch(0 0 0 / 0.12)",
          "0 4px 12px oklch(0 0 0 / 0.16)",
          "0 12px 32px oklch(0 0 0 / 0.24)",
        ]
      : def.shadows === "crisp"
        ? [
            "0 1px 1px oklch(0 0 0 / 0.2)",
            "0 2px 6px oklch(0 0 0 / 0.22)",
            "0 6px 16px oklch(0 0 0 / 0.3)",
          ]
        : ["none", "none", "0 4px 12px oklch(0 0 0 / 0.18)"];

  return {
    "--vesta-theme-accent-hue": String(hue),
    "--vesta-neutral-hue": String(neutralHue),
    "--vesta-theme-neutral-chroma-dark": String(def.neutral.chroma.dark),
    "--vesta-theme-neutral-chroma-light": String(def.neutral.chroma.light),
    "--vesta-theme-accent-chroma-dark": String(def.accentChroma.dark),
    "--vesta-theme-accent-chroma-light": String(def.accentChroma.light),
    "--vesta-space-unit": def.spaceUnit,
    "--vesta-radius-factor": String(def.radius),
    "--vesta-border-width": `${theme.borderWidth}px`,
    "--vesta-theme-canvas-opacity": pct(canvas),
    "--vesta-theme-chrome-opacity": pct(chrome),
    "--vesta-theme-panel-opacity": pct(panel),
    "--vesta-theme-overlay-opacity": pct(overlay),
    "--vesta-theme-overlay-blur": flat
      ? "none"
      : frosted
        ? "blur(28px) saturate(1.1)"
        : "blur(12px) saturate(1.4)",
    // Grain is texture, not transparency: 0..100 maps to 0..0.8 intensity of a full-contrast noise
    // overlay (blended with overlay/soft-light). Flat material is opaque and crisp, so it has none.
    "--vesta-theme-grain-opacity": flat
      ? "0"
      : String(Math.round(clamp(theme.grain, 0, 100) * 8) / 1000),
    "--vesta-theme-background": background,
    "--vesta-theme-shadow-sm": shadows[0]!,
    "--vesta-theme-shadow-md": shadows[1]!,
    "--vesta-theme-shadow-lg": shadows[2]!,
  };
}
