import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchSandboxHostSupport,
	fetchSandboxHostSupportForce,
	invalidateSandboxHostSupportCache,
	isEnforcedSandboxPreset,
	refreshSandboxHostSupport,
	sandboxPresetBlockedCopy,
} from "./sandbox-host";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@utils/tauri-runtime", () => ({
	hasTauriRuntime: () => true,
}));

const linuxSupportResponse = {
	hostOs: "linux",
	enforcementAvailable: true,
	enforcementBackend: "bubblewrap",
	bubblewrapAvailable: true,
	bubblewrapPath: "/usr/bin/bwrap",
	missingRequirementMessage: null,
};

describe("sandbox-host", () => {
	beforeEach(() => {
		invalidateSandboxHostSupportCache();
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(linuxSupportResponse);
	});

	it("treats modded and paranoid as enforced presets", () => {
		expect(isEnforcedSandboxPreset("trusted")).toBe(false);
		expect(isEnforcedSandboxPreset("modded")).toBe(true);
		expect(isEnforcedSandboxPreset("paranoid")).toBe(true);
	});

	it("builds blocking copy from host support", () => {
		const copy = sandboxPresetBlockedCopy({
			hostOs: "linux",
			enforcementAvailable: false,
			enforcementBackend: null,
			bubblewrapAvailable: false,
			bubblewrapPath: null,
			missingRequirementMessage: "Install bubblewrap.",
		});

		expect(copy.title).toBe("Sandbox unavailable");
		expect(copy.description).toContain("bubblewrap");
	});

	it("caches support between fetches", async () => {
		await fetchSandboxHostSupport();
		await fetchSandboxHostSupport();

		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledWith("get_sandbox_host_support");

		invalidateSandboxHostSupportCache();
		await fetchSandboxHostSupport();

		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("refreshSandboxHostSupport bypasses cached support", async () => {
		await fetchSandboxHostSupport();
		await refreshSandboxHostSupport();

		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("fetchSandboxHostSupportForce bypasses cached support", async () => {
		await fetchSandboxHostSupport();
		await fetchSandboxHostSupportForce();

		expect(invokeMock).toHaveBeenCalledTimes(2);
	});
});
