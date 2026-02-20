import LauncherButton from "@ui/button/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxItemIndicator,
	ComboboxItemLabel,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
	NumberFieldLabel,
} from "@ui/number-field/number-field";
import { Separator } from "@ui/separator/separator";
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
import {
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import {
	DEFAULT_ICONS,
	GameVersionMetadata,
	getMinecraftVersions,
	getStableIconId,
	Instance,
	isDefaultIcon,
	LoaderVersionInfo,
	PistonMetadata,
} from "@utils/instances";
import { getSystemMemoryMb, ModpackInfo } from "@utils/modpacks";
import {
	Accessor,
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	on,
	onMount,
	Show,
} from "solid-js";
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
	initialResW?: string;
	initialResH?: string;

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
	res?: boolean;
}

const MODLOADER_DISPLAY_NAMES: Record<string, string> = {
	vanilla: "Vanilla",
	fabric: "Fabric",
	forge: "Forge",
	neoforge: "NeoForge",
	quilt: "Quilt",
};

/**
 * InstallForm is a dedicated component for instance configuration.
 * It strictly separates "Standard" and "Modpack" layouts.
 */
export function InstallForm(props: InstallFormProps) {
	// --- Core Instance State ---
	const [name, setName] = createSignal(
		props.initialData?.name || props.initialName || "",
	);
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
		props.initialData?.minMemory || props.initialMinMemory || 2048,
		props.initialData?.maxMemory || props.initialMaxMemory || 4096,
	]);
	const [memoryUnit, setMemoryUnit] = createSignal<"MB" | "GB">("MB");
	const [includeSnapshots, setIncludeSnapshots] = createSignal(
		(props.initialData as any)?.includeSnapshots ??
			props.initialIncludeSnapshots ??
			false,
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
			width: parseInt(resW()) || 854,
			height: parseInt(resH()) || 480,
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
	const [jvmArgs, setJvmArgs] = createSignal(
		props.initialData?.javaArgs || props.initialJvmArgs || "",
	);
	const [resW, setResW] = createSignal(
		String(props.initialData?.width || props.initialResW || "854"),
	);
	const [resH, setResH] = createSignal(
		String(props.initialData?.height || props.initialResH || "480"),
	);

	// --- Internal UI Toggles ---

	// --- Data Sources ---
	const [pistonMetadata] = createResource<PistonMetadata>(getMinecraftVersions);

	const searchableModpackVersions = createMemo(() => {
		return (props.modpackVersions ?? []).map((v) => ({
			...v,
			// We create a composite string for the combobox to use for filtering
			searchString: `${v.version_number} ${(v.game_versions as string[]).join(" ")} ${(v.loaders as string[]).join(" ")}`,
		}));
	});

	// --- State Normalization ---
	const normalizedIsModpack = createMemo(() => {
		return String(props.isModpack) === "true" || props.isModpack === true;
	});

	// Flag to track if the user has manually changed fields
	// These are persisted across window handoffs via props.initialData._dirty
	const [dirty, setDirty] = createStore<DirtyState>(
		(props.initialData as any)?._dirty || {},
	);

	const isNameDirty = () => !!dirty.name;
	const isIconDirty = () => !!dirty.icon;
	const isVersionDirty = () => !!dirty.version;
	const isLoaderDirty = () => !!dirty.loader;
	const isLoaderVerDirty = () => !!dirty.loaderVer;
	const isJvmArgsDirty = () => !!dirty.jvmArgs;
	const isResDirty = () => !!dirty.res;
	const isMemoryDirty = () => !!dirty.memory;

	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<
		string[]
	>([]);

	// Create uploadedIcons array that includes all custom icons seen this session
	const uploadedIcons = createMemo(() => {
		const result = [...customIconsThisSession()];
		const current = icon();
		if (
			current &&
			!isDefaultIcon(current) &&
			current !== props.initialIcon &&
			!result.includes(current)
		) {
			return [current, ...result];
		}
		return result;
	});

	// Track custom icons in session list
	createEffect(() => {
		const current = icon();
		if (current && !isDefaultIcon(current) && current !== props.initialIcon) {
			setCustomIconsThisSession((prev) => {
				if (prev.includes(current)) return prev;
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
				if (d.minecraftVersion && !isVersionDirty())
					setMcVersion(d.minecraftVersion);
				if (d.modloader && !isLoaderDirty())
					setLoader(d.modloader.toLowerCase());
				if (d.modloaderVersion && !isLoaderVerDirty())
					setLoaderVer(d.modloaderVersion);
				if (d.iconPath && !isIconDirty()) setIcon(d.iconPath);
				if (d.maxMemory && !isMemoryDirty())
					setMemory([d.minMemory || 2048, d.maxMemory]);
				if (d.javaArgs !== undefined && !isJvmArgsDirty())
					setJvmArgs(d.javaArgs ?? "");
				if (d.width && !isResDirty()) setResW(String(d.width));
				if (d.height && !isResDirty()) setResH(String(d.height));
			}

			if (props.initialName !== undefined && !isNameDirty() && !d?.name)
				setName(props.initialName);
			if (props.initialVersion && !isVersionDirty() && !d?.minecraftVersion)
				setMcVersion(props.initialVersion);
			if (props.initialModloader && !isLoaderDirty() && !d?.modloader)
				setLoader(props.initialModloader.toLowerCase());
			if (
				props.initialModloaderVersion &&
				!isLoaderVerDirty() &&
				!d?.modloaderVersion
			)
				setLoaderVer(props.initialModloaderVersion);
			if (props.initialIcon && !isIconDirty() && !d?.iconPath)
				setIcon(props.initialIcon);
			if (props.initialMaxMemory && !isMemoryDirty() && !d?.maxMemory) {
				setMemory([props.initialMinMemory || 2048, props.initialMaxMemory]);
			}
			if (props.initialIncludeSnapshots !== undefined)
				setIncludeSnapshots(props.initialIncludeSnapshots);
			if (
				props.initialJvmArgs !== undefined &&
				!isJvmArgsDirty() &&
				!d?.javaArgs
			)
				setJvmArgs(props.initialJvmArgs);
			if (props.initialResW && !isResDirty() && !d?.width)
				setResW(props.initialResW);
			if (props.initialResH && !isResDirty() && !d?.height)
				setResH(props.initialResH);
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
				if (info.minecraftVersion && !isVersionDirty())
					setMcVersion(info.minecraftVersion);
				if (info.modloader && !isLoaderDirty())
					setLoader(info.modloader.toLowerCase());
				if (info.modloaderVersion && !isLoaderVerDirty())
					setLoaderVer(info.modloaderVersion);
				if (info.recommendedRamMb && !isMemoryDirty())
					setMemory([2048, info.recommendedRamMb]);
			});
		}
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
		if (
			meta &&
			!mcVersion() &&
			!props.initialVersion &&
			!normalizedIsModpack()
		) {
			const latestStable = meta.game_versions.find((v) => v.stable);
			if (latestStable) setMcVersion(latestStable.id);
		}
	});

	createEffect(() => {
		// Automatically select the best loader version when loader or MC version changes
		const versions = availableLoaderVers();
		if (versions.length > 0) {
			const current = loaderVer();
			const exists = versions.some((v) => v.version === current);

			// If nothing set, or if current selection is invalid for this loader/MC combo
			if (!current || !exists) {
				const latestStable = versions.find((v: LoaderVersionInfo) => v.stable);
				setLoaderVer(latestStable ? latestStable.version : versions[0].version);
			}
		}
	});

	// --- Derived Lists (Filtered for Standard Mode or Limited by Props) ---

	const availableMcVersions = createMemo(() => {
		const meta = pistonMetadata();
		const current = mcVersion();
		if (!meta) return current ? [{ id: current, stable: true }] : [];

		let versions = meta.game_versions;

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
		const currentV = mcVersion();
		const currentL = loader();
		if (!meta || !currentV) return [currentL || "vanilla"];

		const vData = meta.game_versions.find((v) => v.id === currentV);
		if (!vData) return [currentL || "vanilla"];

		const set = new Set(["vanilla"]);
		Object.keys(vData.loaders).forEach((l) => {
			const loaderName = l.toLowerCase();
			// Filter by supportedModloaders if provided
			if (props.supportedModloaders && props.supportedModloaders.length > 0) {
				if (props.supportedModloaders.includes(loaderName)) {
					set.add(loaderName);
				}
			} else {
				set.add(loaderName);
			}
		});

		if (currentL && !set.has(currentL.toLowerCase())) {
			set.add(currentL.toLowerCase());
		}

		return Array.from(set);
	});

	const availableLoaderVers = createMemo(() => {
		const meta = pistonMetadata();
		const currentV = mcVersion();
		const currentL = loader();
		const currentLV = loaderVer();

		if (!meta || !currentV || currentL === "vanilla")
			return currentLV ? [{ version: currentLV, stable: true }] : [];

		const vData = meta.game_versions.find((v) => v.id === currentV);
		const list = vData?.loaders[currentL] || [];

		if (currentLV && !list.some((v) => v.version === currentLV)) {
			const synthetic: LoaderVersionInfo = { version: currentLV, stable: true };
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
		const effectiveIcon =
			icon() || getStableIconId(DEFAULT_ICONS[0]) || DEFAULT_ICONS[0];
		const data: Partial<Instance> = {
			name: name(),
			iconPath: effectiveIcon,
			modpackIconUrl:
				(effectiveIcon.startsWith("http") ? effectiveIcon : null) || null,
			minecraftVersion: mcVersion(),
			modloader: loader(),
			modloaderVersion: loaderVer() || null,
			minMemory: memory()[0],
			maxMemory: memory()[1],
			javaArgs: jvmArgs() || null,
			width: parseInt(resW()) || 854,
			height: parseInt(resH()) || 480,
			// Linking data
			modpackId: props.projectId || props.modpackInfo?.modpackId || null,
			modpackPlatform:
				props.platform || props.modpackInfo?.modpackPlatform || null,
			modpackVersionId:
				props.selectedModpackVersionId ||
				props.modpackInfo?.modpackVersionId ||
				null,
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
			<div class={styles["install-form__sections"]}>
				{/* LEFT COLUMN: Identity & Game Settings */}
				<div class={styles["install-form__main"]}>
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
								modpackIcon={
									normalizedIsModpack() || props.projectId
										? props.originalIcon
										: undefined
								}
								isSuggestedSelected={
									!!props.originalIcon && icon() === props.originalIcon
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

					{/* MODPACK AUTHOR INFO (Moved here) */}
					<Show when={normalizedIsModpack() && props.modpackInfo}>
						<div class={`${styles["form-section"]} ${styles["info-section"]}`}>
							<div class={styles["info-block-grid"]}>
								<div class={styles["info-block"]}>
									<span class={styles["info-label"]}>Author</span>
									<span class={styles["info-value"]}>
										{props.modpackInfo?.author ||
											props.initialAuthor ||
											"Unknown"}
										<Show
											when={props.modpackInfo?.modpackId || props.projectId}
										>
											<span class={styles["info-id"]}>
												{" "}
												({props.modpackInfo?.modpackId || props.projectId})
											</span>
										</Show>
									</span>
								</div>
								<div class={styles["info-block"]}>
									<span class={styles["info-label"]}>Pack Version</span>
									<span class={styles["info-value"]}>
										{props.modpackInfo?.version || "1.0.0"}
									</span>
								</div>
							</div>
							<Show when={props.modpackInfo?.description}>
								<div class={styles["info-description"]}>
									{props.modpackInfo?.description}
								</div>
							</Show>
						</div>
					</Show>

					<Show
						when={
							normalizedIsModpack() &&
							!props.isLocalImport &&
							(props.projectId ||
								(props.modpackVersions && props.modpackVersions.length > 0))
						}
					>
						<div
							class={`${styles["form-section"]} ${styles["modpack-context-section"]}`}
							classList={{ [styles["is-fetching"]]: props.isFetchingMetadata }}
						>
							<div class={styles["form-section-title"]}>
								Modpack Configuration
							</div>

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
									<div class={styles["field-label-manual"]}>
										Release Version
									</div>
									<Combobox<any>
										options={searchableModpackVersions()}
										value={props.selectedModpackVersionId}
										onChange={(id: any) => {
											if (id) props.onModpackVersionChange?.(id);
										}}
										optionValue={(v) => v.id}
										optionTextValue={(v) => v.searchString}
										placeholder="Select version..."
										itemComponent={(p) => (
											<ComboboxItem item={p.item}>
												<div class={styles["version-item-content"]}>
													<span class={styles["v-num"]}>
														{p.item.rawValue.version_number}
													</span>
													<span class={styles["v-meta"]}>
														{(p.item.rawValue.game_versions as string[]).join(
															", ",
														)}{" "}
														� {(p.item.rawValue.loaders as string[]).join(", ")}
													</span>
												</div>
											</ComboboxItem>
										)}
									>
										<ComboboxControl aria-label="Modpack Version Selection">
											<ComboboxInput
												as="input"
												value={(() => {
													const selected = props.modpackVersions?.find(
														(v) => v.id === props.selectedModpackVersionId,
													);
													if (!selected) {
														if (props.selectedModpackVersionId)
															return "Loading version...";
														return "";
													}
													const mcV = selected.game_versions?.[0];
													return mcV
														? `${selected.version_number} (MC ${mcV})`
														: selected.version_number;
												})()}
											/>
											<ComboboxTrigger />
										</ComboboxControl>
										<ComboboxContent />
									</Combobox>
								</div>
							</Show>

							<div class={styles["modpack-meta-grid"]}>
								<div class={styles["meta-item"]}>
									<span class={styles["label"]}>Minecraft</span>
									<span class={styles["value"]}>
										{mcVersion() || "Loading..."}
									</span>
								</div>
								<div class={styles["meta-item"]}>
									<span class={styles["label"]}>
										Modloader
										<HelpTrigger topic="MODLOADER_EXPLAINED" />
									</span>
									<span class={styles["value"]}>
										{MODLOADER_DISPLAY_NAMES[loader()] || loader()}{" "}
										{loaderVer()}
									</span>
								</div>
							</div>
						</div>
					</Show>

					{/* MANUAL GAME SETTINGS (Visible for non-modpacks OR specialized resources) */}
					<Show when={!normalizedIsModpack()}>
						<div class={styles["form-section"]}>
							<div class={styles["form-section-title"]}>Game Options</div>

							<div class={styles["standard-settings-grid"]}>
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
											itemComponent={(p) => (
												<ComboboxItem item={p.item}>
													{p.item.rawValue}
												</ComboboxItem>
											)}
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
											<SwitchLabel class={styles["form-switch__label"]}>
												Include Snapshots
											</SwitchLabel>
										</Switch>
									</div>
								</div>

								<div class={styles["form-row"]}>
									<div class={styles["flex-grow"]}>
										<div class={styles["field-label-manual"]}>
											Modloader
											<HelpTrigger topic="MODLOADER_EXPLAINED" />
										</div>
										<Combobox<string>
											options={availableLoaders()}
											value={loader()}
											onChange={(v) => {
												if (v) {
													setLoader(v);
													setDirty("loader", true);
												}
											}}
											itemComponent={(p) => (
												<ComboboxItem item={p.item}>
													{MODLOADER_DISPLAY_NAMES[p.item.rawValue] ||
														p.item.rawValue}
												</ComboboxItem>
											)}
										>
											<ComboboxControl aria-label="Loader Picker">
												<ComboboxInput />
												<ComboboxTrigger />
											</ComboboxControl>
											<ComboboxContent />
										</Combobox>
									</div>

									<Show when={loader() !== "vanilla"}>
										<div class={styles["flex-grow"]}>
											<div class={styles["field-label-manual"]}>
												Loader Version
											</div>
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
												itemComponent={(p) => (
													<ComboboxItem item={p.item}>
														{p.item.rawValue}
													</ComboboxItem>
												)}
											>
												<ComboboxControl aria-label="Loader Version Picker">
													<ComboboxInput />
													<ComboboxTrigger />
												</ComboboxControl>
												<ComboboxContent />
											</Combobox>
										</div>
									</Show>
								</div>
							</div>
						</div>
					</Show>
				</div>

				{/* RIGHT COLUMN: Info & Runtime */}
				<div class={styles["install-form__side"]}>
					<div class={styles["form-section"]}>
						<div class={styles["form-section-title"]}>Memory & Java</div>

						{/* RAM RANGE SLIDER */}
						<div class={styles["memory-setting"]}>
							<div class={styles["memory-header"]}>
								<div class={styles["memory-labels"]}>
									<span class={styles["main-label"]}>
										Allocation
										<HelpTrigger topic="MEMORY_ALLOCATION" />
									</span>
									<span class={styles["sub-label"]}>
										Min and Max memory in {memoryUnit()}
									</span>
								</div>
								<div
									class={styles["memory-range-display"]}
									onClick={toggleMemoryUnit}
								>
									{formatMemory(memory()[0])}
									{memoryUnit()} — {formatMemory(memory()[1])}
									{memoryUnit()}
								</div>
							</div>
							<Slider
								value={memory()}
								onChange={(val) => {
									setMemory(val);
									setDirty("memory", true);
								}}
								minValue={512}
								maxValue={totalRam()}
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
											[styles["is-low"]]:
												memory()[1] <
												(props.modpackInfo?.recommendedRamMb ?? 0),
										}}
									>
										Recommended:{" "}
										{formatMemory(props.modpackInfo?.recommendedRamMb ?? 0)}{" "}
										{memoryUnit()}
									</span>
								</Show>
							</div>
						</div>

						{/* JVM ARGS */}
						<TextFieldRoot>
							<TextFieldLabel>
								JVM Arguments
								<HelpTrigger topic="JVM_ARGS" />
							</TextFieldLabel>
							<TextFieldInput
								value={jvmArgs()}
								onInput={(e) => {
									setJvmArgs((e.currentTarget as HTMLInputElement).value);
									setDirty("jvmArgs", true);
								}}
								placeholder="-Xmx..."
							/>
						</TextFieldRoot>
					</div>

					<div class={styles["form-section"]}>
						<div class={styles["form-section-title"]}>Window & Display</div>
						{/* RESOLUTION */}
						<div class={styles["resolution-row"]}>
							<NumberField
								value={resW()}
								onRawValueChange={(val) => {
									if (!isNaN(val)) {
										setResW(val.toString());
										setDirty("res", true);
									}
								}}
								minValue={0}
							>
								<NumberFieldLabel>Width</NumberFieldLabel>
								<NumberFieldGroup>
									<NumberFieldInput />
									<NumberFieldIncrementTrigger />
									<NumberFieldDecrementTrigger />
								</NumberFieldGroup>
							</NumberField>
							<NumberField
								value={resH()}
								onRawValueChange={(val) => {
									if (!isNaN(val)) {
										setResH(val.toString());
										setDirty("res", true);
									}
								}}
								minValue={0}
							>
								<NumberFieldLabel>Height</NumberFieldLabel>
								<NumberFieldGroup>
									<NumberFieldInput />
									<NumberFieldIncrementTrigger />
									<NumberFieldDecrementTrigger />
								</NumberFieldGroup>
							</NumberField>
						</div>
					</div>
				</div>
			</div>

			{/* FOOTER ACTIONS - MOVED OUTSIDE SCROLL AREA */}
			<Separator />
			<div class={styles["install-form__actions-container"]}>
				<div class={styles["install-form__actions"]}>
					<Show when={props.onCancel}>
						<LauncherButton
							variant="ghost"
							onClick={props.onCancel}
							disabled={props.isInstalling}
						>
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
