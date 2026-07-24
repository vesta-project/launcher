import { afterNextPaint } from "@utils/window-readiness";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("afterNextPaint", () => {
	it("resolves after two animation frames when the window is paintable", async () => {
		vi.useFakeTimers();
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		const cancelFrame = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => undefined);

		const painted = afterNextPaint(1_000);
		frames.shift()?.(0);
		frames.shift()?.(16);

		await expect(painted).resolves.toBeUndefined();
		expect(cancelFrame).toHaveBeenCalled();
	});

	it("falls back when a hidden webview does not receive animation frames", async () => {
		vi.useFakeTimers();
		vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
		const cancelFrame = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => undefined);

		const painted = afterNextPaint(25);
		await vi.advanceTimersByTimeAsync(25);

		await expect(painted).resolves.toBeUndefined();
		expect(cancelFrame).toHaveBeenCalledWith(42);
	});
});
