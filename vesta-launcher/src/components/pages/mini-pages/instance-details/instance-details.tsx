import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import LauncherButton from "@ui/button/button";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import {
	Popover,
	PopoverCloseButton,
	PopoverContent,
	PopoverTrigger,
} from "@ui/popover/popover";
import { Skeleton } from "@ui/skeleton/skeleton";
import {
	Slider,
	SliderFill,
	SliderLabel,
	SliderThumb,
	SliderTrack,
	SliderValueLabel,
} from "@ui/slider/slider";
import {
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { resources } from "@stores/resources";
import {
	DEFAULT_ICONS,
	getInstanceBySlug,
	isInstanceRunning,
	killInstance,
	launchInstance,
	updateInstance,
} from "@utils/instances";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import "./instance-details.css";
import Button from "@ui/button/button";

type TabType = "home" | "console" | "mods" | "settings";

interface InstanceDetailsProps {
	slug?: string; // Optional - can come from props or router params
}

export default function InstanceDetails(props: InstanceDetailsProps) {
	// Get slug from props first, then fallback to router params
	const getSlug = () => {
		if (props.slug) return props.slug;
		const params = router()?.currentParams.get();
		return params?.slug as string | undefined;
	};

	const slug = () => getSlug() || "";

	const [instance, { refetch }] = createResource(slug, async (s) => {
		if (!s) return undefined;
		return await getInstanceBySlug(s);
	});

	// Register refetch callback with router so reload button can trigger it
	const handleRefetch = async () => {
		await refetch();
	};

	onMount(() => {
		router()?.setRefetch(handleRefetch);
	});

	onCleanup(() => {
		router()?.setRefetch(() => Promise.resolve());
	});

	// Local tab state - no longer synced with router props
	const [activeTab, setActiveTab] = createSignal<TabType>("home");

	// Running state
	const [isRunning, setIsRunning] = createSignal(false);
	const [busy, setBusy] = createSignal(false);

	// Console state
	const [lines, setLines] = createSignal<string[]>([]);
	let consoleRef: HTMLDivElement | undefined;

	// Settings form state
	const [name, setName] = createSignal<string>("");
	const [iconPath, setIconPath] = createSignal<string | null>(null);
	const [javaArgs, setJavaArgs] = createSignal<string>("");
	const [memoryMb, setMemoryMb] = createSignal<number[]>([2048]);
	const [saving, setSaving] = createSignal(false);

	// Create uploadedIcons array that includes current iconPath if it's an uploaded image
	const uploadedIcons = () => {
		const current = iconPath();
		// Check if current icon is uploaded (not null, not a default gradient/image)
		if (current && !DEFAULT_ICONS.includes(current)) {
			return [current];
		}
		return [];
	};

	// Check running state on mount and when instance changes
	createEffect(async () => {
		const inst = instance();
		if (inst) {
			try {
				const running = await isInstanceRunning(inst);
				setIsRunning(running);
			} catch (e) {
				console.error("Failed to check running state:", e);
			}
		}
	});

	// Sync settings form with instance data
	createEffect(() => {
		const inst = instance();
		if (inst) {
			setName(inst.name);
			setIconPath(inst.iconPath);
			setJavaArgs(inst.javaArgs ?? "");
			setMemoryMb([inst.memoryMb ?? 2048]);
		}
	});

	// Subscribe to console logs
	onMount(async () => {
		// Load last 500 lines from log file if instance is running (for re-attachment scenario)
		const inst = instance();
		if (inst) {
			try {
				const running = await isInstanceRunning(inst);
				if (running) {
					// Try to load existing log lines from file
					const logLines = (await invoke("read_instance_log", {
						instanceIdSlug: slug(),
						lastLines: 500,
					}).catch(() => [])) as string[];
					if (logLines.length > 0) {
						setLines(logLines);
					}
				}
			} catch (e) {
				console.error("Failed to load existing logs:", e);
			}
		}

		const unlisten = await listen("core://instance-log", (ev) => {
			const payload =
				(ev as { payload: Record<string, unknown> }).payload || {};
			const currentSlug = slug();

			// Handle batched format: { lines: [...] }
			if (payload.lines && Array.isArray(payload.lines)) {
				const newLines: string[] = [];
				for (const item of payload.lines as Array<{
					instance_id?: string;
					line?: string;
				}>) {
					if (item.instance_id && item.instance_id !== currentSlug) {
						continue;
					}
					if (item.line) {
						newLines.push(item.line);
					}
				}
				if (newLines.length > 0) {
					setLines((prev) => {
						const next = [...prev, ...newLines];
						// Keep last 500 lines
						if (next.length > 500) {
							return next.slice(next.length - 500);
						}
						return next;
					});
				}
				return;
			}

			// Legacy single-line format
			if (payload.instance_id && payload.instance_id !== currentSlug) {
				return;
			}

			const line =
				payload.line ??
				payload.text ??
				payload.message ??
				JSON.stringify(payload);
			setLines((prev) => {
				const next = [...prev, String(line)];
				if (next.length > 500) {
					return next.slice(next.length - 500);
				}
				return next;
			});
		});

		const unlistenLaunch = await listen("core://instance-launched", (ev) => {
			const payload = (ev as { payload: { instance_id?: string } }).payload;
			if (payload.instance_id === slug()) {
				setIsRunning(true);
				// Clear console on new launch
				setLines([]);
			}
		});

		const unlistenKill = await listen("core://instance-killed", (ev) => {
			const payload = (ev as { payload: { instance_id?: string } }).payload;
			if (payload.instance_id === slug()) {
				setIsRunning(false);
			}
		});

		// Listen for natural process exit (game closed by user)
		const unlistenExited = await listen("core://instance-exited", (ev) => {
			const payload = (ev as { payload: { instance_id?: string } }).payload;
			if (payload.instance_id === slug()) {
				setIsRunning(false);
			}
		});

		onCleanup(() => {
			unlisten();
			unlistenLaunch();
			unlistenKill();
			unlistenExited();
		});
	});

	// Auto-scroll console when lines change
	createEffect(() => {
		lines();
		setTimeout(() => {
			if (consoleRef) {
				consoleRef.scrollTop = consoleRef.scrollHeight;
			}
		}, 0);
	});

	const handlePlay = async () => {
		const inst = instance();
		if (!inst || busy()) return;
		setBusy(true);
		try {
			await launchInstance(inst);
		} catch (e) {
			console.error("Launch failed:", e);
		}
		setBusy(false);
	};

	const handleKill = async () => {
		const inst = instance();
		if (!inst || busy()) return;
		setBusy(true);
		try {
			await killInstance(inst);
		} catch (e) {
			console.error("Kill failed:", e);
		}
		setBusy(false);
	};

	const handleSave = async () => {
		const inst = instance();
		if (!inst) return;
		setSaving(true);
		try {
			const fresh = await getInstanceBySlug(slug());
			fresh.name = name();
			fresh.iconPath = iconPath();
			fresh.javaArgs = javaArgs() || null;
			fresh.memoryMb = memoryMb()[0];
			await updateInstance(fresh);
			await refetch();
		} catch (e) {
			console.error("Failed to save instance settings:", e);
		}
		setSaving(false);
	};

	// Icon path is now handled by the IconPicker component directly

	const clearConsole = () => setLines([]);

	const openLogsFolder = async () => {
		try {
			await invoke("open_logs_folder", { instanceIdSlug: slug() });
		} catch (e) {
			console.error("Failed to open logs folder:", e);
		}
	};

	// Handle tab changes - use updateQuery to avoid creating history entries
	const handleTabChange = (tab: TabType) => {
		setActiveTab(tab);
		router()?.updateQuery("activeTab", tab);
	};

	return (
		<div class="instance-details-page">
			<aside class="instance-details-sidebar">
				<nav class="instance-tabs">
					<button
						classList={{ active: activeTab() === "home" }}
						onClick={() => handleTabChange("home")}
					>
						Home
					</button>
					<button
						classList={{ active: activeTab() === "console" }}
						onClick={() => handleTabChange("console")}
					>
						Console
					</button>
					<button
						classList={{ active: activeTab() === "mods" }}
						onClick={() => handleTabChange("mods")}
					>
						Mods
					</button>
					<button
						classList={{ active: activeTab() === "settings" }}
						onClick={() => handleTabChange("settings")}
					>
						Settings
					</button>
				</nav>
			</aside>

			<main class="instance-details-content">
				<div class="content-wrapper">
					<Show when={instance.loading}>
						<div class="instance-loading">
							<Skeleton class="skeleton-header" />
							<Skeleton class="skeleton-content" />
						</div>
					</Show>
					<Show when={instance.error}>
						<div class="instance-error">
							<p>Failed to load instance: {String(instance.error)}</p>
						</div>
					</Show>

					<Show when={instance()}>
						{(inst) => (
							<>
								<Show when={activeTab() !== "settings"}>
									<header
										class="instance-header"
										classList={{ shrunk: activeTab() !== "home" }}
									>
										<div
											class="instance-header-image"
											style={
												(inst().iconPath || "").startsWith("linear-gradient")
													? {
															// biome-ignore lint/style/noNonNullAssertion: iconPath is confirmed to be a gradient string above
															background: inst().iconPath!,
														}
													: {
															"background-image": `url('${inst().iconPath || DEFAULT_ICONS[0]}')`,
														}
											}
										/>
										<div class="instance-header-content">
											<div class="instance-header-meta">
												<h1>{inst().name}</h1>
												<p class="meta-row">
													<span class="meta-label">Version:</span>{" "}
													{inst().minecraftVersion}
													{inst().modloader &&
														inst().modloader !== "vanilla" && (
															<span class="modloader-badge">
																{inst().modloader}
															</span>
														)}
												</p>
												<Show when={activeTab() === "home"}>
													<p class="meta-row">
														<span class="meta-label">Created:</span>{" "}
														{inst().createdAt
															? new Date(
																	inst().createdAt as string,
																).toLocaleDateString()
															: "—"}
													</p>
													<p class="meta-row">
														<span class="meta-label">Last Played:</span>{" "}
														{inst().lastPlayed
															? new Date(
																	inst().lastPlayed as string,
																).toLocaleDateString()
															: "Never"}
													</p>
												</Show>
											</div>
											<div class="instance-actions">
												<LauncherButton
													onClick={isRunning() ? handleKill : handlePlay}
													disabled={busy()}
													color={isRunning() ? "destructive" : "primary"}
													variant="solid"
													size={activeTab() === "home" ? "lg" : "md"}
												>
													{busy()
														? "Working..."
														: isRunning()
															? "Kill Instance"
															: "Play"}
												</LauncherButton>
											</div>
										</div>
									</header>{" "}
								</Show>
								<div class="instance-tab-content">
									<Show when={activeTab() === "home"}>
										<Show when={instance.loading}>
											<div class="skeleton-grid">
												{Array.from({ length: 7 }).map(() => (
													<Skeleton class="skeleton-item" />
												))}
											</div>
										</Show>
										<Show when={!instance.loading}>
											<section class="tab-home">
												<h2>Overview</h2>
												<div class="info-grid">
													<div class="info-item">
														<span class="info-label">Name</span>
														<span class="info-value">{inst().name}</span>
													</div>
													<div class="info-item">
														<span class="info-label">Minecraft Version</span>
														<span class="info-value">
															{inst().minecraftVersion}
														</span>
													</div>
													<div class="info-item">
														<span class="info-label">Modloader</span>
														<span class="info-value">
															{inst().modloader || "Vanilla"}
														</span>
													</div>
													<div class="info-item">
														<span class="info-label">Modloader Version</span>
														<span class="info-value">
															{inst().modloaderVersion || "—"}
														</span>
													</div>
													<div class="info-item">
														<span class="info-label">Memory</span>
														<span class="info-value">
															{inst().memoryMb} MB
														</span>
													</div>
													<div class="info-item">
														<span class="info-label">Total Playtime</span>
														<span class="info-value">
															{inst().totalPlaytimeMinutes ?? 0} minutes
														</span>
													</div>
													<div class="info-item">
														<span class="info-label">Installation Status</span>
														<span class="info-value" style={{ "text-transform": "capitalize" }}>
															{inst().installationStatus || "Unknown"}
														</span>
													</div>
												</div>
											</section>
										</Show>
									</Show>

									<Show when={activeTab() === "console"}>
										<Show when={instance.loading}>
											<Skeleton class="skeleton-console" />
										</Show>
										<Show when={!instance.loading}>
											<section class="tab-console">
												<div class="console-toolbar">
													<span class="console-title">Game Console</span>
													<div class="console-toolbar-buttons">
														<Tooltip placement="top">
															<TooltipTrigger
																onClick={openLogsFolder}
																as={Button}
															>
																📁 Logs
															</TooltipTrigger>
															<TooltipContent>
																Open logs folder in file explorer
															</TooltipContent>
														</Tooltip>
														<button
															class="console-clear"
															onClick={clearConsole}
														>
															Clear
														</button>
													</div>
												</div>
												<div class="console-output" ref={consoleRef}>
													<Show when={lines().length === 0}>
														<div class="console-placeholder">
															No output yet. Launch the game to see console
															output.
														</div>
													</Show>
													<For each={lines()}>
														{(line) => <div class="console-line">{line}</div>}
													</For>
												</div>
											</section>
										</Show>
									</Show>

									<Show when={activeTab() === "mods"}>
										<section class="tab-mods">
											<h2>Mods</h2>
											<div class="mods-actions-header">
												<p>Manage mods for this instance.</p>
												<LauncherButton 
													size="sm"
													onClick={() => {
														const inst = instance();
														if (inst) {
															resources.setInstance(inst.id);
															resources.setGameVersion(inst.minecraftVersion);
															resources.setLoader(inst.modloader);
															router()?.navigate("/resources");
														}
													}}
												>
													Browse Resources
												</LauncherButton>
											</div>
											<div class="mods-list-placeholder">
												<p class="placeholder-text">
													Installed mods list is coming soon. Use the browser to find and install new mods.
												</p>
											</div>
										</section>
									</Show>

									<Show when={activeTab() === "settings"}>
										<Show when={instance.loading}>
											<div class="skeleton-settings">
												<Skeleton class="skeleton-field" />
												<Skeleton class="skeleton-field" />
											</div>
										</Show>
										<Show when={!instance.loading}>
											<section class="tab-settings">
												<h2>Instance Settings</h2>

												<div class="settings-field">
													<div class="form-row" style="align-items: flex-start;">
														<IconPicker
															value={iconPath()}
															onSelect={(icon) => setIconPath(icon)}
															uploadedIcons={uploadedIcons()}
															allowUpload={true}
															showHint={true}
														/>
														<TextFieldRoot style="flex: 1">
															<TextFieldLabel>Instance Name</TextFieldLabel>
															<TextFieldInput
																value={name()}
																onInput={(
																	e: InputEvent & {
																		currentTarget: HTMLInputElement;
																	},
																) => setName(e.currentTarget.value)}
															/>
														</TextFieldRoot>
													</div>
												</div>

												<div class="settings-field">
													<TextFieldRoot>
														<TextFieldLabel>Java Arguments</TextFieldLabel>
														<TextFieldInput
															value={javaArgs()}
															onInput={(
																e: InputEvent & {
																	currentTarget: HTMLInputElement;
																},
															) => setJavaArgs(e.currentTarget.value)}
															placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
														/>
													</TextFieldRoot>
													<p class="field-hint">
														Custom JVM arguments for this instance.
													</p>
												</div>

												<div class="settings-field">
													<Slider
														value={memoryMb()}
														onChange={setMemoryMb}
														minValue={512}
														maxValue={16384}
														step={512}
													>
														<div class="slider-header">
															<SliderLabel>Memory</SliderLabel>
															<SliderValueLabel />
														</div>
														<SliderTrack>
															<SliderFill />
															<SliderThumb />
														</SliderTrack>
													</Slider>
													<p class="field-hint">
														Amount of RAM allocated to this instance (MB).
													</p>
												</div>

												<div class="settings-actions">
													<LauncherButton
														onClick={handleSave}
														disabled={saving()}
													>
														{saving() ? "Saving…" : "Save Settings"}
													</LauncherButton>
												</div>
											</section>
										</Show>
									</Show>
								</div>
							</>
						)}
					</Show>
				</div>
			</main>
		</div>
	);
}
