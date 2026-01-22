import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, confirm } from "@tauri-apps/plugin-dialog";
import Button from "@ui/button/button";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import {
	Popover,
	PopoverCloseButton,
	PopoverContent,
	PopoverTrigger,
} from "@ui/popover/popover";
import {
	Combobox,
	ComboboxContent,
	ComboboxItem,
	ComboboxInput,
	ComboboxControl,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
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
import {
	Checkbox,
} from "@ui/checkbox/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { resources, findBestVersion, type ResourceVersion, type InstalledResource } from "@stores/resources";
import {
	DEFAULT_ICONS,
	duplicateInstance,
	getInstanceBySlug,
	getMinecraftVersions,
	isInstanceRunning,
	killInstance,
	launchInstance,
	repairInstance,
	resetInstance,
	updateInstance,
	updateInstanceModpackVersion,
	unlinkInstance,
	type PistonMetadata,
	type GameVersionMetadata,
	type LoaderVersionInfo,
} from "@utils/instances";
import {
	batch,
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
import { formatDate } from "@utils/date";
import { ExportDialog } from "./components/ExportDialog";

type TabType = "home" | "console" | "resources" | "settings" | "versioning";

interface InstanceDetailsProps {
	slug?: string; // Optional - can come from props or router params
}

const ResourceIcon = (props: { record?: any, name: string }) => {
	const [iconUrl, setIconUrl] = createSignal<string | null>(null);
	
	const displayChar = createMemo(() => {
		const match = props.name.match(/[a-zA-Z]/);
		return match ? match[0].toUpperCase() : props.name.charAt(0).toUpperCase() || "?";
	});

	createEffect(() => {
		if (props.record?.icon_data) {
			const blob = new Blob([new Uint8Array(props.record.icon_data)]);
			const url = URL.createObjectURL(blob);
			setIconUrl(url);
			onCleanup(() => URL.revokeObjectURL(url));
		} else if (props.record?.icon_url) {
			setIconUrl(props.record.icon_url);
		} else {
			setIconUrl(null);
		}
	});

	return (
		<Show 
			when={iconUrl()} 
			fallback={<div class="res-icon-placeholder">{displayChar()}</div>}
		>
			{(url) => (
				<img 
					src={url()} 
					alt={props.name || "Resource Icon"} 
					class="res-icon" 
				/>
			)}
		</Show>
	);
};

export default function InstanceDetails(props: InstanceDetailsProps & { setRefetch?: (fn: () => Promise<void>) => void }) {
	const loadersList = [
		{ label: "Vanilla", value: "vanilla" },
		{ label: "Fabric", value: "fabric" },
		{ label: "Forge", value: "forge" },
		{ label: "NeoForge", value: "neoforge" },
		{ label: "Quilt", value: "quilt" }
	];

	// Handle slug from props first, then fallback to router params
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

	const [installedResources, { refetch: refetchResources, mutate: mutateResources }] = createResource(instance, async (inst) => {
		if (!inst) return [];
		return await resources.getInstalled(inst.id);
	});

	const [projectRecords] = createResource(installedResources, async (resourcesList) => {
		if (!resourcesList || resourcesList.length === 0) return {};
		const ids = resourcesList
			.filter(r => r.remote_id && r.platform !== 'manual' && r.platform !== 'unknown')
			.map(r => r.remote_id);
		
		if (ids.length === 0) return {};
		
		try {
			const records: any[] = await invoke("get_cached_resource_projects", { ids });
			const map: Record<string, any> = {};
			for (const r of records) {
				map[r.id] = r;
			}
			return map;
		} catch (e) {
			console.error("Failed to fetch project records:", e);
			return {};
		}
	});

	// Register refetch callback with router so reload button can trigger it
	const handleRefetch = async () => {
		await Promise.all([refetch(), refetchResources()]);
	};

	onMount(() => {
		router()?.setRefetch(handleRefetch);
		if (props.setRefetch) {
			props.setRefetch(handleRefetch);
		}
	});

	onCleanup(() => {
		router()?.setRefetch(() => Promise.resolve());
	});

	// Tab state - initialized from query param if available
	const [activeTab, setActiveTab] = createSignal<TabType>("home");
	const [showExportDialog, setShowExportDialog] = createSignal(false);

	// Sync tab state with router params
	createEffect(() => {
		const params = router()?.currentParams.get();
		const tab = params?.activeTab as TabType | undefined;
		if (tab && ["home", "console", "resources", "settings", "versioning"].includes(tab)) {
			setActiveTab(tab);
		} else {
			// Default to home if no tab specified
			setActiveTab("home");
		}
	});

	// Running state
	const [isRunning, setIsRunning] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	let lastSelectedRowId: string | null = null;

	const handleRowClick = (row: any, event: MouseEvent) => {
		const rowId = row.id;

		if (event.shiftKey && lastSelectedRowId) {
			const rows = table.getRowModel().rows;
			const lastIndex = rows.findIndex(r => r.id === lastSelectedRowId);
			const currentIndex = rows.findIndex(r => r.id === rowId);

			if (lastIndex !== -1 && currentIndex !== -1) {
				const start = Math.min(lastIndex, currentIndex);
				const end = Math.max(lastIndex, currentIndex);
				const rowSelection: Record<string, boolean> = { ...resources.state.selection };

				for (let i = start; i <= end; i++) {
					rowSelection[rows[i].id] = true;
				}
				resources.batchSetSelection(rowSelection);
			}
		} else if (event.ctrlKey || event.metaKey) {
			row.toggleSelected();
		} else {
			// Normal click - navigate
			if (row.original.remote_id && row.original.platform !== 'manual' && row.original.platform !== 'unknown') {
				const inst = instance();
				if (inst) {
					resources.setInstance(inst.id);
					resources.setGameVersion(inst.minecraftVersion);
					resources.setLoader(inst.modloader);
				}

				router()?.navigate("/resource-details", {
					projectId: row.original.remote_id,
					platform: row.original.platform
				});
			}
		}

		lastSelectedRowId = rowId;
	};

	const handleBatchDelete = async () => {
		const selectedCount = Object.keys(resources.state.selection).length;
		const inst = instance();
		if (selectedCount === 0 || !inst) return;

		const confirmed = await confirm(`Are you sure you want to delete ${selectedCount} selected resources?`);
		if (!confirmed) return;

		setBusy(true);
		try {
			const selectedIds = Object.keys(resources.state.selection).map(Number);
			for (const id of selectedIds) {
				await invoke("delete_resource", { instanceId: inst.id, resourceId: id });
			}
			resources.clearSelection();
			await refetchResources();
		} catch (e) {
			console.error("Batch delete failed:", e);
		} finally {
			setBusy(false);
		}
	};

	const handleBatchUpdate = async () => {
		const selectedCount = Object.keys(resources.state.selection).length;
		if (selectedCount === 0) return;

		const selectedIds = Object.keys(resources.state.selection).map(Number);
		const toUpdate = selectedIds.filter(id => updates()[id]);

		if (toUpdate.length === 0) return;

		setBusy(true);
		try {
			for (const id of toUpdate) {
				const res = (installedResources() || []).find(r => r.id === id);
				const update = updates()[id];
				if (res && update) {
					await handleUpdate(res, update);
				}
			}
			resources.clearSelection();
		} catch (e) {
			console.error("Batch update failed:", e);
		} finally {
			setBusy(false);
		}
	};

	// Console state
	const [lines, setLines] = createSignal<string[]>([]);
	let consoleRef: HTMLDivElement | undefined;

	// Resources Tab State
	const [resourceTypeFilter, setResourceTypeFilter] = createSignal<string>("All");
	const [resourceSearch, setResourceSearch] = createSignal("");
	const [updates, setUpdates] = createSignal<Record<number, ResourceVersion>>({});
	const [checkingUpdates, setCheckingUpdates] = createSignal(false);
	const [lastCheckTime, setLastCheckTime] = createSignal<number>(0);

	// Modpack versions for picker
	const [selectedModpackVersionId, setSelectedModpackVersionId] = createSignal<string | null>(null);
	const [mcVersions] = createResource(getMinecraftVersions);
	const [selectedMcVersion, setSelectedMcVersion] = createSignal("");
	const [selectedLoader, setSelectedLoader] = createSignal("vanilla");
	const [selectedLoaderVersion, setSelectedLoaderVersion] = createSignal("");

	const [modpackVersions, { refetch: refetchModpackVersions }] = createResource(
		() => {
			const inst = instance();
			return { 
				active: activeTab() === "versioning" || activeTab() === "resources", 
				id: inst?.modpackId, 
				platform: inst?.modpackPlatform 
			};
		},
		async (params) => {
			if (!params.active || !params.id || !params.platform) return [];
			try {
				const vs = await resources.getVersions(params.platform as any, params.id);
				// If we don't have a selected ID yet, set it to the installed one
				if (activeTab() === "versioning" && !selectedModpackVersionId()) {
					const installedVid = instance()?.modpackVersionId;
					const match = vs.find(v => v.id === installedVid || v.version_number === installedVid);
					setSelectedModpackVersionId(match ? match.id : installedVid || null);
				}
				return vs;
			} catch (e) {
				console.error("Failed to fetch modpack versions:", e);
				return [];
			}
		}
	);

	const selectedModpackVersion = () => 
		modpackVersions()?.find(v => v.id === selectedModpackVersionId() || v.version_number === selectedModpackVersionId());

	const searchableModpackVersions = createMemo(() => {
		return (modpackVersions() || []).map((v) => ({
			...v,
			searchString: `${v.version_number} ${v.game_versions.join(" ")} ${v.loaders.join(" ")} ${v.id}`,
		}));
	});

	const searchableMcVersions = createMemo(() => {
		return (mcVersions()?.game_versions || []).map((v) => ({
			...v,
			searchString: v.id,
		}));
	});

	// Initialize standard version picks
	createEffect(() => {
		const inst = instance();
		const tab = activeTab();
		if (inst && tab === "versioning") {
			// If mc version isn't set yet (initial load of tab for this instance), set it
			if (!selectedMcVersion()) {
				batch(() => {
					setSelectedMcVersion(inst.minecraftVersion);
					setSelectedLoader((inst.modloader || "vanilla").toLowerCase());
					setSelectedLoaderVersion(inst.modloaderVersion || "");
					
					if (inst.modpackId && !selectedModpackVersionId()) {
						setSelectedModpackVersionId(inst.modpackVersionId || null);
					}
				});
			}
		}
	});

	// Reset selections when switching instances
	createEffect(() => {
		const slug = router()?.currentParams.get()?.slug;
		if (slug) {
			setSelectedMcVersion("");
			setSelectedLoader("vanilla");
			setSelectedLoaderVersion("");
			setSelectedModpackVersionId(null);
		}
	});

	const updateModpackVersion = async (versionId: string) => {
		const inst = instance();
		if (!inst) return;
		
		setBusy(true);
		try {
			await updateInstanceModpackVersion(inst.id, versionId);
			// Repair fetches the files for the newly set version
			await repairInstance(inst.id);
			await refetch();
		} catch (e) {
			console.error("Failed to update modpack version:", e);
		} finally {
			setBusy(false);
		}
	};

	const rolloutModpackUpdate = async () => {
		const vid = selectedModpackVersionId();
		if (!vid) return;
		await updateModpackVersion(vid);
	};

	const handleUnlink = async () => {
		const inst = instance();
		if (!inst) return;

		const confirmed = await confirm("Are you sure you want to unlink this instance from the modpack? You will no longer receive updates from the platform, but your files will remain intact.");
		if (!confirmed) return;

		setBusy(true);
		try {
			await unlinkInstance(inst);
			await refetch();
		} catch (e) {
			console.error("Failed to unlink instance:", e);
		} finally {
			setBusy(false);
		}
	};

	const handleStandardUpdate = async () => {
		const inst = instance();
		if (!inst) return;
		
		setBusy(true);
		try {
			// updateInstance expects full Instance object
			await updateInstance({
				...inst,
				minecraftVersion: selectedMcVersion(),
				modloader: selectedLoader().toLowerCase() === "vanilla" ? null : selectedLoader(),
				modloaderVersion: selectedLoader().toLowerCase() === "vanilla" ? null : selectedLoaderVersion()
			});
			await repairInstance(inst.id);
			await refetch();
		} catch (e) {
			console.error("Failed to update instance version:", e);
		} finally {
			setBusy(false);
		}
	}

	// Auto-resync and check updates when entering resources tab
	createEffect(async () => {
		const tab = activeTab();
		const inst = instance();
		if (tab === "resources" && inst && !busy()) {
			// Always sync folders when switching to resources tab
			try {
				await invoke("sync_instance_resources", {
					instanceId: inst.id,
					instanceSlug: slug(),
					gameDir: inst.gameDirectory
				});
				await refetchResources();
			} catch (e) {
				console.error("Auto-sync failed:", e);
			}

			// Then check for updates if needed
			const now = Date.now();
			if (!installedResources.loading && !checkingUpdates() && (now - lastCheckTime() > 5 * 60 * 1000)) {
				checkUpdates();
			}
		}
	});

	const checkUpdates = async () => {
		const inst = instance();
		if (!inst || checkingUpdates()) return;

		setCheckingUpdates(true);
		
		// If modpack is linked, refresh versions resource
		if (inst.modpackId) {
			console.log(`[InstanceDetails] Refreshing modpack versions for ${inst.modpackId}`);
			// Resource handles its own refetching if we just trigger it
			await refetchModpackVersions();
		}

		const resourcesList = installedResources();
		if (!resourcesList) {
			setCheckingUpdates(false);
			return;
		}

		setLastCheckTime(Date.now());
		console.log(`[InstanceDetails] Checking updates for ${resourcesList.length} resources on MC ${inst.minecraftVersion} (${inst.modloader})`);
		
		const newUpdates: Record<number, ResourceVersion> = {};
		
		for (const res of resourcesList) {
			if (res.is_manual || res.platform === 'manual') continue;
			try {
				// We ignore cache here because the user explicitly asked to check for updates
				const versions = await resources.getVersions(res.platform as any, res.remote_id, true);
				const best = findBestVersion(
					versions, 
					inst.minecraftVersion, 
					inst.modloader,
					res.release_type
				);
				
				if (best) {
					// Some platforms return versions in slightly different formats (string vs number)
					// Compare as strings to be safe
					if (String(best.id) !== String(res.remote_version_id)) {
						console.log(`[InstanceDetails] Update found for ${res.display_name}: ${res.current_version} -> ${best.version_number}`);
						newUpdates[res.id] = best;
					}
				}
			} catch (e) {
				console.error(`Failed to check updates for ${res.display_name}:`, e);
			}
		}
		
		console.log(`[InstanceDetails] Finished check. Found ${Object.keys(newUpdates).length} updates.`);
		setUpdates(newUpdates);
		setCheckingUpdates(false);
	};

	const handleUpdate = async (resource: InstalledResource, version: ResourceVersion) => {
		const inst = instance();
		if (!inst) return;
		
		try {
			const project = await resources.getProject(resource.platform as any, resource.remote_id);
			await resources.install(project, version, inst.id);
			
			setUpdates(prev => {
				const next = { ...prev };
				delete next[resource.id];
				return next;
			});
		} catch (e) {
			console.error("Update failed:", e);
		}
	};

	const updateAll = async () => {
		const available = updates();
		const ids = Object.keys(available).map(Number);
		if (ids.length === 0) return;

		setBusy(true);
		for (const id of ids) {
			const res = (installedResources() || []).find(r => r.id === id);
			const version = available[id];
			if (res && version) {
				await handleUpdate(res, version);
			}
		}
		setBusy(false);
	};

	// Settings form state (existing code continues...)
	const [name, setName] = createSignal<string>("");
	const [iconPath, setIconPath] = createSignal<string | null>(null);
	const [javaArgs, setJavaArgs] = createSignal<string>("");
	const [minMemory, setMinMemory] = createSignal<number[]>([2048]);
	const [maxMemory, setMaxMemory] = createSignal<number[]>([4096]);
	const [saving, setSaving] = createSignal(false);

	const selectedToUpdateCount = createMemo(() => {
		const sel = resources.state.selection;
		const ups = updates();
		return Object.keys(sel).filter(id => sel[id] && ups[Number(id)]).length;
	});

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
			setMinMemory([inst.minMemory ?? 2048]);
			setMaxMemory([inst.maxMemory ?? 4096]);
			
			// Initialize resource watcher but don't set as globally "selected" yet
			resources.clearSelection();
			resources.sync(inst.id, slug(), inst.gameDirectory || "");
		}
	});

	// Clear selection on unmount
	onCleanup(() => resources.clearSelection());

	// TanStack Table setup for Resources
	const columnHelper = createColumnHelper<InstalledResource>();

	const columns = [
		columnHelper.display({
			id: "select",
			size: 64, // Sync with CSS
			header: ({ table }) => (
				<div class="col-selection-wrapper header" onClick={(e) => e.stopPropagation()}>
					<Checkbox
						class="header-checkbox"
						checked={table.getIsAllPageRowsSelected()}
						indeterminate={table.getIsSomePageRowsSelected()}
						onChange={(checked) => {
							table.toggleAllPageRowsSelected(!!checked);
						}}
					/>
				</div>
			),
			cell: (info) => (
				<div class="col-selection-wrapper" onClick={(e) => e.stopPropagation()}>
					<div class="select-icon-container">
						<ResourceIcon 
							record={projectRecords()?.[info.row.original.remote_id]} 
							name={info.row.original.display_name} 
						/>
						<Checkbox
							class="row-checkbox"
							checked={info.row.getIsSelected()}
							disabled={!info.row.getCanSelect()}
							onChange={(checked) => {
								info.row.toggleSelected(!!checked);
							}}
						/>
					</div>
				</div>
			),
		}),
		columnHelper.accessor("display_name", {
			header: "Name",
			size: 250, // Updated to match CSS precisely
			cell: (info) => (
				<div class="res-info-cell">
					<div class="res-title-group">
						<span class="res-title">{info.getValue()}</span>
						<span class="res-path">{info.row.original.local_path.split(/[\\/]/).pop()}</span>
					</div>
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
			cell: (info) => {
				const currentUpdate = () => updates()[info.row.original.id];
				return (
					<div class="version-cell">
						<span>{info.getValue()}</span>
						<Show when={currentUpdate()}>
							<Tooltip placement="top">
								<TooltipTrigger
									as={Button}
									variant="ghost"
									class="update-btn"
									disabled={busy()}
									onClick={(e: MouseEvent) => {
										e.stopPropagation();
										const u = currentUpdate();
										if (u) handleUpdate(info.row.original, u);
									}}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
								</TooltipTrigger>
								<TooltipContent>
									Update to {currentUpdate()?.version_number}
								</TooltipContent>
							</Tooltip>
						</Show>
					</div>
				);
			},
		}),
		columnHelper.accessor("is_enabled", {
			header: () => <div style="text-align: right">Enabled</div>,
			cell: (info) => (
				<div 
					style="display: flex; justify-content: flex-end; width: 100%;"
					onClick={(e) => e.stopPropagation()}
				>
					<Switch
						checked={info.getValue()}
						onChange={async (enabled) => {
							const previous = installedResources.latest;
							// Optimistic update
							mutateResources((prev) => 
								prev?.map(r => r.id === info.row.original.id ? { ...r, is_enabled: enabled } : r)
							);

							try {
								await invoke("toggle_resource", {
									resourceId: info.row.original.id,
									enabled,
								});
								// Silently refetch in background to stay in sync
								refetchResources();
							} catch (e) {
								console.error("Failed to toggle resource:", e);
								// Rollback
								mutateResources(previous);
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
				<div 
					style="display: flex; justify-content: flex-end;"
					onClick={(e) => e.stopPropagation()}
				>
					<Button
						variant="ghost"
						size="icon"
						onClick={async () => {
							if (
								await confirm(
									`Are you sure you want to delete ${info.row.original.display_name}? This will remove the file from your instance.`,
								)
							) {
								const previous = installedResources.latest;
								// Optimistic remove
								mutateResources((prev) => 
									prev?.filter(r => r.id !== info.row.original.id)
								);

								try {
									await invoke("delete_resource", {
										instanceId: info.row.original.instance_id,
										resourceId: info.row.original.id,
									});
									refetchResources();
								} catch (e) {
									console.error("Failed to delete resource:", e);
									// Rollback
									mutateResources(previous);
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
		const search = resourceSearch().toLowerCase();
		return data.filter((res) => {
			const matchesType =
				resourceTypeFilter() === "All" ||
				res.resource_type.toLowerCase() === resourceTypeFilter().toLowerCase();
			const matchesSearch =
				res.display_name.toLowerCase().includes(search) ||
				res.local_path.toLowerCase().includes(search) ||
				res.resource_type.toLowerCase().includes(search);
			return matchesType && matchesSearch;
		});
	});

	const table = createSolidTable({
		get data() {
			return filteredData();
		},
		columns,
		state: {
			get rowSelection() {
				return resources.state.selection;
			},
			get sorting() {
				return resources.state.sorting;
			},
		},
		onRowSelectionChange: (updater) => {
			batch(() => {
				if (typeof updater === 'function') {
					const result = updater(resources.state.selection);
					resources.batchSetSelection(result);
				} else {
					resources.batchSetSelection(updater);
				}
			});
		},
		onSortingChange: (updater) => {
			if (typeof updater === 'function') {
				const result = updater(resources.state.sorting);
				resources.setSorting(result);
			} else {
				resources.setSorting(updater);
			}
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getRowId: (row) => row.id.toString(),
		enableRowSelection: true,
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
			const inst = instance();
			if (inst && event.payload === inst.id) {
				refetchResources();
				resources.fetchInstalled(inst.id);
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
			fresh.minMemory = minMemory()[0];
			fresh.maxMemory = maxMemory()[0];
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

	const openInstanceFolder = async () => {
		try {
			await invoke("open_instance_folder", { instanceIdSlug: slug() });
		} catch (e) {
			console.error("Failed to open instance folder:", e);
		}
	};

	// Handle tab changes - use navigate to support history (back/forward)
	const handleTabChange = (tab: TabType) => {
		if (tab === activeTab()) return;

		router()?.navigate("/instance", { 
			...router()?.currentParams.get(),
			activeTab: tab 
		});
	};

	const [isScrolled, setIsScrolled] = createSignal(false);

	const handleScroll = (e: Event) => {
		const target = e.currentTarget as HTMLElement;
		// Detect exactly when the toolbar hits the top (approx 115-120px) 
		// depending on header shrunk height (80) + padding (24) + margin (16)
		setIsScrolled(target.scrollTop > 115);
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
						classList={{ active: activeTab() === "resources" }}
						onClick={() => handleTabChange("resources")}
					>
						Resources
					</button>
					<button
						classList={{ active: activeTab() === "versioning" }}
						onClick={() => handleTabChange("versioning")}
					>
						Version
					</button>
					<button
						classList={{ active: activeTab() === "settings" }}
						onClick={() => handleTabChange("settings")}
					>
						Settings
					</button>
				</nav>
			</aside>

			<main class="instance-details-content" onScroll={handleScroll}>
				<div class="content-wrapper">
					<Show when={instance.loading && !instance.latest}>
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

					<Show when={instance.latest}>
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
													<Show when={inst().modpackId}>
														<span class="linkage-badge" title={`Linked to ${inst().modpackPlatform} modpack`}>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; opacity: 0.8;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
															Linked
														</span>
													</Show>
												</p>
											</div>
										</div>
										<div class="header-actions">
											<Button
												variant="ghost"
												size="md"
												onClick={openInstanceFolder}
												title="Open Folder"
												class="header-square-button"
											>
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="18"
													height="18"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
												</svg>
											</Button>
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
															<span class="stat-value">{inst().minMemory}/{inst().maxMemory} MB</span>
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
										<Show when={instance.loading && !instance.latest}>
											<Skeleton class="skeleton-console" />
										</Show>
										<Show when={instance.latest}>
											<section class={`tab-console ${instance.loading ? "refetching" : ""}`}>
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

									<Show when={activeTab() === "resources"}>
										<section class="tab-resources">
											<div class="resources-toolbar-v2" classList={{ "is-stuck": isScrolled() }}>
												<div class="toolbar-search-filter">
													<div class="filter-group">
														<For each={[
															{ id: "All", label: "All" },
															{ id: "mod", label: "Mods" },
															{ id: "resourcepack", label: "Packs" },
															{ id: "shader", label: "Shaders" },
															{ id: "datapack", label: "Datapacks" }
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
															placeholder="Search installed..." 
															value={resourceSearch()}
															onInput={(e) => setResourceSearch(e.currentTarget.value)}
														/>
													</div>
												</div>

												<Show when={Object.values(resources.state.selection).some(v => v)} fallback={
													<div class="toolbar-actions-v2">
														<Button 
															size="sm"
															variant="ghost"
															class="check-updates-btn"
															onClick={checkUpdates}
															disabled={checkingUpdates() || busy()}
														>
															<Show when={checkingUpdates()} fallback={
																<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" classList={{ "animate-spin": checkingUpdates() }}><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
															}>
																<span class="checking-updates-spinner" />
															</Show>
															{checkingUpdates() ? "Checking..." : "Check for Updates"}
														</Button>

														<Show when={Object.keys(updates()).length > 0}>
															<Button 
																size="sm"
																color="primary"
																variant="solid"
																class="update-all-btn"
																onClick={updateAll}
																disabled={busy()}
															>
																<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
																Update All ({Object.keys(updates()).length})
															</Button>
														</Show>

														<div class="spacer" style={{ flex: 1 }} />

														<Button 
															size="sm"
															variant="outline"
															class="browse-resources-btn"
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
															<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
															Browse Resources
														</Button>
													</div>
												}>
													<div class="selection-action-bar">
														<div class="selection-info">
															<button class="clear-selection" onClick={() => resources.clearSelection()}>
																<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
															</button>
															<span class="selection-count">{Object.values(resources.state.selection).filter(v => v).length} items selected</span>
														</div>
														<div class="selection-actions">
															<Button size="sm" variant="ghost" onClick={handleBatchUpdate} disabled={busy() || selectedToUpdateCount() === 0}>
																<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
																Update Selected ({selectedToUpdateCount()})
															</Button>
															<Button size="sm" variant="ghost" class="delete-selected" onClick={handleBatchDelete} disabled={busy()}>
																<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
																Delete Selected
															</Button>
														</div>
													</div>
												</Show>
											</div>

											<div class="installed-resources-list">
												<Show when={installedResources.loading && !installedResources.latest}>
													<Skeleton class="skeleton-resources" />
												</Show>
												<Show when={installedResources.latest}>
													<div class={`vesta-table-container ${installedResources.loading ? "refetching" : ""}`}>
														<table class="vesta-table">
															<thead>
																<For each={table.getHeaderGroups()}>
																	{(headerGroup) => (
																		<tr>
																			<For each={headerGroup.headers}>
																	{(header) => (
																					<th 
																						style={{ 
																							width: header.getSize() === 150 ? "auto" : `${header.getSize()}px`,
																							"min-width": `${header.column.columnDef.minSize || 0}px`,
																							"max-width": header.column.columnDef.maxSize ? `${header.column.columnDef.maxSize}px` : "none"
																						}}
																					>
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
																		<tr
																			classList={{ 
																				"row-disabled": !row.original.is_enabled,
																				"row-selected": row.getIsSelected() 
																			}}
																			onClick={(e) => handleRowClick(row, e)}
																			style={{
																				cursor: (row.original.remote_id && row.original.platform !== 'manual' && row.original.platform !== 'unknown')
																					? 'pointer'
																					: 'default'
																			}}
																		>
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
															<div class="resources-empty-state">
																<p>No {resourceTypeFilter() !== "All" ? resourceTypeFilter().toLowerCase() + "s" : "resources"} found.</p>
															</div>
														</Show>
													</div>
												</Show>
											</div>
										</section>
									</Show>

									<Show when={activeTab() === "versioning"}>
										<div class="versioning-tab">
											<div class="version-info-card">
												<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
													<h3 style="margin: 0;">{inst().modpackId ? "Modpack Management" : "Instance Management"}</h3>
												</div>
												<p class="section-desc">Manage the core game version and engine for this instance.</p>
												
												<div class="management-grid">
													{/* Linked Modpack Section */}
													<Show when={inst().modpackId}>
														<div class="mgmt-action version-management">
															<div class="mgmt-text" style="display: flex; flex-direction: column; gap: 12px; flex: 1;">
																<div style="display: flex; justify-content: space-between; align-items: center;">
																	<div style="display: flex; gap: 12px; align-items: center;">
																		<Show when={inst().modpackIconUrl}>
																			<img 
																				src={inst().modpackIconUrl || undefined} 
																				alt="Modpack Icon"
																				style="width: 32px; height: 32px; border-radius: 8px; background: rgba(0,0,0,0.2);" 
																			/>
																		</Show>
																		<div style="display: flex; flex-direction: column;">
																			<h4 style="margin: 0">Linked Modpack: {inst().modpackPlatform === "modrinth" ? "Modrinth" : "CurseForge"}</h4>
																			<p style="margin: 0; font-size: 0.8rem; opacity: 0.7;">Project ID: {inst().modpackId}</p>
																		</div>
																	</div>
																	<div style="display: flex; gap: 8px;">
																		<Button 
																			variant="ghost" 
																			size="sm"
																			onClick={() => checkUpdates()} 
																			disabled={checkingUpdates()}
																		>
																			{checkingUpdates() ? "Checking..." : "Refresh"}
																		</Button>
																		<Button 
																			variant="ghost" 
																			size="sm"
																			onClick={() => handleUnlink()}
																			disabled={busy()}
																			color="destructive"
																		>
																			Unlink
																		</Button>
																	</div>
																</div>

																<div class="version-pickers" style="display: flex; gap: 16px; margin-top: 8px;">
																	<div class="picker-group">
																		<span class="picker-label">Modpack Version</span>
																		<Show when={!modpackVersions.loading} fallback={<div class="skeleton-picker" />}>
																			<Combobox<any>
																				options={searchableModpackVersions()}
																				value={searchableModpackVersions().find(v => v.id === selectedModpackVersionId() || v.version_number === selectedModpackVersionId())}
																				onChange={(v) => {
																					if (v && v.id) setSelectedModpackVersionId(v.id);
																				}}
																				optionValue="id"
																				optionTextValue="searchString"
																				placeholder="Select version..."
																				itemComponent={(p) => (
																					<ComboboxItem item={p.item}>
																						<div style="display: flex; flex-direction: column; gap: 2px;">
																							<span style="font-weight: 500;">{p.item.rawValue.version_number} ({p.item.rawValue.release_type})</span>
																							<span style="font-size: 0.75rem; opacity: 0.7;">
																								MC {p.item.rawValue.game_versions[0]} • {p.item.rawValue.loaders.join(", ")}
																							</span>
																						</div>
																					</ComboboxItem>
																				)}
																			>
																				<ComboboxControl aria-label="Modpack Version Selection" style="min-width: 220px;">
																					<ComboboxInput
																						as="input"
																						value={(() => {
																							const selected = selectedModpackVersion();
																							if (!selected) return "";
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
																		</Show>
																	</div>
																	
																	<div class="picker-group">
																		<span class="picker-label">Effective Engine</span>
																		<Show when={selectedModpackVersion()} fallback={<span class="value" style="padding: 6px 0;">—</span>}>
																			{(v) => (
																				<span class="value" style="padding: 6px 0; font-family: var(--font-mono); font-size: 0.85rem;">
																					{v().game_versions[0]} • {v().loaders?.[0] || "Vanilla"}
																				</span>
																			)}
																		</Show>
																	</div>
																</div>
															</div>

															<Show when={selectedModpackVersionId() !== inst().modpackVersionId && selectedModpackVersion()?.version_number !== inst().modpackVersionId}>
																<Button 
																	onClick={() => rolloutModpackUpdate()} 
																	disabled={busy()}
																	color="primary"
																	size="sm"
																>
																	Update Instance
																</Button>
															</Show>
														</div>
													</Show>

													{/* Version Selectors for Standard Instances */}
													<Show when={!inst().modpackId}>
														<div class="mgmt-action version-management">
															<div class="mgmt-text" style="display: flex; flex-direction: column; gap: 12px;">
																<h4 style="margin: 0">Minecraft & Modloader</h4>
																<p style="margin: 0">Change the base game version or switch between Forge/Fabric/Vanilla.</p>
																
																<div class="version-pickers" style="display: flex; gap: 16px; margin-top: 8px;">
																	<div class="picker-group">
																		<span class="picker-label">Game Version</span>
																		<Combobox<any>
																			options={searchableMcVersions()}
																			optionValue="id"
																			optionTextValue="searchString"
																			value={searchableMcVersions().find(gv => gv.id === selectedMcVersion())}
																			onChange={(val) => {
																				if (!val) return;
																				setSelectedMcVersion(val.id);
																				// Refresh loaders if needed
																				const vMeta = mcVersions()?.game_versions.find(gv => gv.id === val.id);
																				if (vMeta) {
																					setSelectedLoader("vanilla");
																					setSelectedLoaderVersion("");
																				}
																			}}
																			placeholder="Select version..."
																			itemComponent={(props) => (
																				<ComboboxItem item={props.item}>
																					{props.item.rawValue.id}
																				</ComboboxItem>
																			)}
																		>
																			<ComboboxControl aria-label="Version Picker" style="width: 156px;">
																				<ComboboxInput 
																					as="input" 
																					value={selectedMcVersion()} 
																				/>
																				<ComboboxTrigger />
																			</ComboboxControl>
																			<ComboboxContent />
																		</Combobox>
																	</div>
																	
																	<div class="picker-group">
																		<span class="picker-label">Modloader</span>
																		<Combobox<any>
																			options={loadersList}
																			optionValue="value"
																			optionTextValue="label"
																			value={loadersList.find(l => l.value === selectedLoader())}
																			onChange={(val) => {
																				if (!val) return;
																				setSelectedLoader(val.value);
																				// Pick default version for new loader
																				const vMeta = mcVersions()?.game_versions.find(gv => gv.id === selectedMcVersion());
																				if (vMeta) {
																					const loaders = vMeta.loaders[val.value] || [];
																					if (loaders.length > 0) setSelectedLoaderVersion(loaders[0].version);
																					else setSelectedLoaderVersion("");
																				}
																			}}
																			itemComponent={(props) => (
																				<ComboboxItem item={props.item}>
																					{props.item.rawValue.label}
																				</ComboboxItem>
																			)}
																		>
																			<ComboboxControl aria-label="Modloader Picker" style="width: 140px;">
																				<ComboboxInput 
																					as="input" 
																					value={loadersList.find(l => l.value === selectedLoader())?.label || selectedLoader()} 
																				/>
																				<ComboboxTrigger />
																			</ComboboxControl>
																			<ComboboxContent />
																		</Combobox>
																	</div>

																	<Show when={selectedLoader().toLowerCase() !== "vanilla"}>
																		<div class="picker-group">
																			<span class="picker-label">Loader Version</span>
																			<Combobox<any>
																				options={mcVersions()?.game_versions.find(gv => gv.id === selectedMcVersion())?.loaders[selectedLoader()] || []}
																				optionValue="version"
																				optionTextValue="version"
																				value={(mcVersions()?.game_versions.find(gv => gv.id === selectedMcVersion())?.loaders[selectedLoader()] || []).find(v => v.version === selectedLoaderVersion())}
																				onChange={(val) => val && setSelectedLoaderVersion(val.version)}
																				itemComponent={(props) => (
																					<ComboboxItem item={props.item}>
																						{props.item.rawValue.version}
																					</ComboboxItem>
																				)}
																			>
																				<ComboboxControl aria-label="Loader Version Picker" style="width: 164px;">
																					<ComboboxInput 
																						as="input" 
																						value={selectedLoaderVersion()} 
																					/>
																					<ComboboxTrigger />
																				</ComboboxControl>
																				<ComboboxContent />
																			</Combobox>
																		</div>
																	</Show>
																</div>
															</div>
															
															<Show when={
																selectedMcVersion() !== inst().minecraftVersion || 
																selectedLoader().toLowerCase() !== (inst().modloader || "vanilla").toLowerCase() || 
																(selectedLoader().toLowerCase() !== "vanilla" && selectedLoaderVersion() !== (inst().modloaderVersion || ""))
															}>
																<Button onClick={handleStandardUpdate} disabled={busy()} color="primary" size="sm">Save & Reinstall</Button>
															</Show>
														</div>
													</Show>

													<div class="mgmt-action">
														<div class="mgmt-text">
															<h4>Duplicate</h4>
															<p>Create a full copy of this instance, including all files and settings.</p>
														</div>
														<Button onClick={() => {
															const name = window.prompt("Enter name for the copy:", `${inst().name} (Copy)`);
															if (name) duplicateInstance(inst().id, name);
														}}>Duplicate</Button>
													</div>

													<div class="mgmt-action">
														<div class="mgmt-text">
															<h4>Repair</h4>
															<p>Verify all game files and mods. Missing or corrupted files will be redownloaded.</p>
														</div>
														<Button onClick={() => repairInstance(inst().id)}>Repair</Button>
													</div>

													<div class="mgmt-action danger">
														<div class="mgmt-text">
															<h4>Hard Reset</h4>
															<p>Wipe the instance directory and reinstall from scratch. <strong style="color: var(--color-danger)">Deletes all local data!</strong></p>
														</div>
														<Button variant="outline" color="destructive" onClick={async () => {
															if (await ask("Are you sure you want to perform a hard reset? This will wipe the ENTIRE instance folder and reinstall everything from scratch. Your worlds, screenshots, and configs will be DELETED.", { title: "Vesta Launcher - Hard Reset", kind: "error" })) {
																resetInstance(inst().id);
															}
														}}>Reset</Button>
													</div>
												</div>
											</div>
										</div>
									</Show>

									<Show when={activeTab() === "settings"}>
										<Show when={instance.loading && !instance.latest}>
											<div class="skeleton-settings">
												<Skeleton class="skeleton-field" />
												<Skeleton class="skeleton-field" />
											</div>
										</Show>
										<Show when={instance.latest}>
											<section class={`tab-settings ${instance.loading ? "refetching" : ""}`}>
												<h2>Instance Settings</h2>

												<div class="settings-field">
													<div class="form-row" style="align-items: flex-start;">
														<IconPicker
															value={iconPath()}
															onSelect={(icon) => setIconPath(icon)}
															uploadedIcons={uploadedIcons()}
															suggestedIcon={instance()?.modpackIconUrl}
															isSuggestedSelected={
																!!(instance()?.modpackIconUrl && 
																(iconPath() === instance()?.modpackIconUrl || iconPath() === "internal://icon"))
															}
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
														value={minMemory()}
														onChange={setMinMemory}
														minValue={512}
														maxValue={16384}
														step={512}
													>
														<div class="slider__header">
															<SliderLabel>Minimum Memory</SliderLabel>
															<SliderValueLabel />
														</div>
														<SliderTrack>
															<SliderFill />
															<SliderThumb />
														</SliderTrack>
													</Slider>
													<p class="field-hint">
														Initial RAM allocated (-Xms).
													</p>
												</div>

												<div class="settings-field">
													<Slider
														value={maxMemory()}
														onChange={setMaxMemory}
														minValue={512}
														maxValue={16384}
														step={512}
													>
														<div class="slider__header">
															<SliderLabel>Maximum Memory</SliderLabel>
															<SliderValueLabel />
														</div>
														<SliderTrack>
															<SliderFill />
															<SliderThumb />
														</SliderTrack>
													</Slider>
													<p class="field-hint">
														Maximum RAM allocated (-Xmx).
													</p>
												</div>

												<div class="settings-actions" style="display: flex; gap: 12px;">
													<Button
														onClick={handleSave}
														disabled={saving()}
													>
														{saving() ? "Saving…" : "Save Settings"}
													</Button>

													<Button
														variant="outline"
														onClick={() => setShowExportDialog(true)}
													>
														Export Instance...
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

			<Show when={instance()}>
				{(inst) => (
					<ExportDialog
						isOpen={showExportDialog()}
						onClose={() => setShowExportDialog(false)}
						instanceId={inst().id}
						instanceName={inst().name}
					/>
				)}
			</Show>
		</div>
	);
}
