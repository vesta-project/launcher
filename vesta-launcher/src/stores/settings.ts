import { dialogStore } from "@stores/dialog-store";
import {
	cacheSize as cacheSizeResource,
	detectedJava,
	globalJavaPaths,
	javaRequirements,
	managedJava,
	systemMemory,
} from "@stores/settings-cache";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	disable as disableAutostart,
	enable as enableAutostart,
} from "@tauri-apps/plugin-autostart";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getActiveAccount } from "@utils/auth";
import {
	currentThemeConfig,
	onConfigUpdate,
	saveThemeUpdate as persistThemeUpdate,
	setUiChromeModeEnabled,
	uiChromeModeEnabled,
} from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import {
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
	applyTheme,
	type GradientHarmony,
	getAllThemes,
	getSupportedWindowEffects,
	getThemeById,
	isBuiltinThemeId,
	loadWindowEffectCapabilities,
	normalizeStyleMode,
	normalizeWindowEffectForCurrentOS,
	PRESET_THEMES,
	parseThemeData,
	removeCustomTheme,
	type StyleMode,
	setCustomThemes,
	type ThemeConfig,
	type ThemeVariableValue,
	type UiChromeMode,
	upsertCustomTheme,
	validateTheme,
} from "../themes/presets";

export interface AppConfig {
	id: number;
	background_hue: number;
	theme: string;
	language: string;
	max_download_threads: number;
	java_path: string | null;
	default_game_dir: string | null;
	auto_update_enabled: boolean;
	notification_enabled: boolean;
	startup_check_updates: boolean;
	autostart_enabled: boolean;
	show_tray_icon: boolean;
	minimize_to_tray: boolean;
	reduced_motion: boolean;
	last_window_width: number;
	last_window_height: number;
	debug_logging: boolean;
	notification_retention_days?: number;
	active_account_uuid: string | null;

	theme_id: string;
	theme_mode: string;
	theme_primary_hue: number;
	theme_primary_sat?: number;
	theme_primary_light?: number;
	theme_style: StyleMode;
	theme_gradient_enabled: boolean;
	theme_gradient_angle?: number;
	theme_gradient_type?: "linear" | "radial";
	theme_gradient_harmony?: GradientHarmony;
	theme_window_effect?: string;
	theme_background_opacity?: number;
	theme_data?: string;
	theme_border_width?: number;
	setup_completed: boolean;
	setup_step: number;
	tutorial_completed: boolean;
	use_dedicated_gpu: boolean;
	telemetry_enabled: boolean;
	discord_presence_enabled: boolean;
	auto_install_dependencies: boolean;
	proxy_enabled: boolean;
	proxy_url: string | null;
	proxy_apply_to_games: boolean;

	default_width: number;
	default_height: number;
	default_java_args: string | null;
	default_environment_variables: string | null;
	default_pre_launch_hook: string | null;
	default_wrapper_command: string | null;
	default_post_exit_hook: string | null;
	default_min_memory: number;
	default_max_memory: number;
	default_launcher_action_on_launch: "stay-open" | "minimize" | "hide-to-tray" | "quit";

	[key: string]: any;
}

interface SavedThemeEntry {
	id: string;
	name: string;
	themeData: Record<string, any>;
	createdAt: string;
	updatedAt: string;
}

interface ThemeImportResponse {
	theme: SavedThemeEntry;
	warnings: string[];
}

type ThemeFilterMode = "all" | "builtin" | "imported";
type ThemeViewMode = "grid" | "list";

function createDebounce<T extends (...args: any[]) => any>(
	fn: T,
	delay: number,
): { (...args: Parameters<T>): void; cancel: () => void } {
	let timer: any;
	const debounced = (...args: Parameters<T>) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
	debounced.cancel = () => clearTimeout(timer);
	return debounced;
}

const initialThemeData = parseThemeData(currentThemeConfig.theme_data);
const initialTheme = getThemeById(currentThemeConfig.theme_id || "vesta");

export const [loading, setLoading] = createSignal(true);
export const [version] = createResource(getVersion);
export const [debugLogging, setDebugLogging] = createSignal(false);
export const [autoUpdateEnabled, setAutoUpdateEnabled] = createSignal(true);
export const [startupCheckUpdates, setStartupCheckUpdates] = createSignal(true);
export const [useDedicatedGpu, setUseDedicatedGpu] = createSignal(false);
export const [telemetryEnabled, setTelemetryEnabled] = createSignal(true);
export const [discordPresenceEnabled, setDiscordPresenceEnabled] = createSignal(true);
export const [autoInstallDependencies, setAutoInstallDependencies] = createSignal(true);
export const [proxyEnabled, setProxyEnabled] = createSignal(false);
export const [proxyUrl, setProxyUrl] = createSignal("");
export const [proxyApplyToGames, setProxyApplyToGames] = createSignal(false);
export const [proxyRestartRequired, setProxyRestartRequired] = createSignal(false);
export const [maxDownloadThreads, setMaxDownloadThreads] = createSignal(4);
export const [autostartEnabled, setAutostartEnabled] = createSignal(false);
export const [showTrayIcon, setShowTrayIcon] = createSignal(true);
export const [closeToTray, setCloseToTray] = createSignal(false);
export const [reducedMotion, setReducedMotion] = createSignal(false);
export const [instanceDefaults, setInstanceDefaults] = createSignal<Partial<AppConfig>>({});

export const [backgroundHue, setBackgroundHue] = createSignal(
	currentThemeConfig.theme_primary_hue ?? currentThemeConfig.background_hue ?? 180,
);
export const [opacity, setOpacity] = createSignal<number>(
	getThemeById(currentThemeConfig.theme_id || "vesta")?.opacity ?? 0,
);
export const [styleMode, setStyleMode] = createSignal<StyleMode>(
	initialThemeData.style ?? currentThemeConfig.theme_style ?? initialTheme?.style ?? "glass",
);
export const [grainStrength, setGrainStrength] = createSignal<number>(
	initialThemeData.grainStrength ?? initialTheme?.grainStrength ?? 40,
);
export const [gradientEnabled, setGradientEnabled] = createSignal<boolean>(
	currentThemeConfig.theme_gradient_enabled ?? true,
);
export const [rotation, setRotation] = createSignal<number>(
	currentThemeConfig.theme_gradient_angle ?? 135,
);
export const [gradientType, setGradientType] = createSignal<"linear" | "radial">(
	(currentThemeConfig.theme_gradient_type as "linear" | "radial") ?? "linear",
);
export const [gradientHarmony, setGradientHarmony] = createSignal<GradientHarmony>(
	(currentThemeConfig.theme_gradient_harmony as GradientHarmony) ?? "none",
);
export const [themeId, setThemeId] = createSignal<string>(currentThemeConfig.theme_id ?? "vesta");
export const [themeCatalog, setThemeCatalog] = createSignal<ThemeConfig[]>(getAllThemes());
export const [themeSearchQuery, setThemeSearchQuery] = createSignal("");
export const [themeFilterMode, setThemeFilterMode] = createSignal<ThemeFilterMode>("all");
export const [themeViewMode, setThemeViewMode] = createSignal<ThemeViewMode>("grid");
export const [borderThickness, setBorderThickness] = createSignal(
	currentThemeConfig.theme_border_width ?? 1,
);
export const [backgroundOpacity, setBackgroundOpacity] = createSignal(
	currentThemeConfig.theme_background_opacity ?? 12,
);
export const uiChromeMode = createMemo<UiChromeMode>(() =>
	uiChromeModeEnabled() ? "windowed" : "flat",
);
export const [windowEffect, setWindowEffect] = createSignal(
	normalizeWindowEffectForCurrentOS(currentThemeConfig.theme_window_effect || "none"),
);
export const [windowEffectOptions, setWindowEffectOptions] = createSignal<string[]>(
	getSupportedWindowEffects(),
);
export const [userVariables, setUserVariables] = createStore<
	Record<string, ThemeVariableValue>
