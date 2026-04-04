import { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { SettingsCard } from "@components/settings";
import { dialogStore } from "@stores/dialog-store";
import {
	cacheSize,
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
	open as openDialog,
	save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import LauncherButton from "@ui/button/button";
import {
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@ui/tabs/tabs";
import { showToast } from "@ui/toast/toast";
import { getActiveAccount } from "@utils/auth";
import {
	currentThemeConfig,
	onConfigUpdate,
	saveThemeUpdate as persistThemeUpdate,
} from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import {
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	onCleanup,
	onMount,
	Show,
	Suspense,
	untrack
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
	applyTheme,
	getAllThemes,
	getSupportedWindowEffects,
	getThemeById,
	type GradientHarmony,
	isBuiltinThemeId,
	loadWindowEffectCapabilities,
	normalizeWindowEffectForCurrentOS,
	parseThemeData,
	PRESET_THEMES,
	removeCustomTheme,
	setCustomThemes,
	type StyleMode,
	type ThemeConfig,
	type ThemeVariableValue,
	upsertCustomTheme,
	validateTheme,
} from "../../../../themes/presets";
import { AccountSettingsTab } from "./account/AccountTab";
import { AppearanceSettingsTab } from "./appearance/AppearanceTab";
import { InstanceDefaultsTab } from "./defaults/DefaultsTab";
import { DeveloperSettingsTab } from "./developer/DeveloperTab";
import { GeneralSettingsTab } from "./general/GeneralTab";
import { HelpSettingsTab } from "./help/HelpTab";
import { type JavaOption } from "./java/JavaOptionCard";
import { JavaSettingsTab } from "./java/JavaTab";
import { NotificationSettingsTab } from "./notifications/NotificationsTab";
import styles from "./settings-page.module.css";

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
	show_tray_icon: boolean;
	minimize_to_tray: boolean;
	reduced_motion: boolean;
	last_window_width: number;
	last_window_height: number;
	debug_logging: boolean;
	notification_retention_days?: number; // Optional as per user feedback
	active_account_uuid: string | null;

	// Theme system fields
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
	theme_advanced_overrides?: string;
	theme_window_effect?: string;
	theme_background_opacity?: number;
	theme_data?: string;
	theme_border_width?: number;
	setup_completed: boolean;
	setup_step: number;
	tutorial_completed: boolean;
	use_dedicated_gpu: boolean;
	discord_presence_enabled: boolean;
	auto_install_dependencies: boolean;

	// Instance defaults
	default_width: number;
	default_height: number;
	default_java_args: string | null;
	default_environment_variables: string | null;
	default_pre_launch_hook: string | null;
	default_wrapper_command: string | null;
	default_post_exit_hook: string | null;
	default_min_memory: number;
	default_max_memory: number;

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

/**
 * Settings Page
 */
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

function SettingsPage(props: { close?: () => void; router?: MiniRouter }) {
	const activeRouter = createMemo(() => props.router || router());
	const [version] = createResource(getVersion);

	// Derive active tab from router params if available, fallback to default
	const activeTab = createMemo(() => {
		if (activeRouter()?.currentPath.get() !== "/config") return "general";
		const params = activeRouter()?.currentParams.get();
		return (params?.activeTab as string) || "general";
	});

	const [debugLogging, setDebugLogging] = createSignal(false);
	const [autoUpdateEnabled, setAutoUpdateEnabled] = createSignal(true);
	const [startupCheckUpdates, setStartupCheckUpdates] = createSignal(true);
	const [useDedicatedGpu, setUseDedicatedGpu] = createSignal(false);
	const [discordPresenceEnabled, setDiscordPresenceEnabled] =
		createSignal(true);
	const [autoInstallDependencies, setAutoInstallDependencies] =
		createSignal(true);
	const [maxDownloadThreads, setMaxDownloadThreads] = createSignal(4);
	const [instanceDefaults, setInstanceDefaults] = createSignal<
		Partial<AppConfig>
	>({});
	const [selectedTab, setSelectedTab] = createSignal(activeTab());
	const [isDesktop, setIsDesktop] = createSignal(window.innerWidth >= 800);
	const totalRam = systemMemory;

	// Persistence debounce (100ms) - only for database writes
	const debouncedPersistence = createDebounce(async (overrides: any) => {
		await persistThemeUpdate(overrides);
	}, 100);

	createEffect(() => {
		setSelectedTab(activeTab());
	});

	onMount(() => {
		// Register state for pop-out window handoff
		activeRouter()?.registerStateProvider("/config", () => ({
			activeTab: activeTab(),
		}));
	});

	onCleanup(() => {
		debouncedPersistence.cancel();
	});

	const [backgroundHue, setBackgroundHue] = createSignal(
		currentThemeConfig.theme_primary_hue ??
			currentThemeConfig.background_hue ??
			180,
	);
	const [opacity, setOpacity] = createSignal<number>(
		getThemeById(currentThemeConfig.theme_id || "vesta")?.opacity ?? 0,
	);
	const [gradientEnabled, setGradientEnabled] = createSignal<boolean>(
		currentThemeConfig.theme_gradient_enabled ?? true,
	);
	const [rotation, setRotation] = createSignal<number>(
		currentThemeConfig.theme_gradient_angle ?? 135,
	);
	const [gradientType, setGradientType] = createSignal<"linear" | "radial">(
		(currentThemeConfig.theme_gradient_type as "linear" | "radial") ?? "linear",
	);
	const [gradientHarmony, setGradientHarmony] = createSignal<GradientHarmony>(
		(currentThemeConfig.theme_gradient_harmony as GradientHarmony) ?? "none",
	);
	const [themeId, setThemeId] = createSignal<string>(
		currentThemeConfig.theme_id ?? "vesta",
	);
	const [themeCatalog, setThemeCatalog] = createSignal<ThemeConfig[]>(
		getAllThemes(),
	);
	const [themeSearchQuery, setThemeSearchQuery] = createSignal("");
	const [themeFilterMode, setThemeFilterMode] =
		createSignal<ThemeFilterMode>("all");
	const [themeViewMode, setThemeViewMode] = createSignal<ThemeViewMode>("grid");
	const [borderThickness, setBorderThickness] = createSignal(
		currentThemeConfig.theme_border_width ?? 1,
	);
	const [backgroundOpacity, setBackgroundOpacity] = createSignal(
		currentThemeConfig.theme_background_opacity ?? 12,
	);
	const [windowEffect, setWindowEffect] = createSignal(
		normalizeWindowEffectForCurrentOS(
			currentThemeConfig.theme_window_effect || "none",
		),
	);
	const [windowEffectOptions, setWindowEffectOptions] = createSignal<string[]>(
		getSupportedWindowEffects(),
	);
	const [userVariables, setUserVariables] = createStore<
		Record<string, ThemeVariableValue>
	>(
		untrack(
			() => parseThemeData(currentThemeConfig.theme_data).userVariables || {},
		),
	);
	const userVariablesSnapshot = createMemo<Record<string, ThemeVariableValue>>(
		() => {
			const snapshot: Record<string, ThemeVariableValue> = {};
			for (const key of Object.keys(userVariables)) {
				const value = userVariables[key];
				if (
					typeof value === "number" ||
					typeof value === "string" ||
					typeof value === "boolean"
				) {
					snapshot[key] = value;
				}
			}
			return snapshot;
		},
	);

	const [loading, setLoading] = createSignal(true);
	const [reducedMotion, setReducedMotion] = createSignal(false);

	// Create local proxies of the global resources to maintain the [data, { refetch }] pattern
	const [requirements] = javaRequirements;
	const [detected, { refetch: refetchDetected }] = detectedJava;
	const [managed, { refetch: refetchManaged }] = managedJava;
	const [globalPaths, { refetch: refetchGlobalPaths }] = globalJavaPaths;

	const [cacheSizeValue, { refetch: refetchSize }] = cacheSize;

	const [isScanning, setIsScanning] = createSignal(false);

	// Permissions helpers based on current theme
	const canChangeHue = () => {
		const id = themeId();
		return id ? (getThemeById(id)?.allowHueChange ?? false) : false;
	};

	const showAdvancedControls = () => {
		const theme = getThemeById(themeId());
		if (!theme) return false;
		return Boolean(
			theme.id === "custom" ||
				theme.allowStyleChange ||
				theme.allowBorderChange ||
				theme.variables?.length,
		);
	};

	const getThemeSource = (theme: ThemeConfig): "builtin" | "imported" => {
		return (
			theme.source ?? (isBuiltinThemeId(theme.id) ? "builtin" : "imported")
		);
	};

	const hasImportedThemes = createMemo(() =>
		themeCatalog().some((theme) => getThemeSource(theme) === "imported"),
	);

	const filteredThemeCatalog = createMemo(() => {
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

					const presetA =
						presetOrder.get(a.theme.id) ?? Number.MAX_SAFE_INTEGER;
					const presetB =
						presetOrder.get(b.theme.id) ?? Number.MAX_SAFE_INTEGER;
					if (presetA !== presetB) {
						return presetA - presetB;
					}
				}

				return a.index - b.index;
			})
			.map(({ theme }) => theme);
	});

	createEffect(() => {
		if (!hasImportedThemes() && themeFilterMode() === "imported") {
			setThemeFilterMode("all");
		}
	});

	const refreshThemeCatalog = async () => {
		if (!hasTauriRuntime()) {
			setThemeCatalog(getAllThemes());
			return;
		}

		try {
			const saved = await invoke<SavedThemeEntry[]>("list_saved_themes");
			const customThemes = saved.map((entry) => {
				const runtimeId = isBuiltinThemeId(entry.id)
					? `imported-${entry.id}`
					: entry.id;

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
	};

	// Flatten Java options into a simple array
	const javaOptions = createMemo(() => {
		const options: JavaOption[] = [];
		const reqs = requirements() || [];
		const detectedJavas = detected() || [];
		const managedJavas = managed() || [];
		const globalPathsData = globalPaths() || [];

		reqs.forEach((req: any) => {
			const current = globalPathsData.find(
				(p: any) => p.major_version === req.major_version,
			);
			const managedVersion = managedJavas.find(
				(m: any) => m.major_version === req.major_version,
			);

			// Managed option
			options.push({
				type: "managed",
				version: req.major_version,
				title: "Managed Runtime",
				path: managedVersion?.path,
				isActive: current?.is_managed || false,
				onClick: () => {
					if (managedVersion) {
						handleSetGlobalPath(req.major_version, managedVersion.path, true);
					}
				},
				onDownload: () => handleDownloadManaged(req.major_version),
			});

			// System detected options
			detectedJavas
				.filter((d: any) => d.major_version === req.major_version)
				.forEach((det: any) => {
					options.push({
						type: "system",
						version: req.major_version,
						title: "System Runtime",
						path: det.path,
						isActive: current?.path === det.path && !current?.is_managed,
						onClick: () =>
							handleSetGlobalPath(req.major_version, det.path, false),
					});
				});

			// Custom active path (if not in detected list)
			if (
				current &&
				!current.is_managed &&
				!detectedJavas.some(
					(d: any) =>
						d.path === current.path && d.major_version === req.major_version,
				)
			) {
				options.push({
					type: "custom",
					version: req.major_version,
					title: "Custom Path",
					path: current.path,
					isActive: true,
					onClick: () => handleManualPickSetGlobal(req.major_version),
				});
			}

			// Browse option
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

	let unsubscribeConfigUpdate: (() => void) | null = null;

	const refreshJavas = async () => {
		if (!hasTauriRuntime()) return;
		try {
			setIsScanning(true);
			await Promise.all([
				refetchDetected(),
				refetchManaged(),
				refetchGlobalPaths(),
			]);
		} catch (e) {
			console.error("Failed to refresh javas:", e);
		} finally {
			setIsScanning(false);
		}
	};

	const handleSetGlobalPath = async (
		version: number,
		path: string,
		isManaged: boolean,
	) => {
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
	};

	const handleDownloadManaged = async (version: number) => {
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
	};

	const handleManualPickSetGlobal = async (version: number) => {
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
	};

	onMount(async () => {
		const handleResize = () => setIsDesktop(window.innerWidth >= 800);
		window.addEventListener("resize", handleResize);
		onCleanup(() => window.removeEventListener("resize", handleResize));

		await refreshThemeCatalog();
		const capabilities = await loadWindowEffectCapabilities();
		if (capabilities?.supportedEffects?.length) {
			setWindowEffectOptions(capabilities.supportedEffects);
			setWindowEffect((current) => normalizeWindowEffectForCurrentOS(current));
		}

		if (hasTauriRuntime()) {
			let unlisten: (() => void) | undefined;
			onCleanup(() => unlisten && unlisten());

			listen("java-paths-updated", () => {
				refreshJavas();
			}).then((fn) => {
				unlisten = fn;
			});
		}

		try {
			if (hasTauriRuntime()) {
				refreshJavas();
				const config = await invoke<AppConfig>("get_config");
				setDebugLogging(config.debug_logging);
				setReducedMotion(config.reduced_motion ?? false);
				setAutoUpdateEnabled(config.auto_update_enabled ?? true);
				setStartupCheckUpdates(config.startup_check_updates ?? true);
				setUseDedicatedGpu(config.use_dedicated_gpu ?? true);
				setDiscordPresenceEnabled(config.discord_presence_enabled ?? true);
				setAutoInstallDependencies(config.auto_install_dependencies ?? true);
				setMaxDownloadThreads(config.max_download_threads ?? 4);

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
				});

				// Load theme configuration
				if (config.theme_id) setThemeId(config.theme_id);
				if (
					config.theme_primary_hue !== null &&
					config.theme_primary_hue !== undefined
				)
					setBackgroundHue(config.theme_primary_hue);
				else if (
					config.background_hue !== null &&
					config.background_hue !== undefined
				)
					setBackgroundHue(config.background_hue);

				if (config.theme_id) {
					setOpacity(getThemeById(config.theme_id)?.opacity ?? 0);
				}
				if (
					config.theme_gradient_enabled !== null &&
					config.theme_gradient_enabled !== undefined
				)
					setGradientEnabled(config.theme_gradient_enabled);
				if (
					config.theme_gradient_angle !== null &&
					config.theme_gradient_angle !== undefined
				)
					setRotation(config.theme_gradient_angle);
				if (config.theme_gradient_type)
					setGradientType(config.theme_gradient_type as "linear" | "radial");
				if (config.theme_gradient_harmony)
					setGradientHarmony(config.theme_gradient_harmony as GradientHarmony);
				if (
					config.theme_border_width !== null &&
					config.theme_border_width !== undefined
				)
					setBorderThickness(config.theme_border_width);
				if (
					config.theme_background_opacity !== null &&
					config.theme_background_opacity !== undefined
				)
					setBackgroundOpacity(config.theme_background_opacity);
				if (config.theme_window_effect)
					setWindowEffect(
						normalizeWindowEffectForCurrentOS(config.theme_window_effect),
					);

				// CRITICAL: Handle the new consolidated theme_data JSON blob for deep-load
				if (config.theme_data) {
					const themeData = parseThemeData(config.theme_data);

					if (themeData.primaryHue !== undefined)
						setBackgroundHue(themeData.primaryHue);
					if (themeData.opacity !== undefined) setOpacity(themeData.opacity);
					if (themeData.gradientEnabled !== undefined)
						setGradientEnabled(themeData.gradientEnabled);
					if (themeData.rotation !== undefined) setRotation(themeData.rotation);
					if (themeData.gradientType)
						setGradientType(themeData.gradientType as "linear" | "radial");
					if (themeData.gradientHarmony)
						setGradientHarmony(themeData.gradientHarmony as GradientHarmony);
					if (themeData.borderWidth !== undefined)
						setBorderThickness(themeData.borderWidth);
					if (themeData.backgroundOpacity !== undefined)
						setBackgroundOpacity(themeData.backgroundOpacity);
					if (themeData.windowEffect) {
						setWindowEffect(
							normalizeWindowEffectForCurrentOS(themeData.windowEffect),
						);
					}
					if (themeData.userVariables)
						setUserVariables(reconcile(themeData.userVariables));
				}
			}

			unsubscribeConfigUpdate = onConfigUpdate((field, value) => {
				if (field === "debug_logging") setDebugLogging(value);
				if (field === "auto_update_enabled") setAutoUpdateEnabled(value);
				if (field === "startup_check_updates") setStartupCheckUpdates(value);
				if (field === "use_dedicated_gpu") setUseDedicatedGpu(value ?? true);
				if (field === "discord_presence_enabled")
					setDiscordPresenceEnabled(value ?? true);
				if (field === "reduced_motion") setReducedMotion(value ?? false);
				if (field === "theme_id" && value) setThemeId(value);
				if (field === "theme_primary_hue" && value !== null)
					setBackgroundHue(value);
				if (field === "theme_style" && value) {
					const activeTheme = getThemeById(untrack(themeId));
					if (
						activeTheme &&
						activeTheme.style === value &&
						activeTheme.opacity !== undefined
					) {
						setOpacity(activeTheme.opacity);
					}
				}
				if (field === "theme_gradient_enabled" && value !== null)
					setGradientEnabled(value);
				if (field === "theme_gradient_angle" && value !== null)
					setRotation(value);
				if (field === "theme_gradient_type" && value)
					setGradientType(value as "linear" | "radial");
				if (field === "theme_gradient_harmony" && value)
					setGradientHarmony(value as GradientHarmony);
				if (field === "theme_border_width" && value !== null)
					setBorderThickness(value);
				if (field === "theme_background_opacity" && value !== null)
					setBackgroundOpacity(value);
				if (field === "theme_window_effect" && value)
					setWindowEffect(normalizeWindowEffectForCurrentOS(value));

				// Handle real-time theme_data updates from other windows
				if (field === "theme_data" && value) {
					// Only apply updates if they didn't originate from this component's interactions
					const themeData = parseThemeData(value);
					batch(() => {
						if (
							themeData.primaryHue !== undefined &&
							themeData.primaryHue !== untrack(backgroundHue)
						)
							setBackgroundHue(themeData.primaryHue);
						if (
							themeData.opacity !== undefined &&
							themeData.opacity !== untrack(opacity)
						)
							setOpacity(themeData.opacity);
						if (
							themeData.gradientEnabled !== undefined &&
							themeData.gradientEnabled !== untrack(gradientEnabled)
						)
							setGradientEnabled(themeData.gradientEnabled);
						if (
							themeData.rotation !== undefined &&
							themeData.rotation !== untrack(rotation)
						)
							setRotation(themeData.rotation);
						if (
							themeData.gradientType &&
							themeData.gradientType !== untrack(gradientType)
						)
							setGradientType(themeData.gradientType as "linear" | "radial");
						if (
							themeData.gradientHarmony &&
							themeData.gradientHarmony !== untrack(gradientHarmony)
						)
							setGradientHarmony(themeData.gradientHarmony as GradientHarmony);
						if (
							themeData.borderWidth !== undefined &&
							themeData.borderWidth !== untrack(borderThickness)
						)
							setBorderThickness(themeData.borderWidth);
						if (
							themeData.backgroundOpacity !== undefined &&
							themeData.backgroundOpacity !== untrack(backgroundOpacity)
						)
							setBackgroundOpacity(themeData.backgroundOpacity);
						if (
							themeData.windowEffect &&
							themeData.windowEffect !== untrack(windowEffect)
						) {
							setWindowEffect(
								normalizeWindowEffectForCurrentOS(themeData.windowEffect),
							);
						}

						if (themeData.userVariables) {
							const currentVars = untrack(userVariablesSnapshot);
							const hasChanged =
								JSON.stringify(currentVars) !==
								JSON.stringify(themeData.userVariables);
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
		} catch (error) {
			console.error("Failed to load settings:", error);
		} finally {
			setLoading(false);
		}
	});

	onCleanup(() => {
		unsubscribeConfigUpdate?.();
	});

	const handlePresetSelect = async (id: string) => {
		const theme = getThemeById(id);
		if (theme) {
			const normalizedEffect =
				theme.windowEffect !== undefined
					? normalizeWindowEffectForCurrentOS(theme.windowEffect)
					: windowEffect();
			const finalHue =
				theme.allowHueChange === false
					? (theme.primaryHue ?? 180)
					: backgroundHue();

			batch(() => {
				setThemeId(id);
				setOpacity(theme.opacity ?? 0);
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

			// Save the entire theme state
			saveThemeUpdate({
				id: theme.id,
				author: theme.author,
				source: theme.source,
				primaryHue: finalHue,
				opacity: theme.opacity,
				style: theme.style,
				gradientEnabled: theme.gradientEnabled,
				rotation: theme.rotation,
				gradientType: theme.gradientType,
				gradientHarmony: theme.gradientHarmony,
				borderWidth: theme.borderWidth,
				backgroundOpacity: theme.backgroundOpacity,
				windowEffect: normalizedEffect,
				customCss: theme.customCss,
				variables: theme.variables,
				userVariables:
					theme.variables?.reduce<Record<string, ThemeVariableValue>>(
						(acc, variable) => {
							acc[variable.key] = variable.default;
							return acc;
						},
						{},
					) || {},
			});
		}
	};

	const handleHueChange = async (values: number[], live = false) => {
		const newHue = values[0];
		batch(() => {
			setBackgroundHue(newHue);
		});
		saveThemeUpdate({ primaryHue: newHue }, live);
	};

	const _handleStyleModeChange = async (mode: ThemeConfig["style"]) => {
		setOpacity(parseInt(mode || "0") || 0);
		saveThemeUpdate({ style: mode });
	};

	const handleOpacityChange = async (val: number[], live = false) => {
		const newOpacity = val[0];
		setOpacity(newOpacity);
		saveThemeUpdate({ opacity: newOpacity }, live);
	};

	const handleGradientToggle = async (enabled: boolean) => {
		setGradientEnabled(enabled);
		saveThemeUpdate({ gradientEnabled: enabled });
	};

	const handleRotationChange = async (values: number[], live = false) => {
		const newRotation = Math.round(values[0]);
		if (newRotation === rotation()) return;

		setRotation(newRotation);
		saveThemeUpdate({ rotation: newRotation }, live);
	};

	const handleBorderThicknessChange = async (
		values: number[],
		live = false,
	) => {
		const newThickness = values[0];
		if (newThickness === borderThickness()) return;

		batch(() => {
			setBorderThickness(newThickness);
		});
		saveThemeUpdate({ borderWidth: newThickness }, live);
	};
	const handleBackgroundOpacityChange = async (
		values: number[],
		live = false,
	) => {
		const newValue = values[0];
		if (newValue === backgroundOpacity()) return;

		batch(() => {
			setBackgroundOpacity(newValue);
		});
		saveThemeUpdate({ backgroundOpacity: newValue }, live);
	};

	const handleWindowEffectChange = async (val: string) => {
		const normalizedEffect = normalizeWindowEffectForCurrentOS(val);
		if (normalizedEffect === windowEffect()) return;

		batch(() => {
			setWindowEffect(normalizedEffect);
		});
		saveThemeUpdate({ windowEffect: normalizedEffect });
	};

	const handleGradientTypeChange = async (type: "linear" | "radial") => {
		if (type === gradientType()) return;

		setGradientType(type);
		saveThemeUpdate({ gradientType: type });
	};

	const handleGradientHarmonyChange = async (harmony: GradientHarmony) => {
		setGradientHarmony(harmony);
		saveThemeUpdate({ gradientHarmony: harmony });
	};

	const handleVariableChange = async (
		key: string,
		value: ThemeVariableValue,
		live = false,
	) => {
		const nextVariables = {
			...untrack(userVariablesSnapshot),
			[key]: value,
		};

		batch(() => {
			setUserVariables(reconcile(nextVariables));
		});

		saveThemeUpdate({ userVariables: nextVariables }, live);
	};

	const handleReducedMotionToggle = async (checked: boolean) => {
		setReducedMotion(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "reduced_motion",
				value: checked,
			});
		}
	};

	const handleDebugToggle = async (checked: boolean) => {
		console.log("Toggling debug logging:", checked);
		setDebugLogging(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "debug_logging",
				value: checked,
			});
		}
	};

	const handleAutoUpdateToggle = async (checked: boolean) => {
		setAutoUpdateEnabled(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "auto_update_enabled",
				value: checked,
			});
		}
	};

	const handleStartupCheckToggle = async (checked: boolean) => {
		setStartupCheckUpdates(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "startup_check_updates",
				value: checked,
			});
		}
	};

	const handleGpuToggle = async (checked: boolean) => {
		setUseDedicatedGpu(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "use_dedicated_gpu",
				value: checked,
			});
		}
	};

	const handleDiscordToggle = async (checked: boolean) => {
		setDiscordPresenceEnabled(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "discord_presence_enabled",
				value: checked,
			});
		}
	};

	const updateDefaultField = async (field: string, value: any) => {
		setInstanceDefaults((prev) => ({ ...prev, [field]: value }));
		if (hasTauriRuntime()) {
			await invoke("update_config_field", { field, value });
		}
	};

	const handleAutoInstallDepsToggle = async (checked: boolean) => {
		setAutoInstallDependencies(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "auto_install_dependencies",
				value: checked,
			});
		}
	};

	const handleOpenAppData = async () => {
		if (hasTauriRuntime()) {
			await invoke("open_app_config_dir");
		}
	};

	const saveThemeUpdate = async (
		overrides: Partial<ThemeConfig> = {},
		live = false,
	) => {
		if (!hasTauriRuntime()) return;

		// 1. Gather current UI state for the theme
		const activeHue = overrides.primaryHue ?? backgroundHue();
		const activeOpacity = overrides.opacity ?? opacity();
		const activeThemeId = overrides.id ?? themeId();
		const currentTheme = getThemeById(activeThemeId);
		const activeStyle = overrides.style ?? currentTheme?.style ?? "glass";
		const activeGradient = overrides.gradientEnabled ?? gradientEnabled();
		const activeRotation = overrides.rotation ?? rotation();
		const activeGType = overrides.gradientType ?? gradientType();
		const activeGHarmony = overrides.gradientHarmony ?? gradientHarmony();
		const activeBWidth = overrides.borderWidth ?? borderThickness();
		const activeBgOp = overrides.backgroundOpacity ?? backgroundOpacity();
		const activeWEffect = normalizeWindowEffectForCurrentOS(
			overrides.windowEffect ?? windowEffect(),
		);
		const activeUserVars = overrides.userVariables ?? userVariablesSnapshot();

		// 2. Map frontend terms to central store persistence terminology
		const persistenceData = {
			themeId: activeThemeId,
			themeName: overrides.name ?? currentTheme?.name,
			author: overrides.author ?? currentTheme?.author,
			description: overrides.description ?? currentTheme?.description,
			primaryHue: activeHue,
			opacity: activeOpacity,
			style: activeStyle,
			gradientEnabled: activeGradient,
			rotation: activeRotation,
			gradientType: activeGType,
			gradientHarmony: activeGHarmony,
			borderWidth: activeBWidth,
			backgroundOpacity: activeBgOp,
			windowEffect: activeWEffect,
			customCss: overrides.customCss ?? currentTheme?.customCss,
			variables: overrides.variables ?? currentTheme?.variables,
			userVariables: activeUserVars,
		};

		// 3. Update local cache (immediate UI feedback for CSS)
		applyTheme(
			validateTheme({
				...currentTheme,
				id: activeThemeId,
				primaryHue: activeHue,
				opacity: activeOpacity,
				style: activeStyle,
				gradientEnabled: activeGradient,
				rotation: activeRotation,
				gradientType: activeGType as any,
				gradientHarmony: activeGHarmony as any,
				borderWidth: activeBWidth,
				backgroundOpacity: activeBgOp,
				windowEffect: activeWEffect,
				userVariables: activeUserVars,
			}),
		);

		// 4. Persistence call (Debounced at 100ms through central system)
		if (!live) {
			debouncedPersistence(persistenceData);
		}
	};

	const handleClearCache = async () => {
		if (hasTauriRuntime()) {
			try {
				await invoke("clear_cache");
				refetchSize();
				showToast({
					title: "Cache Cleared",
					description:
						"All stored metadata and temporary files have been cleared.",
					severity: "success",
				});
			} catch (e) {
				console.error("Failed to clear cache:", e);
				showToast({
					title: "Clear Cache Failed",
					description: "Something went wrong while clearing the cache.",
					severity: "error",
				});
			}
		}
	};

	createEffect(() => {
		if (loading()) return;

		const id = themeId();
		const currentTheme = id ? getThemeById(id) : undefined;
		const activeUserVars = userVariablesSnapshot();
		if (currentTheme) {
			const themeToApply = validateTheme({
				...currentTheme,
				primaryHue: (backgroundHue() ?? currentTheme.primaryHue) as number,
				opacity: opacity() ?? currentTheme.opacity ?? 0,
				gradientEnabled: (gradientEnabled() ??
					currentTheme.gradientEnabled) as boolean,
				rotation: (rotation() ?? currentTheme.rotation) as number,
				gradientType: (gradientType() ?? currentTheme.gradientType) as
					| "linear"
					| "radial",
				gradientHarmony: (gradientHarmony() ??
					currentTheme.gradientHarmony) as GradientHarmony,
				borderWidth: borderThickness(),
				backgroundOpacity: backgroundOpacity(),
				windowEffect: windowEffect(),
				userVariables: activeUserVars,
			});
			applyTheme(themeToApply);
		}
	});

	createEffect(() => {
		if (loading()) return;

		const _root = document.documentElement;
	});

	const migrateToCustomTheme = async (fromTheme: ThemeConfig) => {
		const customTheme =
			getThemeById("custom") ||
			validateTheme({
				id: "custom",
				name: "Custom",
				source: "builtin",
				primaryHue: 220,
				opacity: 0,
				style: "glass",
				gradientEnabled: true,
				rotation: 135,
				gradientType: "linear",
				gradientHarmony: "none",
				borderWidth: 1,
			});

		const migratedEffect = normalizeWindowEffectForCurrentOS(
			fromTheme.windowEffect ?? customTheme.windowEffect,
		);

		batch(() => {
			setThemeId("custom");
			setBackgroundHue(fromTheme.primaryHue ?? customTheme.primaryHue);
			setOpacity(fromTheme.opacity ?? customTheme.opacity ?? 0);
			setGradientEnabled(
				fromTheme.gradientEnabled ?? customTheme.gradientEnabled,
			);
			setRotation(fromTheme.rotation ?? customTheme.rotation ?? 135);
			setGradientType(
				fromTheme.gradientType ?? customTheme.gradientType ?? "linear",
			);
			setGradientHarmony(
				fromTheme.gradientHarmony ?? customTheme.gradientHarmony ?? "none",
			);
			setBorderThickness(fromTheme.borderWidth ?? customTheme.borderWidth ?? 1);
			setBackgroundOpacity(
				fromTheme.backgroundOpacity ?? customTheme.backgroundOpacity ?? 25,
			);
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
			style: fromTheme.style ?? customTheme.style,
			gradientEnabled: fromTheme.gradientEnabled ?? customTheme.gradientEnabled,
			rotation: fromTheme.rotation ?? customTheme.rotation,
			gradientType: fromTheme.gradientType ?? customTheme.gradientType,
			gradientHarmony: fromTheme.gradientHarmony ?? customTheme.gradientHarmony,
			borderWidth: fromTheme.borderWidth ?? customTheme.borderWidth,
			backgroundOpacity:
				fromTheme.backgroundOpacity ?? customTheme.backgroundOpacity,
			windowEffect: migratedEffect,
			customCss: "",
			variables: customTheme.variables,
			userVariables: {},
		});
	};

	const handleDeleteImportedTheme = async (targetThemeId: string) => {
		const themeToDelete = themeCatalog().find(
			(theme) => theme.id === targetThemeId,
		);
		if (!themeToDelete) return;

		if (getThemeSource(themeToDelete) !== "imported") {
			return;
		}

		const confirmed = await dialogStore.confirm(
			"Delete Imported Theme",
			`Delete \"${themeToDelete.name}\" from your imported theme library?`,
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
				showToast({
					title: "Theme Deleted",
					description:
						"Active imported theme was removed. You have been switched to Custom with migrated settings.",
					severity: "info",
				});
			} else {
				showToast({
					title: "Theme Deleted",
					description: `${themeToDelete.name} was removed from your imported library.`,
					severity: "success",
				});
			}

			await refreshThemeCatalog();
		} catch (error) {
			console.error("Failed to delete imported theme:", error);
			dialogStore.alert(
				"Delete Failed",
				"Failed to delete the selected imported theme.",
				"error",
			);
		}
	};

	const handleExportTheme = async () => {
		try {
			if (!hasTauriRuntime()) {
				dialogStore.alert(
					"Platform Error",
					"Tauri runtime not found.",
					"error",
				);
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
			const author =
				activeAccount?.display_name || activeAccount?.username || "Anonymous";

			const customName = await dialogStore.prompt(
				"Theme Name",
				"Enter a name for your theme before exporting.",
				{ defaultValue: "My Custom Theme" },
			);

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
				dialogStore.alert(
					"Theme Exported",
					"Your theme has been exported successfully.",
					"success",
				);
			}
		} catch (e) {
			console.error("Failed to export theme", e);
			dialogStore.alert("Export Error", "Failed to export the theme.", "error");
		}
	};

	const handleImportTheme = async () => {
		try {
			if (!hasTauriRuntime()) {
				dialogStore.alert(
					"Platform Error",
					"Tauri runtime not found.",
					"error",
				);
				return;
			}

			const openPath = await openDialog({
				title: "Import Theme",
				filters: [{ name: "Vesta Theme", extensions: ["vestatheme", "json"] }],
				multiple: false,
			});
			if (!openPath) return;

			// openDialog with multiple: false returns string | null in v2 standard APIs,
			// though it might return string[]. we will safely cast.
			const resolvedPath = Array.isArray(openPath) ? openPath[0] : openPath;

			const result = await invoke<ThemeImportResponse>(
				"import_theme_from_file",
				{
					filePath: resolvedPath,
				},
			);

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
				setGradientEnabled(importedTheme.gradientEnabled);
				setRotation(importedTheme.rotation ?? 135);
				setGradientType(importedTheme.gradientType ?? "linear");
				setGradientHarmony(importedTheme.gradientHarmony ?? "none");
				setBorderThickness(importedTheme.borderWidth ?? 1);
				setBackgroundOpacity(importedTheme.backgroundOpacity ?? 25);
				setWindowEffect(
					normalizeWindowEffectForCurrentOS(importedTheme.windowEffect),
				);
				setUserVariables(reconcile(importedTheme.userVariables || {}));
			});

			await saveThemeUpdate({
				id: importedTheme.id,
				primaryHue: importedTheme.primaryHue,
				opacity: importedTheme.opacity,
				style: importedTheme.style,
				gradientEnabled: importedTheme.gradientEnabled,
				rotation: importedTheme.rotation,
				gradientType: importedTheme.gradientType,
				gradientHarmony: importedTheme.gradientHarmony,
				borderWidth: importedTheme.borderWidth,
				backgroundOpacity: importedTheme.backgroundOpacity,
				windowEffect: normalizeWindowEffectForCurrentOS(
					importedTheme.windowEffect,
				),
				customCss: importedTheme.customCss,
				variables: importedTheme.variables,
				userVariables: importedTheme.userVariables || {},
			});

			if (result.warnings && result.warnings.length > 0) {
				dialogStore.alert(
					"Theme Imported With Warnings",
					result.warnings.join("\n"),
					"warning",
				);
			} else {
				dialogStore.alert(
					"Theme Imported",
					"Theme imported and added to your library.",
					"success",
				);
			}
		} catch (e) {
			console.error("Failed to import theme", e);
			dialogStore.alert(
				"Import Error",
				"Failed to import the selected theme file.",
				"error",
			);
		}
	};

	return (
		<div class={styles["settings-page"]}>
			<Show
				when={!loading()}
				fallback={
					<div class={styles["settings-loading"]}>Loading settings...</div>
				}
			>
				<Tabs
					class={styles["settings-tabs"]}
					orientation={isDesktop() ? "vertical" : "horizontal"}
					value={selectedTab()}
					onChange={(v) => {
						setSelectedTab(v);
						activeRouter()?.updateQuery("activeTab", v, true);
					}}
				>
					<TabsList class={styles["tabs-list"]}>
						<TabsIndicator />
						<TabsTrigger class={styles["tabs-trigger"]} value="general">
							General
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="account">
							Account
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="appearance">
							Appearance
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="java">
							Java
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="notifications">
							Notifications
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="defaults">
							Defaults
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="developer">
							Developer
						</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="help">
							Help
						</TabsTrigger>
					</TabsList>

					<TabsContent class={styles["tabs-content"]} value="general">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									Loading General Settings...
								</div>
							}
						>
							<GeneralSettingsTab
								reducedMotion={reducedMotion()}
								handleReducedMotionToggle={handleReducedMotionToggle}
								discordPresenceEnabled={discordPresenceEnabled()}
								handleDiscordToggle={handleDiscordToggle}
								autoInstallDependencies={autoInstallDependencies()}
								handleAutoInstallDepsToggle={handleAutoInstallDepsToggle}
								maxDownloadThreads={maxDownloadThreads()}
								setMaxDownloadThreads={setMaxDownloadThreads}
								handleOpenAppData={handleOpenAppData}
								cacheSizeValue={cacheSizeValue() || "0 bytes"}
								handleClearCache={handleClearCache}
							/>
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="account">
						<AccountSettingsTab />
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="appearance">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									Loading Appearance...
								</div>
							}
						>
							<AppearanceSettingsTab
								themes={filteredThemeCatalog()}
								themeId={themeId()}
								themeSearchQuery={themeSearchQuery()}
								onThemeSearchQueryChange={setThemeSearchQuery}
								themeFilterMode={themeFilterMode()}
								onThemeFilterModeChange={setThemeFilterMode}
								themeViewMode={themeViewMode()}
								onThemeViewModeChange={setThemeViewMode}
								hasImportedThemes={hasImportedThemes()}
								handleDeleteTheme={handleDeleteImportedTheme}
								canExportTheme={themeId() === "custom"}
								handlePresetSelect={handlePresetSelect}
								canChangeHue={canChangeHue()}
								showAdvancedControls={showAdvancedControls()}
								backgroundHue={backgroundHue()}
								handleHueChange={handleHueChange}
								opacity={opacity()}
								handleOpacityChange={handleOpacityChange}
								gradientEnabled={gradientEnabled()}
								handleGradientToggle={handleGradientToggle}
								gradientType={gradientType()}
								handleGradientTypeChange={handleGradientTypeChange}
								rotation={rotation()}
								handleRotationChange={handleRotationChange}
								gradientHarmony={gradientHarmony()}
								handleGradientHarmonyChange={handleGradientHarmonyChange}
								borderThickness={borderThickness()}
								handleBorderThicknessChange={handleBorderThicknessChange}
								backgroundOpacity={backgroundOpacity()}
								handleBackgroundOpacityChange={handleBackgroundOpacityChange}
								windowEffect={windowEffect()}
								windowEffectOptions={windowEffectOptions()}
								handleWindowEffectChange={handleWindowEffectChange}
								handleImportTheme={handleImportTheme}
								handleExportTheme={handleExportTheme}
								themeVariables={
									themeId()
										? getThemeById(themeId())?.variables?.map((variable) => ({
												...variable,
												value:
													userVariablesSnapshot()[variable.key] ??
													variable.default,
											}))
										: []
								}
								handleVariableChange={handleVariableChange}
							/>
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="java">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									Loading Java Settings...
								</div>
							}
						>
							<JavaSettingsTab
								requirements={requirements() || []}
								javaOptions={javaOptions()}
								isScanning={isScanning()}
								refreshJavas={refreshJavas}
								useDedicatedGpu={useDedicatedGpu()}
								handleGpuToggle={handleGpuToggle}
							/>
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="notifications">
						<NotificationSettingsTab />
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="defaults">
						<InstanceDefaultsTab
							config={instanceDefaults()}
							updateConfig={updateDefaultField}
							totalRam={totalRam()}
						/>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="help">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>Loading...</div>
							}
						>
							<HelpSettingsTab
								close={props.close}
								navigate={(path: string) => activeRouter()?.navigate(path)}
								autoUpdateEnabled={autoUpdateEnabled()}
								handleAutoUpdateToggle={handleAutoUpdateToggle}
								startupCheckUpdates={startupCheckUpdates()}
								handleStartupCheckToggle={handleStartupCheckToggle}
								version={version() || "..."}
							/>
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="developer">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									Loading Developer Tools...
								</div>
							}
						>
							<DeveloperSettingsTab
								debugLogging={debugLogging()}
								handleDebugToggle={handleDebugToggle}
							/>
						</Suspense>
						<div class={styles["settings-tab-content"]}>
							<SettingsCard header="Navigation Test">
								<div style="display: flex; gap: 12px; flex-wrap: wrap;">
									<LauncherButton
										onClick={() => activeRouter()?.navigate("/install")}
									>
										Navigate to Install
									</LauncherButton>
									<LauncherButton
										onClick={() => activeRouter()?.navigate("/file-drop")}
									>
										Navigate to File Drop Test
									</LauncherButton>
									<LauncherButton
										onClick={() => activeRouter()?.navigate("/task-test")}
									>
										Navigate to Task System Test
									</LauncherButton>
									<LauncherButton
										onClick={() =>
											activeRouter()?.navigate("/notification-test")
										}
									>
										Navigate to Notification Test
									</LauncherButton>
								</div>
							</SettingsCard>
						</div>
					</TabsContent>
				</Tabs>
			</Show>
		</div>
	);
}

export default SettingsPage;
