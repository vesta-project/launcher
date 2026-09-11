import { describe, expect, it } from "vitest";
import { getNotificationContext } from "./notifications";

describe("getNotificationContext", () => {
	it("reads the structured context envelope", () => {
		expect(
			getNotificationContext(
				JSON.stringify({
					context: {
						kind: "instance",
						id: "7",
						label: "All the Mods 9",
					},
				}),
			),
		).toEqual({ kind: "instance", id: "7", label: "All the Mods 9" });
	});

	it("keeps legacy and malformed metadata harmless", () => {
		expect(getNotificationContext('{"version":"1.21"}')).toBeUndefined();
		expect(getNotificationContext("not-json")).toBeUndefined();
		expect(getNotificationContext(null)).toBeUndefined();
	});
});