>(untrack(() => initialThemeData.userVariables || {}));
export const userVariablesSnapshot = createMemo<Record<string, ThemeVariableValue>>(() => {
	const snapshot: Record<string, ThemeVariableValue> = {};
	for (const key of Object.keys(userVariables)) {
		const value = userVariables[key];
		if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
			snapshot[key] = value;
		}
	}
	return snapshot;
});

const [requirements] = javaRequirements;
const [detected, { refetch: refetchDetected }] = detectedJava;
const [managed, { refetch: refetchManaged }] = managedJava;
const [globalPaths, { refetch: refetchGlobalPaths }] = globalJavaPaths;
const [cacheSizeValue, { refetch: refetchSize }] = cacheSizeResource;
export { cacheSizeValue };

export const [isScanning, setIsScanning] = createSignal(false);

export function canChangeHue() {
	const id = themeId();
	return id ? (getThemeById(id)?.allowHueChange ?? false) : false;
}

export function canChangeStyle() {
	const id = themeId();
	return id ? (getThemeById(id)?.allowStyleChange ?? false) : false;
}

export function canChangeBorder() {
	const id = themeId();
	return id ? (getThemeById(id)?.allowBorderChange ?? false) : false;
}

export function showAdvancedControls() {
	const theme = getThemeById(themeId());
	if (!theme) return false;
	return Boolean(
		theme.id === "custom" ||
			theme.allowStyleChange ||
			theme.allowBorderChange ||
			theme.variables?.length,
	);
}

export function getThemeSource(theme: ThemeConfig): "builtin" | "imported" {
	return theme.source ?? (isBuiltinThemeId(theme.id) ? "builtin" : "imported");
}

export const hasImportedThemes = createMemo(() =>
	themeCatalog().some((theme) => getThemeSource(theme) === "imported"),
);

export const filteredThemeCatalog = createMemo(() => {
	const query = themeSearchQuery().trim().toLowerCase();
	const filter = themeFilterMode();
	const presetOrder = new Map<string, number>();
	PRESET_THEMES.forEach((theme, index) => {
		presetOrder.set(theme.id, index);
	});
	const pinnedBuiltins = new Map<string, number>([
		["vesta", -2],
		["custom", -1],
	]);

	return themeCatalog()
		.map((theme, index) => ({ theme, index }))
		.filter(({ theme }) => {
			const source = getThemeSource(theme);
			if (filter === "builtin" && source !== "builtin") return false;
			if (filter === "imported" && source !== "imported") return false;

			if (!query) return true;
			const haystack = [theme.name, theme.author, theme.description]
				.filter((value): value is string => Boolean(value))
				.join(" ")
				.toLowerCase();
			return haystack.includes(query);
		})
		.sort((a, b) => {
			const sourceA = getThemeSource(a.theme);
			const sourceB = getThemeSource(b.theme);
			if (sourceA !== sourceB) {
				return sourceA === "builtin" ? -1 : 1;
			}

			if (sourceA === "builtin") {
				const pinnedA = pinnedBuiltins.get(a.theme.id);
				const pinnedB = pinnedBuiltins.get(b.theme.id);

				if (pinnedA !== undefined || pinnedB !== undefined) {
					if (pinnedA === undefined) return 1;
					if (pinnedB === undefined) return -1;
					if (pinnedA !== pinnedB) return pinnedA - pinnedB;
				}

				const presetA = presetOrder.get(a.theme.id) ?? Number.MAX_SAFE_INTEGER;
				const presetB = presetOrder.get(b.theme.id) ?? Number.MAX_SAFE_INTEGER;
				if (presetA !== presetB) {
					return presetA - presetB;
				}
			}

			return a.index - b.index;
		})
		.map(({ theme }) => theme);
});

export const activeThemeDefinition = createMemo<ThemeConfig | undefined>(() => {
	const id = themeId();
	const currentTheme = id ? getThemeById(id) : undefined;
	if (!currentTheme) return undefined;

	const themeData = parseThemeData(currentThemeConfig.theme_data);

	return validateTheme({
		...currentTheme,
		id: themeData.id ?? id,
		name: themeData.name ?? currentTheme.name,
		author: themeData.author ?? currentTheme.author,
		description: themeData.description ?? currentTheme.description,
		primaryHue: (backgroundHue() ?? currentTheme.primaryHue) as number,
		opacity: opacity() ?? currentTheme.opacity ?? 0,
		style: styleMode() ?? currentTheme.style,
		grainStrength: grainStrength() ?? currentTheme.grainStrength,
		gradientEnabled: (gradientEnabled() ?? currentTheme.gradientEnabled) as boolean,
		rotation: (rotation() ?? currentTheme.rotation) as number,
		gradientType: (gradientType() ?? currentTheme.gradientType) as "linear" | "radial",
		gradientHarmony: (gradientHarmony() ?? currentTheme.gradientHarmony) as GradientHarmony,
		borderWidth: borderThickness(),
		backgroundOpacity: backgroundOpacity(),
		windowEffect: windowEffect(),
		customCss: themeData.customCss ?? currentTheme.customCss,
		allowHueChange: themeData.allowHueChange ?? currentTheme.allowHueChange,
		allowStyleChange: themeData.allowStyleChange ?? currentTheme.allowStyleChange,
		allowBorderChange: themeData.allowBorderChange ?? currentTheme.allowBorderChange,
		variables: themeData.variables ?? currentTheme.variables,
	});
});

export const activeThemeConfig = createMemo<ThemeConfig | undefined>(() => {
	const definition = activeThemeDefinition();
	if (!definition) return undefined;

	return validateTheme({
		...definition,
		userVariables: userVariablesSnapshot(),
	});
});

createEffect(() => {
	if (!hasImportedThemes() && themeFilterMode() === "imported") {
		setThemeFilterMode("all");
	}
});

createEffect(() => {
	if (loading()) return;

	const themeToApply = activeThemeConfig();
	if (themeToApply) applyTheme(themeToApply);
});

