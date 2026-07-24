import { type Instance, instancesState } from "@stores/instances";
import {
	type InstalledResource,
	type ResourceProject,
	type ResourceVersion,
	resources,
} from "@stores/resources";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { Dialog, DialogContent, DialogHeader } from "@ui/dialog/dialog";
import {
	createAnimatedIconPreview,
	iconBackgroundStyle,
} from "@utils/icon-animation";
import { DEFAULT_ICONS } from "@utils/instances";
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
	For,
	Show,
} from "solid-js";
import styles from "./instance-selection-dialog.module.css";

interface InstanceSelectionDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSelect: (instance: Instance) => void;
	onCreateNew: () => void;
	project?: ResourceProject;
	version?: ResourceVersion;
	versions?: ResourceVersion[];
}

const InstanceSelectionDialog: Component<InstanceSelectionDialogProps> = (
	props,
) => {
	const [installedMap, setInstalledMap] = createSignal<
		Record<number, InstalledResource[]>
	>({});
	const [fetchedVersions, setFetchedVersions] = createSignal<ResourceVersion[]>(
		[],
	);
	const [isLoadingVersions, setIsLoadingVersions] = createSignal(false);

	const sortedInstances = () =>
		[...instancesState.instances].sort((a, b) => {
			const timeA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
			const timeB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
			return timeB - timeA;
		});

	createEffect(async () => {
		if (props.isOpen && props.project) {
			const instances = sortedInstances();
			const newMap: Record<number, InstalledResource[]> = {};

			await Promise.all(
				instances.map(async (inst) => {
					try {
						// Check if it's the currently selected instance to avoid redundant fetch
						if (inst.id === resources.state.selectedInstanceId) {
							newMap[inst.id] = [...resources.state.installedResources];
						} else {
							const installed = await invoke<InstalledResource[]>(
								"get_installed_resources",
								{
									instanceId: inst.id,
								},
							);
							newMap[inst.id] = installed;
						}
					} catch (e) {
						console.error(
							`Failed to fetch installed for instance ${inst.id}`,
							e,
						);
						newMap[inst.id] = [];
					}
				}),
			);

			setInstalledMap(newMap);
		}
	});

	createEffect(async () => {
		if (
			props.isOpen &&
			props.project &&
			(!props.versions || props.versions.length === 0)
		) {
			setIsLoadingVersions(true);
			console.log(
				"[InstanceSelection] Fetching versions for compatibility...",
				props.project.id,
			);
			try {
				const vs = await resources.getVersions(
					props.project.source,
					props.project.id,
				);
				setFetchedVersions(vs);
			} catch (e) {
				console.error("Failed to fetch versions for compatibility check:", e);
			} finally {
				setIsLoadingVersions(false);
			}
		} else if (!props.isOpen) {
			setFetchedVersions([]);
			setIsLoadingVersions(false);
		}
	});

	const InstanceIcon = (iconProps: { instance: Instance }) => {
		const iconPath = () => iconProps.instance.iconPath || DEFAULT_ICONS[0];
		const iconPreview = createAnimatedIconPreview(iconPath);

		const displayChar = createMemo(() => {
			const name = iconProps.instance.name || "?";
			const match = name.match(/[a-zA-Z]/);
			return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
		});
		return (
			<Show
				when={iconPreview.displaySource()}
				fallback={
					<div class={styles["instance-select-icon-placeholder"]}>
						{displayChar()}
					</div>
				}
			>
				<div
					class={styles["instance-select-icon"]}
					style={iconBackgroundStyle(iconPreview.displaySource())}
					onMouseEnter={iconPreview.activate}
					onMouseLeave={iconPreview.deactivate}
					onFocusIn={iconPreview.activate}
					onFocusOut={iconPreview.deactivate}
				/>
			</Show>
		);
	};

	const getCompatibility = (instance: Instance) => {
		if (!props.project) return { type: "compatible" as const };

		if (props.version) {
			return getCompatibilityForInstance(
				props.project,
				props.version,
				instance,
			);
		}

		const resType = props.project.resource_type;
		const projectCompatibility = getProjectCompatibilityForInstance(
			props.project,
			instance,
		);
		if (projectCompatibility.type !== "compatible") {
			return projectCompatibility;
		}

		// 3. Version-based check (the "truth")
		const versionsToUse =
			props.versions && props.versions.length > 0
				? props.versions
				: fetchedVersions();
		if (versionsToUse.length > 0) {
			const best = findBestVersionForInstance(
				props.project,
				versionsToUse,
				instance,
			);

			if (best) return { type: "compatible" as const };

			return {
				type: "incompatible" as const,
				reason: `No compatible version found for ${instance.minecraftVersion} / ${instance.modloader || "Vanilla"}`,
			};
		}

		// 4. Loading state / Fallback
		if (isLoadingVersions()) {
			return {
				type: "incompatible" as const,
				reason: "Loading compatibility data...",
			};
		}

		// If we finished loading and versions list is STILL empty
		if (versionsToUse.length === 0) {
			if (resType === "mod" || resType === "shader") {
				return {
					type: "incompatible" as const,
					reason: "No compatible versions found.",
				};
			}
		}

		return { type: "compatible" as const };
	};

	return (
		<Dialog
			open={props.isOpen}
			onOpenChange={(open) => !open && props.onClose()}
		>
			<DialogContent class={styles["instance-selection-dialog"]}>
				<DialogHeader>
					<h2 class={styles["dialog-title"]}>Select Instance</h2>
					<p class={styles["dialog-description"]}>
						Choose where to install {props.project?.name || "this resource"}.
					</p>
				</DialogHeader>

				<div class={styles["instance-list-scroll"]}>
					<For each={sortedInstances()}>
						{(instance) => {
							const comp = createMemo(() => getCompatibility(instance));
							const isDisabled = createMemo(
								() => comp().type === "incompatible",
							);

							const installedResource = createMemo(() => {
								if (!props.project) return null;
								const installedList = installedMap()[instance.id] || [];
								return findInstalledResource(
									props.project,
									installedList,
									props.versions,
								);
							});

							const isAlreadyInstalled = createMemo(
								() => !!installedResource(),
							);

							const isUpdateAvailable = createMemo(() => {
								const ir = installedResource();
								const project = props.project;
								if (!ir || !project) return false;

								// If we have a specific version we're trying to install
								if (props.version) {
									return isResourceUpdateAvailable(project, ir, props.version);
								}

								// If no specific version, check if the best version for this instance is different
								const versionsToUse =
									props.versions && props.versions.length > 0
										? props.versions
										: fetchedVersions();
								if (versionsToUse.length > 0) {
									const best = findBestVersionForInstance(
										project,
										versionsToUse,
										instance,
									);
									if (best) {
										return isResourceUpdateAvailable(project, ir, best);
									}
								}

								return false;
							});

							const canSelect = createMemo(() => {
								if (isDisabled()) return false;
								if (!isAlreadyInstalled()) return true;
								return isUpdateAvailable(); // Allow selecting if an update is available
							});

							return (
								<button
									class={styles["instance-select-item"]}
									classList={{
										[styles.disabled]: !canSelect(),
										[styles.installed]:
											isAlreadyInstalled() && !isUpdateAvailable(),
										[styles.update]: isUpdateAvailable(),
									}}
									onClick={() => canSelect() && props.onSelect(instance)}
									title={
										isUpdateAvailable()
											? "Update available for this instance"
											: isAlreadyInstalled()
												? "Already installed in this instance"
												: isDisabled()
													? comp().reason
													: ""
									}
								>
									<div class={styles["instance-item-left"]}>
										<InstanceIcon instance={instance} />
										<div class={styles["instance-item-info"]}>
											<span class={styles["instance-item-name"]}>
												{instance.name}
											</span>
											<span class={styles["instance-item-meta"]}>
												{instance.minecraftVersion} •{" "}
												{instance.modloader || "Vanilla"}
											</span>
											<Show when={isDisabled()}>
												<span class={styles["incompatible-reason"]}>
													{comp().reason}
												</span>
											</Show>
											<Show when={isAlreadyInstalled() && !isUpdateAvailable()}>
												<span class={styles["installed-status"]}>
													Already installed
												</span>
											</Show>
											<Show when={isUpdateAvailable()}>
												<span class={styles["update-status"]}>
													Update Available
												</span>
											</Show>
										</div>
									</div>
									<Show when={isDisabled()}>
										<span class={styles["incompatible-badge"]}>
											Incompatible
										</span>
									</Show>
									<Show when={isAlreadyInstalled() && !isUpdateAvailable()}>
										<span class={styles["installed-badge"]}>Installed</span>
									</Show>
									<Show when={isUpdateAvailable()}>
										<span class={styles["update-badge"]}>Update</span>
									</Show>
								</button>
							);
						}}
					</For>
				</div>

				<div class={styles["dialog-footer"]}>
					<Button
						variant="outline"
						onClick={props.onCreateNew}
						style={{ width: "100%" }}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<line x1="12" y1="5" x2="12" y2="19"></line>
							<line x1="5" y1="12" x2="19" y2="12"></line>
						</svg>
						Create New Instance
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default InstanceSelectionDialog;
