import InstanceSelectionDialog, {
	type InstanceSelectionOption,
} from "@components/instances/InstanceSelectionDialog";
import { instancesState } from "@stores/instances";
import {
	listInstanceWorlds,
	type WorldRef,
	type WorldSummary,
} from "@stores/worlds";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
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
import { WorldIcon } from "./WorldIcon";
import styles from "./world-selection-dialog.module.css";

export type WorldSelectionDialogProps = {
	isOpen: boolean;
	initialInstanceId?: number | null;
	projectName?: string;
	onClose: () => void;
	onSelect?: (world: WorldRef) => void | Promise<void>;
	onSelectWorld?: (world: WorldSummary) => void | Promise<void>;
};

export const worldDisabledReason = (world: WorldSummary): string | null => {
	if (world.levelStatus === "unreadable")
		return "This world's level data is unreadable.";
	return null;
};

export const WorldSelectionDialog: Component<WorldSelectionDialogProps> = (
	props,
) => {
	const [instanceId, setInstanceId] = createSignal<number | null>(
		props.initialInstanceId ?? null,
	);
	const [worlds, setWorlds] = createSignal<WorldSummary[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	let requestGeneration = 0;

	const selectedInstance = createMemo(() =>
		instancesState.instances.find((instance) => instance.id === instanceId()),
	);
	const instanceOptions = createMemo<InstanceSelectionOption[]>(() =>
		instancesState.instances.map((instance) => ({ instance })),
	);

	createEffect(() => {
		if (!props.isOpen) {
			requestGeneration += 1;
			return;
		}
		setInstanceId(props.initialInstanceId ?? null);
		setWorlds([]);
		setError(null);
	});

	createEffect(() => {
		const id = instanceId();
		if (!props.isOpen || id == null) return;
		const generation = ++requestGeneration;
		setLoading(true);
		setError(null);
		void listInstanceWorlds(id)
			.then((loaded) => {
				if (generation === requestGeneration && instanceId() === id) {
					setWorlds(loaded);
				}
			})
			.catch((reason) => {
				if (generation === requestGeneration && instanceId() === id) {
					setError(String(reason));
				}
			})
			.finally(() => {
				if (generation === requestGeneration) setLoading(false);
			});
	});

	const selectInstance = (id: number) => {
		setWorlds([]);
		setInstanceId(id);
	};

	return (
		<>
			<InstanceSelectionDialog
				isOpen={props.isOpen && instanceId() == null}
				title="Choose an instance"
				description={`First choose the instance that owns the world for ${props.projectName ?? "this datapack"}.`}
				options={instanceOptions()}
				emptyMessage="Create an instance and play a world before installing this datapack."
				onClose={props.onClose}
				onSelect={(instance) => selectInstance(instance.id)}
			/>

			<Dialog
				open={props.isOpen && instanceId() != null}
				onOpenChange={(open) => !open && props.onClose()}
			>
				<DialogContent class={styles.dialog}>
					<DialogHeader>
						<DialogTitle>Choose a world</DialogTitle>
						<DialogDescription>
							Install {props.projectName ?? "this datapack"} into one world.
							Companion packs will use the same instance.
						</DialogDescription>
					</DialogHeader>

					<div class={styles.body}>
						<Show when={props.initialInstanceId == null}>
							<button
								class={styles.back}
								type="button"
								onClick={() => setInstanceId(null)}
							>
								← Choose another instance
							</button>
						</Show>

						<Show
							when={!loading()}
							fallback={<div class={styles.loading}>Finding worlds…</div>}
						>
							<Show
								when={!error() && worlds().length > 0}
								fallback={
									<div class={styles.empty}>
										<strong>
											{error()
												? "Worlds could not be loaded"
												: "No Java worlds yet"}
										</strong>
										<p>
											{error() ??
												`Create and play a world in ${selectedInstance()?.name ?? "this instance"} first, then return here. Vesta will not hold datapacks outside a world.`}
										</p>
									</div>
								}
							>
								<div class={styles.list} aria-label="Worlds">
									<For each={worlds()}>
										{(world) => {
											const disabled = () => worldDisabledReason(world);
											return (
												<button
													class={styles.row}
													type="button"
													disabled={Boolean(disabled())}
													title={disabled() ?? ""}
												onClick={() =>
													void (props.onSelectWorld?.(world) ??
														props.onSelect?.(world.ref))
												}
												>
													<WorldIcon
														src={world.iconDataUrl}
														name={world.displayName}
													/>
													<span class={styles.copy}>
														<span class={styles.name}>{world.displayName}</span>
														<span class={styles.meta}>
															{formatDate(world.lastPlayedAt)} ·{" "}
															{formatBytes(world.sizeBytes)} ·{" "}
															{world.gameVersion ??
																(world.dataVersion != null
																	? `DataVersion ${world.dataVersion}`
																	: "Unknown version")}
														</span>
														<Show when={disabled()}>
															{(reason) => (
																<span class={styles.reason}>{reason()}</span>
															)}
														</Show>
													</span>
												</button>
											);
										}}
									</For>
								</div>
							</Show>
						</Show>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
};
