export type ModpackUpdateVersion = {
	id: string;
	version_number: string;
	release_type: string;
	game_versions: string[];
};

const RELEASE_STABILITY_RANK: Record<string, number> = {
	alpha: 0,
	beta: 1,
	release: 2,
};

function getReleaseStabilityRank(releaseType: string | null | undefined, fallback: number) {
	return RELEASE_STABILITY_RANK[(releaseType || "").toLowerCase()] ?? fallback;
}

function parseVersionParts(version: string | null | undefined): number[] | null {
	if (!version) return null;
	const match = version.match(/\d+(?:\.\d+)*/);
	if (!match) return null;
	const parts = match[0].split(".").map((part) => Number(part));
	return parts.every((part) => Number.isFinite(part)) ? parts : null;
}

export function compareSemverishVersions(a: string, b: string): number | null {
	const aParts = parseVersionParts(a);
	const bParts = parseVersionParts(b);
	if (!aParts || !bParts) return null;

	const length = Math.max(aParts.length, bParts.length);
	for (let i = 0; i < length; i += 1) {
		const aPart = aParts[i] ?? 0;
		const bPart = bParts[i] ?? 0;
		if (aPart > bPart) return 1;
		if (aPart < bPart) return -1;
	}

	return 0;
}

export function selectEligibleModpackUpdate(
	versions: ModpackUpdateVersion[] | undefined,
	currentVersionId: string | null,
	currentMinecraftVersion: string,
): ModpackUpdateVersion | null {
	if (!versions || !currentVersionId) return null;

	const currentVersion = versions.find((version) => String(version.id) === currentVersionId);
	if (!currentVersion) return null;

	const currentRank = getReleaseStabilityRank(
		currentVersion.release_type,
		RELEASE_STABILITY_RANK.release,
	);

	const eligible = versions.filter((version) => {
		if (String(version.id) === currentVersionId) return false;
		if (!version.game_versions.includes(currentMinecraftVersion)) return false;

		const targetRank = getReleaseStabilityRank(version.release_type, -1);
		if (targetRank < currentRank) return false;

		const comparison = compareSemverishVersions(
			version.version_number,
			currentVersion.version_number,
		);
		return comparison !== null && comparison > 0;
	});

	if (eligible.length === 0) return null;

	return [...eligible].sort((a, b) => {
		const comparison = compareSemverishVersions(b.version_number, a.version_number);
		if (comparison !== null && comparison !== 0) return comparison;

		const bRank = getReleaseStabilityRank(b.release_type, -1);
		const aRank = getReleaseStabilityRank(a.release_type, -1);
		return bRank - aRank;
	})[0];
}
