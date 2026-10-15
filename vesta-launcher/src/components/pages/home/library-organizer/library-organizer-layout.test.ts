import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const organizerStyles = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "library-organizer.module.css"),
	"utf8",
);

describe("library folder layout", () => {
	it("keeps the full-size button out of inline baseline layout", () => {
		// Chromium reserves a descender gap below an inline-block button, which
		// enlarges the square folder. This guards the CSS; jsdom has no layout.
		const tile = organizerStyles.match(/(?:^|\n)\.folderTile \{([^}]+)\}/)?.[1];
		expect(tile).toMatch(/\bdisplay:\s*block\s*;/);
	});
});
