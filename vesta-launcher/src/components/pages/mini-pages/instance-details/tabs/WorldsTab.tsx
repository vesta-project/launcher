import ReloadIcon from "@assets/icons/actions/reload.svg";
import TimerIcon from "@assets/icons/content/timer.svg";
import FolderIcon from "@assets/icons/content/folder.svg";
import MoreIcon from "@assets/icons/content/ellipsis-v.svg";
import GridIcon from "@assets/icons/content/grid.svg";
import ListIcon from "@assets/icons/content/list.svg";
import StorageIcon from "@assets/icons/content/storage.svg";
import DatapackIcon from "@assets/icons/content/layers.svg";
import MoveIcon from "@assets/icons/actions/move.svg";
import CopyIcon from "@assets/icons/actions/copy.svg";
import DuplicateIcon from "@assets/icons/actions/duplicate.svg";
import TrashIcon from "@assets/icons/actions/delete.svg";
import InstanceSelectionDialog, {
	type InstanceSelectionOption,
} from "@components/instances/InstanceSelectionDialog";
import { WorldIcon } from "@components/worlds/WorldIcon";
import { dialogStore } from "@stores/dialog-store";
import { type Instance, instancesState } from "@stores/instances";
import {
	deleteWorld,
	listInstanceWorlds,
	openWorldFolder,
	transferWorld,
	type WorldSummary,
	type WorldTransferMode,
	worldsState,
} from "@stores/worlds";
import { Badge } from "@ui/badge/badge";
import Button from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
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
import { showToast } from "@ui/toast/toast";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { formatDate } from "@utils/date";
import { formatBytes } from "@utils/format-bytes";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";
import { t } from "~/localization";
import { WorldDatapacksView } from "./WorldDatapacksView";
import styles from "./WorldsTab.module.css";
import { getWorldTransferWarnings } from "./world-transfer";

type SortMode = "recency" | "name" | "size";
type ViewMode = "grid" | "compact";
type PendingTransfer = {
	world: WorldSummary;
	mode: Exclude<WorldTransferMode, "duplicate">;
};

const sortOptions = (): Array<{ value: SortMode; label: string }> => [
	{ value: "recency", label: t("instances-worlds-sort-recency") },
	{ value: "name", label: t("instances-worlds-sort-name") },
	{ value: "size", label: t("instances-worlds-sort-size") },
];

const transferCompatTitle = (mode: WorldTransferMode) =>
	mode === "move"
		? t("instances-worlds-transfer-compat-title-move")
		: mode === "copy"
			? t("instances-worlds-transfer-compat-title-copy")
			: t("instances-worlds-transfer-compat-title-duplicate");

const transferConfirmLabel = (mode: WorldTransferMode) =>
	mode === "move"
		? t("instances-worlds-transfer-confirm-move")
		: mode === "copy"
			? t("instances-worlds-transfer-confirm-copy")
			: t("instances-worlds-transfer-confirm-duplicate");

const transferStartedTitle = (mode: WorldTransferMode) =>
	mode === "move"
		? t("instances-worlds-transfer-started-move")
		: mode === "copy"
			? t("instances-worlds-transfer-started-copy")
			: t("instances-worlds-transfer-started-duplicate");

type WorldAction = {
	label: string;
	disabled?: boolean;
	separatorBefore?: boolean;
	destructive?: boolean;
	icon: Component;
	run: () => void;
};

const ActionLabel: Component<{ action: WorldAction }> = (props) => (
	<span class={styles["menu-action"]}>
		<props.action.icon />
		{props.action.label}
	</span>
);

