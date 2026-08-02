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
import {
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { chordFromKeyboardEvent, displayChord } from "~/keybindings/chords";
import {
	assignKeybinding,
	clearKeybinding,
	keybindingCommands,
	keybindingsLoading,
	keybindingsPersistenceError,
	resetKeybinding,
} from "~/keybindings/store";
import type {
	BindingMutationResult,
	PersistedCommand,
} from "~/keybindings/types";
import pageStyles from "../settings-page.module.css";
import styles from "./keyboard-tab.module.css";

type PendingConflict = {
	command: PersistedCommand;
	conflict: PersistedCommand;
	chord: string | null;
	operation: "assign" | "reset";
};

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
				(a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
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
				? `${result.command.label} is now ${displayChord(result.command.currentChord)}.`
				: `${result.command.label} is now unassigned.`,
		);
		return true;
	};

	const saveChord = async (commandId: string, chord: string) => {
		setBusyId(commandId);
		try {
			const result = await assignKeybinding(commandId, chord);
			if (applyResult(result, "assign", chord)) setRecordingId(undefined);
		} catch (error) {
			setStatus(`Could not save shortcut: ${String(error)}`);
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
			setStatus(`Could not clear shortcut: ${String(error)}`);
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
			setStatus(`Could not restore shortcut: ${String(error)}`);
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
				setStatus("Shortcut recording cancelled.");
				return;
			}

			const command = keybindingCommands().find(
				(item) => item.commandId === commandId,
			);
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
					: await assignKeybinding(
							pending.command.commandId,
							pending.chord as string,
							true,
						);
			applyResult(result, pending.operation, pending.chord);
			setPendingConflict(undefined);
			setRecordingId(undefined);
		} catch (error) {
			setStatus(`Could not replace shortcut: ${String(error)}`);
		} finally {
			setBusyId(undefined);
		}
	};

	return (
		<div class={pageStyles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<div class={styles.recordingHelp} aria-label="Shortcut recording help">
					<span>While recording</span>
					<span class={styles.helpAction}>
						<kbd>Esc</kbd>
						Cancel
					</span>
					<span class={styles.helpAction}>
						<kbd>⌫</kbd>
						Clear
					</span>
				</div>

				<Show when={keybindingsPersistenceError()}>
					<SettingsCard>
						<div class={styles.error} role="alert">
							<strong>Shortcuts are using temporary defaults.</strong>
							<span>{keybindingsPersistenceError()}</span>
						</div>
					</SettingsCard>
				</Show>

				<Show
					when={!keybindingsLoading()}
					fallback={
						<SettingsCard>
							<div class={styles.loading}>Loading keyboard commands…</div>
						</SettingsCard>
					}
				>
					<For each={groupedCommands()}>
						{(group) => (
							<SettingsCard header={group.category}>
								<div class={styles.commands}>
									<For each={group.commands}>
										{(command) => {
											const recording = () =>
												recordingId() === command.commandId;
											const busy = () => busyId() === command.commandId;
											return (
												<div
													class={styles.command}
													classList={{ [styles.recording]: recording() }}
												>
													<SettingsField
														label={command.label}
														description={command.description}
														headerRight={
															<div class={styles.controls}>
																<button
																	type="button"
																	class={styles.capture}
																	disabled={busy()}
																	aria-label={`Change shortcut for ${command.label}`}
																	aria-pressed={recording()}
																	onClick={() => {
																		setRecordingId(
																			recording()
																				? undefined
																				: command.commandId,
																		);
																		setStatus(
																			recording()
																				? "Shortcut recording cancelled."
																				: `Recording shortcut for ${command.label}.`,
																		);
																	}}
																>
																	<Show
																		when={!recording()}
																		fallback={<span>Press keys…</span>}
																	>
																		<kbd>
																			{displayChord(command.currentChord)}
																		</kbd>
																	</Show>
																</button>
																<LauncherButton
																	variant="ghost"
																	size="sm"
																	disabled={busy() || !command.currentChord}
																	aria-label={`Clear shortcut for ${command.label}`}
																	onClick={() => void clearShortcut(command)}
																>
																	Clear
																</LauncherButton>
																<LauncherButton
																	variant="ghost"
																	size="sm"
																	disabled={
																		busy() ||
																		(!command.customized &&
																			command.currentChord ===
																				command.defaultChord)
																	}
																	aria-label={`Reset shortcut for ${command.label}`}
																	onClick={() => void restoreDefault(command)}
																>
																	Reset
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
						<DialogTitle>Replace existing shortcut?</DialogTitle>
						<DialogDescription>
							<kbd>{displayChord(pendingConflict()?.chord)}</kbd> is assigned to{" "}
							<strong>{pendingConflict()?.conflict.label}</strong>. Replacing it
							will leave that command unassigned.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter class={styles.dialogActions}>
						<button
							type="button"
							class={styles.secondaryAction}
							onClick={() => setPendingConflict(undefined)}
						>
							Cancel
						</button>
						<button
							type="button"
							class={styles.primaryAction}
							onClick={() => void confirmReplacement()}
						>
							Replace shortcut
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
