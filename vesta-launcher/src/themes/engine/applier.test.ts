import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeConfig } from "../types";

vi.mock("./transitionManager", () => ({
	startThemeTransition: vi.fn(),
}));

import { applyTheme } from "./applier";

function createTheme(overrides: Partial<ThemeConfig> = {}): ThemeConfig {
	return {
		id: "test-theme",
		name: "Test Theme",
		primaryHue: 180,
		opacity: 40,
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

describe("applyTheme background and effect behavior", () => {
	beforeEach(() => {
		const root = document.documentElement;
		root.style.cssText = "";
		root.removeAttribute("data-theme-id");
		root.removeAttribute("data-theme-var-keys");
		root.removeAttribute("data-window-effect");
		root.removeAttribute("data-gradient");
		root.removeAttribute("data-gradient-type");
		root.removeAttribute("data-style");
		root.removeAttribute("data-startup-fallback-active");
		root.setAttribute("data-os", "windows");
	});

	it("keeps opacity-controlled solid overlay when effect is enabled and gradient is disabled", () => {
		const root = document.documentElement;
		applyTheme(
			createTheme({
				windowEffect: "transparent",
				gradientEnabled: false,
			}),
		);

		expect(root.getAttribute("data-window-effect")).toBe("transparent");
		expect(root.getAttribute("data-gradient")).toBe("0");
		const bgImage = root.style.getPropertyValue("--background-image").trim();
		expect(bgImage).toContain("var(--background-opacity)");
		expect(bgImage).not.toContain("var(--app-background-tint)");
		expect(root.style.getPropertyValue("--background-color").trim()).toBe("");
	});

	it("keeps static background when effect is none and gradient is disabled", () => {
		const root = document.documentElement;
		applyTheme(
			createTheme({
				windowEffect: "none",
				gradientEnabled: false,
			}),
		);

		expect(root.getAttribute("data-window-effect")).toBe("none");
		expect(root.getAttribute("data-gradient")).toBe("0");
		expect(root.style.getPropertyValue("--background-image").trim()).toBe(
			"linear-gradient(var(--app-background-tint), var(--app-background-tint))",
		);
		expect(root.style.getPropertyValue("--background-color").trim()).toBe(
			"var(--app-background-tint)",
		);
	});

	it("clears bootstrap fallback styles on first real theme apply", () => {
		const root = document.documentElement;
		root.setAttribute("data-startup-fallback-active", "1");
		root.style.setProperty("--app-background-tint", "#141414");
		root.style.setProperty("--background-color", "#141414");
		root.style.setProperty("--background-image", "none");

		applyTheme(
			createTheme({
				windowEffect: "transparent",
				gradientEnabled: true,
			}),
		);

		expect(root.getAttribute("data-startup-fallback-active")).toBeNull();
		expect(root.style.getPropertyValue("--app-background-tint").trim()).toBe("");
		expect(root.style.getPropertyValue("--background-color").trim()).toBe("");
		expect(root.style.getPropertyValue("--background-image").trim()).toBe("");
	});
});
