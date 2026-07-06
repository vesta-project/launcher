import { describe, expect, it } from "vitest";
import {
	calculateRecommendedMemory,
	clampManualMemoryRange,
	DEFAULT_MIN_MEMORY_MB,
	getDynamicPreferredMaxMemoryMb,
	getGeneratedMemoryLimitMb,
	getManualMemoryLimitMb,
	getMemoryWarningThresholdMb,
	getRecommendedMaxMemoryForModCount,
	MAX_GENERATED_MEMORY_MB,
} from "./memory-policy";

describe("memory-policy", () => {
	it("chooses dynamic preferred max memory by system RAM", () => {
		expect(getDynamicPreferredMaxMemoryMb(8192)).toBe(4096);
		expect(getDynamicPreferredMaxMemoryMb(16384)).toBe(6144);
		expect(getDynamicPreferredMaxMemoryMb(32768)).toBe(8192);
		expect(getDynamicPreferredMaxMemoryMb(65536)).toBe(10240);
	});

	it("interpolates mod-count recommendations across policy ranges", () => {
		expect(getRecommendedMaxMemoryForModCount(0)).toBe(4096);
		expect(getRecommendedMaxMemoryForModCount(50)).toBe(6144);
		expect(getRecommendedMaxMemoryForModCount(100)).toBe(7168);
		expect(getRecommendedMaxMemoryForModCount(250)).toBe(12288);
		expect(getRecommendedMaxMemoryForModCount(501)).toBe(16384);
	});

	it("honors explicit modpack recommendation", () => {
		const recommendation = calculateRecommendedMemory(32768, 10, 10240);

		expect(recommendation.max).toBe(10240);
		expect(recommendation.source).toBe("modpack");
		expect(recommendation.adjustment).toBe("increased");
	});

	it("uses preferred max as a floor for generated memory", () => {
		expect(
			calculateRecommendedMemory(32768, 10, null, {
				defaultMaxMemory: 8192,
				defaultMinMemory: 2048,
			}).max,
		).toBe(8192);

		expect(
			calculateRecommendedMemory(8192, 10, null, {
				defaultMaxMemory: 12288,
				defaultMinMemory: 2048,
			}).max,
		).toBe(12288);
	});

	it("describes generated memory adjustments", () => {
		expect(calculateRecommendedMemory(32768, 10).adjustment).toBe("none");
		expect(calculateRecommendedMemory(32768, 250).adjustment).toBe("increased");

		const highForDevice = calculateRecommendedMemory(8192, 10, null, {
			defaultMaxMemory: 12288,
			defaultMinMemory: 2048,
		});
		expect(highForDevice.adjustment).toBe("high-for-device");
		expect(highForDevice.generatedLimit).toBe(getGeneratedMemoryLimitMb(8192));
		expect(highForDevice.max).toBe(12288);

		const largePack = calculateRecommendedMemory(8192, 1000);
		expect(largePack.adjustment).toBe("high-for-device");
		expect(largePack.max).toBe(getGeneratedMemoryLimitMb(8192));
	});

	it("leaves a device-memory buffer for generated pack targets", () => {
		expect(getGeneratedMemoryLimitMb(8192)).toBe(7168);
		expect(getGeneratedMemoryLimitMb(16384)).toBe(14336);
		expect(getGeneratedMemoryLimitMb(32768)).toBe(MAX_GENERATED_MEMORY_MB);
	});

	it("keeps mod-count generated recommendations within the policy maximum", () => {
		expect(getGeneratedMemoryLimitMb(131072)).toBe(MAX_GENERATED_MEMORY_MB);
		expect(calculateRecommendedMemory(131072, 1000).max).toBe(
			MAX_GENERATED_MEMORY_MB,
		);
	});

	it("allows manual memory up to physical RAM but not above it", () => {
		expect(getManualMemoryLimitMb(8192)).toBe(8192);
		expect(clampManualMemoryRange({ min: 2048, max: 12000 }, 8192)).toEqual({
			min: 2048,
			max: 8192,
			wasClamped: true,
		});
	});

	it("warns near physical RAM", () => {
		expect(getMemoryWarningThresholdMb(8192)).toBe(7168);
		expect(getMemoryWarningThresholdMb(32768)).toBe(29184);
	});

	it("keeps Xms conservative", () => {
		expect(calculateRecommendedMemory(32768, 1000).min).toBe(
			DEFAULT_MIN_MEMORY_MB,
		);
		expect(
			calculateRecommendedMemory(1024, 1000, null, {
				defaultMaxMemory: 512,
				defaultMinMemory: DEFAULT_MIN_MEMORY_MB,
			}).min,
		).toBe(512);
	});
});
