import type { InstalledResource } from "@stores/resources";
import type { CrashSuspect } from "@utils/crash-handler";

export const normalizeResourceToken = (value: string | null | undefined) =>
	(value ?? "")
		.toLowerCase()
		.replace(/(\.jar|\.disabled)+$/i, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

export const fileNameMatchesModId = (fileName: string, modId: string) => {
	if (!fileName || !modId) return false;
	if (fileName === modId) return true;
	if (!fileName.startsWith(`${modId}-`)) return false;

	const suffix = fileName.slice(modId.length + 1);
	return (
		/^[0-9]/.test(suffix) ||
		/^(fabric|forge|neoforge|quilt)-[0-9]/.test(suffix) ||
		/^mc[0-9]/.test(suffix)
	);
};

const versionParts = (value: string | null | undefined) => {
	const match = value?.match(/\d+(?:\.\d+)*/);
	return match ? match[0].split(".").map((part) => Number(part)) : [];
};

const compareVersions = (left: number[], right: number[]) => {
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i += 1) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
};

const cleanVersionLabel = (value: string) => value.replace(/[)\]]+$/g, "");

const describeRangeIssue = (
	current: number[],
	currentLabel: string,
	minLabel: string | null,
	maxLabel: string | null,
) => {
	const min = minLabel ? versionParts(minLabel) : [];
	const max = maxLabel ? versionParts(maxLabel) : [];

	if (min.length && compareVersions(current, min) < 0) {
		return `Installed ${currentLabel}, needs ${minLabel}${maxLabel ? `-${maxLabel}` : "+"}`;
	}

	if (max.length && compareVersions(current, max) > 0) {
		return `Installed ${currentLabel}, needs ${minLabel ? `${minLabel}-` : "<="}${maxLabel}`;
	}

	return null;
};

const normalizeBound = (value: string | undefined) => {
	const bound = cleanVersionLabel((value ?? "").trim());
	if (!bound || bound.includes("∞") || /^-?inf(inity)?$/i.test(bound)) return null;
	return bound.match(/[0-9][^\s,\]\)]*/)?.[0] ?? null;
};

export const getRequiredVersionIssue = (
	resource: InstalledResource | undefined,
	reason?: string | null,
) => {
	if (!resource?.current_version || !reason) return null;

	const current = versionParts(resource.current_version);
	if (!current.length) return null;

	const lowerBound = reason.match(/version\s+([0-9][^\s,]*)\s+or later/i);
	if (lowerBound) {
		const required = versionParts(lowerBound[1]);
		if (required.length && compareVersions(current, required) < 0) {
			return `Installed ${resource.current_version}, needs ${lowerBound[1]}+`;
		}
	}

	const upperBound = reason.match(/version\s+([0-9][^\s,]*)\s+or\s+(?:earlier|older|lower|below)/i);
	if (upperBound) {
		const required = versionParts(upperBound[1]);
		if (required.length && compareVersions(current, required) > 0) {
			return `Installed ${resource.current_version}, needs <=${upperBound[1]}`;
		}
	}

	const betweenRange = reason.match(/between\s+([0-9][^\s,]*)\s+and\s+([0-9][^\s,]*)/i);
	if (betweenRange) {
		const issue = describeRangeIssue(
			current,
			resource.current_version,
			cleanVersionLabel(betweenRange[1]),
			cleanVersionLabel(betweenRange[2]),
		);
		if (issue) return issue;
	}

	const intervalRange = reason.match(/[\[(]+\s*([^,\]\)]+)\s*,\s*([^\]\)]+)\s*[\]\)]+/);
	if (intervalRange) {
		const issue = describeRangeIssue(
			current,
			resource.current_version,
			normalizeBound(intervalRange[1]),
			normalizeBound(intervalRange[2]),
		);
		if (issue) return issue;
	}

	const minorRange = reason.match(/any\s+([0-9]+)\.([0-9]+)\.x\s+version/i);
	if (
		minorRange &&
		(current[0] !== Number(minorRange[1]) || current[1] !== Number(minorRange[2]))
	) {
		return `Installed ${resource.current_version}, needs ${minorRange[1]}.${minorRange[2]}.x`;
	}

	return null;
};

export const matchSuspectToResource = (
	suspect: CrashSuspect,
	installed: InstalledResource[],
): InstalledResource | undefined => {
	const modId = normalizeResourceToken(suspect.mod_id);
	const displayName = normalizeResourceToken(suspect.display_name);

	return installed.find((resource) => {
		const fileName = normalizeResourceToken(resource.local_path.split(/[\\/]/).pop());
		const remoteId = normalizeResourceToken(resource.remote_id);
		const resourceName = normalizeResourceToken(resource.display_name);

		if (modId && (fileNameMatchesModId(fileName, modId) || remoteId === modId)) {
			return true;
		}
		return resourceName === displayName;
	});
};
