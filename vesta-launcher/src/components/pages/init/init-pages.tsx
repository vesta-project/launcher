import { useNavigate, NavigateOptions } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "@ui/button/button";
import {
	Slider,
	SliderFill,
	SliderLabel,
	SliderThumb,
	SliderTrack,
	SliderValueLabel,
} from "@ui/slider/slider";
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
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { startAppTutorial } from "@utils/tutorial";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import {
	applyTheme,
	getThemeById,
	PRESET_THEMES,
	ThemeConfig,
} from "../../../themes/presets";
import { ThemePresetCard } from "../../theme-preset-card/theme-preset-card";
import { updateThemeConfigLocal, currentThemeConfig } from "../../../utils/config-sync";
import { ModdingGuideContent } from "../mini-pages/modding-guide/guide";
import { HelpTrigger } from "../../ui/help-trigger";
import {
	createInstance,
	DEFAULT_ICONS,
	getMinecraftVersions,
	installInstance,
	type CreateInstanceData,
	type Instance,
	type PistonMetadata,
} from "@utils/instances";

interface JavaRequirement {
	major_version: number;
	recommended_name: string;
	is_required_for_latest: boolean;
}

interface DetectedJava {
	path: string;
	major_version: number;
	is_64bit: boolean;
}

interface InitPagesProps {
	initStep: number;
	changeInitStep: (n: number) => void;
	navigate?: (to: string, options?: Partial<NavigateOptions>) => void;
	isLoginOnly?: boolean;
	hasInstalledInstance?: boolean;
	onInstanceInstalled?: () => void;
}

function InitFirstPage(props: InitPagesProps) {
	return (
		<>
			<div class={"init-page__top"} style={{ "text-align": "center", "margin-bottom": "3vh", "flex-shrink": 0 }}>
				<h1 class="init-page__header-title" style={{ "font-size": "clamp(32px, 5vh, 48px)", "font-weight": "800", "letter-spacing": "-2px", "margin": 0, "background": "linear-gradient(135deg, white 0%, rgba(255,255,255,0.6) 100%)", "-webkit-background-clip": "text", "-webkit-text-fill-color": "transparent" }}>Welcome to Vesta</h1>
				<p style={{ "opacity": 0.5, "font-size": "clamp(14px, 2vh, 18px)", "font-weight": "500", "margin-top": "8px", "letter-spacing": "0.5px" }}>Your journey into effortless modding starts here.</p>
			</div>
			<div class={"init-page__middle"} style={{ "display": "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", "gap": "min(4vh, 32px)", "padding": "1vh 0", "min-height": 0, "overflow": "hidden" }}>
				<div style={{ "position": "relative", "display": "flex", "align-items": "center", "justify-content": "center", "width": "min(20vh, 180px)", "height": "min(20vh, 180px)", "flex-shrink": 0 }}>
					<div class="welcome-flare__glow" />
					<div class="welcome-flare__icon">🚀</div>
				</div>
				<p style={{ "max-width": "520px", "opacity": 0.8, "line-height": "1.7", "font-size": "clamp(13px, 1.8vh, 16px)", "text-align": "center", "margin": 0 }}>
					Vesta is designed to be the most capable, yet simplest way to play Minecraft. 
					We've handled the technical hurdles so you can get straight to the game.
				</p>
			</div>
			<div class={"init-page__bottom"} style={{ "display": "flex", "flex-direction": "column", "align-items": "center", "gap": "1.5vh", "margin-top": "auto", "padding-top": "2vh", "flex-shrink": 0 }}>
				<Button 
					color="primary" 
					onClick={() => props.changeInitStep(2)} // Skip guide (Step 1) and go to Login (Step 2)
					style={{ "width": "clamp(240px, 40%, 320px)", "height": "clamp(44px, 6vh, 54px)", "font-size": "clamp(14px, 2vh, 18px)", "font-weight": "700", "border-radius": "12px", "box-shadow": "0 10px 20px -5px hsla(var(--accent-base) / 0.3)" }}
				>
					Start Setup
				</Button>
				<Button 
					variant="ghost" 
					onClick={() => props.changeInitStep(1)} // Go to Guide (Step 1)
					style={{ "opacity": 0.6, "font-size": "clamp(12px, 1.5vh, 14px)" }}
				>
					Wait, what does this all mean?
				</Button>
			</div>
		</>
	);
}

function InitGuidePage(props: InitPagesProps) {
	return (
		<>
			<div class={"init-page__top"} style={{ "text-align": "left", "margin-bottom": "12px", "width": "100%" }}>
				<h1 style={"font-size: 28px; font-weight: 800; color: var(--primary); text-align: left;"}>Modding Knowledge Base</h1>
				<p style={"opacity: 0.7; text-align: left;"}>A quick overview of how everything works together.</p>
			</div>
			<div class={"init-page__middle"} style={{ "overflow-y": "auto", "padding-right": "8px", "text-align": "left" }}>
				<ModdingGuideContent />
			</div>
			<div class={"init-page__bottom"} style={{ "margin-top": "20px" }}>
				<Button 
					color="primary" 
					onClick={() => props.changeInitStep(2)} // Move to Login
					style={{ "min-width": "200px" }}
				>
					Got it, let's continue
				</Button>
			</div>
		</>
	);
}