export const javaOptions = createMemo(() => {
	const options: any[] = [];
	const reqs = requirements() || [];
	const detectedJavas = detected() || [];
	const managedJavas = managed() || [];
	const globalPathsData = globalPaths() || [];

	reqs.forEach((req: any) => {
		const allForVersion = globalPathsData.filter(
			(p: any) => p.major_version === req.major_version,
		);
		const current = allForVersion.find((p: any) => p.is_active) ?? allForVersion[0];
		const managedRow = allForVersion.find((p: any) => p.is_managed && p.is_active);
		const managedVersion = managedJavas.find(
			(m: any) => m.major_version === req.major_version,
		);
		const managedPath = managedVersion?.path || managedRow?.path;

		options.push({
			type: "managed",
			version: req.major_version,
			title: "Managed Runtime",
			path: managedPath,
			isActive: managedRow?.is_active ?? false,
			onClick: () => {
				if (managedPath) {
					handleSetGlobalPath(req.major_version, managedPath, true);
				}
			},
			onDownload: () => handleDownloadManaged(req.major_version),
		});

		detectedJavas
			.filter((d: any) => d.major_version === req.major_version)
			.forEach((det: any) => {
				options.push({
					type: "system",
					version: req.major_version,
					title: "System Runtime",
					path: det.path,
					isActive:
						current?.path === det.path && current?.is_active && !current?.is_managed,
					onClick: () => handleSetGlobalPath(req.major_version, det.path, false),
				});
			});

		for (const p of allForVersion) {
			if (p.is_managed) continue;
			if (
				detectedJavas.some(
					(d: any) => d.path === p.path && d.major_version === req.major_version,
				)
			)
				continue;
			options.push({
				type: "custom",
				version: req.major_version,
				title: "Custom Path",
				path: p.path,
				isActive: p.is_active ?? false,
				onClick: () => handleSetGlobalPath(req.major_version, p.path, false),
			});
		}

		options.push({
			type: "browse",
			version: req.major_version,
			title: "+ Browse...",
			isActive: false,
			onClick: () => handleManualPickSetGlobal(req.major_version),
		});
	});

	return options;
});

const debouncedPersistence = createDebounce(
	async (overrides: any) => {
		await persistThemeUpdate(overrides);
	},
	100,
);

export function cancelDebouncedPersistence() {
	debouncedPersistence.cancel();
}

export async function refreshJavas() {
	if (!hasTauriRuntime()) return;
	try {
		setIsScanning(true);
		await Promise.all([refetchDetected(), refetchManaged(), refetchGlobalPaths()]);
	} catch (e) {
		console.error("Failed to refresh javas:", e);
	} finally {
		setIsScanning(false);
	}
}

export async function handleSetGlobalPath(version: number, path: string, isManaged: boolean) {
	try {
		await invoke("set_global_java_path", {
			version,
			pathStr: path,
			managed: isManaged,
		});
		refetchGlobalPaths();
	} catch (e) {
		console.error("Failed to set global java path:", e);
	}
}

export async function handleDownloadManaged(version: number) {
	// This triggers a toast but toast import may cause cycles. We import inline.
	const { showToast } = await import("@ui/toast/toast");
	try {
		await invoke("download_managed_java", { version });
		showToast({
			title: "Download Started",
			description: `Java ${version} is being downloaded in the background.`,
			severity: "info",
		});
	} catch (e) {
		console.error("Failed to download managed java:", e);
		showToast({
			title: "Download Failed",
			description: "Failed to initiate Java download.",
			severity: "error",
		});
	}
}

export async function handleManualPickSetGlobal(version: number) {
	try {
		const path = await invoke<string | null>("select_java_file");
		if (path) {
			const info = await invoke<any>("verify_java_path", { pathStr: path });
			if (info.major_version !== version) {
				await dialogStore.alert(
					"Invalid Java Version",
					`Selected Java is version ${info.major_version}, but ${version} is required.`,
					"error",
				);
			} else {
				await handleSetGlobalPath(version, path, false);
			}
		}
	} catch (e) {
		console.error("Failed to pick java path:", e);
	}
}

export async function refreshThemeCatalog() {
	if (!hasTauriRuntime()) {
		setThemeCatalog(getAllThemes());
		return;
	}

	try {
		const saved = await invoke<SavedThemeEntry[]>("list_saved_themes");
		const customThemes = saved.map((entry) => {
			const runtimeId = isBuiltinThemeId(entry.id) ? `imported-${entry.id}` : entry.id;

			return validateTheme({
				...entry.themeData,
				id: runtimeId,
				libraryId: entry.id,
				name: entry.name,
				source: "imported",
			});
		});
		setCustomThemes(customThemes);
		setThemeCatalog(getAllThemes());
	} catch (error) {
		console.error("Failed to load saved themes:", error);
		setThemeCatalog(getAllThemes());
	}
}

export function saveThemeUpdate(overrides: Partial<ThemeConfig> = {}, live = false) {
	if (!hasTauriRuntime()) return;
	const currentAppliedThemeId =
		document.documentElement.getAttribute("data-theme-id") ||
		currentThemeConfig.theme_id ||
		themeId();
	const hasThemeIdOverride = typeof overrides.id === "string" && overrides.id.length > 0;
	const applyTransition =
		hasThemeIdOverride && overrides.id !== currentAppliedThemeId ? "preset-switch" : "none";

	const activeHue = overrides.primaryHue ?? backgroundHue();
	const activeOpacity = overrides.opacity ?? opacity();
	const activeThemeId = overrides.id ?? themeId();
	const currentTheme = getThemeById(activeThemeId);
	const activeStyle = overrides.style ?? styleMode() ?? currentTheme?.style ?? "glass";
	const activeGrainStrength = overrides.grainStrength ?? grainStrength();
	const activeGradient = overrides.gradientEnabled ?? gradientEnabled();
	const activeRotation = overrides.rotation ?? rotation();
	const activeGType = overrides.gradientType ?? gradientType();
	const activeGHarmony = overrides.gradientHarmony ?? gradientHarmony();
	const activeBWidth = overrides.borderWidth ?? borderThickness();
	const activeBgOp = overrides.backgroundOpacity ?? backgroundOpacity();
	const activeWEffect = normalizeWindowEffectForCurrentOS(
		overrides.windowEffect ?? windowEffect(),
	);
	const currentThemeData = parseThemeData(currentThemeConfig.theme_data);
	const shouldCarryCurrentThemeData = (currentThemeData.id ?? activeThemeId) === activeThemeId;
	const carriedThemeData = shouldCarryCurrentThemeData ? currentThemeData : {};
	const activeVariables = overrides.variables ?? carriedThemeData.variables ?? currentTheme?.variables;
	const activeCustomCss = overrides.customCss ?? carriedThemeData.customCss ?? currentTheme?.customCss;
	const activeUserVars = overrides.userVariables ?? userVariablesSnapshot();

	const persistenceData = {
		themeId: activeThemeId,
		themeName: overrides.name ?? currentTheme?.name,
		author: overrides.author ?? currentTheme?.author,
		description: overrides.description ?? currentTheme?.description,
		primaryHue: activeHue,
		opacity: activeOpacity,
		grainStrength: activeGrainStrength,
		style: activeStyle,
		gradientEnabled: activeGradient,
		rotation: activeRotation,
		gradientType: activeGType,
		gradientHarmony: activeGHarmony,
		borderWidth: activeBWidth,
		backgroundOpacity: activeBgOp,
		windowEffect: activeWEffect,
		customCss: activeCustomCss,
		allowHueChange: overrides.allowHueChange ?? currentTheme?.allowHueChange,
		allowStyleChange: overrides.allowStyleChange ?? currentTheme?.allowStyleChange,
		allowBorderChange: overrides.allowBorderChange ?? currentTheme?.allowBorderChange,
		variables: activeVariables,
		userVariables: activeUserVars,
	};

	applyTheme(
		validateTheme({
			...currentTheme,
			id: activeThemeId,
			primaryHue: activeHue,
			opacity: activeOpacity,
			grainStrength: activeGrainStrength,
			style: activeStyle,
			gradientEnabled: activeGradient,
			rotation: activeRotation,
			gradientType: activeGType as any,
			gradientHarmony: activeGHarmony as any,
			borderWidth: activeBWidth,
			backgroundOpacity: activeBgOp,
			windowEffect: activeWEffect,
			customCss: activeCustomCss,
			allowHueChange: overrides.allowHueChange ?? currentTheme?.allowHueChange,
			allowStyleChange: overrides.allowStyleChange ?? currentTheme?.allowStyleChange,
			allowBorderChange: overrides.allowBorderChange ?? currentTheme?.allowBorderChange,
			variables: activeVariables,
			userVariables: activeUserVars,
		}),
		{ transition: applyTransition },
	);

	if (!live) {
		debouncedPersistence(persistenceData);
	}
}

