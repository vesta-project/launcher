import { describe, expect, it } from "vitest";
import { decodeCurseForgeLinkout, parseResourceUrl } from "./resource-url";

describe("decodeCurseForgeLinkout", () => {
	it("should return the original URL if not a CurseForge linkout", () => {
		const url = "https://modrinth.com/mod/sodium";
		expect(decodeCurseForgeLinkout(url)).toBe(url);
	});

	it("should decode a single-encoded CurseForge linkout URL", () => {
		const remoteUrl = "https://modrinth.com/user/AlexModGuy";
		const url = `https://www.curseforge.com/linkout?remoteUrl=${encodeURIComponent(remoteUrl)}`;
		expect(decodeCurseForgeLinkout(url)).toBe(remoteUrl);
	});

	it("should decode a double-encoded CurseForge linkout URL", () => {
		// Example from user: https://www.curseforge.com/linkout?remoteUrl=https%253a%252f%252fmodrinth.com%252fuser%252fAlexModGuy
		const url =
			"https://www.curseforge.com/linkout?remoteUrl=https%253a%252f%252fmodrinth.com%252fuser%252fAlexModGuy";
		const expected = "https://modrinth.com/user/AlexModGuy";
		expect(decodeCurseForgeLinkout(url)).toBe(expected);
	});

	it("should handle invalid URLs gracefully", () => {
		expect(decodeCurseForgeLinkout("not-a-url")).toBe("not-a-url");
	});
});

describe("parseResourceUrl", () => {
	it("should parse a Modrinth resource URL", () => {
		const url = "https://modrinth.com/mod/sodium";
		expect(parseResourceUrl(url)).toEqual({
			platform: "modrinth",
			id: "sodium",
			activeTab: undefined,
		});
	});

	it("should parse a Modrinth version URL into nested version focus", () => {
		expect(
			parseResourceUrl(
				"https://modrinth.com/mod/sodium/version/mc1.21.4-0.6.7",
			),
		).toEqual({
			platform: "modrinth",
			id: "sodium",
			activeTab: "versions",
			versionId: "mc1.21.4-0.6.7",
		});
	});

	it("should parse a CurseForge resource URL", () => {
		const url = "https://www.curseforge.com/minecraft/mc-mods/jei";
		expect(parseResourceUrl(url)).toEqual({
			platform: "curseforge",
			id: "jei",
			activeTab: undefined,
		});
	});

	it("should parse a CurseForge file URL into nested version focus", () => {
		expect(
			parseResourceUrl(
				"https://www.curseforge.com/minecraft/mc-mods/jei/files/6123456",
			),
		).toEqual({
			platform: "curseforge",
			id: "jei",
			activeTab: "versions",
			versionId: "6123456",
		});
	});

	it("should parse a CurseForge linkout that points to a Modrinth resource", () => {
		const remoteUrl = "https://modrinth.com/mod/sodium";
		const url = `https://www.curseforge.com/linkout?remoteUrl=${encodeURIComponent(remoteUrl)}`;
		expect(parseResourceUrl(url)).toEqual({
			platform: "modrinth",
			id: "sodium",
			activeTab: undefined,
		});
	});

	it("should parse a CurseForge linkout that points to a CurseForge resource", () => {
		const remoteUrl = "https://www.curseforge.com/minecraft/mc-mods/jei";
		const url = `https://www.curseforge.com/linkout?remoteUrl=${encodeURIComponent(remoteUrl)}`;
		expect(parseResourceUrl(url)).toEqual({
			platform: "curseforge",
			id: "jei",
			activeTab: undefined,
		});
	});

	it("should return null for non-resource URLs even if they are CurseForge linkouts", () => {
		const remoteUrl = "https://google.com";
		const url = `https://www.curseforge.com/linkout?remoteUrl=${encodeURIComponent(remoteUrl)}`;
		expect(parseResourceUrl(url)).toBeNull();
	});

	it("should parse a Smithed pack URL", () => {
		expect(parseResourceUrl("https://smithed.dev/packs/coc")).toEqual({
			platform: "smithed",
			id: "coc",
		});
		expect(parseResourceUrl("https://nightly.smithed.net/packs/coc")).toEqual({
			platform: "smithed",
			id: "coc",
		});
	});
});
