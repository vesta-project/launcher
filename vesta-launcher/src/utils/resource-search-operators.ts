const LOADER_ALIASES: Record<string, string> = {
	forge: "forge",
	fabric: "fabric",
	quilt: "quilt",
	neoforge: "neoforge",
	neo: "neoforge",
};

/** At least major.minor, optional patch / prerelease (e.g. 1.21, 1.21.1, 1.21.1-rc1). */
const COMPLETE_VERSION = /^\d+\.\d+(\.\d+)*([-+][\w.]+)?$/i;

/** Looks like a version range (1.21-1.22), not a single version with prerelease. */
const VERSION_RANGE = /^\d+(\.\d+)+-\d+(\.\d+)+$/;

const OPERATOR_RE = /\b(mc|version|loader):(\S+)/gi;

export type SearchFilterOperators = {
	gameVersion?: string;
	loader?: string;
};

export type ParsedSearchFilterOperators = {
	remainder: string;
	filters: SearchFilterOperators;
	didExtract: boolean;
};

export type ParseSearchFilterOptions = {
	/** Also commit a complete trailing token (Enter / blur). Default: whitespace-terminated only. */
	commitTrailing?: boolean;
};

function normalizeLoader(value: string): string | undefined {
	return LOADER_ALIASES[value.toLowerCase()];
}

function shouldCommitVersion(value: string): boolean {
	if (!value || VERSION_RANGE.test(value)) return false;
	return COMPLETE_VERSION.test(value);
}

/**
 * Extracts structured filter operators from browse search text.
 * Supported: `mc:1.21.1` (alias `version:`), `loader:fabric`, `loader:neo`.
 * Tokens commit when whitespace-terminated, or when `commitTrailing` and complete.
 * Version ranges (e.g. `mc:1.21-1.22`) are left in the query for now.
 */
export function parseSearchFilterOperators(
	input: string,
	options: ParseSearchFilterOptions = {},
): ParsedSearchFilterOperators {
	const filters: SearchFilterOperators = {};
	const removals: Array<{ start: number; end: number }> = [];
	const commitTrailing = options.commitTrailing === true;

	OPERATOR_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = OPERATOR_RE.exec(input)) !== null) {
		const key = match[1].toLowerCase();
		const value = match[2];
		const start = match.index;
		const end = start + match[0].length;
		const atEnd = end >= input.length || input.slice(end).trim() === "";
		const whitespaceTerminated =
			end < input.length && /\s/.test(input.charAt(end));

		const canCommit = whitespaceTerminated || (commitTrailing && atEnd);
		if (!canCommit) continue;

		if (key === "mc" || key === "version") {
			if (!shouldCommitVersion(value)) continue;
			filters.gameVersion = value;
			removals.push({ start, end });
			continue;
		}

		if (key === "loader") {
			const loader = normalizeLoader(value);
			if (!loader) continue;
			filters.loader = loader;
			removals.push({ start, end });
		}
	}

	if (removals.length === 0) {
		return { remainder: input, filters, didExtract: false };
	}

	let remainder = input;
	for (let i = removals.length - 1; i >= 0; i--) {
		const { start, end } = removals[i];
		remainder = `${remainder.slice(0, start)}${remainder.slice(end)}`;
	}

	return {
		remainder: remainder.replace(/\s+/g, " ").trim(),
		filters,
		didExtract: true,
	};
}