function InitDataStoragePage(props: InitPagesProps) {
	const [installDir, setInstallDir] = createSignal<string>("");
	const [copied, setCopied] = createSignal(false);

	onMount(async () => {
		try {
			const config = await invoke<any>("get_config");
			if (config.default_game_dir) {
				setInstallDir(config.default_game_dir);
			} else {
				const defaultDir = await invoke<string>("get_default_instance_dir");
				setInstallDir(defaultDir);
			}
		} catch (e) {
			console.error("Failed to get installation dir:", e);
		}
	});

	const handlePickFolder = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				defaultPath: installDir(),
			});

			if (selected && typeof selected === "string") {
				setInstallDir(selected);
			}
		} catch (e) {
			console.error("Failed to pick folder:", e);
		}
	};

	const handleResetDefault = async () => {
		try {
			const defaultDir = await invoke<string>("get_default_instance_dir");
			setInstallDir(defaultDir);
		} catch (e) {
			console.error("Failed to reset to default:", e);
		}
	};

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(installDir());
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (e) {
			console.error("Failed to copy path:", e);
		}
	};

	const handleNext = async () => {
		try {
			await invoke("update_config_field", {
				field: "default_game_dir",
				value: installDir(),
			});
			props.changeInitStep(props.initStep + 1);
		} catch (e) {
			console.error("Failed to save installation dir:", e);
		}
	};

	return (
		<>
			<div class={"init-page__top"} style={{ "text-align": "left" }}>
				<h1 style={{ "font-size": "24px", "font-weight": "800", "opacity": 0.9, "color": "var(--text-primary)" }}>Data Storage</h1>
				<p style={{ "font-size": "14px", "opacity": 0.6, "color": "var(--text-primary)" }}>Choose where Vesta should store your Minecraft instances and data.</p>
			</div>
			
			<div class={"init-page__middle"} style={{
				"display": "flex",
				"flex-direction": "column",
				"gap": "20px",
				"align-items": "center",
				"justify-content": "center",
				"height": "100%"
			}}>
				<div style={{
					"background": "var(--surface-raised)",
					"padding": "24px",
					"border-radius": "16px",
					"border": "var(--border-width-subtle) solid var(--border-subtle)",
					"width": "100%"
				}}>
					<div style={{ "display": "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
						<label style={{ "font-size": "12px", "font-weight": "600", "opacity": 0.5, "text-transform": "uppercase", "color": "var(--text-primary)" }}>
							Installation Directory
						</label>
						<Button 
							variant="ghost" 
							size="sm" 
							style={{ "font-size": "10px", "height": "20px", "padding": "0 8px", "color": "var(--text-primary)" }}
							onClick={handleResetDefault}
						>
							Reset to Default
						</Button>
					</div>
					<div style={{
						"display": "flex",
						"gap": "10px",
						"align-items": "center"
					}}>
						<div 
							style={{
								"flex": 1,
								"position": "relative",
								"display": "flex",
								"align-items": "center"
							}}
						>
							<input
								type="text"
								value={installDir()}
								readOnly
								title="Click to copy path"
								onClick={handleCopy}
								style={{
									"width": "100%",
									"padding": "12px 60px 12px 12px",
									"background": "var(--surface-sunken)",
									"border-radius": "8px",
									"border": "1px solid var(--border-subtle)",
									"font-family": "monospace",
									"font-size": "13px",
									"color": "var(--text-primary)",
									"cursor": "pointer",
									"text-overflow": "ellipsis"
								}}
							/>
							<div 
								onClick={(e) => { e.stopPropagation(); handleCopy(); }}
								style={{
									"position": "absolute",
									"right": "8px",
									"font-size": "10px",
									"opacity": copied() ? 1 : 0.4,
									"background": copied() ? "var(--primary)" : "var(--surface-overlay)",
									"color": copied() ? "white" : "var(--text-primary)",
									"padding": "2px 8px",
									"border-radius": "4px",
									"cursor": "pointer",
									"transition": "all 0.2s ease",
									"font-weight": copied() ? "bold" : "normal"
								}}
							>
								{copied() ? "Copied!" : "Copy"}
							</div>
						</div>
						<Button variant="shadow" onClick={handlePickFolder}>
							Browse
						</Button>
					</div>
					<p style={{ "font-size": "12px", "opacity": 0.5, "margin-top": "12px", "line-height": "1.4", "color": "var(--text-primary)" }}>
						This is where your games, worlds, and settings will be located. We recommend a location with plenty of free space.
					</p>
				</div>
			</div>

			<div class={"init-page__bottom"} style={{ "display": "flex", "gap": "12px", "justify-content": "center" }}>
				<Show when={!props.hasInstalledInstance}>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => props.changeInitStep(props.initStep - 1)}
					>
						Back
					</Button>
				</Show>
				<Button 
					color="primary"
					style={{ "min-width": "180px" }}
					onClick={handleNext}
				>
					Next Step
				</Button>
			</div>
		</>
	);
}


