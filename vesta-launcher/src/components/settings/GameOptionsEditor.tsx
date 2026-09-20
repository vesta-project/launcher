import ReloadIcon from "@assets/icons/actions/reload.svg";
import AccessibilityIcon from "@assets/icons/content/accessibility.svg";
import ChatIcon from "@assets/icons/content/chat.svg";
import CodeIcon from "@assets/icons/content/code.svg";
import GlobeIcon from "@assets/icons/content/globe.svg";
import KeyboardIcon from "@assets/icons/content/keyboard.svg";
import LayersIcon from "@assets/icons/content/layers.svg";
import MonitorIcon from "@assets/icons/content/monitor.svg";
import SkinIcon from "@assets/icons/content/skin-icon.svg";
import MicIcon from "@assets/icons/security/mic.svg";
import WifiIcon from "@assets/icons/status/wifi.svg";
import pageStyles from "@components/pages/mini-pages/settings/settings-page.module.css";
import {
	OptionBrowser,
	OptionEmpty,
	OptionRow,
	optionBrowserPageFill,
} from "@components/settings/OptionBrowser";
import panelStyles from "@components/settings/settings.module.css";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
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
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { t } from "~/localization";
import { formatGameOptionName } from "~/utils/game-option-label";
import styles from "./game-options.module.css";

interface Snapshot {
	revision: string;
	exists: boolean;
	values: Record<string, string>;
}

type CatalogEntry = {
	id?: string;
	key: string;
	category: string;
	labelId?: string | null;
	kind:
		| "boolean"
		| "number"
		| "integer"
		| "decimal"
		| "enum"
		| "language"
		| "text";
	min?: number | null;
	max?: number | null;
	step?: number | null;
	unit?: string | null;
	values?: Array<
		string | { value: string; labelId?: string | null; label?: string | null }
	>;
};

const categoryIcons = {
	all: LayersIcon,
	video: MonitorIcon,
	mouse: KeyboardIcon,
	sound: MicIcon,
	language: GlobeIcon,
	chat: ChatIcon,
	controls: KeyboardIcon,
	accessibility: AccessibilityIcon,
	skin: SkinIcon,
	online: WifiIcon,
	custom: CodeIcon,
} satisfies Record<string, typeof CodeIcon>;

const categoryOrder = [
	"video",
	"mouse",
	"sound",
	"language",
	"chat",
	"controls",
	"accessibility",
	"skin",
	"online",
	"custom",
] as const;

const protectedKeys = new Set([
	"version",
	"resourcePacks",
	"incompatibleResourcePacks",
]);

function categoryLabel(category: string) {
	const key =
		category === "all"
			? "game-options-all"
			: `game-options-category-${category}`;
	const localized = t(key);
	return localized === key ? formatGameOptionName(category) : localized;
}

const knownLabels: Record<string, string> = {
	fov: "game-options-fov",
	fullscreen: "game-options-fullscreen",
	view_bobbing: "game-options-view-bobbing",
	invert_mouse: "game-options-invert-mouse",
	sensitivity: "game-options-mouse-sensitivity",
	master_volume: "game-options-master-volume",
	music_volume: "game-options-music-volume",
	language: "game-options-language",
};

function labelFor(row: CatalogEntry) {
	if (row.labelId) return t(row.labelId);
	const messageId = row.id ? knownLabels[row.id] : undefined;
	if (messageId) {
		const localized = t(messageId);
		if (localized !== messageId) return localized;
	}
	return formatGameOptionName(row.id ?? row.key);
}

function choiceValue(choice: string | { value: string }) {
	return typeof choice === "string" ? choice : choice.value;
}

