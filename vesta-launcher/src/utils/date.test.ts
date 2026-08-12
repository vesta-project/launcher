import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./date";

const now = "2026-08-03T12:00:00.000Z";

describe("formatRelativeTime", () => {
	it.each([
		["2026-08-03T11:59:31.000Z", "just now"],
		["2026-08-03T11:58:00.000Z", "2 minutes ago"],
		["2026-08-03T09:00:00.000Z", "3 hours ago"],
		["2026-07-31T12:00:00.000Z", "3 days ago"],
		["2026-07-20T12:00:00.000Z", "2 weeks ago"],
		["2026-04-03T12:00:00.000Z", "4 months ago"],
		["2024-08-03T12:00:00.000Z", "2 years ago"],
	])("formats %s", (value, expected) => {
		expect(formatRelativeTime(value, now)).toBe(expected);
	});

	it("returns null for missing and invalid values", () => {
		expect(formatRelativeTime(null, now)).toBeNull();
		expect(formatRelativeTime("not-a-date", now)).toBeNull();
	});

	it("clamps future clock skew to just now", () => {
		expect(formatRelativeTime("2026-08-03T12:00:15.000Z", now)).toBe("just now");
	});
});
