import { isAnimatedIconSource } from "@utils/icon-animation";
import { describe, expect, it } from "vitest";

describe("animated icon source detection", () => {
	it("detects animated image data urls", () => {
		expect(isAnimatedIconSource("data:image/gif;base64,R0lGODlh")).toBe(true);
		expect(isAnimatedIconSource("data:image/webp;base64,UklGRg==")).toBe(true);
	});

	it("ignores static and non-data icon sources", () => {
		expect(isAnimatedIconSource("data:image/png;base64,c3RhdGlj")).toBe(false);
		expect(isAnimatedIconSource("builtin:placeholder-1")).toBe(false);
		expect(isAnimatedIconSource("https://example.com/icon.gif")).toBe(false);
	});
});
