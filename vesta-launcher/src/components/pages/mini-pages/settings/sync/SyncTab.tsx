import ReloadIcon from "@assets/icons/actions/reload.svg";
import GearIcon from "@assets/icons/content/gear.svg";
import GlobeIcon from "@assets/icons/content/globe.svg";
import LayersIcon from "@assets/icons/content/layers.svg";
import LinkIcon from "@assets/icons/content/link.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import BackIcon from "@assets/icons/navigation/arrow-back.svg";
import InstanceSelectionDialog from "@components/instances/InstanceSelectionDialog";
import { SettingsCard } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	type Instance,
	initializeInstances,
	instances,
	instancesError,
} from "@stores/instances";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import {
	Switch,
	SwitchControl,
	SwitchLabel,
	SwitchThumb,
} from "@ui/switch/switch";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import {
	createAnimatedIconPreview,
	iconBackgroundStyle,
} from "@utils/icon-animation";
import { DEFAULT_ICONS } from "@utils/instances";
import {
	type Component,
	createMemo,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { t } from "~/localization";
import {
	type Category,
	categories,
	type Preferences,
	type Snapshot,
} from "~/settings-sync/model";
import pageStyles from "../settings-page.module.css";
import { SharedOptionsPage } from "./SharedOptionsPage";
import { SquareToggle } from "./SquareToggle";
import styles from "./sync-tab.module.css";

const categoryIcons: Record<Category, Component<{ class?: string }>> = {
	gameOptions: GearIcon,
	servers: GlobeIcon,
	resourcePacks: LayersIcon,
};

const filledMarks = new Set<Category>(["gameOptions"]);

function InstanceMark(props: { instance: Instance }) {
	const iconPath = () => props.instance.iconPath || DEFAULT_ICONS[0];
	const preview = createAnimatedIconPreview(iconPath);
	const initial = () => {
		const match = props.instance.name.match(/[a-zA-Z]/);
		return (match?.[0] ?? props.instance.name.charAt(0) ?? "?").toUpperCase();
	};
	return (
		<Show
			when={preview.displaySource()}
			fallback={
				<div class={styles.instanceFallback} aria-hidden="true">
					{initial()}
				</div>
			}
		>
			<div
				class={styles.instanceIcon}
				style={iconBackgroundStyle(preview.displaySource())}
				onMouseEnter={preview.activate}
				onMouseLeave={preview.deactivate}
				aria-hidden="true"
			/>
		</Show>
	);
}

function CategoryMark(props: { category: Category }) {
	const Icon = categoryIcons[props.category];
	return (
		<span
			class={styles.mark}
			classList={{ [styles.markFilled]: filledMarks.has(props.category) }}
			aria-hidden="true"
		>
			<Icon />
		</span>
	);
}

function Toggle(props: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<Switch
			checked={props.checked}
			disabled={props.disabled}
			onCheckedChange={props.onChange}
		>
			<SwitchLabel class={styles.srOnly}>{props.label}</SwitchLabel>
			<SwitchControl>
				<SwitchThumb />
			</SwitchControl>
		</Switch>
	);
}

function DetailHeading(props: {
	title: string;
	checked: boolean;
	disabled?: boolean;
	onBack: () => void;
	onToggle: (enabled: boolean) => void;
}) {
	return (
		<div class={styles.heading}>
			<Button
				class={styles.back}
				variant="ghost"
				size="sm"
				onClick={props.onBack}
			>
				<BackIcon class={styles.icon} />
				{t("sync-back")}
			</Button>
			<h2 class={styles.headingTitle}>{props.title}</h2>
			<Toggle
				label={props.title}
				checked={props.checked}
				disabled={props.disabled}
				onChange={props.onToggle}
			/>
		</div>
	);
}

