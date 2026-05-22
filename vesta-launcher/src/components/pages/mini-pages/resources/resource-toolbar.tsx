import CurseForgeIcon from "@assets/curseforge.svg";
import FilterIcon from "@assets/filter.svg";
import ModrinthIcon from "@assets/modrinth.svg";
import SearchIcon from "@assets/search.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { instancesState } from "@stores/instances";
import { resources } from "@stores/resources";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { TextField } from "@ui/text-field/text-field";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import { resolveResourceUrl } from "@utils/assets";
import { DEFAULT_ICONS } from "@utils/instances";
import { batch, createMemo, Show } from "solid-js";
import { ActiveFilterChips } from "./active-filter-chips";
import { FilterPopover } from "./filter-popover";
import styles from "./resource-browser.module.css";

const ListIcon = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<line x1="8" y1="6" x2="21" y2="6" />
		<line x1="8" y1="12" x2="21" y2="12" />
		<line x1="8" y1="18" x2="21" y2="18" />
		<line x1="3" y1="6" x2="3.01" y2="6" />
		<line x1="3" y1="12" x2="3.01" y2="12" />
		<line x1="3" y1="18" x2="3.01" y2="18" />
	</svg>
);

const GridIcon = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<rect x="3" y="3" width="7" height="7" />
		<rect x="14" y="3" width="7" height="7" />
		<rect x="14" y="14" width="7" height="7" />
		<rect x="3" y="14" width="7" height="7" />
	</svg>
);



const RESOURCE_TYPES = [
	{ value: "mod", label: "Mods" },
	{ value: "resourcepack", label: "Resource Packs" },
	{ value: "shader", label: "Shaders" },
	{ value: "datapack", label: "Data Packs" },
	{ value: "modpack", label: "Modpacks" },
	{ value: "world", label: "Worlds" },
] as const;

