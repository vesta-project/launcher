import { expect, test } from "bun:test";
import {
  themePresets,
  defaultTheme,
  resolveThemeTokens,
} from "../src/features/settings/theme-model";
import { SettingsWriteQueue } from "../src/features/settings/write-queue";

test("built-ins declare capabilities; only Vesta opts into glow spots", () => {
  const byId = Object.fromEntries(
    themePresets.map((preset) => [preset.id, resolveThemeTokens(preset.values)]),
  );
  expect(themePresets.map((preset) => preset.id)).toEqual(["vesta", "slate", "mono", "aurora"]);
  const definitions = Object.fromEntries(themePresets.map((p) => [p.id, p.definition]));
  expect(definitions.mono.hue).toBeNull();
  expect(definitions.mono.hueAdjustable).toBe(false);
  expect(definitions.aurora.hueAdjustable).toBe(false);
  expect(definitions.aurora.fixedHues).toEqual([165, 285, 330]);
  expect(definitions.slate.background).toBe("none");
  expect(byId.vesta["--vesta-theme-background"]).toContain("radial-gradient");
  expect(byId.slate["--vesta-theme-background"]).toBe("none");
  expect(byId.mono["--vesta-theme-background"]).toBe("none");
  expect(byId.aurora["--vesta-theme-background"]).toContain("linear-gradient");
  expect(byId.slate["--vesta-radius-factor"]).not.toBe(byId.vesta["--vesta-radius-factor"]);
  expect(byId.slate["--vesta-space-unit"]).not.toBe(byId.vesta["--vesta-space-unit"]);
  expect(byId.slate["--vesta-neutral-hue"]).toBe("255");
  expect(byId.mono["--vesta-theme-accent-chroma-dark"]).toBe("0");
  expect(byId.aurora["--vesta-theme-accent-hue"]).toBe("285");
  // Fixed-hue themes ignore the stored hue setting.
  expect(
    resolveThemeTokens({ ...themePresets[3].values, hue: 10 })["--vesta-theme-accent-hue"],
  ).toBe("285");
  // Unknown ids fall back to Vesta.
  expect(resolveThemeTokens({ ...defaultTheme, id: "gone" })).toEqual(
    resolveThemeTokens(defaultTheme),
  );
});

test("materials resolve to structurally different tokens", () => {
  const glass = resolveThemeTokens({ ...defaultTheme, material: "glass" });
  const frosted = resolveThemeTokens({ ...defaultTheme, material: "frosted" });
  expect(glass["--vesta-theme-overlay-blur"]).toBe("blur(12px) saturate(1.4)");
  expect(frosted["--vesta-theme-overlay-blur"]).toBe("blur(28px) saturate(1.1)");
  expect(glass["--vesta-theme-grain-opacity"]).toBe("0");
  expect(Number(frosted["--vesta-theme-grain-opacity"])).toBeGreaterThan(0);
  expect(
    Number(resolveThemeTokens({ ...defaultTheme, material: "frosted", grain: 100 })["--vesta-theme-grain-opacity"]),
  ).toBeCloseTo(0.14);
});

test("every material and background control resolves to a real token change", () => {
  const base = resolveThemeTokens(defaultTheme);
  expect(resolveThemeTokens({ ...defaultTheme, gradient: false })["--vesta-theme-background"]).toBe(
    "none",
  );
  for (const patch of [
    { gradientType: "linear" },
    { gradientAngle: 270 },
    { gradientHarmony: "triadic" },
  ])
    expect(resolveThemeTokens({ ...defaultTheme, ...patch })["--vesta-theme-background"]).not.toBe(
      base["--vesta-theme-background"],
    );
  expect(
    resolveThemeTokens({ ...defaultTheme, translucency: 90 })["--vesta-theme-overlay-opacity"],
  ).not.toBe(base["--vesta-theme-overlay-opacity"]);
  expect(resolveThemeTokens({ ...defaultTheme, borderWidth: 2.5 })["--vesta-border-width"]).toBe(
    "2.5px",
  );
  const flat = resolveThemeTokens({ ...defaultTheme, material: "flat" });
  for (const layer of ["canvas", "chrome", "panel", "overlay"])
    expect(flat[`--vesta-theme-${layer}-opacity`]).toBe("100%");
  expect(flat["--vesta-theme-grain-opacity"]).toBe("0");
  expect(flat["--vesta-theme-overlay-blur"]).toBe("none");
  // Layering: canvas is the most transparent layer.
  const parse = (value) => Number.parseFloat(value);
  expect(parse(base["--vesta-theme-canvas-opacity"])).toBeLessThan(
    parse(base["--vesta-theme-chrome-opacity"]),
  );
  expect(parse(base["--vesta-theme-chrome-opacity"])).toBeLessThan(
    parse(base["--vesta-theme-panel-opacity"]),
  );
});

test("many slider events coalesce across tasks; release commits the final value", async () => {
  const calls = [];
  const queue = new SettingsWriteQueue(
    async (updates) => calls.push(updates),
    () => {},
    () => {},
    200,
  );
  const done = queue.enqueue("hue", 0);
  await Promise.resolve();
  for (let i = 1; i <= 300; i++) queue.enqueue("hue", i);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(calls).toEqual([]);
  expect(queue.pending()).toEqual({ hue: 300 });
  queue.flush();
  await done;
  expect(calls).toEqual([{ hue: 300 }]);
});
