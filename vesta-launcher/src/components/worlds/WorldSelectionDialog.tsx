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
import { t } from "~/localization";

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
		return t("shared-ui-world-level-unreadable");
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
				title={t("shared-ui-choose-instance")}
				description={t("shared-ui-choose-owning-instance-description", { projectName: props.projectName ?? "this datapack" })}
				options={instanceOptions()}
				emptyMessage={t("shared-ui-create-instance-before-datapack")}
				onClose={props.onClose}
				onSelect={(instance) => selectInstance(instance.id)}
			/>

			<Dialog
				open={props.isOpen && instanceId() != null}
				onOpenChange={(open) => !open && props.onClose()}
			>
				<DialogContent class={styles.dialog}>
					<DialogHeader>
						<DialogTitle>{t("shared-ui-choose-world")}</DialogTitle>
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
								{t("shared-ui-choose-another-instance")}
							</button>
						</Show>

						<Show
							when={!loading()}
							fallback={<div class={styles.loading}>{t("instances-worlds-loading")}</div>}
						>
							<Show
								when={!error() && worlds().length > 0}
								fallback={
									<div class={styles.empty}>
										<strong>
											{error()
												? t("shared-ui-failed-to-load-worlds")
												: t("shared-ui-no-java-worlds-yet")}
										</strong>
										<p>
											{error() ??
												t("shared-ui-create-world-before-returning", { instanceName: selectedInstance()?.name ?? "this instance" })}
										</p>
									</div>
								}
							>
								<div class={styles.list} aria-label={t("instances-worlds-section-aria")}>
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
																	? t("shared-ui-data-version", { version: world.dataVersion })
																	: t("shared-ui-unknown-version"))}
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
