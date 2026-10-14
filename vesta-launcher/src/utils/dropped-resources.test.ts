import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	ready: vi.fn(),
	worldReady: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@stores/manual-resource-drops", () => ({
	waitForManualDropChoices: mocks.ready,
}));
vi.mock("@ui/toast/toast", () => ({ showToast: mocks.toast }));
vi.mock("@stores/worlds", () => ({
	waitForWorldArchiveChoices: mocks.worldReady,
}));

import type { Instance } from "@utils/instances";
import {
	addDroppedResources,
	canAcceptDroppedResources,
	DROPPED_RESOURCE_EXTENSIONS,
	describeDroppedResourceRejection,
	notifyDroppedResourcesRejected,
} from "./dropped-resources";

const instance = (installationStatus = "installed") =>
	({ id: 7, name: "Example", installationStatus }) as Instance;

beforeEach(() => {
	vi.resetAllMocks();
	mocks.ready.mockResolvedValue(undefined);
	mocks.worldReady.mockResolvedValue(undefined);
	mocks.invoke.mockResolvedValue("operation-1");
});

describe("manual resource drop adapter", () => {
	it("accepts JARs and ZIPs while retaining instance operation guards", () => {
		expect(DROPPED_RESOURCE_EXTENSIONS).toEqual([".jar", ".zip"]);
		expect(canAcceptDroppedResources(instance())).toBe(true);
		for (const status of [
			"installing",
			"pending",
			"verifying-runtime",
			"launch-preflight-repair",
		])
			expect(canAcceptDroppedResources(instance(status))).toBe(false);
	});

	it("waits for the choice listener before starting an import", async () => {
		let ready!: () => void;
		mocks.ready.mockReturnValue(
			new Promise<void>((resolve) => {
				ready = resolve;
			}),
		);
		const pending = addDroppedResources(instance(), ["/packs/a.zip"]);
		expect(mocks.invoke).not.toHaveBeenCalled();
		ready();
		await pending;
		expect(mocks.invoke).toHaveBeenCalledWith("start_resource_drop", {
			instanceId: 7,
			paths: ["/packs/a.zip"],
		});
		expect(mocks.toast).not.toHaveBeenCalled();
	});

	it("does not start without a listener and reports the failure", async () => {
		mocks.ready.mockRejectedValue(new Error("Resource import is unavailable."));
		await addDroppedResources(instance(), ["/packs/a.zip"]);
		expect(mocks.invoke).not.toHaveBeenCalled();
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "error",
				description: "Resource import is unavailable.",
			}),
		);
	});

	it("waits for archive-world selection readiness as well", async () => {
		let ready!: () => void;
		mocks.worldReady.mockReturnValue(
			new Promise<void>((resolve) => {
				ready = resolve;
			}),
		);
		const pending = addDroppedResources(instance(), ["/packs/worlds.zip"]);
		await Promise.resolve();
		expect(mocks.invoke).not.toHaveBeenCalled();
		ready();
		await pending;
		expect(mocks.invoke).toHaveBeenCalledWith("start_resource_drop", {
			instanceId: 7,
			paths: ["/packs/worlds.zip"],
		});
	});

	it("does not start when the archive-world listener fails", async () => {
		mocks.worldReady.mockRejectedValue(
			new Error("World selection is unavailable."),
		);
		await addDroppedResources(instance(), ["/packs/worlds.zip"]);
		expect(mocks.invoke).not.toHaveBeenCalled();
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "error",
				description: "World selection is unavailable.",
			}),
		);
	});

	it("reports backend start failures, not a fabricated completion", async () => {
		mocks.invoke.mockRejectedValue("Instance is installing");
		await addDroppedResources(instance(), ["/mods/a.jar"]);
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "error",
				description: "Instance is installing",
			}),
		);
	});

	it("explains unsupported and unreadable inputs without paths", () => {
		expect(describeDroppedResourceRejection([])).toBeNull();
		notifyDroppedResourcesRejected([]);
		expect(mocks.toast).not.toHaveBeenCalled();
		expect(
			describeDroppedResourceRejection([
				{ path: "/secret/a.exe", reason: "extension" },
			]),
		).toBe("Drop .jar mods or .zip resource archives onto an instance.");
		expect(
			describeDroppedResourceRejection([
				{ path: "/secret/a.zip", reason: "unreadable" },
			]),
		).toBe("Some dropped files could not be read.");
		notifyDroppedResourcesRejected([
			{ path: "/secret/a.exe", reason: "extension" },
		]);
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.objectContaining({ severity: "warning", title: "Not added" }),
		);
	});
});
