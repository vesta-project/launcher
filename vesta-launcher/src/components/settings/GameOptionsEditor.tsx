import { invoke } from "@tauri-apps/api/core";
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

export function GameOptionsEditor(props: {
	instanceId: number;
	disabled?: boolean;
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
	const label = (row: CatalogEntry) => (row.labelId ? t(row.labelId) : row.key);
	const rows = createMemo(() => {
		const known = new Map(catalog().map((row) => [row.key, row]));
		for (const key of Object.keys(snapshot()?.values ?? {})) {
			if (!known.has(key) && !protectedKeys.has(key))
				known.set(key, {
					key,
					category: key.startsWith("key_") ? "keybindings" : "custom",
					labelId: "",
					kind: "text",
					min: null,
					max: null,
				});
		}
		return [...known.values()].filter((row) => !protectedKeys.has(row.key));
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
	createEffect(() => {
		const id = props.instanceId;
		setSnapshot(undefined);
		setChanges({});
		setSaving(false);
		void load(id);
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
	async function save(event: SubmitEvent) {
		event.preventDefault();
		const current = snapshot();
		if (!current || busy() || !dirtyCount()) return;
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
		} finally {
			if (request === generation) setSaving(false);
		}
	}
	return (
		<form
			class={styles.editor}
			onSubmit={save}
			noValidate
			aria-label={t("game-options-title")}
		>
			<header class={styles.header}>
				<div>
					<h3>{t("game-options-title")}</h3>
					<p>{t("game-options-description")}</p>
				</div>
				<div class={styles.actions}>
					<button
						type="button"
						disabled={loading() || saving() || dirtyCount() > 0}
						onClick={() => void load(props.instanceId)}
					>
						{t("game-options-reload")}
					</button>
					<button
						type="button"
						disabled={busy() || !dirtyCount()}
						onClick={() => {
							setChanges({});
							setNotice("");
						}}
					>
						{t("game-options-discard")}
					</button>
					<button type="submit" disabled={busy() || !dirtyCount()}>
						{saving() ? t("game-options-saving") : t("game-options-save")}
					</button>
				</div>
			</header>
			<div class={styles.filters}>
				<input
					type="search"
					aria-label={t("game-options-search")}
					placeholder={t("game-options-search")}
					value={query()}
					onInput={(e) => setQuery(e.currentTarget.value)}
				/>
				<select
					aria-label={t("game-options-category")}
					value={category()}
					onChange={(e) => setCategory(e.currentTarget.value)}
				>
					<option value="all">{t("game-options-all")}</option>
					<For each={categories()}>
						{(item) => (
							<option value={item}>{t(`game-options-category-${item}`)}</option>
						)}
					</For>
				</select>
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
								<label
									class={styles.row}
									data-dirty={Object.hasOwn(changes(), row.key)}
								>
									<span class={styles.name}>
										{label(row)}
										<Show when={row.labelId}>
											<small>{row.key}</small>
										</Show>
									</span>
									<Show
										when={row.kind === "boolean"}
										fallback={
											<input
												aria-label={label(row)}
												disabled={busy()}
												type={
													row.kind === "number" &&
													(value(row.key) === "" ||
														Number.isFinite(Number(value(row.key))))
														? "number"
														: "text"
												}
												min={row.key === "fov" ? 30 : (row.min ?? undefined)}
												max={row.key === "fov" ? 110 : (row.max ?? undefined)}
												step="any"
												placeholder={t("game-options-unset")}
												value={
													row.key === "fov" &&
													value(row.key) !== "" &&
													Number.isFinite(Number(value(row.key)))
														? 70 + 40 * Number(value(row.key))
														: value(row.key)
												}
												onInput={(e) =>
													change(
														row.key,
														row.key === "fov" &&
															e.currentTarget.value !== "" &&
															Number.isFinite(Number(e.currentTarget.value))
															? String(
																	(Number(e.currentTarget.value) - 70) / 40,
																)
															: e.currentTarget.value,
													)
												}
											/>
										}
									>
										<select
											aria-label={label(row)}
											disabled={busy()}
											value={value(row.key)}
											onChange={(e) => change(row.key, e.currentTarget.value)}
										>
											<Show
												when={
													value(row.key) !== "true" &&
													value(row.key) !== "false"
												}
											>
												<option value={value(row.key)}>
													{value(row.key) || t("game-options-unset")}
												</option>
											</Show>
											<option value="true">{t("game-options-on")}</option>
											<option value="false">{t("game-options-off")}</option>
										</select>
									</Show>
								</label>
							)}
						</For>
					</div>
					<Show when={!filtered().length}>
						<p>{t("game-options-no-results")}</p>
					</Show>
				</Show>
			</Show>
		</form>
	);
}
