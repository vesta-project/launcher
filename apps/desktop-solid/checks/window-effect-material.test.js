import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { effectiveCoverage, materialOpacities, resolveThemeTokens, defaultTheme } from "../src/features/settings/theme-model";
import { createWindowEffectDrain, resolveWindowEffect, windowEffectKey } from "../src/features/settings/window-effect-model";

const glass60 = { material: "glass", translucency: 60 };
const round = (value) => Math.round(value * 10) / 10;

test("effect reveal: one frame tint, ~67% library field, ~94% normal boards (glass/60)", () => {
  const o = materialOpacities(glass60);
  expect(o.canvas).toBe(52);
  expect(o.canvasLight).toBe(60);
  expect(o.library).toBe(30);
  // Frame (titlebar, rail, gutters): the shell canvas alone, no chrome stacked on it.
  expect(round(effectiveCoverage(o.canvas))).toBe(52);
  expect(round(effectiveCoverage(o.canvasLight))).toBe(60);
  // Previously titlebar/rail stacked chrome over canvas.
  expect(round(effectiveCoverage(o.canvas, o.chrome))).toBe(86.6);
  // Library card field and normal boards over the frame.
  expect(round(effectiveCoverage(o.canvas, o.library))).toBe(66.4);
  expect(round(effectiveCoverage(o.canvasLight, o.library))).toBe(72);
  expect(round(effectiveCoverage(o.canvas, o.panel))).toBe(93.8);
  expect(round(effectiveCoverage(o.canvasLight, o.panel))).toBe(94.8);
  // The CSS composes the field as panel x scale; it must equal the library alpha.
  expect(round((o.panel * o.libraryScale) / 100)).toBe(30);
});

test("coverage ordering holds across the slider and materials; flat stays opaque", () => {
  for (const material of ["glass", "frosted"]) {
    for (const translucency of [0, 25, 50, 60, 75, 100]) {
      const o = materialOpacities({ material, translucency });
      for (const frame of [o.canvas, o.canvasLight]) {
        const field = effectiveCoverage(frame, o.library);
        const board = effectiveCoverage(frame, o.panel);
        expect(frame).toBeGreaterThan(0);
        expect(field).toBeGreaterThan(frame);
        expect(board).toBeGreaterThan(field);
        expect(board).toBeGreaterThanOrEqual(85);
        expect(field).toBeGreaterThanOrEqual(50);
        expect(o.libraryScale).toBeGreaterThan(0);
        expect(o.libraryScale).toBeLessThanOrEqual(100);
      }
    }
  }
  const flat = materialOpacities({ material: "flat", translucency: 100 });
  expect([flat.canvas, flat.canvasLight, flat.panel, flat.library, flat.libraryScale]).toEqual([100, 100, 100, 100, 100]);
  const tokens = resolveThemeTokens(defaultTheme);
  expect(tokens["--vesta-theme-canvas-opacity-light"]).toMatch(/%$/);
  expect(tokens["--vesta-theme-library-board-scale"]).toMatch(/%$/);
});

test("reveal CSS: no extra titlebar/rail fill, reduced library board, author themes untouched", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const shell = read("../src/app/shell.css");
  const board = read("../src/components/board.css");
  const runtime = readFileSync(new URL("../src/features/settings/theme-runtime.css", import.meta.url), "utf8");
  const reveal = ":root[data-vesta-window-effect]:not([data-vesta-window-effect='none']):not([data-vesta-material='flat']):not([data-vesta-author-theme])";
  expect(shell).toContain(`${reveal}\n    [data-vesta='titlebar'] {\n    background: transparent;`);
  expect(shell).toContain(`${reveal}\n    [data-vesta='rail'] {\n    --rail-bg: transparent;`);
  expect(board).toContain(`${reveal}\n    :where([data-vesta='board'][data-showcase])`);
  expect(board).toContain("var(--vesta-color-panel) var(--vesta-theme-library-board-scale, 100%), transparent");
  expect(runtime).toContain("--vesta-theme-canvas-opacity-light");
  const page = readFileSync(new URL("../src/pages/library/library-page.tsx", import.meta.url), "utf8");
  expect(page).toContain("<Board showcase={(!nativeInstances || instancesLoaded()) && instances().length > 0}>");
});

test("window effect key includes the scheme; reduced transparency and unsupported fall back to none", () => {
  expect(windowEffectKey({ effect: "mica", scheme: "dark" })).not.toBe(windowEffectKey({ effect: "mica", scheme: "light" }));
  expect(resolveWindowEffect("mica", ["none", "mica"], false)).toBe("mica");
  expect(resolveWindowEffect("mica", ["none"], false)).toBe("none");
  expect(resolveWindowEffect("mica", ["none", "mica"], true)).toBe("none");
});

test("drain reapplies on a scheme change, serializes, coalesces and publishes solid on failure", async () => {
  const calls = [];
  const published = [];
  let release;
  let fail = false;
  const drain = createWindowEffectDrain({
    apply: (request) => {
      calls.push(`${request.effect}:${request.scheme}`);
      if (fail) return Promise.reject(new Error("dwm"));
      return new Promise((resolve) => { release = resolve; });
    },
    publish: (effect) => published.push(effect),
    disposed: () => false,
  });
  const first = drain.request({ effect: "mica", scheme: "dark" });
  // While the first call is in flight, two scheme flips coalesce into the latest one.
  drain.request({ effect: "mica", scheme: "light" });
  drain.request({ effect: "mica", scheme: "dark" });
  drain.request({ effect: "mica", scheme: "light" });
  expect(calls).toEqual(["mica:dark"]);
  release();
  await Promise.resolve();
  await Promise.resolve();
  release();
  await first;
  expect(calls).toEqual(["mica:dark", "mica:light"]);
  expect(published).toEqual(["mica", "mica"]);
  // Same request again: deduplicated.
  await drain.request({ effect: "mica", scheme: "light" });
  expect(calls).toHaveLength(2);
  // A failure publishes the solid fallback and is not retried in a loop.
  fail = true;
  await drain.request({ effect: "acrylic", scheme: "light" });
  expect(calls).toEqual(["mica:dark", "mica:light", "acrylic:light"]);
  expect(published.at(-1)).toBe("none");
});

test("native set_window_effect takes an optional scheme; legacy callers omit it", () => {
  const app = readFileSync(new URL("../../../vesta-launcher/src-tauri/src/commands/app.rs", import.meta.url), "utf8");
  expect(app).toMatch(/pub fn set_window_effect\(\s*window: tauri::WebviewWindow,\s*effect: String,\s*dark: Option<bool>,\s*\)/);
  expect(app).toContain('"mica" => apply_mica(&window, Some(dark.unwrap_or(true)))');
  expect(app).toContain("DWMWA_USE_IMMERSIVE_DARK_MODE");
  expect(app.match(/restore_solid\(\);/g)?.length).toBeGreaterThanOrEqual(2);
  const effects = readFileSync(new URL("../src/features/settings/window-effects.ts", import.meta.url), "utf8");
  expect(effects).toContain('invoke("set_window_effect", { effect, dark: scheme === "dark" })');
});
