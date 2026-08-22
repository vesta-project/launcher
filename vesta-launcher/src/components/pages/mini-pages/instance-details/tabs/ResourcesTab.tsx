import ReloadIcon from "@assets/icons/actions/reload.svg";
import PlusIcon from "@assets/icons/actions/add.svg";
import RightArrowIcon from "@assets/icons/navigation/arrow-forward.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import TrashIcon from "@assets/icons/actions/delete.svg";
import CloseIcon from "@assets/icons/actions/close.svg";
import DownloadIcon from "@assets/icons/actions/download.svg";
import MoreIcon from "@assets/icons/content/ellipsis-v.svg";
import { flexRender } from "@tanstack/solid-table";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ui/dropdown-menu/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { Skeleton } from "@ui/skeleton/skeleton";
import {
	createContainerQuery,
	RESOURCES_FILTER_COMPACT_WIDTH,
	RESOURCES_TABLE_COMPACT_WIDTH,
} from "@utils/media-query";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	Show,
} from "solid-js";
import styles from "../instance-details.module.css";
import { t } from "~/localization";

const FILTER_OPTIONS = [
	{ id: "All", messageId: "instances-details-resources-filter-all" },
	{ id: "mod", messageId: "instances-details-resources-filter-mods" },
	{ id: "resourcepack", messageId: "instances-details-resources-filter-packs" },
	{ id: "shader", messageId: "instances-details-resources-filter-shaders" },
] as const;

const getFilterLabel = (id: string) => {
	const option = FILTER_OPTIONS.find((entry) => entry.id === id);
	return option ? t(option.messageId) : t("instances-details-resources-filter-all");
};

const getBundledTypeLabel = (filterId: string) => {
	if (filterId === "All") return t("instances-details-resources-type-resources");
	const option = FILTER_OPTIONS.find((entry) => entry.id === filterId);
	return option
		? t(option.messageId).toLowerCase()
		: t("instances-details-resources-type-resources");
};

const COLUMN_WIDTHS: Record<string, string | undefined> = {
	select: "48px",
	display_name: undefined,
	current_version: "84px",
	is_enabled: "56px",
	actions: "68px",
};

const RESOURCE_ROW_OVERSCAN = 40;

const COLUMN_CLASS: Record<string, string> = {
	select: "col-select",
	display_name: "col-display_name",
	current_version: "col-current_version",
	is_enabled: "col-is_enabled",
	actions: "col-actions",
};

function getColumnClass(columnId: string): string | undefined {
	const key = COLUMN_CLASS[columnId];
	return key ? styles[key] : undefined;
}

interface ResourcesTabProps {
	instance: any;
	resourceTypeFilter: string;
	setResourceTypeFilter: (type: string) => void;
	table: any;
	resourcesStore: any;
	installedResources: any;
	modpackResources: any[];
	modpackIcon: () => string | null;
	modpackExpanded: boolean;
	setModpackExpanded: (expanded: boolean) => void;
	currentModpackVersion: any;
	availableModpackUpdate: any;
	router: any;
	handleBatchUpdate: () => void;
	handleBatchDelete: () => void;
	onManageModpackVersions: () => void;
	onUnlinkModpack: () => void;
	onDeleteModpackAndUnlink: () => void;
	onRowClick: (row: any, event: MouseEvent) => void;
	resourceSearch: string;
	setResourceSearch: (v: string) => void;
	selectedToUpdateCount: number;
	busy: boolean;
	checkingUpdates: boolean;
	checkUpdates: () => void;
	onCompactChange?: (compact: boolean) => void;
}

