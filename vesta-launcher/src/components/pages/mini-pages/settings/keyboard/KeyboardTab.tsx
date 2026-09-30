import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import LauncherButton from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { chordFromKeyboardEvent, displayChord } from "~/keybindings/chords";
import {
	assignKeybinding,
	clearKeybinding,
	keybindingCommands,
	keybindingsLoading,
	keybindingsPersistenceError,
	resetKeybinding,
} from "~/keybindings/store";
import type { BindingMutationResult, PersistedCommand } from "~/keybindings/types";
import { t } from "~/localization";
import pageStyles from "../settings-page.module.css";
import styles from "./keyboard-tab.module.css";

type PendingConflict = {
	command: PersistedCommand;
	conflict: PersistedCommand;
	chord: string | null;
	operation: "assign" | "reset";
};

const keybindingLabelIds: Record<string, string> = {
	"app.reload": "settings-extra-keybinding-reload-label",
	"app.close": "settings-extra-keybinding-close-label",
	"navigation.back": "settings-extra-keybinding-back-label",
	"navigation.forward": "settings-extra-keybinding-forward-label",
	"navigation.library": "settings-extra-keybinding-library-label",
	"navigation.new-instance": "app-shell-new-instance",
	"navigation.explore": "app-shell-explore",
	"navigation.pinned.last": "settings-extra-keybinding-last-pinned-label",
	"navigation.settings": "settings-extra-keybinding-settings-label",
	"navigation.notifications": "settings-extra-keybinding-notifications-label",
	"navigation.focus-search": "settings-extra-keybinding-focus-search-label",
};

const keybindingDescriptionIds: Record<string, string> = {
	"app.reload": "settings-extra-keybinding-reload-description",
	"app.close": "settings-extra-keybinding-close-description",
	"navigation.back": "settings-extra-keybinding-back-description",
	"navigation.forward": "settings-extra-keybinding-forward-description",
	"navigation.library": "settings-extra-keybinding-library-description",
	"navigation.new-instance": "settings-extra-keybinding-new-instance-description",
	"navigation.explore": "settings-extra-keybinding-explore-description",
	"navigation.pinned.last": "settings-extra-keybinding-last-pinned-description",
	"navigation.settings": "settings-extra-keybinding-settings-description",
	"navigation.notifications": "settings-extra-keybinding-notifications-description",
	"navigation.focus-search": "settings-extra-keybinding-focus-search-description",
};

function keybindingMessage(
	command: PersistedCommand,
	ids: Record<string, string>,
	value: "label" | "description",
): string {
	const key = ids[command.commandId];
	if (key) return t(key);
	const pinnedSlot = command.commandId.match(/^navigation\.pinned\.(\d+)$/)?.[1];
	if (pinnedSlot) {
		return t(
			value === "label"
				? "settings-extra-keybinding-pinned-item"
				: "settings-extra-keybinding-open-pinned-item",
			{ slot: Number(pinnedSlot) },
		);
	}
	return command[value];
}

function keybindingCategory(category: string): string {
	if (category === "Application") return t("settings-extra-keybinding-category-application");
	if (category === "Navigation") return t("settings-extra-keybinding-category-navigation");
	return category;
}

