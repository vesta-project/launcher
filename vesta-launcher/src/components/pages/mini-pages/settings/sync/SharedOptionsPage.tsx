import AccessibilityIcon from "@assets/icons/content/accessibility.svg";
import ChatIcon from "@assets/icons/content/chat.svg";
import CodeIcon from "@assets/icons/content/code.svg";
import GlobeIcon from "@assets/icons/content/globe.svg";
import KeyboardIcon from "@assets/icons/content/keyboard.svg";
import LayersIcon from "@assets/icons/content/layers.svg";
import LinkIcon from "@assets/icons/content/link.svg";
import MonitorIcon from "@assets/icons/content/monitor.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import SkinIcon from "@assets/icons/content/skin-icon.svg";
import MicIcon from "@assets/icons/security/mic.svg";
import WifiIcon from "@assets/icons/status/wifi.svg";
import { SubpageBackButton } from "@components/settings/SubpageBackButton";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import {
	Slider,
	SliderFill,
	SliderThumb,
	SliderTrack,
} from "@ui/slider/slider";
import {
	Switch,
	SwitchControl,
	SwitchLabel,
	SwitchThumb,
} from "@ui/switch/switch";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { t } from "~/localization";
import {
	type GameOptionChoice,
	type GameOptionMetadata,
	type Preferences,
	type Snapshot,
	selectedSharedKeys,
} from "~/settings-sync/model";
import { formatGameOptionName } from "~/utils/game-option-label";
import { SquareToggle } from "./SquareToggle";
import styles from "./sync-tab.module.css";

type OptionScope = "all" | string;
export type OptionRow = GameOptionMetadata;

const scopeIcons: Record<string, Component<{ class?: string }>> = {
	all: LayersIcon,
	video: MonitorIcon,
	sound: MicIcon,
	language: GlobeIcon,
	chat: ChatIcon,
	controls: KeyboardIcon,
	mouse: KeyboardIcon,
	accessibility: AccessibilityIcon,
	skin: SkinIcon,
	online: WifiIcon,
	custom: CodeIcon,
};

function labelForOption(option: OptionRow): string {
	return option.labelId
		? t(option.labelId)
		: formatGameOptionName(option.id ?? option.key);
}

function labelForScope(scope: string): string {
	const localized = t(`sync-scope-${scope}`);
	return localized === `sync-scope-${scope}`
		? formatGameOptionName(scope)
		: localized;
}

function choiceValue(choice: string | GameOptionChoice): string {
	return typeof choice === "string" ? choice : choice.value;
}

const enumLabels: Record<string, Record<string, string>> = {
	particles: { "0": "all", "1": "decreased", "2": "minimal" },
	attack_indicator: { "0": "off", "1": "crosshair", "2": "hotbar" },
	chat_visibility: { "0": "shown", "1": "commands-only", "2": "hidden" },
	narrator: {
		"0": "off",
		"1": "narrator-all",
		"2": "narrator-chat",
		"3": "narrator-system",
	},
	difficulty: { "0": "peaceful", "1": "easy", "2": "normal", "3": "hard" },
	ambient_occlusion: {
		false: "off",
		true: "maximum",
		"0": "off",
		"1": "minimal",
		"2": "maximum",
	},
	clouds: { false: "off", fast: "fast", true: "fancy" },
	prioritize_chunk_updates: {
		"0": "threaded",
		"1": "semi-blocking",
		"2": "fully-blocking",
	},
	texture_filtering: { "0": "none", "1": "rgss", "2": "anisotropic" },
	anisotropy: { "1": "2x", "2": "4x", "3": "8x" },
	gl_debug_verbosity: {
		"0": "none",
		"1": "high",
		"2": "medium",
		"3": "low",
		"4": "notification",
	},
};
function choiceLabel(choice: string | GameOptionChoice, id?: string): string {
	if (typeof choice === "string") {
		const label = id && enumLabels[id]?.[choice];
		return label
			? t(`sync-choice-${label}`)
			: /^\d+$/.test(choice)
				? choice
				: formatGameOptionName(choice.toLowerCase());
	}
	if (choice.labelId) return t(choice.labelId);
	return choice.label || choice.value;
}

