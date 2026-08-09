import CubeIcon from "@assets/cube.svg";
import ReloadIcon from "@assets/reload.svg";
import TimerIcon from "@assets/timer.svg";
import InstanceSelectionDialog, {
	type InstanceSelectionOption,
} from "@components/instances/InstanceSelectionDialog";
import { WorldIcon } from "@components/worlds/WorldIcon";
import { dialogStore } from "@stores/dialog-store";
import { instancesState, type Instance } from "@stores/instances";
import {
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
import styles from "./WorldsTab.module.css";
import { getWorldTransferWarnings } from "./world-transfer";

type SortMode = "recency" | "name" | "size";
type ViewMode = "grid" | "list";
type PendingTransfer = {
	world: WorldSummary;
	mode: Exclude<WorldTransferMode, "duplicate">;
};

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
	{ value: "recency", label: "Recently played" },
	{ value: "name", label: "Name" },
	{ value: "size", label: "Size" },
];

type WorldAction = {
	label: string;
	disabled?: boolean;
	separatorBefore?: boolean;
	icon: Component;
	run: () => void;
};

const FolderIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M3 6.5h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z" />
	</svg>
);

const MoveIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M4 12h16m-5-5 5 5-5 5" />
	</svg>
);

const CopyIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<rect x="8" y="8" width="11" height="11" rx="2" />
		<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
	</svg>
);

const DuplicateIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<rect x="5" y="5" width="12" height="12" rx="2" />
		<path d="M9 17v2h8a2 2 0 0 0 2-2V9h-2M11 8v6m-3-3h6" />
	</svg>
);

const MoreIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<circle cx="12" cy="5" r="1.5" />
		<circle cx="12" cy="12" r="1.5" />
		<circle cx="12" cy="19" r="1.5" />
	</svg>
);

const GridIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<rect x="3" y="3" width="7" height="7" />
		<rect x="14" y="3" width="7" height="7" />
		<rect x="14" y="14" width="7" height="7" />
		<rect x="3" y="14" width="7" height="7" />
	</svg>
);

const ListIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
	</svg>
);

const StorageIcon: Component = () => (
	<svg class={styles["outline-icon"]} viewBox="0 0 24 24" aria-hidden="true">
		<ellipse cx="12" cy="5" rx="8" ry="3" />
		<path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
	</svg>
);

const DatapackIcon: Component = () => (
	<svg class={styles["outline-icon"]} viewBox="0 0 24 24" aria-hidden="true">
		<path d="m12 3 9 5-9 5-9-5 9-5Z" />
		<path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
	</svg>
);

const ActionLabel: Component<{ action: WorldAction }> = (props) => (
	<span class={styles["menu-action"]}>
		<props.action.icon />
		{props.action.label}
	</span>
);

