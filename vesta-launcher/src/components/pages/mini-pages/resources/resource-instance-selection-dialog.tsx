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
						`Failed to fetch installed resources for instance ${instance.id}`,
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
						"Failed to fetch versions for compatibility check",
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
			props.installType === "mod" ||
			props.installType === "shader"
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
							? "Could not verify installed resources"
							: "Checking installed resources…",
					badge: lookupState === "error" ? "Unavailable" : "Checking",
					tone: lookupState === "error" ? "danger" : "neutral",
				};
			}
			const installed = props.project && installType() !== "datapack"
				? findInstalledResource(
						props.project,
						installedMap()[instance.id] || [],
						versionsToUse(),
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
