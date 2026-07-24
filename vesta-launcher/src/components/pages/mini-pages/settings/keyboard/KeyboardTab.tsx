import {
	assignKeybinding,
	clearKeybinding,
	keybindingCommands,
	keybindingsLoading,
	keybindingsPersistenceError,
	resetKeybinding,
} from "~/keybindings/store";
import { chordFromKeyboardEvent, displayChord } from "~/keybindings/chords";
import type {
	BindingMutationResult,
	PersistedCommand,
} from "~/keybindings/types";
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
	const [pendingConflict, setPendingConflict] =
		createSignal<PendingConflict>();

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
		<div class={`${pageStyles["settings-tab-content"]} ${styles.page}`}>
			<header class={styles.hero}>
				<div>
					<p class={styles.eyebrow}>Input</p>
					<h2>Keyboard</h2>
					<p>
						Choose app-wide shortcuts. Page-specific arrow navigation remains
						controlled by the page you are using.
					</p>
				</div>
				<div class={styles.legend} aria-label="Shortcut recording help">
					<kbd>Esc</kbd>
					<span>Cancel</span>
					<kbd>⌫</kbd>
					<span>Clear</span>
				</div>
			</header>

			<Show when={keybindingsPersistenceError()}>
				<div class={styles.error} role="alert">
					<strong>Shortcuts are using temporary defaults.</strong>
					<span>{keybindingsPersistenceError()}</span>
				</div>
			</Show>

			<Show
				when={!keybindingsLoading()}
				fallback={<div class={styles.loading}>Loading keyboard commands…</div>}
			>
				<div class={styles.groups}>
					<For each={groupedCommands()}>
						{(group) => (
							<section class={styles.group} aria-labelledby={`keys-${group.category}`}>
								<h3 id={`keys-${group.category}`}>{group.category}</h3>
								<div class={styles.rows}>
									<For each={group.commands}>
										{(command) => {
											const recording = () =>
												recordingId() === command.commandId;
											const busy = () => busyId() === command.commandId;
											return (
												<article
													class={styles.row}
													classList={{ [styles.recording]: recording() }}
												>
													<div class={styles.copy}>
														<strong>{command.label}</strong>
														<span>{command.description}</span>
													</div>
													<button
														type="button"
														class={styles.capture}
														disabled={busy()}
														aria-label={`Change shortcut for ${command.label}`}
														aria-pressed={recording()}
														onClick={() => {
															setRecordingId(
																recording() ? undefined : command.commandId,
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
															<kbd>{displayChord(command.currentChord)}</kbd>
														</Show>
													</button>
													<div class={styles.actions}>
														<button
															type="button"
															disabled={busy() || !command.currentChord}
															onClick={() => void clearShortcut(command)}
														>
															Clear
														</button>
														<button
															type="button"
															disabled={busy() || !command.customized}
															onClick={() => void restoreDefault(command)}
														>
															Reset
														</button>
													</div>
												</article>
											);
										}}
									</For>
								</div>
							</section>
						)}
					</For>
				</div>
			</Show>

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