export function SyncSettingsTab() {
	const [snapshots, { mutate, refetch }] = createResource(async () => {
		await initializeInstances();
		const failure = instancesError();
		if (failure) throw new Error(failure);
		return invoke<Snapshot[]>("get_settings_sync");
	});
	const [sharedPage, setSharedPage] = createSignal(false);
	const [editing, setEditing] = createSignal<Category>();
	const [picking, setPicking] = createSignal<Category>();
	const [query, setQuery] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const title = (category: Category) => t(`sync-${category}-title`);
	const snapshot = (category: Category) =>
		snapshots()?.find((item) => item.category === category);
	const available = createMemo(() =>
		instances().filter((instance) => instance.id > 0),
	);
	const matching = () =>
		available().filter((instance) =>
			instance.name.toLocaleLowerCase().includes(query().toLocaleLowerCase()),
		);
	async function save(
		category: Category,
		preferences: Preferences,
		gameOptionChanges?: Record<string, string>,
	) {
		const current = snapshot(category);
		if (!current || busy()) return false;
		setBusy(true);
		setError("");
		try {
			const next = await invoke<Snapshot>("save_settings_sync", {
				category,
				revision: current.revision,
				preferences,
				gameOptionChanges,
			});
			mutate((previous) =>
				previous?.map((item) => (item.category === category ? next : item)),
			);
			if (next.pending?.length) setError(next.pending.join("\n"));
			return true;
		} catch (failure) {
			setError(String(failure));
			return false;
		} finally {
			setBusy(false);
		}
	}
	const update = (category: Category, changes: Partial<Preferences>) => {
		const current = snapshot(category);
		if (current) void save(category, { ...current.preferences, ...changes });
	};
	const toggle = (category: Category, enabled: boolean) => {
		if (
			enabled &&
			category === "gameOptions" &&
			!snapshot(category)?.initialized
		)
			setPicking(category);
		else {
			const current = snapshot(category);
			if (current)
				void save(category, {
					...current.preferences,
					enabled,
					sourceInstanceId:
						category === "gameOptions"
							? current.preferences.sourceInstanceId
							: null,
				});
		}
	};
	const status = (category: Category) => {
		const current = snapshot(category);
		if (!current?.preferences.enabled) return "";
		const count = current.preferences.instanceIds.length;
		return count ? t("sync-linked", { count }) : "";
	};
	return (
		<div class={pageStyles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<Show when={error() || snapshots.error}>
					<div role="alert" class={styles.error}>
						<span>{error() || String(snapshots.error)}</span>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy()}
							onClick={() => {
								setError("");
								void refetch();
							}}
						>
							<ReloadIcon class={styles.icon} />
							{t("sync-reload")}
						</Button>
					</div>
				</Show>
				<Show
					when={!snapshots.loading}
					fallback={
						<p role="status" class={styles.loading}>
							{t("sync-loading")}
						</p>
					}
				>
					<Show when={snapshots()}>
						<Show
							when={sharedPage()}
							fallback={
								<Show
									when={editing()}
									fallback={
										<SettingsCard>
											<div class={styles.categories}>
												<For each={categories}>
													{(category) => (
														<div class={styles.row}>
															<button
																type="button"
																class={styles.category}
																aria-label={t("sync-edit", {
																	category: title(category),
																})}
																onClick={() => {
																	setQuery("");
																	setEditing(category);
																}}
															>
																<CategoryMark category={category} />
																<span class={styles.copy}>
																	<span class={styles.title}>
																		{title(category)}
																	</span>
																	<Show when={status(category)}>
																		<span class={styles.meta}>
																			{status(category)}
																		</span>
																	</Show>
																</span>
															</button>
															<div class={styles.actions}>
																<Toggle
																	label={title(category)}
																	checked={
																		snapshot(category)?.preferences.enabled ??
																		false
																	}
																	disabled={busy()}
																	onChange={(enabled) =>
																		toggle(category, enabled)
																	}
																/>
															</div>
														</div>
													)}
												</For>
											</div>
										</SettingsCard>
									}
								>
									{(category) => {
										const current = () => snapshot(category());
										const allLinked = () =>
											available().length > 0 &&
											available().every((instance) =>
												current()?.preferences.instanceIds.includes(
													instance.id,
												),
											);
										return (
											<>
												<Show when={category() === "gameOptions"}>
													<SettingsCard>
														<DetailHeading
															title={title(category())}
															checked={current()?.preferences.enabled ?? false}
															disabled={busy()}
															onBack={() => setEditing(undefined)}
															onToggle={(enabled) =>
																toggle(category(), enabled)
															}
														/>

														<div class={styles.row}>
															<span class={styles.copy}>
																<span class={styles.title}>
																	{t("sync-bundle-title")}
																</span>
																<span class={styles.meta}>
																	{t(
																		current()?.preferences.enabled
																			? "sync-shared-entry-hint"
																			: "sync-enable-to-edit",
																	)}
																</span>
															</span>
															<Button
																variant="outline"
																size="sm"
																disabled={
																	busy() || !current()?.preferences.enabled
																}
																onClick={() => setSharedPage(true)}
															>
																{t("sync-edit-shared")}
															</Button>
														</div>
													</SettingsCard>
												</Show>
												<SettingsCard
													header={
														category() === "gameOptions"
															? t("sync-instances")
															: undefined
													}
												>
													<Show when={category() !== "gameOptions"}>
														<DetailHeading
															title={title(category())}
															checked={current()?.preferences.enabled ?? false}
															disabled={busy()}
															onBack={() => setEditing(undefined)}
															onToggle={(enabled) =>
																toggle(category(), enabled)
															}
														/>
													</Show>

													<div class={styles.bulkRow}>
														<span class={styles.hint}>
															{t("sync-instances-hint")}
														</span>
														<Button
															class={styles.bulkToggle}
															variant="outline"
															size="sm"
															disabled={busy() || !available().length}
															onClick={() =>
																update(category(), {
																	instanceIds: allLinked()
																		? []
																		: available().map((instance) => instance.id),
																})
															}
														>
															{allLinked()
																? t("sync-unsync-all")
																: t("sync-all-instances")}
														</Button>
													</div>
													<div class={styles.search}>
														<SearchIcon
															class={styles.searchIcon}
															aria-hidden="true"
														/>
														<TextFieldRoot>
															<TextFieldInput
																class={styles.searchInput}
																type="search"
																aria-label={t("sync-search")}
																placeholder={t("sync-search")}
																value={query()}
																onInput={(event) =>
																	setQuery(
																		(event.currentTarget as HTMLInputElement)
																			.value,
																	)
																}
															/>
														</TextFieldRoot>
													</div>
													<div class={styles.members}>
														<For each={matching()}>
															{(instance) => {
																const linked = () =>
																	current()?.preferences.instanceIds.includes(
																		instance.id,
																	) ?? false;
																return (
																	<div class={styles.row}>
																		<InstanceMark instance={instance} />
																		<span class={styles.copy}>
																			<span class={styles.title}>
																				{instance.name}
																			</span>
																			<span class={styles.meta}>
																				{instance.minecraftVersion}
																			</span>
																		</span>
																		<SquareToggle
																			label={t("sync-instance-label", {
																				name: instance.name,
																			})}
																			pressed={linked()}
																			disabled={busy()}
																			iconOnly
																			onChange={(pressed) => {
																				const next = current();
																				if (!next) return;
																				void save(category(), {
																					...next.preferences,
																					instanceIds: pressed
																						? [
																								...next.preferences.instanceIds,
																								instance.id,
																							]
																						: next.preferences.instanceIds.filter(
																								(id) => id !== instance.id,
																							),
																				});
																			}}
																		>
																			<LinkIcon class={styles.icon} />
																		</SquareToggle>
																	</div>
																);
															}}
														</For>
													</div>
													<Show when={!matching().length}>
														<p class={styles.empty}>{t("sync-no-instances")}</p>
													</Show>
												</SettingsCard>
											</>
										);
									}}
								</Show>
							}
						>
							<Show when={snapshot("gameOptions")}>
								{(current) => (
									<SharedOptionsPage
										snapshot={current()}
										busy={busy()}
										onBack={() => setSharedPage(false)}
										onSave={(preferences, changes) =>
											save("gameOptions", preferences, changes)
										}
									/>
								)}
							</Show>
						</Show>
					</Show>
				</Show>
			</div>
			<InstanceSelectionDialog
				isOpen={Boolean(picking())}
				title={t("sync-source-title")}
				description={t("sync-source-hint")}
				emptyMessage={t("sync-no-instances")}
				options={available().map((instance) => ({ instance }))}
				onClose={() => {
					if (!busy()) setPicking(undefined);
				}}
				onSelect={async (instance) => {
					const category = picking();
					const current = category ? snapshot(category) : undefined;
					if (!category || !current) return;
					if (
						await save(category, {
							enabled: true,
							sourceInstanceId: instance.id,
							instanceIds: [
								...new Set([...current.preferences.instanceIds, instance.id]),
							],
						})
					)
						setPicking(undefined);
				}}
			/>
		</div>
	);
}
