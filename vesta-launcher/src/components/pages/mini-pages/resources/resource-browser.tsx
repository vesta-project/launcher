import { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { type Instance, instancesState } from "@stores/instances";
import { resources } from "@stores/resources";
import {
	Pagination,
	PaginationEllipsis,
	PaginationItem,
	PaginationItems,
	PaginationNext,
	PaginationPrevious,
} from "@ui/pagination/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select/select";
import { buildBrowseModpackInfo } from "@utils/modpack-prefill";
import { parseResourceUrl } from "@utils/resource-url";
import {
	batch,
	Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
	untrack,
} from "solid-js";
import InstanceSelectionDialog from "./instance-selection-dialog";
import styles from "./resource-browser.module.css";
import ResourceCard from "./resource-card";
import { ResourceSkeletonGrid } from "./resource-skeleton";
import { ResourceToolbar } from "./resource-toolbar";

const SORT_OPTIONS = {
	modrinth: [
		{ label: "Relevance", value: "relevance" },
		{ label: "Downloads", value: "downloads" },
		{ label: "Followers", value: "follows" },
		{ label: "Newest", value: "newest" },
		{ label: "Updated", value: "updated" },
	],
	curseforge: [
		{ label: "Featured", value: "featured" },
		{ label: "Popularity", value: "popularity" },
		{ label: "Last Updated", value: "updated" },
		{ label: "Newest", value: "newest" },
		{ label: "Rating", value: "rating" },
		{ label: "Name", value: "name" },
		{ label: "Author", value: "author" },
		{ label: "Total Downloads", value: "total_downloads" },
	],
};

const ResourceBrowser: Component<{
	setRefetch?: (fn: () => Promise<void>) => void;
	query?: string;
	resourceType?: any;
	gameVersion?: string;
	loader?: string;
	activeSource?: any;
	sortBy?: string;
	sortOrder?: string;
	showFilters?: boolean;
	categories?: string[];
	selectedInstanceId?: string;
	limit?: number;
	offset?: number;
	viewMode?: "grid" | "list";
	expandedCategoryGroups?: string[];
	router?: MiniRouter;
}> = (props) => {
	const activeRouter = createMemo(() => props.router || router());
	let debounceTimer: number | undefined;
	const [isInstanceDialogOpen, setIsInstanceDialogOpen] = createSignal(false);
	let lastWidth = window.innerWidth;
	let isInitializedFromProps = false;

	const currentSortOptions = createMemo(
		() => SORT_OPTIONS[resources.state.activeSource as keyof typeof SORT_OPTIONS] || [],
	);

	createEffect(() => {
		if (resources.state.requestInstallProject) {
			setIsInstanceDialogOpen(true);
		}
	});

	const handleSelectInstance = async (instance: Instance) => {
		const project = resources.state.requestInstallProject;
		const versions = resources.state.requestInstallVersions;
		if (!project) return;

		setIsInstanceDialogOpen(false);
		resources.setRequestInstall(null);

		try {
			const finalVersions =
				versions.length > 0 ? versions : await resources.getVersions(project.source, project.id);
			const bestVersion = await import("@stores/resources").then((m) =>
				m.findBestVersion(
					finalVersions,
					instance.minecraftVersion,
					instance.modloader,
					"release",
					project.resource_type,
				),
			);

			if (bestVersion) {
				await resources.install(project, bestVersion, instance.id);
			} else {
				const { showToast } = await import("@ui/toast/toast");
				showToast({
					title: "No compatible version",
					description: `Could not find a version for ${instance.minecraftVersion} with ${instance.modloader || "no loader"}.`,
					severity: "error",
				});
			}
		} catch (err) {
			const { showToast } = await import("@ui/toast/toast");
			showToast({
				title: "Installation failed",
				description: err instanceof Error ? err.message : String(err),
				severity: "error",
			});
		}
	};

	const handleCreateNew = () => {
		const project = resources.state.requestInstallProject;
		const versions = resources.state.requestInstallVersions;
		if (!project) return;

		setIsInstanceDialogOpen(false);
		resources.setRequestInstall(null);

		const prefilledModpackInfo =
			project.resource_type === "modpack"
				? buildBrowseModpackInfo(project, versions[0], {
						minecraftVersion: resources.state.gameVersion,
						loader: resources.state.loader,
					})
				: undefined;

		activeRouter()?.navigate(
			"/install",
			{
				projectId: project.id,
				platform: project.source,
				isModpack: project.resource_type === "modpack",
				resourceType: project.resource_type,
				projectName: project.name,
				projectIcon: project.icon_url || undefined,
				projectAuthor: project.author,
				initialVersion: versions[0]?.id,
				initialVersionNumber: versions[0]?.version_number,
				initialMinecraftVersion: resources.state.gameVersion || undefined,
				initialModloader: resources.state.loader || undefined,
				modpackUrl:
					project.resource_type === "modpack" ? versions[0]?.download_url || undefined : undefined,
			},
			prefilledModpackInfo
				? {
						prefilledModpackInfo,
						prefetchedModpackVersions: versions.length > 0 ? versions : undefined,
					}
				: {
						pendingResourceProject: project,
						pendingResourceVersion: versions[0],
					},
		);
	};

	const handleSearchInput = (value: string) => {
		const parsed = parseResourceUrl(value);
		if (parsed) {
			activeRouter()?.navigate("/resource-details", {
				projectId: parsed.id,
				platform: parsed.platform,
				activeTab: parsed.activeTab,
			});
			resources.setQuery("");
			return;
		}

		resources.setQuery(value);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = window.setTimeout(async () => {
			resources.setOffset(0);
			await resources.search();

			untrack(() => {
				const currentRouterQuery = activeRouter()?.currentParams.get().query;
				if (resources.state.query === value && currentRouterQuery !== value) {
					activeRouter()?.updateQuery("query", value);
				}
			});
		}, 500);
	};

	onMount(() => {
		batch(() => {
			if (props.query !== undefined) {
				resources.setQuery(props.query);
				isInitializedFromProps = true;
			}
			if (props.resourceType !== undefined) {
				resources.setType(props.resourceType);
				isInitializedFromProps = true;
			}
			if (props.gameVersion !== undefined) {
				resources.setGameVersion(props.gameVersion === "All versions" ? null : props.gameVersion);
				isInitializedFromProps = true;
			}
			if (props.loader !== undefined) {
				resources.setLoader(props.loader === "All Loaders" ? null : props.loader);
				isInitializedFromProps = true;
			}
			if (props.activeSource !== undefined) {
				resources.setSource(props.activeSource);
				isInitializedFromProps = true;
			}
			if (props.sortBy !== undefined) {
				resources.setSortBy(props.sortBy);
				isInitializedFromProps = true;
			}
			if (props.sortOrder !== undefined) {
				resources.setSortOrder(props.sortOrder as any);
				isInitializedFromProps = true;
			}
			if (props.showFilters !== undefined && props.showFilters !== resources.state.showFilters) {
				resources.toggleFilters();
				isInitializedFromProps = true;
			}
			if (props.categories !== undefined) {
				resources.setCategories(props.categories);
				isInitializedFromProps = true;
			}
			if (props.selectedInstanceId !== undefined) {
				resources.setInstance(
					props.selectedInstanceId ? parseInt(props.selectedInstanceId as any) : null,
				);
				isInitializedFromProps = true;
			}
			if (props.limit !== undefined) {
				resources.setLimit(props.limit);
				isInitializedFromProps = true;
			}
			if (props.offset !== undefined) {
				resources.setOffset(props.offset);
				isInitializedFromProps = true;
			}
			if (props.viewMode !== undefined) {
				resources.setViewMode(props.viewMode);
				isInitializedFromProps = true;
			}
			if (props.expandedCategoryGroups !== undefined) {
				resources.setExpandedCategoryGroups(props.expandedCategoryGroups);
				isInitializedFromProps = true;
			}
		});

		activeRouter()?.registerStateProvider("/resources", () => ({
			query: resources.state.query,
			resourceType: resources.state.resourceType,
			gameVersion: resources.state.gameVersion,
			loader: resources.state.loader,
			activeSource: resources.state.activeSource,
			sortBy: resources.state.sortBy,
			sortOrder: resources.state.sortOrder,
			showFilters: resources.state.showFilters,
			categories: [...resources.state.categories],
			selectedInstanceId: resources.state.selectedInstanceId,
			limit: resources.state.limit,
			offset: resources.state.offset,
			viewMode: resources.state.viewMode,
			expandedCategoryGroups: [...resources.state.expandedCategoryGroups],
		}));

		if (props.setRefetch) {
			props.setRefetch(async () => {
				await resources.search();
			});
		}

		const handleResize = () => {
			const width = window.innerWidth;
			lastWidth = width;
		};
		handleResize();
		window.addEventListener("resize", handleResize);
		onCleanup(() => window.removeEventListener("resize", handleResize));

		if (resources.state.selectedInstanceId) {
			resources.fetchInstalled(resources.state.selectedInstanceId);
		}
		resources.fetchCategories();
	});

	let hasInitializedFilters = false;

	createEffect(() => {
		const instances = instancesState.instances;
		const selectedId = resources.state.selectedInstanceId;
		const currentVersion = resources.state.gameVersion;

		if (
			!hasInitializedFilters &&
			!isInitializedFromProps &&
			instances.length > 0 &&
			selectedId &&
			!currentVersion
		) {
			hasInitializedFilters = true;
			untrack(() => {
				const inst = instances.find((i) => i.id === selectedId);
				if (inst) {
					resources.setGameVersion(inst.minecraftVersion);
					if (resources.state.resourceType === "mod") {
						const loader = inst.modloader?.toLowerCase();
						if (loader && loader !== "vanilla") {
							resources.setLoader(inst.modloader);
						}
					}
				}
			});
		}
	});

	createEffect(() => {
		resources.state.activeSource;
		resources.state.resourceType;
		resources.state.gameVersion;
		resources.state.loader;
		resources.state.categories;
		resources.state.sortBy;
		resources.state.sortOrder;
		resources.state.limit;
		resources.state.offset;
		const reconciling = resources.state.reconcilingCategories;

		if (reconciling) return;

		untrack(() => {
			void resources.search();
		});
	});

	const currentPage = () => Math.floor(resources.state.offset / resources.state.limit) + 1;
	const totalPages = () => Math.ceil(resources.state.totalHits / resources.state.limit);

	return (
		<div class={styles["resource-browser"]}>
			<ResourceToolbar
				router={activeRouter()}
				onSearchInput={handleSearchInput}
				searchValue={resources.state.query}
			/>

			<div class={styles["resource-results-info"]}>
				<div class={styles["results-stats"]}>
					<Show when={resources.state.totalHits > 0}>
						Showing {resources.state.totalHits.toLocaleString()} results
					</Show>
				</div>
				<div class={styles["results-sort"]}>
					<div class={styles["limit-selector"]}>
						<span class={styles["sort-label"]}>Per Page:</span>
						<Select
							options={[20, 50, 100]}
							value={resources.state.limit}
							onChange={(v: number | null) => resources.setLimit(v || 20)}
							itemComponent={(p) => <SelectItem item={p.item}>{p.item.rawValue}</SelectItem>}
						>
							<SelectTrigger class={styles["limit-select-trigger"]}>
								<SelectValue<number>>{(s) => s.selectedOption()}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>

					<div class={styles["sort-selector-wrapper"]}>
						<span class={styles["sort-label"]}>Sort By:</span>
						<Select<{ label: string; value: string }>
							options={currentSortOptions()}
							optionValue="value"
							optionTextValue="label"
							value={
								currentSortOptions().find((o) => o.value === resources.state.sortBy) ||
								currentSortOptions()[0]
							}
							onChange={(val) => {
								if (!val) return;
								batch(() => {
									const sval = val.value || "relevance";
									resources.setSortBy(sval);
									resources.setOffset(0);
									activeRouter()?.updateQuery("sortBy", sval);
								});
							}}
							itemComponent={(p) => <SelectItem item={p.item}>{p.item.rawValue.label}</SelectItem>}
						>
							<SelectTrigger class={styles["sort-select-trigger"]}>
								<SelectValue<any>>{(s) => s.selectedOption()?.label || "Sort By..."}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>
					<Show when={resources.state.activeSource === "curseforge"}>
						<button
							class={styles["sort-direction-btn"]}
							onClick={() => {
								resources.toggleSortOrder();
								resources.setOffset(0);
							}}
							title={resources.state.sortOrder === "asc" ? "Ascending" : "Descending"}
						>
							{resources.state.sortOrder === "asc" ? "↑" : "↓"}
						</button>
					</Show>

					<div class={styles["view-toggle"]}>
						<button
							class={styles["view-btn"]}
							classList={{ [styles.active]: resources.state.viewMode === "list" }}
							onClick={() => resources.setViewMode("list")}
							title="List View"
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
								<line x1="8" y1="6" x2="21" y2="6" />
								<line x1="8" y1="12" x2="21" y2="12" />
								<line x1="8" y1="18" x2="21" y2="18" />
								<line x1="3" y1="6" x2="3.01" y2="6" />
								<line x1="3" y1="12" x2="3.01" y2="12" />
								<line x1="3" y1="18" x2="3.01" y2="18" />
							</svg>
						</button>
						<button
							class={styles["view-btn"]}
							classList={{ [styles.active]: resources.state.viewMode === "grid" }}
							onClick={() => resources.setViewMode("grid")}
							title="Grid View"
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
								<rect x="3" y="3" width="7" height="7" />
								<rect x="14" y="3" width="7" height="7" />
								<rect x="14" y="14" width="7" height="7" />
								<rect x="3" y="14" width="7" height="7" />
							</svg>
						</button>
					</div>
				</div>
			</div>

			<Show when={resources.state.searchWarning}>
				<div class={styles["resource-warning"]}>{resources.state.searchWarning}</div>
			</Show>

			<div class={styles["resource-results"]}>
				<Show
					when={!resources.state.loading}
					fallback={<ResourceSkeletonGrid count={6} viewMode={resources.state.viewMode} />}
				>
					<Show
						when={!resources.state.searchError}
						fallback={
							<div class={styles["error-state"]}>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="32"
									height="32"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<circle cx="12" cy="12" r="10" />
									<line x1="12" y1="8" x2="12" y2="12" />
									<line x1="12" y1="16" x2="12.01" y2="16" />
								</svg>
								<h3>Search failed</h3>
								<p>{resources.state.searchError}</p>
								<button class={styles["empty-state-action"]} onClick={() => resources.search()}>
									Try Again
								</button>
							</div>
						}
					>
						<Show
							when={resources.state.results.length > 0}
							fallback={
								<div class={styles["empty-state"]}>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="32"
										height="32"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="11" cy="11" r="8" />
										<line x1="21" y1="21" x2="16.65" y2="16.65" />
									</svg>
									<h3>No resources found</h3>
									<p>Try adjusting your search query or filters.</p>
									<Show
										when={
											resources.state.query ||
											resources.state.categories.length > 0 ||
											resources.state.gameVersion ||
											resources.state.loader
										}
									>
										<button
											class={styles["empty-state-action"]}
											onClick={() => {
												resources.resetFilters();
											}}
										>
											Clear all filters
										</button>
									</Show>
								</div>
							}
						>
							<div
								class={
									resources.state.viewMode === "grid" ? styles["resource-grid"] : styles["resource-list"]
								}
							>
								<For each={resources.state.results}>
									{(project) => (
										<ResourceCard
											project={project}
											viewMode={resources.state.viewMode}
											router={activeRouter()}
										/>
									)}
								</For>
							</div>

							<Show when={totalPages() > 1}>
								<div class={styles["resource-browser-pagination"]}>
									<Pagination
										count={totalPages()}
										page={currentPage()}
										onPageChange={resources.setPage}
										class={styles.pagination}
										itemComponent={(p) => (
											<PaginationItem page={p.page} class={styles["pagination-item"]}>
												{p.page}
											</PaginationItem>
										)}
										ellipsisComponent={() => <PaginationEllipsis class={styles["pagination-ellipsis"]} />}
									>
										<PaginationPrevious class={styles["pagination-prev"]}>Prev</PaginationPrevious>
										<PaginationItems />
										<PaginationNext class={styles["pagination-next"]}>Next</PaginationNext>
									</Pagination>
								</div>
							</Show>
						</Show>
					</Show>
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
				project={resources.state.requestInstallProject ?? undefined}
				versions={resources.state.requestInstallVersions}
			/>
		</div>
	);
};

export default ResourceBrowser;
