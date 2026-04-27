import type { ResourceVersion } from "@stores/resources";
import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "@ui/toast/toast";
import { getModpackInfo, getModpackInfoFromUrl, type ModpackInfo } from "@utils/modpacks";
import { type Accessor, batch, createEffect, createMemo, createSignal } from "solid-js";

interface UseModpackSourceParams {
	projectId?: string;
	platform?: string;
	projectName?: string;
	projectIcon?: string;
	projectAuthor?: string;
	initialVersion?: string;
	initialModloader?: string;
	initialModloaderVersion?: string;
	originalIcon?: string;
	modpackUrl?: string;
	modpackPath?: string;
	selectedModpackVersionId: Accessor<string>;
	projectVersions?: Accessor<ResourceVersion[] | undefined>;
}

export function useModpackSource(params: UseModpackSourceParams) {
	const [isFetchingMetadata, setIsFetchingMetadata] = createSignal(false);
	const [modpackUrl, setModpackUrl] = createSignal(params.modpackUrl || "");
	const [modpackPath, setModpackPath] = createSignal(params.modpackPath || "");
	const [modpackInfo, setModpackInfo] = createSignal<ModpackInfo | undefined>();
	const [urlInputValue, setUrlInputValue] = createSignal("");
	let latestRequestId = 0;

	const originalIcon = createMemo(
		() => params.originalIcon || modpackInfo()?.iconUrl || params.projectIcon || undefined,
	);

	createEffect(() => {
		const url = modpackUrl();
		const path = modpackPath();
		if (!url && !path) {
			latestRequestId += 1;
			setIsFetchingMetadata(false);
			setModpackInfo(undefined);
			return;
		}

		const fetchDetails = async () => {
			const requestId = latestRequestId + 1;
			latestRequestId = requestId;
			setIsFetchingMetadata(true);
			try {
				const info = url
					? await getModpackInfoFromUrl(url, params.projectId, params.platform)
					: await getModpackInfo(path, params.projectId, params.platform);
				if (latestRequestId !== requestId) return;
				setModpackInfo(info);
			} catch (error) {
				if (latestRequestId !== requestId) return;
				console.error("[InstallPage] Metadata fetch error:", error);
				if (params.projectId || params.projectName) {
					const versions = params.projectVersions?.();
					const initialVerId = params.initialVersion || params.selectedModpackVersionId();
					const selectedVer =
						versions?.find((v) => v.id === initialVerId || v.version_number === initialVerId) ||
						versions?.[0];

					setModpackInfo({
						name: params.projectName || "Unknown Modpack",
						version: selectedVer?.version_number || params.initialVersion || "1.0.0",
						author: params.projectAuthor || "",
						description: null,
						iconUrl: params.projectIcon || null,
						minecraftVersion: selectedVer?.game_versions[0] || params.initialModloaderVersion || "",
						modloader: (selectedVer?.loaders[0] as any) || params.initialModloader || "vanilla",
						modloaderVersion: null,
						modCount: 0,
						format: "unknown",
					});
				} else {
					showToast({
						title: "Metadata Sync Failed",
						description:
							"Could not read modpack metadata from the provided source. Check your selection.",
						severity: "warning",
					});
					batch(() => {
						setModpackUrl("");
						setModpackPath("");
					});
				}
			} finally {
				if (latestRequestId !== requestId) return;
				setIsFetchingMetadata(false);
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
				setModpackPath(res);
				setModpackUrl("");
			}
		} catch (error) {
			console.error("[InstallPage] Import error:", error);
		}
	};

	const handleUrlSubmit = () => {
		const value = urlInputValue().trim();
		if (!value) return false;
		setModpackUrl(value);
		setModpackPath("");
		setUrlInputValue("");
		return true;
	};

	const resetSource = () => {
		batch(() => {
			latestRequestId += 1;
			setIsFetchingMetadata(false);
			setModpackUrl("");
			setModpackPath("");
			setModpackInfo(undefined);
		});
	};

	return {
		isFetchingMetadata,
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
	};
}
