import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	toast: vi.fn(),
	runtime: vi.fn(() => true),
	configUpdated: undefined as
		| ((field: string, value: unknown) => void)
		| undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn().mockResolvedValue(() => undefined),
}));
vi.mock("@utils/tauri-runtime", () => ({ hasTauriRuntime: mocks.runtime }));
vi.mock("@ui/toast/toast", () => ({ showToast: mocks.toast }));
vi.mock("@utils/startup-state", () => ({
	getStartupConfig: () => ({
		manual_mod_dependency_policy: "never",
		auto_install_dependencies: true,
	}),
}));
vi.mock("@utils/config-sync", () => ({
	currentThemeConfig: {},
	colorMode: () => "system",
	uiChromeModeEnabled: () => false,
	setColorMode: vi.fn(),
	setUiChromeModeEnabled: vi.fn(),
	saveThemeUpdate: vi.fn(),
	onConfigUpdate: (callback: typeof mocks.configUpdated) => {
		mocks.configUpdated = callback;
		return () => undefined;
	},
}));

import {
	autoInstallDependencies,
	handleManualModDependencyPolicyChange,
	initSettings,
	manualModDependencyPolicy,
	normalizeManualModDependencyPolicy,
	setManualModDependencyPolicy,
} from "./settings";

beforeEach(() => {
	mocks.invoke.mockReset();
	mocks.invoke.mockResolvedValue([]);
	mocks.toast.mockReset();
	mocks.runtime.mockReturnValue(true);
	setManualModDependencyPolicy("ask");
});

describe("manual dependency preference", () => {
	it("normalizes unknown and missing values to ask", () => {
		for (const value of [undefined, null, "invalid", true, "ask"])
			expect(normalizeManualModDependencyPolicy(value)).toBe("ask");
		expect(normalizeManualModDependencyPolicy("always")).toBe("always");
		expect(normalizeManualModDependencyPolicy("never")).toBe("never");
	});

	it("loads persisted policy independently of provider auto-install and syncs windows", async () => {
		await initSettings();
		expect(manualModDependencyPolicy()).toBe("never");
		expect(autoInstallDependencies()).toBe(true);
		mocks.configUpdated?.("manual_mod_dependency_policy", "always");
		expect(manualModDependencyPolicy()).toBe("always");
		mocks.configUpdated?.("manual_mod_dependency_policy", "invalid");
		expect(manualModDependencyPolicy()).toBe("ask");
	});

	it("persists optimistic changes using the dedicated field", async () => {
		const pending = handleManualModDependencyPolicyChange("always");
		expect(manualModDependencyPolicy()).toBe("always");
		await pending;
		expect(mocks.invoke).toHaveBeenCalledWith("update_config_field", {
			field: "manual_mod_dependency_policy",
			value: "always",
		});
	});

	it("rolls back on persistence failure and shows the localized error", async () => {
		mocks.invoke.mockRejectedValueOnce("Could not save config");
		await handleManualModDependencyPolicyChange("never");
		expect(manualModDependencyPolicy()).toBe("ask");
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Couldn't save dependency preference",
				severity: "error",
			}),
		);
	});

	it("does not roll back a newer selection when an earlier save fails", async () => {
		let reject!: (reason: Error) => void;
		mocks.invoke.mockReturnValueOnce(
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
		);
		const earlier = handleManualModDependencyPolicyChange("always");
		await handleManualModDependencyPolicyChange("never");
		reject(new Error("Earlier save failed"));
		await earlier;
		expect(manualModDependencyPolicy()).toBe("never");
	});

	it("does not roll back an authoritative cross-window update", async () => {
		let reject!: (reason: Error) => void;
		mocks.invoke.mockReturnValueOnce(
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
		);
		const earlier = handleManualModDependencyPolicyChange("always");
		mocks.configUpdated?.("manual_mod_dependency_policy", "never");
		reject(new Error("Save failed"));
		await earlier;
		expect(manualModDependencyPolicy()).toBe("never");
	});
});