function decimalPlaces(step: number | null | undefined): number {
	if (step === null || step === undefined) return 2;
	const text = String(step);
	const exponent = text.indexOf("e-");
	if (exponent >= 0) return Number(text.slice(exponent + 2)) || 2;
	const decimal = text.indexOf(".");
	return decimal < 0 ? 0 : text.length - decimal - 1;
}

function isPercent(option: OptionRow) {
	return option.unit === "percent";
}

function displayPlaces(option: OptionRow) {
	if (option.kind === "integer") return 0;
	return Math.min(2, decimalPlaces(option.step ?? 0.01));
}

function toDisplay(option: OptionRow, stored: number) {
	return isPercent(option) ? stored * 100 : stored;
}

function fromDisplay(option: OptionRow, display: number) {
	return isPercent(option) ? display / 100 : display;
}

function displayRange(option: OptionRow, value?: string) {
	const min = option.min;
	const max = option.max;
	if (typeof min !== "number" || typeof max !== "number" || min > max)
		return undefined;
	const observed = Number(value);
	if (Number.isFinite(observed)) {
		const storedMin = min;
		const storedMax = max;
		if (observed < storedMin || observed > storedMax) return undefined;
	}
	if (isPercent(option)) return { min: min * 100, max: max * 100 };
	return { min, max };
}

function displayStep(option: OptionRow) {
	const step = option.step ?? (option.kind === "integer" ? 1 : 0.01);
	return isPercent(option) ? step * 100 : step;
}

function formatDisplay(option: OptionRow, display: number) {
	if (!Number.isFinite(display)) return "";
	const rounded = Number(display.toFixed(displayPlaces(option)));
	if (isPercent(option)) return `${rounded}%`;
	if (option.unit === "multiplier") return `${rounded}×`;
	return String(rounded);
}

function serializeStored(option: OptionRow, display: number) {
	if (!Number.isFinite(display)) return "";
	const stored = fromDisplay(option, display);
	const places = Math.min(
		4,
		Math.max(displayPlaces(option), decimalPlaces(option.step ?? 0.01)),
	);
	return String(Number(stored.toFixed(places)));
}

