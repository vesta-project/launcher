import { router } from "@components/page-viewer/page-viewer";
import { MiniRouter } from "@components/page-viewer/mini-router";
import { dialogStore } from "@stores/dialog-store";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import LauncherButton from "@ui/button/button";
import { Badge } from "@ui/badge";
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
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import {
	onConfigUpdate,
	updateThemeConfigLocal,
	currentThemeConfig,
} from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { showToast } from "@ui/toast/toast";
import { openExternal } from "@utils/external-link";
import { startAppTutorial } from "@utils/tutorial";
import { checkForAppUpdates, simulateUpdateProcess } from "@utils/updater";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
	untrack,
} from "solid-js";
import {
	applyTheme,
	configToTheme,
	getThemeById,
	PRESET_THEMES,
	type ThemeConfig,
	validateTheme,
	type StyleMode,
	type GradientHarmony,
} from "../../../../themes/presets";
import { ThemePresetCard } from "../../../theme-preset-card/theme-preset-card";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { SettingsCard, SettingsField } from "@components/settings";
import { Separator } from "@ui/separator/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import styles from "./settings-page.module.css";
import { JavaOptionCard, type JavaOption } from "./java-option-card";

interface AppConfig {
	id: number;
	background_hue: number;
	theme: string;
	language: string;
	max_download_threads: number;
	max_memory_mb: number;
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
	[key: string]: any;
}

/**
 * Settings Page
 */
