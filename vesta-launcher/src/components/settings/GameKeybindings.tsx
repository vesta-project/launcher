import LinkIcon from "@assets/icons/content/link.svg";
import { SettingsCard, SettingsField } from "@components/settings";
import LauncherButton from "@ui/button/button";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { t } from "~/localization";
import styles from "../pages/mini-pages/settings/keyboard/keyboard-tab.module.css";

export interface GameKeybindingRow {
	key: string;
	category: string;
	group?: string;
}

export interface GameKeybindingsState<Row extends GameKeybindingRow> {
	rows: () => Row[];
	value: (key: string) => string;
	label: (row: Row) => string;
	busy: () => boolean;
	change: (key: string, value: string) => void | Promise<void>;
}

// Game bindings are single physical keys, not launcher modifier chords.
export function gameKey(code: string): string | undefined {
	if (/^Key[A-Z]$/.test(code))
		return `key.keyboard.${code.slice(3).toLowerCase()}`;
	if (/^Digit[0-9]$/.test(code)) return `key.keyboard.${code.slice(5)}`;
	if (/^F([1-9]|1[0-9]|2[0-5])$/.test(code))
		return `key.keyboard.${code.toLowerCase()}`;
	const names: Record<string, string> = {
		Space: "space",
		Enter: "enter",
		Tab: "tab",
		Backspace: "backspace",
		Delete: "delete",
		Insert: "insert",
		Home: "home",
		End: "end",
		PageUp: "page.up",
		PageDown: "page.down",
		ArrowUp: "up",
		ArrowDown: "down",
		ArrowLeft: "left",
		ArrowRight: "right",
		ShiftLeft: "left.shift",
		ShiftRight: "right.shift",
		ControlLeft: "left.control",
		ControlRight: "right.control",
		AltLeft: "left.alt",
		AltRight: "right.alt",
		Minus: "minus",
		Equal: "equal",
		BracketLeft: "left.bracket",
		BracketRight: "right.bracket",
		Backslash: "backslash",
		Semicolon: "semicolon",
		Quote: "apostrophe",
		Backquote: "grave.accent",
		Comma: "comma",
		Period: "period",
		Slash: "slash",
	};
	return names[code] ? `key.keyboard.${names[code]}` : undefined;
}

