import { invoke } from "@tauri-apps/api/core";
import BackIcon from "@assets/icons/navigation/arrow-back.svg";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { t } from "~/localization";
import styles from "./game-options.module.css";
import Button from "@ui/button/button";
import { TextFieldRoot, TextFieldInput } from "@ui/text-field/text-field";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@ui/select/select";
import { formatGameOptionName } from "~/utils/game-option-label";

interface Snapshot {
	revision: string;
	exists: boolean;
	values: Record<string, string>;
}
interface CatalogEntry {
	key: string;
	category: string;
	labelId: string;
	kind: "boolean" | "number" | "text";
	min: number | null;
	max: number | null;
}
const protectedKeys = new Set([
	"version",
	"resourcePacks",
	"incompatibleResourcePacks",
]);

export function createGameOptionsEditor(props: {
	instanceId: number | undefined;
	disabled?: boolean;
	enabled?: boolean;
}) {
	const [snapshot, setSnapshot] = createSignal<Snapshot>();
	const [catalog, setCatalog] = createSignal<CatalogEntry[]>([]);
	const [changes, setChanges] = createSignal<Record<string, string>>({});
	const [loading, setLoading] = createSignal(true);
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
	const busy = () => loading() || saving() || props.disabled;
	const value = (key: string) =>
		changes()[key] ?? snapshot()?.values[key] ?? "";
	const label = (row: CatalogEntry) =>
		row.labelId ? t(row.labelId) : formatGameOptionName(row.key);
	const rows = createMemo(() => {
		const known = new Map(catalog().map((row) => [row.key, row]));
		for (const key of Object.keys(snapshot()?.values ?? {})) {
			if (!known.has(key) && !protectedKeys.has(key))
				known.set(key, {
					key,
					category: "custom",
					labelId: "",
					kind: "text",
					min: null,
					max: null,
				});
		}
		return [...known.values()].filter(
			(row) => !protectedKeys.has(row.key) && !row.key.startsWith("key_"),
		);
	});
	const categories = createMemo(() => [
		...new Set(rows().map((row) => row.category)),
	]);
	const filtered = createMemo(() =>
		rows().filter(
			(row) =>
				(category() === "all" || category() === row.category) &&
				`${row.key} ${label(row)}`
					.toLocaleLowerCase()
					.includes(query().toLocaleLowerCase()),
		),
	);
	async function load(instanceId: number) {
		const request = ++generation;
		setLoading(true);
		setError("");
		setNotice("");
		try {
			const [next, definitions] = await Promise.all([
				invoke<Snapshot>("get_instance_game_options", { instanceId }),
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
	createEffect(() => {
		const id = currentId();
		if (props.enabled === false) return;
		generation++;
		setSnapshot(undefined);
		setChanges({});
		setSaving(false);
		if (id !== undefined) void load(id);
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
		filtered,
		change,
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
		filtered,
		change,
		reload,
	} = props.state;
	const picker = (
		options: string[],
		selected: string,
		onChange: (value: string) => void,
		name: string,
		display: (value: string) => string,
	) => (
		<Select
			options={options}
			value={selected}
			onChange={(v) => {
				if (v !== null) onChange(v);
			}}
			disabled={busy()}
			itemComponent={(p) => (
				<SelectItem item={p.item}>{display(p.item.rawValue)}</SelectItem>
			)}
		>
			<SelectTrigger aria-label={name}>
				<SelectValue<string>>
					{(s) => display(s.selectedOption() ?? selected)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent />
		</Select>
	);
	const valueEditor = (row: CatalogEntry) => {
		if (row.kind === "boolean") {
			return picker(
				[...new Set([value(row.key), "true", "false"])],
				value(row.key),
				(next) => change(row.key, next),
				label(row),
				(next) =>
					next === "true"
						? t("game-options-on")
						: next === "false"
							? t("game-options-off")
							: next || t("game-options-unset"),
			);
		}
		const textEditor = () => {
			const raw = value(row.key);
			const display =
				row.key === "fov" && raw !== "" && Number.isFinite(Number(raw))
					? String(70 + 40 * Number(raw))
					: raw;
			return (
				<TextFieldRoot>
					<TextFieldInput
						aria-label={label(row)}
						disabled={busy()}
						type="text"
						inputMode={row.kind === "number" ? "decimal" : "text"}
						placeholder={t("game-options-unset")}
						value={display}
						onInput={(event) => {
							const next = (event.currentTarget as HTMLInputElement).value;
							change(
								row.key,
								row.key === "fov" &&
									next !== "" &&
									Number.isFinite(Number(next))
									? String((Number(next) - 70) / 40)
									: next,
							);
						}}
					/>
				</TextFieldRoot>
			);
		};
		if (row.kind === "number" && row.min !== null && row.max !== null) {
			const rawText = value(row.key);
			const raw = Number(rawText);
			const hasValue = rawText !== "" && Number.isFinite(raw);
			const storedMin = row.key === "fov" ? -1 : row.min;
			const storedMax = row.key === "fov" ? 1 : row.max;
			if (
				rawText !== "" &&
				(!hasValue || raw < storedMin || raw > storedMax)
			) {
				return textEditor();
			}
			const min = row.key === "fov" ? 30 : row.min;
			const max = row.key === "fov" ? 110 : row.max;
			const step = max - min <= 1 ? 0.01 : 1;
			const display = hasValue
				? row.key === "fov"
					? 70 + 40 * raw
					: raw
				: min;
			return (
				<div class={styles.numericControl}>
					<input
						class={styles.numericSlider}
						aria-label={label(row)}
						type="range"
						min={min}
						max={max}
						step={step}
						value={Math.min(max, Math.max(min, display))}
						disabled={busy()}
						onInput={(event) => {
							const nextValue = Number(
								(event.currentTarget as HTMLInputElement).value,
							);
							change(
								row.key,
								row.key === "fov"
									? String((nextValue - 70) / 40)
									: String(nextValue),
							);
						}}
					/>
					<output class={styles.numericValue}>
						{hasValue ? (step < 1 ? display.toFixed(2) : Math.round(display)) : "—"}
						{row.key === "fov" ? "°" : ""}
					</output>
				</div>
			);
		}
		return textEditor();
	};
	return (
		<section class={styles.editor} aria-label={t("game-options-title")}>
			<header class={styles.header}>
				<Show when={props.onBack}>
					<Button
						variant="ghost"
						size="sm"
						icon_only
						aria-label={t("game-options-back")}
						tooltip_text={t("game-options-back")}
						onClick={props.onBack}
					>
						<BackIcon width={16} height={16} aria-hidden="true" />
					</Button>
				</Show>
				<div>
					<h3>{t("game-options-title")}</h3>
					<p>{t("game-options-description")}</p>
				</div>
				<Button
					disabled={loading() || saving() || dirtyCount() > 0}
					onClick={() => void reload()}
				>
					{t("game-options-reload")}
				</Button>
			</header>
			<div class={styles.filters}>
				<TextFieldRoot>
					<TextFieldInput
						type="search"
						aria-label={t("game-options-search")}
						placeholder={t("game-options-search")}
						value={query()}
						onInput={(e) =>
							setQuery((e.currentTarget as HTMLInputElement).value)
						}
					/>
				</TextFieldRoot>
				{picker(
					["all", ...categories()],
					category(),
					setCategory,
					t("game-options-category"),
					(v) =>
						t(v === "all" ? "game-options-all" : `game-options-category-${v}`),
				)}
				<span class={styles.count} aria-live="polite">
					{t("game-options-count", { count: dirtyCount() })}
				</span>
			</div>
			<Show when={error()}>
				<p role="alert" class={styles.error}>
					{error()}
				</p>
			</Show>
			<Show when={notice()}>
				<p role="status">{notice()}</p>
			</Show>
			<Show
				when={!loading()}
				fallback={<p role="status">{t("game-options-loading")}</p>}
			>
				<Show when={snapshot()}>
					<Show when={!snapshot()?.exists}>
						<p>{t("game-options-missing")}</p>
					</Show>
					<div class={styles.rows}>
						<For each={filtered()}>
							{(row) => (
								<div class={styles.row}>
									<span class={styles.name}>
										{label(row)}
									</span>
									{valueEditor(row)}
								</div>
							)}
						</For>
					</div>
					<Show when={!filtered().length}>
						<p>{t("game-options-no-results")}</p>
					</Show>
				</Show>
			</Show>
		</section>
	);
}