export function handlePresetSelect(id: string) {
	const theme = getThemeById(id);
	if (theme) {
		const normalizedEffect =
			theme.windowEffect !== undefined
				? normalizeWindowEffectForCurrentOS(theme.windowEffect)
				: windowEffect();
		const finalHue = theme.allowHueChange === false ? (theme.primaryHue ?? 180) : backgroundHue();

		batch(() => {
			setThemeId(id);
			setOpacity(theme.opacity ?? 0);
			setStyleMode(theme.style ?? "glass");
			setGrainStrength(theme.grainStrength ?? 40);
			setGradientEnabled(theme.gradientEnabled);
			setRotation(theme.rotation || 135);
			setGradientType(theme.gradientType || "linear");
			setGradientHarmony(theme.gradientHarmony || "none");
			if (theme.borderWidth !== undefined) {
				setBorderThickness(theme.borderWidth);
			}
			if (theme.backgroundOpacity !== undefined) {
				setBackgroundOpacity(theme.backgroundOpacity);
			}
			if (normalizedEffect !== undefined) {
				setWindowEffect(normalizedEffect);
			}
			setBackgroundHue(finalHue);

			if (theme.variables && theme.variables.length > 0) {
				const defaultVars: Record<string, ThemeVariableValue> = {};
				theme.variables.forEach((v) => {
					defaultVars[v.key] = v.default;
				});
				setUserVariables(reconcile(defaultVars));
			} else {
				setUserVariables(reconcile({}));
			}
		});

		saveThemeUpdate({
			id: theme.id,
			author: theme.author,
			source: theme.source,
			primaryHue: finalHue,
			opacity: theme.opacity,
			grainStrength: theme.grainStrength,
			style: theme.style,
			gradientEnabled: theme.gradientEnabled,
			rotation: theme.rotation,
			gradientType: theme.gradientType,
			gradientHarmony: theme.gradientHarmony,
			borderWidth: theme.borderWidth,
			backgroundOpacity: theme.backgroundOpacity,
			windowEffect: normalizedEffect,
			customCss: theme.customCss,
			allowHueChange: theme.allowHueChange,
			allowStyleChange: theme.allowStyleChange,
			allowBorderChange: theme.allowBorderChange,
			variables: theme.variables,
			userVariables:
				theme.variables?.reduce<Record<string, ThemeVariableValue>>((acc, variable) => {
					acc[variable.key] = variable.default;
					return acc;
				}, {}) || {},
		});
	}
}

export function handleHueChange(values: number[], live = false) {
	const newHue = values[0];
	setBackgroundHue(newHue);
	saveThemeUpdate({ primaryHue: newHue }, live);
}

export function handleStyleModeChange(mode: StyleMode) {
	if (mode === styleMode()) return;
	setStyleMode(mode);
	saveThemeUpdate({ style: mode });
}

export function handleGrainStrengthChange(values: number[], live = false) {
	const next = Math.max(0, Math.min(100, Math.round(values[0])));
	if (next === grainStrength()) return;
	setGrainStrength(next);
	saveThemeUpdate({ grainStrength: next }, live);
}

export function handleOpacityChange(val: number[], live = false) {
	const newOpacity = val[0];
	setOpacity(newOpacity);
	saveThemeUpdate({ opacity: newOpacity }, live);
}

export function handleGradientToggle(enabled: boolean) {
	setGradientEnabled(enabled);
	saveThemeUpdate({ gradientEnabled: enabled });
}

export function handleRotationChange(values: number[], live = false) {
	const newRotation = Math.round(values[0]);
	if (newRotation === rotation()) return;
	setRotation(newRotation);
	saveThemeUpdate({ rotation: newRotation }, live);
}

export function handleBorderThicknessChange(values: number[], live = false) {
	const newThickness = Math.max(0, Math.min(6, Math.round(values[0] * 2) / 2));
	if (newThickness === borderThickness()) return;
	setBorderThickness(newThickness);
	saveThemeUpdate({ borderWidth: newThickness }, live);
}

export function handleBackgroundOpacityChange(values: number[], live = false) {
	const newValue = values[0];
	if (newValue === backgroundOpacity()) return;
	setBackgroundOpacity(newValue);
	saveThemeUpdate({ backgroundOpacity: newValue }, live);
}

export async function handleUiChromeModeChange(mode: UiChromeMode) {
	const enabled = mode === "windowed";
	setUiChromeModeEnabled(enabled);

	if (!hasTauriRuntime()) return;

	try {
		await invoke("update_config_fields", {
			updates: {
				ui_chrome_mode_enabled: enabled,
			},
		});
	} catch (error) {
		console.error("Failed to persist UI chrome mode:", error);
	}
}

export function handleWindowEffectChange(val: string) {
	const normalizedEffect = normalizeWindowEffectForCurrentOS(val);
	if (normalizedEffect === windowEffect()) return;

	setWindowEffect(normalizedEffect);
	saveThemeUpdate({ windowEffect: normalizedEffect });
}

