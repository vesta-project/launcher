import InstanceSelectionDialog, {
	type InstanceSelectionOption,
} from "@components/instances/InstanceSelectionDialog";
import { type Instance, instancesState } from "@stores/instances";
import {
	type InstalledResource,
	type ResourceProject,
	type ResourceType,
	type ResourceVersion,
	resources,
} from "@stores/resources";
import { invoke } from "@tauri-apps/api/core";
import {
	findBestVersionForInstance,
	findInstalledResource,
	isResourceUpdateAvailable,
} from "@utils/resource-install-intent";
import {
	getCompatibilityForInstance,
	getProjectCompatibilityForInstance,
} from "@utils/resources";
import { t } from "~/localization";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
} from "solid-js";

interface ResourceInstanceSelectionDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSelect: (instance: Instance) => void;
	onCreateNew: () => void;
	project?: ResourceProject;
	version?: ResourceVersion;
	versions?: ResourceVersion[];
	installType?: ResourceType;
}

const ResourceInstanceSelectionDialog: Component<
	ResourceInstanceSelectionDialogProps
> = (props) => {
	const [installedMap, setInstalledMap] = createSignal<
		Record<number, InstalledResource[]>
	>({});
	const [fetchedVersions, setFetchedVersions] = createSignal<ResourceVersion[]>(
		[],
	);
	const [isLoadingVersions, setIsLoadingVersions] = createSignal(false);
	const [installedLookupState, setInstalledLookupState] = createSignal<
		Record<number, "loading" | "ready" | "error">
	>({});
	let installedRequestGeneration = 0;
	let versionRequestGeneration = 0;
	const installType = () => props.installType ?? props.project?.resource_type;

	createEffect(() => {
		const isOpen = props.isOpen;
		const project = props.project;
		const currentInstallType = props.installType ?? project?.resource_type;
		const instances = [...instancesState.instances];
		const generation = ++installedRequestGeneration;
		onCleanup(() => {
			if (generation === installedRequestGeneration) {
				installedRequestGeneration += 1;
			}
		});
		if (!isOpen || !project || currentInstallType === "datapack") {
			setInstalledMap({});
			setInstalledLookupState({});
			return;
		}

		setInstalledMap({});
		setInstalledLookupState(
			Object.fromEntries(instances.map((instance) => [instance.id, "loading"])),
		);
		void Promise.all(
			instances.map(async (instance) => {
				try {
					const rows = await invoke<InstalledResource[]>(
						"get_installed_resources",
						{ instanceId: instance.id },
					);
					return { instanceId: instance.id, rows, failed: false };
				} catch (error) {
					console.error(
						t("resources-instance-fetch-installed-failed", { instance: instance.id }),
						error,
					);
					return { instanceId: instance.id, rows: [], failed: true };
				}
			}),
		).then((results) => {
			if (generation !== installedRequestGeneration) return;
			setInstalledMap(
				Object.fromEntries(
					results.map((result) => [result.instanceId, result.rows]),
				),
			);
			setInstalledLookupState(
				Object.fromEntries(
					results.map((result) => [
						result.instanceId,
						result.failed ? "error" : "ready",
					]),
				),
			);
		});
	});

	createEffect(() => {
		const isOpen = props.isOpen;
		const project = props.project;
		const suppliedVersions = props.versions;
		const generation = ++versionRequestGeneration;
		onCleanup(() => {
			if (generation === versionRequestGeneration) {
				versionRequestGeneration += 1;
			}
		});
		if (!isOpen || !project || (suppliedVersions?.length ?? 0) > 0) {
			setFetchedVersions([]);
			setIsLoadingVersions(false);
			return;
		}

		setFetchedVersions([]);
		setIsLoadingVersions(true);
		void resources
			.getVersions(project.source, project.id)
			.then((versions) => {
				if (generation === versionRequestGeneration) {
					setFetchedVersions(versions);
				}
			})
			.catch((error) => {
				if (generation === versionRequestGeneration) {
					console.error(
						t("resources-instance-fetch-versions-failed"),
						error,
					);
				}
			})
			.finally(() => {
				if (generation === versionRequestGeneration) {
					setIsLoadingVersions(false);
				}
			});
	});

	const versionsToUse = () =>
		props.versions && props.versions.length > 0
			? props.versions
			: fetchedVersions();

	const getCompatibility = (instance: Instance) => {
		if (!props.project) return { type: "compatible" as const };
		if (props.installType === "datapack") {
			return { type: "compatible" as const };
		}
		if (props.version) {
			return getCompatibilityForInstance(
				props.project,
				props.version,
				instance,
				props.installType,
			);
		}

		const projectCompatibility = getProjectCompatibilityForInstance(
			props.project,
			instance,
			props.installType,
		);
		if (projectCompatibility.type !== "compatible") {
			return projectCompatibility;
		}

		if (versionsToUse().length > 0) {
			const best = findBestVersionForInstance(
				props.project,
				versionsToUse(),
				instance,
				"release",
				props.installType,
			);
			return best
				? { type: "compatible" as const }
				: {
						type: "incompatible" as const,
					reason: t("resources-instance-no-compatible-version", {
						minecraftVersion: instance.minecraftVersion,
						loader: instance.modloader || t("instances-details-modloader-vanilla"),
					}),
					};
		}

		if (isLoadingVersions()) {
			return {
				type: "incompatible" as const,
				reason: t("resources-instance-loading-compatibility"),
			};
		}

		if (props.installType === "mod" || props.installType === "shader") {
			return {
				type: "incompatible" as const,
				reason: t("resources-instance-no-compatible-versions"),
			};
		}

		return { type: "compatible" as const };
	};
	const hasUpdate = (
		instance: Instance,
		installed: InstalledResource | null,
	): boolean => {
		if (!installed || !props.project) return false;
		if (props.version) {
			return isResourceUpdateAvailable(props.project, installed, props.version);
		}
		const best = findBestVersionForInstance(
			props.project,
			versionsToUse(),
			instance,
			"release",
			props.installType,
		);
		return best
			? isResourceUpdateAvailable(props.project, installed, best)
			: false;
	};

	const options = createMemo<InstanceSelectionOption[]>(() =>
		instancesState.instances.map((instance) => {
			const compatibility = getCompatibility(instance);
			const tracksInstalledResources =
				!!props.project && installType() !== "datapack";
			const lookupState = installedLookupState()[instance.id] ?? "loading";
			if (tracksInstalledResources && lookupState !== "ready") {
				return {
					instance,
					disabled: true,
					detail:
						lookupState === "error"
							? t("resources-instance-could-not-verify")
							: t("resources-instance-checking-installed-ellipsis"),
					badge: lookupState === "error" ? t("resources-instance-unavailable") : t("resources-instance-checking"),
					tone: lookupState === "error" ? "danger" : "neutral",
				};
			}
			const installed =
				props.project && installType() !== "datapack"
					? (findInstalledResource(
							props.project,
							installedMap()[instance.id] || [],
							versionsToUse(),
						) ?? null)
					: null;
			const updateAvailable = hasUpdate(instance, installed);

			if (compatibility.type === "incompatible") {
				return {
					instance,
					disabled: true,
					detail: compatibility.reason,
				badge: t("resources-version-incompatible"),
					tone: "danger",
				};
			}
			if (installed && !updateAvailable) {
				return {
					instance,
					disabled: true,
				detail: t("resources-instance-already-installed"),
				badge: t("resources-instance-installed"),
					tone: "accent",
				};
			}
			if (updateAvailable) {
				return {
					instance,
				detail: t("instances-details-resources-update-available"),
				badge: t("app-shell-update"),
					tone: "warning",
				};
			}
			return { instance };
		}),
	);

	return (
		<InstanceSelectionDialog
			isOpen={props.isOpen}
			description={t("resources-instance-choose-destination", {
				project: props.project?.name || t("resources-this-resource"),
			})}
			options={options()}
			onClose={props.onClose}
			onSelect={props.onSelect}
			footerAction={{
				label: t("resources-instance-create-new"),
				onSelect: props.onCreateNew,
			}}
		/>
	);
};

export default ResourceInstanceSelectionDialog;
