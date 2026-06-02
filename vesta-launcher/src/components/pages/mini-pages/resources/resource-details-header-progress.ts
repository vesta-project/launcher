export const HEADER_COLLAPSE_RANGE_PX = 72;
export const HEADER_COMPACT_ENTER_PROGRESS = 0.92;
export const HEADER_COMPACT_EXIT_PROGRESS = 0.12;
export const RESOURCE_DETAILS_MOBILE_BREAKPOINT_PX = 900;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function computeHeaderCollapseProgress(
	scrollOffset: number,
	maxScroll = Number.POSITIVE_INFINITY,
	targetRangePx = HEADER_COLLAPSE_RANGE_PX,
): number {
	if (!Number.isFinite(scrollOffset) || scrollOffset <= 0) return 0;
	if (targetRangePx <= 0) return 0;

	const effectiveRange =
		Number.isFinite(maxScroll) && maxScroll > 0 && maxScroll < targetRangePx
			? maxScroll
			: targetRangePx;

	return clamp01(scrollOffset / effectiveRange);
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