function InitInstallationPage(props: InitPagesProps) {
	const [instanceName, setInstanceName] = createSignal("My First Instance");
	const [selectedVersion, setSelectedVersion] = createSignal<string>("");
	const [selectedModloader, setSelectedModloader] = createSignal<string>("vanilla");
	const [selectedModloaderVersion, setSelectedModloaderVersion] = createSignal<string>("");
	const [iconPath, setIconPath] = createSignal<string | null>(null);
	const [isInstalling, setIsInstalling] = createSignal(false);
	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<string[]>([]);

	// Create uploadedIcons array that includes all custom icons seen this session
	const uploadedIcons = createMemo(() => {
		const result = [...customIconsThisSession()];
		const current = iconPath();
		if (current && !DEFAULT_ICONS.includes(current) && !result.includes(current)) {
			return [current, ...result];
		}
		return result;
	});

	// Track custom icons in session list
	createEffect(() => {
		const current = iconPath();
		if (current && !DEFAULT_ICONS.includes(current)) {
			setCustomIconsThisSession((prev) => {
				if (prev.includes(current)) return prev;
				return [current, ...prev];
			});
		}
	});

	const [metadata] = createResource<PistonMetadata>(getMinecraftVersions);

	createEffect(() => {
		const meta = metadata();
		if (meta && !selectedVersion()) {
			const latestRelease = meta.game_versions.find((v) => v.stable);
			if (latestRelease) {
				setSelectedVersion(latestRelease.id);
			}
		}
	});

	// Get available modloaders for selected version
	const availableModloaders = createMemo(() => {
		const version = selectedVersion();
		const meta = metadata();
		if (!version || !meta) return ["vanilla"];

		const gameVersion = meta.game_versions.find((v) => v.id === version);
		if (!gameVersion) return ["vanilla"];

		const loaderKeys = Object.keys(gameVersion.loaders);
		// Deduplicate and ensure vanilla is first
		const uniqueLoaders = new Set(["vanilla"]);
		for (const key of loaderKeys) {
			uniqueLoaders.add(key);
		}

		return Array.from(uniqueLoaders);
	});

	// Get available loader versions
	const availableLoaderVersions = createMemo(() => {
		const version = selectedVersion();
		const loader = selectedModloader();
		const meta = metadata();
		if (!version || !loader || loader === "vanilla" || !meta) return [];

		const gameVersion = meta.game_versions.find((v) => v.id === version);
		return gameVersion?.loaders[loader] || [];
	});

	// Auto-update loader versions
	createEffect(() => {
		const loaders = availableModloaders();
		if (!loaders.includes(selectedModloader())) {
			setSelectedModloader("vanilla");
		}
	});

	createEffect(() => {
		const versions = availableLoaderVersions();
		if (versions.length > 0) {
			setSelectedModloaderVersion(versions[0].version);
		} else {
			setSelectedModloaderVersion("");
		}
	});

	const handleInstall = async () => {
		const name = instanceName().trim();
		const version = selectedVersion();

		if (!name || !version) return;

		setIsInstalling(true);

		try {
			const instanceData: CreateInstanceData = {
				name,
				minecraftVersion: version,
				iconPath: iconPath() || undefined,
				modloader: (selectedModloader() === "vanilla" ? undefined : selectedModloader()) || undefined,
				modloaderVersion: selectedModloaderVersion() || undefined,
				minMemory: 2048,
				maxMemory: 4096,
			};

			const instanceId = await createInstance(instanceData);

			const fullInstance: Instance = {
				id: instanceId,
				name,
				minecraftVersion: version,
				modloader: (selectedModloader() === "vanilla" ? null : selectedModloader()) || null,
				modloaderVersion: selectedModloaderVersion() || null,
				javaPath: null,
				javaArgs: null,
				gameDirectory: null,
				width: 854,
				height: 480,
				minMemory: 2048,
				maxMemory: 4096,
				iconPath: iconPath(),
				lastPlayed: null,
				totalPlaytimeMinutes: 0,
				createdAt: null,
				updatedAt: null,
				installationStatus: "pending",
				modpackId: null,
				modpackVersionId: null,
				modpackPlatform: null,
				modpackIconUrl: null,
				iconData: null,
			};

			await installInstance(fullInstance);
			
			// Notify that we installed an instance
			if (props.onInstanceInstalled) {
				props.onInstanceInstalled();
			} else {
				// Move to next page if callback not provided
				props.changeInitStep(props.initStep + 1);
			}
		} catch (error) {
			console.error("[Onboarding] Installation failed:", error);
		} finally {
			setIsInstalling(false);
		}
	};

	const handleSkip = () => {
		props.changeInitStep(props.initStep + 1);
	};

	return (
		<>
			<div class={"init-page__top"} style={{ "text-align": "left" }}>
				<h1 style={"font-size: 24px; font-weight: 800; opacity: 0.9"}>Create Your First Instance</h1>
				<p style={"font-size: 14px; opacity: 0.6"}>Let's get you ready for your first game session.</p>
			</div>
			
			<div class={"init-page__middle"} style={{
				"display": "flex",
				"flex-direction": "column",
				"gap": "20px",
				"width": "100%",
				"max-width": "700px",
				"margin": "0 auto",
				"overflow-y": "auto",
				"padding": "16px"
			}}>
				<div style={{ "display": "flex", "gap": "20px", "align-items": "flex-start" }}>
					<div style={{ "flex": "0 0 auto" }}>
						<IconPicker
							value={iconPath() || DEFAULT_ICONS[0]}
							onSelect={setIconPath}
							uploadedIcons={uploadedIcons()}
							showHint={true}
						/>
					</div>
					<div style={{ "flex": 1, "display": "flex", "flex-direction": "column", "gap": "20px" }}>
						<TextFieldRoot>
							<TextFieldLabel class="init-form-label">Instance Name</TextFieldLabel>
							<TextFieldInput
								value={instanceName()}
								onInput={(e) => setInstanceName((e.currentTarget as HTMLInputElement).value)}
								placeholder="Enter instance name..."
								style={{ "background": "var(--surface-sunken)" }}
							/>
						</TextFieldRoot>

						{/* Modloader Selection */}
						<div class="init-form-field">
							<label class="init-form-label">Modloader</label>
							<ToggleGroup
								value={selectedModloader()}
								onChange={(val) => val && setSelectedModloader(val)}
								class="modloader-pills"
							>
								<For each={availableModloaders()}>
									{(loader) => (
										<ToggleGroupItem value={loader}>
											{loader.charAt(0).toUpperCase() + loader.slice(1)}
										</ToggleGroupItem>
									)}
								</For>
							</ToggleGroup>
						</div>

						<div style={{ "display": "flex", "gap": "15px" }}>
							<div class="init-form-field" style={{ "flex": 1 }}>
								<label class="init-form-label">Minecraft Version</label>
								<Combobox
									options={metadata()?.game_versions.filter(v => v.stable).map(v => v.id) || []}
									value={selectedVersion()}
									onChange={setSelectedVersion}
									placeholder="Select version..."
									itemComponent={(itemProps) => (
										<ComboboxItem item={itemProps.item}>
											{itemProps.item.rawValue}
										</ComboboxItem>
									)}
								>
									<ComboboxControl aria-label="Minecraft Version" style={{ "background": "var(--surface-sunken)" }}>
										<ComboboxInput />
										<ComboboxTrigger />
									</ComboboxControl>
									<ComboboxContent />
								</Combobox>
							</div>

							<Show when={selectedModloader() !== "vanilla" && availableLoaderVersions().length > 0}>
								<div class="init-form-field" style={{ "flex": 1 }}>
									<label class="init-form-label">{selectedModloader()} Version</label>
									<Combobox
										options={availableLoaderVersions().map(v => v.version)}
										value={selectedModloaderVersion()}
										onChange={setSelectedModloaderVersion}
										placeholder={`Select ${selectedModloader()} version...`}
										itemComponent={(itemProps) => (
											<ComboboxItem item={itemProps.item}>
												{itemProps.item.rawValue}
											</ComboboxItem>
										)}
									>
										<ComboboxControl aria-label="Loader Version" style={{ "background": "var(--surface-sunken)" }}>
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

				<div style={{
					"background": "var(--surface-raised)",
					"padding": "15px",
					"border-radius": "12px",
					"border": "1px solid var(--border-subtle)",
					"font-size": "13px",
					"opacity": 0.8,
					"line-height": "1.5"
				}}>
					<strong>Note:</strong> This version will use the default Java and screen settings you chose earlier. You can change these anytime in the settings.
				</div>
			</div>

			<div class={"init-page__bottom"} style={{ "display": "flex", "gap": "12px", "justify-content": "center" }}>
				<Button
					variant="ghost"
					onClick={handleSkip}
					disabled={isInstalling()}
				>
					Skip for Now
				</Button>
				<Button 
					color="primary"
					style={{ "min-width": "200px" }}
					onClick={handleInstall}
					disabled={isInstalling() || !instanceName() || !selectedVersion()}
				>
					{isInstalling() ? "Creating..." : "Create and Continue"}
				</Button>
			</div>
		</>
	);
}


