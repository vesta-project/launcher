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
		document.getElementById("theme-custom-css")?.remove();
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
		expect(bgImage).toContain("var(--app-background-tint-with-opacity)");
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
			"linear-gradient(var(--app-background-tint-with-opacity), var(--app-background-tint-with-opacity))",
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
		expect(root.style.getPropertyValue("--app-background-tint").trim()).toBe(
			"",
		);
		expect(root.style.getPropertyValue("--background-color").trim()).toBe("");
		expect(root.style.getPropertyValue("--background-image").trim()).toBe("");
	});

	it("removes custom css when switching to a theme without custom css", () => {
		applyTheme(
			createTheme({
				id: "midnight",
				customCss: ':root[data-theme-id="midnight"] { --midnight-only: 1; }',
			}),
		);

		expect(document.getElementById("theme-custom-css")?.textContent).toContain(
			"--midnight-only",
		);

		applyTheme(createTheme({ id: "classic", customCss: undefined }));

		expect(document.getElementById("theme-custom-css")).toBeNull();
		expect(document.documentElement.getAttribute("data-theme-id")).toBe(
			"classic",
		);
	});

	it("updates custom css when the same theme id changes css text", () => {
		applyTheme(createTheme({ customCss: ":root { --test-custom-css: 1; }" }));
		applyTheme(createTheme({ customCss: ":root { --test-custom-css: 2; }" }));

		const styleTag = document.getElementById("theme-custom-css");
		expect(styleTag?.textContent).toContain("--test-custom-css: 2");
		expect(styleTag?.getAttribute("data-theme-custom-css-owner")).toBe(
			"test-theme",
		);
	});

	it("removes stale theme variable properties even when tracking metadata is missing", () => {
		const root = document.documentElement;
		root.style.setProperty("--theme-var-stale", "99");

		applyTheme(createTheme({ id: "no-vars", customCss: undefined }));

		expect(root.style.getPropertyValue("--theme-var-stale").trim()).toBe("");
	});
});
