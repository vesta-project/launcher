import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { instancesState } from "@stores/instances";
import { resources } from "@stores/resources";
import { useMinecraftVersions } from "@stores/versions";
import { Badge } from "@ui/badge";
import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { resolveResourceUrl } from "@utils/assets";
import {
	createAnimatedIconPreview,
	iconBackgroundStyle,
} from "@utils/icon-animation";
import { DEFAULT_ICONS } from "@utils/instances";
import { sanitizeSvg } from "@utils/security";
import { batch, For, Show } from "solid-js";
import styles from "./resource-browser.module.css";

const LOADERS = ["Forge", "Fabric", "Quilt", "NeoForge"];

const VERSION_OPTIONS = [
	"All versions",
	"1.21.4",
	"1.21.1",
	"1.20.1",
	"1.19.2",
	"1.18.2",
	"1.17.1",
	"1.16.5",
	"1.12.2",
	"1.8.9",
	"1.7.10",
];

function InstanceOptionIcon(props: {
	instance: any;
	placeholderClass: string;
}) {
	const iconPath = () => props.instance?.iconPath || DEFAULT_ICONS[0];
	const iconPreview = createAnimatedIconPreview(iconPath);
	const displayChar = () => {
		const name = props.instance?.name || "?";
		const match = name.match(/[a-zA-Z]/);
		return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
	};

	return (
		<Show
			when={iconPreview.displaySource()}
			fallback={<div class={props.placeholderClass}>{displayChar()}</div>}
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
	);
}

