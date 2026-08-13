import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, (event: { payload: any }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(
		async (event: string, listener: (event: { payload: any }) => void) => {
			mocks.listeners.set(event, listener);
			return vi.fn();
		},
	),
}));

import { listInstanceWorlds, worldsState } from "./worlds";

const summary = (instanceId: number, name: string) => ({
	ref: { instanceId, directoryName: name },
	worldId: null,
	instanceName: `Instance ${instanceId}`,
	folderName: name,
	displayName: name,
	lastPlayedAt: null,
	sizeBytes: 0,
	iconDataUrl: null,
	dataVersion: null,
	gameVersion: null,
	storageFamily: "unknown",
	levelStatus: "valid",
	metadataStatus: "absent",
	datapackCount: 0,
	managedDatapackCount: 0,
	running: false,
});

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
};

describe("world store events", () => {
	beforeEach(() => mocks.invoke.mockReset());

	it("refreshes only the instance named by a topology event", async () => {
		mocks.invoke.mockResolvedValue([]);
		await listInstanceWorlds(71, true);
		mocks.invoke.mockClear();

		mocks.listeners.get("core://instance-worlds-changed")?.({
			payload: { instanceId: 72, revision: 1, reason: "copied" },
		});
		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());

		expect(mocks.invoke).toHaveBeenCalledWith("list_instance_worlds", {
			instanceId: 72,
			forceRefresh: true,
		});
	});

	it("does not let an older forced refresh overwrite newer world data", async () => {
		const older = deferred<any[]>();
		const newer = deferred<any[]>();
		mocks.invoke
			.mockReturnValueOnce(older.promise)
			.mockReturnValueOnce(newer.promise);

		const olderRequest = listInstanceWorlds(73, true);
		const newerRequest = listInstanceWorlds(73, true);
		newer.resolve([summary(73, "Newer")]);
		await newerRequest;
		older.resolve([summary(73, "Older")]);
		await olderRequest;

		expect(worldsState.byInstance[73]?.[0]?.displayName).toBe("Newer");
	});
});
