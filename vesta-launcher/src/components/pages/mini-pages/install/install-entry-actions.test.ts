import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./install-entry-actions";

describe("isHttpUrl", () => {
	it("accepts http and https URLs", () => {
		expect(isHttpUrl("https://modrinth.com/modpack/foo")).toBe(true);
		expect(isHttpUrl("http://example.com/pack.zip")).toBe(true);
		expect(isHttpUrl("  HTTPS://Example.COM/x  ")).toBe(true);
	});

	it("rejects empty and non-http schemes", () => {
		expect(isHttpUrl("")).toBe(false);
		expect(isHttpUrl("   ")).toBe(false);
		expect(isHttpUrl("modrinth.com/modpack/foo")).toBe(false);
		expect(isHttpUrl("ftp://example.com/pack.zip")).toBe(false);
		expect(isHttpUrl("file:///tmp/pack.mrpack")).toBe(false);
	});
});
