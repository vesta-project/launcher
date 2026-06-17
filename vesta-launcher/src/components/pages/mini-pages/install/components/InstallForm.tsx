import BackArrow from "@assets/back-arrow.svg";
import { ModloaderSwitcher } from "@components/modloader-switcher/modloader-switcher";
import { useMinecraftVersions } from "@stores/versions";
import { instanceDefaults } from "@stores/settings";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { areIconsEqual, IconPicker } from "@ui/icon-picker/icon-picker";
import { Separator } from "@ui/separator/separator";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "@ui/switch/switch";
import { TextFieldInput, TextFieldLabel, TextFieldRoot } from "@ui/text-field/text-field";
import { showToast } from "@ui/toast/toast";
import {
	DEFAULT_ICONS,
	GameVersionMetadata,
	getStableIconId,
	Instance,
	isDefaultIcon,
} from "@utils/instances";
import { getSystemMemoryMb, ModpackInfo } from "@utils/modpacks";
import {
	DEFAULT_MIN_MEMORY_MB,
	calculateRecommendedMemory,
	getDynamicPreferredMaxMemoryMb,
	getManualMemoryLimitMb,
	getMemoryWarningThresholdMb,
} from "@utils/memory-policy";
import {
	describeSelectionAdjustments,
	getAllModloaders,
	getLoaderVersionsForGameVersion,
	getModloadersForGameVersion,
	getNotifiableSelectionAdjustments,
	MODLOADER_DISPLAY_NAMES,
	resolveCompatibleVersionSelection,
} from "@utils/version-selection";
import { batch, createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import styles from "../install-page.module.css";

export interface InstallFormProps {
	compact?: boolean;
	initialData?: Partial<Instance>;

	initialName?: string;
	initialAuthor?: string;
	initialVersion?: string;
	initialModloader?: string;
	initialModloaderVersion?: string;
	initialIcon?: string;
	originalIcon?: string;
	initialMinMemory?: number;
	initialMaxMemory?: number;
	initialIncludeSnapshots?: boolean;
	initialJvmArgs?: string;

	isModpack?: any;
	isLocalImport?: boolean;
	modpackInfo?: ModpackInfo;
	modpackVersions?: any[];
	selectedModpackVersionId?: string;
	onModpackVersionChange?: (versionId: string) => void;

	projectId?: string;
	platform?: string;

	supportedMcVersions?: string[];
	supportedModloaders?: string[];

	onInstall: (data: Partial<Instance>) => Promise<void>;
	onCancel?: () => void;
	onStateChange?: (data: Partial<Instance>) => void;
	isInstalling?: boolean;
	isFetchingMetadata?: boolean;
}

interface DirtyState {
	name?: boolean;
	version?: boolean;
	loader?: boolean;
	loaderVer?: boolean;
	icon?: boolean;
	memory?: boolean;
	jvmArgs?: boolean;
	hooks?: boolean;
}

/**
 * InstallForm is a dedicated component for instance configuration.
 * It strictly separates "Standard" and "Modpack" layouts.
 */
export function InstallForm(props: InstallFormProps) {
	// --- Core Instance State ---
	const [name, setName] = createSignal(props.initialData?.name || props.initialName || "");
	const [icon, setIcon] = createSignal<string | null>(
		props.initialData?.iconPath ||
			props.initialIcon ||
			getStableIconId(DEFAULT_ICONS[0]) ||
			DEFAULT_ICONS[0],
	);
	const [mcVersion, setMcVersion] = createSignal(
		props.initialData?.minecraftVersion || props.initialVersion || "",
	);
	const [loader, setLoader] = createSignal(
		props.initialData?.modloader || props.initialModloader || "vanilla",
	);
	const [loaderVer, setLoaderVer] = createSignal(
		props.initialData?.modloaderVersion || props.initialModloaderVersion || "",
	);
	const [memory, setMemory] = createSignal<number[]>([
		props.initialData?.minMemory ||
			props.initialMinMemory ||
			instanceDefaults().default_min_memory ||
			DEFAULT_MIN_MEMORY_MB,
		props.initialData?.maxMemory ||
			props.initialMaxMemory ||
			instanceDefaults().default_max_memory ||
			getDynamicPreferredMaxMemoryMb(16384),
	]);
	const [memoryUnit, setMemoryUnit] = createSignal<"MB" | "GB">("MB");
	const [includeSnapshots, setIncludeSnapshots] = createSignal(
		(props.initialData as any)?.includeSnapshots ?? props.initialIncludeSnapshots ?? false,
	);

	// --- State Propagation ---
	createEffect(() => {
		props.onStateChange?.({
			name: name(),
			iconPath: icon() || getStableIconId(DEFAULT_ICONS[0]) || DEFAULT_ICONS[0],
			minecraftVersion: mcVersion(),
			modloader: loader(),
			modloaderVersion: loaderVer(),
			minMemory: memory()[0],
			maxMemory: memory()[1],
			includeSnapshots: includeSnapshots(),
			javaArgs: jvmArgs(),
			_dirty: { ...dirty },
		} as any);
	});

	const toggleMemoryUnit = () => {
		setMemoryUnit(memoryUnit() === "MB" ? "GB" : "MB");
	};

	const formatMemory = (value: number) => {
		if (memoryUnit() === "GB") {
			return (value / 1024).toFixed(1);
		}
		return value.toString();
	};

	// --- Performance State ---
	const [totalRam, setTotalRam] = createSignal(16384);

	onMount(async () => {
		try {
			const ram = await invoke<number>("get_system_memory_mb");
			if (ram && ram > 0) setTotalRam(ram);
		} catch (e) {
			console.error("Failed to get system memory:", e);
		}
	});

	const [jvmArgs, setJvmArgs] = createSignal(
		props.initialData?.javaArgs || props.initialJvmArgs || "",
	);

	// --- Advanced Section ---
	const [showAdvanced, setShowAdvanced] = createSignal(false);
	const [useGlobalHooks, setUseGlobalHooks] = createSignal(true);
	const [preLaunchHook, setPreLaunchHook] = createSignal(props.initialData?.preLaunchHook || "");
	const [wrapperCommand, setWrapperCommand] = createSignal(props.initialData?.wrapperCommand || "");
	const [postExitHook, setPostExitHook] = createSignal(props.initialData?.postExitHook || "");

	// --- Data Sources ---
	const { versions: pistonMetadata } = useMinecraftVersions();

	const searchableModpackVersions = createMemo(() => {
		return (props.modpackVersions ?? []).map((v) => ({
			...v,
			// We create a composite string for the combobox to use for filtering
			searchString: `${v.version_number} ${(v.game_versions as string[]).join(" ")} ${(v.loaders as string[]).join(" ")}`,
		}));
	});

	const selectedModpackVersionOption = createMemo(() => {
		const selectedId = props.selectedModpackVersionId;
		if (!selectedId) return null;
		return searchableModpackVersions().find((version) => version.id === selectedId) || null;
	});

	// --- State Normalization ---
	const normalizedIsModpack = createMemo(() => {
		return String(props.isModpack) === "true" || props.isModpack === true;
	});

	// Flag to track if the user has manually changed fields
	// These are persisted across window handoffs via props.initialData._dirty
	const [dirty, setDirty] = createStore<DirtyState>((props.initialData as any)?._dirty || {});

	const isNameDirty = () => !!dirty.name;
	const isIconDirty = () => !!dirty.icon;
	const isVersionDirty = () => !!dirty.version;
	const isLoaderDirty = () => !!dirty.loader;
	const isLoaderVerDirty = () => !!dirty.loaderVer;
	const isJvmArgsDirty = () => !!dirty.jvmArgs;
	const isHooksDirty = () => !!dirty.hooks;
	const isMemoryDirty = () => !!dirty.memory;

	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<string[]>([]);

	const generatedMemoryRecommendation = createMemo(() =>
		calculateRecommendedMemory(
			totalRam(),
			normalizedIsModpack() ? props.modpackInfo?.modCount ?? 0 : 0,
			normalizedIsModpack() ? props.modpackInfo?.recommendedRamMb : null,
			{
				defaultMinMemory: instanceDefaults().default_min_memory,
				defaultMaxMemory: instanceDefaults().default_max_memory,
			},
		),
	);

	const formatMemoryLabel = (value: number) =>
		value >= 1024 ? `${(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB` : `${value} MB`;

	const memorySummaryReason = () => {
		if (isMemoryDirty()) return "Manually set for this instance.";

		const recommendation = generatedMemoryRecommendation();
		if (recommendation.adjustment === "high-for-device") {
			if (recommendation.source === "modpack") {
				return recommendation.policyMax > recommendation.generatedLimit
					? "Set below the modpack target to leave memory for the system. This pack may struggle."
					: "Using the modpack's recommendation. This is high for this device.";
			}
			if (recommendation.source === "mod-count") {
				return recommendation.policyMax > recommendation.generatedLimit
					? "Set below the pack target to leave memory for the system. This pack may struggle."
					: "Raised for this modpack. This is high for this device.";
			}
			return "Using your preferred max. This is high for this device.";
		}
		if (recommendation.source === "modpack") {
			return "Using the modpack's recommended memory.";
		}
		if (recommendation.adjustment === "increased") {
			const modCount = props.modpackInfo?.modCount;
			return modCount
				? `Raised for this modpack based on ${modCount} mods.`
				: "Raised for this modpack.";
		}
		return "Using your preferred max for new instances.";
	};

	const suggestedModpackIcon = createMemo(
		() => props.originalIcon || props.modpackInfo?.iconUrl || props.initialIcon || null,
	);

	// Create uploadedIcons array that includes all custom icons seen this session
	const uploadedIcons = createMemo(() => {
		const result = [...customIconsThisSession()];
		const suggested = suggestedModpackIcon();
		if (suggested && !isDefaultIcon(suggested) && !result.some((i) => areIconsEqual(i, suggested))) {
			result.unshift(suggested);
		}
		const current = icon();
		if (current && !isDefaultIcon(current) && !result.some((i) => areIconsEqual(i, current))) {
			return [current, ...result];
		}
		return result;
	});

	// Track custom icons in session list
	createEffect(() => {
		const current = icon();
		if (current && !isDefaultIcon(current) && !areIconsEqual(current, suggestedModpackIcon())) {
			setCustomIconsThisSession((prev) => {
				if (prev.some((i) => areIconsEqual(i, current))) return prev;
				return [current, ...prev];
			});
		}
	});

	// --- Initialization ---
	onMount(async () => {
		// Detect RAM
		try {
			const ram = await getSystemMemoryMb();
			if (ram > 0) setTotalRam(Number(ram));
		} catch (e) {
			console.error("Failed to detect RAM", e);
		}
	});

	// --- Reactive Sync (Props to Internal State) ---
	createEffect(() => {
		// Only seed if not already set or if explicitly provided as initial values
		// We use batch to ensure consistent state updates
		batch(() => {
			const d = props.initialData;

			if (d) {
				if (d.name !== undefined && !isNameDirty()) setName(d.name);
				if (d.minecraftVersion && !isVersionDirty()) setMcVersion(d.minecraftVersion);
				if (d.modloader && !isLoaderDirty()) setLoader(d.modloader.toLowerCase());
				if (d.modloaderVersion && !isLoaderVerDirty()) setLoaderVer(d.modloaderVersion);
				if (d.iconPath && !isIconDirty()) setIcon(d.iconPath);
				if (d.maxMemory && !isMemoryDirty()) setMemory([d.minMemory || 2048, d.maxMemory]);
				if (d.javaArgs !== undefined && !isJvmArgsDirty()) setJvmArgs(d.javaArgs ?? "");
				if (!isHooksDirty()) {
					if (d.useGlobalHooks !== undefined) setUseGlobalHooks(d.useGlobalHooks);
					if (d.preLaunchHook !== undefined) setPreLaunchHook(d.preLaunchHook || "");
					if (d.wrapperCommand !== undefined) setWrapperCommand(d.wrapperCommand || "");
					if (d.postExitHook !== undefined) setPostExitHook(d.postExitHook || "");
				}
			}

			if (props.initialName !== undefined && !isNameDirty() && !d?.name) setName(props.initialName);
			if (props.initialVersion && !isVersionDirty() && !d?.minecraftVersion)
				setMcVersion(props.initialVersion);
			if (props.initialModloader && !isLoaderDirty() && !d?.modloader)
				setLoader(props.initialModloader.toLowerCase());
			if (props.initialModloaderVersion && !isLoaderVerDirty() && !d?.modloaderVersion)
				setLoaderVer(props.initialModloaderVersion);
			if (props.initialIcon && !isIconDirty() && !d?.iconPath) setIcon(props.initialIcon);
			if (props.initialMaxMemory && !isMemoryDirty() && !d?.maxMemory) {
				setMemory([props.initialMinMemory || 2048, props.initialMaxMemory]);
			}
			if (props.initialIncludeSnapshots !== undefined)
				setIncludeSnapshots(props.initialIncludeSnapshots);
			if (props.initialJvmArgs !== undefined && !isJvmArgsDirty() && !d?.javaArgs)
				setJvmArgs(props.initialJvmArgs);
		});
	});

	// --- Reactive Sync (When Modpack Info Arrives/Changes) ---
	createEffect(() => {
		const info = props.modpackInfo;
		if (info && normalizedIsModpack()) {
			batch(() => {
				console.log("[InstallForm] Reactive sync from modpackInfo:", info.name);
				// We prioritize modpack-defined metadata unless user has already touched it
				if (info.name && !isNameDirty()) setName(info.name);
				if (info.iconUrl && !isIconDirty()) setIcon(info.iconUrl);
				if (info.minecraftVersion && !isVersionDirty()) setMcVersion(info.minecraftVersion);
				if (info.modloader && !isLoaderDirty()) setLoader(info.modloader.toLowerCase());
				if (info.modloaderVersion && !isLoaderVerDirty()) setLoaderVer(info.modloaderVersion);
				if (!isMemoryDirty()) {
					const rec = generatedMemoryRecommendation();
					setMemory([rec.min, rec.max]);
				}
			});
		}
	});

	createEffect(() => {
		if (normalizedIsModpack() || isMemoryDirty()) return;
		if (props.initialData?.maxMemory || props.initialMaxMemory) return;

		const rec = generatedMemoryRecommendation();
		setMemory([rec.min, rec.max]);
	});

	// --- Debug Helper ---
	createEffect(() => {
		console.log("[InstallForm] Props Log:", {
			isModpack: normalizedIsModpack(),
			modpackVersions: props.modpackVersions?.length,
			modpackInfo: !!props.modpackInfo,
			pistonMeta: !!pistonMetadata(),
		});
	});

	// --- Defaults & Selection Helpers ---
	createEffect(() => {
		// Pick latest stable MC version if none selected
		const meta = pistonMetadata();
		if (meta && !mcVersion() && !props.initialVersion && !normalizedIsModpack()) {
			const latestStable = meta.game_versions.find((v) => v.stable);
			if (latestStable) setMcVersion(latestStable.id);
		}
	});

	const [compatibilityInitialized, setCompatibilityInitialized] = createSignal(false);

	createEffect(() => {
		const meta = pistonMetadata();
		if (!meta || normalizedIsModpack()) return;

		const currentVersion = mcVersion();
		if (!currentVersion) return;

		const resolved = resolveCompatibleVersionSelection({
			metadata: meta,
			minecraftVersion: currentVersion,
			modloader: loader(),
			modloaderVersion: loaderVer(),
			includeSnapshots: includeSnapshots(),
			supportedMcVersions: props.supportedMcVersions,
			supportedModloaders: props.supportedModloaders,
		});

		const changed =
			resolved.minecraftVersion !== currentVersion ||
			resolved.modloader !== loader() ||
			resolved.modloaderVersion !== loaderVer();

		if (!changed) {
			if (!compatibilityInitialized()) {
				setCompatibilityInitialized(true);
			}
			return;
		}

		batch(() => {
			if (resolved.minecraftVersion !== currentVersion) {
				setMcVersion(resolved.minecraftVersion);
			}
			if (resolved.modloader !== loader()) {
				setLoader(resolved.modloader);
			}
			if (resolved.modloaderVersion !== loaderVer()) {
				setLoaderVer(resolved.modloaderVersion);
			}
		});

		const notifiableAdjustments = getNotifiableSelectionAdjustments(resolved.adjustments);

		if (compatibilityInitialized() && notifiableAdjustments.length > 0) {
			showToast({
				title: "Compatibility Adjusted",
				description: describeSelectionAdjustments(notifiableAdjustments),
				severity: "info",
			});
		}

		if (!compatibilityInitialized()) {
			setCompatibilityInitialized(true);
		}
	});

	// --- Derived Lists (Filtered for Standard Mode or Limited by Props) ---

	const availableMcVersions = createMemo(() => {
		const meta = pistonMetadata();
		const current = mcVersion();
		const currentL = loader();
		if (!meta) return current ? [{ id: current, stable: true }] : [];

		let versions = meta.game_versions;

		// Filter by loader support if not vanilla (pillar-driven selection)
		if (currentL && currentL !== "vanilla") {
			versions = versions.filter((v) => {
				const loaderKeys = Object.keys(v.loaders).map((l) => l.toLowerCase());
				return loaderKeys.includes(currentL.toLowerCase());
			});
		}

		// Priority 1: Filter by supportedMcVersions (from resource details)
		if (props.supportedMcVersions && props.supportedMcVersions.length > 0) {
			const supported = props.supportedMcVersions;
			versions = versions.filter((v) => supported.includes(v.id));
		}

		// Ensure current version is always in the list to prevent visual flickering
		if (current && !versions.some((v) => v.id === current)) {
			const syntheticVersion: GameVersionMetadata = {
				id: current,
				stable: true,
				version_type: "release",
				release_time: new Date().toISOString(),
				loaders: {},
			};
			versions = [syntheticVersion, ...versions];
		}

		// Priority 2: Filter by stable only
		return versions.filter((v) => {
			if (!includeSnapshots() && !v.stable) return false;
			return true;
		});
	});

	const availableLoaders = createMemo(() => {
		const meta = pistonMetadata();
		if (!meta) return [loader() || "vanilla"];

		const loaders = getAllModloaders(meta, props.supportedModloaders);
		const currentLoader = loader().toLowerCase();
		if (currentLoader && !loaders.includes(currentLoader)) {
			return [currentLoader, ...loaders];
		}

		return loaders;
	});

	const currentVersionSupportedLoaders = createMemo(() => {
		const meta = pistonMetadata();
		const currentV = mcVersion();
		if (!meta || !currentV) return ["vanilla"];

		return getModloadersForGameVersion(meta, currentV);
	});

	const modloaderSwitcherOptions = createMemo(() => {
		const supportedLoaders = currentVersionSupportedLoaders();
		return availableLoaders().map((loaderId) => ({
			value: loaderId,
			label: MODLOADER_DISPLAY_NAMES[loaderId] || loaderId,
			supported: supportedLoaders.includes(loaderId.toLowerCase()),
		}));
	});

	const availableLoaderVers = createMemo(() => {
		const meta = pistonMetadata();
		const currentV = mcVersion();
		const currentL = loader();
		const currentLV = loaderVer();

		if (!meta || !currentV || currentL === "vanilla")
			return currentLV ? [{ version: currentLV, stable: true }] : [];

		const list = getLoaderVersionsForGameVersion(meta, currentV, currentL);

		if (currentLV && !list.some((v) => v.version === currentLV)) {
			const synthetic = { version: currentLV, stable: true };
			return [synthetic, ...list];
		}

		return list;
	});

	// --- Actions ---

	const handleInstall = () => {
		console.log("[InstallForm] handleInstall triggered", {
			name: name(),
			mcVersion: mcVersion(),
			loader: loader(),
			loaderVer: loaderVer(),
		});
		const effectiveIcon = icon() || getStableIconId(DEFAULT_ICONS[0]) || DEFAULT_ICONS[0];
		const data: Partial<Instance> = {
			name: name(),
			iconPath: effectiveIcon,
			modpackIconUrl: (effectiveIcon.startsWith("http") ? effectiveIcon : null) || null,
			minecraftVersion: mcVersion(),
			modloader: loader(),
			modloaderVersion: loaderVer() || null,
			minMemory: memory()[0],
			maxMemory: memory()[1],
			javaArgs: jvmArgs() || null,
			// Linking data
			useGlobalResolution: true,
			useGlobalJavaArgs: true,
			useGlobalJavaPath: true,
			useGlobalHooks: useGlobalHooks(),
			useGlobalEnvironmentVariables: true,
			preLaunchHook: useGlobalHooks() ? null : preLaunchHook() || null,
			wrapperCommand: useGlobalHooks() ? null : wrapperCommand() || null,
			postExitHook: useGlobalHooks() ? null : postExitHook() || null,
			modpackId: props.projectId || props.modpackInfo?.modpackId || null,
			modpackPlatform: props.platform || props.modpackInfo?.modpackPlatform || null,
			modpackVersionId: props.selectedModpackVersionId || props.modpackInfo?.modpackVersionId || null,
		};
		props.onInstall(data);
	};

	return (
		<div
			class={styles["install-form"]}
			classList={{
				[styles["install-form--compact"]]: props.compact,
				[styles["install-form--installing"]]: props.isInstalling,
				[styles["install-form--fetching"]]: props.isFetchingMetadata,
			}}
		>
			<div class={styles["install-scroll-area"]}>
				<div
					class={styles["install-grid"]}
					classList={{
						[styles["install-grid--with-side"]]: normalizedIsModpack() && !!props.modpackInfo,
						[styles["install-grid--single"]]: !(normalizedIsModpack() && !!props.modpackInfo),
					}}
				>
					{/* Main Column */}
					<div class={styles["install-main-column"]}>
						{/* IDENTITY SECTION */}
						<div class={styles["form-section"]}>
							<div class={styles["form-section-title"]}>Instance Identity</div>
							<div class={styles["identity-row"]}>
								<IconPicker
									value={icon()}
									onSelect={(newIcon) => {
										setIcon(newIcon);
										setDirty("icon", true);
									}}
									modpackIcon={normalizedIsModpack() || props.projectId ? suggestedModpackIcon() : undefined}
									isSuggestedSelected={
										!!suggestedModpackIcon() && areIconsEqual(icon(), suggestedModpackIcon())
									}
									uploadedIcons={uploadedIcons()}
									showHint={!isIconDirty()}
									triggerProps={{
										class: styles["form-icon-trigger"],
									}}
								/>
								<div class={styles["name-field"]}>
									<TextFieldRoot>
										<TextFieldLabel>Instance Name</TextFieldLabel>
										<TextFieldInput
											value={name()}
											onInput={(e) => {
												setName((e.currentTarget as HTMLInputElement).value);
												setDirty("name", true);
											}}
											placeholder="My Instance"
										/>
									</TextFieldRoot>
								</div>
							</div>
						</div>

						{/* MODPACK VERSION PICKER */}
						<Show
							when={
								normalizedIsModpack() &&
								!props.isLocalImport &&
								(props.projectId || (props.modpackVersions && props.modpackVersions.length > 0))
							}
						>
							<div
								class={`${styles["form-section"]} ${styles["modpack-context-section"]}`}
								classList={{
									[styles["is-fetching"]]: props.isFetchingMetadata,
								}}
							>
								<div class={styles["form-section-title"]}>Modpack Configuration</div>
								<Show
									when={props.modpackVersions && props.modpackVersions.length > 0}
									fallback={
										<div class={styles["modpack-version-placeholder"]}>
											{props.isFetchingMetadata
												? "Fetching available versions..."
												: "No other versions available for this platform."}
										</div>
									}
								>
									<div class={styles["modpack-version-picker"]}>
										<div class={styles["field-label-manual"]}>Release Version</div>
										<Combobox<any>
											options={searchableModpackVersions()}
											value={selectedModpackVersionOption()}
											onChange={(version: any) => {
												if (version?.id) props.onModpackVersionChange?.(version.id);
											}}
											optionValue={(v) => v.id}
											optionLabel={(v) => {
												const mc = v.game_versions?.[0];
												return mc ? `${v.version_number} (MC ${mc})` : v.version_number;
											}}
											optionTextValue={(v) => v.searchString}
											placeholder={props.selectedModpackVersionId ? "Loading version..." : "Select version..."}
											itemComponent={(p) => (
												<ComboboxItem item={p.item}>
													<div class={styles["version-item-content"]}>
														<span class={styles["v-num"]}>{p.item.rawValue.version_number}</span>
														<span class={styles["v-meta"]}>
															{(p.item.rawValue.game_versions as string[]).join(", ")} -{" "}
															{(p.item.rawValue.loaders as string[]).join(", ")}
														</span>
													</div>
												</ComboboxItem>
											)}
										>
											<ComboboxControl aria-label="Modpack Version Selection">
												<ComboboxInput as="input" />
												<ComboboxTrigger />
											</ComboboxControl>
											<ComboboxContent />
										</Combobox>
									</div>
								</Show>
								<div class={styles["modpack-meta-grid"]}>
									<div class={styles["meta-item"]}>
										<span class={styles["label"]}>Minecraft</span>
										<span class={styles["value"]}>{mcVersion() || "Loading..."}</span>
									</div>
									<div class={styles["meta-item"]}>
										<span class={styles["label"]}>
											Modloader
											<HelpTrigger topic="MODLOADER_EXPLAINED" />
										</span>
										<span class={styles["value"]}>
											{MODLOADER_DISPLAY_NAMES[loader()] || loader()} {loaderVer()}
										</span>
									</div>
								</div>
								<div class={styles["memory-summary-card"]}>
									<div class={styles["memory-summary-header"]}>
										<span class={styles["memory-summary-title"]}>
											Memory
											<HelpTrigger topic="MODPACK_MEMORY_TARGETS" />
										</span>
										<span class={styles["memory-summary-value"]}>
											{formatMemoryLabel(memory()[1])} max
										</span>
									</div>
									<div class={styles["memory-summary-reason"]}>{memorySummaryReason()}</div>
									<Show when={!isMemoryDirty()}>
										<div class={styles["memory-summary-details"]}>
											<div>
												<span>Preferred</span>
												<strong>{formatMemoryLabel(generatedMemoryRecommendation().preferredMax)}</strong>
											</div>
											<div>
												<span>Pack target</span>
												<strong>{formatMemoryLabel(generatedMemoryRecommendation().policyMax)}</strong>
											</div>
											<div>
												<span>Safety target</span>
												<strong>{formatMemoryLabel(generatedMemoryRecommendation().generatedLimit)}</strong>
											</div>
										</div>
									</Show>
								</div>
							</div>
						</Show>

						{/* GAME OPTIONS (Standard / non-modpack installs) */}
						<Show when={!normalizedIsModpack()}>
							<div class={styles["form-section"]}>
								<div class={styles["form-section-title"]}>Game Options</div>
								<div class={styles["form-row"]}>
									<div class={styles["flex-grow"]}>
										<div class={styles["field-label-manual"]}>
											Modloader
											<HelpTrigger topic="MODLOADER_EXPLAINED" />
										</div>
										<ModloaderSwitcher
											options={modloaderSwitcherOptions()}
											value={loader()}
											onChange={(nextLoader) => {
												batch(() => {
													setLoader(nextLoader);
													setLoaderVer("");
													setDirty("loader", true);
												});
											}}
										/>
									</div>
								</div>
								<div class={styles["form-row"]}>
									<div class={styles["flex-grow"]}>
										<div class={styles["field-label-manual"]}>
											Minecraft Version
											<HelpTrigger topic="MINECRAFT_VERSION" />
										</div>
										<Combobox<string>
											options={availableMcVersions().map((v) => v.id)}
											value={mcVersion()}
											onChange={(v) => {
												if (v) {
													setMcVersion(v);
													setDirty("version", true);
												}
											}}
											placeholder="Pick a version..."
											itemComponent={(p) => <ComboboxItem item={p.item}>{p.item.rawValue}</ComboboxItem>}
										>
											<ComboboxControl aria-label="Version Picker">
												<ComboboxInput />
												<ComboboxTrigger />
											</ComboboxControl>
											<ComboboxContent />
										</Combobox>
									</div>
									<div class={styles["stable-switch-container"]}>
										<Switch
											checked={includeSnapshots()}
											onCheckedChange={setIncludeSnapshots}
											class={styles["form-switch"]}
										>
											<SwitchControl class={styles["form-switch__control"]}>
												<SwitchThumb class={styles["form-switch__thumb"]} />
											</SwitchControl>
											<SwitchLabel class={styles["form-switch__label"]}>Include Snapshots</SwitchLabel>
										</Switch>
									</div>
								</div>
							</div>
						</Show>

						<div>
							{/* ADVANCED SETTINGS (collapsible) */}
							<button
								class={styles["advanced-toggle"]}
								onClick={() => setShowAdvanced(!showAdvanced())}
								type="button"
							>
								<BackArrow
									class={styles["arrow"]}
									style={{
										transform: showAdvanced() ? "rotate(90deg)" : "rotate(-90deg)",
									}}
								/>
								Advanced Settings
							</button>

							<Show when={showAdvanced()}>
								<div class={styles["advanced-fields-box"]}>
									{/* MEMORY ALLOCATION */}
									<div class={styles["form-section"]}>
										<div class={styles["form-section-title"]}>Memory Allocation</div>
										<div class={styles["memory-setting"]}>
											<div class={styles["memory-header"]}>
												<div class={styles["memory-labels"]}>
													<span class={styles["main-label"]}>
														Allocation
														<HelpTrigger topic="MEMORY_ALLOCATION" />
													</span>
													<span class={styles["sub-label"]}>Min and Max memory in {memoryUnit()}</span>
												</div>
												<div class={styles["memory-range-display"]} onClick={toggleMemoryUnit}>
													{formatMemory(memory()[0])} {memoryUnit()} — {formatMemory(memory()[1])} {memoryUnit()}
												</div>
											</div>
											<Slider
												value={memory()}
												onChange={(val) => {
													setMemory([
														Math.min(val[0], getManualMemoryLimitMb(totalRam())),
														Math.min(val[1], getManualMemoryLimitMb(totalRam())),
													]);
													setDirty("memory", true);
												}}
												minValue={512}
												maxValue={getManualMemoryLimitMb(totalRam())}
												step={512}
											>
												<SliderTrack>
													<SliderFill />
													<SliderThumb />
													<SliderThumb />
												</SliderTrack>
											</Slider>
											<div class={styles["memory-footer"]}>
												<Show when={props.modpackInfo?.recommendedRamMb}>
													<span
														class={styles["rec-hint"]}
														classList={{
															[styles["is-low"]]: memory()[1] < (props.modpackInfo?.recommendedRamMb ?? 0),
														}}
													>
														Recommended: {formatMemory(props.modpackInfo?.recommendedRamMb ?? 0)} {memoryUnit()}
													</span>
												</Show>
												<Show when={memory()[1] >= getMemoryWarningThresholdMb(totalRam())}>
													<span class={styles["rec-hint"]}>
														This leaves little memory for the system and other apps.
													</span>
												</Show>
											</div>
										</div>
									</div>

									{/* LOADER VERSION (standard installs only) */}
									<Show when={!normalizedIsModpack() && loader() !== "vanilla"}>
										<div class={styles["form-section"]}>
											<div class={styles["form-section-title"]}>Loader Version</div>
											<Combobox<string>
												options={availableLoaderVers().map((v) => v.version)}
												value={loaderVer()}
												onChange={(v) => {
													if (v) {
														setLoaderVer(v);
														setDirty("loaderVer", true);
													}
												}}
												placeholder="Latest"
												itemComponent={(p) => {
													const vi = availableLoaderVers().find((v) => v.version === p.item.rawValue);
													return (
														<ComboboxItem item={p.item}>
															<div
																style={{
																	display: "flex",
																	"justify-content": "space-between",
																	width: "100%",
																	"align-items": "center",
																	gap: "12px",
																}}
															>
																<span>{p.item.rawValue}</span>
																<Show when={!vi?.stable}>
																	<span
																		style={{
																			"font-size": "10px",
																			background: "var(--surface-raised)",
																			padding: "2px 6px",
																			"border-radius": "4px",
																			opacity: 0.6,
																		}}
																	>
																		Experimental
																	</span>
																</Show>
															</div>
														</ComboboxItem>
													);
												}}
											>
												<ComboboxControl aria-label="Loader Version Picker">
													<ComboboxInput />
													<ComboboxTrigger />
												</ComboboxControl>
												<ComboboxContent />
											</Combobox>
										</div>
									</Show>

									{/* LIFE-CYCLE HOOKS */}
									<div class={styles["form-section"]}>
										<div class={styles["form-section-title"]}>Life-cycle Hooks</div>
										<div
											style={{
												display: "flex",
												"align-items": "center",
												"justify-content": "space-between",
												"margin-bottom": "8px",
											}}
										>
											<span
												style={{
													"font-size": "12px",
													color: "var(--text-secondary)",
												}}
											>
												Use global hook settings
											</span>
											<Switch
												checked={useGlobalHooks()}
												onCheckedChange={(val: boolean) => {
													setUseGlobalHooks(val);
													setDirty("hooks", true);
												}}
											>
												<SwitchControl>
													<SwitchThumb />
												</SwitchControl>
											</Switch>
										</div>
										<Show
											when={!useGlobalHooks()}
											fallback={
												<div
													style={{
														padding: "10px",
														"border-radius": "8px",
														border: "1px dashed var(--border-subtle)",
														opacity: 0.6,
														"font-size": "12px",
													}}
												>
													Using hooks from global settings.
												</div>
											}
										>
											<div
												style={{
													display: "flex",
													"flex-direction": "column",
													gap: "8px",
												}}
											>
												<TextFieldRoot>
													<TextFieldLabel>Pre-launch Hook</TextFieldLabel>
													<TextFieldInput
														value={preLaunchHook()}
														onInput={(e: any) => {
															setPreLaunchHook(e.currentTarget.value);
															setDirty("hooks", true);
														}}
														placeholder="e.g. C:\scripts\pre-launch.bat"
														style="font-family: var(--font-mono); font-size: 12px;"
													/>
												</TextFieldRoot>
												<TextFieldRoot>
													<TextFieldLabel>Wrapper Command</TextFieldLabel>
													<TextFieldInput
														value={wrapperCommand()}
														onInput={(e: any) => {
															setWrapperCommand(e.currentTarget.value);
															setDirty("hooks", true);
														}}
														placeholder="e.g. mangohud --dlsym"
														style="font-family: var(--font-mono); font-size: 12px;"
													/>
												</TextFieldRoot>
												<TextFieldRoot>
													<TextFieldLabel>Post-exit Hook</TextFieldLabel>
													<TextFieldInput
														value={postExitHook()}
														onInput={(e: any) => {
															setPostExitHook(e.currentTarget.value);
															setDirty("hooks", true);
														}}
														placeholder="e.g. powershell -File cleanup.ps1"
														style="font-family: var(--font-mono); font-size: 12px;"
													/>
												</TextFieldRoot>
											</div>
										</Show>
									</div>
								</div>
							</Show>
						</div>
					</div>

					{/* Side Column (Modpack Info) */}
					<Show when={normalizedIsModpack() && props.modpackInfo}>
						<div class={styles["install-side-column"]}>
							<div class={`${styles["form-section"]} ${styles["info-section"]}`}>
								<div class={styles["info-block-grid"]}>
									<div class={styles["info-block"]}>
										<span class={styles["info-label"]}>Author</span>
										<span class={styles["info-value"]}>
											{props.modpackInfo?.author || props.initialAuthor || "Unknown"}
											<Show when={props.modpackInfo?.modpackId || props.projectId}>
												<span class={styles["info-id"]}>
													{" "}
													({props.modpackInfo?.modpackId || props.projectId})
												</span>
											</Show>
										</span>
									</div>
									<div class={styles["info-block"]}>
										<span class={styles["info-label"]}>Pack Version</span>
										<span class={styles["info-value"]}>{props.modpackInfo?.version || "1.0.0"}</span>
									</div>
								</div>
								<Show when={props.modpackInfo?.description}>
									<div class={styles["info-description"]}>{props.modpackInfo?.description}</div>
								</Show>
							</div>
						</div>
					</Show>
				</div>
			</div>

			{/* FOOTER ACTIONS */}
			<Separator />
			<div class={styles["install-form__actions-container"]}>
				<div class={styles["install-form__actions"]}>
					<Show when={props.onCancel}>
						<LauncherButton variant="ghost" onClick={props.onCancel} disabled={props.isInstalling}>
							Cancel
						</LauncherButton>
					</Show>
					<LauncherButton
						color="primary"
						onClick={handleInstall}
						disabled={!name() || !mcVersion() || props.isInstalling}
						class={styles["install-submit-btn"]}
					>
						{props.isInstalling
							? "Installing..."
							: normalizedIsModpack()
								? "Install Modpack"
								: "Create Instance"}
					</LauncherButton>
				</div>
			</div>
		</div>
	);
}
