/**
 * Auto-calculates recommended memory allocation based on mod count and system RAM.
 *
 * Based on community consensus (2024/2025):
 *   < 30 mods:     4 GB
 *   30–50 mods:    4–6 GB
 *   50–150 mods:   6–8 GB
 *   150–300 mods:  8–10 GB
 *   300+ mods:     10–12 GB
 *
 * Important principles:
 * - Never allocate more than ~60% of system RAM (OS + background apps need memory)
 * - Over-allocation causes GC stutters — more is not always better
 * - Floor at 4 GB for any Minecraft instance
 */
export function calculateRecommendedMemory(
	systemRamMb: number,
	modCount: number,
	recommendedRamMb?: number | null,
): { min: number; max: number } {
	// If the modpack explicitly recommends RAM, honour it
	if (recommendedRamMb && recommendedRamMb > 0) {
		const systemCap = Math.floor(systemRamMb * 0.6);
		return {
			min: 2048,
			max: Math.max(4096, Math.min(recommendedRamMb, systemCap)),
		};
	}

	let maxMb: number;
	if (modCount <= 0)
		maxMb = 4096; // Vanilla / unknown
	else if (modCount < 30)
		maxMb = 4096; // Light
	else if (modCount < 50)
		maxMb = 6144; // Light-medium
	else if (modCount < 150)
		maxMb = 8192; // Medium
	else if (modCount < 300)
		maxMb = 10240; // Heavy
	else maxMb = 12288; // Expert-level (300+)

	// Never exceed ~60% of system RAM, never go below 4 GB
	const systemCap = Math.floor(systemRamMb * 0.6);
	maxMb = Math.max(4096, Math.min(maxMb, systemCap));

	return { min: 2048, max: maxMb };
}
