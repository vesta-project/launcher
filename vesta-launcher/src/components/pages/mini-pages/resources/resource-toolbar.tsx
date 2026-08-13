import FilterIcon from "@assets/icons/content/filter.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { sourcesForResourceType } from "@resources/source-catalog";
import { resources } from "@stores/resources";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { TextField } from "@ui/text-field/text-field";
import { batch, createMemo, For, Show } from "solid-js";
import {
	activeBrowseFilterCount,
	ActiveFilterChips,
	hasActiveBrowseFilters,
} from "./active-filter-chips";
import { FilterPopover } from "./filter-popover";
import styles from "./resource-browser.module.css";

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
	onSearchCommit?: (value: string) => void;
	searchValue: string;
}) {
	const activeRouter = () => props.router || router();
	const filterCount = createMemo(() => activeBrowseFilterCount());

	return (
		<div class={styles["toolbar"]}>
			<div class={styles["toolbar-row"]}>
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
								return (
									RESOURCE_TYPES.find((t) => t.value === val)?.label ||
									val ||
									"Mods"
								);
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent />
				</Select>

				<div class={styles["search-group"]} data-keybinding-search>
					<div class={styles["search-container"]}>
						<SearchIcon class={styles["search-svg"]} />
						<TextField
							placeholder="Search… or mc:1.21.1 loader:neo"
							value={props.searchValue}
							onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
								props.onSearchInput(e.currentTarget.value)
							}
							onKeyDown={(e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
								if (e.key === "Enter") {
									e.preventDefault();
									props.onSearchCommit?.(e.currentTarget.value);
								}
							}}
							class={styles["toolbar-search-field"]}
						/>
					</div>
					<Popover>
						<PopoverTrigger
							class={styles["search-filter-trigger"]}
							classList={{ [styles["has-filters"]]: filterCount() > 0 }}
							aria-label="Filters"
							title="Filters"
						>
							<FilterIcon width="16" height="16" />
							<Show when={filterCount() > 0}>
								<span class={styles["filter-count-badge"]}>
									<span class={styles["filter-count-badge-text"]}>
										{filterCount()}
									</span>
								</span>
							</Show>
						</PopoverTrigger>
						<PopoverContent class={styles["filter-popover"]}>
							<FilterPopover router={activeRouter()} />
						</PopoverContent>
					</Popover>
				</div>

				<div class={styles["source-toggle"]}>
					<For each={sourcesForResourceType(resources.state.resourceType)}>
						{(source) => (
							<button
								class={styles["source-btn"]}
								classList={{
									[styles.active]: resources.state.activeSource === source.id,
								}}
								onClick={() => {
									batch(() => {
										resources.setSource(source.id);
										resources.setOffset(0);
										activeRouter()?.updateQuery("activeSource", source.id);
									});
								}}
								title={source.label}
							>
								<source.Icon width="14" height="14" />
								<span>{source.label}</span>
							</button>
						)}
					</For>
				</div>
			</div>

			<div
				class={styles["active-filters-strip"]}
				classList={{ [styles["is-open"]]: hasActiveBrowseFilters() }}
				aria-hidden={!hasActiveBrowseFilters()}
			>
				<div class={styles["active-filters-strip-collapse"]}>
					<ActiveFilterChips router={activeRouter()} />
				</div>
			</div>
		</div>
	);
}
