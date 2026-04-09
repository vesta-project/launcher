export const HEADER_COLLAPSE_RANGE_PX = 72;
export const HEADER_COMPACT_ENTER_PROGRESS = 0.92;
export const HEADER_COMPACT_EXIT_PROGRESS = 0.12;
export const RESOURCE_DETAILS_MOBILE_BREAKPOINT_PX = 900;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function computeHeaderCollapseProgress(
	scrollTop: number,
	maxScroll: number,
	targetRangePx = HEADER_COLLAPSE_RANGE_PX,
): number {
	if (!Number.isFinite(scrollTop) || !Number.isFinite(maxScroll)) return 0;
	if (targetRangePx <= 0 || maxScroll <= 0) return 0;

	const boundedTop = Math.min(Math.max(scrollTop, 0), maxScroll);
	if (boundedTop <= 0) return 0;

	// If content is short, use available scroll range so compact mode can still be reached.
	const effectiveRange = maxScroll < targetRangePx ? maxScroll : targetRangePx;
	if (effectiveRange <= 0) return 0;

	return clamp01(boundedTop / effectiveRange);
}

export function deriveHeaderCompactState(
	progress: number,
	wasCompact: boolean,
	enterThreshold = HEADER_COMPACT_ENTER_PROGRESS,
	exitThreshold = HEADER_COMPACT_EXIT_PROGRESS,
): boolean {
	const normalized = clamp01(progress);

	if (!wasCompact && normalized >= enterThreshold) {
		return true;
	}

	if (wasCompact && normalized <= exitThreshold) {
		return false;
	}

	return wasCompact;
}
