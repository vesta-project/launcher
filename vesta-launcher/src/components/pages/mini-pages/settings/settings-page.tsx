import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { MiniRouter } from "@components/page-viewer/mini-router";
import { router, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import { SettingsCard, SettingsField } from "@components/settings";
import { dialogStore } from "@stores/dialog-store";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "@ui/badge";
import LauncherButton from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
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
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@ui/tabs/tabs";
import { showToast } from "@ui/toast/toast";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	currentThemeConfig,
	onConfigUpdate,
	updateThemeConfigLocal,
} from "@utils/config-sync";
import { openExternal } from "@utils/external-link";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { startAppTutorial } from "@utils/tutorial";
import { checkForAppUpdates, simulateUpdateProcess } from "@utils/updater";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	lazy,
	onCleanup,
	onMount,
	Show,
	Suspense,
	untrack,
} from "solid-js";
import {
	applyTheme,
	configToTheme,
	type GradientHarmony,
	getThemeById,
	PRESET_THEMES,
	type StyleMode,
	type ThemeConfig,
	validateTheme,
} from "../../../../themes/presets";
import { ThemePresetCard } from "../../../theme-preset-card/theme-preset-card";
import { InstanceDefaultsTab } from "./instance-defaults-tab";
import { type JavaOption, JavaOptionCard } from "./java-option-card";
import AccountSettingsTab from "./account-settings-tab";
import { NotificationSettingsTab } from "./notification-settings-tab";
import styles from "./settings-page.module.css";
import { NumberField, NumberFieldDecrementTrigger, NumberFieldGroup, NumberFieldIncrementTrigger, NumberFieldInput } from "@ui/number-field/number-field";
import {
	cacheSize,
	detectedJava,
	globalJavaPaths,
	javaRequirements,
	managedJava,
	systemMemory,
} from "@stores/settings-cache";

// Lazy-loaded tabs
const GeneralSettingsTab = lazy(() => import("./general-settings-tab").then(m => ({ default: m.GeneralSettingsTab })));
const AppearanceSettingsTab = lazy(() => import("./appearance-settings-tab").then(m => ({ default: m.AppearanceSettingsTab })));
const JavaSettingsTab = lazy(() => import("./java-settings-tab").then(m => ({ default: m.JavaSettingsTab })));
const HelpSettingsTab = lazy(() => import("./help-settings-tab").then(m => ({ default: m.HelpSettingsTab })));
const DeveloperSettingsTab = lazy(() => import("./developer-settings-tab").then(m => ({ default: m.DeveloperSettingsTab })));


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