/** Minecraft stores several enums as bare integers; map them to readable labels. */
const enumLabels: Record<string, Record<string, string>> = {
	particles: {
		"0": "game-options-choice-all",
		"1": "game-options-choice-decreased",
		"2": "game-options-choice-minimal",
	},
	attack_indicator: {
		"0": "game-options-choice-off",
		"1": "game-options-choice-crosshair",
		"2": "game-options-choice-hotbar",
	},
	chat_visibility: {
		"0": "game-options-choice-shown",
		"1": "game-options-choice-commands-only",
		"2": "game-options-choice-hidden",
	},
	narrator: {
		"0": "game-options-choice-off",
		"1": "game-options-choice-narrator-all",
		"2": "game-options-choice-narrator-chat",
		"3": "game-options-choice-narrator-system",
	},
	difficulty: {
		"0": "game-options-choice-peaceful",
		"1": "game-options-choice-easy",
		"2": "game-options-choice-normal",
		"3": "game-options-choice-hard",
	},
	ambient_occlusion: {
		false: "game-options-choice-off",
		true: "game-options-choice-maximum",
		"0": "game-options-choice-off",
		"1": "game-options-choice-minimal",
		"2": "game-options-choice-maximum",
	},
	clouds: {
		false: "game-options-choice-off",
		fast: "game-options-choice-fast",
		true: "game-options-choice-fancy",
	},
	prioritize_chunk_updates: {
		"0": "game-options-choice-threaded",
		"1": "game-options-choice-semi-blocking",
		"2": "game-options-choice-fully-blocking",
	},
	texture_filtering: {
		"0": "game-options-choice-none",
		"1": "game-options-choice-rgss",
		"2": "game-options-choice-anisotropic",
	},
	anisotropy: {
		"1": "game-options-choice-2x",
		"2": "game-options-choice-4x",
		"3": "game-options-choice-8x",
	},
	gl_debug_verbosity: {
		"0": "game-options-choice-none",
		"1": "game-options-choice-high",
		"2": "game-options-choice-medium",
		"3": "game-options-choice-low",
		"4": "game-options-choice-notification",
	},
};

function choiceLabel(
	choice:
		| string
		| { value: string; labelId?: string | null; label?: string | null },
	optionId?: string,
) {
	if (typeof choice !== "string") {
		if (choice.labelId) return t(choice.labelId);
		return choice.label || choice.value;
	}
	const messageId = optionId ? enumLabels[optionId]?.[choice] : undefined;
	if (messageId) {
		const localized = t(messageId);
		if (localized !== messageId) return localized;
	}
	if (/^\d+$/.test(choice)) return choice;
	return formatGameOptionName(choice.toLowerCase());
}

function inferredCategory(key: string) {
	const name = key.toLowerCase();
	if (/(sound|music|volume|audio|narrator|subtitle)/.test(name)) return "sound";
	if (/(chat|message)/.test(name)) return "chat";
	if (/(social|telemetry|realms|online|server)/.test(name)) return "online";
	if (/(language|^lang$)/.test(name)) return "language";
	if (/(accessib|contrast|blind|darkness|textbackground)/.test(name))
		return "accessibility";
	if (/(hand|cape|jacket|sleeve|pants|hat|skin|modelpart)/.test(name))
		return "skin";
	if (
		/(mouse|sensitivity|invert|autojump|attack|sprint|sneak|touch|control)/.test(
			name,
		)
	)
		return "controls";
	if (
		/(render|graphic|gamma|brightness|fov|gui|fullscreen|vsync|particle|cloud|mipmap|biome|chunk|fog|entity|shadow|texture|screen|window|fps|distance|view|bob)/.test(
			name,
		)
	)
		return "video";
	return "custom";
}

function rowOrder(category: string) {
	const index = categoryOrder.indexOf(
		category as (typeof categoryOrder)[number],
	);
	return index < 0 ? categoryOrder.length : index;
}

function decimalPlaces(step: number | null | undefined) {
	if (step === null || step === undefined) return 2;
	const text = String(step);
	const exponent = text.indexOf("e-");
	if (exponent >= 0) return Number(text.slice(exponent + 2)) || 2;
	const decimal = text.indexOf(".");
	return decimal < 0 ? 0 : text.length - decimal - 1;
}

function isPercent(option: CatalogEntry) {
	return option.unit === "percent";
}

/** Cap UI numbers at 2 decimal places for readability. */
function displayPlaces(option: CatalogEntry) {
	if (option.kind === "integer") return 0;
	return Math.min(2, decimalPlaces(option.step ?? 0.01));
}

function toDisplay(option: CatalogEntry, stored: number) {
	return isPercent(option) ? stored * 100 : stored;
}

function fromDisplay(option: CatalogEntry, display: number) {
	return isPercent(option) ? display / 100 : display;
}

