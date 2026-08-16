import { beforeEach, describe, expect, it, vi } from "vitest";

describe("startup config snapshot", () => {
	beforeEach(() => {
		vi.resetModules();
		window.sessionStorage.clear();
		delete window.__VESTA_BOOTSTRAP__;
	});

	it("is reusable during the initial page load", async () => {
		window.__VESTA_BOOTSTRAP__ = { config: { theme_id: "neon" } };
		const { getStartupConfig } = await import("./startup-state");

		expect(getStartupConfig()?.theme_id).toBe("neon");
		expect(getStartupConfig()?.theme_id).toBe("neon");
	});

	it("does not reuse the window-creation snapshot after a reload", async () => {
		window.__VESTA_BOOTSTRAP__ = { config: { theme_id: "neon" } };
		const initialModule = await import("./startup-state");
		expect(initialModule.getStartupConfig()?.theme_id).toBe("neon");

		vi.resetModules();
		const reloadedModule = await import("./startup-state");
		expect(reloadedModule.getStartupConfig()).toBeUndefined();
	});
});
