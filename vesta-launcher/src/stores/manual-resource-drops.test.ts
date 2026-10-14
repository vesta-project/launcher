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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((ready, fail) => {
		resolve = ready;
		reject = fail;
	});
	return { promise, resolve, reject };
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

describe("manual resource listener ownership", () => {
	it("retries failed registration on a later wait without restarting the root", async () => {
		const error = new Error("IPC unavailable");
		mocks.listen.mockRejectedValueOnce(error);
		dispose = startManualDropChoiceListener();
		await expect(waitForManualDropChoices()).rejects.toBe(error);
		expect(mocks.listen).toHaveBeenCalledTimes(2);
		expect(mocks.unlisten).toHaveBeenCalledTimes(1);
		await waitForManualDropChoices();
		expect(mocks.listen).toHaveBeenCalledTimes(4);
		deliver({ payload: request() });
		expect(manualDropRequest()?.decisionId).toBe("decision-1");
	});

	it("shares one retry registration pair across concurrent waits", async () => {
		mocks.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
		dispose = startManualDropChoiceListener();
		await expect(waitForManualDropChoices()).rejects.toThrow("IPC unavailable");
		const choice = deferred<() => void>();
		const closed = deferred<() => void>();
		mocks.listen
			.mockReturnValueOnce(choice.promise)
			.mockReturnValueOnce(closed.promise);
		const first = waitForManualDropChoices();
		const second = waitForManualDropChoices();
		expect(mocks.listen).toHaveBeenCalledTimes(4);
		choice.resolve(mocks.unlisten);
		closed.resolve(mocks.unlisten);
		await Promise.all([first, second]);
		await waitForManualDropChoices();
		expect(mocks.listen).toHaveBeenCalledTimes(4);
	});

	it("cleans partial registration and immediately unlistens a late registration", async () => {
		const late = deferred<() => void>();
		const failed = deferred<() => void>();
		const lateUnlisten = vi.fn();
		mocks.listen
			.mockReturnValueOnce(late.promise)
			.mockReturnValueOnce(failed.promise);
		dispose = startManualDropChoiceListener();
		const waiting = waitForManualDropChoices();
		failed.reject(new Error("IPC unavailable"));
		await expect(waiting).rejects.toThrow("IPC unavailable");
		await waitForManualDropChoices();
		late.resolve(lateUnlisten);
		await Promise.resolve();
		expect(lateUnlisten).toHaveBeenCalledOnce();
		expect(mocks.unlisten).not.toHaveBeenCalled();
	});

	it("cancels partial-registration choices and clears timers and submission on failure", async () => {
		const closed = deferred<() => void>();
		const submitted = deferred<void>();
		mocks.listen.mockImplementationOnce((_event, handler) => {
			deliver = handler;
			return Promise.resolve(mocks.unlisten);
		});
		mocks.listen.mockReturnValueOnce(closed.promise);
		dispose = startManualDropChoiceListener();
		const waiting = waitForManualDropChoices();
		await Promise.resolve();
		deliver({ payload: request() });
		deliver({ payload: request("2") });
		mocks.invoke.mockReturnValueOnce(submitted.promise);
		const submission = submitManualDropChoice(request(), { cancel: true });
		expect(manualDropSubmitting()).toBe(true);
		expect(vi.getTimerCount()).toBe(2);
		closed.reject(new Error("IPC unavailable"));
		await expect(waiting).rejects.toThrow("IPC unavailable");
		expect(mocks.unlisten).toHaveBeenCalledOnce();
		expect(manualDropRequest()).toBeNull();
		expect(manualDropSubmitting()).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		for (const id of ["1", "2"])
			expect(mocks.invoke).toHaveBeenCalledWith("cancel_resource_drop", {
				operationId: `operation-${id}`,
			});
		submitted.resolve(undefined);
		await submission;
	});

	it("disposes the retried session and prevents waits from restarting it", async () => {
		mocks.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
		dispose = startManualDropChoiceListener();
		await expect(waitForManualDropChoices()).rejects.toThrow("IPC unavailable");
		await waitForManualDropChoices();
		deliver({ payload: request() });
		dispose();
		dispose();
		expect(mocks.unlisten).toHaveBeenCalledTimes(3);
		expect(manualDropRequest()).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		await expect(waitForManualDropChoices()).rejects.toThrow("unavailable");
		expect(mocks.listen).toHaveBeenCalledTimes(4);
	});

	it("keeps stale callbacks and duplicate or stale disposers away from a new root", async () => {
		await start();
		const oldDeliver = deliver;
		const oldClose = closeChoice;
		const oldDispose = dispose;
		const duplicateDispose = startManualDropChoiceListener();
		duplicateDispose();
		await waitForManualDropChoices();
		expect(mocks.listen).toHaveBeenCalledTimes(2);
		oldDispose?.();
		await start();
		const currentRequest = request();
		deliver({ payload: currentRequest });
		oldDeliver({ payload: request("stale") });
		oldClose({ payload: { decisionId: currentRequest.decisionId } });
		oldDispose?.();
		duplicateDispose();
		expect(manualDropRequest()).toEqual(currentRequest);
		expect(mocks.unlisten).toHaveBeenCalledTimes(2);
		await waitForManualDropChoices();
	});

	it("rejects stale readiness and cleans late registration without changing a new root", async () => {
		const late = deferred<() => void>();
		const lateUnlisten = vi.fn();
		mocks.listen.mockReturnValueOnce(late.promise);
		dispose = startManualDropChoiceListener();
		const waiting = waitForManualDropChoices();
		dispose();
		await start();
		deliver({ payload: request() });
		late.resolve(lateUnlisten);
		await expect(waiting).rejects.toThrow("unavailable");
		expect(lateUnlisten).toHaveBeenCalledOnce();
		expect(manualDropRequest()?.decisionId).toBe("decision-1");
		await waitForManualDropChoices();
	});

	it("does not retry a failed registration after root disposal", async () => {
		mocks.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
		dispose = startManualDropChoiceListener();
		await expect(waitForManualDropChoices()).rejects.toThrow("IPC unavailable");
		dispose();
		await expect(waitForManualDropChoices()).rejects.toThrow("unavailable");
		expect(mocks.listen).toHaveBeenCalledTimes(2);
	});

	it("keeps a late failure from clearing a newer root's queue", async () => {
		const failed = deferred<() => void>();
		mocks.listen.mockReturnValueOnce(failed.promise);
		dispose = startManualDropChoiceListener();
		const waiting = waitForManualDropChoices();
		dispose();
		await start();
		deliver({ payload: request() });
		const error = new Error("old IPC failure");
		failed.reject(error);
		await expect(waiting).rejects.toBe(error);
		expect(manualDropRequest()?.decisionId).toBe("decision-1");
		expect(vi.getTimerCount()).toBe(1);
		expect(mocks.invoke).not.toHaveBeenCalled();
		await waitForManualDropChoices();
		expect(mocks.listen).toHaveBeenCalledTimes(4);
	});

	it("keeps an old submission completion from clearing a new root's submission", async () => {
		await start();
		const first = request();
		deliver({ payload: first });
		const oldResult = deferred<void>();
		mocks.invoke.mockReturnValueOnce(oldResult.promise);
		const oldSubmission = submitManualDropChoice(first, { cancel: true });
		dispose?.();
		await start();
		deliver({ payload: first });
		const newResult = deferred<void>();
		mocks.invoke.mockReturnValueOnce(newResult.promise);
		const newSubmission = submitManualDropChoice(first, { cancel: true });
		oldResult.resolve(undefined);
		await oldSubmission;
		expect(manualDropSubmitting()).toBe(true);
		expect(manualDropRequest()).toEqual(first);
		newResult.resolve(undefined);
		await newSubmission;
		expect(manualDropSubmitting()).toBe(false);
		expect(manualDropRequest()).toBeNull();
	});
});
