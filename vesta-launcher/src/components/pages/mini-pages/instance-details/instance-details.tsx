import { createResource, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getInstanceBySlug, updateInstance, launchInstance, killInstance, isInstanceRunning } from "@utils/instances";
import LauncherButton from "@ui/button/button";
import {
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import {
	Slider,
	SliderFill,
	SliderLabel,
	SliderThumb,
	SliderTrack,
	SliderValueLabel,
} from "@ui/slider/slider";
import "./instance-details.css";

type TabType = "home" | "console" | "mods" | "settings";

interface InstanceDetailsProps {
	slug?: string;
}

export default function InstanceDetails(props: InstanceDetailsProps) {
	const slug = () => props.slug || "";

	const [instance, { refetch }] = createResource(slug, async (s) => {
		if (!s) return undefined;
		return await getInstanceBySlug(s);
	});

	const [activeTab, setActiveTab] = createSignal<TabType>("home");

	// Running state
	const [isRunning, setIsRunning] = createSignal(false);
	const [busy, setBusy] = createSignal(false);

	// Console state
	const [lines, setLines] = createSignal<string[]>([]);
	let consoleRef: HTMLDivElement | undefined;

	// Settings form state
	const [javaArgs, setJavaArgs] = createSignal<string>("");
	const [memoryMb, setMemoryMb] = createSignal<number[]>([2048]);
	const [saving, setSaving] = createSignal(false);

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
			setJavaArgs(inst.java_args ?? "");
			setMemoryMb([inst.memory_mb ?? 2048]);
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
					const logLines = await invoke("read_instance_log", { 
						instanceId: slug(),
						lastLines: 500 
					}).catch(() => []) as string[];
					if (logLines.length > 0) {
						setLines(logLines);
					}
				}
			} catch (e) {
				console.error("Failed to load existing logs:", e);
			}
		}

		const unlisten = await listen("core://instance-log", (ev) => {
			const payload = (ev as { payload: Record<string, unknown> }).payload || {};
			const currentSlug = slug();

			// Handle batched format: { lines: [...] }
			if (payload.lines && Array.isArray(payload.lines)) {
				const newLines: string[] = [];
				for (const item of payload.lines as Array<{ instance_id?: string; line?: string }>) {
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

			const line = payload.line ?? payload.text ?? payload.message ?? JSON.stringify(payload);
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
			fresh.java_args = javaArgs() || null;
			fresh.memory_mb = memoryMb()[0];
			await updateInstance(fresh);
			await refetch();
		} catch (e) {
			console.error("Failed to save instance settings:", e);
		}
		setSaving(false);
	};

	const clearConsole = () => setLines([]);

	const openLogsFolder = async () => {
		try {
			await invoke("open_logs_folder", { instanceId: slug() });
		} catch (e) {
			console.error("Failed to open logs folder:", e);
		}
	};

	return (
		<div class="instance-details-page">
			<aside class="instance-details-sidebar">
				<nav class="instance-tabs">
					<button classList={{ active: activeTab() === "home" }} onClick={() => setActiveTab("home")}>
						Home
					</button>
					<button classList={{ active: activeTab() === "console" }} onClick={() => setActiveTab("console")}>
						Console
					</button>
					<button classList={{ active: activeTab() === "mods" }} onClick={() => setActiveTab("mods")}>
						Mods
					</button>
					<button classList={{ active: activeTab() === "settings" }} onClick={() => setActiveTab("settings")}>
						Settings
					</button>
				</nav>
			</aside>

			<main class="instance-details-content">
				<Show when={instance.loading}>
					<div class="instance-loading">Loading instance…</div>
				</Show>

				<Show when={instance.error}>
					<div class="instance-error">
						<p>Failed to load instance: {String(instance.error)}</p>
					</div>
				</Show>

				<Show when={instance()}>
					{(inst) => (
						<>
							<header class="instance-header">
								<div
									class="instance-header-image"
									style={inst().icon_path ? { "background-image": `url('${inst().icon_path}')` } : {}}
								/>
								<div class="instance-header-meta">
									<h1>{inst().name}</h1>
									<p class="meta-row">
										<span class="meta-label">Version:</span> {inst().minecraft_version}
										{inst().modloader && inst().modloader !== "vanilla" && (
											<span class="modloader-badge">{inst().modloader}</span>
										)}
									</p>
									<p class="meta-row">
										<span class="meta-label">Created:</span>{" "}
										{inst().created_at ? new Date(inst().created_at as string).toLocaleDateString() : "—"}
									</p>
									<p class="meta-row">
										<span class="meta-label">Last Played:</span>{" "}
										{inst().last_played ? new Date(inst().last_played as string).toLocaleDateString() : "Never"}
									</p>
									<div class="instance-actions">
										<LauncherButton onClick={handlePlay} disabled={busy() || isRunning()}>
											{isRunning() ? "Running…" : "Play"}
										</LauncherButton>
										<LauncherButton onClick={handleKill} disabled={busy() || !isRunning()}>
											Kill
										</LauncherButton>
									</div>
								</div>
							</header>

							<div class="instance-tab-content">
								<Show when={activeTab() === "home"}>
									<section class="tab-home">
										<h2>Overview</h2>
										<div class="info-grid">
											<div class="info-item">
												<span class="info-label">Name</span>
												<span class="info-value">{inst().name}</span>
											</div>
											<div class="info-item">
												<span class="info-label">Minecraft Version</span>
												<span class="info-value">{inst().minecraft_version}</span>
											</div>
											<div class="info-item">
												<span class="info-label">Modloader</span>
												<span class="info-value">{inst().modloader || "Vanilla"}</span>
											</div>
											<div class="info-item">
												<span class="info-label">Modloader Version</span>
												<span class="info-value">{inst().modloader_version || "—"}</span>
											</div>
											<div class="info-item">
												<span class="info-label">Memory</span>
												<span class="info-value">{inst().memory_mb} MB</span>
											</div>
											<div class="info-item">
												<span class="info-label">Total Playtime</span>
												<span class="info-value">{inst().total_playtime_minutes} minutes</span>
											</div>
											<div class="info-item">
												<span class="info-label">Installation Status</span>
												<span class="info-value">{inst().installation_status || "Unknown"}</span>
											</div>
										</div>
									</section>
								</Show>

								<Show when={activeTab() === "console"}>
									<section class="tab-console">
										<div class="console-toolbar">
											<span class="console-title">Game Console</span>
											<div class="console-toolbar-buttons">
												<button class="console-logs" onClick={openLogsFolder} title="Open logs folder in file explorer">
													📁 Logs
												</button>
												<button class="console-clear" onClick={clearConsole}>
													Clear
												</button>
											</div>
										</div>
										<div class="console-output" ref={consoleRef}>
											<Show when={lines().length === 0}>
												<div class="console-placeholder">
													No output yet. Launch the game to see console output.
												</div>
											</Show>
											<For each={lines()}>
												{(line) => <div class="console-line">{line}</div>}
											</For>
										</div>
									</section>
								</Show>

								<Show when={activeTab() === "mods"}>
									<section class="tab-mods">
										<h2>Mods</h2>
										<p class="placeholder-text">
											Mod management is coming soon. You'll be able to browse, install, and manage mods for this instance here.
										</p>
									</section>
								</Show>

								<Show when={activeTab() === "settings"}>
									<section class="tab-settings">
										<h2>Instance Settings</h2>
										
										<div class="settings-field">
											<TextFieldRoot>
												<TextFieldLabel>Java Arguments</TextFieldLabel>
												<TextFieldInput
													value={javaArgs()}
													onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setJavaArgs(e.currentTarget.value)}
													placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
												/>
											</TextFieldRoot>
											<p class="field-hint">Custom JVM arguments for this instance.</p>
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
											<p class="field-hint">Amount of RAM allocated to this instance (MB).</p>
										</div>

										<div class="settings-actions">
											<LauncherButton onClick={handleSave} disabled={saving()}>
												{saving() ? "Saving…" : "Save Settings"}
											</LauncherButton>
										</div>
									</section>
								</Show>
							</div>
						</>
					)}
				</Show>
			</main>
		</div>
	);
}
