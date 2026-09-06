export function parseSandboxExtraPaths(
	raw: string | string[] | null | undefined,
): string[] {
	if (Array.isArray(raw)) return raw;
	if (!raw || !raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is string => typeof entry === "string");
	} catch {
		return [];
	}
}