function InitFinishedPage(props: InitPagesProps) {
	const handleFinish = async (target: string = "/home") => {
		try {
			await invoke("complete_onboarding");
			props.navigate?.(target, { replace: true });

			// If going home, we might want to start the tutorial
			if (target === "/home") {
				setTimeout(() => startAppTutorial(), 1000);
			}
		} catch (e) {
			console.error("Failed to complete onboarding:", e);
		}
	};

	return (
		<>
			<div class={"init-page__top"}>
				<h1 style={"font-size: 40px"}>You're All Set!</h1>
				<p>Vesta is fully configured and ready for action.</p>
			</div>
			<div class={"init-page__middle"} style={{
				"display": "flex",
				"flex-direction": "column",
				"align-items": "center",
				"justify-content": "center",
				"gap": "25px",
				"margin-top": "20px",
				"overflow-y": "auto",
				"max-height": "400px",
				"padding": "0 20px"
			}}>
				<div style={{
					"width": "80px",
					"height": "80px",
					"background": "var(--surface-raised)",
					"border-radius": "50%",
					"display": "flex",
					"align-items": "center",
					"justify-content": "center",
					"border": "2px solid var(--primary)",
				}}>
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12"></polyline>
					</svg>
				</div>

				<div style={{
					"display": "flex",
					"flex-direction": "column",
					"gap": "12px",
					"width": "100%",
					"max-width": "300px"
				}}>
					<Button 
						color="primary"
						variant="solid"
						onClick={() => handleFinish("/home")}
						style={{ "height": "50px", "font-size": "16px" }}
					>
						Go to Dashboard
					</Button>
				</div>
			</div>
			<div class={"init-page__bottom"}>
				<Show when={!props.hasInstalledInstance}>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => props.changeInitStep(props.initStep - 1)}
					>
						Back
					</Button>
				</Show>
			</div>
		</>
	);
}


