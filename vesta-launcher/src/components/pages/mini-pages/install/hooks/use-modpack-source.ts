import type { ResourceVersion } from "@stores/resources";
import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "@ui/toast/toast";
import {
	getModpackInfo,
	getModpackInfoFromUrl,
	type ModpackInfo,
	matchLocalModpackSource,
} from "@utils/modpacks";
import {
	type Accessor,
	batch,
	createEffect,
	createMemo,
	createSignal,
	untrack,
} from "solid-js";

export type ModpackPreflightPhase =
	| "idle"
	| "reading-local-pack"
	| "fetching-pack-details"
	| "matching-source"
	| "ready"
	| "ready-with-warnings"
	| "failed";

export interface ModpackPreflightStatus {
	phase: ModpackPreflightPhase;
	message?: string;
	error?: string;
	canRetry: boolean;
}

interface UseModpackSourceParams {
	projectId?: string;
	platform?: string;
	projectName?: string;
	projectIcon?: string;
	projectAuthor?: string;
	initialVersion?: string;
	initialVersionNumber?: string;
	initialMinecraftVersion?: string;
	initialModloader?: string;
	initialModloaderVersion?: string;
	originalIcon?: string;
	prefilledModpackInfo?: ModpackInfo;
	modpackUrl?: string;
	modpackPath?: string;
	selectedModpackVersionId: Accessor<string>;
	projectVersions?: Accessor<ResourceVersion[] | undefined>;
}

