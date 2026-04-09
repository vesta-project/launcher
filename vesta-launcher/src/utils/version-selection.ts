import { type GameVersionMetadata, LoaderVersionInfo, PistonMetadata } from "@utils/instances";

const LOADER_SORT_ORDER = ["vanilla", "fabric", "forge", "neoforge", "quilt"];

export const MODLOADER_DISPLAY_NAMES: Record<string, string> = {
	vanilla: "Vanilla",
	fabric: "Fabric",
	forge: "Forge",
	neoforge: "NeoForge",
	quilt: "Quilt",
};

type SelectionAdjustmentCode = "minecraftVersion" | "modloader" | "modloaderVersion";

export interface VersionSelectionAdjustment {
	code: SelectionAdjustmentCode;
	message: string;
}

export interface ResolveVersionSelectionInput {
	metadata: PistonMetadata;
	minecraftVersion: string;
	modloader?: string | null;
	modloaderVersion?: string | null;
	includeSnapshots?: boolean;
	supportedMcVersions?: string[];
	supportedModloaders?: string[];
}

export interface ResolveVersionSelectionResult {
	minecraftVersion: string;
	modloader: string;
	modloaderVersion: string;
	adjustments: VersionSelectionAdjustment[];
}

function lower(value: string | null | undefined): string {
	return (value || "").trim().toLowerCase();
}

function sortLoaders(loaders: string[]): string[] {
	return [...loaders].sort((a, b) => {
		const aIdx = LOADER_SORT_ORDER.indexOf(a);
		const bIdx = LOADER_SORT_ORDER.indexOf(b);

		if (aIdx !== -1 || bIdx !== -1) {
			const safeA = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
			const safeB = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
			if (safeA !== safeB) return safeA - safeB;
		}

		return a.localeCompare(b);
	});
}

function getSupportedSet(values?: string[]): Set<string> | null {
	if (!values || values.length === 0) return null;
	const set = new Set(values.map((value) => lower(value)).filter(Boolean));
	set.add("vanilla");
	return set;
}

function getCandidateGameVersions(
	metadata: PistonMetadata,
	includeSnapshots: boolean,
	supportedMcVersions?: string[],
): GameVersionMetadata[] {
	const supportedSet =
		supportedMcVersions && supportedMcVersions.length > 0 ? new Set(supportedMcVersions) : null;

	let candidates = metadata.game_versions.filter((version) => {
		if (!includeSnapshots && !version.stable) return false;
		if (supportedSet && !supportedSet.has(version.id)) return false;
		return true;
	});

	if (candidates.length === 0) {
		candidates = metadata.game_versions.filter(
			(version) => !supportedSet || supportedSet.has(version.id),
		);
	}

	if (candidates.length === 0) {
		candidates = metadata.game_versions;
	}

	return candidates;
}

function findVersionMeta(
	metadata: PistonMetadata,
	versionId: string,
): GameVersionMetadata | undefined {
	return metadata.game_versions.find((version) => version.id === versionId);
}

function supportsLoader(versionMeta: GameVersionMetadata | undefined, loader: string) {
	if (!versionMeta) return false;
	if (loader === "vanilla") return true;
	return Object.keys(versionMeta.loaders).some((key) => lower(key) === loader);
}

function getLoaderVersionsForMeta(
	versionMeta: GameVersionMetadata | undefined,
	loader: string,
): LoaderVersionInfo[] {
	if (!versionMeta || loader === "vanilla") return [];

	const key = Object.keys(versionMeta.loaders).find((candidate) => {
		return lower(candidate) === loader;
	});

	if (!key) return [];
	return versionMeta.loaders[key] || [];
}

function selectPreferredLoaderVersion(versions: LoaderVersionInfo[]): string {
	const stable = versions.find((version) => version.stable);
	return (stable || versions[0])?.version || "";
}

function fallbackLoaderForVersion(
	versionMeta: GameVersionMetadata | undefined,
	supportedLoaders: Set<string> | null,
): string {
	if (!versionMeta) return "vanilla";

	const loaders = ["vanilla", ...Object.keys(versionMeta.loaders).map((key) => lower(key))].filter(
		(loader) => !supportedLoaders || supportedLoaders.has(loader),
	);

	if (loaders.includes("vanilla")) return "vanilla";
	return loaders[0] || "vanilla";
}

export function normalizeModloaderName(modloader: string | null | undefined): string {
	return lower(modloader) || "vanilla";
}

export function getModloaderDisplayName(modloader: string): string {
	const normalized = normalizeModloaderName(modloader);
	return MODLOADER_DISPLAY_NAMES[normalized] || normalized;
}

export function describeSelectionAdjustments(adjustments: VersionSelectionAdjustment[]): string {
	return adjustments.map((adjustment) => adjustment.message).join(" ");
}

export function getNotifiableSelectionAdjustments(
	adjustments: VersionSelectionAdjustment[],
): VersionSelectionAdjustment[] {
	return adjustments;
}

export function getAllModloaders(
	metadata: PistonMetadata | undefined,
	supportedModloaders?: string[],
): string[] {
	if (!metadata) return ["vanilla"];

	const supportedSet = getSupportedSet(supportedModloaders);
	const loaders = new Set<string>(["vanilla"]);

	for (const gameVersion of metadata.game_versions) {
		for (const loader of Object.keys(gameVersion.loaders)) {
			const normalized = lower(loader);
			if (supportedSet && !supportedSet.has(normalized)) continue;
			loaders.add(normalized);
		}
	}

	return sortLoaders([...loaders]);
}