function InitLoginPage(props: InitPagesProps) {
	const [authCode, setAuthCode] = createSignal<string>("");
	const [authUrl, setAuthUrl] = createSignal<string>("");
	const [isAuthenticating, setIsAuthenticating] = createSignal(false);
	const [isStartingAuth, setIsStartingAuth] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string>("");
	const [copied, setCopied] = createSignal(false);
	const [timeLeft, setTimeLeft] = createSignal<number>(0);
	const [hasAccount, setHasAccount] = createSignal(false);

	let unlistenAuth: (() => void) | null = null;
	let timer: any = null;

	onMount(async () => {
		const { getActiveAccount, listenToAuthEvents } = await import("@utils/auth");
		
		const acc = await getActiveAccount();
		setHasAccount(!!acc);

		unlistenAuth = await listenToAuthEvents((event) => {
			if (event.stage === "AuthCode") {
				setAuthCode(event.code);
				setAuthUrl(event.url);
				setIsAuthenticating(true);
				setIsStartingAuth(false);
				setTimeLeft(event.expires_in);

				if (timer) clearInterval(timer);
				timer = setInterval(() => {
					setTimeLeft((t) => Math.max(0, t - 1));
					if (timeLeft() === 0) {
						clearInterval(timer);
					}
				}, 1000);
			} else if (event.stage === "Complete") {
				setIsAuthenticating(false);
				setIsStartingAuth(false);
				if (timer) clearInterval(timer);

				if (props.isLoginOnly) {
					props.navigate?.("/home", { replace: true });
				} else {
					props.changeInitStep(props.initStep + 1);
				}
			} else if (event.stage === "Cancelled") {
				setIsAuthenticating(false);
				setIsStartingAuth(false);
				setErrorMessage("Authentication cancelled");
				if (timer) clearInterval(timer);
			} else if (event.stage === "Error") {
				setIsAuthenticating(false);
				setIsStartingAuth(false);
				setErrorMessage(event.message);
				if (timer) clearInterval(timer);
			}
		});
	});

	onCleanup(() => {
		unlistenAuth?.();
		if (timer) clearInterval(timer);
	});

	const handleLogin = async () => {
		try {
			setErrorMessage("");
			setIsStartingAuth(true);
			const { startLogin } = await import("@utils/auth");
			await startLogin();
		} catch (error) {
			setIsStartingAuth(false);
			setErrorMessage(`Failed to start login: ${error}`);
		}
	};

	const handleGuestMode = async () => {
		try {
			setErrorMessage("");
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("start_guest_session");
			await invoke("update_config_field", { field: "setup_completed", value: true });
			window.location.href = "/home";
		} catch (error) {
			setErrorMessage(`Failed to start guest session: ${error}`);
		}
	};

	const handleCancel = async () => {
		try {
			const { cancelLogin } = await import("@utils/auth");
			await cancelLogin();
			setIsAuthenticating(false);
		} catch (error) {
			console.error("Failed to cancel login:", error);
		}
	};

	const copyCode = async () => {
		try {
			await navigator.clipboard.writeText(authCode());
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	};

	const openUrlAction = async () => {
		try {
			await openUrl(authUrl());
		} catch (error) {
			console.error("Failed to open URL:", error);
		}
	};

	return (
		<>
			<div class={"init-page__top"} style={{ "text-align": "center", "margin-bottom": "3vh" }}>
				<h1 style={{ "font-size": "clamp(28px, 4vh, 36px)", "font-weight": "800", "letter-spacing": "-1.5px", "margin": 0, "background": "linear-gradient(135deg, white 0%, rgba(255,255,255,0.7) 100%)", "-webkit-background-clip": "text", "-webkit-text-fill-color": "transparent" }}>
					Microsoft Account
				</h1>
				<p style={{ "opacity": 0.5, "font-size": "clamp(14px, 1.8vh, 16px)", "margin-top": "8px", "font-weight": "500", "letter-spacing": "0.3px" }}>
					Connect your account to access Minecraft and online services.
				</p>
			</div>
			
			<div class={"init-page__middle"}>
				<div class="login-page__container">
					<Show when={!isAuthenticating()}>
						<div class="login-page__auth-box" style={"background: transparent; border: none; box-shadow: none;"}>
							<div 
								style={"width: 80px; height: 80px; background: rgba(255,255,255,0.05); border-radius: 20px; display: flex; align-items: center; justify-content: center; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1);"}
							>
								<svg width="40" height="40" viewBox="0 0 23 23">
									<path fill="#f35325" d="M1 1h10v10H1z"/>
									<path fill="#81bc06" d="M12 1h10v10H12z"/>
									<path fill="#05a6f0" d="M1 12h10v10H1z"/>
									<path fill="#ffba08" d="M12 12h10v10H12z"/>
								</svg>
							</div>
							
							<Button 
								onClick={handleLogin}
								style={"width: 240px; height: 48px; font-weight: 600; font-size: 16px;"}
								disabled={isStartingAuth()}
							>
								<Show when={isStartingAuth()} fallback={"Login with Microsoft"}>
									<div style={{ "display": "flex", "align-items": "center", "gap": "10px" }}>
										<div class="spinner--small" />
										<span>Connecting...</span>
									</div>
								</Show>
							</Button>

							<div style={"margin-top: 16px;"}>
								<button 
									onClick={handleGuestMode}
									class="init-link"
									style={"background: none; border: none; color: rgba(255,255,255,0.5); font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: underline; transition: color 0.2s;"}
									onMouseEnter={(e) => { e.currentTarget.style.color = 'white'; }}
									onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
								>
									{hasAccount() && props.isLoginOnly ? "Back to Launcher" : "Continue as Guest"}
								</button>
							</div>
							
							<Show when={errorMessage()}>
								<div style={"margin-top: 16px; padding: 12px; background: rgba(255, 85, 85, 0.1); border-radius: 8px; border: 1px solid rgba(255, 85, 85, 0.2); color: #ff5555; font-size: 14px; width: 100%;"}>
									{errorMessage()}
								</div>
							</Show>
						</div>
					</Show>

					<Show when={isAuthenticating()}>
						<div class="login-page__auth-box" style={{ "padding": "24px 32px" }}>
							<div style={{ "display": "flex", "gap": "32px", "align-items": "center", "width": "100%", "text-align": "left" }}>
								<div style={{ "flex": 1 }}>
									<div class="login-page__instructions" style={{ "text-align": "left", "margin": 0 }}>
										<p style={{ "font-size": "16px" }}>Visit <b>microsoft.com/link</b></p>
										<p style={{ "font-size": "14px", "opacity": 0.7, "margin-top": "4px" }}>
											Enter the security code on the right to connect your account.
										</p>
									</div>

									<div style={{ "display": "flex", "flex-direction": "column", "gap": "8px", "margin-top": "20px" }}>
										<Button 
											color="primary"
											onClick={openUrlAction}
											style={{ "width": "100%" }}
										>
											Open Browser
										</Button>
										<Button 
											variant="ghost" 
											onClick={handleCancel}
											style={{ "width": "100%" }}
										>
											Cancel
										</Button>
									</div>
								</div>

								<div style={{ "flex": "0 0 auto", "display": "flex", "flex-direction": "column", "align-items": "center", "gap": "12px" }}>
									<div class="login-page__code-container" style={{ "margin": 0, "flex-direction": "column", "gap": "8px" }}>
										<div class="login-page__code" style={{ "font-size": "36px", "padding": "12px 20px" }}>{authCode()}</div>
										<Button 
											variant="ghost" 
											onClick={copyCode}
											style={{ "width": "100%", "font-size": "0.8em" }}
										>
											{copied() ? "Saved!" : "Copy Code"}
										</Button>
									</div>
									
									<div style={{ "display": "flex", "flex-direction": "column", "align-items": "center" }}>
										<p class={`login-page__timer ${timeLeft() < 30 ? 'login-page__timer--low' : ''}`} style={{ "margin": 0 }}>
											{timeLeft() <= 0 
												? "Expired" 
												: `Expires in ${Math.floor(timeLeft() / 60)}:${(timeLeft() % 60).toString().padStart(2, "0")}`}
										</p>
										<Show when={timeLeft() <= 0}>
											<Button onClick={handleLogin} size="sm" variant="shadow" style={{ "margin-top": "8px" }}>
												Get New Code
											</Button>
										</Show>
									</div>
								</div>
							</div>

							<div style={{ "display": "flex", "align-items": "center", "gap": "8px", "margin-top": "16px", "opacity": 0.8, "width": "100%", "justify-content": "center", "border-top": "1px solid rgba(255,255,255,0.05)", "padding-top": "12px" }}>
								<div class="spinner--small"></div>
								<span style={{ "font-size": "13px" }}>Waiting for Microsoft authentication...</span>
							</div>
						</div>
					</Show>
				</div>
			</div>
			
			<div class={"init-page__bottom"}>
				<Show when={!props.isLoginOnly && !isAuthenticating() && !props.hasInstalledInstance}>
					<Button 
						variant="ghost" 
						size="sm"
						onClick={() => props.changeInitStep(props.initStep - 1)}
					>
						Go Back
					</Button>
				</Show>
			</div>
		</>
	);
}

function InitJavaPage(props: InitPagesProps) {
	const [requirements, { refetch: refetchReqs }] = createResource<JavaRequirement[]>(() =>
		invoke("get_required_java_versions"),
	);
	const [detected] = createResource<DetectedJava[]>(() =>
		invoke("detect_java"),
	);
	const [managed] = createResource<DetectedJava[]>(() =>
		invoke("get_managed_javas"),
	);
	const [selections, setSelections] = createSignal<Record<number, string>>({});
	const [verifying, setVerifying] = createSignal<Record<number, boolean>>({});
	const [errors, setErrors] = createSignal<Record<number, string>>({});
	const [isApplying, setIsApplying] = createSignal(false);

	// Auto-retry metadata fetch if manifest is not ready or empty
	createEffect(() => {
		const err = requirements.error;
		const data = requirements();
		
		if (err === "MANIFEST_NOT_READY" || (!requirements.loading && data && data.length === 0)) {
			const timer = setTimeout(() => {
				refetchReqs();
			}, 2000);
			onCleanup(() => clearTimeout(timer));
		}
	});

	const isAllManaged = createMemo(() => {
		const reqs = requirements();
		if (!reqs || reqs.length === 0) return false;
		return reqs.every(r => selections()[r.major_version] === "managed");
	});

	const isManagedInstalled = (version: number) => {
		return managed()?.some(m => m.major_version === version);
	};

	const handleSelectManaged = (version: number) => {
		setSelections(prev => ({ ...prev, [version]: "managed" }));
		setErrors(prev => ({ ...prev, [version]: "" }));
	};

	const handleSelectManagedAll = () => {
		const reqs = requirements();
		if (!reqs) return;
		
		const newSelections = { ...selections() };
		const newErrors = { ...errors() };
		
		for (const req of reqs) {
			newSelections[req.major_version] = "managed";
			newErrors[req.major_version] = "";
		}
		
		setSelections(newSelections);
		setErrors(newErrors);
	};

	const handleSelect = async (version: number, path: string) => {
		setVerifying(prev => ({ ...prev, [version]: true }));
		try {
			const info = await invoke<DetectedJava>("verify_java_path", { pathStr: path });
			if (info.major_version !== version) {
				setErrors(prev => ({
					...prev,
					[version]: `Selected Java is version ${info.major_version}, but ${version} is required.`,
				}));
			} else {
				setSelections(prev => ({ ...prev, [version]: path }));
				setErrors(prev => ({ ...prev, [version]: "" }));
			}
		} catch (e) {
			setErrors(prev => ({ ...prev, [version]: String(e) }));
		} finally {
			setVerifying(prev => ({ ...prev, [version]: false }));
		}
	};

	const handleManualPick = async (version: number) => {
		try {
			const path = await invoke<string | null>("pick_java_path");
			if (path) {
				await handleSelect(version, path);
			}
		} catch (e) {
			console.error("Failed to pick java path:", e);
		}
	};

	const handleProceed = async () => {
		if (!canProceed()) return;
		setIsApplying(true);
		try {
			const currentSelections = selections();
			
			// Start all submissions and configuration updates in parallel
			const tasks = Object.entries(currentSelections).map(([versionStr, path]) => {
				const version = parseInt(versionStr);
				if (path === "managed") {
					// This submits the task to the background manager and returns immediately
					return invoke("download_managed_java", { version });
				} else {
					return invoke("set_global_java_path", {
						version,
						pathStr: path,
						managed: false,
					});
				}
			});

			await Promise.all(tasks);
			
			// Move to next step immediately as tasks are now handled in the background
			props.changeInitStep(props.initStep + 1);
		} catch (e) {
			console.error("Failed to apply Java settings:", e);
		} finally {
			setIsApplying(false);
		}
	};

	const canProceed = () => {
		const reqs = requirements();
		if (!reqs) return false;
		return reqs.every((req) => selections()[req.major_version]);
	};

	return (
		<>
			<Show 
				when={!requirements.loading && requirements() && (requirements()?.length ?? 0) > 0} 
				fallback={
					<div 
						style={{ 
							"display": "flex", 
							"flex-direction": "column", 
							"align-items": "center", 
							"justify-content": "center", 
							"height": "100%", 
							"gap": "20px",
							"padding": "40px",
							"text-align": "center"
						}}
					>
						<div class="spinner" />
						<div>
							<h2 style={{ "margin-bottom": "8px" }}>Fetching Requirements</h2>
							<p style={{ "opacity": 0.6, "font-size": "14px" }}>
								Syncing with Minecraft's metadata servers to determine the best environment for you...
							</p>
							<Show when={requirements.error && requirements.error !== "MANIFEST_NOT_READY"}>
								<p style={{ "color": "#ff5555", "font-size": "12px", "margin-top": "10px" }}>
									Error: {String(requirements.error)}
								</p>
								<Button 
									variant="ghost" 
									size="sm" 
									style={{ "margin-top": "10px" }}
									onClick={() => refetchReqs()}
								>
									Retry
								</Button>
							</Show>
						</div>
					</div>
				}
			>
				<div class={"init-page__top"} style={{ "text-align": "left", "margin-bottom": "8px" }}>
					<div style={{ "display": "flex", "justify-content": "space-between", "align-items": "flex-start", "margin-bottom": "8px" }}>
						<div>
							<h1 style={"font-size: 24px; font-weight: 800; opacity: 0.9"}>
								Java Setup
								<HelpTrigger topic="JAVA_MANAGED" />
							</h1>
							<p style={"font-size: 14px; opacity: 0.7; max-width: 500px;"}>
								Minecraft needs a software called <strong>Java</strong> to run. Different versions of the game require different versions of Java.
							</p>
						</div>
						<Button 
							variant="ghost"
							size="sm" 
							onClick={handleSelectManagedAll}
						>
							{isAllManaged() ? "✓ All Managed Selected" : "Select All Managed"}
						</Button>
					</div>
					
					<div style={{ 
						"background": "rgba(255,255,255,0.03)", 
						"padding": "8px 12px", 
						"border-radius": "6px", 
						"border": "1px solid rgba(255,255,255,0.05)",
						"width": "100%"
					}}>
						<p style={{ "font-size": "12px", "opacity": 0.7, "line-height": "1.4" }}>
							<strong>Tip:</strong> You can use Vesta's <strong>Managed</strong> runtimes (recommended) or your own <strong>System</strong> paths.
						</p>
					</div>
				</div>
			<div
				class={"init-page__middle"}
				style={{
					display: "grid",
					"grid-template-columns": "repeat(auto-fit, minmax(300px, 1fr))",
					gap: "12px",
					width: "100%",
					margin: "0 auto",
					"overflow-y": "auto",
					padding: "4px",
				}}
			>
				<For each={requirements()}>
					{(req) => (
						<div
							style={{
								background: "rgba(255,255,255,0.05)",
								padding: "14px",
								"border-radius": "10px",
								transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
								border: selections()[req.major_version]
									? "var(--border-width-strong) solid rgba(255,255,255,0.4)"
									: "var(--border-width-subtle) solid rgba(255,255,255,0.1)",
								"box-shadow": selections()[req.major_version] 
									? "0 8px 30px -10px rgba(255,255,255,0.15)" 
									: "none",
								"transform": selections()[req.major_version] ? "translateY(-2px)" : "none"
							}}
						>
							<div
								style={{
									display: "flex",
									"justify-content": "space-between",
									"align-items": "center",
								}}
							>
								<div>
									<h3 style={{ margin: 0, "font-size": "18px", "font-weight": "700", "text-align": "left" }}>{req.recommended_name}</h3>
									<p style={{ "font-size": "11px", opacity: 0.6, "margin-top": "2px" }}>
										{req.is_required_for_latest
											? "Mission critical for modern releases"
											: "Enables support for legacy versions"}
									</p>
								</div>
								<div style={{ display: "flex", gap: "8px" }}>
									<Button
										onClick={() => handleSelectManaged(req.major_version)}
										size="sm"
										color={selections()[req.major_version] === "managed" ? "primary" : "none"}
										variant={
											selections()[req.major_version] === "managed"
												? "solid"
												: "ghost"
										}
										style={{ "transition": "all 0.2s ease" }}
									>
										{selections()[req.major_version] === "managed" 
											? (isManagedInstalled(req.major_version) ? "✓ Managed Installed" : "✓ Managed Selected") 
											: "Use Managed"}
									</Button>
								</div>
							</div>

							<div style={{ "margin-top": "12px" }}>
								<p style={{ "font-size": "10px", "margin-bottom": "6px", "opacity": 0.5, "text-transform": "uppercase", "letter-spacing": "0.5px" }}>
									System Installations
								</p>
								<div
									style={{
										display: "flex",
										"flex-direction": "column",
										gap: "8px",
									}}
								>
									<For
										each={detected()?.filter(
											(d) => d.major_version === req.major_version,
										)}
									>
										{(det) => (
											<div
												onClick={() =>
													handleSelect(req.major_version, det.path)
												}
												style={{
													padding: "12px 16px",
													background: selections()[req.major_version] === det.path 
														? "rgba(255, 255, 255, 0.08)" 
														: "rgba(0,0,0,0.15)",
													cursor: "pointer",
													"font-size": "12px",
													display: "flex",
													"justify-content": "space-between",
													"align-items": "center",
													"border-radius": "8px",
													transition: "all 0.2s ease",
													border:
														selections()[req.major_version] === det.path
															? "var(--border-width-strong) solid rgba(255, 255, 255, 0.4)"
															: "var(--border-width-subtle) solid rgba(255,255,255,0.05)",
												}}
											>
												<span
													style={{
														overflow: "hidden",
														"text-overflow": "ellipsis",
														"white-space": "nowrap",
														"max-width": "75%",
														"font-family": "monospace",
														"opacity": selections()[req.major_version] === det.path ? 1 : 0.6
													}}
												>
													{det.path}
												</span>
												<div style={{ "display": "flex", "align-items": "center", "gap": "10px" }}>
													<span style={{ "font-size": "10px", "opacity": 0.4 }}>{det.is_64bit ? "64-bit" : "32-bit"}</span>
													<Show when={selections()[req.major_version] === det.path}>
														<div 
															style={{ 
																"width": "6px", 
																"height": "6px", 
																"background": "white", 
																"border-radius": "50%", 
																"box-shadow": "0 0 10px rgba(255, 255, 255, 0.5)" 
															}} 
														/>
													</Show>
												</div>
											</div>
										)}
									</For>
									<Show
										when={
											!detected()?.some(
												(d) => d.major_version === req.major_version,
											)
										}
									>
										<p style={{ "font-size": "12px", opacity: 0.3, "font-style": "italic", "margin": "8px 0" }}>
											No compatible versions detected on your system.
										</p>
									</Show>
									
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleManualPick(req.major_version)}
										style={{ 
											"margin-top": "4px", 
											"font-size": "11px", 
											"justify-content": "center",
											"border": "1px dashed rgba(255,255,255,0.1)",
											"opacity": 0.7
										}}
									>
										+ Browse for Java executable...
									</Button>
								</div>
							</div>

							<Show when={errors()[req.major_version]}>
								<div style={{ color: "var(--error)", "font-size": "12px", "margin-top": "14px", "padding": "10px", "background": "rgba(255, 85, 85, 0.05)", "border-radius": "6px", "border": "1px solid rgba(255, 85, 85, 0.1)" }}>
									{errors()[req.major_version]}
								</div>
							</Show>
							
							<Show when={verifying()[req.major_version]}>
								<div style={{ "display": "flex", "align-items": "center", "gap": "8px", "margin-top": "12px", "opacity": 0.6 }}>
									<div class="spinner--small" />
									<p style={{ "font-size": "12px" }}>Verifying selection...</p>
								</div>
							</Show>
						</div>
					)}
				</For>
			</div>
			<div class={"init-page__bottom"} style={{"display": "flex", "gap": "12px", "justify-content": "center", "margin-top": "20px"}}>
				<Show when={!props.hasInstalledInstance}>
					<Button
						variant="ghost"
						onClick={() => props.changeInitStep(props.initStep - 1)}
						disabled={isApplying()}
						size="sm"
					>
						Back
					</Button>
				</Show>
				
				<Button
					onClick={handleProceed}
					disabled={!canProceed() || isApplying()}
					color="primary"
					style={{ "min-width": "180px" }}
				>
					{isApplying() ? "Finalizing..." : "Next Step"}
				</Button>
			</div>
			</Show>
		</>
	);
}