export const WorldCard: Component<{
	world: WorldSummary;
	busy: boolean;
	onMove: () => void;
	onCopy: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onManageDatapacks: () => void;
	onOpen: () => void;
}> = (props) => {
	const actions = (): WorldAction[] => [
		{
			label: t("instances-worlds-action-open-folder"),
			icon: FolderIcon,
			run: () => void openWorldFolder(props.world.ref),
		},
		{
			label: t("instances-worlds-action-manage-datapacks"),
			icon: DatapackIcon,
			run: props.onManageDatapacks,
		},
		{
			label: t("instances-worlds-action-move"),
			icon: MoveIcon,
			disabled: props.busy,
			separatorBefore: true,
			run: props.onMove,
		},
		{
			label: t("instances-worlds-action-copy"),
			icon: CopyIcon,
			disabled: props.busy,
			run: props.onCopy,
		},
		{
			label: t("instances-settings-duplicate-action"),
			icon: DuplicateIcon,
			disabled: props.busy,
			run: props.onDuplicate,
		},
		{
			label: t("instances-worlds-action-delete"),
			icon: TrashIcon,
			disabled: props.busy,
			destructive: true,
			separatorBefore: true,
			run: props.onDelete,
		},
	];
	return (
		<ContextMenu>
			<ContextMenuTrigger
				as="article"
				class={styles.card}
				classList={{
					[styles["card--interactive"]]:
						props.world.levelStatus !== "unreadable",
				}}
				role="button"
				tabIndex={props.world.levelStatus === "unreadable" ? undefined : 0}
				aria-disabled={props.world.levelStatus === "unreadable" || undefined}
				aria-label={t("instances-worlds-view-datapacks-aria", {
					name: props.world.displayName,
				})}
				onClick={(event: MouseEvent) => {
					if (
						event.target !== event.currentTarget &&
						(event.target as HTMLElement).closest("button")
					)
						return;
					if (props.world.levelStatus !== "unreadable") props.onOpen();
				}}
				onKeyDown={(event: KeyboardEvent) => {
					if (
						event.target === event.currentTarget &&
						props.world.levelStatus !== "unreadable" &&
						(event.key === "Enter" || event.key === " ")
					) {
						event.preventDefault();
						props.onOpen();
					}
				}}
			>
				<div class={styles.media}>
					<WorldIcon
						class={styles["media-image"]}
						src={props.world.iconDataUrl}
						name={props.world.displayName}
					/>
					<div class={styles["media-fade"]} aria-hidden="true" />
					<Show when={props.world.levelStatus === "unreadable"}>
						<Badge variant="error" class={styles["world-status"]}>
							{t("instances-worlds-status-unreadable")}
						</Badge>
					</Show>
				</div>

				<div class={styles["card-body"]}>
					<div class={styles.identity}>
						<h3
							class={styles.name}
							title={
								props.world.folderName === props.world.displayName
									? props.world.displayName
									: t("instances-worlds-name-with-folder", {
											displayName: props.world.displayName,
											folderName: props.world.folderName,
										})
							}
						>
							{props.world.displayName}
						</h3>
					</div>
					<div class={styles.metadata}>
						<span
							class={styles["metadata-item"]}
							title={t("instances-worlds-last-played", {
								date: formatDate(props.world.lastPlayedAt),
							})}
							aria-label={t("instances-worlds-last-played", {
								date: formatDate(props.world.lastPlayedAt),
							})}
						>
							<TimerIcon class={styles["filled-icon"]} />
							{formatDate(props.world.lastPlayedAt)}
						</span>
						<span
							class={styles["metadata-item"]}
							title={t("instances-worlds-size", {
								size: formatBytes(props.world.sizeBytes),
							})}
							aria-label={t("instances-worlds-size", {
								size: formatBytes(props.world.sizeBytes),
							})}
						>
							<StorageIcon class={styles["outline-icon"]} />
							{formatBytes(props.world.sizeBytes)}
						</span>
						<span
							class={styles["metadata-item"]}
							title={t("instances-worlds-datapack-count-aria", {
								count: props.world.datapackCount,
							})}
							aria-label={t("instances-worlds-datapack-count-aria", {
								count: props.world.datapackCount,
							})}
						>
							<DatapackIcon class={styles["outline-icon"]} />
							{props.world.datapackCount}
						</span>
					</div>
				</div>
				<div class={styles["card-actions"]}>
					<DropdownMenu>
						<DropdownMenuTrigger
							as="button"
							type="button"
							class={styles["menu-trigger"]}
							aria-label={t("instances-worlds-actions-aria", {
								name: props.world.displayName,
							})}
							onClick={(event: MouseEvent) => event.stopPropagation()}
						>
							<MoreIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent
							class={styles.menu}
							onCloseAutoFocus={(event) => event.preventDefault()}
						>
							<For each={actions()}>
								{(action) => (
									<>
										<Show when={action.separatorBefore}>
											<DropdownMenuSeparator />
										</Show>
										<DropdownMenuItem
											disabled={action.disabled}
											class={
												action.destructive
													? styles["delete-action"]
													: undefined
											}
											onSelect={action.run}
										>
											<ActionLabel action={action} />
										</DropdownMenuItem>
									</>
								)}
							</For>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent class={styles.menu}>
				<For each={actions()}>
					{(action) => (
						<>
							<Show when={action.separatorBefore}>
								<ContextMenuSeparator />
							</Show>
							<ContextMenuItem
								disabled={action.disabled}
								class={
									action.destructive ? styles["delete-action"] : undefined
								}
								onSelect={action.run}
							>
								<ActionLabel action={action} />
							</ContextMenuItem>
						</>
					)}
				</For>
			</ContextMenuContent>
		</ContextMenu>
	);
};

