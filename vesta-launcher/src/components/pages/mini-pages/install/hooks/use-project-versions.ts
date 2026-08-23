import {
	type ResourceVersion,
	resources,
	type SourcePlatform,
} from "@stores/resources";
import { showToast } from "@ui/toast/toast";
import { findBestVersion } from "@utils/resource-install-intent";
import {
	type Accessor,
	batch,
	createEffect,
	createResource,
	createSignal,
	untrack,
} from "solid-js";

const PROJECT_VERSIONS_TIMEOUT_MS = 20_000;

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(
				new Error(
					`${operation} timed out after ${Math.round(timeoutMs / 1000)}s`,
				),
			);
		}, timeoutMs);

		void promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

interface UseProjectVersionsParams {
	isModpackMode: Accessor<boolean>;
	modpackPath: Accessor<string>;
	modpackUrl: Accessor<string>;
	modpackInfo: Accessor<
		{ modpackId?: string; modpackPlatform?: string } | undefined
	>;
	projectId?: Accessor<string | undefined>;
	platform?: Accessor<string | undefined>;
	initialVersion?: Accessor<string | undefined>;
	initialMinecraftVersion?: Accessor<string | undefined>;
	initialModloader?: Accessor<string | undefined>;
	prefetchedVersions?: Accessor<ResourceVersion[] | undefined>;
	selectedModpackVersionId: Accessor<string>;
	setSelectedModpackVersionId: (id: string) => void;
	setModpackUrl: (url: string) => void;
}

type ProjectVersionSource = { id: string; platform: string };

export function createJoinableProjectVersionLookup(
	fetchVersions: (source: ProjectVersionSource) => Promise<ResourceVersion[]>,
) {
	let active: { key: string; promise: Promise<ResourceVersion[]> } | undefined;

	return (source: ProjectVersionSource) => {
		const key = `${source.platform}:${source.id}`;
		if (active?.key === key) return active.promise;

		const promise = fetchVersions(source).finally(() => {
			if (active?.promise === promise) active = undefined;
		});
		active = { key, promise };
		return promise;
	};
}

export function selectConcreteProjectVersion(
	versions: ResourceVersion[],
	options: {
		selectedId?: string;
		initialVersion?: string;
		currentUrl?: string;
		minecraftVersion?: string;
		loader?: string;
	},
): ResourceVersion | undefined {
	const downloadable = versions.filter((version) => !!version.download_url);
	const requestedId = options.selectedId || options.initialVersion;
	if (requestedId) {
		const requested = downloadable.find(
			(version) =>
				version.id === requestedId || version.version_number === requestedId,
		);
		if (requested) return requested;
	}

	if (options.currentUrl) {
		const current = downloadable.find(
			(version) => version.download_url === options.currentUrl,
		);
		if (current) return current;
	}

	const stable = downloadable.filter(
		(version) => version.release_type === "release",
	);
	const candidates = stable.length > 0 ? stable : downloadable;
	if (candidates.length === 0) return undefined;

	const best =
		options.minecraftVersion || options.loader
			? findBestVersion(
					candidates,
					options.minecraftVersion || "",
					options.loader || null,
					"release",
					"modpack",
				)
			: undefined;
	return best || candidates[0];
}

export function useProjectVersions(params: UseProjectVersionsParams) {
	const [versionLookupError, setVersionLookupError] = createSignal<
		Error | undefined
	>();
	const loadVersions = createJoinableProjectVersionLookup(
		async ({ id, platform }) => {
			const prefetched = params.prefetchedVersions?.();
			return prefetched && prefetched.length > 0
				? prefetched
				: await withTimeout(
						resources.getVersions(platform as SourcePlatform, id),
						PROJECT_VERSIONS_TIMEOUT_MS,
						"Project versions lookup",
					);
		},
	);

	const applyResolvedVersion = (versions: ResourceVersion[]) => {
		const info = params.modpackInfo();
		const target = selectConcreteProjectVersion(versions, {
			selectedId: params.selectedModpackVersionId(),
			initialVersion:
				params.initialVersion?.() ||
				(info as { modpackVersionId?: string } | undefined)?.modpackVersionId,
			currentUrl: params.modpackUrl(),
			minecraftVersion: params.initialMinecraftVersion?.(),
			loader: params.initialModloader?.(),
		});
		if (target && params.isModpackMode()) {
			batch(() => {
				params.setSelectedModpackVersionId(target.id);
				params.setModpackUrl(target.download_url);
			});
		}
		return target;
	};

	const [projectVersions, { refetch }] = createResource(
		() => {
			if (params.modpackPath()) return null;

			const pId =
				params.projectId?.() || untrack(() => params.modpackInfo())?.modpackId;
			const pPlatform =
				params.platform?.() ||
				untrack(() => params.modpackInfo())?.modpackPlatform;
			if (pId && pPlatform) return { id: pId, platform: pPlatform };
			return null;
		},
		async ({ id, platform }: { id: string; platform: string }) => {
			try {
				const vs = await loadVersions({ id, platform });
				setVersionLookupError(undefined);
				applyResolvedVersion(vs);
				return vs;
			} catch (error) {
				console.error("[InstallPage] Version fetch failed:", error);
				setVersionLookupError(
					error instanceof Error ? error : new Error(String(error)),
				);
				showToast({
					title: "Version Sync Failed",
					description:
						"Could not load modpack versions. Install will retry when you try again.",
					severity: "warning",
				});
				// Keep the populated install form usable. The explicit error signal owns
				// retry UI, while install submission can retry and report its own failure.
				return [];
			}
		},
	);

	const retryProjectVersions = () => {
		setVersionLookupError(undefined);
		return refetch();
	};

	const resolveConcreteVersion = async () => {
		const ready = applyResolvedVersion(projectVersions() || []);
		if (ready?.download_url) return ready;

		const versions = await refetch();
		const resolved = applyResolvedVersion(versions || []);
		if (!resolved?.download_url) {
			throw new Error("No downloadable modpack release is available.");
		}
		return resolved;
	};

	createEffect(() => {
		const versions = projectVersions();
		const selectedId = params.selectedModpackVersionId();
		if (!versions || versions.length === 0 || !selectedId) return;

		const match = versions.find(
			(version: ResourceVersion) =>
				version.id === selectedId || version.version_number === selectedId,
		);
		if (match) {
			if (match.id !== selectedId) params.setSelectedModpackVersionId(match.id);
			return;
		}

		const fallback = versions[0];
		batch(() => {
			params.setSelectedModpackVersionId(fallback.id);
			params.setModpackUrl(fallback.download_url);
		});
		showToast({
			title: "Version Updated",
			description:
				"The selected modpack version is no longer available. Switched to the latest available version.",
			severity: "info",
		});
	});

	const handleModpackVersionChange = (versionId: string) => {
		const versions = projectVersions();
		const target = versions?.find((v: ResourceVersion) => v.id === versionId);
		if (!target) return;
		params.setSelectedModpackVersionId(versionId);
		params.setModpackUrl(target.download_url);
	};

	return {
		projectVersions,
		versionLookupError,
		retryProjectVersions,
		resolveConcreteVersion,
		handleModpackVersionChange,
	};
}