function InitAppearancePage(props: InitPagesProps) {
	const [themeId, setThemeId] = createSignal<string>(currentThemeConfig.theme_id ?? "midnight");
	const [backgroundHue, setBackgroundHue] = createSignal(currentThemeConfig.theme_primary_hue ?? currentThemeConfig.background_hue ?? 220);

	onMount(async () => {
		try {
			const config = await invoke<any>("get_config");
			if (config.theme_id) setThemeId(config.theme_id);
			if (config.theme_primary_hue !== null && config.theme_primary_hue !== undefined)
				setBackgroundHue(config.theme_primary_hue);
		} catch (e) {
			console.error("Failed to load appearance config:", e);
		}
	});

	const handlePresetSelect = async (id: string) => {
		const theme = getThemeById(id);
		if (theme) {
			setThemeId(id);
			const newHue = theme.allowHueChange === false ? (theme.primaryHue ?? 220) : backgroundHue();
			
			if (theme.primaryHue !== undefined && theme.allowHueChange === false) {
				setBackgroundHue(newHue);
			}

			// Update local theme state
			updateThemeConfigLocal("theme_id", id);
			updateThemeConfigLocal("theme_primary_hue", newHue);
			
			// Apply theme visually
			applyTheme({
				...theme,
				primaryHue: newHue,
			});

			// Save to backend
			try {
				await invoke("update_config_fields", {
					updates: {
						theme_id: id,
						theme_primary_hue: newHue,
						theme_style: theme.style,
						theme_gradient_enabled: theme.gradientEnabled,
						theme_gradient_angle: theme.rotation ?? 135,
						theme_gradient_type: theme.gradientType || "linear",
						theme_gradient_harmony: theme.gradientHarmony || "none",
						theme_border_width: theme.borderWidthSubtle ?? 1,
					},
				});
			} catch (e) {
				console.error("Failed to save theme preset:", e);
			}
		}
	};

	const handleHueChange = async (values: number[]) => {
		const newHue = values[0];
		setBackgroundHue(newHue);
		updateThemeConfigLocal("theme_primary_hue", newHue);

		const theme = getThemeById(themeId());
		if (theme) {
			applyTheme({
				...theme,
				primaryHue: newHue,
			});
		}

		try {
			await invoke("update_config_fields", {
				updates: { theme_primary_hue: newHue },
			});
		} catch (e) {
			console.error("Failed to save hue:", e);
		}
	};

	const canChangeHue = () => {
		const theme = getThemeById(themeId());
		return theme?.allowHueChange ?? false;
	};

	return (
		<>
			<div class={"init-page__top"} style={{ "margin-bottom": "16px", "text-align": "left" }}>
				<h1 style={"font-size: 24px; font-weight: 800; opacity: 0.9"}>Choose Your Style</h1>
				<p style={"font-size: 14px; opacity: 0.6"}>Pick a starting look for Vesta. You can always change this later in settings.</p>
			</div>
			<div
				class={"init-page__middle"}
				style={{
					display: "flex",
					"flex-direction": "column",
					gap: "24px",
					width: "100%",
					"overflow-y": "auto",
					padding: "4px",
				}}
			>
				<section>
					<div 
						style={{ 
							display: "grid", 
							"grid-template-columns": "repeat(auto-fit, minmax(180px, 1fr))", 
							gap: "12px" 
						}}
					>
						<For each={PRESET_THEMES.filter(t => t.id !== "custom")}>
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
					<section style={{ "background": "rgba(255,255,255,0.03)", "padding": "20px", "border-radius": "12px", "border": "var(--border-width-subtle) solid rgba(255,255,255,0.05)" }}>
						<Slider
							value={[backgroundHue()]}
							onChange={handleHueChange}
							minValue={0}
							maxValue={360}
							step={1}
							class="hue-track"
						>
							<div style={{ "display": "flex", "justify-content": "space-between", "margin-bottom": "12px" }}>
								<label style={{ "font-size": "14px", "font-weight": "600" }}>Customize Primary Hue</label>
								<div style={{ "font-family": "monospace", "opacity": 0.6 }}>{backgroundHue()}°</div>
							</div>
							<SliderTrack>
								<SliderFill style={{ "background": "transparent" }} />
								<SliderThumb />
							</SliderTrack>
						</Slider>
					</section>
				</Show>
			</div>
			<div class={"init-page__bottom"} style={{"display": "flex", "gap": "12px", "justify-content": "center", "margin-top": "20px"}}>
				<Show when={!props.hasInstalledInstance}>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => props.changeInitStep(props.initStep - 1)}
					>
						Back
					</Button>
				</Show>
				<Button 
					color="primary"
					style={{ "min-width": "180px" }}
					onClick={() => props.changeInitStep(props.initStep + 1)}
				>
					Next Step
				</Button>
			</div>
		</>
	);
}

export {
	InitAppearancePage,
	InitFinishedPage,
	InitFirstPage,
	InitGuidePage,
	InitJavaPage,
	InitLoginPage,
	InitDataStoragePage,
	InitInstallationPage,
};
