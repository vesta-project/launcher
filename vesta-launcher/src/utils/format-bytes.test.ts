import { describe, expect, it } from "vitest";
import { formatBytes, formatBytesCompact, formatPercent } from "./format-bytes";

describe("formatBytes", () => {
	it("formats common sizes", () => {
		expect(formatBytes(0)).toBe("0 bytes");
		expect(formatBytes(512)).toBe("512 bytes");
		expect(formatBytes(2048)).toBe("2.00 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
		expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
	});
});

describe("formatBytesCompact", () => {
	it("returns null for invalid values", () => {
		expect(formatBytesCompact(null)).toBeNull();
		expect(formatBytesCompact(-1)).toBeNull();
	});

	it("formats with compact units", () => {
		expect(formatBytesCompact(1500)).toBe("1.5 KB");
	});
});

describe("formatPercent", () => {
	it("rounds to whole percent", () => {
		expect(formatPercent(25, 100)).toBe("25%");
		expect(formatPercent(0, 100)).toBe("0%");
	});
});