export const sortWorlds = (worlds: readonly WorldSummary[], sort: SortMode) =>
	[...worlds].sort((left, right) => {
		if (sort === "name")
			return left.displayName.localeCompare(right.displayName, undefined, {
				sensitivity: "base",
			});
		if (sort === "size")
			return (
				right.sizeBytes - left.sizeBytes ||
				left.displayName.localeCompare(right.displayName)
			);
		const timestamp = (value: string | null) => {
			const parsed = value ? new Date(value).getTime() : Number.NaN;
			return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
		};
		const leftTime = timestamp(left.lastPlayedAt);
		const rightTime = timestamp(right.lastPlayedAt);
		return (
			rightTime - leftTime ||
			left.displayName.localeCompare(right.displayName, undefined, {
				sensitivity: "base",
			})
		);
	});

export const WorldsTab: Component<{
	instance: Instance;
	selectedWorldDirectory?: string | null;
	onSelectedWorldChange: (directoryName: string | null) => void;
	onAddDatapack: (world: WorldSummary) => void;
	onOpenDatapackDetails: (
		world: WorldSummary,
		entry: import("@stores/worlds").WorldDatapackSummary,
	) => void;
}> = (props) => {
	const [sort, setSort] = createSignal<SortMode>("recency");
	const [view, setView] = createSignal<ViewMode>("grid");
	const [pending, setPending] = createSignal<PendingTransfer | null>(null);
	const [busyWorld, setBusyWorld] = createSignal<string | null>(null);

	createEffect(() => void listInstanceWorlds(props.instance.id));
	const worlds = createMemo(() =>
		sortWorlds(worldsState.byInstance[props.instance.id] ?? [], sort()),
	);
	const selectedWorld = createMemo(() =>
		props.selectedWorldDirectory
			? (worldsState.byInstance[props.instance.id] ?? []).find(
					(world) => world.ref.directoryName === props.selectedWorldDirectory,
				)
			: undefined,
	);
	createEffect(() => {
		if (
			props.selectedWorldDirectory &&
			worldsState.byInstance[props.instance.id] !== undefined &&
			!worldsState.loading[props.instance.id] &&
			!selectedWorld()
		) {
			props.onSelectedWorldChange(null);
		}
	});
	const destinations = createMemo(() =>
		instancesState.instances.filter(
			(candidate) => candidate.id !== props.instance.id,
		),
	);
	const destinationOptions = createMemo<InstanceSelectionOption[]>(() =>
		destinations().map((instance) => ({ instance })),
	);

	const performTransfer = async (
		world: WorldSummary,
		destination: Instance,
		mode: WorldTransferMode,
	) => {
		const warnings = getWorldTransferWarnings(
			world,
			props.instance,
			destination,
		);
		let acknowledged = warnings.length === 0;
		if (warnings.length > 0) {
			acknowledged = await dialogStore.confirm(
				transferCompatTitle(mode),
				warnings.map((warning) => `• ${warning}`).join("\n"),
				{
					okLabel: transferConfirmLabel(mode),
					severity: "warning",
				},
			);
		}
		if (!acknowledged) return;

		setPending(null);
		setBusyWorld(world.ref.directoryName);
		try {
			await transferWorld(world.ref, destination.id, mode, acknowledged);
			showToast({
				title: transferStartedTitle(mode),
				description: t("instances-worlds-transfer-started-description"),
				severity: "success",
			});
		} catch (error) {
			showToast({
				title: t("instances-worlds-transfer-failed"),
				description: String(error),
				severity: "error",
			});
		} finally {
			setBusyWorld(null);
		}
	};

	const performDelete = async (world: WorldSummary) => {
		const confirmed = await dialogStore.confirm(
			t("instances-worlds-delete-title", { name: world.displayName }),
			t("instances-worlds-delete-description", {
				instanceName: props.instance.name,
			}),
			{
				okLabel: t("instances-worlds-delete-confirm"),
				severity: "warning",
				isDestructive: true,
			},
		);
		if (!confirmed) return;

		setBusyWorld(world.ref.directoryName);
		try {
			await deleteWorld(world.ref);
			if (props.selectedWorldDirectory === world.ref.directoryName) {
				props.onSelectedWorldChange(null);
			}
			showToast({
				title: t("instances-worlds-deleted-title"),
				description: t("instances-worlds-deleted-description", {
					name: world.displayName,
					instanceName: props.instance.name,
				}),
				severity: "success",
			});
		} catch (error) {
			showToast({
				title: t("instances-worlds-delete-failed"),
				description: String(error),
				severity: "error",
			});
		} finally {
			setBusyWorld(null);
		}
	};

	return (
		<Show
			when={selectedWorld()}
			fallback={
				<section class={styles.root} aria-label={t("instances-worlds-section-aria")}>
					<header class={styles.toolbar}>
						<div class={styles.title}>
							<h2>{t("instances-worlds-title")}</h2>
						</div>
						<div class={styles.controls}>
							<Select
								value={sort()}
								onChange={(value) => value && setSort(value as SortMode)}
								options={sortOptions().map((option) => option.value)}
								itemComponent={(itemProps) => (
									<SelectItem item={itemProps.item}>
										{sortOptions().find(
											(option) => option.value === itemProps.item.rawValue,
										)?.label ?? itemProps.item.rawValue}
									</SelectItem>
								)}
							>
								<SelectTrigger
									class={styles["sort-select"]}
									aria-label={t("instances-worlds-sort-aria")}
								>
									<SelectValue<string>>
										{(state) =>
											sortOptions().find(
												(option) => option.value === state.selectedOption(),
											)?.label ?? t("instances-worlds-sort-recency")
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent />
							</Select>
							<ToggleGroup
								value={view()}
								onChange={(value) => value && setView(value as ViewMode)}
								aria-label={t("instances-worlds-layout-aria")}
							>
								<ToggleGroupItem
									value="grid"
									icon_only
									aria-label={t("instances-worlds-view-grid")}
									title={t("instances-worlds-view-grid")}
								>
									<GridIcon />
								</ToggleGroupItem>
								<ToggleGroupItem
									value="compact"
									icon_only
									aria-label={t("instances-worlds-view-compact")}
									title={t("instances-worlds-view-compact")}
								>
									<ListIcon />
								</ToggleGroupItem>
							</ToggleGroup>
							<Button
								size="sm"
								variant="ghost"
								icon_only
								class={styles["refresh-button"]}
								tooltip_text={t("instances-worlds-refresh")}
								aria-label={t("instances-worlds-refresh")}
								disabled={worldsState.loading[props.instance.id]}
								onClick={() => void listInstanceWorlds(props.instance.id, true)}
							>
								<ReloadIcon />
							</Button>
						</div>
					</header>

					<Show
						when={
							!worldsState.loading[props.instance.id] || worlds().length > 0
						}
						fallback={
							<div class={styles.loading}>{t("instances-worlds-loading")}</div>
						}
					>
						<Show
							when={!worldsState.errors[props.instance.id]}
							fallback={
								<div class={styles.error}>
									{t("instances-worlds-load-error", {
										error: worldsState.errors[props.instance.id] ?? "",
									})}
								</div>
							}
						>
							<Show
								when={worlds().length > 0}
								fallback={
									<div class={styles.empty}>{t("instances-worlds-empty")}</div>
								}
							>
								<div class={styles.worlds} data-view={view()}>
									<For each={worlds()}>
										{(world) => {
											const busy = () =>
												busyWorld() === world.ref.directoryName;
											return (
												<WorldCard
													world={world}
													busy={busy()}
													onMove={() => setPending({ world, mode: "move" })}
													onCopy={() => setPending({ world, mode: "copy" })}
													onOpen={() =>
														props.onSelectedWorldChange(world.ref.directoryName)
													}
													onManageDatapacks={() =>
														props.onSelectedWorldChange(world.ref.directoryName)
													}
													onDuplicate={() =>
														void performTransfer(
															world,
															props.instance,
															"duplicate",
														)
													}
													onDelete={() => void performDelete(world)}
												/>
											);
										}}
									</For>
								</div>
							</Show>
						</Show>
					</Show>

					<InstanceSelectionDialog
						isOpen={Boolean(pending())}
						title={
							pending()?.mode === "move"
								? t("instances-worlds-transfer-dialog-title-move", {
										name:
											pending()?.world.displayName ??
											t("instances-worlds-transfer-dialog-fallback-name"),
									})
								: t("instances-worlds-transfer-dialog-title-copy", {
										name:
											pending()?.world.displayName ??
											t("instances-worlds-transfer-dialog-fallback-name"),
									})
						}
						description={t("instances-worlds-transfer-dialog-description")}
						options={destinationOptions()}
						emptyMessage={t("instances-worlds-transfer-dialog-empty")}
						onClose={() => setPending(null)}
						onSelect={(destination) => {
							const action = pending();
							if (action)
								void performTransfer(action.world, destination, action.mode);
						}}
					/>
				</section>
			}
		>
			{(world) => (
				<WorldDatapacksView
					world={world()}
					onBack={() => props.onSelectedWorldChange(null)}
					onAddDatapack={props.onAddDatapack}
					onOpenDatapackDetails={props.onOpenDatapackDetails}
				/>
			)}
		</Show>
	);
};
