import { openMiniPage } from "@components/page-viewer/page-viewer";
import { SettingsField } from "@components/settings";
import {
	handleClearCache,
	handleOpenAppData,
	handleOpenLauncherLogs,
	handleOpenRuntimeStorageLocation,
} from "@stores/settings";
import { fetchStorageSnapshot, storageSnapshot, type StorageSnapshot } from "@stores/settings-cache";
import type { StorageInstanceSnapshot } from "@stores/settings-cache";
import LauncherButton from "@ui/button/button";
import buttonStyles from "@ui/button/button.module.css";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { formatBytes, formatPercent } from "@utils/format-bytes";
import { Component, createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import styles from "./storage-usage-viewer.module.css";

const MB = 1024 * 1024;

type StorageTab = "overview" | "instances" | "cache";

const CATEGORY_COLORS: Record<string, string> = {
	instances: "hsl(205 78% 56%)",
	"artifact-cache": "hsl(164 67% 42%)",
	"modpack-cache": "hsl(38 88% 54%)",
	"manifest-cache": "hsl(252 58% 66%)",
	"database-storage": "hsl(334 61% 58%)",
	"runtime-cache": "hsl(188 54% 47%)",
	"temp-files": "hsl(24 80% 56%)",
	logs: "hsl(215 12% 58%)",
};

const FALLBACK_COLORS = [
	"hsl(205 78% 56%)",
	"hsl(164 67% 42%)",
	"hsl(38 88% 54%)",
	"hsl(334 61% 58%)",
	"hsl(188 54% 47%)",
];

function categoryColor(id: string, index: number): string {
	return CATEGORY_COLORS[id] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
	let current = element?.parentElement ?? null;
	while (current) {
		const { overflowY } = getComputedStyle(current);
		if (overflowY === "auto" || overflowY === "scroll") {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}

interface BarItem {
	id: string;
	label: string;
	bytes: number;
	color: string;
}

interface BreakdownRowItem {
	id: string;
	label: string;
	description?: string | null;
	bytes: number;
	color?: string;
}

const StorageSegmentBar: Component<{
	items: BarItem[];
	totalBytes: number;
	activeId?: string | null;
	selectedId?: string | null;
	dimInactive?: boolean;
	onSelect?: (id: string) => void;
	onHover?: (id: string | null) => void;
}> = (props) => (
	<div
		class={styles["storage-bar"]}
		classList={{ [styles["storage-bar--dimmed"]]: props.dimInactive && props.activeId != null }}
		role="group"
		aria-label="Storage usage breakdown"
	>
		<For each={props.items}>
			{(item) => {
				const width = () =>
					props.totalBytes > 0
						? `${Math.max((item.bytes / props.totalBytes) * 100, item.bytes > 0 ? 2 : 0)}%`
						: "0%";
				const isSelected = () => props.selectedId === item.id;
				const isActive = () => props.activeId === item.id;
				return (
					<button
						type="button"
						class={styles["storage-segment"]}
						classList={{
							[styles["storage-segment--active"]]: isActive(),
						}}
						style={{
							width: width(),
							"background-color": item.color,
						}}
						title={`${item.label}: ${formatBytes(item.bytes)}`}
						aria-label={`${item.label}: ${formatBytes(item.bytes)}`}
						aria-pressed={isSelected()}
						aria-current={props.activeId === item.id ? "true" : undefined}
						onMouseEnter={() => props.onHover?.(item.id)}
						onMouseLeave={() => props.onHover?.(null)}
						onFocus={() => props.onHover?.(item.id)}
						onBlur={() => props.onHover?.(null)}
						onClick={(event) => {
							event.preventDefault();
							props.onSelect?.(item.id);
						}}
					/>
				);
			}}
		</For>
	</div>
);

const StorageBreakdownRow: Component<{
	item: BreakdownRowItem;
	totalBytes: number;
	active?: boolean;
	onSelect?: () => void;
	onHover?: (active: boolean) => void;
}> = (props) => (
	<button
		type="button"
		class={styles["storage-row"]}
		classList={{ [styles["storage-row--active"]]: props.active }}
		style={{ "--storage-row-color": props.item.color || "var(--accent-primary)" }}
		title={props.item.description || undefined}
		onClick={(event) => {
			event.preventDefault();
			props.onSelect?.();
		}}
		onMouseEnter={() => props.onHover?.(true)}
		onMouseLeave={() => props.onHover?.(false)}
		onFocus={() => props.onHover?.(true)}
		onBlur={() => props.onHover?.(false)}
	>
		<div class={styles["storage-row-main"]}>
			<Show when={props.item.color}>
				<div
					class={styles["storage-row-swatch"]}
					style={{ "background-color": props.item.color }}
				/>
			</Show>
			<div class={styles["storage-row-text"]}>
				<div class={styles["storage-row-label"]}>{props.item.label}</div>
				<Show when={props.item.description}>
					<div class={styles["storage-row-description"]}>
						{props.item.description}
					</div>
				</Show>
			</div>
		</div>
		<div class={styles["storage-row-size"]}>
			{formatBytes(props.item.bytes)}
			<Show when={props.totalBytes > 0}>
				{" · "}
				{formatPercent(props.item.bytes, props.totalBytes)}
			</Show>
		</div>
	</button>
);

function instanceBarItems(instances: StorageInstanceSnapshot[]): BarItem[] {
	return instances.map((instance, index) => ({
		id: String(instance.id),
		label: instance.name,
		bytes: instance.bytes,
		color: categoryColor(String(instance.id), index),
	}));
}

function instanceBreakdownItems(
	instances: StorageInstanceSnapshot[],
	selectedInstanceId: number | null,
): BreakdownRowItem[] {
	return instances.map((instance, index) => ({
		id: String(instance.id),
		label: instance.name,
		description: selectedInstanceId === instance.id ? instance.path : instance.slug,
		bytes: instance.bytes,
		color: categoryColor(String(instance.id), index),
	}));
}

export function StorageUsageViewer() {
	let viewerRef: HTMLDivElement | undefined;
	let editNavigationInFlight = false;

	const [snapshot, { mutate, refetch }] = storageSnapshot;
	const [cachedSnapshot, setCachedSnapshot] = createSignal<StorageSnapshot | undefined>();
	const [selectedCategoryId, setSelectedCategoryId] = createSignal<string | null>(null);
	const [selectedInstanceId, setSelectedInstanceId] = createSignal<number | null>(null);
	const [selectedCacheCategoryId, setSelectedCacheCategoryId] = createSignal<string | null>(null);
	const [hoveredCategoryId, setHoveredCategoryId] = createSignal<string | null>(null);
	const [hoveredInstanceId, setHoveredInstanceId] = createSignal<number | null>(null);
	const [hoveredCacheCategoryId, setHoveredCacheCategoryId] = createSignal<string | null>(null);
	const [activeTab, setActiveTab] = createSignal<StorageTab>("overview");
	const [isRefreshing, setIsRefreshing] = createSignal(false);

	const displaySnapshot = createMemo(() => cachedSnapshot() ?? snapshot());

	createEffect(() => {
		const current = snapshot();
		if (current) {
			setCachedSnapshot(current);
		}
	});

	onMount(() => {
		if (!snapshot() && !snapshot.loading) {
			void refetch();
		}
	});

	const restoreScroll = (scrollTop: number) => {
		requestAnimationFrame(() => {
			const scrollParent = findScrollParent(viewerRef ?? null);
			if (scrollParent) {
				scrollParent.scrollTop = scrollTop;
			}
		});
	};

	const handleRefresh = async (event?: MouseEvent) => {
		event?.preventDefault();
		event?.stopPropagation();

		const scrollParent = findScrollParent(viewerRef ?? null);
		const scrollTop = scrollParent?.scrollTop ?? 0;

		setIsRefreshing(true);
		try {
			if (hasTauriRuntime()) {
				const next = await fetchStorageSnapshot(true);
				setCachedSnapshot(next);
				mutate(next);
			} else {
				await refetch();
			}
		} finally {
			setIsRefreshing(false);
			restoreScroll(scrollTop);
		}
	};

	const setTab = (tab: StorageTab, event: MouseEvent) => {
		event.preventDefault();
		const scrollParent = findScrollParent(viewerRef ?? null);
		const scrollTop = scrollParent?.scrollTop ?? 0;
		setActiveTab(tab);
		restoreScroll(scrollTop);
	};

	const categories = createMemo(() =>
		(displaySnapshot()?.categories || [])
			.filter((category) => category.bytes > 0)
			.sort((a, b) => b.bytes - a.bytes),
	);

	const categoryColorMap = createMemo(() => {
		const map = new Map<string, string>();
		categories().forEach((category, index) => map.set(category.id, categoryColor(category.id, index)));
		return map;
	});

	const barItems = createMemo<BarItem[]>(() =>
		categories().map((category) => ({
			id: category.id,
			label: category.label,
			bytes: category.bytes,
			color: categoryColorMap().get(category.id) || categoryColor(category.id, 0),
		})),
	);

	const breakdownItems = createMemo<BreakdownRowItem[]>(() =>
		categories().map((category) => ({
			id: category.id,
			label: category.label,
			description: category.description,
			bytes: category.bytes,
			color: categoryColorMap().get(category.id) || categoryColor(category.id, 0),
		})),
	);

	const cacheCategories = createMemo(() =>
		categories().filter((category) => category.kind === "cache" || category.governedByArtifactLimit),
	);

	const cacheBarItems = createMemo<BarItem[]>(() =>
		cacheCategories().map((category) => ({
			id: category.id,
			label: category.label,
			bytes: category.bytes,
			color: categoryColorMap().get(category.id) || categoryColor(category.id, 0),
		})),
	);

	const cacheBreakdownItems = createMemo<BreakdownRowItem[]>(() =>
		cacheCategories().map((category) => ({
			id: category.id,
			label: category.label,
			description: category.governedByArtifactLimit
				? "Counted toward the artifact cache limit"
				: category.description,
			bytes: category.bytes,
			color: categoryColorMap().get(category.id) || categoryColor(category.id, 0),
		})),
	);

	const totalBytes = createMemo(() => displaySnapshot()?.totalBytes || 0);
	const instances = createMemo(() => displaySnapshot()?.instances || []);
	const instancesTotalBytes = createMemo(() => displaySnapshot()?.instancesTotalBytes || 0);
	const cacheTotalBytes = createMemo(() =>
		cacheCategories().reduce((sum, category) => sum + category.bytes, 0),
	);

	const artifactCacheBytes = createMemo(() => displaySnapshot()?.artifactCacheUsageBytes || 0);
	const artifactCacheOverLimitBytes = createMemo(
		() => displaySnapshot()?.artifactCacheOverLimitBytes || 0,
	);

	const cacheUsagePercent = createMemo(() => {
		const limit = displaySnapshot()?.artifactCacheLimitBytes || 0;
		const usage = artifactCacheBytes();
		if (limit <= 0 || usage <= 0) return 0;
		return Math.min(100, Math.round((usage / limit) * 100));
	});

	const activeCategoryId = createMemo(() => hoveredCategoryId() ?? selectedCategoryId());
	const activeInstanceId = createMemo(() => hoveredInstanceId() ?? selectedInstanceId());
	const activeCacheCategoryId = createMemo(() => hoveredCacheCategoryId() ?? selectedCacheCategoryId());

	const instanceItems = createMemo(() =>
		instanceBreakdownItems(instances(), activeInstanceId()),
	);

	const selectCategory = (id: string) => {
		setSelectedCategoryId(id);
	};

	const selectInstance = (instanceId: number) => {
		setSelectedInstanceId(instanceId);
	};

	const selectCacheCategory = (id: string) => {
		setSelectedCacheCategoryId(id);
	};

	const handleEditArtifactCacheLimit = (event: MouseEvent | KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (editNavigationInFlight) return;
		editNavigationInFlight = true;
		window.setTimeout(() => {
			editNavigationInFlight = false;
		}, 500);

		openMiniPage(
			"/config",
			{ activeTab: "general" },
			{
				focusArtifactCacheLimit: true,
				focusArtifactCacheLimitRequestId: Date.now(),
			},
		);
	};

	const isTabActive = (tab: StorageTab) => activeTab() === tab;

	return (
		<div ref={viewerRef} class={styles["storage-viewer"]}>
			<div class={styles["storage-summary-row"]}>
				<span class={styles["storage-summary-label"]}>Total used</span>
				<div class={styles["storage-summary-value"]}>
					<span>{formatBytes(totalBytes())}</span>
					<LauncherButton
						variant="outline"
						size="sm"
						disabled={isRefreshing()}
						onClick={(event) => void handleRefresh(event)}
					>
						{isRefreshing() ? "Refreshing…" : "Refresh"}
					</LauncherButton>
				</div>
			</div>

			<Show
				when={displaySnapshot()}
				fallback={<div class={styles["storage-empty"]}>Loading storage usage…</div>}
			>
				<div class={styles["storage-tabs"]}>
					<div class={styles["storage-tab-list"]} role="tablist" aria-label="Storage breakdown views">
						<button
							type="button"
							role="tab"
							class={styles["storage-tab"]}
							classList={{ [styles["storage-tab--active"]]: isTabActive("overview") }}
							aria-selected={isTabActive("overview")}
							onClick={(event) => setTab("overview", event)}
						>
							Overview
						</button>
						<button
							type="button"
							role="tab"
							class={styles["storage-tab"]}
							classList={{ [styles["storage-tab--active"]]: isTabActive("instances") }}
							aria-selected={isTabActive("instances")}
							onClick={(event) => setTab("instances", event)}
						>
							Instances
						</button>
						<button
							type="button"
							role="tab"
							class={styles["storage-tab"]}
							classList={{ [styles["storage-tab--active"]]: isTabActive("cache") }}
							aria-selected={isTabActive("cache")}
							onClick={(event) => setTab("cache", event)}
						>
							Cache
						</button>
					</div>

					<div class={styles["storage-panels"]}>
						<div
							role="tabpanel"
							class={styles["storage-panel"]}
							classList={{ [styles["storage-panel--hidden"]]: !isTabActive("overview") }}
							aria-hidden={!isTabActive("overview")}
						>
								<StorageSegmentBar
									items={barItems()}
									totalBytes={totalBytes()}
									activeId={activeCategoryId()}
									selectedId={selectedCategoryId()}
									dimInactive={activeCategoryId() != null}
									onSelect={selectCategory}
									onHover={setHoveredCategoryId}
								/>
							<div class={styles["storage-breakdown"]}>
								<For each={breakdownItems()}>
									{(item) => (
										<StorageBreakdownRow
											item={item}
											totalBytes={totalBytes()}
											active={activeCategoryId() === item.id}
											onSelect={() => selectCategory(item.id)}
											onHover={(active) => setHoveredCategoryId(active ? item.id : null)}
										/>
									)}
								</For>
							</div>
						</div>

						<div
							role="tabpanel"
							class={styles["storage-panel"]}
							classList={{ [styles["storage-panel--hidden"]]: !isTabActive("instances") }}
							aria-hidden={!isTabActive("instances")}
						>
							<Show
								when={instances().length > 0}
								fallback={
									<div class={styles["storage-empty"]}>
										No instances are currently tracked for storage breakdown.
									</div>
								}
							>
								<StorageSegmentBar
									items={instanceBarItems(instances())}
									totalBytes={instancesTotalBytes()}
									activeId={
										activeInstanceId() != null ? String(activeInstanceId()) : null
									}
									selectedId={
										selectedInstanceId() != null ? String(selectedInstanceId()) : null
									}
									dimInactive={activeInstanceId() != null}
									onSelect={(id) => selectInstance(Number(id))}
									onHover={(id) => setHoveredInstanceId(id == null ? null : Number(id))}
								/>
								<div class={styles["storage-breakdown"]}>
									<For each={instanceItems()}>
										{(item) => (
											<StorageBreakdownRow
												item={item}
												totalBytes={instancesTotalBytes()}
												active={activeInstanceId() === Number(item.id)}
												onSelect={() => selectInstance(Number(item.id))}
												onHover={(active) =>
													setHoveredInstanceId(active ? Number(item.id) : null)
												}
											/>
										)}
									</For>
								</div>
							</Show>
						</div>

						<div
							role="tabpanel"
							class={styles["storage-panel"]}
							classList={{ [styles["storage-panel--hidden"]]: !isTabActive("cache") }}
							aria-hidden={!isTabActive("cache")}
						>
							<Show when={cacheCategories().length > 0}>
								<StorageSegmentBar
									items={cacheBarItems()}
									totalBytes={cacheTotalBytes()}
									activeId={activeCacheCategoryId()}
									selectedId={selectedCacheCategoryId()}
									dimInactive={activeCacheCategoryId() != null}
									onSelect={selectCacheCategory}
									onHover={setHoveredCacheCategoryId}
								/>
								<div class={styles["storage-breakdown"]}>
									<For each={cacheBreakdownItems()}>
										{(item) => (
											<StorageBreakdownRow
												item={item}
												totalBytes={cacheTotalBytes()}
												active={activeCacheCategoryId() === item.id}
												onSelect={() => selectCacheCategory(item.id)}
												onHover={(active) =>
													setHoveredCacheCategoryId(active ? item.id : null)
												}
											/>
										)}
									</For>
								</div>
							</Show>

							<div class={styles["storage-cache-stats"]}>
								<div class={styles["storage-cache-stats-header"]}>
									<span class={styles["storage-cache-stats-label"]}>Artifact cache limit</span>
									<button
										type="button"
										class={`${buttonStyles["launcher-button"]} ${buttonStyles["launcher-button--ghost"]} ${buttonStyles["launcher-button--sm"]} ${styles["storage-cache-edit-button"]}`}
										onMouseDown={handleEditArtifactCacheLimit}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												handleEditArtifactCacheLimit(event);
											}
										}}
										title="Edit artifact cache limit"
									>
										<span class={styles["storage-cache-stats-value"]}>
											{formatBytes(artifactCacheBytes())} /{" "}
											{formatBytes(displaySnapshot()?.artifactCacheLimitBytes)} ·{" "}
											{cacheUsagePercent()}%
										</span>
										<span class={styles["storage-cache-edit-label"]} aria-hidden="true">
											Edit
										</span>
									</button>
								</div>
								<div class={styles["storage-cache-progress"]}>
									<div
										class={styles["storage-cache-progress-fill"]}
										style={{ width: `${cacheUsagePercent()}%` }}
									/>
								</div>
							</div>

							<Show when={artifactCacheOverLimitBytes() > 0}>
								<div class={styles["cache-note"]}>
									<span>
										Artifact cache is over limit by{" "}
										<strong>{formatBytes(artifactCacheOverLimitBytes())}</strong>.
										Vesta evicts least-recently-used artifacts that are not referenced by active
										installs.
									</span>
								</div>
							</Show>
						</div>
					</div>
				</div>

				<div class={styles["storage-actions"]}>
					<SettingsField
						label="Open App Data"
						description="Open the launcher configuration and data directory."
						actionLabel="Open"
						onAction={handleOpenAppData}
					/>
					<SettingsField
						label="Open Runtime Storage"
						description="Open runtime-managed cache files such as player heads and archive staging."
						actionLabel="Open"
						onAction={handleOpenRuntimeStorageLocation}
					/>
					<SettingsField
						label="Open Logs"
						description="Open the launcher diagnostic logs folder."
						actionLabel="Open"
						onAction={handleOpenLauncherLogs}
					/>
					<SettingsField
						label="Clear Cache"
						description="Remove cached metadata and temporary files. Installed instances are not affected."
						actionLabel="Clear"
						destructive
						confirmationDesc="This will clear cached metadata and temporary files. Installed instances will not be affected."
						onAction={handleClearCache}
					/>
				</div>
			</Show>
		</div>
	);
}
