import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const showToastMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@ui/toast/toast", () => ({
	showToast: (...args: unknown[]) => showToastMock(...args),
}));

import type { Instance } from "@utils/instances";
import {
	addDroppedMods,
	canAcceptDroppedMods,
	describeDroppedModRejection,
	notifyDroppedModsRejected,
} from "./dropped-mods";

const instance = (installationStatus: string | null): Instance =>
	({ id: 7, name: "Example", installationStatus }) as unknown as Instance;

beforeEach(() => {
	invokeMock.mockReset();
	showToastMock.mockReset();
});

describe("canAcceptDroppedMods", () => {
	it("refuses drops while the instance is installing", () => {
		expect(canAcceptDroppedMods(instance("installing"))).toBe(false);
	});

	it("accepts drops for installed, failed and interrupted instances", () => {
		expect(canAcceptDroppedMods(instance("installed"))).toBe(true);
		expect(canAcceptDroppedMods(instance("failed"))).toBe(true);
		expect(canAcceptDroppedMods(instance("interrupted"))).toBe(true);
	});
});

describe("addDroppedMods", () => {
	it("starts the backend task with the instance id and paths", async () => {
		invokeMock.mockResolvedValue(undefined);
		await addDroppedMods(instance("installed"), ["/mods/a.jar"]);
		expect(invokeMock).toHaveBeenCalledWith("add_dropped_mods", {
			instanceId: 7,
			paths: ["/mods/a.jar"],
		});
		expect(showToastMock).not.toHaveBeenCalled();
	});

	it("shows a toast with the backend message when the task cannot start", async () => {
		invokeMock.mockRejectedValue("Instance is installing");
		await addDroppedMods(instance("installed"), ["/mods/a.jar"]);
		expect(showToastMock).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "error",
				description: "Instance is installing",
			}),
		);
	});

	it("does not throw on non-string errors", async () => {
		invokeMock.mockRejectedValue(new Error("boom"));
		await expect(
			addDroppedMods(instance("installed"), ["/mods/a.jar"]),
		).resolves.toBeUndefined();
		expect(showToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Unexpected error." }),
		);
	});
});

describe("rejection messages", () => {
	it("returns nothing and shows nothing when there is no rejection", () => {
		expect(describeDroppedModRejection([])).toBeNull();
		notifyDroppedModsRejected([]);
		expect(showToastMock).not.toHaveBeenCalled();
	});

	it("explains that only jars are accepted for wrong types and extensions", () => {
		const message = "Only .jar mods can be dropped onto an instance for now.";
		expect(
			describeDroppedModRejection([{ path: "/a.zip", reason: "extension" }]),
		).toBe(message);
		expect(
			describeDroppedModRejection([
				{ path: "/folder", reason: "not-accepted-type" },
			]),
		).toBe(message);
	});

	it("reports unreadable files separately and never includes paths", () => {
		const message = describeDroppedModRejection([
			{ path: "/secret/a.jar", reason: "unreadable" },
		]);
		expect(message).toBe("Some dropped files could not be read.");
		expect(message).not.toContain("/secret");
	});

	it("shows a warning toast for rejected items", () => {
		notifyDroppedModsRejected([{ path: "/a.zip", reason: "extension" }]);
		expect(showToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ severity: "warning", title: "Not added" }),
		);
	});
});
