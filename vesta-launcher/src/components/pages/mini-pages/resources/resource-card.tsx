import DownloadIcon from "@assets/icons/actions/download.svg";
import HeartIcon from "@assets/icons/content/heart.svg";
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
	requiresWorldTarget,
} from "@utils/resource-install-intent";
import { getProjectCompatibilityForInstance } from "@utils/resources";
import {
	type Component,
	type JSX,
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import styles from "./resource-browser.module.css";

const TAG_GAP_PX = 4;

function countFittingTags(
	availableWidth: number,
	tagWidths: number[],
	moreWidth: number,
): number {
	if (tagWidths.length === 0 || availableWidth <= 0) return 0;

	let total = 0;
	for (let i = 0; i < tagWidths.length; i++) {
		total += tagWidths[i] + (i > 0 ? TAG_GAP_PX : 0);
	}
	if (total <= availableWidth) return tagWidths.length;

	let used = 0;
	let count = 0;
	for (let i = 0; i < tagWidths.length; i++) {
		const next = used + (count > 0 ? TAG_GAP_PX : 0) + tagWidths[i];
		const hiddenAfter = tagWidths.length - (i + 1);
		const reserve = hiddenAfter > 0 ? TAG_GAP_PX + moreWidth : 0;
		if (next + reserve <= availableWidth) {
			used = next;
			count++;
		} else {
			break;
		}
	}
	return count;
}

const CardTagOverflow: Component<{
	tags: string[];
	renderTag: (tag: string) => JSX.Element;
	rowClass: string;
	tagsClass: string;
}> = (props) => {
	const [visibleCount, setVisibleCount] = createSignal(props.tags.length);
	let rowRef: HTMLDivElement | undefined;
	let measureRef: HTMLDivElement | undefined;
	let moreMeasureRef: HTMLSpanElement | undefined;

	const recompute = () => {
		const row = rowRef;
		const measure = measureRef;
		if (!row || !measure) return;

		const tagEls = Array.from(
			measure.querySelectorAll<HTMLElement>("[data-tag-measure]"),
		);
		const widths = tagEls.map((el) => el.getBoundingClientRect().width);
		const moreWidth =
			moreMeasureRef?.getBoundingClientRect().width || 36;
		const available = row.clientWidth;
		setVisibleCount(countFittingTags(available, widths, moreWidth));
	};

	createEffect(() => {
		props.tags;
		queueMicrotask(recompute);
	});

	onMount(() => {
		const row = rowRef;
		if (!row || typeof ResizeObserver === "undefined") {
			recompute();
			return;
		}
		const observer = new ResizeObserver(() => recompute());
		observer.observe(row);
		recompute();
		onCleanup(() => observer.disconnect());
	});

	const hiddenTags = () => props.tags.slice(visibleCount());
	const hiddenCount = () => Math.max(0, props.tags.length - visibleCount());

	return (
		<div class={props.rowClass} ref={rowRef}>
			<div
				class={styles["card-tags-measure"]}
				ref={measureRef}
				aria-hidden="true"
			>
				<For each={props.tags}>
					{(tag) => <span data-tag-measure>{props.renderTag(tag)}</span>}
				</For>
				<span
					ref={moreMeasureRef}
					class={styles["resource-tag-more"]}
					data-tag-more-measure
				>
					+99
				</span>
			</div>
			<div class={props.tagsClass}>
				<For each={props.tags.slice(0, visibleCount())}>
					{(tag) => props.renderTag(tag)}
				</For>
			</div>
			<Show when={hiddenCount() > 0}>
				<Tooltip>
					<TooltipTrigger as="span" class={styles["resource-tag-more"]}>
						+{hiddenCount()}
					</TooltipTrigger>
					<TooltipContent onClick={(e: MouseEvent) => e.stopPropagation()}>
						<div class={styles["tooltip-tags"]}>
							<For each={hiddenTags()}>
								{(tag) => props.renderTag(tag)}
							</For>
						</div>
					</TooltipContent>
				</Tooltip>
			</Show>
		</div>
	);
};

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
	installSelectionActive?: boolean;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());
	const installType = () => resources.state.resourceType;
	const isInstalled = createMemo(() => {
		if (installType() === "datapack") return false;
		const instanceId = resources.state.selectedInstanceId;
		return !!findInstalledResource(
			props.project,
			resources.state.installedResources.filter(
				(resource) => !instanceId || resource.instance_id === instanceId,
			),
			resources.state.versions,
		);
	});

	const installedResource = createMemo(() => {
		if (installType() === "datapack") return undefined;
		const instanceId = resources.state.selectedInstanceId;
		return findInstalledResource(
			props.project,
			resources.state.installedResources.filter(
				(resource) => !instanceId || resource.instance_id === instanceId,
			),
			resources.state.versions,
		);
	});

	const isInstallingProject = createMemo(() => {
		return resources.state.installingProjectIds.includes(props.project.id);
	});

	const [localInstalling, setLocalInstalling] = createSignal(false);
	const [confirmUninstall, setConfirmUninstall] = createSignal(false);
	const [latestCompatibleVersion, setLatestCompatibleVersion] =
		createSignal<ResourceVersion | null>(null);
	const installing = () =>
		localInstalling() ||
		Boolean(props.installSelectionActive) ||
		(installType() !== "datapack" && isInstallingProject());

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
					const best = findBestVersionForInstance(
						project,
						versions,
						inst,
						"release",
						installType(),
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

		return getProjectCompatibilityForInstance(
			props.project,
			instance,
			installType(),
		);
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

	// Prefer the first gallery image for browse banners.
	const remoteBannerUrl = createMemo(() => {
		const p = props.project;
		return p.gallery.length > 0
			? p.gallery[0]
			: (p.featured_gallery ?? null);
	});

	const preferredBannerUrl = createMemo(() => {
		const remote = remoteBannerUrl();
		if (!remote) return null;
		const resolved = resources.resolvedBrowseImage(remote);
		if (resolved) return resolved;
		// Remaining Smithed API gallery redirects (e.g. bucket type) still need
		// resolve_image_urls warm; file-type banners use Firebase CDN directly.
		if (remote.includes("api.smithed.dev")) return null;
		return remote;
	});

	// Once a banner has painted for a remote URL, keep that exact src. Otherwise
	// resolve_image_urls upgrading CDN → data URL remounts <img> and flashes dots.
	const [paintedBanner, setPaintedBanner] = createSignal<{
		remote: string;
		src: string;
	} | null>(null);

	createEffect(() => {
		const remote = remoteBannerUrl();
		const painted = paintedBanner();
		if (painted && painted.remote !== remote) {
			setPaintedBanner(null);
		}
	});

	const bgImage = createMemo(() => {
		const remote = remoteBannerUrl();
		if (!remote) return null;
		const painted = paintedBanner();
		if (painted?.remote === remote) return painted.src;
		return preferredBannerUrl();
	});

	// Keep the dot-grid fallback visible until the banner finishes loading
	// (covers Modrinth/CurseForge CDN, Smithed Firebase, and warmed data URLs).
	const bannerReady = createMemo(() => {
		const remote = remoteBannerUrl();
		const painted = paintedBanner();
		return Boolean(remote && painted?.remote === remote);
	});

	const markBannerPainted = (src: string) => {
		const remote = remoteBannerUrl();
		if (!remote || bgImage() !== src) return;
		setPaintedBanner({ remote, src });
	};

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

	const formatLoaderLabel = (loader: string) => {
		const labels: Record<string, string> = {
			fabric: "Fabric",
			forge: "Forge",
			quilt: "Quilt",
			neoforge: "NeoForge",
		};
		const lower = loader.toLowerCase();
		return labels[lower] || loader.charAt(0).toUpperCase() + loader.slice(1);
	};

	const displayCategories = createMemo(() =>
		props.project.categories.filter(
			(c) => !resources.state.loader || !MODLOADER_IDS.has(c.toLowerCase()),
		),
	);

	const navigateToDetails = () => {
		resources.setInstallRequest(null);
		activeRouter()?.navigate(
			"/resource-details",
			{
				projectId: props.project.id,
				platform: props.project.source,
				name: props.project.name,
				iconUrl: props.project.icon_url,
				resourceType: installType(),
			},
			{
				project: props.project,
			},
		);
	};

	const handleQuickInstall = async (e: MouseEvent) => {
		e.stopPropagation();
		const requestedInstallType = installType();

		if (requestedInstallType === "modpack") {
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
				if (requiresWorldTarget(props.project, latest, requestedInstallType)) {
					resources.setInstallRequest({
						project: props.project,
						versions: [latest],
						version: latest,
						preferredInstanceId: instanceId,
						installType: requestedInstallType,
					});
					return;
				}

				setLocalInstalling(true);
				try {
					await resources.install(
						props.project,
						latest,
						{
							kind: "instance",
							instanceId,
						},
						{ installType: requestedInstallType },
					);
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
				resources.setInstallRequest({
					project: props.project,
					versions,
					installType: requestedInstallType,
				});
			} catch (err) {
				console.error("Failed to fetch versions for request install:", err);
				resources.setInstallRequest({
					project: props.project,
					versions: [],
					installType: requestedInstallType,
				});
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
			if (requestedInstallType === "datapack") {
				resources.setInstallRequest({
					project: props.project,
					versions,
					installType: "datapack",
					preferredInstanceId: instance.id,
				});
				return;
			}
			const best = findBestVersionForInstance(
				props.project,
				versions,
				instance,
				"release",
				requestedInstallType,
			);
			if (best) {
				if (
					requiresWorldTarget(props.project, best, requestedInstallType)
				) {
					resources.setInstallRequest({
						project: props.project,
						versions,
						version: best,
						preferredInstanceId: instance.id,
						installType: requestedInstallType,
					});
					return;
				}
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

				await resources.install(
					props.project,
					best,
					{
						kind: "instance",
						instanceId: instance.id,
					},
					{ installType: requestedInstallType },
				);
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
		const tagLower = String(tag).toLowerCase();
		const isModloaderTag = MODLOADER_IDS.has(tagLower);

		const categoryObj = () =>
			resources.state.availableCategories.length > 0
				? resources.state.availableCategories.find(
						(c) =>
							c.name.toLowerCase() === tagLower ||
							c.id.toLowerCase() === tagLower,
					)
				: null;

		const isActive = () => {
			if (isModloaderTag) {
				return resources.state.loader?.toLowerCase() === tagLower;
			}
			return resources.state.categories.some(
				(c) => c.toLowerCase() === (categoryObj()?.id || tag).toLowerCase(),
			);
		};

		return (
			<Badge
				variant="theme"
				clickable
				class={styles["resource-tag"]}
				active={isActive()}
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					if (isModloaderTag) {
						const next =
							resources.state.loader?.toLowerCase() === tagLower
								? null
								: tagLower;
						resources.setLoader(next);
						activeRouter()?.updateQuery("loader", next);
						return;
					}
					const filterId = categoryObj()?.id || tag;
					resources.toggleCategory(filterId);
					activeRouter()?.updateQuery(
						"categories",
						resources.state.categories,
					);
					activeRouter()?.updateQuery("loader", resources.state.loader);
				}}
			>
				{isModloaderTag ? formatLoaderLabel(tagLower) : categoryObj()?.name || tag}
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
				<div class={styles["card-image-banner"]}>
					<Show when={!bannerReady()}>
						<div
							class={styles["card-image-fallback"]}
							style={{ "--fallback-hue": String(iconHue()) }}
						/>
					</Show>
					<Show when={bgImage()}>
						{(imageUrl) => {
							const url = imageUrl();
							return (
								<img
									src={url}
									alt=""
									classList={{
										[styles["card-image-visible"]]: bannerReady(),
									}}
									ref={(el) => {
										// Cached images may already be complete before onLoad binds.
										if (el.complete && el.naturalWidth > 0) {
											markBannerPainted(url);
										}
									}}
									onLoad={() => markBannerPainted(url)}
									onError={() => {
										if (paintedBanner()?.src === url) {
											setPaintedBanner(null);
										}
									}}
								/>
							);
						}}
					</Show>
					<div class={styles["card-image-fade"]} />
				</div>
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
							<CardTagOverflow
								tags={displayCategories()}
								renderTag={Tag}
								rowClass={styles["card-tags-row"]}
								tagsClass={styles["card-tags"]}
							/>
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
						<CardTagOverflow
							tags={displayCategories()}
							renderTag={Tag}
							rowClass={styles["card-list-tags-row"]}
							tagsClass={styles["card-list-tags"]}
						/>
					</Show>
				</div>
			</Show>
		</div>
	);
};

export default ResourceCard;
