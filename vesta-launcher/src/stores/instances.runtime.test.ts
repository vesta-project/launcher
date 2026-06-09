import {
	clearRunning,
	instancesState,
	isInstanceWarming,
	setLaunching,
	setRunning,
} from "@stores/instances";
import { beforeEach, describe, expect, it } from "vitest";

describe("instance runtime state", () => {
	beforeEach(() => {
		setLaunching("demo", false);
		clearRunning("demo");
	});

	it("clears launching via setLaunching(false)", () => {
		setLaunching("demo", true);
		setLaunching("demo", false);
		expect(instancesState.launchingIds["demo"]).toBeUndefined();
	});

	it("clears running via clearRunning", () => {
		setRunning("demo", { pid: 1, startTime: 1 });
		clearRunning("demo");
		expect(instancesState.runningIds["demo"]).toBeUndefined();
	});

	it("treats warming as launch-in-progress without a running process", () => {
		setLaunching("demo", true);
		expect(isInstanceWarming("demo")).toBe(true);
	});

	it("clears warming when running is set", () => {
		setLaunching("demo", true);
		setRunning("demo", { pid: 42, startTime: 1 });

		expect(instancesState.launchingIds["demo"]).toBeUndefined();
		expect(instancesState.runningIds["demo"]).toEqual({ pid: 42, startTime: 1 });
		expect(isInstanceWarming("demo")).toBe(false);
	});

	it("does not report warming once running even if launching was stuck", () => {
		setRunning("demo", { pid: 1, startTime: 1 });
		setLaunching("demo", true);

		expect(isInstanceWarming("demo")).toBe(false);
	});
});
