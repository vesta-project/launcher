export function formatDate(dateStr?: string | null) {
	if (!dateStr) return "Unknown";
	try {
		return new Date(dateStr).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	} catch (_e) {
		return "Unknown";
	}
}

export function formatRelativeTime(
	dateValue?: string | number | Date | null,
	now: string | number | Date = new Date(),
): string | null {
	if (dateValue === null || dateValue === undefined || dateValue === "") return null;
	const dateMs = new Date(dateValue).getTime();
	const nowMs = new Date(now).getTime();
	if (!Number.isFinite(dateMs) || !Number.isFinite(nowMs)) return null;

	const elapsedSeconds = Math.max(0, Math.floor((nowMs - dateMs) / 1000));
	if (elapsedSeconds < 60) return "just now";

	const units: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
		["minute", 60, 60],
		["hour", 60 * 60, 24],
		["day", 60 * 60 * 24, 7],
		["week", 60 * 60 * 24 * 7, 4.35],
		["month", 60 * 60 * 24 * 30, 12],
		["year", 60 * 60 * 24 * 365, Number.POSITIVE_INFINITY],
	];
	for (const [unit, unitSeconds, upperBound] of units) {
		const value = elapsedSeconds / unitSeconds;
		if (value < upperBound) {
			return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(
				-Math.max(1, Math.round(value)),
				unit,
			);
		}
	}
	return null;
}
