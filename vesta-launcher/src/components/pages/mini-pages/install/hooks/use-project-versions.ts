import { type ResourceVersion, resources, type SourcePlatform } from "@stores/resources";
import { showToast } from "@ui/toast/toast";
import { type Accessor, batch, createEffect, createResource } from "solid-js";

const PROJECT_VERSIONS_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${operation} timed out after ${Math.round(timeoutMs / 1000)}s`));
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
	modpackInfo: Accessor<{ modpackId?: string; modpackPlatform?: string } | undefined>;
	projectId?: Accessor<string | undefined>;
	platform?: Accessor<string | undefined>;
	initialVersion?: Accessor<string | undefined>;
	selectedModpackVersionId: Accessor<string>;
	setSelectedModpackVersionId: (id: string) => void;
	setModpackUrl: (url: string) => void;
}

export function useProjectVersions(params: UseProjectVersionsParams) {
	const [projectVersions] = createResource(
		() => {
			if (params.modpackPath()) return null;

			const pId = params.projectId?.() || params.modpackInfo()?.modpackId;
			const pPlatform = params.platform?.() || params.modpackInfo()?.modpackPlatform;
			if (pId && pPlatform) return { id: pId, platform: pPlatform };
			return null;
		},
		async ({ id, platform }: { id: string; platform: string }) => {
			try {
				const vs = await withTimeout(
					resources.getVersions(platform as SourcePlatform, id),
					PROJECT_VERSIONS_TIMEOUT_MS,
					"Project versions lookup",
				);
				const currentUrl = params.modpackUrl();
				const info = params.modpackInfo();
				const initialVer =
					params.initialVersion?.() ||
					(info as { modpackVersionId?: string } | undefined)?.modpackVersionId;

				if (initialVer) {
					const match = vs.find(
						(v: ResourceVersion) => v.id === initialVer || v.version_number === initialVer,
					);
					if (match) {
						params.setSelectedModpackVersionId(match.id);
						return vs;
					}
				}

				if (currentUrl) {
					const match = vs.find((v: ResourceVersion) => v.download_url === currentUrl);
					if (match) {
						params.setSelectedModpackVersionId(match.id);
						return vs;
					}
				}

				if (vs.length > 0 && params.isModpackMode()) {
					const target = vs[0];
					batch(() => {
						params.setSelectedModpackVersionId(target.id);
						params.setModpackUrl(target.download_url);
					});
				}
				return vs;
			} catch (error) {
				console.error("[InstallPage] Version fetch failed:", error);
				showToast({
					title: "Version Sync Failed",
					description:
						"Could not load modpack versions right now. You can still continue and retry shortly.",
					severity: "warning",
				});
				return [];
			}
		},
	);

	createEffect(() => {
		const versions = projectVersions();
		const selectedId = params.selectedModpackVersionId();
		if (!versions || versions.length === 0 || !selectedId) return;

		const match = versions.find(
			(version: ResourceVersion) => version.id === selectedId || version.version_number === selectedId,
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

	return { projectVersions, handleModpackVersionChange };
}
