import ReloadIcon from "@assets/icons/actions/reload.svg";
import FileIcon from "@assets/icons/content/file.svg";
import {
	OptionBrowser,
	OptionEmpty,
	OptionRow,
	optionBrowserPageFill,
} from "@components/settings/OptionBrowser";
import { ValueControl } from "@components/pages/mini-pages/settings/sync/SharedOptionsPage";
import panelStyles from "@components/settings/settings.module.css";
import pageStyles from "@components/pages/mini-pages/settings/settings-page.module.css";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { t } from "~/localization";
import type { GameOptionMetadata } from "~/settings-sync/model";
import { formatGameOptionName } from "~/utils/game-option-label";
import { GameKeybindings } from "./GameKeybindings";
import styles from "./game-options.module.css";

interface Snapshot {
	revision: string;
	exists: boolean;
	values: Record<string, string>;
}

type CatalogEntry = GameOptionMetadata;

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

function labelFor(row: CatalogEntry) {
	return row.labelId
		? t(row.labelId)
		: formatGameOptionName(row.id ?? row.key);
}

function isKeybind(row: CatalogEntry) {
	return (
		row.category === "keybindings" ||
		row.category === "keybinds" ||
		row.key.startsWith("key_")
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
		for (const key of Object.keys(snapshot()?.values ?? {})) {
			if (known.has(key) || protectedKeys.has(key)) continue;
			const raw = snapshot()?.values[key] ?? "";
			known.set(key, {
				key,
				category: key.startsWith("key_") ? "keybinds" : "custom",
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
		return [...known.values()].filter((row) => !protectedKeys.has(row.key));
	});
	const categories = createMemo(() => {
		const present = new Set(
			rows()
				.filter((row) => !isKeybind(row))
				.map((row) => row.category),
		);
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
	let observedId: number | undefined;
	let requestedId: number | undefined;
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
		openFile: async () => {
			if (props.instanceId === undefined) return;
			setError("");
			try {
				await invoke("open_instance_game_options_file", {
					instanceId: props.instanceId,
				});
			} catch (failure) {
				setError(String(failure));
			}
		},
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
		rows,
		reload,
		openFile,
	} = props.state;
	const [view, setView] = createSignal<"options" | "keybindings">("options");
	const [openingFile, setOpeningFile] = createSignal(false);
	const nav = createMemo(() => [
		{ id: "all", label: categoryLabel("all") },
		...categories().map((entry) => ({
			id: entry,
			label: categoryLabel(entry),
		})),
		{
			id: "keybindings",
			label: t("game-options-tab-keybindings"),
		},
	]);
	const optionRows = createMemo(() =>
		rows().filter((row) => {
			if (isKeybind(row)) return false;
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
	const keybindState = {
		rows: () =>
			rows()
				.filter(isKeybind)
				.filter((row) =>
					`${row.key} ${label(row)}`
						.toLocaleLowerCase()
						.includes(query().toLocaleLowerCase()),
				),
		value,
		label,
		busy,
		change,
	};

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
					category={view() === "keybindings" ? "keybindings" : category()}
					onCategory={(id) => {
						setQuery("");
						if (id === "keybindings") {
							setView("keybindings");
							return;
						}
						setView("options");
						setCategory(id);
					}}
					hint={statusHint()}
					actions={
						<>
							<Button
								variant="outline"
								size="sm"
								disabled={loading() || saving() || openingFile()}
								onClick={() => {
									setOpeningFile(true);
									void openFile().finally(() => setOpeningFile(false));
								}}
							>
								<FileIcon class={styles.icon} />
								{t("game-options-open-file")}
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={loading() || saving() || dirtyCount() > 0}
								onClick={() => void reload()}
							>
								<ReloadIcon class={styles.icon} />
								{t("game-options-reload")}
							</Button>
						</>
					}
				>
					<Show
						when={view() === "options"}
						fallback={<GameKeybindings embedded state={keybindState} />}
					>
						<Show when={!loading() && snapshot()}>
							<For each={optionRows()}>
								{(row) => (
									<OptionRow title={label(row)} hint={row.key}>
										<ValueControl
											option={row}
											value={value(row.key)}
											disabled={busy()}
											onSave={(next) => {
												change(row.key, next);
											}}
										/>
									</OptionRow>
								)}
							</For>
							<Show when={!optionRows().length}>
								<OptionEmpty>{t("game-options-no-results")}</OptionEmpty>
							</Show>
						</Show>
					</Show>
				</OptionBrowser>
			</div>
		</div>
	);
}