export function getModloadersForGameVersion(
	metadata: PistonMetadata | undefined,
	minecraftVersion: string,
): string[] {
	if (!metadata || !minecraftVersion) return ["vanilla"];

	const versionMeta = findVersionMeta(metadata, minecraftVersion);
	if (!versionMeta) return ["vanilla"];

	return sortLoaders([
		"vanilla",
		...Object.keys(versionMeta.loaders).map((loader) => lower(loader)),
	]);
}

export function getLoaderVersionsForGameVersion(
	metadata: PistonMetadata | undefined,
	minecraftVersion: string,
	modloader: string,
): LoaderVersionInfo[] {
	if (!metadata || !minecraftVersion) return [];
	const normalizedLoader = normalizeModloaderName(modloader);
	if (normalizedLoader === "vanilla") return [];

	const versionMeta = findVersionMeta(metadata, minecraftVersion);
	return getLoaderVersionsForMeta(versionMeta, normalizedLoader);
}

export function resolveCompatibleVersionSelection(
	input: ResolveVersionSelectionInput,
): ResolveVersionSelectionResult {
	const includeSnapshots = input.includeSnapshots ?? true;
	const supportedLoaders = getSupportedSet(input.supportedModloaders);
	const candidates = getCandidateGameVersions(
		input.metadata,
		includeSnapshots,
		input.supportedMcVersions,
	);

	let minecraftVersion = (input.minecraftVersion || "").trim();
	let modloader = normalizeModloaderName(input.modloader);
	let modloaderVersion = (input.modloaderVersion || "").trim();

	const inputModloader = normalizeModloaderName(input.modloader);

	const adjustments: VersionSelectionAdjustment[] = [];

	if (supportedLoaders && modloader !== "vanilla" && !supportedLoaders.has(modloader)) {
		adjustments.push({
			code: "modloader",
			message: `${getModloaderDisplayName(modloader)} is not supported in this context. Switched to Vanilla.`,
		});
		modloader = "vanilla";
	}

	if (!minecraftVersion || !findVersionMeta(input.metadata, minecraftVersion)) {
		const fallbackVersion = candidates[0]?.id || "";
		if (fallbackVersion && fallbackVersion !== minecraftVersion) {
			adjustments.push({
				code: "minecraftVersion",
				message: `Minecraft ${minecraftVersion || "version"} is unavailable. Switched to ${fallbackVersion}.`,
			});
			minecraftVersion = fallbackVersion;
		}
	}

	let versionMeta = findVersionMeta(input.metadata, minecraftVersion);

	if (modloader !== "vanilla" && !supportsLoader(versionMeta, modloader)) {
		const compatibleVersion = candidates.find((candidate) => {
			if (!supportsLoader(candidate, modloader)) return false;
			const loaderVersions = getLoaderVersionsForMeta(candidate, modloader);
			return loaderVersions.length > 0;
		});

		if (compatibleVersion && compatibleVersion.id !== minecraftVersion) {
			adjustments.push({
				code: "minecraftVersion",
				message: `${getModloaderDisplayName(modloader)} is not available for ${minecraftVersion}. Switched to ${compatibleVersion.id}.`,
			});
			minecraftVersion = compatibleVersion.id;
			versionMeta = compatibleVersion;
		} else {
			const fallbackLoader = fallbackLoaderForVersion(versionMeta, supportedLoaders);
			if (fallbackLoader !== modloader) {
				adjustments.push({
					code: "modloader",
					message: `${getModloaderDisplayName(modloader)} is unavailable for ${minecraftVersion}. Switched to ${getModloaderDisplayName(fallbackLoader)}.`,
				});
				modloader = fallbackLoader;
			}
		}
	}

	if (modloader === "vanilla") {
		modloaderVersion = "";
		return {
			minecraftVersion,
			modloader,
			modloaderVersion,
			adjustments,
		};
	}

	let loaderVersions = getLoaderVersionsForMeta(versionMeta, modloader);
	if (loaderVersions.length === 0) {
		const compatibleVersion = candidates.find((candidate) => {
			if (!supportsLoader(candidate, modloader)) return false;
			return getLoaderVersionsForMeta(candidate, modloader).length > 0;
		});

		if (compatibleVersion && compatibleVersion.id !== minecraftVersion) {
			adjustments.push({
				code: "minecraftVersion",
				message: `${getModloaderDisplayName(modloader)} has no available versions for ${minecraftVersion}. Switched to ${compatibleVersion.id}.`,
			});
			minecraftVersion = compatibleVersion.id;
			versionMeta = compatibleVersion;
			loaderVersions = getLoaderVersionsForMeta(versionMeta, modloader);
		}
	}

	if (loaderVersions.length === 0) {
		adjustments.push({
			code: "modloader",
			message: `${getModloaderDisplayName(modloader)} has no installable versions right now. Switched to Vanilla.`,
		});
		modloader = "vanilla";
		modloaderVersion = "";
		return {
			minecraftVersion,
			modloader,
			modloaderVersion,
			adjustments,
		};
	}

	const preferredVersion = selectPreferredLoaderVersion(loaderVersions);
	const hasSelectedLoaderVersion = loaderVersions.some(
		(version) => version.version === modloaderVersion,
	);

	if (!hasSelectedLoaderVersion && preferredVersion) {
		const isSameModloader = inputModloader === modloader;
		const isAutomaticSwitch = !input.modloaderVersion;

		// Do not notify when a loader was just selected and we are assigning its
		// default latest compatible version for the first time.
		if (!isSameModloader || !isAutomaticSwitch) {
			adjustments.push({
				code: "modloaderVersion",
				message: `${getModloaderDisplayName(modloader)} ${modloaderVersion || "version"} is not available for ${minecraftVersion}. Switched to ${preferredVersion}.`,
			});
		}
		modloaderVersion = preferredVersion;
	}

	return {
		minecraftVersion,
		modloader,
		modloaderVersion,
		adjustments,
	};
}
