import {
	type ResourceProject,
	type ResourceVersion,
	resources,
} from "@stores/resources";
import { showToast } from "@ui/toast/toast";
import {
	createInstance,
	getInstance,
	type Instance,
	installInstance,
} from "@utils/instances";
import { installModpackFromUrl, installModpackFromZip } from "@utils/modpacks";
import { type Accessor, createSignal } from "solid-js";

interface UseInstallSubmitParams {
	close?: () => void;
	navigateHome: () => void;
	isModpackMode: Accessor<boolean>;
	modpackUrl: Accessor<string>;
	modpackPath: Accessor<string>;
	modpackInfo: Accessor<{ fullMetadata?: any } | undefined>;
	pendingResourceProject?: Accessor<ResourceProject | undefined>;
	pendingResourceVersion?: Accessor<ResourceVersion | undefined>;
}

export function useInstallSubmit(params: UseInstallSubmitParams) {
	const [isInstalling, setIsInstalling] = createSignal(false);

	const handleInstall = async (data: Partial<Instance>) => {
		setIsInstalling(true);
		try {
			if (
				params.isModpackMode() &&
				(params.modpackUrl() || params.modpackPath())
			) {
				const sourceUrl = params.modpackUrl();
				const sourcePath = params.modpackPath();
				const fullMetadata = params.modpackInfo()?.fullMetadata;
				if (sourceUrl) {
					await installModpackFromUrl(sourceUrl, data, fullMetadata);
				} else if (sourcePath) {
					await installModpackFromZip(sourcePath, data, fullMetadata);
				}
			} else if (params.isModpackMode()) {
				showToast({
					title: "Modpack Version Still Loading",
					description:
						"Wait for a version to finish loading, then try installing again.",
					severity: "warning",
				});
				return;
			} else {
				const id = await createInstance(data as any);
				if (id) {
					const instance = await getInstance(id);
					await installInstance(instance);
					const project = params.pendingResourceProject?.();
					const version = params.pendingResourceVersion?.();
					if (project && version) {
						await resources.install(project, version, id);
						showToast({
							title: "Resource Installation Started",
							description: `${project.name} will be installed into ${data.name || "the new instance"}.`,
							severity: "success",
						});
					}
				}
			}

			setTimeout(() => {
				if (params.close) params.close();
				else params.navigateHome();
			}, 500);
		} catch (error) {
			console.error("[Install] ERROR:", error);
			showToast({
				title: "Failed",
				description: String(error),
				severity: "error",
			});
		} finally {
			setIsInstalling(false);
		}
	};

	return { isInstalling, handleInstall };
}
