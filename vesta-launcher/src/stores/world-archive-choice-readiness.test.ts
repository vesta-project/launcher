import { afterEach, describe, expect, it, vi } from "vitest";
import {
	registerWorldArchiveChoiceReadiness,
	waitForWorldArchiveChoices,
} from "./worlds";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	dispose = undefined;
});

describe("root world archive listener readiness", () => {
	it("waits until both root subscriptions are ready", async () => {
		let resolve!: () => void;
		dispose = registerWorldArchiveChoiceReadiness(
			new Promise<void>((ready) => {
				resolve = ready;
			}),
		);
		let completed = false;
		const waiting = waitForWorldArchiveChoices().then(() => {
			completed = true;
		});
		await Promise.resolve();
		expect(completed).toBe(false);
		resolve();
		await waiting;
		expect(completed).toBe(true);
	});

	it("rejects unavailable or failed subscriptions before starting imports", async () => {
		await expect(waitForWorldArchiveChoices()).rejects.toThrow("unavailable");
		dispose = registerWorldArchiveChoiceReadiness(
			Promise.reject(new Error("Subscription failed")),
		);
		await expect(waitForWorldArchiveChoices()).rejects.toThrow(
			"Subscription failed",
		);
	});

	it("rejects pending callers if their listener was cleaned up", async () => {
		let resolve!: () => void;
		dispose = registerWorldArchiveChoiceReadiness(
			new Promise<void>((ready) => {
				resolve = ready;
			}),
		);
		const waiting = waitForWorldArchiveChoices();
		dispose();
		resolve();
		await expect(waiting).rejects.toThrow("unavailable");
	});

	it("does not let stale cleanup remove the current root listener", async () => {
		const stale = registerWorldArchiveChoiceReadiness(Promise.resolve());
		dispose = registerWorldArchiveChoiceReadiness(Promise.resolve());
		stale();
		await expect(waitForWorldArchiveChoices()).resolves.toBeUndefined();
	});
});