function displayRange(option: CatalogEntry) {
	if (typeof option.min !== "number" || typeof option.max !== "number")
		return undefined;
	if (isPercent(option)) {
		return { min: option.min * 100, max: option.max * 100 };
	}
	return { min: option.min, max: option.max };
}

function displayStep(option: CatalogEntry) {
	const step =
		option.step ??
		(option.kind === "integer" ? 1 : isPercent(option) ? 0.01 : 0.01);
	return isPercent(option) ? step * 100 : step;
}

function formatDisplay(option: CatalogEntry, display: number) {
	if (!Number.isFinite(display)) return "";
	const rounded = Number(display.toFixed(displayPlaces(option)));
	if (isPercent(option)) return `${rounded}%`;
	if (option.unit === "multiplier") return `${rounded}×`;
	return String(rounded);
}

function serializeStored(option: CatalogEntry, display: number) {
	if (!Number.isFinite(display)) return "";
	const stored = fromDisplay(option, display);
	const places = Math.min(
		4,
		Math.max(displayPlaces(option), decimalPlaces(option.step ?? 0.01)),
	);
	return String(Number(stored.toFixed(places)));
}

function ValueControl(props: {
	option: CatalogEntry;
	value: string;
	disabled: boolean;
	onSave: (value: string) => void;
}) {
	const [dragValue, setDragValue] = createSignal<number>();
	const label = () => labelFor(props.option);
	const range = () => displayRange(props.option);
	const storedNumber = () => {
		const value = Number(props.value);
		return props.value.trim() !== "" && Number.isFinite(value) ? value : null;
	};
	const displayNumber = () => {
		const stored = storedNumber();
		return stored === null ? null : toDisplay(props.option, stored);
	};
	const shown = () => dragValue() ?? displayNumber();
	return (
		<Show
			when={
				props.option.kind === "boolean" &&
				(props.value === "true" || props.value === "false")
			}
			fallback={
				<Show
					when={props.option.kind === "enum" && props.option.values?.length}
					fallback={
						<Show
							when={
								["integer", "decimal", "number"].includes(props.option.kind) &&
								range() !== undefined &&
								displayNumber() !== null
							}
							fallback={
								<TextFieldRoot class={styles.valueTextControl}>
									<TextFieldInput
										aria-label={label()}
										type={
											["integer", "decimal"].includes(props.option.kind) &&
											storedNumber() !== null
												? "number"
												: "text"
										}
										step={props.option.step ?? "any"}
										value={props.value}
										placeholder={t("game-options-unset")}
										disabled={props.disabled}
										onInput={(event) =>
											props.onSave(
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
									value={[shown() as number]}
									minValue={range()?.min}
									maxValue={range()?.max}
									step={displayStep(props.option)}
									disabled={props.disabled}
									aria-label={label()}
									onChange={(next) => setDragValue(next[0])}
									onChangeEnd={(next) => {
										if (next[0] !== undefined) {
											props.onSave(serializeStored(props.option, next[0]));
										}
										setDragValue(undefined);
									}}
								>
									<SliderTrack>
										<SliderFill />
										<SliderThumb aria-label={label()} />
									</SliderTrack>
								</Slider>
							</div>
						</Show>
					}
				>
					<div class={styles.valueControl}>
						<Select<string>
							options={(props.option.values ?? []).map(choiceValue)}
							value={props.value}
							onChange={(value) => value !== null && props.onSave(value)}
							optionValue={(value) => value}
							optionTextValue={(value) =>
								choiceLabel(
									(props.option.values ?? []).find(
										(choice) => choiceValue(choice) === value,
									) ?? value,
									props.option.id,
								)
							}
							itemComponent={(itemProps) => (
								<SelectItem item={itemProps.item}>
									{choiceLabel(
										(props.option.values ?? []).find(
											(choice) =>
												choiceValue(choice) === itemProps.item.rawValue,
										) ?? itemProps.item.rawValue,
										props.option.id,
									)}
								</SelectItem>
							)}
						>
							<SelectTrigger aria-label={label()} disabled={props.disabled}>
								<SelectValue<string>>
									{(state) =>
										choiceLabel(
											(props.option.values ?? []).find(
												(choice) =>
													choiceValue(choice) === state.selectedOption(),
											) ??
												state.selectedOption() ??
												"",
											props.option.id,
										)
									}
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
					aria-label={label()}
					onCheckedChange={(checked: boolean) => props.onSave(String(checked))}
				>
					<SwitchLabel class={styles.srOnly}>{label()}</SwitchLabel>
					<SwitchControl>
						<SwitchThumb />
					</SwitchControl>
				</Switch>
			</div>
		</Show>
	);
}

export function createGameOptionsEditor(props: {
	instanceId: number | undefined;
	disabled?: boolean;
	enabled?: boolean;
}) {
	const [snapshot, setSnapshot] = createSignal<Snapshot>();
	const [catalog, setCatalog] = createSignal<CatalogEntry[]>([]);
	const [changes, setChanges] = createSignal<Record<string, string>>({});
	const [loading, setLoading] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const [notice, setNotice] = createSignal("");
	const [query, setQuery] = createSignal("");
	const [category, setCategory] = createSignal("all");
	let generation = 0;
	onCleanup(() => {
		generation++;
	});
	const dirtyCount = createMemo(() => Object.keys(changes()).length);
	const busy = () => Boolean(loading() || saving() || props.disabled);
	const value = (key: string) =>
		changes()[key] ?? snapshot()?.values[key] ?? "";
	const rows = createMemo(() => {
		const known = new Map(catalog().map((row) => [row.key, row]));
		const keys = new Set([
			...Object.keys(snapshot()?.values ?? {}),
			...Object.keys(changes()),
		]);
		const result: CatalogEntry[] = [];
		for (const key of keys) {
			if (protectedKeys.has(key) || key.startsWith("key_")) continue;
			const existing = known.get(key);
			if (existing) {
				result.push(existing);
				continue;
			}
			const raw = changes()[key] ?? snapshot()?.values[key] ?? "";
			result.push({
				key,
				category: inferredCategory(key),
				kind:
					raw === "true" || raw === "false"
						? "boolean"
						: /^-?\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw))
							? Number.isInteger(Number(raw))
								? "integer"
								: "decimal"
							: "text",
			});
		}
		return result.sort(
			(left, right) =>
				rowOrder(left.category) - rowOrder(right.category) ||
				labelFor(left).localeCompare(labelFor(right), undefined, {
					sensitivity: "base",
				}),
		);
	});
	const categories = createMemo(() => {
		const present = new Set(rows().map((row) => row.category));
		const ordered = categoryOrder.filter((entry) => present.has(entry));
		for (const entry of present) {
			if (!ordered.includes(entry as (typeof categoryOrder)[number])) {
				ordered.push(entry as (typeof categoryOrder)[number]);
			}
		}
		return ordered;
	});
	async function load(instanceId: number) {
		const request = ++generation;
		setLoading(true);
		setError("");
		setNotice("");
		try {
			const [next, definitions] = await Promise.all([
				invoke<Snapshot>("get_instance_game_options", {
					instanceId,
					editorValues: true,
				}),
				invoke<CatalogEntry[]>("get_game_options_catalog"),
			]);
			if (request !== generation) return;
			setSnapshot(next);
			setCatalog(definitions);
			setChanges({});
		} catch (failure) {
			if (request === generation) setError(String(failure));
		} finally {
			if (request === generation) setLoading(false);
		}
	}
	const currentId = createMemo(() => props.instanceId);
	let observedId: number | undefined = props.instanceId;
	let requestedId: number | undefined;
	if (props.enabled !== false && props.instanceId !== undefined) {
		requestedId = props.instanceId;
		void load(props.instanceId);
	}
	createEffect(() => {
		const id = currentId();
		const enabled = props.enabled !== false;
		if (id !== observedId) {
			observedId = id;
			requestedId = undefined;
			generation++;
			setSnapshot(undefined);
			setChanges({});
			setSaving(false);
			setLoading(false);
		}
		if (enabled && id !== undefined && requestedId !== id) {
			requestedId = id;
			void load(id);
		}
	});
	function change(key: string, next: string) {
		setNotice("");
		setChanges((previous) => {
			const result = { ...previous };
			if (
				next === snapshot()?.values[key] ||
				(next === "" && snapshot()?.values[key] === undefined)
			)
				delete result[key];
			else result[key] = next;
			return result;
		});
	}
	async function save() {
		const current = snapshot();
		if (!dirtyCount()) return;
		if (!current || loading() || saving())
			throw new Error("Game options are still loading or saving");
		const request = generation;
		setSaving(true);
		setError("");
		try {
			const next = await invoke<Snapshot>("save_instance_game_options", {
				instanceId: props.instanceId,
				editorValues: true,
				patch: { revision: current.revision, changes: changes() },
			});
			if (request !== generation) return;
			setSnapshot(next);
			setChanges({});
			setNotice(t("game-options-saved"));
		} catch (failure) {
			if (request === generation) setError(String(failure));
			throw failure;
		} finally {
			if (request === generation) setSaving(false);
		}
	}
	return {
		instanceId: () => props.instanceId,
		snapshot,
		loading,
		saving,
		error,
		notice,
		query,
		setQuery,
		category,
		setCategory,
		dirtyCount,
		busy,
		value,
		label: labelFor,
		categories,
		change,
		rows,
		save,
		reload: () => props.instanceId !== undefined && load(props.instanceId),
		discard: () => {
			setChanges({});
			setNotice("");
		},
	};
}

export function GameOptionsEditor(props: {
	state: ReturnType<typeof createGameOptionsEditor>;
	onBack?: () => void;
}) {
	const {
		snapshot,
		loading,
		saving,
		error,
		notice,
		query,
		setQuery,
		category,
		setCategory,
		dirtyCount,
		busy,
		value,
		label,
		categories,
		change,
		reload,
		rows,
	} = props.state;
	const nav = createMemo(() => [
		{ id: "all", label: categoryLabel("all"), icon: categoryIcons.all },
		...categories().map((entry) => ({
			id: entry,
			label: categoryLabel(entry),
			icon: categoryIcons[entry] ?? categoryIcons.custom,
		})),
	]);
	const optionRows = createMemo(() =>
		rows().filter((row) => {
			const matches = `${row.key} ${label(row)}`
				.toLocaleLowerCase()
				.includes(query().toLocaleLowerCase());
			return (
				matches &&
				(Boolean(query()) ||
					category() === "all" ||
					category() === row.category)
			);
		}),
	);
	const statusHint = createMemo(() => {
		if (loading()) return t("game-options-loading");
		if (snapshot()?.exists === false) return t("game-options-missing");
		if (dirtyCount() > 0)
			return t("game-options-count", { count: dirtyCount() });
		return undefined;
	});

	return (
		<div
			class={`${pageStyles["settings-tab-content"]} ${optionBrowserPageFill}`}
		>
			<div
				class={`${panelStyles["settings-panel"]} ${panelStyles["settings-panel--fill"]}`}
			>
				<Show when={error()}>
					<p role="alert" class={styles.error}>
						{error()}
					</p>
				</Show>
				<Show when={notice()}>
					<p role="status" class={styles.notice}>
						{notice()}
					</p>
				</Show>
				<OptionBrowser
					label={t("game-options-title")}
					title={t("game-options-title")}
					onBack={props.onBack}
					backLabel={t("game-options-back")}
					searchLabel={t("game-options-search")}
					categoriesLabel={t("game-options-category")}
					query={query()}
					onQuery={setQuery}
					categories={nav()}
					category={category()}
					onCategory={(id) => {
						setQuery("");
						setCategory(id);
					}}
					hint={statusHint()}
					actions={
						<Button
							variant="outline"
							size="sm"
							disabled={loading() || saving() || dirtyCount() > 0}
							onClick={() => void reload()}
						>
							<ReloadIcon class={styles.icon} />
							{t("game-options-reload")}
						</Button>
					}
				>
					<Show when={!loading() && snapshot()}>
						<For each={optionRows()}>
							{(row) => (
								<OptionRow title={label(row)} hint={row.key}>
									<ValueControl
										option={row}
										value={value(row.key)}
										disabled={busy()}
										onSave={(next) => change(row.key, next)}
									/>
								</OptionRow>
							)}
						</For>
						<Show when={!optionRows().length}>
							<OptionEmpty>{t("game-options-no-results")}</OptionEmpty>
						</Show>
					</Show>
				</OptionBrowser>
			</div>
		</div>
	);
}