export function ValueControl(props: {
	option: OptionRow;
	value?: string;
	disabled: boolean;
	placeholder?: string;
	onSave: (value: string) => Promise<boolean> | boolean | undefined;
}) {
	const [dragValue, setDragValue] = createSignal<number>();
	const ariaLabel = () =>
		t("sync-value-label", { option: labelForOption(props.option) });
	const kind = () => props.option.kind;
	const choices = () => props.option.values ?? [];
	const range = () => displayRange(props.option, props.value);
	const storedNumber = () => {
		if (props.value === undefined || props.value.trim() === "") return null;
		const value = Number(props.value);
		return Number.isFinite(value) ? value : null;
	};
	const displayNumber = () => {
		const stored = storedNumber();
		return stored === null ? null : toDisplay(props.option, stored);
	};
	const shown = () => dragValue() ?? displayNumber();
	const placeholder = () => props.placeholder ?? t("sync-value-missing");

	return (
		<Show
			when={
				kind() === "boolean" &&
				(props.value === "true" || props.value === "false")
			}
			fallback={
				<Show
					when={kind() === "enum" && choices().length > 0}
					fallback={
						<Show
							when={
								(kind() === "integer" ||
									kind() === "decimal" ||
									kind() === "number") &&
								range() !== undefined &&
								displayNumber() !== null
							}
							fallback={
								<TextFieldRoot class={styles.valueTextControl}>
									<TextFieldInput
										aria-label={ariaLabel()}
										type={
											(kind() === "integer" || kind() === "decimal") &&
											storedNumber() !== null
												? "number"
												: "text"
										}
										step={props.option.step ?? "any"}
										value={props.value ?? ""}
										placeholder={placeholder()}
										disabled={props.disabled}
										onChange={(event) =>
											void props.onSave(
												(event.currentTarget as HTMLInputElement).value,
											)
										}
									/>
								</TextFieldRoot>
							}
						>
							<div class={styles.valueSliderControl}>
								<span class={styles.valueLabel}>
									{formatDisplay(props.option, shown() as number)}
								</span>
								<Slider
									class={styles.valueSlider}
									value={[shown() as number]}
									minValue={range()?.min}
									maxValue={range()?.max}
									step={displayStep(props.option)}
									disabled={props.disabled}
									aria-label={ariaLabel()}
									onChange={(next) => setDragValue(next[0])}
									onChangeEnd={(next) => {
										if (props.disabled || next[0] === undefined) return;
										const value = serializeStored(props.option, next[0]);
										if (value !== props.value) {
											Promise.resolve(props.onSave(value)).finally(() =>
												setDragValue(undefined),
											);
										} else setDragValue(undefined);
									}}
								>
									<SliderTrack>
										<SliderFill />
										<SliderThumb aria-label={ariaLabel()} />
									</SliderTrack>
								</Slider>
							</div>
						</Show>
					}
				>
					<div class={styles.valueControl}>
						<Select<string>
							options={choices().map(choiceValue)}
							value={props.value}
							onChange={(value) => value !== null && void props.onSave(value)}
							optionValue={(value) => value}
							optionTextValue={(value) => {
								const choice = choices().find(
									(item) => choiceValue(item) === value,
								);
								return choice ? choiceLabel(choice, props.option.id) : value;
							}}
							itemComponent={(itemProps) => {
								const choice = choices().find(
									(item) => choiceValue(item) === itemProps.item.rawValue,
								);
								return (
									<SelectItem item={itemProps.item}>
										{choice
											? choiceLabel(choice, props.option.id)
											: itemProps.item.rawValue}
									</SelectItem>
								);
							}}
						>
							<SelectTrigger
								aria-label={ariaLabel()}
								disabled={props.disabled}
								class={styles.valueSelect}
							>
								<SelectValue<string>>
									{(state) => {
										const selected = state.selectedOption();
										const choice = choices().find(
											(item) => choiceValue(item) === selected,
										);
										return choice
											? choiceLabel(choice, props.option.id)
											: (selected ?? "");
									}}
								</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>
				</Show>
			}
		>
			<div class={styles.valueControl}>
				<Switch
					checked={props.value === "true"}
					disabled={props.disabled}
					aria-label={ariaLabel()}
					onCheckedChange={(checked: boolean) =>
						void props.onSave(String(checked))
					}
				>
					<SwitchLabel class={styles.srOnly}>{ariaLabel()}</SwitchLabel>
					<SwitchControl>
						<SwitchThumb />
					</SwitchControl>
				</Switch>
			</div>
		</Show>
	);
}

function optionRows(snapshot: Snapshot): OptionRow[] {
	const values = snapshot.sharedValues ?? {};
	const known = new Map(
		(snapshot.catalog ?? []).map((entry) => [entry.key, entry]),
	);
	for (const key of Object.keys(values)) {
		if (!known.has(key)) {
			known.set(key, {
				key,
				category: key.startsWith("key_") ? "keybinds" : "custom",
				kind:
					values[key] === "true" || values[key] === "false"
						? "boolean"
						: /^-?\d+(?:\.\d+)?$/.test(values[key]) &&
								Number.isFinite(Number(values[key]))
							? Number.isInteger(Number(values[key]))
								? "integer"
								: "decimal"
							: "text",
			});
		}
	}
	for (const [key, entry] of known) {
		if (
			entry.id === "ambient_occlusion" &&
			["true", "false"].includes(values[key])
		) {
			known.set(key, { ...entry, kind: "boolean" });
		}
	}
	return [...known.values()]
		.filter(
			(entry) =>
				values[entry.key] !== undefined &&
				entry.category !== "keybindings" &&
				entry.category !== "keybinds" &&
				!entry.key.startsWith("key_"),
		)
		.sort((a, b) => labelForOption(a).localeCompare(labelForOption(b)));
}

