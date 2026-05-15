import { router, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import Button from "@ui/button/button";
import { Combobox, ComboboxContent, ComboboxControl, ComboboxInput, ComboboxItem, ComboboxTrigger } from "@ui/combobox/combobox";
import { TextFieldInput, TextFieldLabel, TextFieldRoot } from "@ui/text-field/text-field";
import { createInstance, DEFAULT_ICONS, getStableIconId, installInstance, type Instance, type CreateInstanceData } from "@utils/instances";
import { useMinecraftVersions } from "@stores/versions";
import { getAllModloaders, getLoaderVersionsForGameVersion, getModloadersForGameVersion, resolveCompatibleVersionSelection } from "@utils/version-selection";
import { ModloaderSwitcher } from "@components/modloader-switcher/modloader-switcher";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import { Motion, Presence } from "@motionone/solid";
import { invoke } from "@tauri-apps/api/core";
import { batch, createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js";
import { DURATION, EASE } from "../utils/motion";
import styles from "../init.module.css";

interface FirstInstanceStepProps {
	goNext: () => Promise<void>;
	goBack: () => Promise<void>;
	navigate: (to: string, options?: { replace?: boolean }) => void;
}

type FirstInstanceMode = "menu" | "blank" | "import-file" | "import-url";

function FirstInstanceStep(props: FirstInstanceStepProps) {
	const [mode, setMode] = createSignal<FirstInstanceMode>("menu");
	const [isInstalling, setIsInstalling] = createSignal(false);

	// Blank instance form state
	const [instanceName, setInstanceName] = createSignal("My First Instance");
	const [selectedVersion, setSelectedVersion] = createSignal<string>("");
	const [selectedModloader, setSelectedModloader] = createSignal<string>("vanilla");
	const [selectedModloaderVersion, setSelectedModloaderVersion] = createSignal<string>("");
	const [iconPath, setIconPath] = createSignal<string | null>(null);
	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<string[]>([]);

	const { versions: metadata } = useMinecraftVersions();

	createEffect(() => {
		const meta = metadata();
		if (meta && !selectedVersion()) {
			const latestRelease = meta.game_versions.find((v) => v.stable);
			if (latestRelease) {
				setSelectedVersion(latestRelease.id);
			}
		}
	});

	const uploadedIcons = createMemo(() => {
		const result = [...customIconsThisSession()];
		const current = iconPath();
		if (current && !current.startsWith("default:") && !result.includes(current)) {
			return [current, ...result];
		}
		return result;
	});

	createEffect(() => {
		const current = iconPath();
		if (current && !current.startsWith("default:")) {
			setCustomIconsThisSession((prev) => {
				if (prev.includes(current)) return prev;
				return [current, ...prev];
			});
		}
	});

	const availableModloaders = createMemo(() => {
		const meta = metadata();
		if (!meta) return ["vanilla"];
		return getAllModloaders(meta);
	});

	const currentVersionSupportedLoaders = createMemo(() => {
		const version = selectedVersion();
		const meta = metadata();
		if (!version || !meta) return ["vanilla"];
		return getModloadersForGameVersion(meta, version);
	});

	const modloaderSwitcherOptions = createMemo(() => {
		const supportedLoaders = currentVersionSupportedLoaders();
		return availableModloaders().map((loaderId) => ({
			value: loaderId,
			label: loaderId.charAt(0).toUpperCase() + loaderId.slice(1),
			supported: supportedLoaders.includes(loaderId.toLowerCase()),
		}));
	});

	const availableLoaderVersions = createMemo(() => {
		const version = selectedVersion();
		const loader = selectedModloader();
		const meta = metadata();
		if (!version || !loader || loader === "vanilla" || !meta) return [];
		return getLoaderVersionsForGameVersion(meta, version, loader);
	});

	const versionOptions = createMemo(() => {
		const meta = metadata();
		const loader = selectedModloader();
		if (!meta) return [];
		return meta.game_versions
			.filter((v) => {
				if (!v.stable) return false;
				if (loader === "vanilla") return true;
				return Object.keys(v.loaders).some(
					(l) => l.toLowerCase() === loader.toLowerCase(),
				);
			})
			.map((v) => v.id);
	});

	createEffect(() => {
		const meta = metadata();
		const version = selectedVersion();
		if (!meta || !version) return;

		const resolved = resolveCompatibleVersionSelection({
			metadata: meta,
			minecraftVersion: version,
			modloader: selectedModloader(),
			modloaderVersion: selectedModloaderVersion(),
			includeSnapshots: false,
		});

		batch(() => {
			if (resolved.minecraftVersion !== version) {
				setSelectedVersion(resolved.minecraftVersion);
			}
			if (resolved.modloader !== selectedModloader()) {
				setSelectedModloader(resolved.modloader);
			}
			if (resolved.modloaderVersion !== selectedModloaderVersion()) {
				setSelectedModloaderVersion(resolved.modloaderVersion);
			}
		});
	});

	const handleInstallBlank = async () => {
		const name = instanceName().trim();
		const version = selectedVersion();
		if (!name || !version) return;

		setIsInstalling(true);
		try {
			const instanceData: CreateInstanceData = {
				name,
				minecraftVersion: version,
				iconPath: iconPath() || undefined,
				modloader: selectedModloader() === "vanilla" ? undefined : selectedModloader(),
				modloaderVersion: selectedModloaderVersion() || undefined,
				minMemory: 2048,
				maxMemory: 4096,
			};

			const instanceId = await createInstance(instanceData);
			const fullInstance: Instance = {
				id: instanceId,
				name,
				minecraftVersion: version,
				modloader: selectedModloader() === "vanilla" ? null : selectedModloader(),
				modloaderVersion: selectedModloaderVersion() || null,
				javaPath: null,
				javaArgs: null,
				gameDirectory: null,
				gameWidth: 854,
				gameHeight: 480,
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
				useGlobalResolution: true,
				useGlobalMemory: true,
				useGlobalJavaArgs: true,
				useGlobalJavaPath: true,
				useGlobalHooks: true,
				useGlobalEnvironmentVariables: true,
				useGlobalGameDir: true,
				useGlobalLauncherAction: true,
				launcherActionOnLaunch: null,
				environmentVariables: null,
				preLaunchHook: null,
				postExitHook: null,
				wrapperCommand: null,
			};

			await installInstance(fullInstance);
			await completeOnboarding();
		} catch (error) {
			console.error("[Onboarding] Installation failed:", error);
		} finally {
			setIsInstalling(false);
		}
	};

	const handleBrowseModpacks = () => {
		// Complete onboarding and navigate to home, then open resources
		void completeOnboardingAndGoHome();
	};

	const handleSkip = async () => {
		await completeOnboardingAndGoHome();
	};

	const completeOnboarding = async () => {
		try {
			await invoke("complete_onboarding");
		} catch (e) {
			console.error("Failed to complete onboarding:", e);
		}
	};

	const completeOnboardingAndGoHome = async () => {
		await completeOnboarding();
		props.navigate("/home", { replace: true });
	};

	const menuOptions = [
		{
			id: "browse" as const,
			title: "Browse Modpacks",
			description: "Discover curated packs from Modrinth and CurseForge",
			icon: (
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="11" cy="11" r="8" />
					<line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
			),
			action: () => setMode("menu"),
		},
		{
			id: "blank" as const,
			title: "Blank Instance",
			description: "Start from scratch with any version and modloader",
			icon: (
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<line x1="12" y1="8" x2="12" y2="16" />
					<line x1="8" y1="12" x2="16" y2="12" />
				</svg>
			),
			action: () => setMode("blank"),
		},
	];

	return (
		<div class={styles["first-instance-step"]}>
			<Presence exitBeforeEnter>
				<Switch>
					<Match when={mode() === "menu"}>
						<Motion
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -12 }}
							transition={{ duration: DURATION.fast, easing: EASE.swift }}
						>
							<div class={styles["first-instance-menu"]}>
								<div class={styles["first-instance-header"]}>
									<h2 class={styles["first-instance-title"]}>Your First Instance</h2>
									<p class={styles["first-instance-subtitle"]}>
										How would you like to get started?
									</p>
								</div>

								<div class={styles["first-instance-options"]}>
									{menuOptions.map((option) => (
										<button
											class={styles["first-instance-option"]}
											onClick={option.action}
										>
											<div class={styles["first-instance-option-icon"]}>
												{option.icon}
											</div>
											<div class={styles["first-instance-option-text"]}>
												<span class={styles["first-instance-option-title"]}>
													{option.title}
												</span>
												<span class={styles["first-instance-option-desc"]}>
													{option.description}
												</span>
											</div>
										</button>
									))}
									</div>

								<div class={styles["first-instance-footer"]}>
									<button
										class={styles["first-instance-skip"]}
										onClick={handleSkip}
									>
										Skip for now
									</button>
								</div>
							</div>
						</Motion>
					</Match>

					<Match when={mode() === "blank"}>
						<Motion
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -12 }}
							transition={{ duration: DURATION.fast, easing: EASE.swift }}
						>
							<div class={styles["first-instance-form"]}>
								<div class={styles["first-instance-form-header"]}>
									<button
										class={styles["first-instance-back"]}
										onClick={() => setMode("menu")}
									>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
											<polyline points="15 18 9 12 15 6" />
										</svg>
										Back
									</button>
									<h3 class={styles["first-instance-form-title"]}>Blank Instance</h3>
								</div>

								<div class={styles["first-instance-form-body"]}>
									<div class={styles["first-instance-form-row"]}>
										<IconPicker
											value={iconPath() || getStableIconId(DEFAULT_ICONS[0]) || DEFAULT_ICONS[0]}
											onSelect={setIconPath}
											uploadedIcons={uploadedIcons()}
											showHint={true}
										/>
										<div class={styles["first-instance-form-fields"]}>
											<TextFieldRoot>
												<TextFieldLabel class={styles["first-instance-label"]}>
													Instance Name
												</TextFieldLabel>
												<TextFieldInput
													value={instanceName()}
													onInput={(e) => setInstanceName(e.currentTarget.value)}
													placeholder="Enter instance name..."
													style={{ background: "var(--surface-sunken)" }}
												/>
											</TextFieldRoot>

											<div>
												<label class={styles["first-instance-label"]}>Modloader</label>
												<ModloaderSwitcher
													options={modloaderSwitcherOptions()}
													value={selectedModloader()}
													onChange={setSelectedModloader}
												/>
											</div>

											<div class={styles["first-instance-form-row--compact"]}>
												<div style={{ flex: 1 }}>
													<label class={styles["first-instance-label"]}>
														Minecraft Version
													</label>
												<Combobox
													options={versionOptions()}
													value={selectedVersion()}
													onChange={setSelectedVersion}
													placeholder="Select version..."
													itemComponent={(itemProps) => (
														<ComboboxItem item={itemProps.item}>
															{itemProps.item.rawValue}
														</ComboboxItem>
													)}
												>
													<ComboboxControl
														aria-label="Minecraft Version"
														style={{ background: "var(--surface-sunken)" }}
													>
														<ComboboxInput />
														<ComboboxTrigger />
													</ComboboxControl>
													<ComboboxContent />
												</Combobox>
												</div>

												<Show
													when={
														selectedModloader() !== "vanilla" &&
														availableLoaderVersions().length > 0
													}
												>
													<div style={{ flex: 1 }}>
														<label class={styles["first-instance-label"]}>
															{selectedModloader()} Version
														</label>
														<Combobox
															options={availableLoaderVersions().map((v) => v.version)}
															value={selectedModloaderVersion()}
															onChange={setSelectedModloaderVersion}
															placeholder={`Select ${selectedModloader()} version...`}
															itemComponent={(itemProps) => {
																const versionInfo = availableLoaderVersions().find(
																	(v) => v.version === itemProps.item.rawValue,
																);
																return (
																	<ComboboxItem item={itemProps.item}>
																		<div
																			style={{
																				display: "flex",
																			"justify-content": "space-between",
																				width: "100%",
																				"align-items": "center",
																				gap: "12px",
																			}}
																		>
																			<span>{itemProps.item.rawValue}</span>
																			<Show when={!versionInfo?.stable}>
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
															<ComboboxControl
																aria-label="Loader Version"
																style={{ background: "var(--surface-sunken)" }}
															>
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
								</div>

								<div class={styles["first-instance-form-footer"]}>
									<Button
										variant="ghost"
										onClick={() => setMode("menu")}
									>
										Back
									</Button>
									<Button
										color="primary"
										onClick={handleInstallBlank}
										disabled={isInstalling() || !instanceName() || !selectedVersion()}
									>
										{isInstalling() ? "Creating..." : "Create Instance"}
									</Button>
								</div>
							</div>
						</Motion>
					</Match>
				</Switch>
			</Presence>
		</div>
	);
}

export default FirstInstanceStep;