export function FilterPopover(props: { router?: MiniRouter }) {
	const activeRouter = () => props.router || router();
	const { versions: mcVersions } = useMinecraftVersions();

	const gameVersions = () => {
		const meta = mcVersions();
		const current = resources.state.gameVersion;
		const base = VERSION_OPTIONS;

		if (meta && meta.game_versions) {
			const releases = meta.game_versions
				.filter((v: any) => v.version_type === "release")
				.map((v: any) => v.id);
			const merged = ["All versions", ...releases];
			if (current && current !== "All versions" && !merged.includes(current)) {
				merged.push(current);
			}
			return merged;
		}

		if (current && current !== "All versions" && !base.includes(current)) {
			return [...base, current];
		}
		return base;
	};

	const availableCategories = () => {
		const type = resources.state.resourceType;
		const source = resources.state.activeSource;
		const allCats = resources.state.availableCategories;

		if (allCats.length === 0) return [];

		const filtered = allCats.filter((c) => {
			if (!c.project_type) return true;
			return c.project_type === type;
		});

		if (source === "curseforge") {
			interface CategoryItem {
				id: string;
				name: string;
				icon: string | null;
				displayIndex: number;
			}
			interface CategoryGroup {
				id?: string;
				name: string;
				icon?: string | null;
				displayIndex: number;
				items: CategoryItem[];
			}

			const result: CategoryGroup[] = [];
			const topLevel = filtered.filter(
				(c) => !c.parent_id || !filtered.some((p) => p.id === c.parent_id),
			);

			const generalGroup: CategoryGroup = {
				id: undefined,
				name: "General",
				icon: undefined,
				displayIndex: -1,
				items: [],
			};

			for (const tl of topLevel) {
				const children = filtered.filter((c) => c.parent_id === tl.id);
				if (children.length > 0) {
					result.push({
						id: tl.id,
						name: tl.name,
						icon: tl.icon_url,
						displayIndex: tl.display_index ?? 0,
						items: children
							.map((c) => ({
								id: c.id,
								name: c.name,
								icon: c.icon_url,
								displayIndex: c.display_index ?? 0,
							}))
							.sort(
								(a, b) =>
									a.displayIndex - b.displayIndex ||
									a.name.localeCompare(b.name),
							),
					});
				} else {
					generalGroup.items.push({
						id: tl.id,
						name: tl.name,
						icon: tl.icon_url,
						displayIndex: tl.display_index ?? 0,
					});
				}
			}

			result.sort(
				(a, b) =>
					a.displayIndex - b.displayIndex || a.name.localeCompare(b.name),
			);
			if (generalGroup.items.length > 0) {
				generalGroup.items.sort(
					(a, b) =>
						a.displayIndex - b.displayIndex || a.name.localeCompare(b.name),
				);
				result.unshift(generalGroup);
			}

			return result;
		}

		const items = filtered
			.map((c) => ({
				id: c.id,
				name: c.name,
				icon: c.icon_url,
				displayIndex: c.display_index ?? 0,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		if (items.length === 0) return [];

		return [
			{
				id: undefined as string | undefined,
				name: "",
				icon: undefined as string | undefined,
				displayIndex: 0,
				items,
			},
		];
	};

	const shouldShowLoader = () =>
		resources.state.resourceType === "mod" ||
		resources.state.resourceType === "modpack";

	const isModpack = () => resources.state.resourceType === "modpack";

	const selectedInstance = () => {
		if (!resources.state.selectedInstanceId) return null;
		return (
			instancesState.instances.find(
				(i) => i.id === resources.state.selectedInstanceId,
			) || null
		);
	};

	const selectedIconPreview = createAnimatedIconPreview(
		() => selectedInstance()?.iconPath || DEFAULT_ICONS[0],
	);

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

	const applyInstance = (instance: any) => {
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
	};

	const toggleGroupExpand = (groupId: string, e: MouseEvent) => {
		e.stopPropagation();
		resources.toggleCategoryGroup(groupId);
	};

	return (
		<div class={styles["filter-popover-scrollable"]}>
			<div class={styles["filter-popover-content"]}>
				<div
					class={styles["filter-popover-section"]}
					classList={{ [styles.disabled]: isModpack() }}
					title={
						isModpack()
							? "Instance selection is disabled for modpacks"
							: undefined
					}
				>
					<label class={styles["filter-label"]}>Instance</label>
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
						onChange={applyInstance}
						optionValue="id"
						optionTextValue="name"
						itemComponent={(p) => (
							<SelectItem item={p.item} class={styles["instance-select-item"]}>
								<div class={styles["instance-item-content"]}>
									<Show when={p.item.rawValue && p.item.rawValue.id !== null}>
										<InstanceOptionIcon
											instance={p.item.rawValue}
											placeholderClass={
												styles["instance-item-icon-placeholder"]
											}
										/>
									</Show>
									<span class={styles["instance-item-name"]}>
										{p.item.rawValue?.name || "No Instance"}
									</span>
									<span class={styles["instance-item-meta"]}>
										{p.item.rawValue?.minecraftVersion || ""}
										{p.item.rawValue?.modloader
											? ` · ${p.item.rawValue.modloader}`
											: ""}
									</span>
								</div>
							</SelectItem>
						)}
					>
						<SelectTrigger class={styles["filter-select"]}>
							<Show
								when={selectedInstance()}
								fallback={
									<span class={styles["instance-trigger-name"]}>
										No Instance
									</span>
								}
							>
								<div class={styles["instance-trigger-content"]}>
									<Show
										when={
											selectedIconPreview.displaySource() || instanceIconUrl()
										}
										fallback={
											<div class={styles["instance-icon-placeholder"]}>
												{instanceDisplayChar()}
											</div>
										}
									>
										<div
											class={styles["instance-item-icon"]}
											style={iconBackgroundStyle(
												selectedIconPreview.displaySource() ||
													instanceIconUrl(),
											)}
											onMouseEnter={selectedIconPreview.activate}
											onMouseLeave={selectedIconPreview.deactivate}
											onFocusIn={selectedIconPreview.activate}
											onFocusOut={selectedIconPreview.deactivate}
										/>
									</Show>
									<span class={styles["instance-trigger-name"]}>
										{selectedInstance()?.name}
									</span>
								</div>
							</Show>
						</SelectTrigger>
						<SelectContent />
					</Select>
				</div>

				<div class={styles["filter-popover-section"]}>
					<label class={styles["filter-label"]}>Minecraft Version</label>
					<Combobox
						options={gameVersions()}
						value={resources.state.gameVersion || "All versions"}
						onChange={(v: string | null) => {
							const val = v === "All versions" || !v ? null : v;
							resources.setGameVersion(val);
							resources.setOffset(0);
							activeRouter()?.updateQuery("gameVersion", val);
						}}
						itemComponent={(p) => (
							<ComboboxItem item={p.item}>
								{String(p.item.rawValue)}
							</ComboboxItem>
						)}
					>
						<ComboboxControl class={styles["filter-combobox"]}>
							<ComboboxInput />
							<ComboboxTrigger />
						</ComboboxControl>
						<ComboboxContent />
					</Combobox>
				</div>

				<Show when={shouldShowLoader()}>
					<div class={styles["filter-popover-section"]}>
						<label class={styles["filter-label"]}>Mod Loader</label>
						<Select
							options={["All Loaders", ...LOADERS]}
							value={
								LOADERS.find(
									(l) => l.toLowerCase() === resources.state.loader,
								) || "All Loaders"
							}
							onChange={(v: string | null) => {
								const val = v === "All Loaders" || !v ? null : v.toLowerCase();
								resources.setLoader(val);
								resources.setOffset(0);
								activeRouter()?.updateQuery("loader", val);
							}}
							itemComponent={(p) => (
								<SelectItem item={p.item}>{String(p.item.rawValue)}</SelectItem>
							)}
						>
							<SelectTrigger class={styles["filter-select"]}>
								<SelectValue<string>>
									{(s) => String(s.selectedOption() || "All Loaders")}
								</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>
				</Show>

				<Show when={availableCategories().length > 0}>
					<div class={styles["filter-popover-section"]}>
						<label class={styles["filter-label"]}>Categories</label>
						<div class={styles["category-groups-popover"]}>
							<For each={availableCategories()}>
								{(group) => (
									<div class={styles["category-group"]}>
										<Show when={group.name !== ""}>
											<div
												class={styles["category-group-header"]}
												classList={{ [styles["not-clickable"]]: !group.id }}
											>
												<div
													class={styles["category-group-title"]}
													title={group.id}
													classList={{
														[styles.clickable]: group.id !== undefined,
														[styles.active]:
															group.id !== undefined &&
															resources.state.categories.includes(group.id),
													}}
													onClick={() => {
														if (group.id) {
															resources.toggleCategory(group.id);
															resources.setOffset(0);
															activeRouter()?.updateQuery(
																"categories",
																resources.state.categories,
															);
														}
													}}
												>
													<Show when={group.icon}>
														<div class={styles["category-tag-icon"]}>
															<Show
																when={group.icon?.startsWith("http")}
																fallback={
																	<div
																		class={styles["category-tag-icon-svg"]}
																		innerHTML={sanitizeSvg(group.icon || "")}
																	/>
																}
															>
																<img
																	src={group.icon || ""}
																	class={styles["category-tag-icon-img"]}
																	alt={group.name}
																/>
															</Show>
														</div>
													</Show>
													<span>{group.name}</span>
												</div>
												<Show
													when={
														group.items.length > 0 &&
														resources.state.activeSource === "curseforge"
													}
												>
													<button
														class={styles["expand-toggle"]}
														classList={{
															[styles.expanded]:
																resources.state.expandedCategoryGroups.includes(
																	group.id || group.name,
																),
														}}
														onClick={(e) =>
															toggleGroupExpand(group.id || group.name, e)
														}
													>
												<ChevronDownIcon />
													</button>
												</Show>
											</div>
										</Show>
										<Show
											when={
												resources.state.expandedCategoryGroups.includes(
													group.id || group.name,
												) || resources.state.activeSource !== "curseforge"
											}
										>
											<div class={styles["category-grid"]}>
												<For each={group.items}>
													{(cat) => (
														<Badge
															variant="theme"
															class={
																styles["resource-tag"] +
																" " +
																styles["category-tag"]
															}
															active={resources.state.categories.includes(
																cat.id,
															)}
															title={cat.id}
															onClick={() => {
																resources.toggleCategory(cat.id);
																resources.setOffset(0);
															}}
														>
															<Show when={cat.icon}>
																<div class={styles["category-tag-icon"]}>
																	<Show
																		when={cat.icon?.startsWith("http")}
																		fallback={
																			<div
																				class={styles["category-tag-icon-svg"]}
																				innerHTML={sanitizeSvg(cat.icon || "")}
																			/>
																		}
																	>
																		<img
																			src={cat.icon || ""}
																			class={styles["category-tag-icon-img"]}
																			alt={cat.name}
																		/>
																	</Show>
																</div>
															</Show>
															<span class={styles["category-tag-text"]}>
																{cat.name}
															</span>
														</Badge>
													)}
												</For>
											</div>
										</Show>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				<div class={styles["filter-popover-footer"]}>
					<button
						class={styles["filter-popover-reset"]}
						onClick={() => {
							resources.resetFilters();
							activeRouter()?.updateQuery("selectedInstanceId", null);
							activeRouter()?.updateQuery("gameVersion", null);
							activeRouter()?.updateQuery("loader", null);
							activeRouter()?.updateQuery("categories", []);
							activeRouter()?.updateQuery("query", "");
						}}
						type="button"
					>
						Reset Filters
					</button>
				</div>
			</div>
		</div>
	);
}
import ChevronDownIcon from "@assets/icons/controls/chevron-down.svg";
