import type { ResourceVersion } from "@stores/resources";
import { t } from "~/localization";
import { resources } from "@stores/resources";
import { showToast } from "@ui/toast/toast";
import {
	createInstance,
	getInstance,
	type Instance,
	installInstance,
} from "@utils/instances";
import { installModpackFromUrl, installModpackFromZip } from "@utils/modpacks";
import type { PendingResourceInstall } from "@utils/resource-install-intent";
import { requiresWorldTarget } from "@utils/resource-install-intent";
import { type Accessor, createSignal } from "solid-js";

interface UseInstallSubmitParams {
	close?: () => void;
	navigateHome: () => void;
	isModpackMode: Accessor<boolean>;
	modpackUrl: Accessor<string>;
	modpackPath: Accessor<string>;
	modpackInfo: Accessor<{ fullMetadata?: any } | undefined>;
	resolveConcreteModpackVersion?: () => Promise<ResourceVersion>;
	pendingResource?: Accessor<PendingResourceInstall | undefined>;
}

export function useInstallSubmit(params: UseInstallSubmitParams) {
	const [isInstalling, setIsInstalling] = createSignal(false);

	const handleInstall = async (data: Partial<Instance>) => {
		setIsInstalling(true);
		try {
			const pending = params.pendingResource?.();
			const pendingNeedsWorld =
				!!pending?.project &&
				requiresWorldTarget(
					pending.project,
					pending.version,
					pending.installType,
				);
			if (params.isModpackMode()) {
				let sourceUrl = params.modpackUrl();
				const sourcePath = params.modpackPath();
				let installData = data;
				if (!sourceUrl && !sourcePath) {
					const version = await params.resolveConcreteModpackVersion?.();
					if (!version?.download_url) {
						throw new Error("No downloadable modpack release is available.");
					}
					sourceUrl = version.download_url;
					installData = { ...data, modpackVersionId: version.id };
				}
				const fullMetadata = params.modpackInfo()?.fullMetadata;
				if (sourceUrl) {
					await installModpackFromUrl(sourceUrl, installData, fullMetadata);
				} else if (sourcePath) {
					await installModpackFromZip(sourcePath, installData, fullMetadata);
				}
			} else {
				const id = await createInstance(data as any);
				if (id) {
					const instance = await getInstance(id);
					await installInstance(instance);
					const pendingResource = params.pendingResource?.();
					const project = pendingResource?.project;
					const version = pendingResource?.version;
					if (project && version && !pendingNeedsWorld) {
						await resources.install(
							project,
							version,
							{
								kind: "instance",
								instanceId: id,
							},
							{ installType: pendingResource?.installType },
						);
						showToast({
							title: t("install-submit-resource-started-title"),
							description: t("install-submit-resource-started-description", {
								projectName: project.name,
								instanceName:
									data.name || t("install-submit-instance-fallback"),
							}),
							severity: "success",
						});
					} else if (project && pendingNeedsWorld) {
						showToast({
							title: t("install-submit-world-first-title"),
							description: t("install-submit-world-first-description", {
								instanceName:
									data.name || t("install-submit-new-instance-fallback"),
								projectName: project.name,
							}),
							severity: "warning",
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
				title: t("rust-task-failed"),
				description: String(error),
				severity: "error",
			});
		} finally {
			setIsInstalling(false);
		}
	};

	return { isInstalling, handleInstall };
}
