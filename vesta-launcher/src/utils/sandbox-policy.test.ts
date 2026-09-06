import { describe, expect, it } from "vitest";
import { parseSandboxExtraPaths } from "./sandbox-policy";

describe("parseSandboxExtraPaths", () => {
	it.each([
		null,
		undefined,
		"",
		"   ",
		"invalid json",
		"null",
		"{}",
		"42",
		'"path"',
	])("returns no paths for empty or malformed input %j", (raw) =>
		expect(parseSandboxExtraPaths(raw)).toEqual([]));

	it("preserves Windows and Unix paths in stored JSON", () => {
		const paths = [
			String.raw`C:\Users\Player\Extra resources`,
			"/opt/minecraft/resources",
		];
		expect(parseSandboxExtraPaths(JSON.stringify(paths))).toEqual(paths);
	});

	it("filters non-string entries from stored JSON", () => {
		expect(
			parseSandboxExtraPaths('["/data",null,7,{},true,["/nested"]]'),
		).toEqual(["/data"]);
	});

	it("accepts already decoded settings without changing paths", () => {
		const paths = ["/data", "relative path", ""];
		expect(parseSandboxExtraPaths(paths)).toEqual(paths);
		expect(parseSandboxExtraPaths([])).toEqual([]);
	});
});
