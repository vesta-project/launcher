import {
	Component,
	For,
	Show,
	createSignal,
	createEffect,
	createMemo,
} from "solid-js";
import { Dialog, DialogContent, DialogHeader } from "@ui/dialog/dialog";
import { instancesState, type Instance } from "@stores/instances";
import {
	ResourceProject,
	ResourceVersion,
	findBestVersion,
	resources,
} from "@stores/resources";
import { DEFAULT_ICONS } from "@utils/instances";
import { getCompatibilityForInstance } from "@utils/resources";
import Button from "@ui/button/button";
import { invoke } from "@tauri-apps/api/core";
import "./instance-selection-dialog.css";

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
		Record<
			number,
			{
				id: string;
				name: string;
				type: string;
				versionId: string;
				hash: string | null;
			}[]
		>
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
			const newMap: Record<
				number,
				{
					id: string;
					name: string;
					type: string;
					versionId: string;
					hash: string | null;
				}[]
			> = {};

			await Promise.all(
				instances.map(async (inst) => {
					try {
						// Check if it's the currently selected instance to avoid redundant fetch
						if (inst.id === resources.state.selectedInstanceId) {
							newMap[inst.id] = resources.state.installedResources.map((r) => ({
								id: r.remote_id.toLowerCase(),
								name: r.display_name.toLowerCase(),
								type: r.resource_type.toLowerCase(),
								versionId: r.remote_version_id,
								hash: r.hash ?? null,
							}));
						} else {
							const installed = await invoke<any[]>("get_installed_resources", {
								instanceId: inst.id,
							});
							newMap[inst.id] = installed.map((r) => ({
								id: r.remote_id.toLowerCase(),
								name: r.display_name.toLowerCase(),
								type: r.resource_type.toLowerCase(),
								versionId: r.remote_version_id,
								hash: r.hash ?? null,
							}));
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

	const InstanceIcon = (iconProps: { iconPath?: string | null }) => {
		const path = iconProps.iconPath || DEFAULT_ICONS[0];
		const style = path.startsWith("linear-gradient")
			? { background: path }
			: {
					"background-image": `url('${path}')`,
					"background-size": "cover",
					"background-position": "center",
				};
		return <div class="instance-select-icon" style={style} />;
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

		const instLoader = instance.modloader?.toLowerCase() || "";
		const resType = props.project.resource_type;

		// 1. Immediate rejection for Vanilla
		if (instLoader === "" || instLoader === "vanilla") {
			if (resType === "mod" || resType === "shader") {
				return {
					type: "incompatible" as const,
					reason: `Vanilla instances do not support ${resType}s.`,
				};
			}
		}

		// 2. Category-based check (fast path & added safety)
		if (resType === "mod") {
			const categories = props.project.categories.map((c) => c.toLowerCase());
			const hasFabric = categories.includes("fabric");
			const hasForge = categories.includes("forge");
			const hasQuilt = categories.includes("quilt");
			const hasNeoForge = categories.includes("neoforge");

			// If it specifies loaders in categories, check against instance
			if (hasFabric || hasForge || hasQuilt || hasNeoForge) {
				if (instLoader === "fabric" && !hasFabric)
					return {
						type: "incompatible",
						reason: "This mod is not compatible with Fabric.",
					};
				if (instLoader === "forge" && !hasForge)
					return {
						type: "incompatible",
						reason: "This mod is not compatible with Forge.",
					};
				if (instLoader === "neoforge" && !hasNeoForge)
					return {
						type: "incompatible",
						reason: "This mod is not compatible with NeoForge.",
					};
				if (instLoader === "quilt" && !hasQuilt && !hasFabric)
					return {
						type: "incompatible",
						reason: "This mod is not compatible with Quilt.",
					};
			}
		}

		// 3. Version-based check (the "truth")
		const versionsToUse =
			props.versions && props.versions.length > 0
				? props.versions
				: fetchedVersions();
		if (versionsToUse.length > 0) {
			const best = findBestVersion(
				versionsToUse,
				instance.minecraftVersion,
				instance.modloader,
				"release",
				props.project.resource_type,
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
			<DialogContent class="instance-selection-dialog">
				<DialogHeader>
					<h2>Select Instance</h2>
					<p>
						Choose where to install {props.project?.name || "this resource"}.
					</p>
				</DialogHeader>

				<div class="instance-list-scroll">
					<For each={sortedInstances()}>
						{(instance) => {
							const comp = createMemo(() => getCompatibility(instance));
							const isDisabled = createMemo(
								() => comp().type === "incompatible",
							);

							const installedResource = createMemo(() => {
								if (!props.project) return null;
								const p = props.project;
								const mainId = p.id.toLowerCase();
								const extIds = p.external_ids || {};
								const projectName = p.name.toLowerCase();
								const resType = p.resource_type;

								const installedList = installedMap()[instance.id] || [];
								return installedList.find((ir) => {
									if (ir.id === mainId) return true;
									for (const id of Object.values(extIds)) {
										if (ir.id === id.toLowerCase()) return true;
									}
									return ir.type === resType && ir.name === projectName;
								});
							});

							const isAlreadyInstalled = createMemo(
								() => !!installedResource(),
							);

							const isUpdateAvailable = createMemo(() => {
								const ir = installedResource();
								if (!ir) return false;

								// If we have a specific version we're trying to install
								if (props.version) {
									if (ir.versionId === props.version.id) return false;
									if (
										ir.hash &&
										props.version.hash &&
										ir.hash === props.version.hash
									)
										return false;
									return true;
								}

								// If no specific version, check if the best version for this instance is different
								const versionsToUse =
									props.versions && props.versions.length > 0
										? props.versions
										: fetchedVersions();
								if (versionsToUse.length > 0) {
									const best = findBestVersion(
										versionsToUse,
										instance.minecraftVersion,
										instance.modloader,
										"release",
										props.project?.resource_type,
									);
									if (best) {
										if (ir.versionId === best.id) return false;
										if (ir.hash && best.hash && ir.hash === best.hash)
											return false;
										return true;
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
									class="instance-select-item"
									classList={{
										disabled: !canSelect(),
										installed: isAlreadyInstalled() && !isUpdateAvailable(),
										update: isUpdateAvailable(),
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
									<div class="instance-item-left">
										<InstanceIcon iconPath={instance.iconPath} />
										<div class="instance-item-info">
											<span class="instance-item-name">{instance.name}</span>
											<span class="instance-item-meta">
												{instance.minecraftVersion} •{" "}
												{instance.modloader || "Vanilla"}
											</span>
											<Show when={isDisabled()}>
												<span class="incompatible-reason">{comp().reason}</span>
											</Show>
											<Show when={isAlreadyInstalled() && !isUpdateAvailable()}>
												<span class="installed-status">Already installed</span>
											</Show>
											<Show when={isUpdateAvailable()}>
												<span class="update-status">Update Available</span>
											</Show>
										</div>
									</div>
									<Show when={isDisabled()}>
										<span class="incompatible-badge">Incompatible</span>
									</Show>
									<Show when={isAlreadyInstalled() && !isUpdateAvailable()}>
										<span class="installed-badge">Installed</span>
									</Show>
									<Show when={isUpdateAvailable()}>
										<span class="update-badge">Update</span>
									</Show>
								</button>
							);
						}}
					</For>
				</div>

				<div class="dialog-footer">
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
