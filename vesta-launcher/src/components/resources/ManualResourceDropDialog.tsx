import { WorldSelectionDialog } from "@components/worlds/WorldSelectionDialog";
import {
	type DropResourceKind,
	type ManualDropResponse,
	manualDropRequest,
	manualDropSubmitting,
	type ResourceDropSelection,
	submitManualDropChoice,
} from "@stores/manual-resource-drops";
import type { WorldRef } from "@stores/worlds";
import Button from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { t } from "~/localization";
import styles from "./manual-resource-drop-dialog.module.css";

export function dropResourceKindLabel(kind: DropResourceKind): string {
	switch (kind) {
		case "mod":
			return t("resource-drop-kind-mod");
		case "dataPack":
			return t("resource-drop-kind-datapack");
		case "resourcePack":
			return t("resource-drop-kind-resourcepack");
		case "shader":
			return t("resource-drop-kind-shader");
		case "world":
			return t("resource-drop-kind-world");
		case "modpack":
			return t("resource-drop-kind-modpack");
	}
}

export function ManualResourceDropDialog() {
	const [selected, setSelected] = createSignal<Record<string, boolean>>({});
	const [kinds, setKinds] = createSignal<
		Record<string, DropResourceKind | undefined>
	>({});
	const [step, setStep] = createSignal<"review" | "world">("review");
	const [remember, setRemember] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	let currentDecisionId: string | undefined;

	createEffect(() => {
		const request = manualDropRequest();
		if (request?.decisionId === currentDecisionId) return;
		currentDecisionId = request?.decisionId;
		setError(null);
		setRemember(false);
		setSelected(
			Object.fromEntries(
				(request?.candidates ?? []).map((candidate) => [
					candidate.id,
					!candidate.kinds.includes("modpack"),
				]),
			),
		);
		setKinds(
			Object.fromEntries(
				(request?.candidates ?? []).map((candidate) => [
					candidate.id,
					candidate.kinds.length === 1 ? candidate.kinds[0] : undefined,
				]),
			),
		);
		setStep(
			request?.phase === "resources" &&
				request.notes.length === 0 &&
				request.candidates.length > 0 &&
				request.candidates.every(
					(candidate) =>
						candidate.kinds.length === 1 && candidate.kinds[0] === "dataPack",
				)
				? "world"
				: "review",
		);
	});

	const selections = createMemo<ResourceDropSelection[]>(() =>
		(manualDropRequest()?.candidates ?? []).flatMap((candidate) => {
			const kind = kinds()[candidate.id];
			return selected()[candidate.id] && kind && kind !== "modpack"
				? [{ candidateId: candidate.id, kind }]
				: [];
		}),
	);
	const incompleteSelection = () =>
		(manualDropRequest()?.candidates ?? []).some(
			(candidate) => selected()[candidate.id] && !kinds()[candidate.id],
		);
	const busy = () => manualDropSubmitting();

	const submit = async (response: ManualDropResponse) => {
		const request = manualDropRequest();
		if (!request || busy()) return;
		setError(null);
		try {
			await submitManualDropChoice(request, response);
		} catch (reason) {
			if (manualDropRequest()?.decisionId === request.decisionId)
				setError(reason instanceof Error ? reason.message : String(reason));
		}
	};
	const cancel = () => void submit({ cancel: true });
	const continueInstall = () => {
		if (busy() || incompleteSelection() || selections().length === 0) return;
		if (selections().some((selection) => selection.kind === "dataPack"))
			setStep("world");
		else void submit({ selections: selections() });
	};
	const selectWorld = (world: WorldRef) => {
		if (world.instanceId !== manualDropRequest()?.instanceId) return;
		void submit({
			selections: selections().map((selection) =>
				selection.kind === "dataPack" ? { ...selection, world } : selection,
			),
		});
	};

	return (
		<>
			<WorldSelectionDialog
				isOpen={
					manualDropRequest()?.phase === "resources" && step() === "world"
				}
				initialInstanceId={manualDropRequest()?.instanceId}
				projectName={t("resource-drop-datapack-batch", {
					count: selections().filter(
						(selection) => selection.kind === "dataPack",
					).length,
				})}
				selectionPending={busy()}
				selectionError={error()}
				onClose={cancel}
				onSelect={selectWorld}
			/>
			<Dialog
				open={Boolean(manualDropRequest()) && step() === "review"}
				onOpenChange={(open) => !open && cancel()}
			>
				<DialogContent
					class={`${styles.dialog} ${manualDropRequest()?.phase === "dependencies" ? styles.dependencies : ""}`}
				>
					<DialogHeader>
						<DialogTitle>
							{manualDropRequest()?.phase === "dependencies"
								? t("resource-drop-dependencies-title")
								: t("resource-drop-review-title")}
						</DialogTitle>
						<DialogDescription>
							{manualDropRequest()?.phase === "dependencies"
								? t("resource-drop-dependencies-description")
								: t("resource-drop-review-description", {
										instance: manualDropRequest()?.instanceName ?? "",
									})}
						</DialogDescription>
					</DialogHeader>
					<div class={styles.list}>
						<Show
							when={manualDropRequest()?.phase === "resources"}
							fallback={
								<For each={manualDropRequest()?.dependencies ?? []}>
									{(dependency) => (
										<div class={styles.row}>
											<span class={styles.name}>{dependency.name}</span>
											<span class={styles.meta}>{dependency.version}</span>
										</div>
									)}
								</For>
							}
						>
							<For each={manualDropRequest()?.candidates ?? []}>
								{(candidate) => (
									<div class={styles.row}>
										<label class={styles.choice}>
											<input
												type="checkbox"
												checked={selected()[candidate.id] ?? false}
												disabled={busy() || candidate.kinds.includes("modpack")}
												onChange={(event) =>
													setSelected((current) => ({
														...current,
														[candidate.id]: event.currentTarget.checked,
													}))
												}
											/>
											<span class={styles.name}>{candidate.name}</span>
										</label>
										<Show
											when={candidate.kinds.length > 1}
											fallback={
												<span class={styles.meta}>
													{dropResourceKindLabel(candidate.kinds[0])}
												</span>
											}
										>
											<Select<DropResourceKind>
												options={candidate.kinds.filter(
													(kind) => kind !== "modpack",
												)}
												value={kinds()[candidate.id]}
												disabled={busy() || !selected()[candidate.id]}
												placeholder={t("resource-drop-choose-type")}
												optionTextValue={dropResourceKindLabel}
												onChange={(kind) =>
													setKinds((current) => ({
														...current,
														[candidate.id]: kind ?? undefined,
													}))
												}
												itemComponent={(props) => (
													<SelectItem item={props.item}>
														{dropResourceKindLabel(props.item.rawValue)}
													</SelectItem>
												)}
											>
												<SelectTrigger
													aria-label={t("resource-drop-type-for", {
														name: candidate.name,
													})}
												>
													<SelectValue<DropResourceKind>>
														{(state) => {
															const kind = state.selectedOption();
															return kind
																? dropResourceKindLabel(kind)
																: t("resource-drop-choose-type");
														}}
													</SelectValue>
												</SelectTrigger>
												<SelectContent />
											</Select>
										</Show>
									</div>
								)}
							</For>
						</Show>
					</div>
					<For each={manualDropRequest()?.notes ?? []}>
						{(note) => <p class={styles.note}>{note}</p>}
					</For>
					<Show when={manualDropRequest()?.phase === "dependencies"}>
						<label class={styles.remember}>
							<input
								type="checkbox"
								checked={remember()}
								disabled={busy()}
								onChange={(event) => setRemember(event.currentTarget.checked)}
							/>
							{t("resource-drop-remember")}
						</label>
					</Show>
					<Show when={error()}>
						{(message) => (
							<p class={styles.error} role="alert">
								{message()}
							</p>
						)}
					</Show>
					<Show
						when={
							manualDropRequest()?.phase === "resources" &&
							manualDropRequest()?.candidates.some((candidate) =>
								candidate.kinds.includes("modpack"),
							)
						}
					>
						<p class={styles.note}>{t("resource-drop-modpack-rejected")}</p>
					</Show>
					<div class={styles.footer}>
						<Show
							when={manualDropRequest()?.phase === "dependencies"}
							fallback={
								<>
									<Button variant="ghost" disabled={busy()} onClick={cancel}>
										{t("generic-action-cancel")}
									</Button>
									<Button
										color="primary"
										disabled={
											busy() ||
											incompleteSelection() ||
											selections().length === 0
										}
										onClick={continueInstall}
									>
										{t("resource-drop-install-selected")}
									</Button>
								</>
							}
						>
							<Button
								variant="ghost"
								disabled={busy()}
								onClick={() =>
									void submit({
										downloadDependencies: false,
										remember: remember(),
									})
								}
							>
								{t("resource-drop-keep-only")}
							</Button>
							<Button
								color="primary"
								disabled={busy()}
								onClick={() =>
									void submit({
										downloadDependencies: true,
										remember: remember(),
									})
								}
							>
								{t("resource-drop-download-dependencies")}
							</Button>
						</Show>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
