import HeartIcon from "@assets/heart.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { instancesState } from "@stores/instances";
import {
	findBestVersion,
	type ResourceProject,
	type ResourceVersion,
	resources,
} from "@stores/resources";
import { Badge } from "@ui/badge";
import Button from "@ui/button/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import { showToast } from "@ui/toast/toast";
import { type Component, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import styles from "./resource-browser.module.css";

const ResourceCard: Component<{
	project: ResourceProject;
	viewMode: "grid" | "list";
	router?: MiniRouter;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());
	const isInstalled = createMemo(() => {
		const instanceId = resources.state.selectedInstanceId;
		const mainId = props.project.id.toLowerCase();
		const extIds = props.project.external_ids || {};
		const projectName = props.project.name.toLowerCase();
		const resType = props.project.resource_type;

		return resources.state.installedResources.some((ir) => {
			if (instanceId && ir.instance_id !== instanceId) return false;

			const irRemoteId = ir.remote_id.toLowerCase();
			if (irRemoteId === mainId) return true;

			if (ir.hash && props.project.source !== ir.platform) {
				const versions = resources.state.versions.filter(
					(v) => v.project_id === props.project.id,
				);
				if (versions.some((v) => v.hash === ir.hash)) return true;
			}

			for (const id of Object.values(extIds)) {
				if (irRemoteId === id.toLowerCase()) return true;
			}

			return (
				ir.resource_type === resType &&
				ir.display_name.toLowerCase() === projectName
			);
		});
	});

	const installedResource = createMemo(() => {
		const instanceId = resources.state.selectedInstanceId;
		const mainId = props.project.id.toLowerCase();
		const extIds = props.project.external_ids || {};
		const projectName = props.project.name.toLowerCase();
		const resType = props.project.resource_type;

		return resources.state.installedResources.find((ir) => {
			if (instanceId && ir.instance_id !== instanceId) return false;

			const irRemoteId = ir.remote_id.toLowerCase();
			if (irRemoteId === mainId) return true;
			for (const id of Object.values(extIds)) {
				if (irRemoteId === id.toLowerCase()) return true;
			}
			return (
				ir.resource_type === resType &&
				ir.display_name.toLowerCase() === projectName
			);
		});
	});

	const isInstallingProject = createMemo(() => {
		return resources.state.installingProjectIds.includes(props.project.id);
	});

	const [localInstalling, setLocalInstalling] = createSignal(false);
	const [confirmUninstall, setConfirmUninstall] = createSignal(false);
	const [latestCompatibleVersion, setLatestCompatibleVersion] =
		createSignal<ResourceVersion | null>(null);
	const installing = () => localInstalling() || isInstallingProject();

	const isUpdateAvailable = createMemo(() => {
		const installed = installedResource();
		const latest = latestCompatibleVersion();
		if (!installed || !latest) return false;

		if (installed.hash && latest.hash && installed.hash === latest.hash)
			return false;

		if (
			installed.platform.toLowerCase() === props.project.source.toLowerCase()
		) {
			return installed.remote_version_id !== latest.id;
		}
		return installed.current_version !== latest.version_number;
	});

	createEffect(async () => {
		const instanceId = resources.state.selectedInstanceId;
		const project = props.project;
		if (isInstalled() && instanceId && project) {
			const inst = instancesState.instances.find((i) => i.id === instanceId);
			if (inst) {
				try {
					const versions = await resources.getVersions(
						project.source,
						project.id,
					);
					const best = findBestVersion(
						versions,
						inst.minecraftVersion,
						inst.modloader,
						"release",
						project.resource_type,
					);
					setLatestCompatibleVersion(best);
				} catch (_) {
					// Silently fail
				}
			}
		} else {
			setLatestCompatibleVersion(null);
		}
	});

	const compatibility = createMemo(() => {
		const instanceId = resources.state.selectedInstanceId;
		if (!instanceId) return { type: "compatible" as const };

		const instance = instancesState.instances.find((i) => i.id === instanceId);
		if (!instance) return { type: "compatible" as const };

		const instLoader = instance.modloader?.toLowerCase() || "";
		const resType = props.project.resource_type;

		if (instLoader === "" || instLoader === "vanilla") {
			if (resType === "mod" || resType === "shader") {
				return {
					type: "incompatible" as const,
					reason: `Vanilla instances do not support ${resType}s.`,
				};
			}
			return { type: "compatible" as const };
		}

		if (
			resType === "shader" ||
			resType === "resourcepack" ||
			resType === "datapack"
		)
			return { type: "compatible" as const };

		const categories = props.project.categories.map((c) => c.toLowerCase());
		const hasFabric = categories.includes("fabric");
		const hasForge = categories.includes("forge");
		const hasQuilt = categories.includes("quilt");
		const hasNeoForge = categories.includes("neoforge");

		if (!hasFabric && !hasForge && !hasQuilt && !hasNeoForge)
			return { type: "compatible" as const };

		if (instLoader === "fabric") {
			if (hasFabric) return { type: "compatible" as const };
			return {
				type: "incompatible" as const,
				reason: "This mod is not compatible with Fabric.",
			};
		}

		if (instLoader === "forge") {
			if (hasForge) return { type: "compatible" as const };
			return {
				type: "incompatible" as const,
				reason: "This mod is not compatible with Forge.",
			};
		}

		if (instLoader === "quilt") {
			if (hasQuilt || hasFabric) {
				if (!hasQuilt && hasFabric) {
					return {
						type: "warning" as const,
						reason: "Fabric mod on Quilt instance.",
					};
				}
				return { type: "compatible" as const };
			}
			return {
				type: "incompatible" as const,
				reason: "This mod is not compatible with Quilt.",
			};
		}

		if (instLoader === "neoforge") {
			if (hasNeoForge || hasForge) {
				if (!hasNeoForge && hasForge) {
					return {
						type: "warning" as const,
						reason: "Forge mod on NeoForge instance.",
					};
				}
				return { type: "compatible" as const };
			}
			return {
				type: "incompatible" as const,
				reason: "This mod is not compatible with NeoForge.",
			};
		}

		return { type: "compatible" as const };
	});

	const buttonVariant = createMemo(() => {
		if (isInstalled() && !isUpdateAvailable()) return "outline" as const;
		return "solid" as const;
	});

	const buttonColor = createMemo(() => {
		if (isUpdateAvailable()) return "secondary" as const;
		if (isInstalled()) return "destructive" as const;
		if (compatibility().type === "warning") return "warning" as const;
		return "secondary" as const;
	});

	const buttonText = createMemo(() => {
		if (installing()) return "Installing...";
		if (isUpdateAvailable()) return "Update";
		if (isInstalled()) return confirmUninstall() ? "Confirm?" : "Uninstall";
		if (compatibility().type === "incompatible") return "Unsupported";
		return "Install";
	});

	const bgImage = createMemo(() => {
		const p = props.project;
		if (p.featured_gallery) return p.featured_gallery;
		if (p.gallery.length > 0) return p.gallery[0];
		return null;
	});

	const iconHue = createMemo(() => {
		const url = props.project.icon_url;
		if (!url) return 220;
		let hash = 0;
		for (let i = 0; i < url.length; i++) {
			hash = url.charCodeAt(i) + ((hash << 5) - hash);
		}
		return Math.abs(hash) % 360;
	});

	const MODLOADER_IDS = new Set(["fabric", "forge", "quilt", "neoforge"]);

	const displayCategories = createMemo(() =>
		props.project.categories.filter(
			(c) => !MODLOADER_IDS.has(c.toLowerCase()),
		),
	);

	const tagLimit = () => props.viewMode === "grid" ? 2 : 3;
	const [effectiveLimit, setEffectiveLimit] = createSignal(tagLimit());
	let tagsRef: HTMLDivElement | undefined;

	createEffect(() => {
		props.viewMode;
		const el = tagsRef;
		if (!el) return;

		queueMicrotask(() => {
			const limit = tagLimit();
			let count = limit;
			while (count > 1 && el.scrollWidth > el.clientWidth) {
				count--;
			}
			setEffectiveLimit(count);
		});
	});

	const navigateToDetails = () => {
		resources.setRequestInstall(null);
		activeRouter()?.navigate(
			"/resource-details",
			{
				projectId: props.project.id,
				platform: props.project.source,
				name: props.project.name,
				iconUrl: props.project.icon_url,
			},
			{
				project: props.project,
			},
		);
	};

	const handleQuickInstall = async (e: MouseEvent) => {
		e.stopPropagation();

		if (props.project.resource_type === "modpack") {
			activeRouter()?.navigate("/install", {
				projectId: props.project.id,
				platform: props.project.source,
				isModpack: true,
				resourceType: "modpack",
				projectName: props.project.name,
				projectIcon: props.project.icon_url || undefined,
				projectAuthor: props.project.author,
				initialMinecraftVersion: resources.state.gameVersion || undefined,
				initialModloader: resources.state.loader || undefined,
			});
			return;
		}

		if (isInstalled()) {
			const latest = latestCompatibleVersion();
			if (isUpdateAvailable() && latest) {
				const instanceId = resources.state.selectedInstanceId;
				if (!instanceId) return;

				setLocalInstalling(true);
				try {
					await resources.install(props.project, latest);
					showToast({
						title: "Update Started",
						description: `Check the notifications in the sidebar for progress on ${props.project.name}.`,
						severity: "success",
					});
				} catch (err) {
					showToast({
						title: "Failed to update",
						description: err instanceof Error ? err.message : String(err),
						severity: "error",
					});
				} finally {
					setLocalInstalling(false);
				}
				return;
			}

			if (!confirmUninstall()) {
				setConfirmUninstall(true);
				setTimeout(() => setConfirmUninstall(false), 3000);
				return;
			}

			const res = installedResource();
			if (res) {
				try {
					await resources.uninstall(res.instance_id, res.id);
					setConfirmUninstall(false);
					showToast({
						title: "Resource removed",
						description: `${props.project.name} has been uninstalled.`,
						severity: "success",
					});
				} catch (_) {}
			}
			return;
		}

		const instanceId = resources.state.selectedInstanceId;
		if (!instanceId) {
			setLocalInstalling(true);
			try {
				const versions = await resources.getVersions(
					props.project.source,
					props.project.id,
				);
				resources.setRequestInstall(props.project, versions);
			} catch (err) {
				console.error("Failed to fetch versions for request install:", err);
				resources.setRequestInstall(props.project);
			} finally {
				setLocalInstalling(false);
			}
			return;
		}

		const instance = instancesState.instances.find((i) => i.id === instanceId);
		if (!instance) return;

		setLocalInstalling(true);
		try {
			const versions = await resources.getVersions(
				props.project.source,
				props.project.id,
			);
			const best = findBestVersion(
				versions,
				instance.minecraftVersion,
				instance.modloader,
				"release",
				props.project.resource_type,
			);
			if (best) {
				const instLoader = instance.modloader?.toLowerCase() || "";
				const hasDirectLoader = best.loaders.some(
					(l) => l.toLowerCase() === instLoader,
				);

				if (
					instLoader === "quilt" &&
					!hasDirectLoader &&
					best.loaders.some((l) => l.toLowerCase() === "fabric")
				) {
					showToast({
						title: "Potential Incompatibility",
						description: `Installing Fabric version of ${props.project.name} on a Quilt instance.`,
						severity: "warning",
					});
				}

				await resources.install(props.project, best);
				showToast({
					title: "Installation Started",
					description: `Check the notifications in the sidebar for progress on ${props.project.name}.`,
					severity: "success",
				});
			} else {
				showToast({
					title: "No compatible version",
					description: `Could not find a version for ${instance.minecraftVersion} with ${instance.modloader || "no loader"}.`,
					severity: "error",
				});
			}
		} catch (err) {
			showToast({
				title: "Failed to install",
				description: err instanceof Error ? err.message : String(err),
				severity: "error",
			});
		} finally {
			setLocalInstalling(false);
		}
	};

	const Tag = (tag: string) => {
		const tagLower = tag.toLowerCase();

		const categoryObj = () =>
			resources.state.availableCategories.length > 0
				? resources.state.availableCategories.find(
						(c) =>
							c.name.toLowerCase() === tagLower ||
							c.id.toLowerCase() === tagLower,
					)
				: null;

		const isActive = () =>
			resources.state.availableCategories.length > 0
				? resources.state.categories.includes(
						(categoryObj()?.id || tag).toLowerCase(),
					)
				: false;

		return (
			<Badge
				variant="theme"
				round
				class={styles["resource-tag"]}
				active={isActive()}
				onClick={(e) => {
					e.stopPropagation();
					const filterId = categoryObj()?.id || tag;
					resources.toggleCategory(filterId.toLowerCase());
					resources.setOffset(0);
				}}
			>
				{categoryObj()?.name || tag}
			</Badge>
		);
	};

	return (
		<div
			class={`${styles["resource-card"]} ${styles["theme-card"]} ${styles[props.viewMode]}`}
			onClick={navigateToDetails}
			classList={{ [styles.installed]: isInstalled() }}
		>
			<Show when={props.viewMode === "grid"}>
				<Show when={bgImage()}>
					<div class={styles["card-image-banner"]}>
						<img src={bgImage()!} alt="" />
						<div class={styles["card-image-fade"]} />
					</div>
				</Show>
				<Show when={!bgImage()}>
					<div
						class={styles["card-image-fallback"]}
						style={{ "--fallback-hue": String(iconHue()) }}
					/>
				</Show>
				<div class={styles["card-content"]}>
					<div class={styles["card-row-1"]}>
						<div class={styles["card-icon"]}>
							<Show
								when={props.project.icon_url}
								fallback={
									<div class={styles["icon-placeholder"]}>
										{(() => {
											const name = props.project.name || "?";
											const match = name.match(/[a-zA-Z]/);
											return match
												? match[0].toUpperCase()
												: name.charAt(0).toUpperCase();
										})()}
									</div>
								}
							>
								<img src={props.project.icon_url ?? ""} alt={props.project.name} />
							</Show>
						</div>
						<div class={styles["card-title-area"]}>
							<h3 class={styles["card-title"]}>{props.project.name}</h3>
							<span class={styles["card-author"]}>by {props.project.author}</span>
							<div class={styles["card-stats"]}>
								<span class={styles["card-stats-item"]}>
									{props.project.download_count.toLocaleString()} downloads
								</span>
								<Show
									when={
										props.project.source === "modrinth" &&
										(props.project.follower_count || 0) > 0
									}
								>
									<span class={styles["card-stats-item"]}>
										<HeartIcon />
										{(props.project.follower_count || 0).toLocaleString()}
									</span>
								</Show>
							</div>
						</div>
					</div>
					<Show when={props.project.summary}>
						<p class={styles["card-description"]}>{props.project.summary}</p>
					</Show>
					<div class={styles["card-row-3"]}>
						<Show
							when={
								displayCategories().length > 0
							}
						>
							<div class={styles["card-tags-row"]}>
								<div class={styles["card-tags"]} ref={tagsRef}>
									<For
										each={displayCategories().slice(
											0,
										Math.min(effectiveLimit(), displayCategories().length),
									)}
								>
									{Tag}
								</For>
							</div>
							<Show
								when={
									displayCategories().length > effectiveLimit()
								}
							>
								<Tooltip>
									<TooltipTrigger
										as="span"
										class={styles["resource-tag-more"]}
									>
										+{displayCategories().length - effectiveLimit()}
									</TooltipTrigger>
									<TooltipContent onClick={(e: MouseEvent) => e.stopPropagation()}>
										<div class={styles["tooltip-tags"]}>
											<For each={displayCategories().slice(effectiveLimit())}>
													{Tag}
												</For>
											</div>
										</TooltipContent>
									</Tooltip>
								</Show>
							</div>
						</Show>
						<div class={styles["resource-card-actions"]}>
							<Button
								onClick={handleQuickInstall}
								disabled={
									installing() ||
									(compatibility().type === "incompatible" && !isInstalled())
								}
								size="sm"
								variant={buttonVariant()}
								color={buttonColor()}
								tooltip_text={compatibility().reason}
							>
								{buttonText()}
							</Button>
						</div>
					</div>
				</div>
			</Show>
			<Show when={props.viewMode === "list"}>
				<div class={styles["card-list-thumb"]}>
					<Show
						when={props.project.icon_url}
						fallback={
							<div class={styles["icon-placeholder"]}>
								{(() => {
									const name = props.project.name || "?";
									const match = name.match(/[a-zA-Z]/);
									return match
										? match[0].toUpperCase()
										: name.charAt(0).toUpperCase();
								})()}
							</div>
						}
					>
						<img src={props.project.icon_url ?? ""} alt={props.project.name} />
					</Show>
				</div>
				<div class={styles["card-list-body"]}>
					<div class={styles["card-list-header"]}>
						<div class={styles["card-list-header-left"]}>
							<span class={styles["card-list-name"]}>{props.project.name}</span>
							<span class={styles["card-list-meta"]}>
								<span>by {props.project.author}</span>
								<span>·</span>
								<span>{props.project.download_count.toLocaleString()} dl</span>
								<Show
									when={
										props.project.source === "modrinth" &&
										(props.project.follower_count || 0) > 0
									}
								>
									<HeartIcon />
									<span>{(props.project.follower_count || 0).toLocaleString()}</span>
								</Show>
							</span>
						</div>
						<div class={styles["card-list-actions"]}>
							<Button
								onClick={handleQuickInstall}
								disabled={
									installing() ||
									(compatibility().type === "incompatible" && !isInstalled())
								}
								size="sm"
								variant={buttonVariant()}
								color={buttonColor()}
								tooltip_text={compatibility().reason}
							>
								{buttonText()}
							</Button>
						</div>
					</div>
					<Show when={props.project.summary}>
						<p class={styles["card-list-desc"]}>{props.project.summary}</p>
					</Show>
					<Show
						when={
							displayCategories().length > 0
						}
					>
						<div class={styles["card-list-tags-row"]}>
							<div class={styles["card-list-tags"]}>
								<For
									each={displayCategories().slice(
										0,
										Math.min(effectiveLimit(), displayCategories().length),
									)}
								>
									{Tag}
								</For>
							</div>
							<Show when={displayCategories().length > effectiveLimit()}>
								<Tooltip>
									<TooltipTrigger
										as="span"
										class={styles["resource-tag-more"]}
									>
										+{displayCategories().length - effectiveLimit()}
									</TooltipTrigger>
									<TooltipContent onClick={(e: MouseEvent) => e.stopPropagation()}>
										<div class={styles["tooltip-tags"]}>
											<For each={displayCategories().slice(effectiveLimit())}>
												{Tag}
											</For>
										</div>
									</TooltipContent>
								</Tooltip>
							</Show>
						</div>
					</Show>
				</div>
			</Show>
		</div>
	);
};

export default ResourceCard;