export function handleGradientTypeChange(type: "linear" | "radial") {
	if (type === gradientType()) return;
	setGradientType(type);
	saveThemeUpdate({ gradientType: type });
}

export function handleGradientHarmonyChange(harmony: GradientHarmony) {
	setGradientHarmony(harmony);
	saveThemeUpdate({ gradientHarmony: harmony });
}

export function handleVariableChange(key: string, value: ThemeVariableValue, live = false) {
	const nextVariables = {
		...untrack(userVariablesSnapshot),
		[key]: value,
	};

	batch(() => {
		setUserVariables(reconcile(nextVariables));
	});

	saveThemeUpdate({ userVariables: nextVariables }, live);
}

async function migrateToCustomTheme(fromTheme: ThemeConfig) {
	const customTheme =
		getThemeById("custom") ||
		validateTheme({
			id: "custom",
			name: "Custom",
			source: "builtin",
			primaryHue: 220,
			opacity: 0,
			grainStrength: 40,
			style: "glass",
			gradientEnabled: true,
			rotation: 135,
			gradientType: "linear",
			gradientHarmony: "none",
			borderWidth: 1,
			allowHueChange: true,
			allowStyleChange: true,
			allowBorderChange: true,
		});

	const migratedEffect = normalizeWindowEffectForCurrentOS(
		fromTheme.windowEffect ?? customTheme.windowEffect,
	);

	batch(() => {
		setThemeId("custom");
		setBackgroundHue(fromTheme.primaryHue ?? customTheme.primaryHue);
		setOpacity(fromTheme.opacity ?? customTheme.opacity ?? 0);
		setStyleMode(fromTheme.style ?? customTheme.style ?? "glass");
		setGrainStrength(fromTheme.grainStrength ?? customTheme.grainStrength ?? 40);
		setGradientEnabled(fromTheme.gradientEnabled ?? customTheme.gradientEnabled);
		setRotation(fromTheme.rotation ?? customTheme.rotation ?? 135);
		setGradientType(fromTheme.gradientType ?? customTheme.gradientType ?? "linear");
		setGradientHarmony(fromTheme.gradientHarmony ?? customTheme.gradientHarmony ?? "none");
		setBorderThickness(fromTheme.borderWidth ?? customTheme.borderWidth ?? 1);
		setBackgroundOpacity(fromTheme.backgroundOpacity ?? customTheme.backgroundOpacity ?? 25);
		setWindowEffect(migratedEffect);
		setUserVariables(reconcile({}));
	});

	await saveThemeUpdate({
		id: "custom",
		name: customTheme.name,
		author: customTheme.author,
		source: "builtin",
		primaryHue: fromTheme.primaryHue ?? customTheme.primaryHue,
		opacity: fromTheme.opacity ?? customTheme.opacity,
		grainStrength: fromTheme.grainStrength ?? customTheme.grainStrength,
		style: fromTheme.style ?? customTheme.style,
		gradientEnabled: fromTheme.gradientEnabled ?? customTheme.gradientEnabled,
		rotation: fromTheme.rotation ?? customTheme.rotation,
		gradientType: fromTheme.gradientType ?? customTheme.gradientType,
		gradientHarmony: fromTheme.gradientHarmony ?? customTheme.gradientHarmony,
		borderWidth: fromTheme.borderWidth ?? customTheme.borderWidth,
		backgroundOpacity: fromTheme.backgroundOpacity ?? customTheme.backgroundOpacity,
		windowEffect: migratedEffect,
		customCss: "",
		variables: customTheme.variables,
		userVariables: {},
	});
}

export async function handleDeleteImportedTheme(targetThemeId: string) {
	const themeToDelete = themeCatalog().find((theme) => theme.id === targetThemeId);
	if (!themeToDelete) return;

	if (getThemeSource(themeToDelete) !== "imported") {
		return;
	}

	const confirmed = await dialogStore.confirm(
		"Delete Imported Theme",
		`Delete "${themeToDelete.name}" from your imported theme library?`,
		{
			okLabel: "Delete",
			cancelLabel: "Cancel",
			isDestructive: true,
			severity: "warning",
		},
	);

	if (!confirmed) return;

	const libraryThemeId = themeToDelete.libraryId || targetThemeId;

	try {
		if (hasTauriRuntime()) {
			await invoke("delete_saved_theme", { themeId: libraryThemeId });
		}

		removeCustomTheme(targetThemeId);
		setThemeCatalog(getAllThemes());

		if (themeId() === targetThemeId) {
			await migrateToCustomTheme(themeToDelete);
			const { showToast } = await import("@ui/toast/toast");
			showToast({
				title: "Theme Deleted",
				description:
					"Active imported theme was removed. You have been switched to Custom with migrated settings.",
				severity: "info",
			});
		} else {
			const { showToast } = await import("@ui/toast/toast");
			showToast({
				title: "Theme Deleted",
				description: `${themeToDelete.name} was removed from your imported library.`,
				severity: "success",
			});
		}

		await refreshThemeCatalog();
	} catch (error) {
		console.error("Failed to delete imported theme:", error);
		dialogStore.alert("Delete Failed", "Failed to delete the selected imported theme.", "error");
	}
}

export async function handleExportTheme() {
	try {
		if (!hasTauriRuntime()) {
			dialogStore.alert("Platform Error", "Tauri runtime not found.", "error");
			return;
		}

		if (themeId() !== "custom") {
			dialogStore.alert(
				"Export Unavailable",
				"Only the Custom theme can be exported. Switch to Custom first.",
				"warning",
			);
			return;
		}

		const themeClass = getThemeById(themeId()) || validateTheme({});
		const activeAccount = await getActiveAccount();
		const author = activeAccount?.display_name || activeAccount?.username || "Anonymous";

		const customName = await dialogStore.prompt("Theme Name", "Enter a name for your theme before exporting.", {
			defaultValue: "My Custom Theme",
		});

		if (!customName) return;

		const savePath = await saveDialog({
			title: "Export Theme",
			defaultPath: `${customName.replace(/[^a-zA-Z0-9- ]/g, "_")}.vestatheme`,
			filters: [{ name: "Vesta Theme", extensions: ["vestatheme", "json"] }],
		});

		if (savePath) {
			await invoke("export_theme", {
				savePath,
				customName,
				author,
				customCss: themeClass.customCss || "",
			});
			dialogStore.alert("Theme Exported", "Your theme has been exported successfully.", "success");
		}
	} catch (e) {
		console.error("Failed to export theme", e);
		dialogStore.alert("Export Error", "Failed to export the theme.", "error");
	}
}

