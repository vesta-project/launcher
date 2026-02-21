import BellIcon from "@assets/bell.svg";
import CloseIcon from "@assets/close.svg";
import HeartIcon from "@assets/heart.svg";
import RightArrowIcon from "@assets/right-arrow.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { instancesState } from "@stores/instances";
import { openModpackInstallFromUrl } from "@stores/modpack-install";
import {
	findBestVersion,
	ResourceDependency,
	ResourceProject,
	ResourceVersion,
	resources,
	SourcePlatform,
} from "@stores/resources";
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
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { formatDate } from "@utils/date";
import { openExternal } from "@utils/external-link";
import { DEFAULT_ICONS, type Instance, isDefaultIcon } from "@utils/instances";
import { parseResourceUrl } from "@utils/resource-url";
import {
	getCompatibilityForInstance,
	getShaderEnginesInOrder,
	type ShaderEngineInfo,
} from "@utils/resources";
import { marked } from "marked";
import {
	Component,
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
import InstanceSelectionDialog from "./instance-selection-dialog";
import styles from "./resource-details.module.css";

// Configure marked for GFM
marked.setOptions({
	gfm: true,
	breaks: false,
});

const VersionTags = (props: { versions: string[] }) => {
	const limit = 2;
	const items = () => props.versions.slice(0, limit);
	const hasMore = () => props.versions.length > limit;
	const remainingCount = () => props.versions.length - limit;
	const remainingItems = () => props.versions.slice(limit);

	// Try to detect version range
	const displayVersions = () => {
		if (props.versions.length <= 3) return items();

		const sorted = [...props.versions].sort((a, b) => {
			// Very basic version sorting
			return a.localeCompare(b, undefined, {
				numeric: true,
				sensitivity: "base",
			});
		});
		return [sorted[0], "...", sorted[sorted.length - 1]];
	};

	return (
		<div class={styles["version-meta"]}>
			<For each={displayVersions()}>
				{(v) => <span class={styles["meta-tag"]}>{v}</span>}
			</For>
			<Show when={hasMore() && displayVersions().length === limit}>
				<Tooltip>
					<TooltipTrigger>
						<span class={`${styles["meta-tag"]} ${styles.more}`}>
							+{remainingCount()} more
						</span>
					</TooltipTrigger>
					<TooltipContent>
						<div class={styles["version-tooltip-list"]}>
							<For each={remainingItems()}>
								{(v) => <div class={styles["tooltip-version-item"]}>{v}</div>}
							</For>
						</div>
					</TooltipContent>
				</Tooltip>
			</Show>
		</div>
	);
};

const DependencyItem = (props: {
	dependency: ResourceDependency;
	platform: SourcePlatform;
	project?: ResourceProject;
	router?: MiniRouter;
}) => {
	const activeRouter = createMemo(() => props.router || router());
	const [data] = createResource(
		() => {
			if (props.project) return null; // already have data
			return props.dependency.project_id;
		},
		async (id: string) => {
			return await resources.getProject(props.platform, id);
		},
	);

	const displayData = () => props.project || data();

	return (
		<Show
			when={displayData()}
			fallback={
				<div class={`${styles["dependency-item"]} ${styles.skeleton}`} />
			}
		>
			<div
				class={styles["dependency-item"]}
				onClick={() => {
					const p = displayData();
					if (p) {
						activeRouter()?.navigate(
							"/resource-details",
							{
								projectId: p.id,
								platform: p.source,
								name: p.name,
								iconUrl: p.icon_url,
							},
							{
								project: p,
							},
						);
					}
				}}
			>
				<img
					src={displayData()?.icon_url || "/default-pack.png"}
					alt={displayData()?.name}
					class={styles["dep-icon"]}
				/>
				<div class={styles["dep-info"]}>
					<div class={styles["dep-header"]}>
						<span class={styles["dep-name"]}>{displayData()?.name}</span>
						<Badge
							variant={
								props.dependency.dependency_type.toLowerCase() === "required"
									? "default"
									: "secondary"
							}
						>
							{props.dependency.dependency_type}
						</Badge>
					</div>
					<div class={styles["dep-meta"]}>
						<span class={styles["dep-author"]}>by {displayData()?.author}</span>
						<Show when={props.dependency.file_name}>
							<span class={styles["dep-version-tag"]}>
								{" "}
								• {props.dependency.file_name}
							</span>
						</Show>
					</div>
				</div>
				<div class={styles["dep-action"]}>
					<RightArrowIcon width={16} height={16} />
				</div>
			</div>
		</Show>
	);
};

const ResourceDetailsPage: Component<{
	project?: ResourceProject;
	projectId?: string;
	platform?: SourcePlatform;
	setRefetch?: (fn: () => Promise<void>) => void;
	router?: MiniRouter;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());
	const [project, setProject] = createSignal<ResourceProject | undefined>(
		props.project,
	);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	// Derived from router query params for persistence and history
	const activeTab = createMemo(() => {
		const params = activeRouter()?.currentParams.get();
		return (
			(params?.activeTab as
				| "description"
				| "versions"
				| "gallery"
				| "dependencies") || "description"
		);
	});

	const [versionFilter, setVersionFilter] = createSignal("");
	const [selectedGalleryItem, setSelectedGalleryItem] = createSignal<
		string | null
	>(null);
	const [versionPage, setVersionPage] = createSignal(1);
	const versionsPerPage = 15;
	const [manualVersionId, setManualVersionId] = createSignal<string | null>(
		null,
	);
	const [hoveredLink, setHoveredLink] = createSignal<string | null>(null);

	// Register refetch so the navbar reload button works
	onMount(() => {
		const handleRefetch = async () => {
			console.log("[ResourceDetails] Reloading project data...");
			setError(null);

			const p = project();
			const platform = p?.source || props.platform;
			const id = p?.id || props.projectId;

			if (platform && id) {
				await fetchFullProject(platform, id);
			} else {
				console.warn("[ResourceDetails] Cannot reload: missing platform or id");
			}
		};

		props.setRefetch?.(handleRefetch);
		activeRouter()?.setRefetch(handleRefetch);
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

		return findBestVersion(
			resources.state.versions,
			inst.minecraftVersion,
			inst.modloader,
			"release",
			project()?.resource_type,
		);
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

	const [subscriptions, { refetch: refetchSubscriptions }] = createResource<
		any[]
	>(() => invoke("get_notification_subscriptions"));

	const isFollowing = createMemo(() => {
		const subs = subscriptions();
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
			const sub = subscriptions()?.find((s) => {
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

	const [peerProject] = createResource(project, async (p: ResourceProject) => {
		if (!p) return null;
		try {
			return await invoke<ResourceProject | null>("find_peer_resource", {
				project: p,
			});
		} catch (e) {
			console.error("Failed to find peer project:", e);
			return null;
		}
	});

	const [dependencyData] = createResource(
		() => ({
			platform: project()?.source,
			deps: primaryVersion()?.dependencies || [],
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
		const displayChar = createMemo(() => {
			const name = iconProps.instance?.name || "?";
			const match = name.match(/[a-zA-Z]/);
			return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
		});
		return (
			<Show when={iconProps.instance && iconProps.instance.id !== null}>
				<Show
					when={!isDefaultIcon(iconPath())}
					fallback={
						<div class={styles["instance-item-icon-placeholder"]}>
							{displayChar()}
						</div>
					}
				>
					<div
						class={styles["instance-item-icon"]}
						style={
							iconPath().startsWith("linear-gradient")
								? { background: iconPath() }
								: {
										"background-image": `url('${iconPath()}')`,
										"background-size": "cover",
										"background-position": "center",
									}
						}
					/>
				</Show>
			</Show>
		);
	};

	const isVersionInstalled = (versionId: string, hash?: string) => {
		return resources.state.installedResources.some(
			(ir) => ir.remote_version_id === versionId || (hash && ir.hash === hash),
		);
	};

	const isVersionInstalling = (versionId: string) => {
		return resources.state.installingVersionIds.includes(versionId);
	};

	const isModpack = () => project()?.resource_type === "modpack";

	const isProjectInstalled = createMemo(() => {
		const p = project();
		if (!p) return false;

		const mainId = p.id.toLowerCase();
		const peerId = peerProject()?.id.toLowerCase();
		const extIds = p.external_ids || {};
		const projectName = p.name.toLowerCase();
		const resType = p.resource_type;

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
		const p = project();
		if (!p) return null;

		const mainId = p.id.toLowerCase();
		const peerId = peerProject()?.id.toLowerCase();
		const extIds = p.external_ids || {};
		const projectName = p.name.toLowerCase();
		const resType = p.resource_type;

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
		if (props.setRefetch) {
			props.setRefetch(async () => {
				const p = project();
				if (p) await fetchFullProject(p.source, p.id);
			});
		}

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
			() => props.projectId,
			(id, prevId) => {
				if (id && id !== prevId) {
					// Only clear the tab if it's currently set, to avoid unnecessary router updates
					const currentTab = untrack(
						() => activeRouter()?.currentParams.get().activeTab,
					);
					if (currentTab) {
						activeRouter()?.removeQuery("activeTab");
					}
					setVersionFilter("");
					setVersionPage(1);
					setSelectedGalleryItem(null);
				}
			},
		),
	);

	const filteredVersions = createMemo(() => {
		const query = versionFilter().toLowerCase();
		let list = resources.state.versions;
		if (query) {
			list = list.filter(
				(v) =>
					v.version_number.toLowerCase().includes(query) ||
					v.game_versions.some((gv) => gv.toLowerCase().includes(query)) ||
					v.loaders.some((l) => l.toLowerCase().includes(query)),
			);
		}
		return list;
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

	const [isInstanceDialogOpen, setIsInstanceDialogOpen] = createSignal(false);
	const [installContext, setInstallContext] = createSignal<{
		version: ResourceVersion;
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

		return getCompatibilityForInstance(project(), version, instance);
	};

	const isProjectIncompatible = createMemo(() => {
		const instId = resources.state.selectedInstanceId;
		if (!instId || isModpack()) return false;

		const inst = instancesState.instances.find((i) => i.id === instId);
		if (!inst) return false;

		const instLoader = inst.modloader?.toLowerCase() || "";
		const resType = project()?.resource_type;

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
			const comp = getCompatibilityForInstance(project(), v, inst);
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

		const instId = resources.state.selectedInstanceId;
		if (!instId) {
			// Logic similar to card quick install when no instance selected
			const p = project();
			if (p) {
				resources.setRequestInstall(p, resources.state.versions);
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
			const parsed = parseResourceUrl(url);

			if (parsed) {
				const { platform, id, activeTab } = parsed;
				console.log(
					`[ResourceDetails] Intercepted link to ${platform} resource: ${id}${
						activeTab ? ` (Tab: ${activeTab})` : ""
					}`,
				);

				// If we're already on this project, just update the tab
				const current = project();
				if (current && current.id === id && current.source === platform) {
					activeRouter()?.updateQuery(
						"activeTab",
						activeTab || "description",
						true,
					);
					return;
				}

				activeRouter()?.navigate("/resource-details", {
					projectId: id,
					platform,
					activeTab,
				});
				return;
			}

			// Fallback: Open in browser
			await openExternal(url);
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

		if (initialProject) {
			// If the project ID shifted, update state immediately
			if (currentProject?.id !== initialProject.id) {
				setProject(initialProject);
				resources.selectProject(initialProject);
			}

			// Hit data usually lacks description; fetch it if missing
			const needsHydration =
				!initialProject.description ||
				(currentProject?.id === initialProject.id &&
					!currentProject?.description);
			if (needsHydration && id && platform) {
				fetchFullProject(platform, id);
			}
			return;
		}

		// Deep link case (ID only)
		if (id && platform && currentProject?.id !== id) {
			fetchFullProject(platform, id);
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

	async function fetchFullProject(platform: SourcePlatform, id: string) {
		console.log("[ResourceDetails] Fetching full project details for:", id);
		setLoading(true);
		setError(null);
		try {
			const p = await resources.getProject(platform, id);
			console.log("[ResourceDetails] Fetched project:", p?.name);

			setProject(p);
			resources.selectProject(p);

			// Unify to ID if we resolved a slug
			if (p && p.id !== id) {
				console.log(
					`[ResourceDetails] Unifying project ID from ${id} to ${p.id}`,
				);
				// Use replace (push=false) to avoid breaking the back button
				activeRouter()?.updateQuery("projectId", p.id, false);
			}
		} catch (e: any) {
			console.error("Failed to load project details:", e);
			const errorMsg = e instanceof Error ? e.message : String(e);

			// Try graceful fallback to cached metadata if the network failed
			try {
				const cached: any = await invoke("get_cached_resource_project", { id });
				if (cached) {
					console.log("[ResourceDetails] Using cached fallback for:", id);
					// Map Record back to Project-like structure for the UI
					const fallback: ResourceProject = {
						id: cached.id,
						source: platform,
						resource_type: cached.resource_type as any,
						name: cached.name,
						summary: cached.summary || "",
						description:
							cached.description || "No description available (Disconnected).",
						icon_url: cached.icon_url,
						author: cached.author || "Unknown",
						download_count: 0,
						follower_count: 0,
						categories: [],
						web_url: "",
						gallery: [],
						published_at: null,
						updated_at: null,
					};
					setProject(fallback);
					resources.selectProject(fallback);
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
			setLoading(false);
		}
	}

	const handleInstall = async (
		version: ResourceVersion,
		targetInstance?: Instance,
	) => {
		const p = project();

		if (p?.resource_type === "modpack") {
			activeRouter()?.navigate("/install", {
				projectId: p.id,
				platform: p.source,
				isModpack: true,
				resourceType: "modpack",
				projectName: p.name,
				projectIcon: p.icon_url || undefined,
				projectAuthor: p.author,
				initialVersion: version.id,
				initialModloader: version.loaders[0],
				modpackUrl: version.download_url,
			});
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

		if (!version.download_url) {
			showToast({
				title: "Third-party download required",
				description:
					"CurseForge requires this mod to be downloaded through their website. Opening link...",
				severity: "info",
			});
			await openExternal(p?.web_url || "");
			return;
		}

		if (p) {
			try {
				// Check for shader engine dependencies
				if (p.resource_type === "shader" && inst) {
					const engines = getShaderEnginesInOrder(inst.modloader);
					const installedInTarget = await resources.getInstalled(inst.id);
					// Check if *either* major shader engine is installed
					const isAnyEngineInstalled = installedInTarget.some(
						(ir) =>
							ir.display_name.toLowerCase().includes("iris") ||
							ir.display_name.toLowerCase().includes("oculus"),
					);

					if (!isAnyEngineInstalled && engines.length > 0) {
						let bestEngineVersion = null;
						let engineProject = null;

						for (const engineInfo of engines) {
							try {
								const versions = await resources.getVersions(
									engineInfo.source,
									engineInfo.id,
								);
								const vBest = findBestVersion(
									versions,
									inst.minecraftVersion,
									inst.modloader,
									"release",
									"mod",
								);
								if (vBest) {
									bestEngineVersion = vBest;
									engineProject = await resources.getProject(
										engineInfo.source,
										engineInfo.id,
									);
									break;
								}
							} catch (e) {
								console.error(`Failed to check engine ${engineInfo.name}:`, e);
							}
						}

						if (bestEngineVersion && engineProject) {
							showToast({
								title: "Shader Engine Required",
								description: `Installing ${engineProject.name} to support shaders...`,
								severity: "info",
							});
							await resources.install(
								engineProject,
								bestEngineVersion,
								inst.id,
							);
						}
					}
				}

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

				await resources.install(p, version, inst?.id);
				showToast({
					title: "Success",
					description: `Installed ${p.name} to ${inst?.name}`,
					severity: "success",
				});
			} catch (err) {
				showToast({
					title: "Failed to install",
					description: err instanceof Error ? err.message : String(err),
					severity: "error",
				});
			} finally {
				// Refresh counts/states
				if (inst) {
					resources.fetchInstalled(inst.id);
				}
			}
		}
	};

	const handleCreateNew = () => {
		setIsInstanceDialogOpen(false);
		const p = project();
		if (p) {
			activeRouter()?.navigate("/install", {
				projectId: p.id,
				platform: p.source,
				isModpack: p.resource_type === "modpack",
				projectName: p.name,
				projectIcon: p.icon_url || "",
				resourceType: p.resource_type,
			});
		}
	};

	const handleSelectInstance = (instance: Instance) => {
		setIsInstanceDialogOpen(false);
		resources.setRequestInstall(null);
		// Also update the global selection so the UI reflects the choice
		resources.setInstance(instance.id);

		const ctx = installContext();
		if (ctx) {
			handleInstall(ctx.version, instance);
			setInstallContext(null);
		} else {
			// This was a quick install from the header button
			const best = bestVersionForCurrent();
			if (best) {
				handleInstall(best, instance);
			}
		}
	};

	const renderedDescription = createMemo(() => {
		const desc = project()?.description;
		if (!desc) return "No description provided.";

		// Explicitly set marked options for each parse to ensure consistency
		const rawHtml = marked.parse(desc, {
			gfm: true,
			breaks: false, // Treat single newlines as spaces (Modrinth behavior)
		}) as string;

		// Ensure no links have target="_blank" which can cause them to open
		// in the system browser before our intercepted click handler runs.
		return rawHtml.replace(/target=["']_blank["']/gi, 'target="_self"');
	});

	return (
		<Show
			when={!loading() || project()}
			fallback={
				<div class={styles["loading-state"]}>
					<span class={styles["loading-spinner"]} />
					<p>Fetching project details...</p>
				</div>
			}
		>
			<Show
				when={!error()}
				fallback={
					<div class={styles["error-state"]}>
						<div class={styles["error-icon"]}>⚠️</div>
						<h2 class={styles["error-title"]}>Unable to load project</h2>
						<p class={styles["error-description"]}>{error()}</p>
						<div class={styles["error-actions"]}>
							<Button onClick={() => activeRouter()?.reload()}>
								Try Again
							</Button>
							<Button
								variant="ghost"
								onClick={() => activeRouter()?.backwards()}
							>
								Go Back
							</Button>
						</div>
					</div>
				}
			>
				<Show
					when={project()}
					fallback={<div class={styles["error-state"]}>Project not found.</div>}
				>
					<div
						class={styles["resource-details"]}
						classList={{ [styles["is-reloading"]]: loading() }}
					>
						<div class={styles["resource-details-header"]}>
							<div class={styles["project-header-info"]}>
								<Show when={project()?.icon_url}>
									<img
										src={project()?.icon_url ?? ""}
										alt={project()?.name}
										class={styles["project-icon"]}
									/>
								</Show>
								<div class={styles["project-header-text"]}>
									<div class={styles["project-title-row"]}>
										<div class={styles["project-title-group"]}>
											<h1 class={styles["project-title"]}>{project()?.name}</h1>
											<Show
												when={isProjectInstalled() || isProjectInstalling()}
											>
												<Badge variant="success">
													{isProjectInstalling()
														? "Installing..."
														: "Installed"}
												</Badge>
											</Show>
										</div>
										<div class={styles["header-link-group"]}>
											<Show when={peerProject()}>
												<div class={styles["source-toggle"]}>
													<button
														class={styles["source-btn"]}
														classList={{
															[styles.active]: project()?.source === "modrinth",
														}}
														onClick={() => {
															if (project()?.source === "modrinth") return;
															const peer = peerProject();
															if (peer && peer.source === "modrinth") {
																activeRouter()?.navigate("/resource-details", {
																	projectId: peer.id,
																	platform: "modrinth",
																	name: peer.name,
																	iconUrl: peer.icon_url,
																});
															}
														}}
													>
														Modrinth
													</button>
													<button
														class={styles["source-btn"]}
														classList={{
															[styles.active]:
																project()?.source === "curseforge",
														}}
														onClick={() => {
															if (project()?.source === "curseforge") return;
															const peer = peerProject();
															if (peer && peer.source === "curseforge") {
																activeRouter()?.navigate("/resource-details", {
																	projectId: peer.id,
																	platform: "curseforge",
																	name: peer.name,
																	iconUrl: peer.icon_url,
																});
															}
														}}
													>
														CurseForge
													</button>
												</div>
											</Show>
											<Button
												variant={isFollowing() ? "solid" : "outline"}
												size="sm"
												onClick={handleFollowToggle}
												class={styles["header-web-link"]}
												tooltip_text={
													isFollowing()
														? "Disable update notifications"
														: "Receive notifications for updates"
												}
											>
												<div
													style={{
														display: "flex",
														"align-items": "center",
														gap: "6px",
													}}
												>
													<BellIcon
														width="14"
														height="14"
														style={{
															fill: isFollowing() ? "currentColor" : "none",
															stroke: "currentColor",
														}}
													/>
													<span>{isFollowing() ? "Following" : "Follow"}</span>
												</div>
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => openExternal(project()?.web_url ?? "")}
												class={styles["header-web-link"]}
												tooltip_text={`View on ${project()?.source === "modrinth" ? "Modrinth" : "CurseForge"}`}
											>
												<div
													style={{
														display: "flex",
														"align-items": "center",
														gap: "6px",
													}}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="14"
														height="14"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
													>
														<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
														<polyline points="15 3 21 3 21 9"></polyline>
														<line x1="10" y1="14" x2="21" y2="3"></line>
													</svg>
													<span>Browser</span>
												</div>
											</Button>
										</div>
									</div>
									<div class={styles["project-subtitle-row"]}>
										<div class={styles["subtitle-left"]}>
											<p class={styles.author}>By {project()?.author}</p>
											<Show when={project()?.follower_count !== undefined}>
												<span class={styles["stat-item"]}>
													<HeartIcon />
													{project()?.follower_count.toLocaleString()}
												</span>
											</Show>
											<Show when={project()?.updated_at}>
												<span class={styles["stat-item"]}>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="14"
														height="14"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
													>
														<circle cx="12" cy="12" r="10"></circle>
														<polyline points="12 6 12 12 16 14"></polyline>
													</svg>
													Updated {formatDate(project()?.updated_at || "")}
												</span>
											</Show>
										</div>
										<div class={styles["header-instance-picker"]}>
											<Show
												when={!isModpack()}
												fallback={
													<div class={styles["modpack-instance-notice"]}>
														<span>
															Modpacks will create a new instance when installed
														</span>
													</div>
												}
											>
												<span class={styles["picker-label"]}>
													Target Instance:
												</span>
												<Select<any>
													options={[
														{ id: null, name: "No Instance" },
														...instancesState.instances,
													]}
													value={
														instancesState.instances.find(
															(i) =>
																i.id === resources.state.selectedInstanceId,
														) || { id: null, name: "No Instance" }
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
													<SelectTrigger
														class={styles["instance-select-header"]}
													>
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
																			{inst
																				? `${inst.name}`
																				: "Select instance..."}
																		</span>
																	</div>
																);
															}}
														</SelectValue>
													</SelectTrigger>
													<SelectContent />
												</Select>
											</Show>
											<div
												class={styles["header-action-row"]}
												style={{ "margin-top": "8px" }}
											>
												<Button
													size="sm"
													style={{ width: "100%" }}
													color={
														isUpdateAvailable()
															? "secondary"
															: isProjectInstalled()
																? "destructive"
																: isProjectIncompatible() &&
																		!isProjectInstalled()
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
															resources.state.selectedInstanceId !== null)
													}
												>
													<Show when={isProjectInstalling()}>
														<span>Installing...</span>
													</Show>
													<Show when={!isProjectInstalling()}>
														<Show when={isProjectInstalled()}>
															<Show
																when={isUpdateAvailable()}
																fallback={
																	<>
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
																			style={{ "margin-right": "8px" }}
																		>
																			<path d="M3 6h18"></path>
																			<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
																			<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
																		</svg>
																		<Show
																			when={confirmUninstall()}
																			fallback="Uninstall"
																		>
																			Confirm?
																		</Show>
																	</>
																}
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
																	style={{ "margin-right": "8px" }}
																>
																	<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
																	<polyline points="7 10 12 15 17 10"></polyline>
																	<line x1="12" y1="15" x2="12" y2="3"></line>
																</svg>
																Update
															</Show>
														</Show>
														<Show when={!isProjectInstalled()}>
															<Show
																when={isProjectIncompatible()}
																fallback={
																	<>
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
																			style={{ "margin-right": "8px" }}
																		>
																			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
																			<polyline points="7 10 12 15 17 10"></polyline>
																			<line
																				x1="12"
																				y1="15"
																				x2="12"
																				y2="3"
																			></line>
																		</svg>
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
									</div>
									<div class={styles["project-categories"]}>
										<For each={project()?.categories}>
											{(cat) => {
												// Find the category object in availableCategories if possible to get its real ID/Slug
												const categoryObj = createMemo(() =>
													resources.state.availableCategories.find(
														(c) =>
															c.name.toLowerCase() === cat.toLowerCase() ||
															c.id.toLowerCase() === cat.toLowerCase(),
													),
												);

												return (
													<Badge
														pill={true}
														clickable={true}
														variant="surface"
														onClick={() => {
															const p = project();
															if (p) {
																resources.setType(p.resource_type);
																resources.setSource(p.source);
															}
															resources.setQuery("");
															// Use the ID from the category object if found, otherwise fallback to the string
															const filterId = categoryObj()?.id || cat;
															resources.setCategories([filterId]);
															resources.setOffset(0);
															activeRouter()?.navigate("/resources");
														}}
													>
														{categoryObj()?.name || cat}
													</Badge>
												);
											}}
										</For>
									</div>
								</div>
							</div>
						</div>

						<div class={styles["resource-details-layout"]}>
							<div class={styles["resource-details-main"]}>
								<div class={styles["details-tabs"]}>
									<button
										class={styles["tab-btn"]}
										classList={{
											[styles.active]: activeTab() === "description",
										}}
										onClick={() =>
											activeRouter()?.updateQuery(
												"activeTab",
												"description",
												true,
											)
										}
									>
										Description
									</button>
									<button
										class={styles["tab-btn"]}
										classList={{ [styles.active]: activeTab() === "versions" }}
										onClick={() =>
											activeRouter()?.updateQuery("activeTab", "versions", true)
										}
									>
										Versions ({resources.state.versions.length})
									</button>
									<button
										class={styles["tab-btn"]}
										classList={{
											[styles.active]: activeTab() === "dependencies",
										}}
										onClick={() =>
											activeRouter()?.updateQuery(
												"activeTab",
												"dependencies",
												true,
											)
										}
									>
										Dependencies ({primaryVersion()?.dependencies?.length || 0})
									</button>
									<Show when={(project()?.gallery?.length ?? 0) > 0}>
										<button
											class={styles["tab-btn"]}
											classList={{ [styles.active]: activeTab() === "gallery" }}
											onClick={() =>
												activeRouter()?.updateQuery(
													"activeTab",
													"gallery",
													true,
												)
											}
										>
											Gallery ({project()?.gallery?.length})
										</button>
									</Show>
								</div>

								<div class={styles["tab-content"]}>
									<Show when={activeTab() === "description"}>
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
													// Only toggle if we clicked the spoiler container itself
													// (which acts as the header button) or if it's currently closed.
													if (
														target === spoiler ||
														!spoiler.classList.contains("is-visible")
													) {
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

									<Show when={activeTab() === "gallery"}>
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
									</Show>

									<Show when={activeTab() === "dependencies"}>
										<div class={styles["dependencies-tab"]}>
											<div class={styles["dependency-info-notice"]}>
												<span>Showing dependencies for version:</span>
												<Select<ResourceVersion>
													options={resources.state.versions}
													value={primaryVersion() || undefined}
													onChange={(v) => v && setManualVersionId(v.id)}
													optionValue="id"
													optionTextValue="version_number"
													placeholder="Select version..."
													itemComponent={(props) => (
														<SelectItem item={props.item}>
															<div class={styles["version-select-item"]}>
																<span class={styles["version-name"]}>
																	{props.item.rawValue.version_number}
																</span>
																<div class={styles["version-badges"]}>
																	<Badge
																		variant={
																			props.item.rawValue.release_type ===
																			"release"
																				? "success"
																				: props.item.rawValue.release_type ===
																						"beta"
																					? "warning"
																					: "error"
																		}
																	>
																		{props.item.rawValue.release_type}
																	</Badge>
																	<For
																		each={props.item.rawValue.loaders.slice(
																			0,
																			2,
																		)}
																	>
																		{(loader) => (
																			<Badge variant="info">{loader}</Badge>
																		)}
																	</For>
																</div>
															</div>
														</SelectItem>
													)}
												>
													<SelectTrigger
														class={styles["version-select-trigger"]}
													>
														<SelectValue<ResourceVersion>>
															{(s) =>
																s.selectedOption()?.version_number ||
																"Select version..."
															}
														</SelectValue>
													</SelectTrigger>
													<SelectContent />
												</Select>
											</div>

											<Show
												when={(primaryVersion()?.dependencies?.length ?? 0) > 0}
												fallback={
													<div class={styles["empty-state"]}>
														No dependencies listed for this version.
													</div>
												}
											>
												<div class={styles["dependency-groups"]}>
													{(() => {
														const deps = primaryVersion()?.dependencies || [];
														const required = deps.filter(
															(d) => d.dependency_type === "required",
														);
														const optional = deps.filter(
															(d) =>
																d.dependency_type === "optional" ||
																d.dependency_type === "embedded",
														);
														const incompatible = deps.filter(
															(d) => d.dependency_type === "incompatible",
														);

														const currentProject = project();
														if (!currentProject) return null;

														return (
															<>
																<Show when={required.length > 0}>
																	<div class={styles["dependency-group"]}>
																		<h3
																			class={`${styles["group-title"]} ${styles.required}`}
																		>
																			Required
																		</h3>
																		<div class={styles["dependency-list"]}>
																			<For each={required}>
																				{(dep) => (
																					<DependencyItem
																						router={activeRouter()}
																						dependency={dep}
																						platform={currentProject.source}
																						project={dependencyData()?.get(
																							dep.project_id,
																						)}
																					/>
																				)}
																			</For>
																		</div>
																	</div>
																</Show>

																<Show when={optional.length > 0}>
																	<div class={styles["dependency-group"]}>
																		<h3
																			class={`${styles["group-title"]} ${styles.optional}`}
																		>
																			Optional / Embedded
																		</h3>
																		<div class={styles["dependency-list"]}>
																			<For each={optional}>
																				{(dep) => (
																					<DependencyItem
																						router={activeRouter()}
																						dependency={dep}
																						platform={currentProject.source}
																						project={dependencyData()?.get(
																							dep.project_id,
																						)}
																					/>
																				)}
																			</For>
																		</div>
																	</div>
																</Show>

																<Show when={incompatible.length > 0}>
																	<div class={styles["dependency-group"]}>
																		<h3
																			class={`${styles["group-title"]} ${styles.incompatible}`}
																		>
																			Incompatible
																		</h3>
																		<div class={styles["dependency-list"]}>
																			<For each={incompatible}>
																				{(dep) => (
																					<DependencyItem
																						router={activeRouter()}
																						dependency={dep}
																						platform={currentProject.source}
																						project={dependencyData()?.get(
																							dep.project_id,
																						)}
																					/>
																				)}
																			</For>
																		</div>
																	</div>
																</Show>
															</>
														);
													})()}
												</div>
											</Show>
										</div>
									</Show>

									<Show when={activeTab() === "versions"}>
										<div class={styles["version-page"]}>
											<div class={styles["version-filters"]}>
												<input
													type="text"
													placeholder="Filter versions (e.g. 1.21.1, Fabric)..."
													value={versionFilter()}
													onInput={(e) => {
														setVersionFilter(e.currentTarget.value);
														setVersionPage(1);
													}}
													class={styles["version-search-input"]}
												/>
											</div>
											<div
												class={`${styles["version-list"]} ${styles["full-width"]}`}
											>
												<Show
													when={!resources.state.loading}
													fallback={<div>Loading versions...</div>}
												>
													<For each={paginatedVersions()}>
														{(version) => (
															<div class={styles["version-item"]}>
																<div class={styles["version-main-info"]}>
																	<span class={styles["version-name"]}>
																		{version.version_number}
																	</span>
																	<span class={styles["version-filename"]}>
																		{version.file_name}
																	</span>
																</div>

																<div class={styles["version-loaders-row"]}>
																	<div class={styles["meta-group"]}>
																		<span class={styles["meta-label"]}>
																			Versions
																		</span>
																		<VersionTags
																			versions={version.game_versions}
																		/>
																	</div>
																	<div class={styles["meta-group"]}>
																		<span class={styles["meta-label"]}>
																			Loaders
																		</span>
																		<div class={styles["version-meta"]}>
																			<For each={version.loaders}>
																				{(l) => (
																					<span
																						class={`${styles["meta-tag"]} ${styles["loader-tag"]}`}
																					>
																						{l}
																					</span>
																				)}
																			</For>
																		</div>
																	</div>
																</div>

																<div class={styles["version-actions"]}>
																	<span
																		class={`${styles["version-tag"]} ${styles[version.release_type]}`}
																	>
																		{version.release_type}
																	</span>
																	<Button
																		size="sm"
																		disabled={
																			isVersionInstalling(version.id) ||
																			(!!resources.state.selectedInstanceId &&
																				!isVersionInstalled(
																					version.id,
																					version.hash,
																				) &&
																				getCompatibility(version).type ===
																					"incompatible")
																		}
																		tooltip_text={(() => {
																			const instId =
																				resources.state.selectedInstanceId;
																			const comp = getCompatibility(version);

																			if (
																				instId &&
																				!isVersionInstalled(
																					version.id,
																					version.hash,
																				) &&
																				comp.type !== "compatible"
																			) {
																				return comp.reason;
																			}
																			if (isVersionInstalling(version.id))
																				return "Installation in progress";
																			if (
																				isVersionInstalled(
																					version.id,
																					version.hash,
																				)
																			)
																				return "Already installed - Click to remove";
																			if (!isModpack() && !instId)
																				return "Select an instance to install";
																			return version.download_url
																				? "Click to install"
																				: "External download required";
																		})()}
																		onClick={() => {
																			if (
																				isVersionInstalled(
																					version.id,
																					version.hash,
																				)
																			) {
																				if (confirmVersionId() !== version.id) {
																					setConfirmVersionId(version.id);
																					setTimeout(
																						() => setConfirmVersionId(null),
																						3000,
																					);
																					return;
																				}
																				handleUninstall();
																				setConfirmVersionId(null);
																			} else if (
																				getCompatibility(version).type !==
																				"incompatible"
																			) {
																				handleInstall(version);
																			}
																		}}
																		style={{ width: "100%" }}
																		variant={
																			isVersionInstalled(
																				version.id,
																				version.hash,
																			)
																				? "outline"
																				: version.download_url
																					? "solid"
																					: "outline"
																		}
																		color={(() => {
																			if (
																				isVersionInstalled(
																					version.id,
																					version.hash,
																				)
																			)
																				return "destructive";
																			const comp = getCompatibility(version);
																			if (comp.type === "warning")
																				return "warning";
																			if (comp.type === "incompatible")
																				return "none"; // Subdued
																			return undefined;
																		})()}
																	>
																		<Show
																			when={isVersionInstalling(version.id)}
																		>
																			Installing...
																		</Show>
																		<Show
																			when={!isVersionInstalling(version.id)}
																		>
																			<Show
																				when={isVersionInstalled(
																					version.id,
																					version.hash,
																				)}
																			>
																				<Show
																					when={
																						confirmVersionId() === version.id
																					}
																					fallback="Uninstall"
																				>
																					Confirm?
																				</Show>
																			</Show>
																			<Show
																				when={
																					!isVersionInstalled(
																						version.id,
																						version.hash,
																					)
																				}
																			>
																				<Show
																					when={
																						!isModpack() &&
																						!resources.state.selectedInstanceId
																					}
																				>
																					Select Instance
																				</Show>
																				<Show
																					when={
																						isModpack() ||
																						resources.state.selectedInstanceId
																					}
																				>
																					<Show
																						when={
																							getCompatibility(version).type ===
																							"incompatible"
																						}
																						fallback={
																							version.download_url
																								? "Install"
																								: "External"
																						}
																					>
																						{(() => {
																							const instId =
																								resources.state
																									.selectedInstanceId;
																							const inst =
																								instancesState.instances.find(
																									(i) => i.id === instId,
																								);
																							if (
																								(inst?.modloader?.toLowerCase() ===
																									"vanilla" ||
																									!inst?.modloader) &&
																								(project()?.resource_type ===
																									"mod" ||
																									project()?.resource_type ===
																										"shader")
																							) {
																								return "Unsupported";
																							}
																							return "Incompatible";
																						})()}
																					</Show>
																				</Show>
																			</Show>
																		</Show>
																	</Button>
																</div>
															</div>
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
																ellipsisComponent={() => <PaginationEllipsis />}
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
								</div>
							</div>

							<div class={styles["resource-details-sidebar"]}>
								<div class={styles["sidebar-scrollable-area"]}>
									<div class={styles["sidebar-section"]}>
										<h3 class={styles["sidebar-title"]}>Information</h3>
										<div class={styles["sidebar-metadata"]}>
											<div class={styles["meta-item"]}>
												<span class={styles["label"]}>Platform</span>
												<span
													class={`${styles["value"]} ${styles["capitalize"]}`}
												>
													{project()?.source}
												</span>
											</div>
											<div class={styles["meta-item"]}>
												<span class={styles["label"]}>Downloads</span>
												<span class={styles["value"]}>
													{project()?.download_count.toLocaleString()}
												</span>
											</div>
											<div class={styles["meta-item"]}>
												<span class={styles["label"]}>Type</span>
												<div class={styles["value-group"]}>
													<span
														class={`${styles["value"]} ${styles["capitalize"]}`}
													>
														{project()?.resource_type}
													</span>
													<Show
														when={
															project()?.categories?.some(
																(c) => c.toLowerCase() === "datapack",
															) && project()?.resource_type !== "datapack"
														}
													>
														<span
															class={`${styles["value"]} ${styles["capitalize"]}`}
														>
															, Datapack
														</span>
													</Show>
												</div>
											</div>
										</div>
									</div>

									<div class={styles["sidebar-section"]}>
										<div class={styles["sidebar-section-header"]}>
											<h3 class={styles["sidebar-title"]}>Recent Versions</h3>
											<button
												class={styles["view-all-link"]}
												onClick={() =>
													activeRouter()?.updateQuery(
														"activeTab",
														"versions",
														true,
													)
												}
											>
												View All
											</button>
										</div>
										<div class={styles["sidebar-version-list"]}>
											<Show
												when={!resources.state.loading}
												fallback={<div>Loading...</div>}
											>
												<For each={resources.state.versions.slice(0, 5)}>
													{(version) => (
														<div class={styles["sidebar-version-item"]}>
															<div class={styles["sidebar-version-top"]}>
																<span
																	class={styles["version-name"]}
																	title={version.version_number}
																>
																	{version.version_number}
																</span>
																<div class={styles["version-tags-mini"]}>
																	<span
																		class={`${styles["mini-tag"]} ${styles[version.release_type]}`}
																	>
																		{version.release_type
																			.charAt(0)
																			.toUpperCase()}
																	</span>
																	<For each={version.loaders.slice(0, 1)}>
																		{(l) => (
																			<span
																				class={`${styles["mini-tag"]} ${styles["loader"]}`}
																			>
																				{l}
																			</span>
																		)}
																	</For>
																</div>
															</div>
															<div class={styles["sidebar-version-meta"]}>
																<VersionTags versions={version.game_versions} />
															</div>
															<Button
																size="sm"
																disabled={
																	isVersionInstalling(version.id) ||
																	(!!resources.state.selectedInstanceId &&
																		!isVersionInstalled(
																			version.id,
																			version.hash,
																		) &&
																		getCompatibility(version).type ===
																			"incompatible")
																}
																color={(() => {
																	if (
																		isVersionInstalled(version.id, version.hash)
																	)
																		return "destructive";
																	const comp = getCompatibility(version);
																	if (comp.type === "warning") return "warning";
																	if (comp.type === "incompatible")
																		return "none";
																	return undefined;
																})()}
																tooltip_text={(() => {
																	const instId =
																		resources.state.selectedInstanceId;
																	const comp = getCompatibility(version);
																	if (
																		instId &&
																		!isVersionInstalled(
																			version.id,
																			version.hash,
																		) &&
																		comp.type !== "compatible"
																	) {
																		return comp.reason;
																	}
																	if (isVersionInstalling(version.id))
																		return "Installation in progress";
																	if (
																		isVersionInstalled(version.id, version.hash)
																	)
																		return "Already installed - Click to remove";
																	if (!isModpack() && !instId)
																		return "Select an instance to install";
																	return version.download_url
																		? "Click to install"
																		: "External download required";
																})()}
																onClick={() => {
																	if (
																		isVersionInstalled(version.id, version.hash)
																	) {
																		if (confirmVersionId() !== version.id) {
																			setConfirmVersionId(version.id);
																			setTimeout(
																				() => setConfirmVersionId(null),
																				3000,
																			);
																			return;
																		}
																		handleUninstall();
																		setConfirmVersionId(null);
																	} else {
																		handleInstall(version);
																	}
																}}
																style={{ width: "100%", "margin-top": "8px" }}
																variant={
																	isVersionInstalled(version.id, version.hash)
																		? "outline"
																		: version.download_url
																			? "solid"
																			: "outline"
																}
															>
																<Show when={isVersionInstalling(version.id)}>
																	Installing...
																</Show>
																<Show when={!isVersionInstalling(version.id)}>
																	<Show
																		when={isVersionInstalled(
																			version.id,
																			version.hash,
																		)}
																	>
																		<Show
																			when={confirmVersionId() === version.id}
																			fallback="Uninstall"
																		>
																			Confirm?
																		</Show>
																	</Show>
																	<Show
																		when={
																			!isVersionInstalled(
																				version.id,
																				version.hash,
																			)
																		}
																	>
																		<Show
																			when={
																				!isModpack() &&
																				!resources.state.selectedInstanceId
																			}
																		>
																			Select Instance
																		</Show>
																		<Show
																			when={
																				isModpack() ||
																				resources.state.selectedInstanceId
																			}
																		>
																			<Show
																				when={
																					getCompatibility(version).type ===
																					"incompatible"
																				}
																				fallback={
																					version.download_url
																						? "Install"
																						: "External"
																				}
																			>
																				{(() => {
																					const instId =
																						resources.state.selectedInstanceId;
																					const inst =
																						instancesState.instances.find(
																							(i) => i.id === instId,
																						);
																					if (
																						(inst?.modloader?.toLowerCase() ===
																							"vanilla" ||
																							!inst?.modloader) &&
																						(project()?.resource_type ===
																							"mod" ||
																							project()?.resource_type ===
																								"shader")
																					) {
																						return "Unsupported";
																					}
																					return "Incompatible";
																				})()}
																			</Show>
																		</Show>
																	</Show>
																</Show>
															</Button>
														</div>
													)}
												</For>
											</Show>
										</div>
									</div>
								</div>
							</div>
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
							<div class={styles["link-preview-statusBar"]}>
								{hoveredLink()}
							</div>
						</Show>
					</div>
					<InstanceSelectionDialog
						isOpen={isInstanceDialogOpen()}
						onClose={() => {
							setIsInstanceDialogOpen(false);
							resources.setRequestInstall(null);
						}}
						onSelect={handleSelectInstance}
						onCreateNew={handleCreateNew}
						project={project()}
						version={installContext()?.version}
						versions={resources.state.versions}
					/>
				</Show>
			</Show>
		</Show>
	);
};

export default ResourceDetailsPage;