export function ResourceToolbar(props: {
	router?: MiniRouter;
	onSearchInput: (value: string) => void;
	searchValue: string;
}) {
	const activeRouter = () => props.router || router();
	const isModpack = () => resources.state.resourceType === "modpack";

	const selectedInstance = () => {
		if (!resources.state.selectedInstanceId) return null;
		return instancesState.instances.find((i) => i.id === resources.state.selectedInstanceId) || null;
	};

	const instanceIconUrl = () => {
		const inst = selectedInstance();
		if (!inst) return null;
		return resolveResourceUrl(inst.iconPath || DEFAULT_ICONS[0]);
	};

	const instanceDisplayChar = () => {
		const inst = selectedInstance();
		if (!inst) return "?";
		const match = inst.name.match(/[a-zA-Z]/);
		return match ? match[0].toUpperCase() : inst.name.charAt(0).toUpperCase();
	};

	const activeFilterCount = createMemo(() => {
		let count = 0;
		if (resources.state.gameVersion) count++;
		if (resources.state.loader) count++;
		count += resources.state.categories.length;
		return count;
	});

	return (
		<div class={styles["toolbar"]}>
			{/* Row 1: Search, Source, View */}
			<div class={styles["toolbar-row-top"]}>
				<Select<string>
					options={RESOURCE_TYPES.map((t) => t.value)}
					value={resources.state.resourceType}
					onChange={(v: string | null) => {
						if (!v) return;
						batch(() => {
							resources.setType(v as any);
							resources.setOffset(0);
							activeRouter()?.updateQuery("resourceType", v);
						});
					}}
					optionValue={(v) => v}
					optionTextValue={(v) =>
						RESOURCE_TYPES.find((t) => t.value === v)?.label || v
					}
					itemComponent={(p) => (
						<SelectItem item={p.item}>
							{RESOURCE_TYPES.find((t) => t.value === p.item.rawValue)?.label ||
								p.item.rawValue}
						</SelectItem>
					)}
				>
					<SelectTrigger class={styles["type-select"]}>
						<SelectValue<string>>
							{(s) => {
								const val = s.selectedOption();
								return RESOURCE_TYPES.find((t) => t.value === val)?.label || val || "Mods";
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent />
				</Select>

				<div class={styles["search-container"]}>
					<SearchIcon class={styles["search-svg"]} />
					<TextField
						placeholder="Search resources..."
						value={props.searchValue}
						onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
							props.onSearchInput(e.currentTarget.value)
						}
						class={styles["toolbar-search-field"]}
					/>
				</div>

				<div class={styles["source-toggle"]}>
					<button
						class={styles["source-btn"]}
						classList={{
							[styles.active]: resources.state.activeSource === "modrinth",
						}}
						onClick={() => {
							batch(() => {
								resources.setSource("modrinth");
								resources.setOffset(0);
								activeRouter()?.updateQuery("activeSource", "modrinth");
							});
						}}
						title="Modrinth"
					>
						<ModrinthIcon width="14" height="14" />
						<span>Modrinth</span>
					</button>
					<button
						class={styles["source-btn"]}
						classList={{
							[styles.active]: resources.state.activeSource === "curseforge",
						}}
						onClick={() => {
							batch(() => {
								resources.setSource("curseforge");
								resources.setOffset(0);
								activeRouter()?.updateQuery("activeSource", "curseforge");
							});
						}}
						title="CurseForge"
					>
						<CurseForgeIcon width="14" height="14" />
						<span>CurseForge</span>
					</button>
				</div>

				<div class={styles["view-toggle"]}>
					<button
						class={styles["view-btn"]}
						classList={{
							[styles.active]: resources.state.viewMode === "list",
						}}
						onClick={() => resources.setViewMode("list")}
						title="List View"
					>
						<ListIcon />
					</button>
					<button
						class={styles["view-btn"]}
						classList={{
							[styles.active]: resources.state.viewMode === "grid",
						}}
						onClick={() => resources.setViewMode("grid")}
						title="Grid View"
					>
						<GridIcon />
					</button>
				</div>
			</div>

			{/* Row 2: Instance picker, Filter button, Active chips */}
			<div class={styles["toolbar-row-controls"]}>
				{/* Compact instance icon button */}
				<div
					class={styles["instance-selector-wrapper"]}
					classList={{ [styles.disabled]: isModpack() }}
					title={isModpack() ? "Instance selection is disabled for modpacks" : undefined}
				>
					<Select<any>
						disabled={isModpack()}
						options={[
							{ id: "none", name: "No Instance" } as any,
							...instancesState.instances,
						]}
						value={
							resources.state.selectedInstanceId
								? instancesState.instances.find(
										(i) => i.id === resources.state.selectedInstanceId,
									) || ({ id: "none", name: "No Instance" } as any)
								: ({ id: "none", name: "No Instance" } as any)
						}
						onChange={(instance: any) => {
							batch(() => {
								const id = instance?.id === "none" ? null : (instance?.id ?? null);
								resources.setInstance(id);
								if (id && instance) {
									resources.setGameVersion(instance.minecraftVersion);
									if (resources.state.resourceType === "mod") {
										const loader = instance.modloader?.toLowerCase();
										if (loader && loader !== "vanilla") {
											resources.setLoader(instance.modloader);
										} else {
											resources.setLoader(null);
										}
									} else {
										resources.setLoader(null);
									}
								} else {
									resources.setGameVersion(null);
									resources.setLoader(null);
								}
								activeRouter()?.updateQuery("selectedInstanceId", id);
								activeRouter()?.updateQuery("gameVersion", resources.state.gameVersion);
								activeRouter()?.updateQuery("loader", resources.state.loader);
							});
						}}
						optionValue="id"
						optionTextValue="name"
						itemComponent={(p) => (
							<SelectItem item={p.item} class={styles["instance-select-item"]}>
								<div class={styles["instance-item-content"]}>
									<Show when={p.item.rawValue && p.item.rawValue.id !== null}>
										<Show
											when={resolveResourceUrl(p.item.rawValue?.iconPath || DEFAULT_ICONS[0])}
											fallback={
												<div class={styles["instance-item-icon-placeholder"]}>
													{(() => {
														const name = p.item.rawValue?.name || "?";
														const match = name.match(/[a-zA-Z]/);
														return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
													})()}
												</div>
											}
										>
											<div
												class={styles["instance-item-icon"]}
												style={{
													"background-image": `url('${resolveResourceUrl(p.item.rawValue?.iconPath || DEFAULT_ICONS[0])}')`,
													"background-size": "cover",
													"background-position": "center",
												}}
											/>
										</Show>
									</Show>
									<span class={styles["instance-item-name"]}>{p.item.rawValue?.name || "No Instance"}</span>
									<span class={styles["instance-item-meta"]}>
										{p.item.rawValue?.minecraftVersion || ""}
										{p.item.rawValue?.modloader ? ` · ${p.item.rawValue.modloader}` : ""}
									</span>
								</div>
							</SelectItem>
						)}
					>
						<SelectTrigger class={styles["instance-icon-trigger"]}>
							<Show when={selectedInstance()} fallback={
								<div class={styles["instance-icon-placeholder"]}>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
										<line x1="8" y1="21" x2="16" y2="21"/>
										<line x1="12" y1="17" x2="12" y2="21"/>
									</svg>
								</div>
							}>
								<Show when={instanceIconUrl()} fallback={
									<div class={styles["instance-icon-placeholder"]}>{instanceDisplayChar()}</div>
								}>
									<div
										class={styles["instance-item-icon"]}
										style={{
											"background-image": `url('${instanceIconUrl() || ""}')`,
											"background-size": "cover",
											"background-position": "center",
										}}
									/>
								</Show>
							</Show>
						</SelectTrigger>
						<SelectContent />
					</Select>
				</div>

				<Popover>
					<PopoverTrigger
						class={styles["filter-popover-trigger"]}
						classList={{ [styles["has-filters"]]: activeFilterCount() > 0 }}
					>
						<FilterIcon width="16" height="16" />
						<span>Filters</span>
						<Show when={activeFilterCount() > 0}>
							<span class={styles["filter-count-badge"]}>{activeFilterCount()}</span>
						</Show>
					</PopoverTrigger>
					<PopoverContent class={styles["filter-popover"]}>
						<FilterPopover router={activeRouter()} />
					</PopoverContent>
				</Popover>

				<div class={styles["active-filters-inline"]}>
					<ActiveFilterChips router={activeRouter()} />
				</div>
			</div>
		</div>
	);
}