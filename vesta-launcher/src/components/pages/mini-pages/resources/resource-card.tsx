import DownloadIcon from "@assets/download-compact.svg";
import HeartIcon from "@assets/heart.svg";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { instancesState } from "@stores/instances";
import {
	type ResourceProject,
	type ResourceVersion,
	resources,
} from "@stores/resources";
import { Badge } from "@ui/badge";
import Button from "@ui/button/button";
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { buildBrowseModpackInfo } from "@utils/modpack-prefill";
import {
	findBestVersionForInstance,
	findInstalledResource,
	isResourceUpdateAvailable,
} from "@utils/resource-install-intent";
import { getProjectCompatibilityForInstance } from "@utils/resources";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";
import styles from "./resource-browser.module.css";

const ProjectIcon = (props: { iconUrl?: string | null; name: string }) => {
	const displayChar = () => {
		const match = props.name.match(/[a-zA-Z]/);
		return match ? match[0].toUpperCase() : props.name.charAt(0).toUpperCase();
	};

	return (
		<Show
			when={props.iconUrl}
			fallback={<div class={styles["icon-placeholder"]}>{displayChar()}</div>}
		>
			<img src={props.iconUrl ?? ""} alt={props.name} />
		</Show>
	);
};

const ResourceCard: Component<{
	project: ResourceProject;
	viewMode: "grid" | "list";
	router?: MiniRouter;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());
	const isInstalled = createMemo(() => {
		const instanceId = resources.state.selectedInstanceId;
		return !!findInstalledResource(
			props.project,
			resources.state.installedResources.filter(
				(resource) => !instanceId || resource.instance_id === instanceId,
			),
		);
	});

	const installedResource = createMemo(() => {
		const instanceId = resources.state.selectedInstanceId;
		return findInstalledResource(
			props.project,
			resources.state.installedResources.filter(
				(resource) => !instanceId || resource.instance_id === instanceId,
			),
		);
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
		return isResourceUpdateAvailable(
			props.project,
			installedResource(),
			latestCompatibleVersion(),
		);
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
					const best = findBestVersionForInstance(project, versions, inst);
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

		return getProjectCompatibilityForInstance(props.project, instance);
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
			(c) => !resources.state.loader || !MODLOADER_IDS.has(c.toLowerCase()),
		),
	);

	const tagLimit = () => (props.viewMode === "grid" ? 2 : 3);
	const [effectiveLimit, setEffectiveLimit] = createSignal(tagLimit());
	let tagsRef: HTMLDivElement | undefined;

	createEffect(() => {
		const el = tagsRef;
		if (!el) return;

		// Track viewMode dependency synchronously
		tagLimit();

		queueMicrotask(() => {
			const currentEl = tagsRef;
			if (!currentEl) return;

			const children = Array.from(currentEl.children) as HTMLElement[];
			const limit = tagLimit();
			let count = Math.min(limit, children.length);

			if (currentEl.scrollWidth <= currentEl.clientWidth) {
				setEffectiveLimit(count);
				return;
			}

			// Measure cumulatively: find the max count that fits
			while (count > 1) {
				let w = 0;
				for (let i = 0; i < count; i++) {
					if (i > 0) w += 4;
					w += children[i].getBoundingClientRect().width;
				}
				if (w <= currentEl.clientWidth) break;
				count--;
			}

			setEffectiveLimit(Math.max(1, count));
		});
	});

	const navigateToDetails = () => {
		resources.setInstallRequest(null);
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
			const prefilledModpackInfo = buildBrowseModpackInfo(props.project, null, {
				minecraftVersion: resources.state.gameVersion,
				loader: resources.state.loader,
			});
			activeRouter()?.navigate(
				"/install",
				{
					projectId: props.project.id,
					platform: props.project.source,
					isModpack: true,
					resourceType: "modpack",
					projectName: props.project.name,
					projectIcon: props.project.icon_url || undefined,
					projectAuthor: props.project.author,
					initialMinecraftVersion: resources.state.gameVersion || undefined,
					initialModloader: resources.state.loader || undefined,
				},
				{ prefilledModpackInfo },
			);
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
				} catch (err) {
					console.warn("Failed to uninstall resource", err);
				}
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
				resources.setInstallRequest({ project: props.project, versions });
			} catch (err) {
				console.error("Failed to fetch versions for request install:", err);
				resources.setInstallRequest({ project: props.project, versions: [] });
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
			const best = findBestVersionForInstance(
				props.project,
				versions,
				instance,
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
					{(imageUrl) => (
						<div class={styles["card-image-banner"]}>
							<img src={imageUrl()} alt="" />
							<div class={styles["card-image-fade"]} />
						</div>
					)}
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
							<ProjectIcon
								iconUrl={props.project.icon_url}
								name={props.project.name}
							/>
						</div>
						<div class={styles["card-title-area"]}>
							<h3 class={styles["card-title"]}>{props.project.name}</h3>
							<span class={styles["card-author"]}>
								by {props.project.author}
							</span>
							<div class={styles["card-stats"]}>
								<span class={styles["card-stats-item"]}>
									{props.project.download_count.toLocaleString()}
									<DownloadIcon />
								</span>
								<Show
									when={
										props.project.source === "modrinth" &&
										(props.project.follower_count || 0) > 0
									}
								>
									<span class={styles["card-stats-item"]}>
										{(props.project.follower_count || 0).toLocaleString()}
										<HeartIcon />
									</span>
								</Show>
							</div>
						</div>
					</div>
					<Show when={props.project.summary}>
						<p class={styles["card-description"]}>{props.project.summary}</p>
					</Show>
					<div class={styles["card-row-3"]}>
						<Show when={displayCategories().length > 0}>
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
								<Show when={displayCategories().length > effectiveLimit()}>
									<Tooltip>
										<TooltipTrigger
											as="span"
											class={styles["resource-tag-more"]}
										>
											+{displayCategories().length - effectiveLimit()}
										</TooltipTrigger>
										<TooltipContent
											onClick={(e: MouseEvent) => e.stopPropagation()}
										>
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
					<ProjectIcon
						iconUrl={props.project.icon_url}
						name={props.project.name}
					/>
				</div>
				<div class={styles["card-list-body"]}>
					<div class={styles["card-list-header"]}>
						<div class={styles["card-list-header-left"]}>
							<span class={styles["card-list-name"]}>{props.project.name}</span>
							<span class={styles["card-list-meta"]}>
								<span>by {props.project.author}</span>
								<span>·</span>
								<span>
									{props.project.download_count.toLocaleString()}{" "}
									<DownloadIcon />
								</span>
								<Show
									when={
										props.project.source === "modrinth" &&
										(props.project.follower_count || 0) > 0
									}
								>
									<span>
										{(props.project.follower_count || 0).toLocaleString()}
									</span>
									<HeartIcon />
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
					<Show when={displayCategories().length > 0}>
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
									<TooltipTrigger as="span" class={styles["resource-tag-more"]}>
										+{displayCategories().length - effectiveLimit()}
									</TooltipTrigger>
									<TooltipContent
										onClick={(e: MouseEvent) => e.stopPropagation()}
									>
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