const WorldCard: Component<{
	world: WorldSummary;
	busy: boolean;
	onMove: () => void;
	onCopy: () => void;
	onDuplicate: () => void;
	onManageDatapacks: () => void;
}> = (props) => {
	const actions = (): WorldAction[] => [
		{
			label: "Open folder",
			icon: FolderIcon,
			run: () => void openWorldFolder(props.world.ref),
		},
		{
			label: "Manage datapacks",
			icon: DatapackIcon,
			run: props.onManageDatapacks,
		},
		{
			label: "Move to another instance…",
			icon: MoveIcon,
			disabled: props.busy,
			separatorBefore: true,
			run: props.onMove,
		},
		{
			label: "Copy to another instance…",
			icon: CopyIcon,
			disabled: props.busy,
			run: props.onCopy,
		},
		{
			label: "Duplicate",
			icon: DuplicateIcon,
			disabled: props.busy,
			run: props.onDuplicate,
		},
	];
	const version = () =>
		props.world.gameVersion ??
		(props.world.dataVersion != null
			? `DataVersion ${props.world.dataVersion}`
			: "Unknown");
	return (
		<ContextMenu>
			<ContextMenuTrigger as="article" class={styles.card}>
				<div class={styles.media}>
					<WorldIcon
						class={styles["media-image"]}
						src={props.world.iconDataUrl}
						name={props.world.displayName}
					/>
					<div class={styles["media-fade"]} aria-hidden="true" />
					<Show
						when={props.world.levelStatus === "unreadable"}
					>
						<Badge variant="error" class={styles["world-status"]}>
							Unreadable
						</Badge>
					</Show>
					<DropdownMenu>
						<DropdownMenuTrigger
							as="button"
							type="button"
							class={styles["menu-trigger"]}
							aria-label={`Actions for ${props.world.displayName}`}
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

				<div class={styles["card-body"]}>
					<div class={styles.identity}>
						<div class={styles["identity-copy"]}>
							<h3
								class={styles.name}
								title={
									props.world.folderName === props.world.displayName
										? props.world.displayName
										: `${props.world.displayName} (${props.world.folderName})`
								}
							>
								{props.world.displayName}
							</h3>
						</div>
						<Badge
							variant="surface"
							pill
							class={styles["version-badge"]}
							title={`Minecraft ${version()}`}
						>
							<CubeIcon class={styles["filled-icon"]} />
							{version()}
						</Badge>
					</div>
					<div class={styles.metadata}>
						<span
							class={styles["metadata-item"]}
							title={`Last played ${formatDate(props.world.lastPlayedAt)}`}
							aria-label={`Last played ${formatDate(props.world.lastPlayedAt)}`}
						>
							<TimerIcon class={styles["filled-icon"]} />
							{formatDate(props.world.lastPlayedAt)}
						</span>
						<span
							class={styles["metadata-item"]}
							title={`World size ${formatBytes(props.world.sizeBytes)}`}
							aria-label={`World size ${formatBytes(props.world.sizeBytes)}`}
						>
							<StorageIcon />
							{formatBytes(props.world.sizeBytes)}
						</span>
						<button
							type="button"
							class={`${styles["metadata-item"]} ${styles["metadata-button"]}`}
							title={`Manage ${props.world.datapackCount} datapacks`}
							aria-label={`Manage ${props.world.datapackCount} datapacks in ${props.world.displayName}`}
							onClick={(event: MouseEvent) => {
								event.stopPropagation();
								props.onManageDatapacks();
							}}
						>
							<DatapackIcon />
							{props.world.datapackCount}
						</button>
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent class={styles.menu}>
				<For each={actions()}>
					{(action) => (
						<>
							<Show when={action.separatorBefore}>
								<ContextMenuSeparator />
							</Show>
							<ContextMenuItem disabled={action.disabled} onSelect={action.run}>
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
	onManageDatapacks: (world: WorldSummary) => void;
}> = (props) => {
	const [sort, setSort] = createSignal<SortMode>("recency");
	const [view, setView] = createSignal<ViewMode>("grid");
	const [pending, setPending] = createSignal<PendingTransfer | null>(null);
	const [busyWorld, setBusyWorld] = createSignal<string | null>(null);

	createEffect(() => void listInstanceWorlds(props.instance.id));
	const worlds = createMemo(() =>
		sortWorlds(worldsState.byInstance[props.instance.id] ?? [], sort()),
	);
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
				`${mode === "move" ? "Move" : mode === "copy" ? "Copy" : "Duplicate"} with compatibility differences?`,
				warnings.map((warning) => `• ${warning}`).join("\n"),
				{
					okLabel:
						mode === "move"
							? "Move world"
							: mode === "copy"
								? "Copy world"
								: "Duplicate world",
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
				title: `${mode === "move" ? "Move" : mode === "copy" ? "Copy" : "Duplicate"} started`,
				description: "Progress is available in notifications.",
				severity: "success",
			});
		} catch (error) {
			showToast({
				title: "World transfer failed",
				description: String(error),
				severity: "error",
			});
		} finally {
			setBusyWorld(null);
		}
	};

	return (
		<section class={styles.root} aria-label="Worlds">
			<header class={styles.toolbar}>
				<div class={styles.title}>
					<h2>Worlds</h2>
				</div>
				<div class={styles.controls}>
					<Select
						value={sort()}
						onChange={(value) => value && setSort(value as SortMode)}
						options={SORT_OPTIONS.map((option) => option.value)}
						itemComponent={(itemProps) => (
							<SelectItem item={itemProps.item}>
								{SORT_OPTIONS.find(
									(option) => option.value === itemProps.item.rawValue,
								)?.label ?? itemProps.item.rawValue}
							</SelectItem>
						)}
					>
						<SelectTrigger class={styles["sort-select"]} aria-label="Sort worlds">
							<SelectValue<string>>
								{(state) =>
									SORT_OPTIONS.find(
										(option) => option.value === state.selectedOption(),
									)?.label ?? "Recently played"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
					<ToggleGroup
						value={view()}
						onChange={(value) => value && setView(value as ViewMode)}
						aria-label="World layout"
					>
						<ToggleGroupItem
							value="grid"
							icon_only
							aria-label="Grid view"
							title="Grid view"
						>
							<GridIcon />
						</ToggleGroupItem>
						<ToggleGroupItem
							value="list"
							icon_only
							aria-label="List view"
							title="List view"
						>
							<ListIcon />
						</ToggleGroupItem>
					</ToggleGroup>
					<Button
						size="sm"
						variant="ghost"
						icon_only
						class={styles["refresh-button"]}
						tooltip_text="Refresh worlds"
						aria-label="Refresh worlds"
						disabled={worldsState.loading[props.instance.id]}
						onClick={() => void listInstanceWorlds(props.instance.id, true)}
					>
						<ReloadIcon />
					</Button>
				</div>
			</header>

			<Show
				when={!worldsState.loading[props.instance.id] || worlds().length > 0}
				fallback={<div class={styles.loading}>Finding worlds…</div>}
			>
				<Show
					when={!worldsState.errors[props.instance.id]}
					fallback={
						<div class={styles.error}>
							Worlds could not be loaded:{" "}
							{worldsState.errors[props.instance.id]}
						</div>
					}
				>
					<Show
						when={worlds().length > 0}
						fallback={
							<div class={styles.empty}>
								No Java worlds found. Create and play a world in Minecraft and
								it will appear here.
							</div>
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
											onManageDatapacks={() =>
												props.onManageDatapacks(world)
											}
											onDuplicate={() =>
												void performTransfer(
													world,
													props.instance,
													"duplicate",
												)
											}
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
				title={`${pending()?.mode === "move" ? "Move" : "Copy"} ${pending()?.world.displayName ?? "world"}`}
				description="Choose a destination instance. Existing worlds are never overwritten or merged."
				options={destinationOptions()}
				emptyMessage="No other instances are available for this transfer."
				onClose={() => setPending(null)}
				onSelect={(destination) => {
					const action = pending();
					if (action)
						void performTransfer(
							action.world,
							destination,
							action.mode,
						);
				}}
			/>
		</section>
	);
};
