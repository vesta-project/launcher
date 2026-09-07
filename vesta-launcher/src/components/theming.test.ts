import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@utils/config-sync", () => ({ applyConfigSnapshot: vi.fn() }));
vi.mock("@utils/os", () => ({
	ensureOsType: vi.fn().mockResolvedValue("windows"),
}));
vi.mock("@utils/startup-state", () => ({
	getStartupConfig: () => ({ theme_id: "solar" }),
}));
vi.mock("@utils/window-readiness", () => ({
	afterNextPaint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/themes/engine/applier", () => ({
	waitForNativeEffectSettled: vi.fn(),
}));
vi.mock("~/themes/engine/effects", () => ({
	loadWindowEffectCapabilities: vi.fn().mockResolvedValue({
		os: "windows",
		supportedEffects: ["none", "transparent", "blur", "acrylic"],
		defaultEffect: "acrylic",
	}),
}));

import { invoke } from "@tauri-apps/api/core";
import { applyConfigSnapshot } from "@utils/config-sync";
import { afterNextPaint } from "@utils/window-readiness";
import { waitForNativeEffectSettled } from "~/themes/engine/applier";
import { loadWindowEffectCapabilities } from "~/themes/engine/effects";
import { initTheme, isThemeReady } from "./theming";

it("keeps startup backing until the native effect settles and the theme paints", async () => {
	let finishEffect!: () => void;
	vi.mocked(waitForNativeEffectSettled).mockReturnValue(
		new Promise<void>((resolve) => {
			finishEffect = resolve;
		}),
	);
	const ready = initTheme();
	await vi.waitFor(() =>
		expect(waitForNativeEffectSettled).toHaveBeenCalledOnce(),
	);
	expect(loadWindowEffectCapabilities).toHaveBeenCalledOnce();
	expect(applyConfigSnapshot).toHaveBeenCalledWith({ theme_id: "solar" });
	expect(afterNextPaint).not.toHaveBeenCalled();
	expect(invoke).not.toHaveBeenCalledWith("clear_window_startup_background");
	expect(isThemeReady()).toBe(false);
	finishEffect();
	await ready;
	expect(afterNextPaint).toHaveBeenCalledOnce();
	expect(invoke).toHaveBeenCalledWith("clear_window_startup_background");
	expect(vi.mocked(afterNextPaint).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(invoke).mock.invocationCallOrder[0],
	);
	expect(isThemeReady()).toBe(true);
});