export const ResourcesTab = (props: ResourcesTabProps) => {
	const selectionCount = () =>
		Object.values(props.resourcesStore.state.selection).filter((v) => v).length;
	const isModpackOwnedResource = (resource: any) =>
		(resource?.source_kind || "custom").toLowerCase() === "modpack";
	const sortedRows = createMemo(() => props.table.getRowModel().rows);
	const modpackRows = createMemo(() =>
		sortedRows().filter((row: any) => isModpackOwnedResource(row.original)),
	);
	const customRows = createMemo(() =>
		sortedRows().filter((row: any) => !isModpackOwnedResource(row.original)),
	);
	const visibleResourceRows = createMemo(() => {
		if (!props.instance?.modpackId) return sortedRows();
		return props.modpackExpanded
			? [...modpackRows(), ...customRows()]
			: customRows();
	});
	const installedResourceList = createMemo(() =>
		Array.isArray(props.installedResources.latest)
			? props.installedResources.latest
			: [],
	);
	const installedModpackResources = createMemo(() =>
		installedResourceList().filter(isModpackOwnedResource),
	);
	const hasManualResources = createMemo(() =>
		installedResourceList().some(
			(resource: any) => !isModpackOwnedResource(resource),
		),
	);
	const bundledCountLabel = createMemo(() =>
		t("instances-details-resources-bundled-count", {
			count: modpackRows().length,
			type: getBundledTypeLabel(props.resourceTypeFilter),
		}),
	);
	let appliedDefaultExpansionKey = "";

	const renderResourceRow = (
		row: any,
		options?: {
			hidden?: () => boolean;
			virtualIndex?: number;
			measure?: (element: HTMLTableRowElement) => void;
		},
	) => (
		<tr
			ref={(element) => {
				// Solid invokes refs before applying JSX attributes. TanStack reads
				// data-index synchronously, so seed it before measurement.
				if (options?.virtualIndex !== undefined) {
					element.dataset.index = String(options.virtualIndex);
				}
				if (options?.measure) {
					queueMicrotask(() => options.measure?.(element));
				}
			}}
			data-index={options?.virtualIndex}
			onClick={(e) => props.onRowClick(row, e)}
			style={{ cursor: "default" }}
			hidden={options?.hidden?.()}
			aria-hidden={options?.hidden?.() ? "true" : undefined}
			classList={{
				[styles["row-selected"]]: row.getIsSelected(),
				[styles["row-disabled"]]: !row.original.is_enabled,
				[styles["row-modpack-child"]]: isModpackOwnedResource(row.original),
				[styles["row-modpack-child-hidden"]]:
					isModpackOwnedResource(row.original) && !!options?.hidden?.(),
				[styles["row-modpack-child-expanded"]]:
					isModpackOwnedResource(row.original) && !options?.hidden?.(),
			}}
		>
			<For each={row.getVisibleCells()}>
				{(cell) => (
					<td class={getColumnClass(cell.column.id)}>
						{flexRender(cell.column.columnDef.cell, cell.getContext())}
					</td>
				)}
			</For>
		</tr>
	);

	const renderModpackGroupCell = (columnId: string) => {
		switch (columnId) {
			case "select":
				return (
					<div class={styles["modpack-group-disclosure"]}>
						<RightArrowIcon
							class={styles["modpack-group-chevron"]}
							data-expanded={props.modpackExpanded}
						/>
					</div>
				);
			case "display_name":
				return (
					<div class={styles["modpack-group-name"]}>
						<ResourceAvatar
							icon={props.modpackIcon()}
							name={
								props.instance?.name ||
								t("instances-details-resources-linked-modpack")
							}
							class={styles["modpack-group-icon"]}
						/>
						<div class={styles["modpack-group-copy"]}>
							<span class={styles["modpack-group-title"]}>
								{props.instance?.name ||
									t("instances-details-resources-linked-modpack")}
							</span>
							<span class={styles["modpack-group-meta"]}>
								{bundledCountLabel()}
								<Show when={props.availableModpackUpdate}>
									<>
										{" • "}
										<button
											type="button"
											class={styles["update-available-link"]}
											title={props.availableModpackUpdate?.version_number}
											onClick={(event: MouseEvent) => {
												event.stopPropagation();
												props.onManageModpackVersions();
											}}
										>
											{t("instances-details-resources-update-available")}
										</button>
									</>
								</Show>
							</span>
						</div>
					</div>
				);
			case "current_version":
				return (
					<div class={styles["modpack-group-version"]}>
						<span>
							{props.currentModpackVersion?.version_number ||
								props.instance?.modpackVersionId ||
								t("instances-details-resources-current-version")}
						</span>
					</div>
				);
			case "actions":
				return (
					<div class={styles["row-actions-cell"]}>
						<div class={styles["row-actions-update-slot"]} />
						<div class={styles["row-actions-menu-slot"]}>
							<DropdownMenu>
								<DropdownMenuTrigger
									as="button"
									class={styles["row-actions-trigger-button"]}
									onClick={(event: MouseEvent) => event.stopPropagation()}
								>
									<MoreIcon width="16" height="16" />
								</DropdownMenuTrigger>
								<DropdownMenuContent>
									<DropdownMenuItem
										onSelect={props.onManageModpackVersions}
										disabled={props.busy}
									>
										{t("instances-details-resources-manage-versions")}
									</DropdownMenuItem>
									<DropdownMenuItem
										onSelect={props.onUnlinkModpack}
										disabled={props.busy}
									>
										{t("instances-details-resources-unlink")}
									</DropdownMenuItem>
									<DropdownMenuSeparator
										class={styles["row-actions-separator"]}
									/>
									<DropdownMenuItem
										onSelect={props.onDeleteModpackAndUnlink}
										disabled={props.busy || props.modpackResources.length === 0}
										class={styles["row-actions-delete"]}
									>
										<TrashIcon
											style={{
												width: "14px",
												height: "14px",
												"margin-right": "8px",
												flex: "0 0 auto",
											}}
										/>
										{t("instances-details-resources-delete-unlink")}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				);
			default:
				return <span class={styles["modpack-group-empty"]} />;
		}
	};

	const [panelRef, setPanelRef] = createSignal<HTMLElement | undefined>();
	let tableScrollElement: HTMLDivElement | undefined;
	const [observedScrollOffset, setObservedScrollOffset] = createSignal(0);
	const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>(
		{
			get count() {
				return visibleResourceRows().length;
			},
			getScrollElement: () => tableScrollElement ?? null,
			estimateSize: () => 49,
			initialRect: { width: 1000, height: 600 },
			overscan: RESOURCE_ROW_OVERSCAN,
			getItemKey: (index) => visibleResourceRows()[index]?.id ?? index,
		},
	);
	const virtualRows = createMemo(() => {
		const measuredRows = rowVirtualizer.getVirtualItems();
		const scrollOffset = observedScrollOffset();
		const expectedIndex = Math.min(
			Math.max(0, visibleResourceRows().length - 1),
			Math.floor(scrollOffset / 49),
		);
		if (
			scrollOffset > 0 &&
			!measuredRows.some((row) => row.index === expectedIndex)
		) {
			// Resize/scroll observers are asynchronous and are absent in some webviews
			// and DOM test harnesses. Keep the mounted range deterministic until the
			// virtualizer catches up, without weakening row virtualization.
			const viewportHeight = tableScrollElement?.clientHeight || 600;
			const start = Math.max(0, expectedIndex - RESOURCE_ROW_OVERSCAN);
			const end = Math.min(
				visibleResourceRows().length,
				expectedIndex + Math.ceil(viewportHeight / 49) + RESOURCE_ROW_OVERSCAN,
			);
			return Array.from({ length: end - start }, (_, offset) => {
				const index = start + offset;
				return {
					key: visibleResourceRows()[index]?.id ?? index,
					index,
					start: index * 49,
					end: (index + 1) * 49,
					size: 49,
					lane: 0,
				};
			});
		}
		if (measuredRows.length > 0) return measuredRows;

		// Keep first paint deterministic before ResizeObserver reports the scroll
		// viewport (and in non-layout test environments).
		return Array.from(
			{ length: Math.min(25, visibleResourceRows().length) },
			(_, index) => ({
				key: visibleResourceRows()[index]?.id ?? index,
				index,
				start: index * 49,
				end: (index + 1) * 49,
				size: 49,
				lane: 0,
			}),
		);
	});
	const topVirtualPadding = createMemo(() => virtualRows()[0]?.start ?? 0);
	const bottomVirtualPadding = createMemo(() => {
		const rows = virtualRows();
		const last = rows[rows.length - 1];
		return last ? Math.max(0, rowVirtualizer.getTotalSize() - last.end) : 0;
	});
	createEffect(
		on(
			() => [props.resourceTypeFilter, props.resourceSearch] as const,
			() => {
				if (!tableScrollElement) return;
				tableScrollElement.scrollTop = 0;
				tableScrollElement.dispatchEvent(new Event("scroll"));
			},
			{ defer: true },
		),
	);
	const isCompactTable = createContainerQuery(
		panelRef,
		RESOURCES_TABLE_COMPACT_WIDTH,
	);
	const isFilterCompact = createContainerQuery(
		panelRef,
		RESOURCES_FILTER_COMPACT_WIDTH,
	);

	createEffect(() => {
		props.onCompactChange?.(isCompactTable());
	});

	createEffect(() => {
		if (!props.instance?.modpackId || !props.installedResources.latest) {
			appliedDefaultExpansionKey = "";
			return;
		}

		const key = `${props.instance?.id ?? "unknown"}:${installedResourceList()
			.map((resource: any) => resource.id)
			.join(",")}`;
		if (appliedDefaultExpansionKey === key) return;
		appliedDefaultExpansionKey = key;

		const shouldExpandByDefault =
			installedModpackResources().length > 0 && !hasManualResources();
		props.setModpackExpanded(shouldExpandByDefault);
	});

	const handleSearchInput = (e: InputEvent) => {
		const target = e.currentTarget as HTMLInputElement;
		props.setResourceSearch(target.value);
	};

	const setModpackExpanded = (expanded: boolean) => {
		props.setModpackExpanded(expanded);
	};

	return (
		<section ref={setPanelRef} class={styles["tab-resources"]}>
			<div class={styles["resources-toolbar-shell"]}>
				<div class={styles["resources-toolbar"]}>
					<div class={styles["toolbar-search-filter"]}>
						<Show when={!isFilterCompact()}>
							<div class={styles["filter-group"]}>
								<For each={FILTER_OPTIONS}>
									{(option) => (
										<button
											class={styles["filter-btn"]}
											classList={{
												[styles.active]: props.resourceTypeFilter === option.id,
											}}
											onClick={() => props.setResourceTypeFilter(option.id)}
										>
											{getFilterLabel(option.id)}
										</button>
									)}
								</For>
							</div>
						</Show>

						<Show when={isFilterCompact()}>
							<div class={styles["mobile-filter-select"]}>
								<Select
									value={props.resourceTypeFilter}
									onChange={(val: string | null) => {
										if (val !== null) props.setResourceTypeFilter(val);
									}}
									options={FILTER_OPTIONS.map((o) => o.id)}
									itemComponent={(p) => (
										<SelectItem item={p.item}>
											{getFilterLabel(p.item.rawValue)}
										</SelectItem>
									)}
								>
									<SelectTrigger>
										<SelectValue<string>>
											{(state) => getFilterLabel(state.selectedOption())}
										</SelectValue>
									</SelectTrigger>
									<SelectContent />
								</Select>
							</div>
						</Show>

						<div class={styles["resources-search"]}>
							<div class={styles["search-input-wrapper"]}>
								<SearchIcon class={styles["search-icon"]} />
								<input
									type="text"
									placeholder={t(
										"instances-details-resources-search-placeholder",
									)}
									value={props.resourceSearch}
									onInput={handleSearchInput}
								/>
							</div>
						</div>
					</div>

					<div class={styles["toolbar-lower-wrapper"]}>
						<div
							class={styles["toolbar-actions"]}
							classList={{
								[styles["toolbar-actions-hidden"]]: selectionCount() > 0,
							}}
						>
							<Button
								size="sm"
								variant="ghost"
								icon_only
								class={styles["check-updates-btn"]}
								onClick={props.checkUpdates}
								disabled={props.busy || props.checkingUpdates}
								tooltip_text={t("instances-details-resources-check-updates")}
								aria-label={t("instances-details-resources-check-updates")}
							>
								<Show
									when={props.checkingUpdates}
									fallback={<ReloadIcon class={styles["check-updates-icon"]} />}
								>
									<span class={styles["checking-updates-spinner"]} />
								</Show>
							</Button>

							<Button
								size="sm"
								variant="outline"
								icon_only
								onClick={() => {
									const inst = props.instance;
									if (inst) {
										props.resourcesStore.setInstance(inst.id);
										props.resourcesStore.setGameVersion(inst.minecraftVersion);
										props.resourcesStore.setLoader(inst.modloader);
										props.router?.navigate("/resources");
									}
								}}
								tooltip_text={t("instances-details-resources-add")}
								aria-label={t("instances-details-resources-add")}
							>
								<PlusIcon />
							</Button>
						</div>
					</div>
				</div>

				<Show when={selectionCount() > 0}>
					<div class={styles["selection-action-bar"]}>
						<div class={styles["selection-info"]}>
							<button
								class={styles["clear-selection"]}
								onClick={() => props.resourcesStore.clearSelection()}
								title={t("instances-details-resources-clear-selection")}
							>
								<CloseIcon width="16" height="16" />
							</button>
							<span class={styles["selection-count"]}>
								{t("instances-details-resources-selected-count", {
									count: selectionCount(),
								})}
							</span>
						</div>
						<div class={styles["selection-actions"]}>
							<Button
								size="sm"
								variant="ghost"
								onClick={props.handleBatchUpdate}
								disabled={props.busy || props.selectedToUpdateCount === 0}
								tooltip_text={
									isCompactTable()
										? t("instances-details-resources-update-selected-tooltip", {
												count: props.selectedToUpdateCount,
											})
										: undefined
								}
							>
								<DownloadIcon width="14" height="14" />
								<Show
									when={!isCompactTable()}
									fallback={<span>({props.selectedToUpdateCount})</span>}
								>
									<span>
										{t("instances-details-resources-update-selected", {
											count: props.selectedToUpdateCount,
										})}
									</span>
								</Show>
							</Button>
							<Button
								size="sm"
								variant="ghost"
								class={styles["delete-selected"]}
								onClick={props.handleBatchDelete}
								disabled={props.busy}
								tooltip_text={
									isCompactTable()
										? t("instances-details-resources-delete-selected-tooltip")
										: undefined
								}
								icon_only={isCompactTable()}
							>
								<TrashIcon />
								<Show when={!isCompactTable()}>
									{t("instances-details-resources-delete-selected")}
								</Show>
							</Button>
						</div>
					</div>
				</Show>
			</div>

			<div class={styles["installed-resources-list"]}>
				<div
					ref={tableScrollElement}
					class={`${styles["vesta-table-container"]} v-instance-resources-table`}
					onScroll={(event) =>
						setObservedScrollOffset(event.currentTarget.scrollTop)
					}
				>
					<Show
						when={
							props.installedResources.loading &&
							!props.installedResources.latest
						}
					>
						<Skeleton class={styles["skeleton-resources"]} />
					</Show>
					<Show when={props.installedResources.latest}>
						<table class={styles["vesta-table"]}>
							<colgroup>
								<For each={props.table.getVisibleLeafColumns()}>
									{(col) => (
										<col
											style={
												COLUMN_WIDTHS[col.id]
													? { width: COLUMN_WIDTHS[col.id] }
													: undefined
											}
										/>
									)}
								</For>
							</colgroup>
							<thead>
								<For each={props.table.getHeaderGroups()}>
									{(headerGroup) => (
										<tr>
											<For each={headerGroup.headers}>
												{(header) => (
													<th
														class={getColumnClass(header.column.id)}
														classList={{
															[styles["can-sort"]]: header.column.getCanSort(),
														}}
													>
														<Show when={!header.isPlaceholder}>
															<div
																onClick={header.column.getToggleSortingHandler()}
															>
																{flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
															</div>
														</Show>
													</th>
												)}
											</For>
										</tr>
									)}
								</For>
							</thead>
							<tbody>
								<Show when={props.instance?.modpackId}>
									<tr
										class={styles["modpack-group-row"]}
										onClick={() => setModpackExpanded(!props.modpackExpanded)}
										tabIndex={0}
										onKeyDown={(event: KeyboardEvent) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												setModpackExpanded(!props.modpackExpanded);
											}
										}}
										aria-expanded={props.modpackExpanded}
									>
										<For each={props.table.getVisibleLeafColumns()}>
											{(column) => (
												<td class={getColumnClass(column.id)}>
													{renderModpackGroupCell(column.id)}
												</td>
											)}
										</For>
									</tr>
								</Show>
								<Show when={topVirtualPadding() > 0}>
									<tr aria-hidden="true">
										<td
											colSpan={props.table.getVisibleLeafColumns().length}
											style={{
												height: `${topVirtualPadding()}px`,
												padding: "0",
											}}
										/>
									</tr>
								</Show>
								<For each={virtualRows()}>
									{(virtualRow) => {
										const row = () => visibleResourceRows()[virtualRow.index];
										return (
											<Show when={row()}>
												{renderResourceRow(row(), {
													virtualIndex: virtualRow.index,
													measure: rowVirtualizer.measureElement,
												})}
											</Show>
										);
									}}
								</For>
								<Show when={bottomVirtualPadding() > 0}>
									<tr aria-hidden="true">
										<td
											colSpan={props.table.getVisibleLeafColumns().length}
											style={{
												height: `${bottomVirtualPadding()}px`,
												padding: "0",
											}}
										/>
									</tr>
								</Show>
							</tbody>
						</table>

						<Show
							when={sortedRows().length === 0 && !props.instance?.modpackId}
						>
							<div class={styles["resources-empty-state"]}>
								<p>
									{t("instances-details-resources-empty", {
										type:
											props.resourceTypeFilter !== "All"
												? getFilterLabel(props.resourceTypeFilter).toLowerCase()
												: t("instances-details-resources-type-resources"),
									})}
								</p>
							</div>
						</Show>
					</Show>
				</div>
			</div>
		</section>
	);
};
