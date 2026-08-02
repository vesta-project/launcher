import {
	createPreloadableLazyComponent,
	createRetainedTabLoader,
} from "@utils/preloadable-lazy";
import { describe, expect, it, vi } from "vitest";

describe("createPreloadableLazyComponent", () => {
	it("shares one module request between preload and render", async () => {
		const component = () => null;
		const loader = vi.fn().mockResolvedValue({ default: component });
		const lazyComponent = createPreloadableLazyComponent(loader);

		const [first, second] = await Promise.all([
			lazyComponent.preload(),
			lazyComponent.preload(),
		]);

		expect(loader).toHaveBeenCalledTimes(1);
		expect(first.default).toBe(component);
		expect(second).toBe(first);
	});
});

describe("createRetainedTabLoader", () => {
	it("preloads on intent and retains tabs only after a visit", async () => {
		const settingsLoader = vi.fn().mockResolvedValue(undefined);
		const tabs = createRetainedTabLoader<"home" | "settings">(
			"home",
			(tab) => (tab === "settings" ? settingsLoader : undefined),
		);

		tabs.preload("settings");
		expect(tabs.visitedTabs().has("settings")).toBe(false);

		tabs.prepare("settings");
		expect(tabs.visitedTabs().has("settings")).toBe(true);

		await Promise.resolve();
		expect(settingsLoader).toHaveBeenCalledTimes(2);
	});
});