export async function handleImportTheme() {
	try {
		if (!hasTauriRuntime()) {
			dialogStore.alert("Platform Error", "Tauri runtime not found.", "error");
			return;
		}

		const openPath = await openDialog({
			title: "Import Theme",
			filters: [{ name: "Vesta Theme", extensions: ["vestatheme", "json"] }],
			multiple: false,
		});
		if (!openPath) return;

		const resolvedPath = Array.isArray(openPath) ? openPath[0] : openPath;

		const result = await invoke<ThemeImportResponse>("import_theme_from_file", {
			filePath: resolvedPath,
		});

		const importedTheme = validateTheme({
			...result.theme.themeData,
			id: result.theme.id,
			libraryId: result.theme.id,
			name: result.theme.name,
			source: "imported",
		});

		upsertCustomTheme(importedTheme);
		setThemeCatalog(getAllThemes());

		batch(() => {
			setThemeId(importedTheme.id);
			setBackgroundHue(importedTheme.primaryHue);
			setOpacity(importedTheme.opacity ?? 0);
			setStyleMode(importedTheme.style ?? "glass");
			setGrainStrength(importedTheme.grainStrength ?? 40);
			setGradientEnabled(importedTheme.gradientEnabled);
			setRotation(importedTheme.rotation ?? 135);
			setGradientType(importedTheme.gradientType ?? "linear");
			setGradientHarmony(importedTheme.gradientHarmony ?? "none");
			setBorderThickness(importedTheme.borderWidth ?? 1);
			setBackgroundOpacity(importedTheme.backgroundOpacity ?? 25);
			setWindowEffect(normalizeWindowEffectForCurrentOS(importedTheme.windowEffect));
			setUserVariables(reconcile(importedTheme.userVariables || {}));
		});

		await saveThemeUpdate({
			id: importedTheme.id,
			primaryHue: importedTheme.primaryHue,
			opacity: importedTheme.opacity,
			grainStrength: importedTheme.grainStrength,
			style: importedTheme.style,
			gradientEnabled: importedTheme.gradientEnabled,
			rotation: importedTheme.rotation,
			gradientType: importedTheme.gradientType,
			gradientHarmony: importedTheme.gradientHarmony,
			borderWidth: importedTheme.borderWidth,
			backgroundOpacity: importedTheme.backgroundOpacity,
			windowEffect: normalizeWindowEffectForCurrentOS(importedTheme.windowEffect),
			customCss: importedTheme.customCss,
			allowHueChange: importedTheme.allowHueChange,
			allowStyleChange: importedTheme.allowStyleChange,
			allowBorderChange: importedTheme.allowBorderChange,
			variables: importedTheme.variables,
			userVariables: importedTheme.userVariables || {},
		});

		if (result.warnings && result.warnings.length > 0) {
			dialogStore.alert("Theme Imported With Warnings", result.warnings.join("\n"), "warning");
		} else {
			dialogStore.alert("Theme Imported", "Theme imported and added to your library.", "success");
		}
	} catch (e) {
		console.error("Failed to import theme", e);
		dialogStore.alert("Import Error", "Failed to import the selected theme file.", "error");
	}
}

export async function handleReducedMotionToggle(checked: boolean) {
	const prev = reducedMotion();
	setReducedMotion(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "reduced_motion", value: checked });
		} catch (e) {
			console.error("Failed to persist reduced_motion:", e);
			setReducedMotion(prev);
		}
	}
}

export async function handleDebugToggle(checked: boolean) {
	const prev = debugLogging();
	setDebugLogging(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "debug_logging", value: checked });
		} catch (e) {
			console.error("Failed to persist debug_logging:", e);
			setDebugLogging(prev);
		}
	}
}

export async function handleAutoUpdateToggle(checked: boolean) {
	const prev = autoUpdateEnabled();
	setAutoUpdateEnabled(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "auto_update_enabled", value: checked });
		} catch (e) {
			console.error("Failed to persist auto_update_enabled:", e);
			setAutoUpdateEnabled(prev);
		}
	}
}

export async function handleStartupCheckToggle(checked: boolean) {
	const prev = startupCheckUpdates();
	setStartupCheckUpdates(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "startup_check_updates", value: checked });
		} catch (e) {
			console.error("Failed to persist startup_check_updates:", e);
			setStartupCheckUpdates(prev);
		}
	}
}

export async function handleGpuToggle(checked: boolean) {
	const prev = useDedicatedGpu();
	setUseDedicatedGpu(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "use_dedicated_gpu", value: checked });
		} catch (e) {
			console.error("Failed to persist use_dedicated_gpu:", e);
			setUseDedicatedGpu(prev);
		}
	}
}

export async function handleDiscordToggle(checked: boolean) {
	const prev = discordPresenceEnabled();
	setDiscordPresenceEnabled(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "discord_presence_enabled", value: checked });
		} catch (e) {
			console.error("Failed to persist discord_presence_enabled:", e);
			setDiscordPresenceEnabled(prev);
		}
	}
}

export async function handleShowTrayIconToggle(checked: boolean) {
	const prev = showTrayIcon();
	setShowTrayIcon(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("set_tray_icon_visibility", { visible: checked });
		} catch (e) {
			console.error("Failed to persist show_tray_icon:", e);
			setShowTrayIcon(prev);
		}
	}
}

export async function handleCloseToTrayToggle(checked: boolean) {
	const prev = closeToTray();
	setCloseToTray(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("set_minimize_to_tray", { enabled: checked });
		} catch (e) {
			console.error("Failed to persist close_to_tray:", e);
			setCloseToTray(prev);
		}
	}
}

export async function handleMaxDownloadThreadsChange(val: number) {
	setMaxDownloadThreads(val);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "max_download_threads", value: val });
		} catch (e) {
			console.error("Failed to persist max_download_threads:", e);
		}
	}
}

export async function handleAutostartToggle(checked: boolean) {
	const prev = autostartEnabled();
	setAutostartEnabled(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "autostart_enabled", value: checked });
			if (checked) {
				await enableAutostart();
			} else {
				await disableAutostart();
			}
		} catch (e) {
			console.error("Failed to persist autostart_enabled:", e);
			setAutostartEnabled(prev);
		}
	}
}

export async function handleTelemetryToggle(checked: boolean) {
	const prev = telemetryEnabled();
	setTelemetryEnabled(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "telemetry_enabled", value: checked });
		} catch (e) {
			console.error("Failed to persist telemetry_enabled:", e);
			setTelemetryEnabled(prev);
			return;
		}
	}

	const { showToast } = await import("@ui/toast/toast");
	showToast({
		title: "Telemetry Preference Updated",
		description: "Restart Vesta Launcher to apply telemetry changes to backend crash reporting.",
		severity: "info",
		actions: [
			{
				id: "restart_app",
				label: "Restart Now",
				type: "primary",
			},
		],
		onAction: (actionId) => {
			if (actionId === "restart_app" && hasTauriRuntime()) {
				void invoke("restart_app");
			}
		},
	});
}

export async function handleAutoInstallDepsToggle(checked: boolean) {
	const prev = autoInstallDependencies();
	setAutoInstallDependencies(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "auto_install_dependencies", value: checked });
		} catch (e) {
			console.error("Failed to persist auto_install_dependencies:", e);
			setAutoInstallDependencies(prev);
		}
	}
}

