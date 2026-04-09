import { describe, expect, it } from "vitest";
import {
    computeHeaderCollapseProgress,
    deriveHeaderCompactState,
    HEADER_COLLAPSE_RANGE_PX,
} from "./resource-details-header-progress";

describe("computeHeaderCollapseProgress", () => {
	it("returns zero when no scrolling is possible", () => {
		expect(computeHeaderCollapseProgress(0, 0)).toBe(0);
		expect(computeHeaderCollapseProgress(50, 0)).toBe(0);
	});

	it("uses collapse range for long content", () => {
		expect(computeHeaderCollapseProgress(0, 500)).toBe(0);
		expect(computeHeaderCollapseProgress(36, 500)).toBeCloseTo(0.5, 5);
		expect(computeHeaderCollapseProgress(72, 500)).toBe(1);
		expect(computeHeaderCollapseProgress(400, 500)).toBe(1);
	});

	it("normalizes to available range for short content", () => {
		expect(computeHeaderCollapseProgress(5, 20)).toBeCloseTo(0.25, 5);
		expect(computeHeaderCollapseProgress(20, 20)).toBe(1);
	});

	it("clamps out-of-range values", () => {
		expect(computeHeaderCollapseProgress(-50, 300)).toBe(0);
		expect(computeHeaderCollapseProgress(999, 300)).toBe(1);
		expect(computeHeaderCollapseProgress(Number.NaN, 300)).toBe(0);
		expect(computeHeaderCollapseProgress(12, Number.POSITIVE_INFINITY)).toBe(0);
	});

	it("keeps the default target range stable", () => {
		expect(HEADER_COLLAPSE_RANGE_PX).toBe(72);
	});
});

describe("deriveHeaderCompactState", () => {
	it("enters compact mode after crossing enter threshold", () => {
		expect(deriveHeaderCompactState(0.5, false)).toBe(false);
		expect(deriveHeaderCompactState(0.93, false)).toBe(true);
	});

	it("keeps compact mode until exit threshold", () => {
		expect(deriveHeaderCompactState(0.8, true)).toBe(true);
		expect(deriveHeaderCompactState(0.2, true)).toBe(true);
		expect(deriveHeaderCompactState(0.1, true)).toBe(false);
	});

	it("supports custom hysteresis thresholds", () => {
		expect(deriveHeaderCompactState(0.7, false, 0.75, 0.25)).toBe(false);
		expect(deriveHeaderCompactState(0.8, false, 0.75, 0.25)).toBe(true);
		expect(deriveHeaderCompactState(0.3, true, 0.75, 0.25)).toBe(true);
		expect(deriveHeaderCompactState(0.2, true, 0.75, 0.25)).toBe(false);
	});
});
