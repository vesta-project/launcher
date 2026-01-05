import { describe, expect, test } from "vitest";
import { getInstanceId } from "./instances";

describe("instances util", () => {
	test("getInstanceId returns numeric value", () => {
		const inst: any = {
			id: 42,
			name: "Test Instance",
		};
		expect(getInstanceId(inst)).toBe(42);
	});
});
