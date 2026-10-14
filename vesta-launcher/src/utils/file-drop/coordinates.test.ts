/**
 * Coordinate conversion tests. These are pure arithmetic checks against the
 * documented per-OS units. They are NOT proof of native OS drag positions.
 */
import { afterEach, describe, expect, it } from "vitest";
import { dragCoordinateUnitForOs, nativeToCssPoint } from "./coordinates";

const originalDpr = window.devicePixelRatio;

function setDevicePixelRatio(value: number) {
	Object.defineProperty(window, "devicePixelRatio", {
		value,
		configurable: true,
	});
}

afterEach(() => {
	setDevicePixelRatio(originalDpr);
});

describe("dragCoordinateUnitForOs", () => {
	it("uses physical pixels only on Windows", () => {
		expect(dragCoordinateUnitForOs("windows")).toBe("physical");
	});

	it("treats macOS, Linux and unknown platforms as CSS pixels", () => {
		expect(dragCoordinateUnitForOs("macos")).toBe("css");
		expect(dragCoordinateUnitForOs("linux")).toBe("css");
		expect(dragCoordinateUnitForOs("plan9")).toBe("css");
		expect(dragCoordinateUnitForOs(undefined)).toBe("css");
	});
});

describe("nativeToCssPoint", () => {
	it("leaves CSS-unit positions unchanged, whatever the scale factor", () => {
		expect(nativeToCssPoint({ x: 200, y: 100 }, "css", 2)).toEqual({
			x: 200,
			y: 100,
		});
		expect(nativeToCssPoint({ x: 200, y: 100 }, "css", null)).toEqual({
			x: 200,
			y: 100,
		});
	});

	it("divides physical positions by the scale factor", () => {
		expect(nativeToCssPoint({ x: 200, y: 100 }, "physical", 2)).toEqual({
			x: 100,
			y: 50,
		});
		expect(nativeToCssPoint({ x: 300, y: 150 }, "physical", 1.5)).toEqual({
			x: 200,
			y: 100,
		});
	});

	it("falls back to devicePixelRatio when the scale factor is missing", () => {
		setDevicePixelRatio(2);
		expect(nativeToCssPoint({ x: 200, y: 100 }, "physical", null)).toEqual({
			x: 100,
			y: 50,
		});
	});

	it.each([
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("ignores an unusable scale factor (%s) and uses devicePixelRatio", (scale) => {
		setDevicePixelRatio(2);
		expect(nativeToCssPoint({ x: 200, y: 100 }, "physical", scale)).toEqual({
			x: 100,
			y: 50,
		});
	});

	it("uses 1 when neither the scale factor nor devicePixelRatio is usable", () => {
		setDevicePixelRatio(0);
		expect(nativeToCssPoint({ x: 200, y: 100 }, "physical", null)).toEqual({
			x: 200,
			y: 100,
		});
		setDevicePixelRatio(Number.NaN);
		expect(nativeToCssPoint({ x: 200, y: 100 }, "physical", 0)).toEqual({
			x: 200,
			y: 100,
		});
	});
});
