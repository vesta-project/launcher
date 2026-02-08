import { Show, For } from "solid-js";
import { flexRender } from "@tanstack/solid-table";
import styles from "../instance-details.module.css";
import Button from "@ui/button/button";
import { Skeleton } from "@ui/skeleton/skeleton";
import TrashIcon from "@assets/trash.svg";
import SearchIcon from "@assets/search.svg";

interface ResourcesTabProps {
	instance: any;
	isScrolled: boolean;
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
}

export const ResourcesTab = (props: ResourcesTabProps) => {
	const selectionCount = () => Object.values(props.resourcesStore.state.selection).filter((v) => v).length;

	return (
		<section class={styles["tab-resources"]}>
			<div
				class={styles["resources-toolbar"]}
				classList={{ [styles["is-stuck"]]: props.isScrolled }}
			>
				<div class={styles["toolbar-search-filter"]}>
					<div class={styles["filter-group"]}>
						<For
							each={[
								{ id: "All", label: "All" },
								{ id: "mod", label: "Mods" },
								{ id: "resourcepack", label: "Packs" },
								{ id: "shader", label: "Shaders" },
								{ id: "datapack", label: "Datapacks" },
							]}
						>
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

					<div class={styles["resources-search"]}>
						<div class={styles["search-input-wrapper"]}>
							<SearchIcon class={styles["search-icon"]} />
							<input
								type="text"
								placeholder="Search resources..."
								value={props.resourceSearch}
								onInput={(e) => props.setResourceSearch(e.currentTarget.value)}
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
							>
								<Show
									when={props.checkingUpdates}
									fallback={
										<>
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
												<path d="M21 12a9 9 0 1 1-6.219-8.56" />
												<polyline points="22 4 22 10 16 10" />
											</svg>
											Check Updates
										</>
									}
								>
									<span class={styles["checking-updates-spinner"]} />
									Checking...
								</Show>
							</Button>

							<Button
								size="sm"
								variant="outline"
								class={styles["browse-resources-btn"]}
								onClick={() => {
									const inst = props.instance;
									if (inst) {
										props.resourcesStore.setInstance(inst.id);
										props.resourcesStore.setGameVersion(inst.minecraftVersion);
										props.resourcesStore.setLoader(inst.modloader);
										props.router?.navigate("/resources");
									}
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
									<circle cx="11" cy="11" r="8" />
									<line x1="21" y1="21" x2="16.65" y2="16.65" />
									<line x1="11" y1="8" x2="11" y2="14" />
									<line x1="8" y1="11" x2="14" y2="11" />
								</svg>
								Browse
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
									Update ({props.selectedToUpdateCount})
								</Button>
								<Button
									size="sm"
									variant="ghost"
									class={styles["delete-selected"]}
									onClick={props.handleBatchDelete}
									disabled={props.busy}
								>
									<TrashIcon />
									Delete Selected
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
						classList={{ [styles.refetching]: props.installedResources.loading }}
					>
						<table class={styles["vesta-table"]}>
							<thead>
								<For each={props.table.getHeaderGroups()}>
									{(headerGroup) => (
										<tr>
											<For each={headerGroup.headers}>
												{(header) => (
													<th
														style={{
															width: header.getSize() !== 150 ? `${header.getSize()}px` : undefined,
														}}
													>
														<Show when={!header.isPlaceholder}>
															<div
																classList={{
																	[styles["can-sort"]]: header.column.getCanSort(),
																}}
																onClick={header.column.getToggleSortingHandler()}
															>
																{flexRender(header.column.columnDef.header, header.getContext())}
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
											style={{ cursor: "pointer" }}
											classList={{ [styles["row-selected"]]: row.getIsSelected() }}
										>
											<For each={row.getVisibleCells()}>
												{(cell) => (
													<td>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
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
