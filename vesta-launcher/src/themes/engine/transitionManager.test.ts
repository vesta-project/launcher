import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startThemeTransition } from "./transitionManager";

describe("transitionManager", () => {
	const root = document.documentElement;

	beforeEach(() => {
		vi.useFakeTimers();
		root.removeAttribute("data-theme-transition");
		root.style.removeProperty("--theme-transition-duration");
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		root.removeAttribute("data-theme-transition");
		root.style.removeProperty("--theme-transition-duration");
	});

	it("does not start a transition when transition type is none", () => {
		startThemeTransition({ transition: "none" });

		expect(root.getAttribute("data-theme-transition")).toBeNull();
		expect(root.style.getPropertyValue("--theme-transition-duration")).toBe("");
	});

	it("applies and clears preset transition state after duration", () => {
		startThemeTransition({
			transition: "preset-switch",
			transitionDurationMs: 160,
		});

		expect(root.getAttribute("data-theme-transition")).toBe("preset-switch");
		expect(root.style.getPropertyValue("--theme-transition-duration")).toBe("160ms");

		vi.advanceTimersByTime(159);
		expect(root.getAttribute("data-theme-transition")).toBe("preset-switch");

		vi.advanceTimersByTime(35);
		expect(root.getAttribute("data-theme-transition")).toBeNull();
		expect(root.style.getPropertyValue("--theme-transition-duration")).toBe("");
	});

	it("keeps only the latest rapid preset switch active", () => {
		startThemeTransition({
			transition: "preset-switch",
			transitionDurationMs: 240,
		});

		vi.advanceTimersByTime(70);

		startThemeTransition({
			transition: "preset-switch",
			transitionDurationMs: 100,
		});

		expect(root.style.getPropertyValue("--theme-transition-duration")).toBe("100ms");

		vi.advanceTimersByTime(120);
		expect(root.getAttribute("data-theme-transition")).toBe("preset-switch");

		vi.advanceTimersByTime(20);
		expect(root.getAttribute("data-theme-transition")).toBeNull();
	});
});
