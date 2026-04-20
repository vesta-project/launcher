import { describe, expect, it } from "vitest";
import type { ThemeConfig } from "../types";
import { themeToCSSVars } from "./themeToCSSVars";

function createTheme(overrides: Partial<ThemeConfig> = {}): ThemeConfig {
	return {
		id: "test-theme",
		name: "Test Theme",
		primaryHue: 180,
		opacity: 40,
		grainStrength: 40,
		style: "glass",
		gradientEnabled: true,
		gradientType: "linear",
		rotation: 120,
		gradientHarmony: "none",
		windowEffect: "none",
		backgroundOpacity: 25,
		...overrides,
	};
}

function readNoiseSizePx(vars: Record<string, string>): number {
	const noiseSize = vars["--liquid-noise-size"] || "";
	const [firstToken] = noiseSize.split(" ");
	return Number.parseFloat(firstToken);
}

describe("themeToCSSVars grain mapping", () => {
	it("does not emit retired grain variables", () => {
		const vars = themeToCSSVars(createTheme({ style: "glass", grainStrength: 65 }));

		expect(vars["--grain-strength"]).toBeUndefined();
		expect(vars["--liquid-noise-strength"]).toBeUndefined();
		expect(vars["--liquid-noise-frequency"]).toBeUndefined();
		expect(vars["--liquid-noise-contrast"]).toBeUndefined();
		expect(vars["--liquid-noise-blend-mode"]).toBeUndefined();
	});

	it("disables grain for flat style", () => {
		const vars = themeToCSSVars(createTheme({ style: "flat", grainStrength: 100 }));

		expect(Number.parseFloat(vars["--liquid-noise-opacity"]) || 0).toBe(0);
		expect(vars["--liquid-noise-size"]).toBe("196px 196px");
	});

	it("allows glass grain opacity to reach full strength at max strength", () => {
		const vars = themeToCSSVars(createTheme({ style: "glass", grainStrength: 100 }));
		const opacity = Number.parseFloat(vars["--liquid-noise-opacity"] || "0");
		const tileSize = readNoiseSizePx(vars);

		expect(opacity).toBe(1);
		expect(tileSize).toBe(132);
	});

	it("allows frosted grain opacity to reach full strength at max strength", () => {
		const vars = themeToCSSVars(createTheme({ style: "frosted", grainStrength: 100 }));
		const opacity = Number.parseFloat(vars["--liquid-noise-opacity"] || "0");
		const tileSize = readNoiseSizePx(vars);

		expect(opacity).toBe(1);
		expect(tileSize).toBe(124);
	});

	it("scales opacity and tile size smoothly with grain strength", () => {
		const low = themeToCSSVars(createTheme({ style: "frosted", grainStrength: 10 }));
		const high = themeToCSSVars(createTheme({ style: "frosted", grainStrength: 90 }));

		const lowOpacity = Number.parseFloat(low["--liquid-noise-opacity"] || "0");
		const highOpacity = Number.parseFloat(high["--liquid-noise-opacity"] || "0");
		const lowSize = readNoiseSizePx(low);
		const highSize = readNoiseSizePx(high);

		expect(highOpacity).toBeGreaterThan(lowOpacity);
		expect(highSize).toBeLessThan(lowSize);
	});
});
