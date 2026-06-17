export interface MemoryRange {
	min: number;
	max: number;
	wasClamped?: boolean;
}

export type MemoryRecommendationSource = "preferred" | "mod-count" | "modpack";
export type MemoryRecommendationAdjustment =
	| "none"
	| "increased"
	| "high-for-device";

export interface MemoryRecommendation extends MemoryRange {
	source: MemoryRecommendationSource;
	adjustment: MemoryRecommendationAdjustment;
	preferredMax: number;
	policyMax: number;
	requestedMax: number;
	generatedLimit: number;
}

export interface MemoryRecommendationTier {
	minMods: number;
	maxMods: number | null;
	minMemoryMb: number;
	maxMemoryMb: number;
}

export const MEMORY_STEP_MB = 512;
export const DEFAULT_MIN_MEMORY_MB = 2048;
export const MAX_GENERATED_MEMORY_MB = 16384;

export const MOD_COUNT_MEMORY_TIERS: MemoryRecommendationTier[] = [
	{ minMods: 0, maxMods: 50, minMemoryMb: 4096, maxMemoryMb: 6144 },
	{ minMods: 51, maxMods: 150, minMemoryMb: 6144, maxMemoryMb: 8192 },
	{ minMods: 151, maxMods: 250, minMemoryMb: 8192, maxMemoryMb: 12288 },
	{ minMods: 251, maxMods: null, minMemoryMb: 12288, maxMemoryMb: 16384 },
];

export function roundDownToMemoryStep(valueMb: number): number {
	return Math.max(MEMORY_STEP_MB, Math.floor(valueMb / MEMORY_STEP_MB) * MEMORY_STEP_MB);
}

export function roundToNearestMemoryStep(valueMb: number): number {
	return Math.max(MEMORY_STEP_MB, Math.round(valueMb / MEMORY_STEP_MB) * MEMORY_STEP_MB);
}

export function getDynamicPreferredMaxMemoryMb(systemRamMb: number): number {
	if (!Number.isFinite(systemRamMb) || systemRamMb <= 8192) return 4096;
	if (systemRamMb <= 16384) return 6144;
	if (systemRamMb <= 32768) return 8192;
	return 10240;
}

function reservedGeneratedMemoryMb(systemRamMb: number): number {
	if (systemRamMb <= 8192) return 1024;
	if (systemRamMb <= 16384) return 2048;
	return 4096;
}

export function getGeneratedMemoryLimitMb(systemRamMb: number): number {
	if (!Number.isFinite(systemRamMb) || systemRamMb <= 0) return MAX_GENERATED_MEMORY_MB;

	const headroomCap = Math.max(MEMORY_STEP_MB, systemRamMb - reservedGeneratedMemoryMb(systemRamMb));
	return Math.min(MAX_GENERATED_MEMORY_MB, roundDownToMemoryStep(headroomCap));
}

export function getManualMemoryLimitMb(systemRamMb: number): number {
	if (!Number.isFinite(systemRamMb) || systemRamMb <= 0) return MAX_GENERATED_MEMORY_MB;
	return roundDownToMemoryStep(systemRamMb);
}

export function getMemoryWarningThresholdMb(systemRamMb: number): number {
	if (!Number.isFinite(systemRamMb) || systemRamMb <= 0) return MAX_GENERATED_MEMORY_MB;
	return roundDownToMemoryStep(systemRamMb * 0.9);
}

function interpolateTierMemory(tier: MemoryRecommendationTier, modCount: number): number {
	if (tier.maxMods === null) {
		const span = 250;
		const progress = Math.min(1, Math.max(0, (modCount - tier.minMods) / span));
		return tier.minMemoryMb + (tier.maxMemoryMb - tier.minMemoryMb) * progress;
	}

	const span = Math.max(1, tier.maxMods - tier.minMods);
	const progress = Math.min(1, Math.max(0, (modCount - tier.minMods) / span));
	return tier.minMemoryMb + (tier.maxMemoryMb - tier.minMemoryMb) * progress;
}

export function getRecommendedMaxMemoryForModCount(modCount: number): number {
	const normalizedModCount = Math.max(0, Math.floor(Number.isFinite(modCount) ? modCount : 0));
	const tier =
		MOD_COUNT_MEMORY_TIERS.find(
			(candidate) =>
				normalizedModCount >= candidate.minMods &&
				(candidate.maxMods === null || normalizedModCount <= candidate.maxMods),
		) ?? MOD_COUNT_MEMORY_TIERS[MOD_COUNT_MEMORY_TIERS.length - 1];

	return roundToNearestMemoryStep(interpolateTierMemory(tier, normalizedModCount));
}

export function clampManualMemoryRange(
	range: { min: number; max: number },
	systemRamMb: number,
): MemoryRange {
	const limit = getManualMemoryLimitMb(systemRamMb);
	const rawMin = Number.isFinite(range.min) ? range.min : DEFAULT_MIN_MEMORY_MB;
	const rawMax = Number.isFinite(range.max) ? range.max : getDynamicPreferredMaxMemoryMb(systemRamMb);
	const nextMax = roundDownToMemoryStep(Math.min(Math.max(rawMax, MEMORY_STEP_MB), limit));
	const nextMin = roundDownToMemoryStep(Math.min(Math.max(rawMin, MEMORY_STEP_MB), nextMax));

	return {
		min: nextMin,
		max: nextMax,
		wasClamped: nextMin !== rawMin || nextMax !== rawMax,
	};
}

export function calculateRecommendedMemory(
	systemRamMb: number,
	modCount: number,
	recommendedRamMb?: number | null,
	defaults?: {
		defaultMinMemory?: number | null;
		defaultMaxMemory?: number | null;
	},
): MemoryRecommendation {
	const policyMax =
		recommendedRamMb && recommendedRamMb > 0
			? recommendedRamMb
			: getRecommendedMaxMemoryForModCount(modCount);
	const preferredMax =
		defaults?.defaultMaxMemory ?? getDynamicPreferredMaxMemoryMb(systemRamMb);
	const generatedLimit = getGeneratedMemoryLimitMb(systemRamMb);
	const deviceAwarePolicyMax = Math.min(policyMax, generatedLimit);
	const requestedMax = Math.max(deviceAwarePolicyMax, preferredMax, MEMORY_STEP_MB);
	const nextMax = roundDownToMemoryStep(requestedMax);
	const preferredMin = defaults?.defaultMinMemory ?? DEFAULT_MIN_MEMORY_MB;
	const nextMin = roundDownToMemoryStep(Math.min(DEFAULT_MIN_MEMORY_MB, preferredMin, nextMax));
	const increased = deviceAwarePolicyMax > preferredMax;
	const highForDevice = policyMax > generatedLimit || nextMax > generatedLimit;
	const source =
		recommendedRamMb && recommendedRamMb > 0
			? "modpack"
			: policyMax > preferredMax
				? "mod-count"
				: "preferred";
	const adjustment = highForDevice ? "high-for-device" : increased ? "increased" : "none";

	return {
		min: nextMin,
		max: nextMax,
		wasClamped: false,
		source,
		adjustment,
		preferredMax,
		policyMax,
		requestedMax,
		generatedLimit,
	};
}