function markProxyRestartRequired() {
	setProxyRestartRequired(true);
}

export async function handleProxyEnabledToggle(checked: boolean) {
	const prev = proxyEnabled();
	setProxyEnabled(checked);
	markProxyRestartRequired();
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "proxy_enabled", value: checked });
		} catch (e) {
			console.error("Failed to persist proxy_enabled:", e);
			setProxyEnabled(prev);
		}
	}
}

export async function handleProxyUrlChange(value: string) {
	const prev = proxyUrl();
	setProxyUrl(value);
	markProxyRestartRequired();
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", {
				field: "proxy_url",
				value: value.trim() ? value.trim() : null,
			});
		} catch (e) {
			console.error("Failed to persist proxy_url:", e);
			setProxyUrl(prev);
		}
	}
}

export async function handleProxyApplyToGamesToggle(checked: boolean) {
	const prev = proxyApplyToGames();
	setProxyApplyToGames(checked);
	if (hasTauriRuntime()) {
		try {
			await invoke("update_config_field", { field: "proxy_apply_to_games", value: checked });
		} catch (e) {
			console.error("Failed to persist proxy_apply_to_games:", e);
			setProxyApplyToGames(prev);
		}
	}
}

export interface ProxyTestResult {
	ok: boolean;
	status: "online" | "offline";
	message: string;
	detail?: string | null;
}

export async function testProxyConnection(): Promise<ProxyTestResult> {
	if (!hasTauriRuntime()) {
		return {
			ok: true,
			status: "online",
			message: "Proxy testing is available in the desktop app.",
		};
	}

	return invoke<ProxyTestResult>("test_proxy_connection", {
		input: {
			enabled: proxyEnabled(),
			url: proxyUrl().trim() ? proxyUrl().trim() : null,
		},
	});
}

export async function updateDefaultField(field: string, value: any) {
	setInstanceDefaults((prev) => ({ ...prev, [field]: value }));
	if (hasTauriRuntime()) {
		await invoke("update_config_field", { field, value });
	}
}

export async function handleOpenAppData() {
	if (hasTauriRuntime()) {
		await invoke("open_app_config_dir");
	}
}

export async function handleOpenRuntimeStorageLocation() {
	if (hasTauriRuntime()) {
		await invoke("open_app_runtime_storage_dir");
	}
}

export async function handleOpenLauncherLogs() {
	if (hasTauriRuntime()) {
		await invoke("open_logs_folder", { instanceIdSlug: null });
	}
}

export async function handleClearCache() {
	if (hasTauriRuntime()) {
		try {
			await invoke("clear_cache");
			refetchSize();
			const { showToast } = await import("@ui/toast/toast");
			showToast({
				title: "Cache Cleared",
				description: "All stored metadata and temporary files have been cleared.",
				severity: "success",
			});
		} catch (e) {
			console.error("Failed to clear cache:", e);
			const { showToast } = await import("@ui/toast/toast");
			showToast({
				title: "Clear Cache Failed",
				description: "Something went wrong while clearing the cache.",
				severity: "error",
			});
		}
	}
}

// Config update listener management
let unsubscribeConfigUpdate: (() => void) | null = null;
let unlistenJavaPaths: (() => void) | undefined;

export function getCacheSizeDisplay(): string {
	return cacheSizeValue() || "0 bytes";
}

export function getTotalRam(): number {
	return systemMemory();
}

export function getRequirements(): any[] {
	return requirements() || [];
}

