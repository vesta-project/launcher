import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Button from "@ui/button/button";
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
import {
	Switch,
	SwitchControl,
	SwitchThumb,
} from "@ui/switch/switch";
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
	createMemo,
} from "solid-js";
import {
	createColumnHelper,
	createSolidTable,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
} from "@tanstack/solid-table";
import "./instance-details.css";
import { type InstalledResource } from "@stores/resources";
import { formatDate } from "@utils/date";

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

	const [installedResources, { refetch: refetchResources }] = createResource(instance, async (inst) => {
		if (!inst) return [];
		return await resources.getInstalled(inst.id);
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

	// Mods Tab State
	const [resourceTypeFilter, setResourceTypeFilter] = createSignal<string>("All");
	const [resourceSearch, setResourceSearch] = createSignal("");

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

	// TanStack Table setup for Mods
	const columnHelper = createColumnHelper<InstalledResource>();

	const columns = [
		columnHelper.accessor("display_name", {
			header: "Name",
			cell: (info) => (
				<div class="res-info-cell">
					<span class="res-title">{info.getValue()}</span>
					<span class="res-path">{info.row.original.local_path.split(/[\\/]/).pop()}</span>
				</div>
			),
		}),
		columnHelper.accessor("resource_type", {
			header: "Type",
			cell: (info) => (
				<span class={`type-badge ${info.getValue().toLowerCase()}`}>
					{info.getValue()}
				</span>
			),
		}),
		columnHelper.accessor("current_version", {
			header: "Version",
		}),
		columnHelper.accessor("platform", {
			header: "Source",
			cell: (info) => <span class="capitalize">{info.getValue()}</span>,
		}),
		columnHelper.accessor("is_enabled", {
			header: () => <div style="text-align: right">Enabled</div>,
			cell: (info) => (
				<div style="display: flex; justify-content: flex-end; width: 100%;">
					<Switch
						checked={info.getValue()}
						onChange={async (enabled) => {
							try {
								await invoke("toggle_resource", {
									resourceId: info.row.original.id,
									enabled,
								});
								await refetchResources();
							} catch (e) {
								console.error("Failed to toggle resource:", e);
							}
						}}
					>
						<SwitchControl>
							<SwitchThumb />
						</SwitchControl>
					</Switch>
				</div>
			),
		}),
		columnHelper.display({
			id: "actions",
			header: "",
			cell: (info) => (
				<div style="display: flex; justify-content: flex-end;">
					<Button
						variant="ghost"
						size="icon"
						onClick={async () => {
							if (
								confirm(
									`Are you sure you want to delete ${info.row.original.display_name}? This will remove the file from your instance.`,
								)
							) {
								try {
									await invoke("delete_resource", {
										instanceId: info.row.original.instance_id,
										resourceId: info.row.original.id,
									});
									await refetchResources();
								} catch (e) {
									console.error("Failed to delete resource:", e);
								}
							}
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polyline points="3 6 5 6 21 6" />
							<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
							<line x1="10" y1="11" x2="10" y2="17" />
							<line x1="14" y1="11" x2="14" y2="17" />
						</svg>
					</Button>
				</div>
			),
		}),
	];

	const filteredData = createMemo(() => {
		const data = installedResources() || [];
		return data.filter((res) => {
			const matchesType =
				resourceTypeFilter() === "All" ||
				res.resource_type.toLowerCase() === resourceTypeFilter().toLowerCase();
			const matchesSearch =
				res.display_name.toLowerCase().includes(resourceSearch().toLowerCase()) ||
				res.local_path.toLowerCase().includes(resourceSearch().toLowerCase());
			return matchesType && matchesSearch;
		});
	});

	const table = createSolidTable({
		get data() {
			return filteredData();
		},
		columns,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
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

		const unlistenResources = await listen("resources-updated", (event) => {
			if (event.payload === instance()?.id) {
				refetchResources();
			}
		});

		onCleanup(() => {
			unlisten();
			unlistenResources();
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
								<header class="instance-details-header" classList={{ shrunk: activeTab() !== "home" }}>
									<div class="header-background" 
										style={{ 
											"background-image": (inst().iconPath || "").startsWith("linear-gradient") 
												? (inst().iconPath || "")
												: `url('${inst().iconPath || DEFAULT_ICONS[0]}')`
										}} 
									/>
									<div class="header-content">
										<div class="header-main-info">
											<div class="header-icon"
												style={
													(inst().iconPath || "").startsWith("linear-gradient")
														? { background: inst().iconPath || "" }
														: { "background-image": `url('${inst().iconPath || DEFAULT_ICONS[0]}')` }
												}
											/>
											<div class="header-text">
												<h1>{inst().name}</h1>
												<p class="header-meta">
													{inst().minecraftVersion} • {inst().modloader || "Vanilla"}
												</p>
											</div>
										</div>
										<div class="header-actions">
											<Button
												onClick={isRunning() ? handleKill : handlePlay}
												disabled={busy()}
												color={isRunning() ? "destructive" : "primary"}
												variant="solid"
												size={activeTab() === "home" ? "lg" : "md"}
												class="details-play-button"
											>
												<Show when={busy()}>
													<span class="btn-spinner" />
												</Show>
												{isRunning() ? "Kill Instance" : "Play Now"}
											</Button>
										</div>
									</div>
								</header>

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
												<div class="home-grid">
													<div class="summary-card">
														<h3>Statistics</h3>
														<div class="stat-row">
															<span class="stat-label">Total Playtime</span>
															<span class="stat-value">{inst().totalPlaytimeMinutes ?? 0} mins</span>
														</div>
														<div class="stat-row">
															<span class="stat-label">Last Played</span>
															<span class="stat-value">
																{inst().lastPlayed ? formatDate(inst().lastPlayed as string) : "Never"}
															</span>
														</div>
														<div class="stat-row">
															<span class="stat-label">Created</span>
															<span class="stat-value">
																{inst().createdAt ? formatDate(inst().createdAt as string) : "—"}
															</span>
														</div>
													</div>

													<div class="summary-card">
														<h3>Configuration</h3>
														<div class="stat-row">
															<span class="stat-label">Memory</span>
															<span class="stat-value">{inst().memoryMb} MB</span>
														</div>
														<div class="stat-row">
															<span class="stat-label">Resources</span>
															<span class="stat-value">{(installedResources() || []).length} items</span>
														</div>
														<div class="stat-row">
															<span class="stat-label">Status</span>
															<span class="stat-value capitalize">{inst().installationStatus || "Unknown"}</span>
														</div>
													</div>

													<div class="summary-card full-width">
														<h3>Environment</h3>
														<p class="env-path"><code>{inst().gameDirectory}</code></p>
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
											<div class="mods-toolbar">
												<div class="toolbar-left">
													<div class="filter-group">
														<For each={[
															{ id: "All", label: "All" },
															{ id: "mod", label: "Mods" },
															{ id: "resourcepack", label: "Resource Packs" },
															{ id: "shader", label: "Shaders" }
														]}>
															{(option) => (
																<button
																	class="filter-btn"
																	classList={{ active: resourceTypeFilter() === option.id }}
																	onClick={() => setResourceTypeFilter(option.id)}
																>
																	{option.label}
																</button>
															)}
														</For>
													</div>
													<div class="search-box">
														<input 
															type="text" 
															placeholder="Search resources..." 
															value={resourceSearch()}
															onInput={(e) => setResourceSearch(e.currentTarget.value)}
														/>
													</div>
												</div>
												<div class="toolbar-actions">
													<Button 
														size="sm"
														variant="outline"
														onClick={async () => {
															const inst = instance();
															if (inst) {
																setBusy(true);
																try {
																	await invoke("sync_instance_resources", {
																		instanceId: inst.id,
																		instanceSlug: slug(),
																		gameDir: inst.gameDirectory
																	});
																	await refetchResources();
																} catch (e) {
																	console.error("Sync failed:", e);
																}
																setBusy(false);
															}
														}}
													>
														Sync Folders
													</Button>
													<Button 
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
														Browse More
													</Button>
												</div>
											</div>

											<div class="installed-resources-list">
												<Show when={installedResources.loading}>
													<Skeleton class="skeleton-mods" />
												</Show>
												<Show when={!installedResources.loading}>
													<div class="tanstack-table-container">
														<table class="vesta-table">
															<thead>
																<For each={table.getHeaderGroups()}>
																	{(headerGroup) => (
																		<tr>
																			<For each={headerGroup.headers}>
																				{(header) => (
																					<th>
																						{header.isPlaceholder
																							? null
																							: flexRender(
																									header.column.columnDef.header,
																									header.getContext(),
																								)}
																					</th>
																				)}
																			</For>
																		</tr>
																	)}
																</For>
															</thead>
															<tbody>
																<For each={table.getRowModel().rows}>
																	{(row) => (
																		<tr classList={{ "row-disabled": !row.original.is_enabled }}>
																			<For each={row.getVisibleCells()}>
																				{(cell) => (
																					<td>
																						{flexRender(
																							cell.column.columnDef.cell,
																							cell.getContext(),
																						)}
																					</td>
																				)}
																			</For>
																		</tr>
																	)}
																</For>
															</tbody>
														</table>
														
														<Show when={table.getRowModel().rows.length === 0}>
															<div class="mods-empty-state">
																<p>No {resourceTypeFilter() !== "All" ? resourceTypeFilter().toLowerCase() + "s" : "resources"} found.</p>
															</div>
														</Show>
													</div>
												</Show>
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
																onInput={(e: any) => setName(e.currentTarget.value)}
															/>
														</TextFieldRoot>
													</div>
												</div>

												<div class="settings-field">
													<TextFieldRoot>
														<TextFieldLabel>Java Arguments</TextFieldLabel>
														<TextFieldInput
															value={javaArgs()}
															onInput={(e: any) => setJavaArgs(e.currentTarget.value)}
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
														<div class="slider__header">
															<SliderLabel>Memory Allocation</SliderLabel>
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
													<Button
														onClick={handleSave}
														disabled={saving()}
													>
														{saving() ? "Saving…" : "Save Settings"}
													</Button>
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
