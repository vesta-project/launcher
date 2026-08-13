import BellIcon from "@assets/icons/status/bell.svg";
import DownloadIcon from "@assets/icons/actions/download.svg";
import ExternalLinkIcon from "@assets/icons/actions/external-link.svg";
import HeartIcon from "@assets/icons/content/heart.svg";
import InfoIcon from "@assets/icons/status/info.svg";
import { FetchingOverlay } from "@components/fetching-overlay/fetching-overlay";
import { InlineLoadingRow } from "@components/fetching-overlay/inline-loading-row";
import { createCollapsingHeaderController } from "@components/page-composition/collapsing-header";
import { COLLAPSING_HEADER_DESKTOP_BREAKPOINT_PX } from "@components/page-composition/collapsing-header-progress";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { WorldSelectionDialog } from "@components/worlds/WorldSelectionDialog";
import {
	getSourceDescriptor,
	RESOURCE_SOURCES,
} from "@resources/source-catalog";
import { instancesState } from "@stores/instances";
import {
	type ResourceDependency,
	type ResourceProject,
	type ResourceType,
	type ResourceVersion,
	type ResourceVersionDetails,
	resources,
	type SourcePlatform,
} from "@stores/resources";
import { reducedMotion } from "@stores/settings";
import type { WorldSummary } from "@stores/worlds";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@ui/badge";
import Button from "@ui/button/button";
import { ImageViewer } from "@ui/image-viewer/image-viewer";
import {
	Pagination,
	PaginationEllipsis,
	PaginationItem,
	PaginationItems,
	PaginationNext,
	PaginationPrevious,
} from "@ui/pagination/pagination";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ui/tabs/tabs";
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { resolveResourceUrl } from "@utils/assets";
import { formatDate } from "@utils/date";
import { confirmDatapackWorldCompatibility } from "@utils/datapack-compatibility-confirm";
import { openExternal } from "@utils/external-link";
import {
	createAnimatedIconPreview,
	iconBackgroundStyle,
} from "@utils/icon-animation";
import { DEFAULT_ICONS, type Instance } from "@utils/instances";
import { buildBrowseModpackInfo } from "@utils/modpack-prefill";
import { projectTypeLabel } from "@utils/resource-artifacts";
import {
	findBestExactDatapackVersion,
	findBestVersionForInstance,
	hasDownloadableArtifact,
	replacementResourceIdForWorld,
	requiresWorldTarget,
} from "@utils/resource-install-intent";
import { decodeCurseForgeLinkout, parseResourceUrl } from "@utils/resource-url";
import {
	type CompatibilityResult,
	getCompatibilityForInstance,
} from "@utils/resources";
import { marked } from "marked";
import {
	type Component,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
	Show,
	untrack,
} from "solid-js";
import styles from "./resource-details.module.css";
import {
	ResourceDescriptionLoading,
	ResourceDetailsSidebarLoading,
	ResourceVersionsLoading,
} from "./resource-details-loading";
import { getResourceDetailsLoadingState } from "./resource-details-loading-state";
import ResourceInstanceSelectionDialog from "./resource-instance-selection-dialog";
import {
	VersionActionIcon,
	type VersionActionKind,
	VersionFocusMain,
	VersionFocusMainLoading,
	VersionFocusSidebar,
	VersionFocusSidebarLoading,
	VersionSummaryRow,
} from "./resource-version-focus";
import {
	currentPeerProject,
	focusedResourceVersion,
	minecraftGameVersions,
	resourceProjectKey,
	versionsSupportedByInstance,
} from "./resource-version-view";
import { VersionFilterBar } from "./version-filter-bar/version-filter-bar";

/// Frontend cache for ResourceProject data to avoid re-fetching from the backend API
/// on repeated navigations within the same session.
interface ProjectCacheEntry {
	project: ResourceProject;
	timestamp: number;
}
const projectCache = new Map<string, ProjectCacheEntry>();
const PROJECT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const getProjectCacheKey = (platform: SourcePlatform, id: string) =>
	`${platform}:${id}`;

function getProjectFromCache(
	platform: SourcePlatform,
	id: string,
): ResourceProject | null {
	const key = getProjectCacheKey(platform, id);
	const entry = projectCache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > PROJECT_CACHE_TTL_MS) {
		projectCache.delete(key);
		return null;
	}
	return entry.project;
}

function setProjectCache(platform: SourcePlatform, project: ResourceProject) {
	const key = getProjectCacheKey(platform, project.id);
	projectCache.set(key, { project, timestamp: Date.now() });
}

function invalidateProjectCache(platform: SourcePlatform, id: string) {
	projectCache.delete(getProjectCacheKey(platform, id));
}

// Configure marked for GFM
marked.setOptions({
	gfm: true,
	breaks: false,
});

const HeaderCategoryTags: Component<{
	project: ResourceProject;
	resourceType: ResourceType;
	onBrowseType: () => void;
	router?: MiniRouter;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());

	const tags = createMemo(() => {
		const p = props.project;
		const items: {
			key: string;
			label: string;
			onClick: (e: MouseEvent) => void;
		}[] = [
			{
				key: "__type__",
				label: projectTypeLabel(
					p,
					resources.state.versions.filter((v) => v.project_id === p.id),
				),
				onClick: (e) => {
					e.stopPropagation();
					props.onBrowseType();
				},
			},
		];

		for (const cat of p.categories) {
			const categoryObj =
				resources.state.availableCategories.length > 0
					? resources.state.availableCategories.find(
							(c) =>
								c.name.toLowerCase() === cat.toLowerCase() ||
								c.id.toLowerCase() === cat.toLowerCase(),
						)
					: null;
			const filterId = categoryObj?.id || cat;
			items.push({
				key: filterId,
				label: categoryObj?.name || cat,
				onClick: (e) => {
					e.stopPropagation();
					resources.setType(props.resourceType);
					resources.setSource(p.source);
					resources.setQuery("");
					resources.setCategories([filterId]);
					resources.setOffset(0);
					activeRouter()?.navigate("/resources");
				},
			});
		}

		return items;
	});

	const [effectiveLimit, setEffectiveLimit] = createSignal(999);
	let tagsRef: HTMLDivElement | undefined;
	let rowRef: HTMLDivElement | undefined;

	const measureTags = () => {
		const allTags = tags();
		if (allTags.length === 0) {
			setEffectiveLimit(0);
			return;
		}

		setEffectiveLimit(allTags.length);

		queueMicrotask(() => {
			const el = tagsRef;
			const row = rowRef;
			const currentTags = tags();
			if (!el || !row || currentTags.length === 0) return;

			const children = Array.from(el.children) as HTMLElement[];
			let count = Math.min(currentTags.length, children.length);

			if (el.scrollWidth <= el.clientWidth && count === currentTags.length) {
				setEffectiveLimit(count);
				return;
			}

			const moreReserve = currentTags.length > 1 ? 36 : 0;
			const available = row.clientWidth - moreReserve;

			while (count > 1) {
				let width = 0;
				for (let i = 0; i < count; i++) {
					if (i > 0) width += 4;
					width += children[i]?.getBoundingClientRect().width ?? 0;
				}
				if (width <= available) break;
				count--;
			}

			setEffectiveLimit(Math.max(1, count));
		});
	};

	createEffect(() => {
		tags();
		measureTags();
	});

	createEffect(() => {
		const row = rowRef;
		if (!row || typeof ResizeObserver === "undefined") return;

		const ro = new ResizeObserver(() => measureTags());
		ro.observe(row);
		onCleanup(() => ro.disconnect());
	});

	return (
		<Show when={tags().length > 0}>
			<div class={styles["tag-row"]} ref={rowRef}>
				<div class={styles["tag-list"]} ref={tagsRef}>
					<For
						each={tags().slice(0, Math.min(effectiveLimit(), tags().length))}
					>
						{(tag) => (
							<Badge variant="theme" round clickable onClick={tag.onClick}>
								<span
									classList={{ [styles.capitalize]: tag.key === "__type__" }}
								>
									{tag.label}
								</span>
							</Badge>
						)}
					</For>
				</div>
				<Show when={tags().length > effectiveLimit()}>
					<Tooltip>
						<TooltipTrigger as="span" class={styles["tag-more"]}>
							+{tags().length - effectiveLimit()}
						</TooltipTrigger>
						<TooltipContent onClick={(e: MouseEvent) => e.stopPropagation()}>
							<div class={styles["tag-tooltip"]}>
								<For each={tags().slice(effectiveLimit())}>
									{(tag) => (
										<Badge
											variant="theme"
											round
											clickable
											onClick={tag.onClick}
										>
											<span
												classList={{
													[styles.capitalize]: tag.key === "__type__",
												}}
											>
												{tag.label}
											</span>
										</Badge>
									)}
								</For>
							</div>
						</TooltipContent>
					</Tooltip>
				</Show>
			</div>
		</Show>
	);
};