export function useModpackSource(params: UseModpackSourceParams) {
	const [isFetchingMetadata, setIsFetchingMetadata] = createSignal(false);
	const [metadataRetryNonce, setMetadataRetryNonce] = createSignal(0);
	const [metadataStatus, setMetadataStatus] =
		createSignal<ModpackPreflightStatus>({
			phase: params.prefilledModpackInfo ? "ready" : "idle",
			canRetry: false,
		});
	const [modpackUrl, setModpackUrl] = createSignal(params.modpackUrl || "");
	const [modpackPath, setModpackPath] = createSignal(params.modpackPath || "");
	const [modpackInfo, setModpackInfo] = createSignal<ModpackInfo | undefined>(
		params.prefilledModpackInfo,
	);
	const [urlInputValue, setUrlInputValue] = createSignal("");
	let latestRequestId = 0;
	let latestMatchRequestId = 0;

	const originalIcon = createMemo(
		() =>
			params.originalIcon ||
			modpackInfo()?.iconUrl ||
			params.projectIcon ||
			undefined,
	);

	const fallbackProjectInfo = (): ModpackInfo => {
		const versions = params.projectVersions?.();
		const initialVerId =
			params.initialVersion || params.selectedModpackVersionId();
		const selectedVer =
			versions?.find(
				(v) => v.id === initialVerId || v.version_number === initialVerId,
			) || versions?.[0];

		return {
			name: params.projectName || "Unknown Modpack",
			version:
				selectedVer?.version_number ||
				params.initialVersionNumber ||
				params.initialVersion ||
				"1.0.0",
			author: params.projectAuthor || null,
			description: null,
			iconUrl: params.projectIcon || null,
			minecraftVersion:
				selectedVer?.game_versions[0] || params.initialMinecraftVersion || "",
			modloader:
				(selectedVer?.loaders[0] as any) ||
				params.initialModloader ||
				"vanilla",
			modloaderVersion: params.initialModloaderVersion || null,
			modCount: 0,
			format: params.platform || "unknown",
			modpackId: params.projectId,
			modpackVersionId: selectedVer?.id || params.initialVersion,
			modpackPlatform: params.platform,
		};
	};

	const startSourceMatch = (path: string, baseInfo: ModpackInfo) => {
		if (!path || params.projectId || params.platform || baseInfo.modpackId)
			return;
		const requestId = latestMatchRequestId + 1;
		latestMatchRequestId = requestId;
		setMetadataStatus({
			phase: "matching-source",
			message: "Matching online source...",
			canRetry: false,
		});

		void matchLocalModpackSource(path)
			.then((match) => {
				if (latestMatchRequestId !== requestId || modpackPath() !== path)
					return;
				const current = modpackInfo();
				if (!current) return;

				if (match.matched && match.modpackId && match.modpackPlatform) {
					setModpackInfo({
						...current,
						name: match.name || current.name,
						version: match.version || current.version,
						author: match.author || current.author,
						description: match.description || current.description,
						iconUrl: match.iconUrl || current.iconUrl,
						modpackId: match.modpackId,
						modpackVersionId:
							match.modpackVersionId || current.modpackVersionId,
						modpackPlatform: match.modpackPlatform,
						downloadCount: match.downloadCount ?? current.downloadCount ?? null,
						followerCount: match.followerCount ?? current.followerCount ?? null,
					});
					setMetadataStatus({ phase: "ready", canRetry: false });
					return;
				}

				if (match.warning) {
					console.info(
						"[InstallPage] Local modpack source match skipped:",
						match.warning,
					);
				}
				setMetadataStatus({ phase: "ready", canRetry: false });
			})
			.catch((error) => {
				if (latestMatchRequestId !== requestId || modpackPath() !== path)
					return;
				console.warn("[InstallPage] Source match failed:", error);
				setMetadataStatus({ phase: "ready", canRetry: false });
			});
	};

	createEffect(() => {
		metadataRetryNonce();
		const url = modpackUrl();
		const path = modpackPath();
		if (!url && !path) {
			latestRequestId += 1;
			setIsFetchingMetadata(false);
			if (params.projectId || params.projectName) {
				setModpackInfo(
					(current) =>
						current || params.prefilledModpackInfo || fallbackProjectInfo(),
				);
				setMetadataStatus({ phase: "ready", canRetry: false });
			} else {
				setModpackInfo(undefined);
				setMetadataStatus({ phase: "idle", canRetry: false });
			}
			return;
		}

		// If modpackInfo was already constructed from project params
		// (has modpackId set), and the URL/path was set programmatically
		// by useProjectVersions rather than explicit user input,
		// skip the download fetch.
		const currentInfo = untrack(() => modpackInfo());
		if (currentInfo && currentInfo.modpackId) return;

		const fetchDetails = async () => {
			const requestId = latestRequestId + 1;
			latestRequestId = requestId;
			setIsFetchingMetadata(true);
			setMetadataStatus({
				phase: path ? "reading-local-pack" : "fetching-pack-details",
				message: path
					? "Reading the root modpack manifest..."
					: "Fetching project and version details...",
				canRetry: false,
			});
			try {
				const info = url
					? await getModpackInfoFromUrl(url, params.projectId, params.platform)
					: await getModpackInfo(path, params.projectId, params.platform);
				if (latestRequestId !== requestId) return;
				setModpackInfo(info);
				setMetadataStatus({ phase: "ready", canRetry: false });
				if (path && !params.projectId && !params.platform) {
					startSourceMatch(path, info);
				}
			} catch (error) {
				if (latestRequestId !== requestId) return;
				console.error("[InstallPage] Metadata fetch error:", error);
				if (params.projectId || params.projectName) {
					const errorText = String(error);
					setModpackInfo(fallbackProjectInfo());
					setMetadataStatus({
						phase: "ready-with-warnings",
						message:
							"Using cached project details while online metadata is unavailable.",
						error: errorText,
						canRetry: true,
					});
					showToast({
						title: "Modpack Details Limited",
						description:
							"Using the project details already loaded from Browse.",
						severity: "warning",
					});
				} else {
					showToast({
						title: "Metadata Sync Failed",
						description:
							"Could not read modpack metadata from the provided source. Check your selection.",
						severity: "warning",
					});
					setModpackInfo(undefined);
					setMetadataStatus({
						phase: "failed",
						message: "Could not read this modpack.",
						error: String(error),
						canRetry: true,
					});
				}
			} finally {
				if (latestRequestId === requestId) {
					setIsFetchingMetadata(false);
				}
			}
		};

		void fetchDetails();
	});

	const handleLocalImport = async () => {
		try {
			const res = await open({
				multiple: false,
				filters: [{ name: "Modpack", extensions: ["zip", "mrpack"] }],
			});
			if (res && typeof res === "string") {
				batch(() => {
					latestMatchRequestId += 1;
					setModpackInfo(undefined);
					setModpackPath(res);
					setModpackUrl("");
				});
			}
		} catch (error) {
			console.error("[InstallPage] Import error:", error);
		}
	};

	const handleUrlSubmit = () => {
		const value = urlInputValue().trim();
		if (!value) return false;
		batch(() => {
			latestMatchRequestId += 1;
			setModpackInfo(undefined);
			setModpackUrl(value);
			setModpackPath("");
			setUrlInputValue("");
		});
		return true;
	};

	const resetSource = () => {
		batch(() => {
			latestRequestId += 1;
			latestMatchRequestId += 1;
			setIsFetchingMetadata(false);
			setMetadataStatus({ phase: "idle", canRetry: false });
			setModpackUrl("");
			setModpackPath("");
			setModpackInfo(undefined);
		});
	};

	const retryMetadata = () => {
		setMetadataRetryNonce((value) => value + 1);
	};

	return {
		isFetchingMetadata,
		metadataStatus,
		modpackUrl,
		setModpackUrl,
		modpackPath,
		setModpackPath,
		modpackInfo,
		setModpackInfo,
		urlInputValue,
		setUrlInputValue,
		originalIcon,
		handleLocalImport,
		handleUrlSubmit,
		resetSource,
		retryMetadata,
	};
}
