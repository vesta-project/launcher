import { createInstance, getInstance, installInstance, type Instance } from "@utils/instances";
import { installModpackFromUrl, installModpackFromZip } from "@utils/modpacks";
import { showToast } from "@ui/toast/toast";
import { createSignal, type Accessor } from "solid-js";

interface UseInstallSubmitParams {
	close?: () => void;
	navigateHome: () => void;
	isModpackMode: Accessor<boolean>;
	modpackUrl: Accessor<string>;
	modpackPath: Accessor<string>;
	modpackInfo: Accessor<{ fullMetadata?: any } | undefined>;
}

export function useInstallSubmit(params: UseInstallSubmitParams) {
	const [isInstalling, setIsInstalling] = createSignal(false);

	const handleInstall = async (data: Partial<Instance>) => {
		setIsInstalling(true);
		try {
			if (params.isModpackMode() && (params.modpackUrl() || params.modpackPath())) {
				const sourceUrl = params.modpackUrl();
				const sourcePath = params.modpackPath();
				const fullMetadata = params.modpackInfo()?.fullMetadata;
				if (sourceUrl) {
					await installModpackFromUrl(sourceUrl, data, fullMetadata);
				} else if (sourcePath) {
					await installModpackFromZip(sourcePath, data, fullMetadata);
				}
			} else {
				const id = await createInstance(data as any);
				if (id) {
					const instance = await getInstance(id);
					await installInstance(instance);
				}
			}

			setTimeout(() => {
				if (params.close) params.close();
				else params.navigateHome();
			}, 500);
		} catch (error) {
			console.error("[Install] ERROR:", error);
			showToast({ title: "Failed", description: String(error), severity: "error" });
			setIsInstalling(false);
		}
	};

	return { isInstalling, handleInstall };
}