const ResourceDetailsPage: Component<{
	project?: ResourceProject;
	projectId?: string;
	platform?: SourcePlatform;
	name?: string;
	iconUrl?: string;
	resourceType?: ResourceType;
	setRefetch?: (fn: () => Promise<void>) => void;
	router?: MiniRouter;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());
	const [project, setProject] = createSignal<ResourceProject | undefined>(
		props.project,
	);
	const explicitInstallType = createMemo<ResourceType | undefined>(() => {
		const routed = activeRouter()?.currentParams.get().resourceType;
		return (
			props.resourceType ||
			(typeof routed === "string" ? (routed as ResourceType) : undefined)
		);
	});
	const installType = createMemo<ResourceType>(
		() => explicitInstallType() ?? project()?.resource_type ?? "mod",
	);
	const replacementResourceId = createMemo<number | undefined>(() => {
		const value = activeRouter()?.currentParams.get().replacementResourceId;
		if (typeof value !== "string" && typeof value !== "number")
			return undefined;
		const parsed = Number(value);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
	});
	const replacementWorldInstanceId = createMemo<number | undefined>(() => {
		const value =
			activeRouter()?.currentParams.get().replacementWorldInstanceId;
		if (typeof value !== "string" && typeof value !== "number")
			return undefined;
		const parsed = Number(value);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
	});
	const replacementWorldDirectory = createMemo<string | undefined>(() => {
		const value = activeRouter()?.currentParams.get().replacementWorldDirectory;
		return typeof value === "string" && value.length > 0 ? value : undefined;
	});
	const managedDatapackReplacement = createMemo(() => {
		const resourceId = replacementResourceId();
		const instanceId = replacementWorldInstanceId();
		const directoryName = replacementWorldDirectory();
		return resourceId && instanceId && directoryName
			? { resourceId, world: { instanceId, directoryName } }
			: null;
	});
	const projectIconPreview = createAnimatedIconPreview(
		() => project()?.icon_url || props.iconUrl,
	);
	const [loading, setLoading] = createSignal(
		!props.project && Boolean(props.projectId && props.platform),
	);
	const [projectLoadSettled, setProjectLoadSettled] = createSignal(
		Boolean(props.project?.description),
	);
	const [error, setError] = createSignal<string | null>(null);
	let projectRequestSequence = 0;
	let routedProjectKey: string | null = null;

	const loadingState = createMemo(() =>
		getResourceDetailsLoadingState({
			hasProject: !!project(),
			hasRouteIdentity: Boolean(props.projectId),
			loading: loading(),
			hasError: !!error(),
		}),
	);
	const showPage = () => loadingState().showPage;
	const showError = () => loadingState().showError;
	const showNotFound = () => loadingState().showNotFound;
	const showOverlay = () => loadingState().showOverlay;
	const shellName = createMemo(
		() => project()?.name || props.name || "Resource",
	);
	const shellIcon = createMemo(
		() => projectIconPreview.displaySource() || props.iconUrl || null,
	);
	const projectContentReady = createMemo(
		() => !!project() && projectLoadSettled(),
	);
	const overlayTitle = createMemo(() => {
		if (showError()) return "Unable to load project";
		if (showNotFound()) return "Project not found";
		return "Fetching project details...";
	});
	const overlayMessage = createMemo(() => {
		if (showError() || showNotFound()) return undefined;
		return props.name || project()?.name;
	});

	// Derived from router query params for persistence and history
	const activeTab = createMemo(() => {
		const params = activeRouter()?.currentParams.get();
		const tab = params?.activeTab;
		if (tab === "versions" || tab === "gallery") return tab;
		if (tab === "dependencies") return "versions";
		return "description";
	});
	const rawActiveTab = createMemo(
		() => activeRouter()?.currentParams.get().activeTab,
	);
	const focusedVersionId = createMemo(() => {
		if (activeTab() !== "versions") return null;
		const value = activeRouter()?.currentParams.get().versionId;
		return typeof value === "string" && value.length > 0 ? value : null;
	});

	const transitionRouteState = (
		patch: Record<string, unknown>,
		push = true,
	) => {
		const currentRouter = activeRouter();
		if (!currentRouter) return;
		const nextParams = { ...currentRouter.currentParams.get() };
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined || value === null) delete nextParams[key];
			else nextParams[key] = value;
		}
		if (push) {
			currentRouter.navigate(
				currentRouter.currentPath.get(),
				nextParams,
				currentRouter.getSnapshot(),
			);
		} else {
			currentRouter.currentParams.set(nextParams);
		}
	};

	const selectTab = (tab: "description" | "versions" | "gallery") => {
		if (tab === activeTab() && !focusedVersionId()) return;
		transitionRouteState({ activeTab: tab, versionId: null }, true);
	};

	const [versionFilter, setVersionFilter] = createSignal("");
	const [versionReleaseTypes, setVersionReleaseTypes] = createSignal(
		new Set<string>(),
	);
	const [versionLoaders, setVersionLoaders] = createSignal(new Set<string>());
	const [gameVersionChips, setGameVersionChips] = createSignal<string[]>([]);
	const [selectedGalleryItem, setSelectedGalleryItem] = createSignal<
		string | null
	>(null);
	const [versionPage, setVersionPage] = createSignal(1);
	const versionsPerPage = 15;
	const [manualVersionId, setManualVersionId] = createSignal<string | null>(
		null,
	);
	const [optimisticFocusedVersion, setOptimisticFocusedVersion] =
		createSignal<ResourceVersion | null>(null);
	const [hoveredLink, setHoveredLink] = createSignal<string | null>(null);
	const [isDesktopHeaderAnimation, setIsDesktopHeaderAnimation] =
		createSignal(true);
	const [headerStackEl, setHeaderStackEl] = createSignal<
		HTMLElement | undefined
	>();

	const headerCollapse = createCollapsingHeaderController({
		isDesktop: isDesktopHeaderAnimation,
		prefersReducedMotion: reducedMotion,
		classNames: {
			compact: styles.compact,
			floating: styles["is-floating"],
		},
	});

	// Register refetch so the navbar reload button works
	onMount(() => {
		const handleRefetch = async () => {
			setError(null);

			const p = project();
			const platform = p?.source || props.platform;
			const id = p?.id || props.projectId;

			if (platform && id) {
				invalidateProjectCache(platform, id);
				await fetchFullProject(platform, id, { skipCache: true });
			}
		};

		props.setRefetch?.(handleRefetch);
		const mountedRouter = activeRouter();
		mountedRouter?.setRefetch(handleRefetch, "/resource-details");
		onCleanup(() => mountedRouter?.clearRefetch(handleRefetch));
	});

	// --- Dynamic Title Support ---
	createEffect(() => {
		const name = project()?.name;
		if (name) {
			activeRouter()?.customName.set(name);
		}
	});

	onCleanup(() => {
		activeRouter()?.customName.set(null);
	});

	const bestVersionForCurrent = createMemo(() => {
		const instId = resources.state.selectedInstanceId;
		const inst = instancesState.instances.find((i) => i.id === instId);
		if (!inst || !resources.state.versions.length) return null;

		const currentProject = project();
		return currentProject
			? findBestVersionForInstance(
					currentProject,
					resources.state.versions,
					inst,
					"release",
					installType(),
				)
			: null;
	});

	const primaryVersion = createMemo(() => {
		const manualId = manualVersionId();
		if (manualId) {
			return resources.state.versions.find((v) => v.id === manualId) || null;
		}
		const best = bestVersionForCurrent();
		if (best) return best;
		return resources.state.versions[0] || null;
	});

	const [versionDetailsRefresh, setVersionDetailsRefresh] = createSignal(0);
	const [versionDetails] = createResource<
		ResourceVersionDetails,
		{
			platform: SourcePlatform;
			projectId: string;
			versionId: string;
			refresh: number;
		}
	>(
		() => {
			const currentProject = project();
			const versionId = focusedVersionId();
			if (!currentProject || !versionId) return undefined;
			return {
				platform: currentProject.source,
				projectId: currentProject.id,
				versionId,
				refresh: versionDetailsRefresh(),
			};
		},
		async (key) =>
			resources.getVersionDetails(
				key.platform,
				key.projectId,
				key.versionId,
				key.refresh > 0,
			),
	);

	const focusedVersion = createMemo(() => {
		const versionId = focusedVersionId();
		if (!versionId) return null;
		return focusedResourceVersion(
			versionId,
			versionDetails.latest?.version,
			optimisticFocusedVersion(),
			resources.state.versions,
		);
	});

	const versionDetailPrefetches = new Map<string, Promise<void>>();
	const prefetchVersionDetails = (version: ResourceVersion) => {
		const currentProject = project();
		if (!currentProject || versionDetailPrefetches.has(version.id)) return;
		const request = resources
			.getVersionDetails(currentProject.source, currentProject.id, version.id)
			.then(() => undefined)
			.catch(() => undefined)
			.finally(() => versionDetailPrefetches.delete(version.id));
		versionDetailPrefetches.set(version.id, request);
	};

	const selectVersion = (version: ResourceVersion) => {
		setOptimisticFocusedVersion(version);
		prefetchVersionDetails(version);
		transitionRouteState(
			{ activeTab: "versions", versionId: version.id },
			true,
		);
	};

	createEffect(() => {
		if (!focusedVersionId()) setOptimisticFocusedVersion(null);
	});

	const showAllVersions = () => {
		const currentRouter = activeRouter();
		if (!currentRouter) return;
		const previous = currentRouter.history.past.at(-1);
		const currentProjectId = currentRouter.currentParams.get().projectId;
		if (
			previous?.path === currentRouter.currentPath.get() &&
			previous.params.projectId === currentProjectId &&
			previous.params.activeTab === "versions" &&
			!previous.params.versionId
		) {
			currentRouter.backwards();
			return;
		}
		transitionRouteState({ activeTab: "versions", versionId: null }, false);
	};

	createEffect(() => {
		if (rawActiveTab() !== "dependencies") return;
		const version = primaryVersion();
		transitionRouteState(
			{ activeTab: "versions", versionId: version?.id || null },
			false,
		);
	});

	const [subscriptions, { refetch: refetchSubscriptions }] = createResource<
		any[]
	>(() => invoke("get_notification_subscriptions"));

	const isFollowing = createMemo(() => {
		const subs = subscriptions.latest;
		const p = project();
		if (!subs || !p) return false;
		return subs.some(
			(s) =>
				s.provider_type === "resource" && s.target_id === p.id && s.enabled,
		);
	});

	const handleFollowToggle = async () => {
		const p = project();
		if (!p) return;

		if (isFollowing()) {
			const sub = subscriptions.latest?.find((s) => {
				return s.provider_type === "resource" && s.target_id === p.id;
			});
			if (sub) {
				await invoke("toggle_notification_subscription", {
					id: sub.id,
					enabled: false,
				});
			}
		} else {
			await invoke("subscribe_to_resource_updates", {
				projectId: p.id,
				platform: p.source,
				title: p.name,
			});
		}
		refetchSubscriptions();
	};

	const handleBrowseByType = () => {
		const p = project();
		if (!p) return;

		resources.setType(installType());
		resources.setSource(p.source);
		resources.setQuery("");
		activeRouter()?.navigate("/resources");
	};

	const [peerProjectLookup] = createResource(
		project,
		async (p: ResourceProject) => {
			const ownerKey = resourceProjectKey(p);
			try {
				const peer = await invoke<ResourceProject | null>(
					"find_peer_resource",
					{
						project: p,
					},
				);
				return { ownerKey, peer };
			} catch (e) {
				console.error("Failed to find peer project:", e);
				return { ownerKey, peer: null };
			}
		},
	);

	const peerProject = createMemo(() =>
		currentPeerProject(project(), peerProjectLookup.latest),
	);

	const platformSwitcherSources = createMemo(() => {
		const current = project()?.source;
		if (!current) return [];
		const ids = new Set<SourcePlatform>([current]);
		for (const peer of getSourceDescriptor(current)?.peerPlatforms ?? []) {
			ids.add(peer);
		}
		const peer = peerProject();
		if (peer) ids.add(peer.source);
		return RESOURCE_SOURCES.filter((source) => ids.has(source.id));
	});

	const canSwitchToPlatform = (target: SourcePlatform) => {
		const current = project()?.source;
		if (current === target) return true;
		const peer = peerProject();
		return !!peer && peer.source === target;
	};

	const navigateToPlatform = (target: SourcePlatform) => {
		if (project()?.source === target) return;
		const peer = peerProject();
		if (peer && peer.source === target) {
			activeRouter()?.navigate("/resource-details", {
				projectId: peer.id,
				platform: target,
				name: peer.name,
				iconUrl: peer.icon_url,
			});
		}
	};

	const renderPlatformSwitcher = () => (
		<div class={styles["source-toggle"]}>
			<For each={platformSwitcherSources()}>
				{(source) => (
					<button
						type="button"
						class={styles["source-btn"]}
						classList={{ [styles.active]: project()?.source === source.id }}
						disabled={!canSwitchToPlatform(source.id)}
						title={
							canSwitchToPlatform(source.id)
								? source.label
								: `Not available on ${source.label}`
						}
						onClick={() => navigateToPlatform(source.id)}
					>
						<source.Icon width="14" height="14" />
						<span>{source.label}</span>
					</button>
				)}
			</For>
		</div>
	);

	const [dependencyData] = createResource(
		() => ({
			platform: project()?.source,
			deps: focusedVersion()?.dependencies || [],
		}),
		async ({
			platform,
			deps,
		}: {
			platform: SourcePlatform | undefined;
			deps: ResourceDependency[];
		}) => {
			if (!platform || deps.length === 0)
				return new Map<string, ResourceProject>();
			const ids = deps.map((d: ResourceDependency) => d.project_id);
			try {
				const projects = await resources.getProjects(platform, ids);
				return new Map(projects.map((p) => [p.id, p]));
			} catch (e) {
				console.error("Failed to batch fetch dependencies:", e);
				return new Map<string, ResourceProject>();
			}
		},
	);

	const InstanceIcon = (iconProps: { instance?: any }) => {
		const iconPath = () => iconProps.instance?.iconPath || DEFAULT_ICONS[0];
		const iconPreview = createAnimatedIconPreview(iconPath);

		const displayChar = createMemo(() => {
			const name = iconProps.instance?.name || "?";
			const match = name.match(/[a-zA-Z]/);
			return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
		});
		return (
			<Show when={iconProps.instance && iconProps.instance.id !== null}>
				<Show
					when={iconPreview.displaySource()}
					fallback={
						<div class={styles["instance-item-icon-placeholder"]}>
							{displayChar()}
						</div>
					}
				>
					<div
						class={styles["instance-item-icon"]}
						style={iconBackgroundStyle(iconPreview.displaySource())}
						onMouseEnter={iconPreview.activate}
						onMouseLeave={iconPreview.deactivate}
						onFocusIn={iconPreview.activate}
						onFocusOut={iconPreview.deactivate}
					/>
				</Show>
			</Show>
		);
	};

	const isVersionInstalled = (versionId: string, hash?: string) => {
		if (installType() === "datapack") return false;
		return resources.state.installedResources.some(
			(ir) => ir.remote_version_id === versionId || (hash && ir.hash === hash),
		);
	};

	const isVersionInstalling = (versionId: string) => {
		if (installType() === "datapack") return false;
		return resources.state.installingVersionIds.includes(versionId);
	};

	const isModpack = () => installType() === "modpack";

	const isProjectInstalled = createMemo(() => {
		if (installType() === "datapack") return false;
		const p = project();
		if (!p) return false;

		const mainId = p.id.toLowerCase();
		const peerId = peerProject()?.id.toLowerCase();
		const extIds = p.external_ids || {};
		const projectName = p.name.toLowerCase();
		const resType = installType();

		return resources.state.installedResources.some((ir) => {
			const irRemoteId = ir.remote_id.toLowerCase();

			// 1. IDs (direct or peer)
			if (irRemoteId === mainId || (peerId && irRemoteId === peerId))
				return true;

			// 2. External IDs
			for (const id of Object.values(extIds)) {
				if (irRemoteId === id.toLowerCase()) return true;
			}

			// 3. Hash match
			if (ir.hash && resources.state.versions.some((v) => v.hash === ir.hash))
				return true;

			// 4. Name + Type match
			return (
				ir.resource_type === resType &&
				ir.display_name.toLowerCase() === projectName
			);
		});
	});

	const installedResource = createMemo(() => {
		if (installType() === "datapack") return null;
		const p = project();
		if (!p) return null;

		const mainId = p.id.toLowerCase();
		const peerId = peerProject()?.id.toLowerCase();
		const extIds = p.external_ids || {};
		const projectName = p.name.toLowerCase();
		const resType = installType();

		return resources.state.installedResources.find((ir) => {
			const irRemoteId = ir.remote_id.toLowerCase();
			if (irRemoteId === mainId || (peerId && irRemoteId === peerId))
				return true;

			for (const id of Object.values(extIds)) {
				if (irRemoteId === id.toLowerCase()) return true;
			}

			if (ir.hash && resources.state.versions.some((v) => v.hash === ir.hash))
				return true;

			return (
				ir.resource_type === resType &&
				ir.display_name.toLowerCase() === projectName
			);
		});
	});

	const isProjectInstalling = createMemo(() => {
		const p = project();
		if (!p) return false;
		if (installType() === "datapack") return false;
		return resources.state.installingProjectIds.includes(p.id);
	});

	const handleUninstall = async () => {
		const res = installedResource();
		if (res) {
			try {
				await resources.uninstall(res.instance_id, res.id);
				showToast({
					title: "Resource removed",
					description: `${project()?.name} has been uninstalled.`,
					severity: "success",
				});
			} catch (e) {
				console.error("Failed to uninstall:", e);
				showToast({
					title: "Uninstall failed",
					description: String(e),
					severity: "error",
				});
			}
		}
	};

	onMount(() => {
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && selectedGalleryItem()) {
				// Prevent PageViewer from closing when the gallery is open
				e.stopImmediatePropagation();
				e.preventDefault();
				setSelectedGalleryItem(null);
			}
		};

		document.addEventListener("keydown", handleGlobalKeyDown, {
			capture: true,
		});
		onCleanup(() =>
			document.removeEventListener("keydown", handleGlobalKeyDown, {
				capture: true,
			}),
		);
	});

	// Reset state when navigating to a different project
	createEffect(
		on(
			() => [props.projectId, props.platform] as const,
			([id, platform], previous) => {
				const [previousId, previousPlatform] = previous || [];
				if (id && (id !== previousId || platform !== previousPlatform)) {
					// Only clear the tab if it's currently set, to avoid unnecessary router updates
					const currentTab = untrack(
						() => activeRouter()?.currentParams.get().activeTab,
					);
					if (currentTab) {
						activeRouter()?.removeQuery("activeTab");
					}
					activeRouter()?.removeQuery("versionId");
					setVersionFilter("");
					setVersionReleaseTypes(new Set<string>());
					setVersionLoaders(new Set<string>());
					setGameVersionChips([]);
					setVersionPage(1);
					setVersionDetailsRefresh(0);
					setSelectedGalleryItem(null);
				}
			},
		),
	);

	const selectedInstance = createMemo(() => {
		const instId = resources.state.selectedInstanceId;
		if (!instId) return null;
		return instancesState.instances.find((i) => i.id === instId) || null;
	});

	const formatLoaderName = (loader?: string | null) => {
		const normalized = (loader || "vanilla").toLowerCase();
		const labels: Record<string, string> = {
			vanilla: "Vanilla",
			fabric: "Fabric",
			forge: "Forge",
			quilt: "Quilt",
			neoforge: "NeoForge",
		};
		return (
			labels[normalized] ||
			`${normalized[0]?.toUpperCase() || ""}${normalized.slice(1)}`
		);
	};

	const compatibilityFilteredVersions = createMemo(() => {
		return versionsSupportedByInstance(
			project(),
			resources.state.versions,
			selectedInstance(),
			installType(),
		);
	});
	const projectTypeVersions = createMemo(() =>
		versionsSupportedByInstance(
			project(),
			resources.state.versions,
			null,
			installType(),
		),
	);

	const uniqueGameVersions = createMemo(() => {
		const seen = new Set<string>();
		for (const v of projectTypeVersions()) {
			for (const gv of minecraftGameVersions(v.game_versions)) {
				seen.add(gv);
			}
		}
		return Array.from(seen).sort((a, b) => {
			const pa = a.split(".").map(Number);
			const pb = b.split(".").map(Number);
			for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
				const va = pa[i] || 0;
				const vb = pb[i] || 0;
				if (va !== vb) return vb - va;
			}
			return 0;
		});
	});

	const uniqueLoaders = createMemo(() => {
		const seen = new Set<string>();
		for (const v of projectTypeVersions()) {
			for (const l of v.loaders) {
				const lower = l.toLowerCase();
				if (lower && lower !== "vanilla") {
					seen.add(l);
				}
			}
		}
		return Array.from(seen).sort();
	});

	const filteredVersions = createMemo(() => {
		const query = versionFilter().trim().toLowerCase();
		let list = compatibilityFilteredVersions();

		const releaseTypes = versionReleaseTypes();
		if (releaseTypes.size > 0) {
			list = list.filter((v) => releaseTypes.has(v.release_type));
		}

		const loaders = versionLoaders();
		if (loaders.size > 0) {
			list = list.filter((v) =>
				v.loaders.some((l) => loaders.has(l.toLowerCase())),
			);
		}

		const chips = gameVersionChips();
		if (chips.length > 0) {
			list = list.filter((v) =>
				chips.some((chip) => {
					if (chip.startsWith("range:")) {
						const rangeStr = chip.slice("range:".length);
						const parts = rangeStr.split("...");
						if (parts.length !== 2) return false;
						const start = parts[0];
						const end = parts[1];
						return v.game_versions.some((gv) => {
							try {
								const pa = gv.split(".").map(Number);
								const ps = start.split(".").map(Number);
								const pe = end.split(".").map(Number);
								for (
									let i = 0;
									i < Math.max(pa.length, ps.length, pe.length);
									i++
								) {
									const va = pa[i] || 0;
									const vs = ps[i] || 0;
									const ve = pe[i] || 0;
									if (va < vs) return false;
									if (va > ve) return true;
								}
								return true;
							} catch {
								return false;
							}
						});
					}
					if (chip.startsWith("mc:")) {
						const gv = chip.slice("mc:".length);
						return v.game_versions.some((v2) => v2 === gv);
					}
					return v.game_versions.some((v2) => v2 === chip);
				}),
			);
		}

		if (query) {
			list = list.filter(
				(v) =>
					v.version_number.toLowerCase().includes(query) ||
					v.file_name.toLowerCase().includes(query) ||
					v.release_type.toLowerCase().includes(query) ||
					v.game_versions.some((gv) => gv.toLowerCase().includes(query)) ||
					v.loaders.some((l) => l.toLowerCase().includes(query)),
			);
		}
		return list;
	});

	const versionEmptyState = createMemo(() => {
		const query = versionFilter().trim();
		const selectedInst = selectedInstance();

		if (resources.state.versions.length === 0) {
			return {
				title: "No versions available",
				description:
					"This project did not return any versions from the selected platform.",
			};
		}

		if (
			selectedInst &&
			!isModpack() &&
			compatibilityFilteredVersions().length === 0
		) {
			return {
				title: "No compatible versions for this instance",
				description: `No versions support Minecraft ${selectedInst.minecraftVersion} with ${formatLoaderName(selectedInst.modloader)}. Try another instance or adjust your target version.`,
			};
		}

		if (query.length > 0) {
			return {
				title: "No versions match your filter",
				description: `No versions matched "${query}". Try a broader search term.`,
			};
		}

		if (
			gameVersionChips().length > 0 ||
			versionLoaders().size > 0 ||
			versionReleaseTypes().size > 0
		) {
			return {
				title: "No versions match your filters",
				description: "Try clearing the version chips or loader filters.",
			};
		}

		return {
			title: "No versions to display",
			description: "Try another instance or clear your filters.",
		};
	});

	createEffect(() => {
		filteredVersions();
		setVersionPage(1);
	});

	const paginatedVersions = createMemo(() => {
		const start = (versionPage() - 1) * versionsPerPage;
		return filteredVersions().slice(start, start + versionsPerPage);
	});

	const totalPages = createMemo(() =>
		Math.ceil(filteredVersions().length / versionsPerPage),
	);

	const compatibleVersionCount = createMemo(
		() => compatibilityFilteredVersions().length,
	);

	const [isInstanceDialogOpen, setIsInstanceDialogOpen] = createSignal(false);
	const [installContext, setInstallContext] = createSignal<{
		version: ResourceVersion;
	} | null>(null);
	const [worldInstall, setWorldInstall] = createSignal<{
		project: ResourceProject;
		versions: ResourceVersion[];
		version?: ResourceVersion;
		installType: ResourceType;
		instanceId: number;
	} | null>(null);
	const [confirmUninstall, setConfirmUninstall] = createSignal(false);
	const [confirmVersionId, setConfirmVersionId] = createSignal<string | null>(
		null,
	);

	const getCompatibility = (version: ResourceVersion) => {
		const instanceId = resources.state.selectedInstanceId;
		if (!instanceId) return { type: "compatible" as const };

		const instance = instancesState.instances.find((i) => i.id === instanceId);
		if (!instance) return { type: "compatible" as const };

		return getCompatibilityForInstance(
			project(),
			version,
			instance,
			installType(),
		);
	};

	const isProjectIncompatible = createMemo(() => {
		if (installType() === "datapack") return false;
		const instId = resources.state.selectedInstanceId;
		if (!instId || isModpack()) return false;

		const inst = instancesState.instances.find((i) => i.id === instId);
		if (!inst) return false;

		const instLoader = inst.modloader?.toLowerCase() || "";
		const resType = installType();

		// Vanilla restriction
		if (instLoader === "" || instLoader === "vanilla") {
			if (resType === "mod" || resType === "shader") return true;
		}

		// No compatible version found
		if (!bestVersionForCurrent()) return true;

		return false;
	});

	const hasAnyCompatibleVersion = createMemo(() => {
		const instId = resources.state.selectedInstanceId;
		if (!instId) return false;
		const inst = instancesState.instances.find((i) => i.id === instId);
		if (!inst) return false;

		return resources.state.versions.some((v) => {
			const comp = getCompatibilityForInstance(
				project(),
				v,
				inst,
				installType(),
			);
			return comp.type !== "incompatible";
		});
	});

	const isUpdateAvailable = createMemo(() => {
		const installed = installedResource();
		const best = bestVersionForCurrent();
		if (!installed || !best) return false;

		// If it's the same file (same hash), then no update is available
		if (installed.hash && best.hash && installed.hash === best.hash)
			return false;

		// If platforms match, we can trust the ID check too
		const p = project();
		if (p && installed.platform.toLowerCase() === p.source.toLowerCase()) {
			return installed.remote_version_id !== best.id;
		}

		// Otherwise fallback to version strings
		return installed.current_version !== best.version_number;
	});

	const handleQuickAction = () => {
		if (isProjectIncompatible() && !isProjectInstalled()) {
			if (hasAnyCompatibleVersion()) {
				activeRouter()?.updateQuery("activeTab", "versions", true);
			}
			return;
		}

		if (isProjectInstalled()) {
			if (isUpdateAvailable()) {
				const best = primaryVersion();
				if (best) {
					handleInstall(best);
					return;
				}
			}

			if (!confirmUninstall()) {
				setConfirmUninstall(true);
				setTimeout(() => setConfirmUninstall(false), 3000);
				return;
			}
			handleUninstall();
			setConfirmUninstall(false);
			return;
		}

		if (isModpack()) {
			const best = primaryVersion();
			if (best) {
				handleInstall(best);
			}
			return;
		}

		if (installType() === "datapack") {
			const p = project();
			if (!p) return;
			const instId = resources.state.selectedInstanceId;
			if (!instId) {
				resources.setInstallRequest({
					project: p,
					versions: resources.state.versions,
					installType: "datapack",
				});
				setIsInstanceDialogOpen(true);
				return;
			}
			setWorldInstall({
				project: p,
				versions: resources.state.versions,
				installType: "datapack",
				instanceId: instId,
			});
			return;
		}

		const instId = resources.state.selectedInstanceId;
		if (!instId) {
			// Logic similar to card quick install when no instance selected
			const p = project();
			if (p) {
				resources.setInstallRequest({
					project: p,
					versions: resources.state.versions,
					installType: installType(),
				});
				setIsInstanceDialogOpen(true);
			}
			return;
		}

		const best = primaryVersion();
		if (best) {
			handleInstall(best);
		} else {
			activeRouter()?.updateQuery("activeTab", "versions", true);
			showToast({
				title: "Choose version",
				description:
					"No automatically compatible version found. Please select one manually.",
				severity: "info",
			});
		}
	};

	const handleDescriptionLink = async (url: string) => {
		setHoveredLink(null);
		try {
			// `parseResourceUrl` internally handles decoding of `/linkout?remoteUrl=` patterns.
			const parsed = parseResourceUrl(url);

			if (parsed) {
				const { platform, id, activeTab, versionId } = parsed;
				console.log(
					`[ResourceDetails] Intercepted link to ${platform} resource: ${id}${
						activeTab ? ` (Tab: ${activeTab})` : ""
					}`,
				);

				// If we're already on this project, just update the tab
				const current = project();
				if (current && current.id === id && current.source === platform) {
					transitionRouteState(
						{
							activeTab: activeTab || "description",
							versionId: versionId || null,
						},
						true,
					);
					return;
				}

				activeRouter()?.navigate("/resource-details", {
					projectId: id,
					platform,
					activeTab,
					versionId,
				});
				return;
			}

			// Fallback: Open in browser. Decode linkout wrappers for a cleaner destination.
			const decoded = decodeCurseForgeLinkout(url);
			await openExternal(decoded);
		} catch (e) {
			console.error("[ResourceDetails] Link handling error:", e);
			try {
				await openExternal(url);
			} catch (inner) {
				console.error("[ResourceDetails] Failed to open in browser:", inner);
			}
		}
	};

	onCleanup(() => {
		setHoveredLink(null);
	});

	const handleProjectRouting = (
		id?: string,
		platform?: SourcePlatform,
		initialProject?: ResourceProject,
	) => {
		const currentProject = untrack(project);
		const inputKey = id && platform ? `${platform}:${id}` : null;
		if (
			inputKey &&
			routedProjectKey === inputKey &&
			currentProject?.id === id &&
			currentProject?.source === platform &&
			untrack(projectLoadSettled)
		) {
			return;
		}
		routedProjectKey = inputKey;

		if (initialProject) {
			if (
				currentProject?.id !== initialProject.id ||
				currentProject?.source !== initialProject.source
			) {
				projectRequestSequence += 1;
				setProject(initialProject);
				if (initialProject.description) {
					setProjectLoadSettled(true);
					setLoading(false);
					setError(null);
					void resources.selectProject(initialProject);
				} else if (id && platform) {
					setProjectLoadSettled(false);
					void fetchFullProject(platform, id);
				} else {
					void resources.selectProject(initialProject);
				}
			} else if (initialProject.description) {
				setProjectLoadSettled(true);
				setLoading(false);
				setError(null);
				void resources.selectProject(initialProject);
			} else if (!currentProject?.description && id && platform) {
				void fetchFullProject(platform, id);
			}
			return;
		}

		// Deep link case (ID only)
		if (id && platform) {
			void fetchFullProject(platform, id);
		}
	};

	createEffect(
		on(
			() => [props.projectId, props.platform, props.project] as const,
			([id, platform, initialProject]) => {
				handleProjectRouting(id, platform, initialProject);
			},
			{ defer: false },
		),
	);

	async function fetchFullProject(
		platform: SourcePlatform,
		id: string,
		options?: { skipCache?: boolean },
	) {
		const requestSequence = ++projectRequestSequence;
		setLoading(true);
		setError(null);

		if (!options?.skipCache) {
			const cachedProject = getProjectFromCache(platform, id);
			if (cachedProject) {
				if (requestSequence !== projectRequestSequence) return;
				setProject(cachedProject);
				setProjectLoadSettled(true);
				await resources.selectProject(cachedProject);
				if (requestSequence === projectRequestSequence) setLoading(false);
				return;
			}
		}

		if (project()?.id !== id || project()?.source !== platform) {
			setProject(undefined);
			setProjectLoadSettled(false);
			setVersionFilter("");
			setVersionReleaseTypes(new Set<string>());
			setVersionLoaders(new Set<string>());
			setGameVersionChips([]);
			setVersionPage(1);
			setManualVersionId(null);
			setSelectedGalleryItem(null);
		}

		try {
			const fetchedProject = await resources.getProject(platform, id);
			if (requestSequence !== projectRequestSequence) return;
			const p = fetchedProject;
			if (p) setProjectCache(platform, p);

			setProject(p);
			setProjectLoadSettled(true);
			await resources.selectProject(p);

			if (p && p.id !== id) {
				activeRouter()?.updateQuery("projectId", p.id, false);
			}
		} catch (e: unknown) {
			if (requestSequence !== projectRequestSequence) return;
			console.error("Failed to load project details:", e);
			const errorMsg = e instanceof Error ? e.message : String(e);

			try {
				const cached: any = await invoke("get_cached_resource_project", {
					platform,
					id,
				});
				if (requestSequence !== projectRequestSequence) return;
				if (cached) {
					const fallback: ResourceProject = {
						id: cached.id,
						source: platform,
						resource_type: cached.project_type as any,
						name: cached.name,
						summary: cached.summary || "",
						description:
							cached.description || "No description available (Disconnected).",
						icon_url: cached.icon_url,
						author: cached.author || "Unknown",
						authors: cached.authors || ["Unknown"],
						download_count: 0,
						follower_count: 0,
						categories: [],
						web_url: "",
						gallery: [],
						published_at: null,
						updated_at: null,
					};
					setProject(fallback);
					setProjectLoadSettled(true);
					await resources.selectProject(fallback);
					showToast({
						title: "Offline Mode",
						description:
							"Showing cached details. Some functionality may be limited.",
						severity: "warning",
					});
				} else {
					setError(errorMsg);
				}
			} catch {
				setError(errorMsg);
			}
		} finally {
			if (requestSequence === projectRequestSequence) setLoading(false);
		}
	}

	const handleInstall = async (
		version: ResourceVersion,
		targetInstance?: Instance,
	) => {
		const p = project();

		if (installType() === "modpack" && p) {
			const prefilledModpackInfo = buildBrowseModpackInfo(p, version);
			activeRouter()?.navigate(
				"/install",
				{
					projectId: p.id,
					platform: p.source,
					isModpack: true,
					resourceType: "modpack",
					projectName: p.name,
					projectIcon: p.icon_url || undefined,
					projectAuthor: p.author,
					initialVersion: version.id,
					initialVersionNumber: version.version_number,
					initialModloader: version.loaders[0],
					initialMinecraftVersion: minecraftGameVersions(
						version.game_versions,
					)[0],
					modpackUrl: version.download_url || undefined,
				},
				{
					prefilledModpackInfo,
					prefetchedModpackVersions:
						resources.state.versions.length > 0
							? resources.state.versions
							: [version],
				},
			);
			return;
		}

		if (!hasDownloadableArtifact(version)) {
			showToast({
				title: "Third-party download required",
				description: `Opening ${p?.name ?? "this resource"} on the provider website.`,
				severity: "info",
			});
			await openExternal(p?.web_url || "");
			return;
		}

		const instId = targetInstance?.id || resources.state.selectedInstanceId;
		const inst =
			targetInstance || instancesState.instances.find((i) => i.id === instId);

		if (!inst && !isModpack()) {
			setInstallContext({ version });
			setIsInstanceDialogOpen(true);
			return;
		}

		if (p && inst && requiresWorldTarget(p, version, installType())) {
			setWorldInstall({
				project: p,
				versions: resources.state.versions,
				version,
				installType: installType(),
				instanceId: inst.id,
			});
			return;
		}

		if (p) {
			try {
				// Check for cross-loader compatibility warning
				if (inst) {
					const instLoader = inst.modloader?.toLowerCase() || "";
					const hasDirectLoader = version.loaders.some(
						(l) => l.toLowerCase() === instLoader,
					);

					if (
						instLoader === "quilt" &&
						!hasDirectLoader &&
						version.loaders.some((l) => l.toLowerCase() === "fabric")
					) {
						showToast({
							title: "Potential Incompatibility",
							description: `Installing Fabric version of ${p.name} on a Quilt instance. Most mods work, but some may have issues.`,
							severity: "warning",
						});
					}
				}

				await resources.install(
					p,
					version,
					{
						kind: "instance",
						instanceId: inst!.id,
					},
					{ installType: installType() },
				);
				showToast({
					title: "Installation Started",
					description: `Check the notifications in the sidebar for progress on ${p.name}.`,
					severity: "success",
				});
			} catch (err) {
				showToast({
					title: "Failed to install",
					description: err instanceof Error ? err.message : String(err),
					severity: "error",
				});
			}
		}
	};

	const handleSelectWorld = async (world: WorldSummary) => {
		const context = worldInstall();
		if (!context) return;
		const selectedVersion =
			context.version ??
			findBestExactDatapackVersion(
				context.versions,
				world.gameVersion,
				context.project.source,
			);
		if (!selectedVersion) {
			setWorldInstall(null);
			transitionRouteState({ activeTab: "versions", versionId: null }, true);
			showToast({
				title: "Choose a datapack version",
				description: `${world.displayName} has no exact ${world.gameVersion ?? "known-version"} release. Choose a version manually; Vesta will ask for the destination world when you install it.`,
				severity: "warning",
			});
			return;
		}
		if (!hasDownloadableArtifact(selectedVersion)) {
			setWorldInstall(null);
			showToast({
				title: "Third-party download required",
				description: `Opening ${context.project.name} on the provider website.`,
				severity: "info",
			});
			await openExternal(context.project.web_url);
			return;
		}
		const { compatibility, acknowledged } =
			await confirmDatapackWorldCompatibility({
				projectName: context.project.name,
				version: selectedVersion,
				world,
			});
		if (!acknowledged) {
			setWorldInstall(null);
			transitionRouteState({ activeTab: "versions", versionId: null }, true);
			showToast({
				title: "Choose a datapack version",
				description: `Choose another ${context.project.name} release. Vesta will ask for the destination world again when you install it.`,
				severity: "warning",
			});
			return;
		}
		setWorldInstall(null);
		try {
			await resources.install(
				context.project,
				selectedVersion,
				{
					kind: "world",
					world: world.ref,
				},
				{
					installType: context.installType,
					compatibilityAcknowledged: compatibility !== "exact",
					replacementResourceId: replacementResourceIdForWorld(
						managedDatapackReplacement(),
						world.ref,
					),
				},
			);
			showToast({
				title: "Installation Started",
				description: `Check notifications for progress on ${context.project.name}.`,
				severity: "success",
			});
		} catch (err) {
			showToast({
				title: "Failed to install",
				description: String(err),
				severity: "error",
			});
		}
	};

	const handleCreateNew = () => {
		setIsInstanceDialogOpen(false);
		const p = project();
		if (p) {
			const version = installContext()?.version || primaryVersion();
			setInstallContext(null);
			const resourceType = installType();
			const prefilledModpackInfo =
				resourceType === "modpack"
					? buildBrowseModpackInfo(p, version)
					: undefined;
			activeRouter()?.navigate(
				"/install",
				{
					projectId: p.id,
					platform: p.source,
					isModpack: resourceType === "modpack",
					projectName: p.name,
					projectIcon: p.icon_url || "",
					resourceType,
					initialVersion: version?.id,
					initialVersionNumber: version?.version_number,
					initialModloader: version?.loaders[0],
					initialMinecraftVersion:
						resourceType === "modpack"
							? minecraftGameVersions(version?.game_versions || [])[0]
							: undefined,
					modpackUrl:
						resourceType === "modpack"
							? version?.download_url || undefined
							: undefined,
				},
				prefilledModpackInfo
					? {
							prefilledModpackInfo,
							prefetchedModpackVersions:
								resources.state.versions.length > 0
									? resources.state.versions
									: version
										? [version]
										: undefined,
						}
					: {
							pendingResource: {
								project: p,
								version,
								installType: resourceType,
							},
						},
			);
		}
	};

	const handleSelectInstance = (instance: Instance) => {
		setIsInstanceDialogOpen(false);
		resources.setInstallRequest(null);
		// Also update the global selection so the UI reflects the choice
		resources.setInstance(instance.id);

		const ctx = installContext();
		if (ctx) {
			handleInstall(ctx.version, instance);
			setInstallContext(null);
		} else {
			// This was a quick install from the header button
			const p = project();
			if (p && installType() === "datapack") {
				setWorldInstall({
					project: p,
					versions: resources.state.versions,
					installType: "datapack",
					instanceId: instance.id,
				});
				return;
			}
			const best = p
				? findBestVersionForInstance(
						p,
						resources.state.versions,
						instance,
						"release",
						installType(),
					)
				: null;
			if (best) {
				handleInstall(best, instance);
			}
		}
	};

	const renderedDescription = createMemo(() => {
		const desc = project()?.description;
		if (!desc) return "No description provided.";

		// Preprocess known spoiler BBCode from CurseForge/other sources.
		// Some descriptions include [spoiler]...[/spoiler] blocks with
		// characters like '<' that can break HTML parsing when injected
		// directly. Convert those BBCode blocks into a safe HTML wrapper
		// and escape lone '<' characters inside the spoiler body to avoid
		// DOMParser misinterpreting them as tags.
		const escapeForSpoiler = (s: string) =>
			s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

		// Replace spoiler BBCode iteratively, handling nested spoilers by
		// always matching and replacing the innermost spoiler first. The
		// regex below forbids encountering another opening `[spoiler]`
		// inside the body capture, so repeated replacements will peel
		// nested layers correctly.
		let descWithSpoilerHtml = desc;
		const innerSpoilerRegex =
			/\[spoiler(?:=(['"]?)(.*?)\1)?\]((?:(?!\[spoiler\]).)*?)\[\/spoiler\]/gis;
		let safetyCounter = 0;
		while (innerSpoilerRegex.test(descWithSpoilerHtml) && safetyCounter < 100) {
			descWithSpoilerHtml = descWithSpoilerHtml.replace(
				innerSpoilerRegex,
				(_all, _q, title, body) => {
					const head = title
						? `<div class="spoiler-header">${escapeForSpoiler(title)}</div>`
						: "";
					const safeBody = escapeForSpoiler(body);
					return `<div class="spoiler">${head}<div class="spoiler-body">${safeBody}</div></div>`;
				},
			);
			safetyCounter++;
		}

		// Explicitly set marked options for each parse to ensure consistency
		const rawHtml = marked.parse(descWithSpoilerHtml, {
			gfm: true,
			breaks: false, // Treat single newlines as spaces (Modrinth behavior)
		}) as string;

		// Ensure no links have target="_blank" which can cause them to open
		// in the system browser before our intercepted click handler runs.
		// Additionally, rewrite any /linkout?remoteUrl= anchors (including local proxy
		// rewrites) so that the displayed href / text and the anchor href point to the
		// decoded remote URL. This improves UX (users don't see the proxy URL) and
		// ensures middle-click/context-menu open actions target the real destination.
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(rawHtml, "text/html");

			// Normalize existing HTML spoilers: ensure each `.spoiler` has a
			// direct `.spoiler-body` child wrapping its content. This ensures
			// the CSS rule `.spoiler > * { display: none }` hides the body
			// regardless of whether the original content was text nodes,
			// paragraphs, or mixed nodes which could otherwise remain visible.
			const spoilers = Array.from(doc.querySelectorAll(".spoiler"));
			for (const sp of spoilers) {
				// Skip if author already provided a spoiler-body
				if (sp.querySelector(".spoiler-body")) continue;

				// Detect optional header element (e.g. produced from [spoiler=title])
				const firstEl = sp.firstElementChild;
				const hasHeader = !!(
					firstEl && firstEl.classList.contains("spoiler-header")
				);

				// Collect nodes to move into the new body (all nodes except the header)
				const nodesToMove: Node[] = [];
				for (const node of Array.from(sp.childNodes)) {
					if (hasHeader && node === firstEl) continue;
					nodesToMove.push(node);
				}

				// If there is nothing to move, continue
				if (nodesToMove.length === 0) continue;

				const body = doc.createElement("div");
				body.className = "spoiler-body";
				for (const n of nodesToMove) body.appendChild(n);

				if (hasHeader && firstEl && firstEl.nextSibling)
					sp.insertBefore(body, firstEl.nextSibling);
				else sp.appendChild(body);
			}
			const anchors = Array.from(doc.querySelectorAll("a[href]"));
			for (const a of anchors) {
				try {
					const href = a.getAttribute("href") || "";
					// Resolve relative hrefs against the app origin to form a full URL if needed
					let full = href;
					try {
						full = new URL(href, window.location.href).toString();
					} catch {
						// leave as-is
					}
					// Use the shared decoder to detect and extract remote destinations.
					const decoded = decodeCurseForgeLinkout(full);
					if (decoded && decoded !== full) {
						a.setAttribute("href", decoded);
						// If the link text is the URL itself, update it to the cleaner decoded URL
						if (a.textContent && a.textContent.trim() === href.trim()) {
							a.textContent = decoded;
						}
					}
				} catch {
					// Ignore per-anchor errors
				}
			}
			// Upgrade http:// to https:// on all resource-loading elements. macOS ATS blocks
			// insecure connections. Also add native lazy loading for images.
			const resourceElements = Array.from(
				doc.querySelectorAll(
					"img[src], iframe[src], video[src], audio[src], source[src]",
				),
			);
			for (const el of resourceElements) {
				const tag = el.tagName.toLowerCase();
				const src = el.getAttribute("src") || "";
				const upgraded = src.startsWith("http://")
					? src.replace("http://", "https://")
					: src;
				el.setAttribute("src", upgraded);
				if (tag === "img") {
					el.setAttribute("loading", "lazy");
				}
			}

			// Return adjusted HTML and normalize target attribute
			const adjusted = doc.body.innerHTML.replace(
				/target=["']_blank["']/gi,
				'target="_self"',
			);
			return adjusted;
		} catch {
			return rawHtml.replace(/target=["']_blank["']/gi, 'target="_self"');
		}
	});

	// When content barely overflows or fits entirely, add a one-time spacer
	// beneath the description so the user can scroll far enough to collapse
	// the header. The spacer is applied to the inner .description element
	// (not the scroll container) so the layout change doesn't affect scrollTop.
	// We defer with requestAnimationFrame to let the initial paint settle first.
	createEffect(() => {
		const html = renderedDescription();
		const isVisible = activeTab() === "description";
		const scrollContainer = headerCollapse.getScrollContainer();
		const layoutRoot = headerCollapse.getPageRoot();
		if (
			!isVisible ||
			!html ||
			!scrollContainer ||
			!layoutRoot ||
			reducedMotion()
		)
			return;

		requestAnimationFrame(() => {
			const stackEl = layoutRoot.querySelector<HTMLElement>(
				"." + styles["header-stack"],
			);
			const spacerEl = stackEl?.querySelector<HTMLElement>(
				"." + styles["header-spacer"],
			);
			const headerHeight =
				spacerEl?.offsetHeight ?? stackEl?.offsetHeight ?? 168;
			const neededRange = Math.min(72, headerHeight);
			const currentScroll =
				scrollContainer.scrollHeight - scrollContainer.clientHeight;

			if (currentScroll < neededRange) {
				const descEl = layoutRoot.querySelector<HTMLElement>(
					"." + styles.description,
				);
				if (descEl) {
					descEl.style.paddingBottom = neededRange - currentScroll + "px";
				}
			}
		});
	});

	onMount(() => {
		if (typeof window === "undefined") return;

		const mq = window.matchMedia(
			`(max-width: ${COLLAPSING_HEADER_DESKTOP_BREAKPOINT_PX}px)`,
		);

		const applyLayoutMode = () => {
			setIsDesktopHeaderAnimation(!mq.matches);
			headerCollapse.scheduleUpdate();
		};

		applyLayoutMode();
		mq.addEventListener("change", applyLayoutMode);

		onCleanup(() => {
			mq.removeEventListener("change", applyLayoutMode);
		});
	});

	createEffect(
		on(
			() => [activeTab(), project()?.id, loading()] as const,
			() => {
				headerCollapse.scheduleUpdate();
			},
		),
	);

	const syncHeaderSpacer = () => {
		const stack = headerStackEl();
		if (!stack) return;

		const header = stack.querySelector<HTMLElement>(
			`.${styles["resource-details-header"]}`,
		);
		const spacer = stack.querySelector<HTMLElement>(
			`.${styles["header-spacer"]}`,
		);
		if (!header || !spacer) return;

		if (
			typeof window !== "undefined" &&
			window.matchMedia(
				`(max-width: ${COLLAPSING_HEADER_DESKTOP_BREAKPOINT_PX}px)`,
			).matches
		) {
			spacer.style.height = "";
			return;
		}

		spacer.style.height = `${header.offsetHeight}px`;
	};

	createEffect(() => {
		project();
		headerStackEl();
		isDesktopHeaderAnimation();
		queueMicrotask(syncHeaderSpacer);
	});

	createEffect(() => {
		const stack = headerStackEl();
		if (!stack || typeof ResizeObserver === "undefined") return;

		const header = stack.querySelector<HTMLElement>(
			`.${styles["resource-details-header"]}`,
		);
		if (!header) return;

		const ro = new ResizeObserver(() => syncHeaderSpacer());
		ro.observe(header);
		syncHeaderSpacer();

		onCleanup(() => ro.disconnect());
	});

	const focusedCompatibility = createMemo<CompatibilityResult>(() => {
		const version = focusedVersion();
		const instance = selectedInstance();
		if (!version || !instance || isModpack()) {
			return { type: "compatible" as const };
		}
		return getCompatibilityForInstance(
			project(),
			version,
			instance,
			installType(),
		);
	});

	const versionActionLabel = (
		version: ResourceVersion,
		includeVersionNumber = false,
	) => {
		if (isVersionInstalled(version.id, version.hash)) {
			return confirmVersionId() === version.id
				? "Confirm removal"
				: includeVersionNumber
					? `Uninstall ${version.version_number}`
					: "Uninstall";
		}
		if (isVersionInstalling(version.id)) return "Installing…";
		if (isModpack()) return "Create instance";
		if (!selectedInstance()) return "Select instance";
		if (!version.download_url) return "Open provider";
		return includeVersionNumber
			? `Install ${version.version_number}`
			: "Install";
	};

	const versionActionKind = (version: ResourceVersion): VersionActionKind => {
		if (isVersionInstalled(version.id, version.hash)) return "remove";
		if (isVersionInstalling(version.id)) return "progress";
		if (!version.download_url && !isModpack()) return "external";
		return "download";
	};

	const compactVersionActionLabel = (version: ResourceVersion) => {
		const label = versionActionLabel(version);
		if (label === "Select instance") return "Select";
		if (label === "Open provider") return "Open";
		if (label === "Create instance") return "Create";
		return label;
	};

	const versionActionDisabled = (
		version: ResourceVersion,
		allowRemoval = false,
	) =>
		isVersionInstalling(version.id) ||
		(!allowRemoval &&
			isVersionInstalled(version.id, version.hash) &&
			confirmVersionId() !== version.id) ||
		(!isVersionInstalled(version.id, version.hash) &&
			getCompatibility(version).type === "incompatible");

	const focusedActionLabel = createMemo(() => {
		const version = focusedVersion();
		return version ? versionActionLabel(version, true) : "Install";
	});
	const focusedActionKind = createMemo<VersionActionKind>(() => {
		const version = focusedVersion();
		return version ? versionActionKind(version) : "download";
	});

	const focusedActionDisabled = createMemo(() => {
		const version = focusedVersion();
		return !version || versionActionDisabled(version, true);
	});

	const handleVersionAction = (version: ResourceVersion) => {
		if (isVersionInstalled(version.id, version.hash)) {
			if (confirmVersionId() !== version.id) {
				setConfirmVersionId(version.id);
				setTimeout(() => setConfirmVersionId(null), 3000);
				return;
			}
			void handleUninstall();
			setConfirmVersionId(null);
			return;
		}
		void handleInstall(version);
	};

	const handleFocusedAction = () => {
		const version = focusedVersion();
		if (version) handleVersionAction(version);
	};

	const openDependencyProject = (dependencyProject: ResourceProject) => {
		activeRouter()?.navigate(
			"/resource-details",
			{
				projectId: dependencyProject.id,
				platform: dependencyProject.source,
				name: dependencyProject.name,
				iconUrl: dependencyProject.icon_url,
			},
			{ project: dependencyProject },
		);
	};

	const copyFocusedHash = async () => {
		const hash = focusedVersion()?.hash;
		if (!hash) return;
		try {
			await navigator.clipboard.writeText(hash);
			showToast({ title: "Hash copied", severity: "success" });
		} catch (copyError) {
			showToast({
				title: "Could not copy hash",
				description: String(copyError),
				severity: "error",
			});
		}
	};

	const focusedInstallationControls = (version: ResourceVersion) => (
		<div class={styles["sidebar-instance-picker"]}>
			{renderPlatformSwitcher()}
			<Show
				when={!isModpack()}
				fallback={
					<div class={styles["modpack-instance-notice"]}>
						<span>Modpacks will create a new instance when installed</span>
					</div>
				}
			>
				<Select<any>
					options={[
						{ id: null, name: "No Instance" },
						...instancesState.instances,
					]}
					value={
						instancesState.instances.find(
							(instance) => instance.id === resources.state.selectedInstanceId,
						) || { id: null, name: "No Instance" }
					}
					onChange={(value) => {
						const id = (value as any)?.id ?? null;
						resources.setInstance(id);
						if (!id) return;
						const instance = instancesState.instances.find(
							(candidate) => candidate.id === id,
						);
						if (instance) {
							resources.setGameVersion(instance.minecraftVersion);
							resources.setLoader(instance.modloader);
						}
					}}
					optionValue="id"
					optionTextValue="name"
					placeholder="Select instance..."
					itemComponent={(selectProps) => (
						<SelectItem item={selectProps.item}>
							<div class={styles["instance-select-option"]}>
								<InstanceIcon instance={selectProps.item.rawValue} />
								<div class={styles["instance-select-option-copy"]}>
									<span>{selectProps.item.rawValue.name}</span>
									<Show when={selectProps.item.rawValue.id !== null}>
										<small>
											{selectProps.item.rawValue.minecraftVersion}
											{selectProps.item.rawValue.modloader
												? ` · ${selectProps.item.rawValue.modloader}`
												: ""}
										</small>
									</Show>
								</div>
							</div>
						</SelectItem>
					)}
				>
					<SelectTrigger class={styles["instance-select-sidebar"]}>
						<SelectValue<any>>
							{(selectState) => {
								const instance = selectState.selectedOption();
								return (
									<div class={styles["instance-select-option"]}>
										<InstanceIcon instance={instance} />
										<span>{instance?.name || "Select instance..."}</span>
									</div>
								);
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent />
				</Select>
			</Show>
			<Show
				when={
					focusedCompatibility().type !== "compatible" &&
					focusedCompatibility().reason
				}
			>
				<small
					class={`${styles["focused-compatibility-note"]} ${styles[`focused-compatibility-note--${focusedCompatibility().type}`]}`}
				>
					{focusedCompatibility().reason}
				</small>
			</Show>
			<div class={styles["sidebar-action-row"]}>
				<Button
					size="sm"
					class={
						focusedActionKind() === "remove"
							? styles["focused-version-action--remove"]
							: undefined
					}
					style={{ width: "100%" }}
					color={
						isVersionInstalled(version.id, version.hash)
							? "destructive"
							: focusedCompatibility().type === "warning"
								? "warning"
								: "primary"
					}
					variant={
						isVersionInstalled(version.id, version.hash) ? "outline" : "solid"
					}
					disabled={focusedActionDisabled()}
					onClick={handleFocusedAction}
				>
					<VersionActionIcon kind={focusedActionKind()} size={15} />
					{focusedActionLabel()}
				</Button>
			</div>
		</div>
	);

	const focusedSidebarContent = (
		sections: "all" | "install" | "metadata" = "all",
	) => {
		const currentProject = project();
		const version = focusedVersion();
		if (!currentProject || !version) return null;
		return (
			<VersionFocusSidebar
				project={currentProject}
				version={version}
				installControls={focusedInstallationControls(version)}
				dependencyProjects={dependencyData.latest || new Map()}
				onOpenProject={openDependencyProject}
				sections={sections}
			/>
		);
	};

	const sidebarContent = () => (
		<div class={styles["sidebar-scrollable-area"]}>
			<section class={styles["sidebar-section"]}>
				<div class={styles["sidebar-instance-picker"]}>
					{renderPlatformSwitcher()}
					<Show
						when={!isModpack()}
						fallback={
							<div class={styles["modpack-instance-notice"]}>
								<span>Modpacks will create a new instance when installed</span>
							</div>
						}
					>
						<Select<any>
							options={[
								{ id: null, name: "No Instance" },
								...instancesState.instances,
							]}
							value={
								instancesState.instances.find(
									(i) => i.id === resources.state.selectedInstanceId,
								) || {
									id: null,
									name: "No Instance",
								}
							}
							onChange={(v) => {
								const id = (v as any)?.id ?? null;
								resources.setInstance(id);
								if (id) {
									const inst = instancesState.instances.find(
										(i) => i.id === id,
									);
									if (inst) {
										resources.setGameVersion(inst.minecraftVersion);
										resources.setLoader(inst.modloader);
									}
								}
							}}
							optionValue="id"
							optionTextValue="name"
							placeholder="Select instance..."
							itemComponent={(props) => (
								<SelectItem item={props.item}>
									<div
										style={{
											display: "flex",
											"align-items": "center",
											gap: "10px",
										}}
									>
										<InstanceIcon instance={props.item.rawValue} />
										<div
											style={{
												display: "flex",
												"flex-direction": "column",
												gap: "2px",
											}}
										>
											<span>{props.item.rawValue.name}</span>
											<Show when={props.item.rawValue.id !== null}>
												<span
													style={{
														"font-size": "11px",
														opacity: 0.6,
													}}
												>
													{props.item.rawValue.minecraftVersion}{" "}
													{props.item.rawValue.modloader
														? `- ${props.item.rawValue.modloader}`
														: ""}
												</span>
											</Show>
										</div>
									</div>
								</SelectItem>
							)}
						>
							<SelectTrigger class={styles["instance-select-sidebar"]}>
								<SelectValue<any>>
									{(s) => {
										const inst = s.selectedOption();
										return (
											<div
												style={{
													display: "flex",
													"align-items": "center",
													gap: "10px",
												}}
											>
												<InstanceIcon instance={inst} />
												<span>
													{inst ? `${inst.name}` : "Select instance..."}
												</span>
											</div>
										);
									}}
								</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</Show>
					<div class={styles["sidebar-action-row"]}>
						<Button
							size="sm"
							style={{ width: "100%" }}
							color={
								isUpdateAvailable()
									? "secondary"
									: isProjectInstalled()
										? "destructive"
										: isProjectIncompatible() && !isProjectInstalled()
											? "none"
											: "primary"
							}
							variant={
								isProjectInstalled() && !isUpdateAvailable()
									? "outline"
									: "solid"
							}
							onClick={handleQuickAction}
							disabled={
								isProjectInstalling() ||
								(isProjectIncompatible() &&
									!isProjectInstalled() &&
									resources.state.selectedInstanceId !== null &&
									!hasAnyCompatibleVersion())
							}
						>
							<Show when={isProjectInstalling()}>
								<VersionActionIcon kind="progress" size={15} />
								<span>Installing...</span>
							</Show>
							<Show when={!isProjectInstalling()}>
								<Show when={isProjectInstalled()}>
									<Show
										when={isUpdateAvailable()}
										fallback={
											<>
												<VersionActionIcon kind="remove" size={15} />
												<Show when={confirmUninstall()} fallback="Uninstall">
													Confirm?
												</Show>
											</>
										}
									>
										<VersionActionIcon kind="download" size={15} />
										Update
									</Show>
								</Show>
								<Show when={!isProjectInstalled()}>
									<Show
										when={isProjectIncompatible()}
										fallback={
											<>
												<VersionActionIcon kind="download" size={15} />
												Install
											</>
										}
									>
										<Show
											when={hasAnyCompatibleVersion()}
											fallback="Unsupported"
										>
											Check Versions
										</Show>
									</Show>
								</Show>
							</Show>
						</Button>
					</div>
				</div>
			</section>

			<section class={styles["sidebar-section"]}>
				<div class={styles["sidebar-section-heading"]}>
					<InfoIcon width={16} height={16} />
					<h3>Project details</h3>
				</div>
				<div class={styles["sidebar-info-list"]}>
					<Show when={project()?.published_at}>
						<div class={styles["sidebar-info-row"]}>
							<span class={styles["field-label"]}>Published</span>
							<span
								class={styles["sidebar-info-value"]}
								title={`Published ${formatDate(project()?.published_at || "")}`}
							>
								{formatDate(project()?.published_at || "")}
							</span>
						</div>
					</Show>
					<Show when={project()?.updated_at}>
						<div class={styles["sidebar-info-row"]}>
							<span class={styles["field-label"]}>Updated</span>
							<span
								class={styles["sidebar-info-value"]}
								title={`Updated ${formatDate(project()?.updated_at || "")}`}
							>
								{formatDate(project()?.updated_at || "")}
							</span>
						</div>
					</Show>
				</div>
			</section>

			<section
				class={`${styles["sidebar-section"]} ${styles["recent-versions-section"]} ${styles["hide-mobile"]}`}
			>
				<div class={styles["sidebar-section-heading"]}>
					<DownloadIcon width={16} height={16} />
					<h3>Recent versions</h3>
					<button
						class={styles["view-all-link"]}
						onClick={() => selectTab("versions")}
					>
						View all
					</button>
				</div>
				<div class={styles["sidebar-version-list"]}>
					<Show
						when={!resources.state.versionsLoading}
						fallback={<InlineLoadingRow message="Loading versions..." />}
					>
						<For each={compatibilityFilteredVersions().slice(0, 5)}>
							{(version) => (
								<VersionSummaryRow
									version={version}
									compact
									onSelect={selectVersion}
									actionLabel={compactVersionActionLabel(version)}
									actionKind={versionActionKind(version)}
									actionDisabled={versionActionDisabled(version, true)}
									onAction={handleVersionAction}
									onPrefetch={prefetchVersionDetails}
								/>
							)}
						</For>
					</Show>
				</div>
			</section>
		</div>
	);

	return (
		<div
			class={styles["resource-details-page"]}
			classList={{ [styles["is-blocking-load"]]: showOverlay() }}
		>
			<FetchingOverlay
				isVisible={showOverlay()}
				title={overlayTitle()}
				message={overlayMessage()}
				error={showError() ? (error() ?? undefined) : undefined}
				variant={showError() || showNotFound() ? "error" : "loading"}
				onRetry={showError() ? () => activeRouter()?.reload() : undefined}
				secondaryAction={
					showError() || showNotFound()
						? { label: "Go Back", onClick: () => activeRouter()?.backwards() }
						: undefined
				}
			/>
			<Show when={showPage()}>
				<div
					class={styles["resource-details"]}
					ref={(el) => headerCollapse.setPageRoot(el ?? undefined)}
				>
					<div class={styles["resource-details-left"]}>
						<div
							class={styles["header-stack"]}
							ref={(el) => {
								headerCollapse.setHeaderEl(el ?? undefined);
								setHeaderStackEl(el ?? undefined);
							}}
						>
							<div class={styles["header-spacer"]} aria-hidden="true" />
							<div
								class={styles["resource-details-header"]}
								onMouseEnter={projectIconPreview.activate}
								onMouseLeave={projectIconPreview.deactivate}
								onFocusIn={projectIconPreview.activate}
								onFocusOut={projectIconPreview.deactivate}
							>
								<Show
									when={focusedVersion()}
									fallback={
										<Show
											when={!focusedVersionId()}
											fallback={
												<div
													class={styles["version-header-info"]}
													aria-busy="true"
													aria-label="Loading version"
												>
													<Show when={shellIcon()}>
														<img
															src={shellIcon() ?? ""}
															alt={shellName()}
															class={styles["project-icon"]}
														/>
													</Show>
													<div class={styles["version-header-copy"]}>
														<div
															class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--header-title"]}`}
														/>
														<div
															class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--header-meta"]}`}
														/>
													</div>
												</div>
											}
										>
											<div class={styles["project-header-info"]}>
												<Show when={shellIcon()}>
													<img
														src={shellIcon() ?? ""}
														alt={shellName()}
														class={styles["project-icon"]}
													/>
												</Show>
												<div class={styles["project-header-text"]}>
													<div class={styles["project-title-line"]}>
														<h1 class={styles["project-title"]}>
															{shellName()}
														</h1>
														<Show when={isProjectInstalling()}>
															<Badge variant="success">Installing...</Badge>
														</Show>
													</div>
													<Show
														when={project()}
														fallback={
															<div
																class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--header-meta"]}`}
															/>
														}
													>
														<div class={styles["project-meta-row"]}>
															<div class={styles["meta-stats"]}>
																<span class={styles["meta-item"]}>
																	By{" "}
																	{project()?.authors &&
																	(project()?.authors?.length ?? 0) > 0
																		? project()?.authors?.[0]
																		: project()?.author}
																</span>
																<Show
																	when={(project()?.download_count ?? 0) > 0}
																>
																	<span class={styles["meta-item"]}>
																		<DownloadIcon width="14" height="14" />
																		{(
																			project()?.download_count ?? 0
																		).toLocaleString()}
																	</span>
																</Show>
																<Show
																	when={
																		project()?.follower_count !== undefined &&
																		project()?.source !== "curseforge"
																	}
																>
																	<span class={styles["meta-item"]}>
																		<HeartIcon width="14" height="14" />
																		{project()?.follower_count.toLocaleString()}
																	</span>
																</Show>
															</div>
															<Show when={project()}>
																{(resourceProject) => (
																	<HeaderCategoryTags
																		project={resourceProject()}
																		resourceType={installType()}
																		onBrowseType={handleBrowseByType}
																		router={activeRouter()}
																	/>
																)}
															</Show>
														</div>
													</Show>
												</div>
											</div>
										</Show>
									}
								>
									{(version) => (
										<div class={styles["version-header-info"]}>
											<Show when={shellIcon()}>
												<img
													src={shellIcon() ?? ""}
													alt={shellName()}
													class={styles["project-icon"]}
												/>
											</Show>
											<div class={styles["version-header-copy"]}>
												<div class={styles["project-title-line"]}>
													<h1 class={styles["project-title"]}>
														{version().version_number}
													</h1>
													<span
														class={`${styles.capitalize} ${styles["release-label"]} ${styles[`release-label--${version().release_type}`]}`}
													>
														{version().release_type}
													</span>
												</div>
												<div class={styles["version-header-meta"]}>
													<span class={styles["version-resource-name"]}>
														{shellName()}
													</span>
													<Show when={version().published_at}>
														<span>
															{formatDate(version().published_at || "")}
														</span>
													</Show>
												</div>
											</div>
										</div>
									)}
								</Show>
								<Show when={project()}>
									<div class={styles["header-link-group"]}>
										<Button
											variant="slate"
											size="icon"
											onClick={() => openExternal(project()?.web_url ?? "")}
											class={styles["header-action-btn"]}
											tooltip_text={`View on ${getSourceDescriptor(project()?.source ?? "modrinth")?.label ?? "provider"}`}
											tooltip_placement="left"
										>
											<ExternalLinkIcon width="16" height="16" />
										</Button>
										<Button
											variant="slate"
											size="icon"
											onClick={handleFollowToggle}
											class={`${styles["header-action-btn"]} ${styles["header-action-btn--notify"]}`}
											tooltip_text={
												isFollowing()
													? "Disable update notifications"
													: "Receive notifications for updates"
											}
											tooltip_placement="left"
										>
											<BellIcon
												width="16"
												height="16"
												style={{
													fill: isFollowing() ? "currentColor" : "none",
													stroke: "currentColor",
												}}
											/>
										</Button>
									</div>
								</Show>
							</div>
						</div>

						<Show when={!focusedVersionId()}>
							<div class={styles["mobile-sidebar-only"]}>
								<div
									class={`${styles["resource-details-sidebar"]} ${styles["theme-card"]} ${styles["resource-overview-sidebar-card"]}`}
									style={{ "margin-bottom": "20px" }}
								>
									<Show
										when={projectContentReady()}
										fallback={<ResourceDetailsSidebarLoading />}
									>
										{sidebarContent()}
									</Show>
								</div>
							</div>
						</Show>
						<Show when={focusedVersionId()}>
							<div
								class={`${styles["resource-details-sidebar"]} ${styles["theme-card"]} ${styles["version-focus-sidebar-card"]} ${styles["mobile-sidebar-only"]}`}
							>
								<Show
									when={focusedVersion()}
									fallback={<VersionFocusSidebarLoading sections="install" />}
								>
									{focusedSidebarContent("install")}
								</Show>
							</div>
						</Show>

						<div class={styles["resource-details-layout"]}>
							<Tabs
								value={activeTab()}
								onChange={(value) =>
									selectTab(value as "description" | "versions" | "gallery")
								}
								class={styles["resource-details-main"]}
							>
								<TabsList class={styles["details-tabs"]}>
									<TabsTrigger value="description" class={styles["tab-btn"]}>
										<span>Description</span>
									</TabsTrigger>
									<TabsTrigger value="versions" class={styles["tab-btn"]}>
										<span>Versions</span>
									</TabsTrigger>
									<Show when={(project()?.gallery?.length ?? 0) > 0}>
										<TabsTrigger value="gallery" class={styles["tab-btn"]}>
											<span>Gallery</span>
										</TabsTrigger>
									</Show>
								</TabsList>
								<div
									class={`${styles["main-scrollable-area"]} ${styles["theme-card"]} ${styles["details-content-surface"]}`}
								>
									<div class={styles["tab-content"]}>
										<TabsContent value="description">
											<Show
												when={projectContentReady()}
												fallback={<ResourceDescriptionLoading />}
											>
												<div
													class={styles.description}
													innerHTML={renderedDescription() as string}
													onMouseOver={(e) => {
														const target = e.target as HTMLElement;
														const anchor = target.closest("a");
														if (anchor) {
															setHoveredLink(anchor.href);
														}
													}}
													onMouseOut={(e) => {
														const target = e.target as HTMLElement;
														const anchor = target.closest("a");
														if (anchor) {
															setHoveredLink(null);
														}
													}}
													onClick={(e) => {
														const target = e.target as HTMLElement;
														const anchor = target.closest("a");
														if (anchor) {
															e.preventDefault();
															e.stopPropagation();
															handleDescriptionLink(anchor.href);
															return;
														}

														const spoiler = target.closest(".spoiler");
														if (spoiler instanceof HTMLElement) {
															const isVisible =
																spoiler.classList.contains("is-visible");
															const header = target.closest(".spoiler-header");

															// Behavior:
															// - If the spoiler is closed, clicking anywhere inside it opens it.
															// - If the spoiler is open, only clicks on the header toggle (close/open).
															if (!isVisible) {
																spoiler.classList.add("is-visible");
															} else if (header) {
																spoiler.classList.toggle("is-visible");
															}
														}
													}}
													onAuxClick={(e) => {
														const target = e.target as HTMLElement;
														const anchor = target.closest("a");
														if (anchor && e.button === 1) {
															// Middle click
															e.preventDefault();
															e.stopPropagation();
															handleDescriptionLink(anchor.href);
														}
													}}
												/>
											</Show>
										</TabsContent>

										<TabsContent value="gallery">
											<div class={styles["gallery-grid"]}>
												<For each={project()?.gallery}>
													{(item) => (
														<div
															class={styles["gallery-item"]}
															onClick={() => setSelectedGalleryItem(item)}
														>
															<img src={item} alt="Gallery Item" />
														</div>
													)}
												</For>
											</div>
										</TabsContent>

										<TabsContent value="versions">
											<Show when={!focusedVersionId()}>
												<Show
													when={
														projectContentReady() &&
														!resources.state.versionsLoading
													}
													fallback={<ResourceVersionsLoading />}
												>
													<div class={styles["version-page"]}>
														<VersionFilterBar
															searchText={versionFilter()}
															onSearchTextChange={(text) => {
																setVersionFilter(text);
															}}
															selectedVersions={gameVersionChips()}
															onSelectedVersionsChange={setGameVersionChips}
															availableVersions={uniqueGameVersions()}
															releaseTypes={versionReleaseTypes()}
															onReleaseTypesChange={(types) => {
																setVersionReleaseTypes(new Set(types));
															}}
															loaders={versionLoaders()}
															onLoadersChange={(loaders) => {
																setVersionLoaders(new Set(loaders));
															}}
															availableLoaders={uniqueLoaders()}
															totalCount={resources.state.versions.length}
															filteredCount={filteredVersions().length}
														/>

														<Show when={selectedInstance() && !isModpack()}>
															<div
																class={styles["version-compatibility-notice"]}
																classList={{
																	[styles[
																		"version-compatibility-notice--warning"
																	]]: compatibleVersionCount() === 0,
																}}
															>
																<div
																	class={styles["version-compatibility-title"]}
																>
																	<Show
																		when={compatibleVersionCount() > 0}
																		fallback="No compatible versions for selected instance"
																	>
																		Showing {compatibleVersionCount()}{" "}
																		compatible version
																		{compatibleVersionCount() === 1 ? "" : "s"}
																	</Show>
																</div>
																<div
																	class={
																		styles["version-compatibility-description"]
																	}
																>
																	Target: {selectedInstance()?.name} · Minecraft{" "}
																	{selectedInstance()?.minecraftVersion} ·{" "}
																	{formatLoaderName(
																		selectedInstance()?.modloader,
																	)}
																</div>
															</div>
														</Show>

														<div
															class={`${styles["version-list"]} ${styles["full-width"]}`}
														>
															<Show
																when={filteredVersions().length > 0}
																fallback={
																	<div class={styles["version-empty-state"]}>
																		<div
																			class={
																				styles["version-empty-state__title"]
																			}
																		>
																			{versionEmptyState().title}
																		</div>
																		<div
																			class={
																				styles[
																					"version-empty-state__description"
																				]
																			}
																		>
																			{versionEmptyState().description}
																		</div>
																	</div>
																}
															>
																<For each={paginatedVersions()}>
																	{(version) => (
																		<VersionSummaryRow
																			version={version}
																			onSelect={selectVersion}
																			actionLabel={versionActionLabel(version)}
																			actionKind={versionActionKind(version)}
																			actionDisabled={versionActionDisabled(
																				version,
																				true,
																			)}
																			onAction={handleVersionAction}
																			onPrefetch={prefetchVersionDetails}
																		/>
																	)}
																</For>

																<Show when={totalPages() > 1}>
																	<div class={styles["version-pagination"]}>
																		<Pagination
																			count={totalPages()}
																			page={versionPage()}
																			onPageChange={setVersionPage}
																			itemComponent={(props) => (
																				<PaginationItem page={props.page}>
																					{props.page}
																				</PaginationItem>
																			)}
																			ellipsisComponent={() => (
																				<PaginationEllipsis />
																			)}
																		>
																			<PaginationPrevious />
																			<PaginationItems />
																			<PaginationNext />
																		</Pagination>
																	</div>
																</Show>
															</Show>
														</div>
													</div>
												</Show>
											</Show>
											<Show when={focusedVersionId()}>
												<Show
													when={focusedVersion()}
													fallback={
														<Show
															when={!versionDetails.error}
															fallback={
																<div class={styles["version-focus-loading"]}>
																	<strong>Version details unavailable</strong>
																	<span>{String(versionDetails.error)}</span>
																	<div
																		class={
																			styles["version-focus-error-actions"]
																		}
																	>
																		<Button
																			size="sm"
																			onClick={() =>
																				setVersionDetailsRefresh(
																					(value) => value + 1,
																				)
																			}
																		>
																			Retry
																		</Button>
																		<Button
																			size="sm"
																			variant="outline"
																			onClick={showAllVersions}
																		>
																			All versions
																		</Button>
																	</div>
																</div>
															}
														>
															<VersionFocusMainLoading
																onBack={showAllVersions}
															/>
														</Show>
													}
												>
													{(version) => (
														<VersionFocusMain
															version={version()}
															details={versionDetails.latest}
															loading={versionDetails.loading}
															error={
																versionDetails.error
																	? String(versionDetails.error)
																	: undefined
															}
															onBack={showAllVersions}
															onRetry={() =>
																setVersionDetailsRefresh((value) => value + 1)
															}
															onCopyHash={() => void copyFocusedHash()}
															onContentLink={(url) =>
																void handleDescriptionLink(url)
															}
														/>
													)}
												</Show>
											</Show>
										</TabsContent>
									</div>
								</div>
							</Tabs>
							<Show when={focusedVersionId()}>
								<div
									class={`${styles["resource-details-sidebar"]} ${styles["theme-card"]} ${styles["version-focus-sidebar-card"]} ${styles["mobile-version-sidebar"]}`}
								>
									<Show
										when={focusedVersion()}
										fallback={
											<VersionFocusSidebarLoading sections="metadata" />
										}
									>
										{focusedSidebarContent("metadata")}
									</Show>
								</div>
							</Show>
						</div>
					</div>

					<div
						class={`${styles["resource-details-sidebar"]} ${styles["theme-card"]} ${styles["desktop-sidebar-only"]}`}
						classList={{
							[styles["resource-overview-sidebar-card"]]: !focusedVersionId(),
							[styles["version-focus-sidebar-card"]]: Boolean(
								focusedVersionId(),
							),
						}}
					>
						<Show
							when={focusedVersionId()}
							fallback={
								<Show
									when={projectContentReady()}
									fallback={<ResourceDetailsSidebarLoading />}
								>
									{sidebarContent()}
								</Show>
							}
						>
							<Show
								when={focusedVersion()}
								fallback={<VersionFocusSidebarLoading />}
							>
								{focusedSidebarContent()}
							</Show>
						</Show>
					</div>

					<ImageViewer
						src={selectedGalleryItem()}
						images={project()?.gallery?.map((item) => ({
							src: item,
							title: project()?.name || "Resource Gallery",
						}))}
						title={project()?.name || "Resource Gallery"}
						showDelete={false}
						onClose={() => {
							setSelectedGalleryItem(null);
						}}
					/>
					<Show when={hoveredLink()}>
						<div class={styles["link-preview-statusBar"]}>{hoveredLink()}</div>
					</Show>

					<ResourceInstanceSelectionDialog
						isOpen={isInstanceDialogOpen()}
						onClose={() => {
							setIsInstanceDialogOpen(false);
							setInstallContext(null);
							resources.setInstallRequest(null);
						}}
						onSelect={handleSelectInstance}
						onCreateNew={handleCreateNew}
						project={project()}
						version={installContext()?.version}
						versions={resources.state.versions}
						installType={installType()}
					/>
					<WorldSelectionDialog
						isOpen={Boolean(worldInstall())}
						initialInstanceId={worldInstall()?.instanceId}
						projectName={worldInstall()?.project.name}
						onClose={() => setWorldInstall(null)}
						onSelectWorld={handleSelectWorld}
					/>
				</div>
			</Show>
		</div>
	);
};

export default ResourceDetailsPage;
