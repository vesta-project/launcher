import CodeIcon from "@assets/icons/content/code.svg";
import CubeIcon from "@assets/icons/content/cube.svg";
import LayersIcon from "@assets/icons/content/layers.svg";
import LinkIcon from "@assets/icons/content/link.svg";
import MicIcon from "@assets/icons/security/mic.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import { SettingsCard } from "@components/settings";
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
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import {
	type Component,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";
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
type OptionRow = GameOptionMetadata;

const scopeIcons: Record<string, Component<{ class?: string }>> = {
	video: CubeIcon,
	sound: MicIcon,
	custom: CodeIcon,
};

function labelForOption(option: OptionRow): string {
	return option.labelId ? t(option.labelId) : formatGameOptionName(option.key);
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

function choiceLabel(choice: string | GameOptionChoice): string {
	if (typeof choice === "string") return choice;
	if (choice.labelId) return t(choice.labelId);
	return choice.label || choice.value;
}

function decimalPlaces(step: number): number {
	const text = String(step);
	const exponent = text.indexOf("e-");
	if (exponent >= 0) return Number(text.slice(exponent + 2));
	const decimal = text.indexOf(".");
	return decimal < 0 ? 0 : text.length - decimal - 1;
}

function serializeNumber(value: number, step: number | null | undefined): string {
	if (!Number.isFinite(value)) return "";
	const places = step === null || step === undefined ? 12 : decimalPlaces(step);
	return String(Number(value.toFixed(Math.min(12, places))));
}

function ValueControl(props: {
	option: OptionRow;
	value?: string;
	disabled: boolean;
	onSave: (value: string) => Promise<boolean>;
}) {
	const ariaLabel = () =>
		t("sync-value-label", { option: labelForOption(props.option) });
	const kind = () => props.option.kind;
	const choices = () => props.option.values ?? [];
	const numericRange = () => {
		const min = props.option.min;
		const max = props.option.max;
		if (typeof min !== "number" || typeof max !== "number" || min > max)
			return undefined;
		return { min, max };
	};
	const numberValue = () => {
		if (props.value === undefined || props.value.trim() === "") return null;
		const value = Number(props.value);
		return Number.isFinite(value) ? value : null;
	};

	return (
		<Show
			when={kind() === "boolean" && (props.value === "true" || props.value === "false")}
			fallback={
				<Show
					when={kind() === "enum" && choices().length > 0}
					fallback={
						<Show
							when={
								(kind() === "integer" || kind() === "decimal" || kind() === "number") &&
								numericRange() !== undefined &&
								numberValue() !== null
							}
							fallback={
								<TextFieldRoot class={styles.valueTextControl}>
									<TextFieldInput
										aria-label={ariaLabel()}
										type="text"
										value={props.value ?? ""}
										placeholder={t("sync-value-missing")}
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
									{props.value ?? t("sync-value-missing")}
								</span>
								<Slider
									value={[numberValue() as number]}
									minValue={numericRange()?.min}
									maxValue={numericRange()?.max}
									step={props.option.step ?? (kind() === "integer" ? 1 : 0.01)}
									disabled={props.disabled}
									aria-label={ariaLabel()}
									onChange={(next) => {
										if (props.disabled || next[0] === undefined) return;
										const value = serializeNumber(next[0], props.option.step);
										if (value !== props.value) void props.onSave(value);
									}}
								>
									<SliderTrack>
										<SliderFill />
										<SliderThumb />
									</SliderTrack>
								</Slider>
							</div>
						</Show>
					}
				>
					<Select<string>
						options={choices().map(choiceValue)}
						value={props.value}
						onChange={(value) => value !== null && void props.onSave(value)}
						optionValue={(value) => value}
						optionTextValue={(value) => {
							const choice = choices().find((item) => choiceValue(item) === value);
							return choice ? choiceLabel(choice) : value;
						}}
						itemComponent={(itemProps) => {
							const choice = choices().find(
								(item) => choiceValue(item) === itemProps.item.rawValue,
							);
							return (
								<SelectItem item={itemProps.item}>
									{choice ? choiceLabel(choice) : itemProps.item.rawValue}
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
									return choice ? choiceLabel(choice) : selected ?? "";
								}}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
				</Show>
			}
		>
			<Switch
				checked={props.value === "true"}
				disabled={props.disabled}
				onCheckedChange={(checked) => void props.onSave(String(checked))}
			>
				<SwitchLabel class={styles.srOnly}>{ariaLabel()}</SwitchLabel>
				<SwitchControl>
					<SwitchThumb />
				</SwitchControl>
			</Switch>
		</Show>
	);
}

function optionRows(snapshot: Snapshot): OptionRow[] {
	const values = snapshot.sharedValues ?? {};
	const known = new Map((snapshot.catalog ?? []).map((entry) => [entry.key, entry]));
	for (const key of Object.keys(values)) {
		if (!known.has(key)) {
			known.set(key, {
				key,
				category: key.startsWith("key_") ? "keybinds" : "custom",
				kind: "text",
			});
		}
	}
	return [...known.values()].filter(
		(entry) =>
			values[entry.key] !== undefined &&
			entry.category !== "keybindings" &&
			entry.category !== "keybinds" &&
			!entry.key.startsWith("key_"),
	);
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
			...([...present].filter((category) => category !== "custom").sort()),
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
		<SettingsCard>
			<div class={styles.heading}>
				<Button variant="ghost" size="sm" onClick={props.onBack}>
					{t("sync-back")}
				</Button>
				<h2 class={styles.headingTitle}>{t("sync-shared-page-title")}</h2>
			</div>
			<div class={styles.filters}>
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
							const Icon = scopeIcons[entry] ?? LayersIcon;
							return (
								<ToggleGroupItem
									value={entry}
									size="sm"
									icon_only
									aria-label={labelForScope(entry)}
								>
									<Icon class={styles.icon} />
								</ToggleGroupItem>
							);
						}}
					</For>
				</ToggleGroup>
				<Button
					class={styles.bulkToggle}
					variant="outline"
					size="sm"
					disabled={disabled() || availableKeys().length === 0}
					onClick={() =>
						void props.onSave({
							...props.snapshot.preferences,
							selectedKeys: allSelected() ? [] : availableKeys(),
						})
					}
				>
					{allSelected() ? t("sync-unsync-all") : t("sync-all")}
				</Button>
			</div>
			<p class={styles.hint}>
				{props.snapshot.preferences.enabled
					? t("sync-shared-hint")
					: t("sync-enable-to-edit")}
			</p>
			<div class={styles.optionRows}>
				<For each={filtered()}>
					{(option) => {
						const linked = () => selected().includes(option.key);
						const value = () => props.snapshot.sharedValues?.[option.key];
						return (
							<div class={styles.optionRow}>
								<div class={styles.optionName} title={option.key}>
									<span>{labelForOption(option)}</span>
									<small>{option.key}</small>
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
		</SettingsCard>
	);
}
