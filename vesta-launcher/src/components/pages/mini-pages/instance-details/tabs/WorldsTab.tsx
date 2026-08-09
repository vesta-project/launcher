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
import Button from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import { showToast } from "@ui/toast/toast";
import { formatDate } from "@utils/date";
import { formatBytes } from "@utils/format-bytes";
import { getInstanceSlug } from "@utils/instances";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";
import { WorldIcon } from "@components/worlds/WorldIcon";
import styles from "./WorldsTab.module.css";
import { getWorldTransferWarnings } from "./world-transfer";

type SortMode = "recency" | "name" | "size";
type ViewMode = "grid" | "list";
type PendingTransfer = {
	world: WorldSummary;
	mode: Exclude<WorldTransferMode, "duplicate">;
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

export const WorldsTab: Component<{ instance: Instance }> = (props) => {
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
	const destinationRunning = (destination: Instance) =>
		Boolean(instancesState.runningIds[getInstanceSlug(destination)]);

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
					<p>
						{worlds().length} Java {worlds().length === 1 ? "world" : "worlds"}{" "}
						in this instance
					</p>
				</div>
				<div class={styles.controls}>
					<select
						class={styles.select}
						aria-label="Sort worlds"
						value={sort()}
						onChange={(event) => setSort(event.currentTarget.value as SortMode)}
					>
						<option value="recency">Recently played</option>
						<option value="name">Name</option>
						<option value="size">Size</option>
					</select>
					<div class={styles.segmented} aria-label="World layout">
						<button
							type="button"
							data-active={view() === "grid"}
							aria-pressed={view() === "grid"}
							onClick={() => setView("grid")}
						>
							Grid
						</button>
						<button
							type="button"
							data-active={view() === "list"}
							aria-pressed={view() === "list"}
							onClick={() => setView("list")}
						>
							List
						</button>
					</div>
					<Button
						size="sm"
						variant="outline"
						disabled={worldsState.loading[props.instance.id]}
						onClick={() => void listInstanceWorlds(props.instance.id, true)}
					>
						Refresh
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
									const disabled = () =>
										world.running ||
										world.levelStatus === "unreadable" ||
										busyWorld() === world.ref.directoryName;
									return (
										<article class={styles.card}>
											<div class={styles["card-main"]}>
												<WorldIcon
													class={styles.icon}
													src={world.iconDataUrl}
													name={world.displayName}
												/>
												<div class={styles.copy}>
													<h3 class={styles.name}>{world.displayName}</h3>
													<div class={styles.folder}>{world.folderName}</div>
													<div class={styles.facts}>
														<span>{formatDate(world.lastPlayedAt)}</span>
														<span>{formatBytes(world.sizeBytes)}</span>
														<span>
															{world.gameVersion ??
																(world.dataVersion != null
																	? `DataVersion ${world.dataVersion}`
																	: "Unknown version")}
														</span>
														<span>
															{world.datapackCount} datapack
															{world.datapackCount === 1 ? "" : "s"}
														</span>
													</div>
													<Show
														when={
															world.running ||
															world.levelStatus === "unreadable"
														}
													>
														<div class={styles.status}>
															{world.running
																? "Close Minecraft to transfer this world."
																: "Level data is unreadable."}
														</div>
													</Show>
												</div>
											</div>
											<div class={styles.actions}>
												<button
													type="button"
													onClick={() => void openWorldFolder(world.ref)}
												>
													Open folder
												</button>
												<button
													type="button"
													disabled={disabled()}
													onClick={() => setPending({ world, mode: "move" })}
												>
													Move
												</button>
												<button
													type="button"
													disabled={disabled()}
													onClick={() => setPending({ world, mode: "copy" })}
												>
													Copy
												</button>
												<button
													type="button"
													disabled={disabled()}
													onClick={() =>
														void performTransfer(
															world,
															props.instance,
															"duplicate",
														)
													}
												>
													Duplicate
												</button>
											</div>
										</article>
									);
								}}
							</For>
						</div>
					</Show>
				</Show>
			</Show>

			<Dialog
				open={Boolean(pending())}
				onOpenChange={(open) => !open && setPending(null)}
			>
				<DialogContent class={styles["destination-dialog"]}>
					<DialogHeader>
						<DialogTitle>
							{pending()?.mode === "move" ? "Move" : "Copy"}{" "}
							{pending()?.world.displayName}
						</DialogTitle>
						<DialogDescription>
							Choose a destination instance. Existing worlds are never
							overwritten or merged.
						</DialogDescription>
					</DialogHeader>
					<div class={styles["destination-list"]}>
						<For each={destinations()}>
							{(destination) => (
								<button
									type="button"
									class={styles.destination}
									disabled={destinationRunning(destination)}
									title={
										destinationRunning(destination)
											? "Close Minecraft before transferring a world here."
											: ""
									}
									onClick={() => {
										const action = pending();
										if (action)
											void performTransfer(
												action.world,
												destination,
												action.mode,
											);
									}}
								>
									<span>{destination.name}</span>
									<small>
										{destinationRunning(destination)
											? "Running — close Minecraft first"
											: `${destination.minecraftVersion} · ${destination.modloader || "Vanilla"}`}
									</small>
								</button>
							)}
						</For>
					</div>
				</DialogContent>
			</Dialog>
		</section>
	);
};
