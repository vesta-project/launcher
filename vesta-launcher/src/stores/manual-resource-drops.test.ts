import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
	unlisten: vi.fn(),
	runtime: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@utils/tauri-runtime", () => ({ hasTauriRuntime: mocks.runtime }));

import {
	type ManualDropRequest,
	manualDropRequest,
	manualDropSubmitting,
	startManualDropChoiceListener,
	submitManualDropChoice,
	waitForManualDropChoices,
} from "./manual-resource-drops";

let dispose: (() => void) | undefined;
let deliver: (event: { payload: ManualDropRequest }) => void;
let closeChoice: (event: { payload: { decisionId: string } }) => void;
const request = (id = "1"): ManualDropRequest => ({
	operationId: `operation-${id}`,
	decisionId: `decision-${id}`,
	instanceId: 7,
	instanceName: "Example",
	phase: "resources",
	candidates: [{ id: "pack", name: "Pack", kinds: ["dataPack"] }],
	dependencies: [],
	notes: [],
	expiresAt: new Date(Date.now() + 900_000).toISOString(),
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	mocks.runtime.mockReturnValue(true);
	mocks.invoke.mockResolvedValue(undefined);
	mocks.listen.mockImplementation((event, handler) => {
		if (event === "core://manual-resource-drop-choice") deliver = handler;
		else closeChoice = handler;
		return Promise.resolve(mocks.unlisten);
	});
});
afterEach(() => {
	dispose?.();
	dispose = undefined;
	vi.useRealTimers();
});

async function start() {
	dispose = startManualDropChoiceListener();
	await waitForManualDropChoices();
}

describe("manual resource decision queue", () => {
	it("serializes and deduplicates requests, submitting each exactly once", async () => {
		await start();
		const first = request();
		deliver({ payload: first });
		deliver({ payload: first });
		deliver({ payload: request("2") });
		expect(manualDropRequest()?.decisionId).toBe(first.decisionId);
		await submitManualDropChoice(first, {
			selections: [
				{
					candidateId: "pack",
					kind: "dataPack",
					world: { instanceId: 7, directoryName: "World" },
				},
			],
		});
		expect(manualDropRequest()?.decisionId).toBe("decision-2");
		await expect(
			submitManualDropChoice(first, { cancel: true }),
		).rejects.toThrow("no longer pending");
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "submit_resource_drop_choice",
			),
		).toHaveLength(1);
	});

	it("blocks duplicate submission and allows retry after backend rejection", async () => {
		await start();
		const first = request();
		deliver({ payload: first });
		let reject!: (reason: Error) => void;
		mocks.invoke.mockReturnValueOnce(
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
		);
		const pending = submitManualDropChoice(first, {
			downloadDependencies: true,
		});
		expect(manualDropSubmitting()).toBe(true);
		await submitManualDropChoice(first, { cancel: true });
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		reject(new Error("World is unavailable"));
		await expect(pending).rejects.toThrow("World is unavailable");
		expect(manualDropRequest()).toEqual(first);
		expect(manualDropSubmitting()).toBe(false);
		await submitManualDropChoice(first, { cancel: true });
		expect(manualDropRequest()).toBeNull();
	});

	it("expires pending decisions and cancels their operations", async () => {
		await start();
		const first = {
			...request(),
			expiresAt: new Date(Date.now() + 1000).toISOString(),
		};
		deliver({ payload: first });
		await vi.advanceTimersByTimeAsync(1000);
		expect(manualDropRequest()).toBeNull();
		expect(mocks.invoke).toHaveBeenCalledWith("cancel_resource_drop", {
			operationId: first.operationId,
		});
	});

	it("dismisses externally cancelled choices without cancelling the next operation", async () => {
		await start();
		deliver({ payload: request() });
		deliver({ payload: request("2") });
		closeChoice({ payload: { decisionId: "decision-1" } });
		expect(manualDropRequest()?.decisionId).toBe("decision-2");
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("rejects expired requests instead of showing them", async () => {
		await start();
		deliver({ payload: { ...request(), expiresAt: "2000-01-01T00:00:00Z" } });
		expect(manualDropRequest()).toBeNull();
		expect(mocks.invoke).toHaveBeenCalledWith("cancel_resource_drop", {
			operationId: "operation-1",
		});
	});

	it("cancels queued operations and ignores events after root cleanup", async () => {
		await start();
		deliver({ payload: request() });
		deliver({ payload: request("2") });
		dispose?.();
		deliver({ payload: request("3") });
		expect(mocks.unlisten).toHaveBeenCalledTimes(2);
		expect(manualDropRequest()).toBeNull();
		expect(mocks.invoke).toHaveBeenCalledWith("cancel_resource_drop", {
			operationId: "operation-2",
		});
		await expect(waitForManualDropChoices()).rejects.toThrow("unavailable");
	});

	it("cleans up a subscription that finishes registering after disposal", async () => {
		let resolve!: (value: () => void) => void;
		mocks.listen.mockReturnValueOnce(
			new Promise<() => void>((ready) => {
				resolve = ready;
			}),
		);
		dispose = startManualDropChoiceListener();
		dispose();
		resolve(mocks.unlisten);
		await Promise.resolve();
		expect(mocks.unlisten).toHaveBeenCalledTimes(2);
	});

	it("surfaces registration failures before an import can begin", async () => {
		mocks.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
		dispose = startManualDropChoiceListener();
		await expect(waitForManualDropChoices()).rejects.toThrow("IPC unavailable");
	});
});