export function KeyboardSettingsTab() {
	const [recordingId, setRecordingId] = createSignal<string>();
	const [busyId, setBusyId] = createSignal<string>();
	const [status, setStatus] = createSignal("");
	const [pendingConflict, setPendingConflict] = createSignal<PendingConflict>();

	const groupedCommands = createMemo(() => {
		const groups = new Map<string, PersistedCommand[]>();
		for (const command of keybindingCommands()) {
			const group = groups.get(command.category) ?? [];
			group.push(command);
			groups.set(command.category, group);
		}
		return [...groups.entries()].map(([category, commands]) => ({
			category,
			commands: commands.sort(
				(a, b) =>
					a.sortOrder - b.sortOrder ||
					keybindingMessage(a, keybindingLabelIds, "label").localeCompare(
						keybindingMessage(b, keybindingLabelIds, "label"),
					),
			),
		}));
	});

	const applyResult = (
		result: BindingMutationResult,
		operation: PendingConflict["operation"],
		chord: string | null,
	): boolean => {
		if (!result.applied && result.conflict) {
			setRecordingId(undefined);
			setPendingConflict({
				command: result.command,
				conflict: result.conflict,
				chord,
				operation,
			});
			return false;
		}
		setStatus(
			result.command.currentChord
				? t("settings-extra-keyboard-assigned-status", {
						label: keybindingMessage(result.command, keybindingLabelIds, "label"),
						chord: displayChord(result.command.currentChord),
					})
				: t("settings-extra-keyboard-unassigned-status", {
						label: keybindingMessage(result.command, keybindingLabelIds, "label"),
					}),
		);
		return true;
	};

	const saveChord = async (commandId: string, chord: string) => {
		setBusyId(commandId);
		try {
			const result = await assignKeybinding(commandId, chord);
			if (applyResult(result, "assign", chord)) setRecordingId(undefined);
		} catch (error) {
			setStatus(t("settings-extra-keyboard-save-failed", { error: String(error) }));
		} finally {
			setBusyId(undefined);
		}
	};

	const clearShortcut = async (command: PersistedCommand) => {
		setBusyId(command.commandId);
		try {
			const result = await clearKeybinding(command.commandId);
			applyResult(result, "assign", null);
			setRecordingId(undefined);
		} catch (error) {
			setStatus(t("settings-extra-keyboard-clear-failed", { error: String(error) }));
		} finally {
			setBusyId(undefined);
		}
	};

	const restoreDefault = async (command: PersistedCommand) => {
		setBusyId(command.commandId);
		try {
			const result = await resetKeybinding(command.commandId);
			applyResult(result, "reset", command.defaultChord);
		} catch (error) {
			setStatus(t("settings-extra-keyboard-restore-failed", { error: String(error) }));
		} finally {
			setBusyId(undefined);
		}
	};

	onMount(() => {
		const capture = (event: KeyboardEvent) => {
			const commandId = recordingId();
			if (!commandId) return;

			event.preventDefault();
			event.stopImmediatePropagation();

			if (event.key === "Escape") {
				setRecordingId(undefined);
				setStatus(t("settings-extra-keyboard-recording-cancelled"));
				return;
			}

			const command = keybindingCommands().find((item) => item.commandId === commandId);
			if (!command) return;

			if (event.key === "Backspace" || event.key === "Delete") {
				void clearShortcut(command);
				return;
			}

			const chord = chordFromKeyboardEvent(event);
			if (chord) void saveChord(commandId, chord);
		};

		window.addEventListener("keydown", capture, true);
		onCleanup(() => window.removeEventListener("keydown", capture, true));
	});

	const confirmReplacement = async () => {
		const pending = pendingConflict();
		if (!pending) return;
		setBusyId(pending.command.commandId);
		try {
			const result =
				pending.operation === "reset"
					? await resetKeybinding(pending.command.commandId, true)
					: await assignKeybinding(pending.command.commandId, pending.chord as string, true);
			applyResult(result, pending.operation, pending.chord);
			setPendingConflict(undefined);
			setRecordingId(undefined);
		} catch (error) {
			setStatus(t("settings-extra-keyboard-replace-failed", { error: String(error) }));
		} finally {
			setBusyId(undefined);
		}
	};

	return (
		<div class={pageStyles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<Show when={keybindingsPersistenceError()}>
					<SettingsCard>
						<div class={styles.error} role="alert">
							<strong>{t("settings-extra-keyboard-temporary-defaults")}</strong>
							<span>{keybindingsPersistenceError()}</span>
						</div>
					</SettingsCard>
				</Show>

				<Show
					when={!keybindingsLoading()}
					fallback={
						<SettingsCard>
							<div class={styles.loading}>{t("settings-extra-keyboard-loading")}</div>
						</SettingsCard>
					}
				>
					<For each={groupedCommands()}>
						{(group, index) => (
							<SettingsCard
								header={keybindingCategory(group.category)}
								headerRight={
									index() === 0 ? (
										<div
											class={styles.recordingHelp}
											aria-label={t("settings-extra-keyboard-recording-help")}
										>
											<span>{t("settings-extra-keyboard-while-recording")}</span>
											<span class={styles.helpAction}>
												<kbd>Esc</kbd>
												{t("shared-ui-cancel")}
											</span>
											<span class={styles.helpAction}>
												<kbd>⌫</kbd>
												{t("settings-help-action-clear")}
											</span>
										</div>
									) : undefined
								}
							>
								<div class={styles.commands}>
									<For each={group.commands}>
										{(command) => {
											const recording = () => recordingId() === command.commandId;
											const busy = () => busyId() === command.commandId;
											return (
												<div class={styles.command} classList={{ [styles.recording]: recording() }}>
													<SettingsField
														label={keybindingMessage(command, keybindingLabelIds, "label")}
														description={keybindingMessage(command, keybindingDescriptionIds, "description")}
														headerRight={
															<div class={styles.controls}>
																<button
																	type="button"
																	class={styles.capture}
																	disabled={busy()}
																	aria-label={t("settings-extra-keyboard-change-shortcut", {
																		label: keybindingMessage(command, keybindingLabelIds, "label"),
																	})}
																	aria-pressed={recording()}
																	onClick={() => {
																		setRecordingId(recording() ? undefined : command.commandId);
																		setStatus(
																			recording()
																				? t("settings-extra-keyboard-recording-cancelled")
																				: t("settings-extra-keyboard-recording-command", {
																						label: keybindingMessage(command, keybindingLabelIds, "label"),
																					}),
																		);
																	}}
																>
																	<Show
																		when={!recording()}
																		fallback={<span>{t("settings-extra-keyboard-press-keys")}</span>}
																	>
																		<kbd>{displayChord(command.currentChord)}</kbd>
																	</Show>
																</button>
																<LauncherButton
																	variant="ghost"
																	size="sm"
																	disabled={busy() || !command.currentChord}
																	aria-label={t("settings-extra-keyboard-clear-shortcut", {
																		label: keybindingMessage(command, keybindingLabelIds, "label"),
																	})}
																	onClick={() => void clearShortcut(command)}
																>
																	{t("settings-help-action-clear")}
																</LauncherButton>
																<LauncherButton
																	variant="ghost"
																	size="sm"
																	disabled={
																		busy() || (!command.customized && command.currentChord === command.defaultChord)
																	}
																	aria-label={t("settings-extra-keyboard-reset-shortcut", {
																		label: keybindingMessage(command, keybindingLabelIds, "label"),
																	})}
																	onClick={() => void restoreDefault(command)}
																>
																	{t("instances-settings-reset-action")}
																</LauncherButton>
															</div>
														}
													/>
												</div>
											);
										}}
									</For>
								</div>
							</SettingsCard>
						)}
					</For>
				</Show>
			</div>

			<p class={styles.srStatus} aria-live="polite" aria-atomic="true">
				{status()}
			</p>

			<Dialog
				open={Boolean(pendingConflict())}
				onOpenChange={(open) => {
					if (!open) setPendingConflict(undefined);
				}}
			>
				<DialogContent class={styles.conflictDialog}>
					<DialogHeader>
						<DialogTitle>{t("settings-extra-keyboard-replace-existing-title")}</DialogTitle>
						<DialogDescription>
							<kbd>{displayChord(pendingConflict()?.chord)}</kbd>{" "}
							{t("settings-extra-keyboard-conflict-prefix")}{" "}
							<strong>
								{pendingConflict()
									? keybindingMessage(pendingConflict()!.conflict, keybindingLabelIds, "label")
									: ""}
							</strong>
							. {t("settings-extra-keyboard-conflict-suffix")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter class={styles.dialogActions}>
						<button
							type="button"
							class={styles.secondaryAction}
							onClick={() => setPendingConflict(undefined)}
						>
							{t("shared-ui-cancel")}
						</button>
						<button type="button" class={styles.primaryAction} onClick={() => void confirmReplacement()}>
							{t("settings-extra-keyboard-replace-shortcut")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
