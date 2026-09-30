import {
	submitWorldArchiveSelection,
	type WorldArchiveSelectionRequest,
} from "@stores/worlds";
import { listen } from "@tauri-apps/api/event";
import Button from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import { formatBytes } from "@utils/format-bytes";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { WorldIcon } from "./WorldIcon";
import styles from "./world-archive-selection-dialog.module.css";
import { t } from "~/localization";

export const WorldArchiveSelectionDialog: Component = () => {
	const [request, setRequest] =
		createSignal<WorldArchiveSelectionRequest | null>(null);
	const [selected, setSelected] = createSignal<string[]>([]);
	const [queued, setQueued] = createSignal<WorldArchiveSelectionRequest[]>([]);
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	let unlisten: (() => void) | undefined;
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;

	const advance = () => {
		const [next, ...remaining] = queued();
		setQueued(remaining);
		setRequest(next ?? null);
		setSelected([]);
		setError(null);
	};

	onMount(async () => {
		unlisten = await listen<WorldArchiveSelectionRequest>(
			"core://world-install-selection-required",
			(event) => {
				if (request()) {
					setQueued((current) => [...current, event.payload]);
				} else {
					setRequest(event.payload);
					setSelected([]);
					setError(null);
				}
			},
		);
	});
	onCleanup(() => {
		unlisten?.();
		if (expiryTimer) clearTimeout(expiryTimer);
	});

	createEffect(() => {
		if (expiryTimer) clearTimeout(expiryTimer);
		const current = request();
		if (!current) return;
		const schedule = () => {
			const remaining = Date.parse(current.expiresAt) - Date.now();
			if (remaining > 2_147_483_647) {
				expiryTimer = setTimeout(schedule, 2_147_483_647);
				return;
			}
			expiryTimer = setTimeout(
				() => {
					if (request()?.installId !== current.installId) return;
					void submitWorldArchiveSelection(current.installId, []).catch(
						() => undefined,
					);
					advance();
				},
				Math.max(0, remaining),
			);
		};
		schedule();
	});

	const toggle = (candidateId: string) => {
		setSelected((current) =>
			current.includes(candidateId)
				? current.filter((id) => id !== candidateId)
				: [...current, candidateId],
		);
	};

	const submit = async (ids: string[]) => {
		const current = request();
		if (!current || submitting()) return;
		setSubmitting(true);
		setError(null);
		try {
			await submitWorldArchiveSelection(current.installId, ids);
			advance();
		} catch (reason) {
			setError(String(reason));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog
			open={Boolean(request())}
			onOpenChange={(open) => !open && void submit([])}
		>
			<DialogContent class={styles.dialog}>
				<DialogHeader>
					<DialogTitle>{t("shared-ui-choose-worlds-to-install")}</DialogTitle>
					<DialogDescription>
						{t("shared-ui-world-archive-description", {
							projectName: request()?.project?.name ?? "this project",
						})}
					</DialogDescription>
				</DialogHeader>
				<div class={styles.list} aria-label={t("shared-ui-detected-worlds")}>
					<For each={request()?.candidates ?? []}>
						{(candidate) => (
							<label
								class={styles.candidate}
								data-selected={selected().includes(candidate.id)}
							>
								<input
									type="checkbox"
									checked={selected().includes(candidate.id)}
									onChange={() => toggle(candidate.id)}
								/>
								<WorldIcon src={candidate.iconDataUrl} name={candidate.name} />
								<span class={styles.copy}>
									<span class={styles.name}>{candidate.name}</span>
									<span class={styles.meta}>
										{candidate.folder} · {formatBytes(candidate.sizeBytes)} ·{" "}
										{candidate.gameVersion ??
											(candidate.dataVersion != null
												? t("shared-ui-data-version", { version: candidate.dataVersion })
												: t("shared-ui-unknown-version"))}
									</span>
								</span>
							</label>
						)}
					</For>
				</div>
				<Show when={error()}>
					{(message) => <p class={styles.error}>{message()}</p>}
				</Show>
				<div class={styles.footer}>
					<Button
						variant="ghost"
						disabled={submitting()}
						onClick={() => void submit([])}
					>
						{t("shared-ui-cancel")}
					</Button>
					<Button
						variant="outline"
						disabled={submitting()}
						onClick={() =>
							void submit(
								(request()?.candidates ?? []).map((candidate) => candidate.id),
							)
						}
					>
						{t("shared-ui-install-all")}
					</Button>
					<Button
						color="primary"
						disabled={submitting() || selected().length === 0}
						onClick={() => void submit(selected())}
					>
						{t("shared-ui-install-selected")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
