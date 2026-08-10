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
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
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

	createEffect(async () => {
		if (!props.isOpen || !props.project) return;
		const newMap: Record<number, InstalledResource[]> = {};
		await Promise.all(
			instancesState.instances.map(async (instance) => {
				try {
					newMap[instance.id] =
						instance.id === resources.state.selectedInstanceId
							? [...resources.state.installedResources]
							: await invoke<InstalledResource[]>("get_installed_resources", {
									instanceId: instance.id,
								});
				} catch (error) {
					console.error(
						`Failed to fetch installed resources for instance ${instance.id}`,
						error,
					);
					newMap[instance.id] = [];
				}
			}),
		);
		setInstalledMap(newMap);
	});

	createEffect(async () => {
		if (
			props.isOpen &&
			props.project &&
			(!props.versions || props.versions.length === 0)
		) {
			setIsLoadingVersions(true);
			try {
				setFetchedVersions(
					await resources.getVersions(props.project.source, props.project.id),
				);
			} catch (error) {
				console.error("Failed to fetch versions for compatibility check", error);
			} finally {
				setIsLoadingVersions(false);
			}
		} else if (!props.isOpen) {
			setFetchedVersions([]);
			setIsLoadingVersions(false);
		}
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
			return getCompatibilityForInstance(props.project, props.version, instance);
		}

		const projectCompatibility = getProjectCompatibilityForInstance(
			props.project,
			instance,
		);
		if (projectCompatibility.type !== "compatible") {
			return projectCompatibility;
		}

		if (versionsToUse().length > 0) {
			const best = findBestVersionForInstance(
				props.project,
				versionsToUse(),
				instance,
			);
			return best
				? { type: "compatible" as const }
				: {
						type: "incompatible" as const,
						reason: `No compatible version found for ${instance.minecraftVersion} / ${instance.modloader || "Vanilla"}`,
					};
		}

		if (isLoadingVersions()) {
			return {
				type: "incompatible" as const,
				reason: "Loading compatibility data...",
			};
		}

		if (
			props.project.resource_type === "mod" ||
			props.project.resource_type === "shader"
		) {
			return {
				type: "incompatible" as const,
				reason: "No compatible versions found.",
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
			return isResourceUpdateAvailable(
				props.project,
				installed,
				props.version,
			);
		}
		const best = findBestVersionForInstance(
			props.project,
			versionsToUse(),
			instance,
		);
		return best
			? isResourceUpdateAvailable(props.project, installed, best)
			: false;
	};

	const options = createMemo<InstanceSelectionOption[]>(() =>
		instancesState.instances.map((instance) => {
			const compatibility = getCompatibility(instance);
			const installed = props.project && props.installType !== "datapack"
				? findInstalledResource(
						props.project,
						installedMap()[instance.id] || [],
						props.versions,
					)
				: null;
			const updateAvailable = hasUpdate(instance, installed);

			if (compatibility.type === "incompatible") {
				return {
					instance,
					disabled: true,
					detail: compatibility.reason,
					badge: "Incompatible",
					tone: "danger",
				};
			}
			if (installed && !updateAvailable) {
				return {
					instance,
					disabled: true,
					detail: "Already installed",
					badge: "Installed",
					tone: "accent",
				};
			}
			if (updateAvailable) {
				return {
					instance,
					detail: "Update available",
					badge: "Update",
					tone: "warning",
				};
			}
			return { instance };
		}),
	);

	return (
		<InstanceSelectionDialog
			isOpen={props.isOpen}
			description={`Choose where to install ${props.project?.name || "this resource"}.`}
			options={options()}
			onClose={props.onClose}
			onSelect={props.onSelect}
			footerAction={{
				label: "Create New Instance",
				onSelect: props.onCreateNew,
			}}
		/>
	);
};

export default ResourceInstanceSelectionDialog;