function SettingsPage(props: { close?: () => void, router?: MiniRouter }) {
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
	const [discordPresenceEnabled, setDiscordPresenceEnabled] = createSignal(true);
	const [selectedTab, setSelectedTab] = createSignal(activeTab());
	const [isDesktop, setIsDesktop] = createSignal(window.innerWidth >= 800);

	createEffect(() => {
		setSelectedTab(activeTab());
	});

	onMount(() => {
		// Register state for pop-out window handoff
		activeRouter()?.registerStateProvider("/config", () => ({
			activeTab: activeTab(),
		}));
	});

	// Initialize from global theme cache to prevent "Midnight Blue" flash
	const [backgroundHue, setBackgroundHue] = createSignal(
		currentThemeConfig.theme_primary_hue ??
			currentThemeConfig.background_hue ??
			220,
	);
	const [styleMode, setStyleMode] = createSignal<ThemeConfig["style"]>(
		(currentThemeConfig.theme_style as ThemeConfig["style"]) ?? "glass",
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
		currentThemeConfig.theme_id ?? "midnight",
	);
	const [borderThickness, setBorderThickness] = createSignal(
		currentThemeConfig.theme_border_width ?? 1,
	);

	const [loading, setLoading] = createSignal(true);
	const [reducedMotion, setReducedMotion] = createSignal(false);
	const [requirements] = createResource<any[]>(() =>
		hasTauriRuntime()
			? invoke("get_required_java_versions")
			: Promise.resolve([]),
	);
	const [detected, { refetch: refetchDetected }] = createResource<any[]>(() =>
		hasTauriRuntime() ? invoke("detect_java") : Promise.resolve([]),
	);
	const [managed, { refetch: refetchManaged }] = createResource<any[]>(() =>
		hasTauriRuntime() ? invoke("get_managed_javas") : Promise.resolve([]),
	);
	const [globalPaths, { refetch: refetchGlobalPaths }] = createResource<any[]>(
		() =>
			hasTauriRuntime() ? invoke("get_global_java_paths") : Promise.resolve([]),
	);

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
				type: 'managed',
				version: req.major_version,
				title: 'Managed Runtime',
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
						type: 'system',
						version: req.major_version,
						title: 'System Runtime',
						path: det.path,
						isActive: current?.path === det.path && !current?.is_managed,
						onClick: () => handleSetGlobalPath(req.major_version, det.path, false),
					});
				});

			// Custom active path (if not in detected list)
			if (
				current &&
				!current.is_managed &&
				!detectedJavas.some(
					(d: any) =>
						d.path === current.path &&
						d.major_version === req.major_version,
				)
			) {
				options.push({
					type: 'custom',
					version: req.major_version,
					title: 'Custom Path',
					path: current.path,
					isActive: true,
					onClick: () => handleManualPickSetGlobal(req.major_version),
				});
			}

			// Browse option
			options.push({
				type: 'browse',
				version: req.major_version,
				title: '+ Browse...',
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
				severity: "Info",
			});
		} catch (e) {
			console.error("Failed to download managed java:", e);
			showToast({
				title: "Download Failed",
				description: "Failed to initiate Java download.",
				severity: "Error",
			});
		}
	};

	const handleManualPickSetGlobal = async (version: number) => {
		try {
			const path = await invoke<string | null>("pick_java_path");
			if (path) {
				const info = await invoke<any>("verify_java_path", { pathStr: path });
				if (info.major_version !== version) {
					await dialogStore.alert(
						"Invalid Java Version",
						`Selected Java is version ${info.major_version}, but ${version} is required.`,
						"error"
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
					setStyleMode(config.theme_style as ThemeConfig["style"]);
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
				if (field === "discord_presence_enabled") setDiscordPresenceEnabled(value ?? true);
				if (field === "reduced_motion") setReducedMotion(value ?? false);
				if (field === "theme_id" && value) setThemeId(value);
				if (field === "theme_primary_hue" && value !== null)
					setBackgroundHue(value);
				if (field === "theme_style" && value)
					setStyleMode(value as ThemeConfig["style"]);
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
			setStyleMode(theme.style);
			setGradientEnabled(theme.gradientEnabled);
			setRotation(theme.rotation || 135);
			setGradientType(theme.gradientType || "linear");
			setGradientHarmony(theme.gradientHarmony || "none");
			if (theme.borderWidthSubtle !== undefined) {
				setBorderThickness(theme.borderWidthSubtle);
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
			if (theme.borderWidthSubtle !== undefined) {
				updateThemeConfigLocal("theme_border_width", theme.borderWidthSubtle);
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

					if (theme.borderWidthSubtle !== undefined) {
						updates.theme_border_width = theme.borderWidthSubtle;
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
		setStyleMode(mode);
		updateThemeConfigLocal("theme_style", mode);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_style",
				value: mode,
			});
		}
	};

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

	const handleOpenAppData = async () => {
		if (hasTauriRuntime()) {
			await invoke("open_app_config_dir");
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
				style: (styleMode() ?? currentTheme.style) as ThemeConfig["style"],
				gradientEnabled: (gradientEnabled() ??
					currentTheme.gradientEnabled) as boolean,
				rotation: (rotation() ?? currentTheme.rotation) as number,
				gradientType: (gradientType() ?? currentTheme.gradientType) as
					| "linear"
					| "radial",
				gradientHarmony: (gradientHarmony() ??
					currentTheme.gradientHarmony) as GradientHarmony,
				borderWidthSubtle: borderThickness(),
				borderWidthStrong: Math.max(borderThickness() + 1, 1),
			});
			applyTheme(themeToApply);
		}
	});

	createEffect(() => {
		if (loading()) return;

		const root = document.documentElement;
		if (styleMode() === "bordered") {
			root.style.setProperty("--border-width-subtle", `${borderThickness()}px`);
			root.style.setProperty(
				"--border-width-strong",
				`${Math.max(borderThickness() + 1, 1)}px`,
			);
		} else {
			root.style.setProperty("--border-width-subtle", "1px");
			root.style.setProperty("--border-width-strong", "1px");
		}
	});

	return (
		<div class={styles["settings-page"]}>
			<Show
				when={!loading()}
				fallback={<div class={styles["settings-loading"]}>Loading settings...</div>}
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
						<TabsTrigger class={styles["tabs-trigger"]} value="general">General</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="appearance">Appearance</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="java">Java</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="defaults">Defaults</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="developer">Developer</TabsTrigger>
						<TabsTrigger class={styles["tabs-trigger"]} value="help">Help</TabsTrigger>
					</TabsList>

					<TabsContent class={styles["tabs-content"]} value="general">
						<div class={styles["settings-tab-content"]}>
							<SettingsCard header="Accessibility">
								<SettingsField
									label="Reduced Motion"
									description="Disable UI animations for a faster and cleaner experience."
									layout="inline"
									control={
							<Switch checked={reducedMotion()} onCheckedChange={handleReducedMotionToggle}>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
						/>
					</SettingsCard>

					<SettingsCard header="Privacy & Integration">
						<SettingsField
							label="Discord Rich Presence"
							description="Show your current game and status on Discord."
							layout="inline"
							control={
								<Switch checked={discordPresenceEnabled()} onCheckedChange={handleDiscordToggle}>
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
								</Switch>
							}
						/>
					</SettingsCard>

					<SettingsCard header="Application Data">
						<SettingsField
									label="AppData Directory"
									description="Open the folder where Vesta Launcher stores its data."
									actionLabel="Open Folder"
									onAction={handleOpenAppData}
								/>
							</SettingsCard>

							<SettingsCard header="Troubleshooting">
								<SettingsField
									label="Reset Onboarding"
									description="Redo the first-time setup process. This will not delete your accounts or instances."
									actionLabel="Redo Setup"
									destructive
									confirmationDesc="Are you sure you want to redo the onboarding process? You will be taken back to the welcome screen."
									onAction={async () => {
										try {
											await invoke("reset_onboarding");
											window.location.href = "/"; // Force reload to root
										} catch (e) {
											console.error("Failed to reset onboarding:", e);
										}
									}}
								/>
							</SettingsCard>
						</div>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="appearance">
						<div class={styles["settings-tab-content"]}>
							<section class={styles["settings-section"]}>
								<h2>Theme Presets</h2>
								<p class={styles["section-description"]}>
									Choose a pre-designed theme or create your own custom look.
								</p>
								<div class={styles["theme-preset-grid"]}>
									<For each={PRESET_THEMES}>
										{(theme) => (
											<ThemePresetCard
												theme={theme}
												isSelected={themeId() === theme.id}
												onClick={() => handlePresetSelect(theme.id)}
											/>
										)}
									</For>
								</div>
							</section>

							<Show when={canChangeHue()}>
								<SettingsCard
									header="Customize Colors"
									subHeader="Adjust the primary color hue to personalize your theme."
								>
									<SettingsField
										label="Primary Hue"
										description="The base color used for accents and backgrounds"
										layout="stack"
										control={
											<div class={styles["hue-customization"]} style={{ width: "100%" }}>
												<Slider
													value={[backgroundHue()]}
													onChange={handleHueChange}
													minValue={0}
													maxValue={360}
													step={1}
													class={styles["slider--hue"]}
												>
													<div class={styles["slider__header"]}>
														<div class={styles["slider__value-label"]}>
															{backgroundHue()}°
														</div>
													</div>
													<SliderTrack class={styles["slider-track-hue"]}>
														<SliderFill />
														<SliderThumb />
													</SliderTrack>
												</Slider>
											</div>
										}
									/>
								</SettingsCard>
							</Show>

							<Show when={themeId() === "custom"}>
								<SettingsCard
									header="Advanced Style"
									subHeader="Fine-tune the visual style and effects."
								>
									<SettingsField
										label="Style Mode"
										description="Choose the visual depth and transparency effects"
										layout="inline"
										control={
											<ToggleGroup
												value={styleMode() ?? "glass"}
												onChange={(val) => {
													if (val)
														handleStyleModeChange(val as ThemeConfig["style"]);
												}}
											>
												<ToggleGroupItem value="glass">Glass</ToggleGroupItem>
												<ToggleGroupItem value="satin">Satin</ToggleGroupItem>
												<ToggleGroupItem value="flat">Flat</ToggleGroupItem>
												<ToggleGroupItem value="bordered">
													Bordered
												</ToggleGroupItem>
												<ToggleGroupItem value="solid">Solid</ToggleGroupItem>
											</ToggleGroup>
										}
									/>

									<SettingsField
										label="Background Gradient"
										description="Enable animated background gradient"
										control={
						<Switch checked={gradientEnabled() ?? false} onCheckedChange={handleGradientToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
						}
						/>
						<Show when={gradientEnabled()}>
										<SettingsField
											label="Gradient Type"
											description="Linear or circular background"
											layout="inline"
											control={
												<ToggleGroup
													value={gradientType() ?? "linear"}
													onChange={(val) => {
														if (val)
															handleGradientTypeChange(
																val as "linear" | "radial",
															);
													}}
												>
													<ToggleGroupItem value="linear">Linear</ToggleGroupItem>
													<ToggleGroupItem value="radial">
														Circular
													</ToggleGroupItem>
												</ToggleGroup>
											}
										/>

										<SettingsField
											label="Rotation"
											description="Angle of the background gradient"
											layout="stack"
											control={
												<div style={{ width: "100%" }}>
													<Slider
														value={[rotation() ?? 135]}
														onChange={handleRotationChange}
														minValue={0}
														maxValue={360}
														step={1}
														class={styles["slider--angle"]}
													>
														<div class={styles["slider__header"]}>
															<div class={styles["slider__value-label"]}>{rotation()}°</div>
														</div>
														<SliderTrack>
															<SliderFill />
															<SliderThumb />
														</SliderTrack>
													</Slider>
												</div>
											}
										/>

										<SettingsField
											label="Color Harmony"
											description="Choose how secondary colors are generated"
											helpTopic="GRADIENT_HARMONY"
											layout="inline"
											control={
												<ToggleGroup
													value={gradientHarmony() ?? "none"}
													onChange={(val) => {
														if (val)
															handleGradientHarmonyChange(val as GradientHarmony);
													}}
												>
													<ToggleGroupItem value="none">None</ToggleGroupItem>
													<ToggleGroupItem value="analogous">
														Analogous
													</ToggleGroupItem>
													<ToggleGroupItem value="complementary">
														Complementary
													</ToggleGroupItem>
													<ToggleGroupItem value="triadic">
														Triadic
													</ToggleGroupItem>
												</ToggleGroup>
											}
										/>
									</Show>

									<Show when={styleMode() === "bordered"}>
										<SettingsField
											label="Border Thickness"
											description="Width of the element borders in pixels"
											layout="stack"
											control={
												<div style={{ width: "100%" }}>
													<Slider
														value={[borderThickness()]}
														onChange={handleBorderThicknessChange}
														minValue={0}
														maxValue={4}
														step={1}
														class={styles["slider--border"]}
													>
														<div class={styles["slider__header"]}>
															<div class={styles["slider__value-label"]}>
																{borderThickness()}px
															</div>
														</div>
														<SliderTrack>
															<SliderFill />
															<SliderThumb />
														</SliderTrack>
													</Slider>
												</div>
											}
										/>
									</Show>
								</SettingsCard>
							</Show>
						</div>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="java">
						<div class={styles["settings-tab-content"]}>
							<SettingsCard
								header="Java Environments"
								subHeader="Global defaults for each Java version. Instances follow these by default."
								helpTopic="JAVA_MANAGED"
							>
								<div class={styles["section-actions"]} style={{ "margin-bottom": "16px" }}>
									<LauncherButton
										onClick={refreshJavas}
										disabled={isScanning()}
										variant="ghost"
										size="sm"
									>
										{isScanning() ? "Scanning..." : "Rescan System"}
									</LauncherButton>
								</div>

								<div class={styles["java-requirements-list"]}>
									<For each={requirements()}>
										{(req: any) => {
											const versionOptions = () =>
												javaOptions().filter(option => option.version === req.major_version);

											return (
												<div class={styles["java-req-item"]}>
													<div class={styles["java-req-header"]}>
														<h3>{req.recommended_name}</h3>
													</div>

													<div class={styles["java-options-grid"]}>
														<For each={versionOptions()}>
															{(option) => <JavaOptionCard option={option} />}
														</For>
													</div>
												</div>
											);
										}}
									</For>
								</div>
							</SettingsCard>

							<SettingsCard
								header="Performance & Graphics"
								subHeader="Optimization settings for game performance."
							>
								<SettingsField
									label="Use Dedicated GPU"
									description="Attempt to force Minecraft to use your high-performance graphics card (NVIDIA/AMD)."
									layout="inline"
									control={
										<Switch
											checked={useDedicatedGpu()}
											onCheckedChange={handleGpuToggle}
										>
											<SwitchControl>
												<SwitchThumb />
											</SwitchControl>
										</Switch>
									}
								/>
							</SettingsCard>
						</div>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="help">
						<div class={styles["settings-tab-content"]}>
							<SettingsCard header="Minecraft Modding">
								<SettingsField
									label="Documentation"
									description="Technical overview of modding frameworks, runtime environments, and configuration."
									control={
										<LauncherButton
											onClick={() => activeRouter()?.navigate("/modding-guide")}
										>
											View Docs
										</LauncherButton>
									}
								/>
							</SettingsCard>

							<SettingsCard header="App Tutorial">
								<SettingsField
									label="Platform Walkthrough"
									description="Initiate the interactive walkthrough to familiarize yourself with Vesta's interface."
									control={
										<LauncherButton
											onClick={() => {
												props.close?.();
												setTimeout(() => startAppTutorial(), 100);
											}}
										>
											Run Tutorial
										</LauncherButton>
									}
								/>
							</SettingsCard>

							<SettingsCard header="Support">
								<div class={styles["social-links"]} style={{ display: "flex", gap: "8px" }}>
									<LauncherButton
										variant="ghost"
										onClick={() =>
											openExternal("https://github.com/vesta-project/launcher")
										}
									>
										GitHub
									</LauncherButton>
									<LauncherButton
										variant="ghost"
										onClick={() =>
											openExternal("https://discord.gg/zuDNHNHk8E")
										}
									>
										Discord
									</LauncherButton>
								</div>
							</SettingsCard>

							<SettingsCard header="App Updates">
								<SettingsField
									label="Automatic Updates"
									description="Download and install updates automatically in the background"
									control={
							<Switch checked={autoUpdateEnabled()} onCheckedChange={handleAutoUpdateToggle}>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label="Check on Startup"
						description="Check for new versions when the launcher starts"
						control={
							<Switch checked={startupCheckUpdates()} onCheckedChange={handleStartupCheckToggle}>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label="Update Check"
						control={
							<LauncherButton onClick={() => checkForAppUpdates()}>
								Check Now
							</LauncherButton>
						}
					/>
							</SettingsCard>

							<SettingsCard header="About">
								<div class={styles["about-info"]}>
									<div class={styles["about-field"]}>
										<span>App Version</span>
										<span>{version() || "..."}</span>
									</div>
									<div class={styles["about-field"]}>
										<span>Platform</span>
										<span>Tauri + SolidJS</span>
									</div>
									<div class={styles["about-field"]}>
										<span>License</span>
										<span>MIT License</span>
									</div>
								</div>
							</SettingsCard>
						</div>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="defaults">
						<div class={styles["settings-tab-content"]}>
							<SettingsCard
								header="Instance Defaults"
								subHeader="Default settings for new instances."
							>
								<div class={styles["settings-placeholder"]}>
									<p>
										Coming soon: Default Java paths, memory settings, and more.
									</p>
								</div>
							</SettingsCard>
						</div>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="developer">
						<div class={styles["settings-tab-content"]}>
							<SettingsCard header="Debug Settings">
								<SettingsField
									label="Debug Logging"
									description="Enable verbose logging for troubleshooting"
									control={
										<Switch
											checked={debugLogging()}
											onCheckedChange={handleDebugToggle}
										>
											<SwitchControl>
												<SwitchThumb />
											</SwitchControl>
										</Switch>
									}
								/>
								
							</SettingsCard>

							<SettingsCard header="Updater Simulation">
								<SettingsField
									label="Simulate App Update"
									description="Trigger a full update flow simulation (Toast -> Progress -> Ready)"
									control={
										<LauncherButton
											onClick={() => simulateUpdateProcess()}
										>
											Simulate Full Update
										</LauncherButton>
									}
								/>
								<SettingsField
									label="Simulate Discovery"
									description="Trigger only the 'Update Available' notification (Native Notification)"
									control={
										<LauncherButton
											onClick={async () => {
												const actions = [
													{
														id: "open_update_dialog",
														label: "Update Now",
														type: "primary",
													},
												];
												await invoke("create_notification", {
													payload: {
														client_key: "app_update_available",
														title: "Update Available (Simulated)",
														description: "Vesta Launcher v9.9.9 is now available!",
														severity: "info",
														notification_type: "patient",
														dismissible: true,
														actions: JSON.stringify(actions),
													},
												});
											}}
										>
											Simulate Discovery
										</LauncherButton>
									}
								/>
							</SettingsCard>

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
										onClick={() => activeRouter()?.navigate("/notification-test")}
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

