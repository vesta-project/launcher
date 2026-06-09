import { clearRunning, instancesState, setLaunching } from "@stores/instances";
import { getActiveAccount } from "@utils/auth";
import { launchInstance } from "@utils/instances";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@utils/auth", () => ({
	getActiveAccount: vi.fn(),
}));

describe("launchInstance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(invoke).mockResolvedValue(undefined);
		vi.mocked(getActiveAccount).mockResolvedValue({
			account_type: "microsoft",
		} as any);
		setLaunching("test-instance", false);
		clearRunning("test-instance");
	});

	it("allows launch when the instance is already warming up optimistically", async () => {
		setLaunching("test-instance", true);

		await launchInstance({
			id: 1,
			name: "Test Instance",
		} as any);

		expect(instancesState.launchingIds["test-instance"]).toBeUndefined();
	});

	it("throws when the instance is already running", async () => {
		const { setRunning } = await import("@stores/instances");
		setRunning("test-instance", { pid: 1, startTime: 1 });

		await expect(
			launchInstance({
				id: 1,
				name: "Test Instance",
			} as any),
		).rejects.toThrow("Instance is already running");
	});

	it("clears warming after a successful launch invoke", async () => {
		await launchInstance({
			id: 1,
			name: "Test Instance",
		} as any);

		expect(instancesState.launchingIds["test-instance"]).toBeUndefined();
	});
});