/**
 * Settings Page
 */
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

	createEffect(() => {
		setSelectedTab(activeTab());
	});

	onMount(() => {
		// Register state for pop-out window handoff
		activeRouter()?.registerStateProvider("/config", () => ({
			activeTab: activeTab(),
		}));
	});

	const [backgroundHue, setBackgroundHue] = createSignal(
		currentThemeConfig.theme_primary_hue ??
			currentThemeConfig.background_hue ??
			220,
	);
	const [opacity, setOpacity] = createSignal<number>(parseInt(currentThemeConfig.theme_style || "0") || 0);
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
	const [borderThickness, setBorderThickness] = createSignal(
		currentThemeConfig.theme_border_width ?? 1,
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

				if (config.theme_style)
					setOpacity(parseInt(config.theme_style || "0") || 0);
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
				if (field === "theme_style" && value)
					setOpacity(parseInt(value || "0") || 0);
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
			setThemeId(id);
			setOpacity(theme.opacity ?? 0);
			setGradientEnabled(theme.gradientEnabled);
			setRotation(theme.rotation || 135);
			setGradientType(theme.gradientType || "linear");
			setGradientHarmony(theme.gradientHarmony || "none");
			if (theme.borderWidth !== undefined) {
				setBorderThickness(theme.borderWidth);
			}

			const newHue =
				theme.allowHueChange === false
					? (theme.primaryHue ?? 220)
					: backgroundHue();
			if (theme.primaryHue !== undefined && theme.allowHueChange === false) {
				setBackgroundHue(newHue);
			}

			// Update local config cache to prevent async updates from reverting state
			updateThemeConfigLocal("theme_id", id);
			updateThemeConfigLocal("theme_primary_hue", newHue);
			updateThemeConfigLocal("background_hue", newHue);
			updateThemeConfigLocal("theme_style", theme.style);
			updateThemeConfigLocal("theme_gradient_enabled", theme.gradientEnabled);
			updateThemeConfigLocal("theme_gradient_angle", theme.rotation ?? 135);
			updateThemeConfigLocal(
				"theme_gradient_type",
				theme.gradientType || "linear",
			);
			updateThemeConfigLocal(
				"theme_gradient_harmony",
				theme.gradientHarmony || "none",
			);
			if (theme.borderWidth !== undefined) {
				updateThemeConfigLocal("theme_border_width", theme.borderWidth);
			}

			if (hasTauriRuntime()) {
				try {
					const updates: any = {
						theme_id: id,
						theme_primary_hue: newHue,
						background_hue: newHue,
						theme_style: theme.style,
						theme_gradient_enabled: theme.gradientEnabled,
						theme_gradient_angle: theme.rotation ?? 135,
						theme_gradient_type: theme.gradientType || "linear",
						theme_gradient_harmony: theme.gradientHarmony || "none",
					};

					if (theme.borderWidth !== undefined) {
						updates.theme_border_width = theme.borderWidth;
					}

					await invoke("update_config_fields", {
						updates,
					});
				} catch (error) {
					console.error("Failed to save theme preset selection:", error);
				}
			}
		}
	};

	const handleHueChange = async (values: number[]) => {
		const newHue = values[0];
		setBackgroundHue(newHue);
		updateThemeConfigLocal("theme_primary_hue", newHue);
		updateThemeConfigLocal("background_hue", newHue);

		// Save immediately
		if (hasTauriRuntime()) {
			try {
				await invoke("update_config_fields", {
					updates: {
						theme_primary_hue: newHue,
						background_hue: newHue,
					},
				});
			} catch (error) {
				console.error("Failed to persist hue immediately:", error);
			}
		}
	};

	const handleStyleModeChange = async (mode: ThemeConfig["style"]) => {
		setOpacity(parseInt(mode || "0") || 0);
		updateThemeConfigLocal("theme_style", mode);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_style",
				value: mode,
			});
		}
	};

	const handleOpacityChange = (val: number[]) => { setOpacity(val[0]); updateThemeConfigLocal("theme_style", val[0].toString()); if (hasTauriRuntime()) { invoke("update_config_field", { field: "theme_style", value: val[0].toString() }); } };

	const handleGradientToggle = async (enabled: boolean) => {
		setGradientEnabled(enabled);
		updateThemeConfigLocal("theme_gradient_enabled", enabled);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_enabled",
				value: enabled,
			});
		}
	};

	const handleRotationChange = async (values: number[]) => {
		const newRotation = Math.round(values[0]);
		if (newRotation === rotation()) return;

		setRotation(newRotation);
		updateThemeConfigLocal("theme_gradient_angle", newRotation);

		// Save immediately
		if (hasTauriRuntime()) {
			try {
				await invoke("update_config_field", {
					field: "theme_gradient_angle",
					value: newRotation,
				});
			} catch (error) {
				console.error("Failed to persist rotation immediately:", error);
			}
		}
	};

	const handleBorderThicknessChange = async (values: number[]) => {
		const newThickness = values[0];
		if (newThickness === borderThickness()) return;

		setBorderThickness(newThickness);
		updateThemeConfigLocal("theme_border_width", newThickness);

		// Save immediately
		if (hasTauriRuntime()) {
			try {
				await invoke("update_config_field", {
					field: "theme_border_width",
					value: newThickness,
				});
			} catch (error) {
				console.error("Failed to persist border thickness immediately:", error);
			}
		}
	};

	const handleGradientTypeChange = async (type: "linear" | "radial") => {
		if (type === gradientType()) return;

		setGradientType(type);
		updateThemeConfigLocal("theme_gradient_type", type);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_type",
				value: type,
			});
		}
	};

	const handleGradientHarmonyChange = async (harmony: GradientHarmony) => {
		setGradientHarmony(harmony);
		updateThemeConfigLocal("theme_gradient_harmony", harmony);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_harmony",
				value: harmony,
			});
		}
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
			});
			applyTheme(themeToApply);
		}
	});

	createEffect(() => {
		if (loading()) return;

		const root = document.documentElement;
	});

	
	const handleExportTheme = async () => {
		try {
			if (!hasTauriRuntime()) {
				dialogStore.alert("Platform Error", "Tauri runtime not found.", "error"); return;
			}
			
			const themeClass = getThemeById(themeId()) || validateTheme({});
			// Generate the exported theme metadata
			const exported = {
				version: 1,
				type: "vesta-theme",
				theme: {
					id: themeClass.id,
					name: themeClass.name,
					primaryHue: themeClass.primaryHue,
					opacity: themeClass.opacity,
					style: themeClass.style,
					gradientEnabled: themeClass.gradientEnabled,
					rotation: themeClass.rotation,
					gradientType: themeClass.gradientType,
					gradientHarmony: themeClass.gradientHarmony,
					borderWidth: themeClass.borderWidth,
					customCss: themeClass.customCss
				}
			};

			const savePath = await saveDialog({
				title: "Export Theme",
				defaultPath: "my-theme.vestatheme",
				filters: [{ name: "Vesta Theme", extensions: ["vestatheme", "json"] }]
			});

			if (savePath) {
				await writeTextFile(savePath, JSON.stringify(exported, null, 2));
				dialogStore.alert("Theme Exported", "Your theme has been exported successfully.", "success");
			}
		} catch (e) {
			console.error("Failed to export theme", e);
			dialogStore.alert("Export Error", "Failed to export the theme.", "error");
		}
	};

	const handleImportTheme = async () => {
		try {
			if (!hasTauriRuntime()) {
				dialogStore.alert("Platform Error", "Tauri runtime not found.", "error"); return;
			}

			const openPath = await openDialog({
				title: "Import Theme",
				filters: [{ name: "Vesta Theme", extensions: ["vestatheme", "json"] }],
				multiple: false
			});
			if (!openPath) return;

			// openDialog with multiple: false returns string | null in v2 standard APIs, 
			// though it might return string[]. we will safely cast.
			const resolvedPath = Array.isArray(openPath) ? openPath[0] : openPath;

			const content = await readTextFile(resolvedPath);
			const parsed = JSON.parse(content);
			
			let importedConfig = parsed;
			if (parsed.type === "vesta-theme" && parsed.theme) {
				importedConfig = parsed.theme;
			}

			const safeTheme = validateTheme(importedConfig);
			
			// We override it as custom so that it doesn't just link to 'vesta' defaults if id overlaps.
			safeTheme.id = "custom";

			if (safeTheme.customCss?.length === 0 && importedConfig.customCss?.length > 0) {
				dialogStore.alert("Warning", "The theme imported contained unsafe CSS that was automatically purged.", "warning");
			}

			// Assign the Theme
			try {
				await invoke("update_config_fields", {
					updates: {
						theme_id: "custom",
						theme_primary_hue: safeTheme.primaryHue,
						theme_style: safeTheme.opacity?.toString() ?? "0",
						theme_gradient_enabled: safeTheme.gradientEnabled,
						theme_gradient_angle: safeTheme.rotation ?? 135,
						theme_gradient_type: safeTheme.gradientType ?? "linear",
						theme_gradient_harmony: safeTheme.gradientHarmony ?? "none",
						theme_border_width: safeTheme.borderWidth ?? 1,
						theme_advanced_overrides: safeTheme.customCss ?? ""
					}
				});

				updateThemeConfigLocal("theme_id", "custom");
				updateThemeConfigLocal("theme_primary_hue", safeTheme.primaryHue);
				updateThemeConfigLocal("theme_style", safeTheme.opacity?.toString() ?? "0");
				updateThemeConfigLocal("theme_gradient_enabled", safeTheme.gradientEnabled);
				updateThemeConfigLocal("theme_gradient_angle", safeTheme.rotation ?? 135);
				updateThemeConfigLocal("theme_gradient_type", safeTheme.gradientType ?? "linear");
				updateThemeConfigLocal("theme_gradient_harmony", safeTheme.gradientHarmony ?? "none");
				updateThemeConfigLocal("theme_border_width", safeTheme.borderWidth ?? 1);
				updateThemeConfigLocal("theme_advanced_overrides", safeTheme.customCss ?? "");

				// Update Local UI signals
				setThemeId("custom");
				setBackgroundHue(safeTheme.primaryHue);
				setOpacity(safeTheme.opacity ?? 0);
				setGradientEnabled(safeTheme.gradientEnabled);
				setRotation(safeTheme.rotation ?? 135);
				setGradientType(safeTheme.gradientType ?? "linear");
				setGradientHarmony(safeTheme.gradientHarmony as any);
				setBorderThickness(safeTheme.borderWidth ?? 1);

				dialogStore.alert("Theme Imported", "Custom theme successfully loaded.", "success");
			} catch (err: any) {
				console.error("Theme Import error", err);
				dialogStore.alert("Import Error", "Failed to update configs: " + String(err), "error");
			}

		} catch (e) {
			console.error("Failed to import theme", e);
			dialogStore.alert("Import Error", "Failed to read or parse the theme file.", "error");
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
						<Suspense fallback={<div class={styles["settings-tab-loading"]}>Loading General Settings...</div>}>
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
						<Suspense fallback={<div class={styles["settings-tab-loading"]}>Loading Appearance...</div>}>
							<AppearanceSettingsTab
								PRESET_THEMES={PRESET_THEMES}
								themeId={themeId()}
								handlePresetSelect={handlePresetSelect}
								canChangeHue={canChangeHue()}
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
																		handleExportTheme={handleExportTheme}
																		handleImportTheme={handleImportTheme}
							/>
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="java">
						<Suspense fallback={<div class={styles["settings-tab-loading"]}>Loading Java Settings...</div>}>
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
						<Suspense fallback={<div class={styles["settings-tab-loading"]}>Loading...</div>}>
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
						<Suspense fallback={<div class={styles["settings-tab-loading"]}>Loading Developer Tools...</div>}>
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