export function SharedOptionsPage(props: {
	snapshot: Snapshot;
	busy: boolean;
	onBack: () => void;
	onSave: (
		preferences: Preferences,
		changes?: Record<string, string>,
	) => Promise<boolean>;
}) {
	const [scope, setScope] = createSignal<OptionScope>("all");
	const [query, setQuery] = createSignal("");
	const rows = createMemo(() => optionRows(props.snapshot));
	const availableKeys = createMemo(() => rows().map((row) => row.key));
	const selected = createMemo(() =>
		selectedSharedKeys(props.snapshot.preferences, availableKeys()),
	);
	const allSelected = createMemo(
		() =>
			availableKeys().length > 0 &&
			availableKeys().every((key) => selected().includes(key)),
	);
	const scopes = createMemo(() => {
		const present = new Set(rows().map((row) => row.category));
		return [
			"all",
			...[...present].filter((category) => category !== "custom").sort(),
			...(present.has("custom") ? ["custom"] : []),
		];
	});
	const filtered = createMemo(() => {
		const search = query().trim().toLocaleLowerCase();
		return rows().filter((row) => {
			const matchesScope = scope() === "all" || row.category === scope();
			const matchesSearch =
				!search ||
				`${row.key} ${labelForOption(row)}`
					.toLocaleLowerCase()
					.includes(search);
			return matchesScope && matchesSearch;
		});
	});
	const disabled = () => props.busy || !props.snapshot.preferences.enabled;

	const updateSelection = (key: string, linked: boolean) => {
		const next = linked
			? [...new Set([...selected(), key])]
			: selected().filter((entry) => entry !== key);
		void props.onSave({ ...props.snapshot.preferences, selectedKeys: next });
	};

	return (
		<div class={styles.sharedPage}>
			<div class={styles.heading}>
				<SubpageBackButton label={t("sync-back")} onClick={props.onBack} />
				<h2 class={styles.headingTitle}>{t("sync-shared-page-title")}</h2>
			</div>
			<div class={styles.sharedLayout}>
				<aside class={styles.sharedSidebar}>
					<div class={styles.search}>
						<SearchIcon class={styles.searchIcon} aria-hidden="true" />
						<TextFieldRoot>
							<TextFieldInput
								class={styles.searchInput}
								type="search"
								value={query()}
								aria-label={t("sync-search-options")}
								placeholder={t("sync-search-options")}
								onInput={(event) =>
									setQuery((event.currentTarget as HTMLInputElement).value)
								}
							/>
						</TextFieldRoot>
					</div>
					<ToggleGroup
						class={styles.scopeToggle}
						value={scope()}
						onChange={(value) => value && setScope(value)}
					>
						<For each={scopes()}>
							{(entry) => {
								const Icon = scopeIcons[entry] ?? CodeIcon;
								return (
									<ToggleGroupItem
										value={entry}
										size="sm"
										aria-label={labelForScope(entry)}
									>
										<Icon class={styles.icon} />
										<span>{labelForScope(entry)}</span>
									</ToggleGroupItem>
								);
							}}
						</For>
					</ToggleGroup>
				</aside>
				<div class={styles.sharedContent}>
					<div class={styles.sharedActions}>
						<SquareToggle
							label={
								allSelected()
									? t("sync-unlink-all-options")
									: t("sync-link-all-options")
							}
							pressed={allSelected()}
							iconOnly
							disabled={disabled() || availableKeys().length === 0}
							onChange={() =>
								void props.onSave({
									...props.snapshot.preferences,
									selectedKeys: allSelected() ? [] : availableKeys(),
								})
							}
						>
							<LinkIcon class={styles.icon} />
						</SquareToggle>
					</div>
					<div class={styles.optionRows}>
						<For each={filtered()}>
							{(option) => {
								const linked = () => selected().includes(option.key);
								const value = () => props.snapshot.sharedValues?.[option.key];
								return (
									<div class={styles.optionRow}>
										<div class={styles.optionName} title={option.key}>
											<span>{labelForOption(option)}</span>
										</div>
										<div class={styles.optionControl}>
											<ValueControl
												option={option}
												value={value()}
												disabled={disabled() || !linked()}
												onSave={(next) =>
													props.onSave(props.snapshot.preferences, {
														[option.key]: next,
													})
												}
											/>
											<SquareToggle
												label={t("sync-option-label", {
													option: labelForOption(option),
												})}
												pressed={linked()}
												disabled={disabled()}
												iconOnly
												onChange={(next) => updateSelection(option.key, next)}
											>
												<LinkIcon class={styles.icon} />
											</SquareToggle>
										</div>
									</div>
								);
							}}
						</For>
					</div>
					<Show when={filtered().length === 0}>
						<p class={styles.empty}>{t("sync-no-options")}</p>
					</Show>
				</div>
			</div>
		</div>
	);
}
