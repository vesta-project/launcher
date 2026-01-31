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
import { IconPicker } from "@ui/icon-picker/icon-picker";
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
	Instance,
	LoaderVersionInfo,
	PistonMetadata,
} from "@utils/instances";
import { getSystemMemoryMb, ModpackInfo } from "@utils/modpacks";
import {
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	on,
	onMount,
	Show,
	Accessor,
} from "solid-js";
import { createStore } from "solid-js/store";

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
	const [name, setName] = createSignal(props.initialData?.name || props.initialName || "");
	const [icon, setIcon] = createSignal<string | null>(props.initialData?.iconPath || props.initialIcon || DEFAULT_ICONS[0]);
	const [mcVersion, setMcVersion] = createSignal(props.initialData?.minecraftVersion || props.initialVersion || "");
	const [loader, setLoader] = createSignal(props.initialData?.modloader || props.initialModloader || "vanilla");
	const [loaderVer, setLoaderVer] = createSignal(props.initialData?.modloaderVersion || props.initialModloaderVersion || "");
	const [memory, setMemory] = createSignal<number[]>([
		props.initialData?.minMemory || props.initialMinMemory || 2048,
		props.initialData?.maxMemory || props.initialMaxMemory || 4096,
	]);
	const [includeSnapshots, setIncludeSnapshots] = createSignal(props.initialIncludeSnapshots || false);

	// --- State Propagation ---
	createEffect(() => {
		props.onStateChange?.({
			name: name(),
			iconPath: icon() || DEFAULT_ICONS[0],
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

	// --- Performance State ---
	const [totalRam, setTotalRam] = createSignal(16384);
	const [jvmArgs, setJvmArgs] = createSignal(props.initialData?.javaArgs || props.initialJvmArgs || "");
	const [resW, setResW] = createSignal(String(props.initialData?.width || props.initialResW || "854"));
	const [resH, setResH] = createSignal(String(props.initialData?.height || props.initialResH || "480"));

	// --- Internal UI Toggles ---

	// --- Data Sources ---
	const [pistonMetadata] = createResource<PistonMetadata>(getMinecraftVersions);

	const searchableModpackVersions = createMemo(() => {
		return (props.modpackVersions ?? []).map((v) => ({
			...v,
			// We create a composite string for the combobox to use for filtering
			searchString: `${v.version_number} ${v.game_versions.join(" ")} ${v.loaders.join(" ")}`,
		}));
	});

	// --- State Normalization ---
	const normalizedIsModpack = createMemo(() => {
		return String(props.isModpack) === "true" || props.isModpack === true;
	});

	// Flag to track if the user has manually changed fields
	// These are persisted across window handoffs via props.initialData._dirty
	const [dirty, setDirty] = createStore<Record<string, boolean>>((props.initialData as any)?._dirty || {});
	
	const isNameDirty = () => !!dirty.name;
	const isIconDirty = () => !!dirty.icon;
	const isVersionDirty = () => !!dirty.version;
	const isLoaderDirty = () => !!dirty.loader;
	const isLoaderVerDirty = () => !!dirty.loaderVer;
	const isJvmArgsDirty = () => !!dirty.jvmArgs;
	const isResDirty = () => !!dirty.res;
	const isMemoryDirty = () => !!dirty.memory;

	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<string[]>([]);

	// Create uploadedIcons array that includes all custom icons seen this session
	const uploadedIcons = createMemo(() => {
		const result = [...customIconsThisSession()];
		const current = icon();
		if (
			current &&
			!DEFAULT_ICONS.includes(current) &&
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
		if (
			current &&
			!DEFAULT_ICONS.includes(current) &&
			current !== props.initialIcon
		) {
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
				if (d.minecraftVersion && !isVersionDirty()) setMcVersion(d.minecraftVersion);
				if (d.modloader && !isLoaderDirty()) setLoader(d.modloader.toLowerCase());
				if (d.modloaderVersion && !isLoaderVerDirty()) setLoaderVer(d.modloaderVersion);
				if (d.iconPath && !isIconDirty()) setIcon(d.iconPath);
				if (d.maxMemory && !isMemoryDirty()) setMemory([d.minMemory || 2048, d.maxMemory]);
				if (d.javaArgs !== undefined && !isJvmArgsDirty()) setJvmArgs(d.javaArgs);
				if (d.width && !isResDirty()) setResW(String(d.width));
				if (d.height && !isResDirty()) setResH(String(d.height));
			}

			if (props.initialName !== undefined && !isNameDirty() && !d?.name) setName(props.initialName);
			if (props.initialVersion && !isVersionDirty() && !d?.minecraftVersion) setMcVersion(props.initialVersion);
			if (props.initialModloader && !isLoaderDirty() && !d?.modloader)
				setLoader(props.initialModloader.toLowerCase());
			if (props.initialModloaderVersion && !isLoaderVerDirty() && !d?.modloaderVersion)
				setLoaderVer(props.initialModloaderVersion);
			if (props.initialIcon && !isIconDirty() && !d?.iconPath) setIcon(props.initialIcon);
			if (props.initialMaxMemory && !isMemoryDirty() && !d?.maxMemory) {
				setMemory([props.initialMinMemory || 2048, props.initialMaxMemory]);
			}
			if (props.initialIncludeSnapshots !== undefined) setIncludeSnapshots(props.initialIncludeSnapshots);
			if (props.initialJvmArgs !== undefined && !isJvmArgsDirty() && !d?.javaArgs) setJvmArgs(props.initialJvmArgs);
			if (props.initialResW && !isResDirty() && !d?.width) setResW(props.initialResW);
			if (props.initialResH && !isResDirty() && !d?.height) setResH(props.initialResH);
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
				if (info.recommendedRamMb && !isMemoryDirty()) setMemory([2048, info.recommendedRamMb]);
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
				const latestStable = versions.find((v) => v.stable);
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
		if (current && !versions.some(v => v.id === current)) {
			versions = [{ id: current, stable: true }, ...versions];
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
		
		if (!meta || !currentV || currentL === "vanilla") return currentLV ? [{ version: currentLV }] : [];

		const vData = meta.game_versions.find((v) => v.id === currentV);
		const list = vData?.loaders[currentL] || [];

		if (currentLV && !list.some(v => v.version === currentLV)) {
			return [{ version: currentLV }, ...list];
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
		const effectiveIcon = icon() || DEFAULT_ICONS[0];
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
			width: parseInt(resW()) || 854,
			height: parseInt(resH()) || 480,
			// Linking data
			modpackId: props.projectId || props.modpackInfo?.modpackId || null,
			modpackPlatform: props.platform || props.modpackInfo?.modpackPlatform || null,
			modpackVersionId: props.selectedModpackVersionId || props.modpackInfo?.modpackVersionId || null,
		};
		props.onInstall(data);
	};

	return (
		<div
			class="install-form"
			classList={{
				"install-form--compact": props.compact,
				"install-form--installing": props.isInstalling,
				"install-form--fetching": props.isFetchingMetadata,
			}}
		>
			<div class="install-form__sections">
				{/* LEFT COLUMN: Identity & Game Settings */}
				<div class="install-form__main">
					{/* IDENTITY SECTION */}
					<div class="form-section">
						<div class="form-section-title">Instance Identity</div>
						<div class="identity-row">
							<IconPicker
								value={icon()}
								onSelect={(newIcon) => {
									setIcon(newIcon);
									setDirty("icon", true);
								}}
								suggestedIcon={
									normalizedIsModpack() || props.projectId
										? props.originalIcon
										: undefined
								}
								isSuggestedSelected={
									!!props.originalIcon && icon() === props.originalIcon
								}
								uploadedIcons={uploadedIcons()}
								showHint={!isIconDirty() && !props.originalIcon && !icon()}
								triggerProps={{
									class: "form-icon-trigger",
								}}
							/>
							<div class="name-field">
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
						<div class="form-section info-section">
							<div class="info-block-grid">
								<div class="info-block">
									<span class="info-label">Author</span>
									<span class="info-value">
										{props.modpackInfo?.author || props.initialAuthor || "Unknown"}
										<Show when={props.modpackInfo?.modpackId || props.projectId}>
											<span class="info-id"> ({props.modpackInfo?.modpackId || props.projectId})</span>
										</Show>
									</span>
								</div>
								<div class="info-block">
									<span class="info-label">Pack Version</span>
									<span class="info-value">{props.modpackInfo?.version || "1.0.0"}</span>
								</div>
							</div>
							<Show when={props.modpackInfo?.description}>
								<div class="info-description">{props.modpackInfo?.description}</div>
							</Show>
						</div>
					</Show>

					<Show when={normalizedIsModpack() && !props.isLocalImport && (props.projectId || (props.modpackVersions && props.modpackVersions.length > 0))}>
						<div
							class="form-section modpack-context-section"
							classList={{ "is-fetching": props.isFetchingMetadata }}
						>
							<div class="form-section-title">Modpack Configuration</div>

							<Show
								when={
									props.modpackVersions && props.modpackVersions.length > 0
								}
								fallback={
									<div class="modpack-version-placeholder">
										{props.isFetchingMetadata
											? "Fetching available versions..."
											: "No other versions available for this platform."}
									</div>
								}
							>
								<div class="modpack-version-picker">
									<div class="field-label-manual">Release Version</div>
									<Combobox
										options={searchableModpackVersions()}
										value={props.selectedModpackVersionId}
										onChange={(id: any) => {
											if (id) props.onModpackVersionChange?.(id);
										}}
										optionValue="id"
										optionTextValue="searchString"
										placeholder="Select version..."
										itemComponent={(p) => (
											<ComboboxItem item={p.item}>
												<div class="version-item-content">
													<span class="v-num">
														{p.item.rawValue.version_number}
													</span>
													<span class="v-meta">
														{p.item.rawValue.game_versions.join(", ")} •{" "}
														{p.item.rawValue.loaders.join(", ")}
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
														if (props.selectedModpackVersionId) return "Loading version...";
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

							<div class="modpack-meta-grid">
								<div class="meta-item">
									<span class="label">Minecraft</span>
									<span class="value">{mcVersion() || "Loading..."}</span>
								</div>
								<div class="meta-item">
									<span class="label">Modloader</span>
									<span class="value">
										{MODLOADER_DISPLAY_NAMES[loader()] || loader()}{" "}
										{loaderVer()}
									</span>
								</div>
							</div>
						</div>
					</Show>

					{/* MANUAL GAME SETTINGS (Visible for non-modpacks OR specialized resources) */}
					<Show when={!normalizedIsModpack()}>
						<div class="form-section">
							<div class="form-section-title">Game Options</div>

							<div class="standard-settings-grid">
								<div class="form-row">
									<div class="flex-grow">
										<div class="field-label-manual">Minecraft Version</div>
										<Combobox
											options={availableMcVersions().map((v) => v.id)}
											value={mcVersion()}
											onChange={(v) => {
												setMcVersion(v || "");
											setDirty("version", true);
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
									<div class="stable-switch-container">
										<Switch
											checked={includeSnapshots()}
											onChange={setIncludeSnapshots}
											class="form-switch"
										>
											<SwitchControl class="form-switch__control">
												<SwitchThumb class="form-switch__thumb" />
											</SwitchControl>
											<SwitchLabel class="form-switch__label">
												Include Snapshots
											</SwitchLabel>
										</Switch>
									</div>
								</div>

								<div class="form-row">
									<div class="flex-grow">
										<div class="field-label-manual">Modloader</div>
										<Combobox
											options={availableLoaders()}
											value={loader()}
											onChange={(v) => {
												setLoader(v || "vanilla");
											setDirty("loader", true);
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
										<div class="flex-grow">
											<div class="field-label-manual">Loader Version</div>
											<Combobox
												options={availableLoaderVers().map((v) => v.version)}
												value={loaderVer()}
												onChange={(v) => {
													setLoaderVer(v || "");
													setDirty("loaderVer", true);
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
				<div class="install-form__side">
					<div class="form-section">
						<div class="form-section-title">Memory & Java</div>

						{/* RAM RANGE SLIDER */}
						<div class="memory-setting">
							<div class="memory-header">
								<div class="memory-labels">
									<span class="main-label">Allocation</span>
									<span class="sub-label">Min and Max memory in MB</span>
								</div>
								<div class="memory-range-display">
									{memory()[0]}MB — {memory()[1]}MB
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
							<div class="memory-footer">
								<Show when={props.modpackInfo?.recommendedRamMb}>
									<span
										class="rec-hint"
										classList={{
											"is-low": memory()[1] < (props.modpackInfo?.recommendedRamMb ?? 0),
										}}
									>
										Recommended: {props.modpackInfo?.recommendedRamMb} MB
									</span>
								</Show>
							</div>
						</div>

						{/* JVM ARGS */}
						<TextFieldRoot>
							<TextFieldLabel>JVM Arguments</TextFieldLabel>
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

					<div class="form-section">
						<div class="form-section-title">Window & Display</div>
						{/* RESOLUTION */}
						<div class="resolution-row">
							<TextFieldRoot>
								<TextFieldLabel>Width</TextFieldLabel>
								<TextFieldInput
									value={resW()}
									onInput={(e) => {
										setResW((e.currentTarget as HTMLInputElement).value);
										setDirty("res", true);
									}}
								/>
							</TextFieldRoot>
							<TextFieldRoot>
								<TextFieldLabel>Height</TextFieldLabel>
								<TextFieldInput
									value={resH()}
									onInput={(e) => {
										setResH((e.currentTarget as HTMLInputElement).value);
										setDirty("res", true);
									}}
								/>
							</TextFieldRoot>
						</div>
					</div>
				</div>
			</div>

			{/* FOOTER ACTIONS - MOVED OUTSIDE SCROLL AREA */}
			<div class="install-form__actions-container">
				<div class="install-form__actions">
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
						class="install-submit-btn"
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
