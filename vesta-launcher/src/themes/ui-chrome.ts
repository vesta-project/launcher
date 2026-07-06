export type UiChromeMode = "windowed" | "flat";

export const DEFAULT_UI_CHROME_MODE: UiChromeMode = "windowed";

export function normalizeUiChromeMode(
	value: unknown,
): UiChromeMode | undefined {
	if (typeof value !== "string") return undefined;

	switch (value.trim().toLowerCase()) {
		case "windowed":
			return "windowed";
		case "flat":
			return "flat";
		default:
			return undefined;
	}
}

export function resolveUiChromeMode(...values: unknown[]): UiChromeMode {
	for (const value of values) {
		const normalized = normalizeUiChromeMode(value);
		if (normalized) return normalized;
	}

	return DEFAULT_UI_CHROME_MODE;
}

export function setUiChromeModeInThemeData(
	raw: unknown,
	mode: UiChromeMode,
): string {
	let themeData: Record<string, unknown> = {};

	if (typeof raw === "string" && raw.trim().length > 0) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				themeData = parsed as Record<string, unknown>;
			}
		} catch (error) {
			console.error(
				"Failed to preserve theme_data while updating UI chrome mode:",
				error,
			);
		}
	} else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		themeData = raw as Record<string, unknown>;
	}

	return JSON.stringify({
		...themeData,
		uiChromeMode: mode,
	});
}