export function GameKeybindings<Row extends GameKeybindingRow>(props: {
	state: GameKeybindingsState<Row>;
	selected?: (key: string) => boolean;
	onSelectionChange?: (key: string, selected: boolean) => void;
	allSelected?: () => boolean;
	onToggleAll?: () => void;
	/** When true, skip the card title — the parent page already has one. */
	embedded?: boolean;
}) {
	const [recording, setRecording] = createSignal<string>();
	const [status, setStatus] = createSignal("");
	const bindings = () =>
		props.state
			.rows()
			.filter(
				(row) => row.category === "keybindings" || row.category === "keybinds",
			);
	const groupedBindings = () => {
		const groups = new Map<string, Row[]>();
		for (const row of bindings()) {
			const group = row.group ?? "";
			groups.set(group, [...(groups.get(group) ?? []), row]);
		}
		const order = [
			"movement",
			"gameplay",
			"inventory",
			"multiplayer",
			"miscellaneous",
			"other",
		];
		return [...groups.entries()]
			.sort(([left], [right]) => {
				const leftIndex = order.indexOf(left);
				const rightIndex = order.indexOf(right);
				if (leftIndex < 0 && rightIndex < 0) return left.localeCompare(right);
				if (leftIndex < 0) return 1;
				if (rightIndex < 0) return -1;
				return leftIndex - rightIndex;
			})
			.map(([group, rows]) => ({ group, rows }));
	};
	const supported = (key: string) => {
		const value = props.state.value(key);
		return (
			/^-?\d+$/.test(value) ||
			value === "" ||
			value === "key.keyboard.unknown" ||
			/^key\.(keyboard|mouse)\./.test(value)
		);
	};
	const display = (key: string) => {
		const raw = props.state.value(key);
		if (raw === "key.keyboard.unknown" || raw === "") {
			return t("game-options-key-unbound");
		}
		return raw
			.replace(/^key\.keyboard\./, "")
			.replace(/^key\.mouse\./, "Mouse ")
			.replaceAll(".", " ");
	};

	onMount(() => {
		const capture = (event: KeyboardEvent) => {
			const key = recording();
			if (!key) return;
			if (props.state.busy() || (props.selected && !props.selected(key))) {
				setRecording(undefined);
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.code === "Escape") {
				setRecording(undefined);
				setStatus(t("game-options-key-cancelled"));
				return;
			}
			if (event.code === "Backspace" || event.code === "Delete") {
				void props.state.change(key, "key.keyboard.unknown");
				setRecording(undefined);
				setStatus(t("game-options-key-cleared"));
				return;
			}
			if (event.repeat || event.isComposing || props.state.busy()) return;
			const next = gameKey(event.code);
			if (!next) {
				setStatus(t("game-options-key-unsupported"));
				return;
			}
			void props.state.change(key, next);
			setRecording(undefined);
			setStatus("");
		};
		const captureMouse = (event: MouseEvent) => {
			const key = recording();
			if (!key) return;
			if (props.state.busy() || (props.selected && !props.selected(key))) {
				setRecording(undefined);
				return;
			}
			// Controls switch/cancel recording; their click is not a game binding.
			if (
				event.target instanceof Element &&
				event.target.closest("button, input, a, [role=button]")
			)
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const name =
				["left", "middle", "right"][event.button] ?? String(event.button + 1);
			void props.state.change(key, `key.mouse.${name}`);
			setRecording(undefined);
			setStatus("");
		};
		window.addEventListener("mousedown", captureMouse, true);
		onCleanup(() =>
			window.removeEventListener("mousedown", captureMouse, true),
		);
		window.addEventListener("keydown", capture, true);
		onCleanup(() => window.removeEventListener("keydown", capture, true));
	});

	const toggleLabel = () =>
		props.allSelected?.()
			? t("sync-unlink-all-instances")
			: t("sync-link-all-instances");
	const headerRight = () => (
		<div class={styles.recordingHelp} aria-label={t("sync-keybinds-help")}>
			<Show when={props.onToggleAll}>
				<LauncherButton
					variant="outline"
					size="sm"
					aria-label={toggleLabel()}
					disabled={props.state.busy()}
					onClick={props.onToggleAll}
				>
					<LinkIcon class={styles.icon} aria-hidden="true" />
					{toggleLabel()}
				</LauncherButton>
			</Show>
			<Show when={recording()}>
				<span>{t("sync-keybinds-recording-help")}</span>
				<span class={styles.helpAction}>
					<kbd>Esc</kbd>
					{t("generic-action-cancel")}
				</span>
			</Show>
		</div>
	);

	return (
		<>
			<For each={groupedBindings()}>
				{(group, groupIndex) => (
					<SettingsCard
						header={
							group.group
								? t(`generic-label-${group.group}`)
								: props.embedded
									? undefined
									: t("sync-keybinds-page-title")
						}
						headerRight={groupIndex() === 0 ? headerRight() : undefined}
					>
						<div class={styles.commands}>
							<For each={group.rows}>
								{(row) => {
									const isRecording = () => recording() === row.key;
									const name = () => props.state.label(row);
									const isSelected = () => props.selected?.(row.key) ?? true;
									return (
										<div
											class={styles.command}
											classList={{ [styles.recording]: isRecording() }}
										>
											<SettingsField
												label={name()}
												description={
													supported(row.key)
														? undefined
														: t("game-options-key-legacy")
												}
												headerRight={
													<div class={styles.controls}>
														<button
															type="button"
															class={styles.capture}
															disabled={
																props.state.busy() ||
																!supported(row.key) ||
																(props.selected !== undefined && !isSelected())
															}
															aria-label={t("game-options-key-change", {
																key: name(),
															})}
															aria-pressed={isRecording()}
															onClick={() => {
																const next = isRecording()
																	? undefined
																	: row.key;
																setRecording(next);
																setStatus(
																	next
																		? t("game-options-key-recording")
																		: t("game-options-key-cancelled"),
																);
															}}
														>
															<Show
																when={!isRecording()}
																fallback={
																	<span>{t("game-options-key-recording")}</span>
																}
															>
																<kbd>{display(row.key)}</kbd>
															</Show>
														</button>
														<Show when={props.onSelectionChange}>
															<button
																type="button"
																class={styles.selection}
																aria-label={t("sync-option-label", {
																	option: name(),
																})}
																aria-pressed={isSelected()}
																disabled={props.state.busy()}
																onClick={() =>
																	props.onSelectionChange?.(
																		row.key,
																		!isSelected(),
																	)
																}
															>
																<LinkIcon aria-hidden="true" />
															</button>
														</Show>
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
			<Show when={!bindings().length}>
				<p class={styles.loading}>{t("game-options-key-empty")}</p>
			</Show>
			<p class={styles.srStatus} aria-live="polite" aria-atomic="true">
				{status()}
			</p>
		</>
	);
}