export async function initSettings() {
	if (hasTauriRuntime()) {
		try {
			const config = await invoke<AppConfig>("get_config");
			batch(() => {
				setDebugLogging(config.debug_logging);
				setReducedMotion(config.reduced_motion ?? false);
				setAutoUpdateEnabled(config.auto_update_enabled ?? true);
				setStartupCheckUpdates(config.startup_check_updates ?? true);
				setUseDedicatedGpu(config.use_dedicated_gpu ?? true);
				setTelemetryEnabled(config.telemetry_enabled ?? true);
				setDiscordPresenceEnabled(config.discord_presence_enabled ?? true);
				setAutoInstallDependencies(config.auto_install_dependencies ?? true);
				setProxyEnabled(config.proxy_enabled ?? false);
				setProxyUrl(config.proxy_url ?? "");
				setProxyApplyToGames(config.proxy_apply_to_games ?? false);
				setProxyRestartRequired(false);
				setMaxDownloadThreads(config.max_download_threads ?? 4);
				setAutostartEnabled(config.autostart_enabled ?? false);
				setShowTrayIcon(config.show_tray_icon ?? true);
				setCloseToTray(config.minimize_to_tray ?? false);

				setInstanceDefaults({
					default_width: config.default_width,
					default_height: config.default_height,
					default_java_args: config.default_java_args,
					default_environment_variables: config.default_environment_variables,
					default_pre_launch_hook: config.default_pre_launch_hook,
					default_wrapper_command: config.default_wrapper_command,
					default_post_exit_hook: config.default_post_exit_hook,
					default_min_memory: config.default_min_memory,
					default_max_memory: config.default_max_memory,
					default_launcher_action_on_launch:
						config.default_launcher_action_on_launch ?? "stay-open",
				});

				if (config.theme_id) setThemeId(config.theme_id);
				if (config.theme_primary_hue !== null && config.theme_primary_hue !== undefined)
					setBackgroundHue(config.theme_primary_hue);
				else if (config.background_hue !== null && config.background_hue !== undefined)
					setBackgroundHue(config.background_hue);

				if (config.theme_id) {
					const selectedTheme = getThemeById(config.theme_id);
					setOpacity(selectedTheme?.opacity ?? 0);
					setStyleMode(selectedTheme?.style ?? "glass");
					setGrainStrength(selectedTheme?.grainStrength ?? 40);
				}
				if (config.theme_style) {
					setStyleMode(normalizeStyleMode(config.theme_style) ?? "glass");
				}
				if (config.theme_gradient_enabled !== null && config.theme_gradient_enabled !== undefined)
					setGradientEnabled(config.theme_gradient_enabled);
				if (config.theme_gradient_angle !== null && config.theme_gradient_angle !== undefined)
					setRotation(config.theme_gradient_angle);
				if (config.theme_gradient_type)
					setGradientType(config.theme_gradient_type as "linear" | "radial");
				if (config.theme_gradient_harmony)
					setGradientHarmony(config.theme_gradient_harmony as GradientHarmony);
				if (config.theme_border_width !== null && config.theme_border_width !== undefined)
					setBorderThickness(config.theme_border_width);
				if (config.theme_background_opacity !== null && config.theme_background_opacity !== undefined)
					setBackgroundOpacity(config.theme_background_opacity);
				if (config.theme_window_effect)
					setWindowEffect(normalizeWindowEffectForCurrentOS(config.theme_window_effect));

				if (config.theme_data) {
					const themeData = parseThemeData(config.theme_data);

					if (themeData.primaryHue !== undefined) setBackgroundHue(themeData.primaryHue);
					if (themeData.opacity !== undefined) setOpacity(themeData.opacity);
					if (themeData.style) setStyleMode(themeData.style);
					if (themeData.grainStrength !== undefined) setGrainStrength(themeData.grainStrength);
					if (themeData.gradientEnabled !== undefined) setGradientEnabled(themeData.gradientEnabled);
					if (themeData.rotation !== undefined) setRotation(themeData.rotation);
					if (themeData.gradientType)
						setGradientType(themeData.gradientType as "linear" | "radial");
					if (themeData.gradientHarmony)
						setGradientHarmony(themeData.gradientHarmony as GradientHarmony);
					if (themeData.borderWidth !== undefined) setBorderThickness(themeData.borderWidth);
					if (themeData.backgroundOpacity !== undefined)
						setBackgroundOpacity(themeData.backgroundOpacity);
					if (themeData.windowEffect) {
						setWindowEffect(normalizeWindowEffectForCurrentOS(themeData.windowEffect));
					}
					if (themeData.userVariables) setUserVariables(reconcile(themeData.userVariables));
				}
			});
		} catch (error) {
			console.error("Failed to load settings:", error);
			const { showToast } = await import("@ui/toast/toast");
			showToast({
				title: "Settings Load Failed",
				description: "Could not load your saved preferences. Using defaults.",
				severity: "error",
			});
		}
	}

	// Refresh theme catalog from backend
	await refreshThemeCatalog();

	// Load window effect capabilities
	const capabilities = await loadWindowEffectCapabilities();
	if (capabilities?.supportedEffects?.length) {
		setWindowEffectOptions(capabilities.supportedEffects);
		setWindowEffect((current) => normalizeWindowEffectForCurrentOS(current));
	}

	// Set up Java paths listener
	if (hasTauriRuntime()) {
		listen("java-paths-updated", () => {
			refreshJavas();
		}).then((fn) => {
			unlistenJavaPaths = fn;
		});

		// Refresh Java data on initial load
		refreshJavas();
	}

	// Set up config update listener from other windows
	unsubscribeConfigUpdate = onConfigUpdate((field, value) => {
		if (field === "debug_logging") setDebugLogging(value);
		if (field === "auto_update_enabled") setAutoUpdateEnabled(value);
		if (field === "startup_check_updates") setStartupCheckUpdates(value);
		if (field === "use_dedicated_gpu") setUseDedicatedGpu(value ?? true);
		if (field === "telemetry_enabled") setTelemetryEnabled(value ?? true);
		if (field === "discord_presence_enabled") setDiscordPresenceEnabled(value ?? true);
		if (field === "reduced_motion") setReducedMotion(value ?? false);
		if (field === "autostart_enabled") setAutostartEnabled(value ?? false);
		if (field === "show_tray_icon") setShowTrayIcon(value ?? true);
		if (field === "minimize_to_tray") setCloseToTray(value ?? false);
		if (field === "proxy_enabled") setProxyEnabled(value ?? false);
		if (field === "proxy_url") setProxyUrl(value ?? "");
		if (field === "proxy_apply_to_games") setProxyApplyToGames(value ?? false);
		if (field === "theme_id" && value) {
			const previousThemeId = untrack(themeId);
			if (previousThemeId !== value) {
				setThemeId(value);
				const selectedTheme = getThemeById(value);
				if (selectedTheme) {
					setStyleMode(selectedTheme.style ?? "glass");
					setGrainStrength(selectedTheme.grainStrength ?? 40);
				}
			}
		}
		if (field === "theme_primary_hue" && value !== null) setBackgroundHue(value);
		if (field === "theme_style" && value)
			setStyleMode(normalizeStyleMode(value) ?? untrack(styleMode));
		if (field === "theme_gradient_enabled" && value !== null) setGradientEnabled(value);
		if (field === "theme_gradient_angle" && value !== null) setRotation(value);
		if (field === "theme_gradient_type" && value)
			setGradientType(value as "linear" | "radial");
		if (field === "theme_gradient_harmony" && value)
			setGradientHarmony(value as GradientHarmony);
		if (field === "theme_border_width" && value !== null) setBorderThickness(value);
		if (field === "theme_background_opacity" && value !== null) setBackgroundOpacity(value);
		if (field === "theme_window_effect" && value)
			setWindowEffect(normalizeWindowEffectForCurrentOS(value));

		if (field === "theme_data" && value) {
			const themeData = parseThemeData(value);
			batch(() => {
				if (themeData.primaryHue !== undefined && themeData.primaryHue !== untrack(backgroundHue))
					setBackgroundHue(themeData.primaryHue);
				if (themeData.opacity !== undefined && themeData.opacity !== untrack(opacity))
					setOpacity(themeData.opacity);
				if (themeData.style && themeData.style !== untrack(styleMode)) {
					setStyleMode(themeData.style);
				}
				if (
					themeData.grainStrength !== undefined &&
					themeData.grainStrength !== untrack(grainStrength)
				) {
					setGrainStrength(themeData.grainStrength);
				}
				if (
					themeData.gradientEnabled !== undefined &&
					themeData.gradientEnabled !== untrack(gradientEnabled)
				)
					setGradientEnabled(themeData.gradientEnabled);
				if (themeData.rotation !== undefined && themeData.rotation !== untrack(rotation))
					setRotation(themeData.rotation);
				if (themeData.gradientType && themeData.gradientType !== untrack(gradientType))
					setGradientType(themeData.gradientType as "linear" | "radial");
				if (themeData.gradientHarmony && themeData.gradientHarmony !== untrack(gradientHarmony))
					setGradientHarmony(themeData.gradientHarmony as GradientHarmony);
				if (themeData.borderWidth !== undefined && themeData.borderWidth !== untrack(borderThickness))
					setBorderThickness(themeData.borderWidth);
				if (
					themeData.backgroundOpacity !== undefined &&
					themeData.backgroundOpacity !== untrack(backgroundOpacity)
				)
					setBackgroundOpacity(themeData.backgroundOpacity);
				if (themeData.windowEffect && themeData.windowEffect !== untrack(windowEffect)) {
					setWindowEffect(normalizeWindowEffectForCurrentOS(themeData.windowEffect));
				}

				if (themeData.userVariables) {
					const currentVars = untrack(userVariablesSnapshot);
					const hasChanged =
						JSON.stringify(currentVars) !== JSON.stringify(themeData.userVariables);
					if (hasChanged) {
						setUserVariables(reconcile(themeData.userVariables));
					}
				}
			});
		}

		if (field.startsWith("default_")) {
			setInstanceDefaults((prev) => ({ ...prev, [field]: value }));
		}
	});

	setLoading(false);
}

export function cleanupSettings() {
	cancelDebouncedPersistence();
	unsubscribeConfigUpdate?.();
	unlistenJavaPaths?.();
}
