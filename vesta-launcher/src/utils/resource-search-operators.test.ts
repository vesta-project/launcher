import { describe, expect, it } from "vitest";
import { parseSearchFilterOperators } from "./resource-search-operators";

describe("parseSearchFilterOperators", () => {
	it("leaves plain search text alone", () => {
		expect(parseSearchFilterOperators("sodium")).toEqual({
			remainder: "sodium",
			filters: {},
			didExtract: false,
		});
	});

	it("does not extract a trailing version until committed", () => {
		expect(parseSearchFilterOperators("mc:1.21.1")).toEqual({
			remainder: "mc:1.21.1",
			filters: {},
			didExtract: false,
		});
	});

	it("extracts a trailing version when commitTrailing is set", () => {
		expect(
			parseSearchFilterOperators("mc:1.21.1", { commitTrailing: true }),
		).toEqual({
			remainder: "",
			filters: { gameVersion: "1.21.1" },
			didExtract: true,
		});
	});

	it("extracts mc and loader around free text when whitespace-terminated", () => {
		expect(
			parseSearchFilterOperators("mc:1.20.1 sodium loader:fabric "),
		).toEqual({
			remainder: "sodium",
			filters: { gameVersion: "1.20.1", loader: "fabric" },
			didExtract: true,
		});
	});

	it("commits trailing loader on Enter", () => {
		expect(
			parseSearchFilterOperators("sodium loader:fabric", {
				commitTrailing: true,
			}),
		).toEqual({
			remainder: "sodium",
			filters: { loader: "fabric" },
			didExtract: true,
		});
	});

	it("accepts version: as an alias for mc:", () => {
		expect(
			parseSearchFilterOperators("version:1.21.1 sodium"),
		).toEqual({
			remainder: "sodium",
			filters: { gameVersion: "1.21.1" },
			didExtract: true,
		});
	});

	it("does not extract incomplete versions even when whitespace-terminated", () => {
		expect(parseSearchFilterOperators("mc:1 sodium")).toEqual({
			remainder: "mc:1 sodium",
			filters: {},
			didExtract: false,
		});
	});

	it("does not extract version ranges", () => {
		expect(parseSearchFilterOperators("mc:1.21-1.22 sodium")).toEqual({
			remainder: "mc:1.21-1.22 sodium",
			filters: {},
			didExtract: false,
		});
	});

	it("does not extract unknown loaders", () => {
		expect(parseSearchFilterOperators("loader:rift sodium")).toEqual({
			remainder: "loader:rift sodium",
			filters: {},
			didExtract: false,
		});
	});

	it("maps neo to neoforge", () => {
		expect(parseSearchFilterOperators("loader:neo sodium")).toEqual({
			remainder: "sodium",
			filters: { loader: "neoforge" },
			didExtract: true,
		});
	});

	it("normalizes loader case", () => {
		expect(
			parseSearchFilterOperators("loader:NeoForge", { commitTrailing: true }),
		).toEqual({
			remainder: "",
			filters: { loader: "neoforge" },
			didExtract: true,
		});
	});
});
