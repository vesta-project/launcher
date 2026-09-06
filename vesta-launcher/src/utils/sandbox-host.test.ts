import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	canSelectSandboxPreset,
	fetchSandboxHostSupport,
	fetchSandboxHostSupportForce,
	guardSandboxPresetChange,
	invalidateSandboxHostSupportCache,
	isEnforcedSandboxPreset,
	refreshSandboxHostSupport,
	sandboxPresetBlockedCopy,
} from "./sandbox-host";

const invokeMock = vi.fn();
const hasTauriRuntimeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@utils/tauri-runtime", () => ({
	hasTauriRuntime: () => hasTauriRuntimeMock(),
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
		hasTauriRuntimeMock.mockReturnValue(true);
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

	it("never claims enforcement in a browser preview, even with cached desktop support", async () => {
		await fetchSandboxHostSupport();
		hasTauriRuntimeMock.mockReturnValue(false);
		invokeMock.mockClear();

		for (const fetchSupport of [
			fetchSandboxHostSupport,
			fetchSandboxHostSupportForce,
		]) {
			const support = await fetchSupport();
			expect(support.enforcementAvailable).toBe(false);
			expect(support.enforcementBackend).toBeNull();
			expect(support.missingRequirementMessage).toContain("desktop runtime");
		}
		for (const preset of ["modded", "paranoid"] as const) {
			expect(await canSelectSandboxPreset(preset)).toBe(false);
			expect((await guardSandboxPresetChange(preset)).allowed).toBe(false);
		}
		expect(await canSelectSandboxPreset("trusted")).toBe(true);
		expect((await guardSandboxPresetChange("trusted")).allowed).toBe(true);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("does not let an older request overwrite refreshed host capabilities", async () => {
		let resolveOld!: (value: typeof linuxSupportResponse) => void;
		invokeMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveOld = resolve;
			}),
		);
		const oldRequest = fetchSandboxHostSupport();
		const unavailable = {
			...linuxSupportResponse,
			enforcementAvailable: false,
		};
		invokeMock.mockResolvedValueOnce(unavailable);
		await fetchSandboxHostSupportForce();
		resolveOld(linuxSupportResponse);
		await oldRequest;

		expect((await fetchSandboxHostSupport()).enforcementAvailable).toBe(false);
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("keeps a newer pending request when an invalidated request finishes", async () => {
		let resolveOld!: (value: typeof linuxSupportResponse) => void;
		let resolveNew!: (value: typeof linuxSupportResponse) => void;
		invokeMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveOld = resolve;
			}),
		);
		invokeMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveNew = resolve;
			}),
		);
		const oldRequest = fetchSandboxHostSupport();
		const refreshed = fetchSandboxHostSupportForce();
		resolveOld(linuxSupportResponse);
		await oldRequest;
		const concurrent = fetchSandboxHostSupport();
		const unavailable = {
			...linuxSupportResponse,
			enforcementAvailable: false,
		};
		resolveNew(unavailable);

		expect((await concurrent).enforcementAvailable).toBe(false);
		await refreshed;
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});
});
