import ReloadIcon from "@assets/reload.svg";
import SearchIcon from "@assets/search.svg";
import TrashIcon from "@assets/trash.svg";
import { flexRender } from "@tanstack/solid-table";
import Button from "@ui/button/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select/select";
import { Skeleton } from "@ui/skeleton/skeleton";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
	createContainerQuery,
	RESOURCES_FILTER_COMPACT_WIDTH,
	RESOURCES_TABLE_COMPACT_WIDTH,
} from "@utils/media-query";
import styles from "../instance-details.module.css";

const FILTER_OPTIONS = [
	{ id: "All", label: "All" },
	{ id: "mod", label: "Mods" },
	{ id: "resourcepack", label: "Packs" },
	{ id: "shader", label: "Shaders" },
	{ id: "datapack", label: "Datapacks" },
];

const COLUMN_WIDTHS: Record<string, string | undefined> = {
	select: "48px",
	display_name: undefined,
	current_version: "96px",
	is_enabled: "56px",
	actions: "48px",
};

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
	router: any;
	handleBatchUpdate: () => void;
	handleBatchDelete: () => void;
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

	const [panelRef, setPanelRef] = createSignal<HTMLElement | undefined>();
	const isCompactTable = createContainerQuery(panelRef, RESOURCES_TABLE_COMPACT_WIDTH);
	const isFilterCompact = createContainerQuery(panelRef, RESOURCES_FILTER_COMPACT_WIDTH);

	createEffect(() => {
		props.onCompactChange?.(isCompactTable());
	});

	const handleSearchInput = (e: InputEvent) => {
		const target = e.currentTarget as HTMLInputElement;
		props.setResourceSearch(target.value);
	};

	return (
		<section ref={setPanelRef} class={styles["tab-resources"]}>
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
										{option.label}
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
										{FILTER_OPTIONS.find((o) => o.id === p.item.rawValue)?.label}
									</SelectItem>
								)}
							>
								<SelectTrigger>
									<SelectValue<string>>
										{(state) =>
											FILTER_OPTIONS.find((o) => o.id === state.selectedOption())?.label || "All"
										}
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
								placeholder="Search resources..."
								value={props.resourceSearch}
								onInput={handleSearchInput}
							/>
						</div>
					</div>
				</div>

				<div class={styles["toolbar-lower-wrapper"]}>
					<Show when={selectionCount() === 0}>
						<div class={styles["toolbar-actions"]}>
							<Button
								size="sm"
								variant="ghost"
								class={styles["check-updates-btn"]}
								onClick={props.checkUpdates}
								disabled={props.busy || props.checkingUpdates}
								tooltip_text="Check for available updates"
							>
								<Show
									when={props.checkingUpdates}
									fallback={
										<>
											<ReloadIcon class={styles["check-updates-icon"]} />
											<span>Check Updates</span>
										</>
									}
								>
									<span class={styles["checking-updates-spinner"]} />
									<span>Checking...</span>
								</Show>
							</Button>

							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									const inst = props.instance;
									if (inst) {
										props.resourcesStore.setInstance(inst.id);
										props.resourcesStore.setGameVersion(inst.minecraftVersion);
										props.resourcesStore.setLoader(inst.modloader);
										props.router?.navigate("/resources");
									}
								}}
								tooltip_text="Browse and add resources"
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
									<circle cx="11" cy="11" r="8" />
									<line x1="21" y1="21" x2="16.65" y2="16.65" />
									<line x1="11" y1="8" x2="11" y2="14" />
									<line x1="8" y1="11" x2="14" y2="11" />
								</svg>
								<span>Browse</span>
							</Button>
						</div>
					</Show>

					<Show when={selectionCount() > 0}>
						<div class={styles["selection-action-bar"]}>
							<div class={styles["selection-info"]}>
								<button
									class={styles["clear-selection"]}
									onClick={() => props.resourcesStore.clearSelection()}
									title="Clear Selection"
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
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
								<span class={styles["selection-count"]}>
									{selectionCount()} resources selected
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
											? `Update ${props.selectedToUpdateCount} selected`
											: undefined
									}
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
										<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
										<polyline points="7 10 12 15 17 10" />
										<line x1="12" y1="15" x2="12" y2="3" />
									</svg>
									<Show
										when={!isCompactTable()}
										fallback={<span>({props.selectedToUpdateCount})</span>}
									>
										<span>Update ({props.selectedToUpdateCount})</span>
									</Show>
								</Button>
								<Button
									size="sm"
									variant="ghost"
									class={styles["delete-selected"]}
									onClick={props.handleBatchDelete}
									disabled={props.busy}
									tooltip_text={isCompactTable() ? "Delete selected" : undefined}
									icon_only={isCompactTable()}
								>
									<TrashIcon />
									<Show when={!isCompactTable()}>Delete Selected</Show>
								</Button>
							</div>
						</div>
					</Show>
				</div>
			</div>

			<div class={styles["installed-resources-list"]}>
				<Show when={props.installedResources.loading && !props.installedResources.latest}>
					<Skeleton class={styles["skeleton-resources"]} />
				</Show>
				<Show when={props.installedResources.latest}>
					<div
						class={`${styles["vesta-table-container"]} v-instance-resources-table`}
						classList={{
							[styles.refetching]: props.installedResources.loading,
						}}
					>
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
																onClick={
																	header.column.getToggleSortingHandler()
																}
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
								<For each={props.table.getRowModel().rows}>
									{(row) => (
										<tr
											onClick={(e) => props.onRowClick(row, e)}
											style={{ cursor: "default" }}
											classList={{
												[styles["row-selected"]]: row.getIsSelected(),
												[styles["row-disabled"]]:
													!row.original.is_enabled,
											}}
										>
											<For each={row.getVisibleCells()}>
												{(cell) => (
													<td class={getColumnClass(cell.column.id)}>
														{flexRender(
															cell.column.columnDef.cell,
															cell.getContext(),
														)}
													</td>
												)}
											</For>
										</tr>
									)}
								</For>
							</tbody>
						</table>

						<Show when={props.table.getRowModel().rows.length === 0}>
							<div class={styles["resources-empty-state"]}>
								<p>
									No{" "}
									{props.resourceTypeFilter !== "All"
										? props.resourceTypeFilter.toLowerCase() + "s"
										: "resources"}{" "}
									found.
								</p>
							</div>
						</Show>
					</div>
				</Show>
			</div>
		</section>
	);
};
