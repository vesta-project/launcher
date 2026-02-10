import { resolveResourceUrl } from "@utils/assets";
import { router } from "@components/page-viewer/page-viewer";
import { MiniRouter } from "@components/page-viewer/mini-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ACCOUNT_TYPE_GUEST } from "@utils/auth";
import { dialogStore } from "@stores/dialog-store";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { ResourceAvatar } from "@ui/avatar";
import { Badge } from "@ui/badge";
import { Separator } from "@ui/separator/separator";
import { SettingsCard, SettingsField } from "@components/settings";
import Button from "@ui/button/button";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import { ModpackVersionSelector } from "./modpack-version-selector";
import type { ModpackVersion } from "./modpack-version-selector";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	SelectLabel,
} from "@ui/select/select";
import { Skeleton } from "@ui/skeleton/skeleton";
import { showToast } from "@ui/toast/toast";
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
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { Checkbox } from "@ui/checkbox/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import {
	handleDuplicate,
	handleRepair,
	handleHardReset,
	handleUninstall,
	handleLaunch,
} from "~/handlers/instance-handler";
import {
	resources,
	findBestVersion,
	type ResourceVersion,
	type InstalledResource,
} from "@stores/resources";
import { pinning, isPinned as isPinnedInStore, pinPage, unpinPage } from "@stores/pinning";
import { instancesState } from "@stores/instances";
import {
	DEFAULT_ICONS,
	deleteInstance,
	duplicateInstance,
	getInstanceBySlug,
	getMinecraftVersions,
	getStableIconId,
	isDefaultIcon,
	isInstanceRunning,
	installInstance,
	killInstance,
	launchInstance,
	repairInstance,
	resetInstance,
	resumeInstanceOperation,
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
	on,
} from "solid-js";
import {
	createColumnHelper,
	createSolidTable,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
} from "@tanstack/solid-table";
import styles from "./instance-details.module.css";
import { formatDate } from "@utils/date";
import { ExportDialog } from "@ui/export-dialog";

// Tabs
import { HomeTab } from "./tabs/HomeTab";
import { ConsoleTab } from "./tabs/ConsoleTab";
import { ResourcesTab } from "./tabs/ResourcesTab";
import { VersioningTab } from "./tabs/VersioningTab";
import { SettingsTab } from "./tabs/SettingsTab";
import FolderIcon from "@assets/folder.svg";
import TrashIcon from "@assets/trash.svg";
import InfoIcon from "@assets/help.svg";
import SettingsIcon from "@assets/gear.svg";
import PlayIcon from "@assets/play.svg";
import LinkIcon from "@assets/link.svg";
import PinIcon from "@assets/pin.svg";
import PinOffIcon from "@assets/pin-off.svg";

type TabType = "home" | "console" | "resources" | "settings" | "versioning";

interface InstanceDetailsProps {
	slug?: string; // Optional - can come from props or router params
	activeTab?: TabType;
	initialData?: any;
	initialName?: string;
	initialIconPath?: string;
	initialMinMemory?: number;
	initialMaxMemory?: number;
	initialJavaArgs?: string;
	initialJavaPath?: string;
	_dirty?: Record<string, boolean>;
}

const ResourceIcon = (props: { record?: any; name: string }) => {
	const [iconUrl, setIconUrl] = createSignal<string | null>(null);

	const displayChar = createMemo(() => {
		const match = props.name.match(/[a-zA-Z]/);
		return match
			? match[0].toUpperCase()
			: props.name.charAt(0).toUpperCase() || "?";
	});

	createEffect(() => {
		if (props.record?.icon_data) {
			const blob = new Blob([new Uint8Array(props.record.icon_data)]);
			const url = URL.createObjectURL(blob);
			setIconUrl(url);
			onCleanup(() => URL.revokeObjectURL(url));
		} else if (props.record?.icon_url) {
			setIconUrl(resolveResourceUrl(props.record.icon_url) || null);
		} else {
			setIconUrl(null);
		}
	});

	return (
		<Show
			when={iconUrl()}
			fallback={
				<div class={styles["res-icon-placeholder"]}>{displayChar()}</div>
			}
		>
			{(url) => (
				<img
					src={url()}
					alt={props.name || "Resource Icon"}
					class={styles["res-icon"]}
				/>
			)}
		</Show>
	);
};

/**
 * Robustly compares two icon paths/values.
 * If both are data URLs, compares only the base64 content to ignore mime-type differences (e.g., png vs jpeg).
 */
export const areIconsEqual = (a?: string | null, b?: string | null) => {
	if (a === b) return true;
	if (!a || !b) return false;

	if (a.startsWith("data:image/") && b.startsWith("data:image/")) {
		const partA = a.split(",")[1];
		const partB = b.split(",")[1];
		if (partA && partB) return partA === partB;
	}

	return false;
};

export default function InstanceDetails(
	props: InstanceDetailsProps & {
		setRefetch?: (fn: () => Promise<void>) => void;
		router?: MiniRouter;
	},
) {
	const activeRouter = createMemo(() => props.router || router());

	const isPinned = createMemo(() =>
		props.slug ? isPinnedInStore("instance", props.slug) : false,
	);

	const handlePin = async () => {
		if (!props.slug) return;
		if (isPinned()) {
			const pin = pinning.pins.find(
				(p) => p.page_type === "instance" && p.target_id === props.slug,
			);
			if (pin) unpinPage(pin.id);
		} else {
			const inst = instance();
			if (!inst) return;
			await pinPage({
				page_type: "instance",
				target_id: props.slug,
				label: inst.name,
				icon_url: inst.modpackIconUrl || inst.iconPath || null,
				platform: null,
				order_index: pinning.pins.length,
			});
		}
	};

	const loadersList = [
		{ label: "Vanilla", value: "vanilla" },
		{ label: "Fabric", value: "fabric" },
		{ label: "Forge", value: "forge" },
		{ label: "NeoForge", value: "neoforge" },
		{ label: "Quilt", value: "quilt" },
	];

	// Handle slug from props first, then fallback to router params
	const getSlug = () => {
		if (props.slug) return props.slug;
		const params = activeRouter()?.currentParams.get();
		return params?.slug as string | undefined;
	};

	const slug = createMemo(() => {
		const s = getSlug();
		console.log("[InstanceDetails] Derived slug:", s);
		return s || "";
	});

	const [instance, { refetch }] = createResource(slug, async (s) => {
		if (!s) {
			console.warn("[InstanceDetails] No slug provided to resource fetcher");
			return undefined;
		}
		console.log("[InstanceDetails] Fetching instance for slug:", s);
		try {
			const inst = await getInstanceBySlug(s);
			if (!inst)
				console.warn("[InstanceDetails] Backend returned null for slug:", s);
			return inst;
		} catch (e) {
			console.error("[InstanceDetails] Error fetching instance:", e);
			throw e;
		}
	});

	const [
		installedResources,
		{ refetch: refetchResources, mutate: mutateResources },
	] = createResource(instance, async (inst) => {
		if (!inst) return [];
		return await resources.getInstalled(inst.id);
	});

	const [projectRecords] = createResource(
		installedResources,
		async (resourcesList) => {
			if (!resourcesList || resourcesList.length === 0) return {};
			const ids = resourcesList
				.filter(
					(r) =>
						r.remote_id && r.platform !== "manual" && r.platform !== "unknown",
				)
				.map((r) => r.remote_id);

			if (ids.length === 0) return {};

			try {
				const records: any[] = await invoke("get_cached_resource_projects", {
					ids,
				});
				const map: Record<string, any> = {};
				for (const r of records) {
					map[r.id] = r;
				}
				return map;
			} catch (e) {
				console.error("Failed to fetch project records:", e);
				return {};
			}
		},
	);

	// --- Settings State (Unsaved Changes) ---
	const [name, setName] = createSignal(props.initialName || "");
	const [iconPath, setIconPath] = createSignal(props.initialIconPath || "");
	const [minMemory, setMinMemory] = createSignal<number[]>([
		props.initialMinMemory || 2048,
	]);
	const [maxMemory, setMaxMemory] = createSignal<number[]>([
		props.initialMaxMemory || 4096,
	]);
	const [javaArgs, setJavaArgs] = createSignal(props.initialJavaArgs || "");
	const [javaPath, setJavaPath] = createSignal(props.initialJavaPath || "");
	const [isCustomMode, setIsCustomMode] = createSignal(false);

	// Dirty flags for settings
	const [isNameDirty, setIsNameDirty] = createSignal(
		props._dirty?.name || false,
	);
	const [isIconDirty, setIsIconDirty] = createSignal(
		props._dirty?.icon || false,
	);
	const [isMinMemDirty, setIsMinMemDirty] = createSignal(
		props._dirty?.minMem || false,
	);
	const [isMaxMemDirty, setIsMaxMemDirty] = createSignal(
		props._dirty?.maxMem || false,
	);
	const [isJvmDirty, setIsJvmDirty] = createSignal(props._dirty?.jvm || false);
	const [isJavaPathDirty, setIsJavaPathDirty] = createSignal(
		props._dirty?.javaPath || false,
	);

	const [saving, setSaving] = createSignal(false);
	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<
		string[]
	>([]);

	const inst = () => instance();
	const isLaunchingGlobal = createMemo(
		() => (props.slug ? instancesState.launchingIds[props.slug] : false) || false,
	);
	const isRunningGlobal = createMemo(
		() => (props.slug ? instancesState.runningIds[props.slug] : false) || false,
	);

	const isDirty = createMemo(() => {
		return (
			isNameDirty() ||
			isIconDirty() ||
			isMinMemDirty() ||
			isMaxMemDirty() ||
			isJvmDirty() ||
			isJavaPathDirty()
		);
	});

	const [modpackIconBase64] = createResource(
		() => instance()?.modpackIconUrl,
		async (url) => {
			if (!url) return null;
			try {
				const response = await fetch(url);
				const blob = await response.blob();
				return new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.onerror = reject;
					reader.readAsDataURL(blob);
				});
			} catch (e) {
				console.error("Failed to fetch modpack icon:", e);
				return null;
			}
		},
	);

	// Create uploadedIcons array that includes all custom icons seen this session
	const uploadedIcons = createMemo(() => {
		let result = [...customIconsThisSession()];
		const current = iconPath();
		const inst = instance();
		const originalIcon = inst?.iconPath;
		const modpackIcon = modpackIconBase64();

		console.log(
			"[InstanceDetails] uploadedIcons - session icons:",
			result.length,
			result.map((icon) => icon?.substring(0, 30) + "..."),
		);

		// Add current icon if it's not a default, not the original, not the modpack icon, and not already in the list
		if (
			current &&
			!isDefaultIcon(current) &&
			!areIconsEqual(current, originalIcon) &&
			!areIconsEqual(current, modpackIcon) &&
			!result.some((icon) => areIconsEqual(icon, current))
		) {
			result = [current, ...result];
			console.log("[InstanceDetails] uploadedIcons - added current icon");
		}

		// Always add modpack icon first if it exists (regardless of session filtering)
		if (modpackIcon && !isDefaultIcon(modpackIcon)) {
			// Remove any existing instances (using robust comparison)
			result = result.filter((icon) => !areIconsEqual(icon, modpackIcon));
			// Add at the beginning
			result = [modpackIcon, ...result];
			console.log(
				"[InstanceDetails] uploadedIcons - ensured modpack icon is first",
			);
		}

		console.log(
			"[InstanceDetails] uploadedIcons - final result:",
			result.length,
			result.map((icon) => icon?.substring(0, 30) + "..."),
		);
		console.log(
			"[InstanceDetails] uploadedIcons - modpackIcon count:",
			result.filter((icon) => icon === modpackIcon).length,
		);
		return result;
	});

	// Track custom icons in session list
	createEffect(() => {
		const current = iconPath();
		const modpackIcon = modpackIconBase64();
		console.log(
			"[InstanceDetails] createEffect - current:",
			current?.substring(0, 50),
			"modpackIcon:",
			modpackIcon?.substring(0, 50),
		);
		setCustomIconsThisSession((prev) => {
			console.log(
				"[InstanceDetails] createEffect - processing session icons. prev:",
				prev.map((icon) => icon?.substring(0, 30) + "..."),
			);
			// Start with previous icons, filtering out any that are now known to be modpack icons
			let filtered = prev.filter((icon) => !areIconsEqual(icon, modpackIcon));
			const modpackRemoved = prev.length - filtered.length;
			if (modpackRemoved > 0) {
				console.log(
					"[InstanceDetails] createEffect - removed",
					modpackRemoved,
					"modpack icons from session",
				);
			}
			// Also filter out the current icon if it's now known to be the modpack icon (different format)
			let currentIsModpackEquivalent = false;
			if (
				modpackIcon &&
				current &&
				!areIconsEqual(current, modpackIcon) &&
				current.startsWith("data:image/") &&
				!isDefaultIcon(current)
			) {
				// This branch is rarely hit now due to areIconsEqual being used above, 
				// but we keep it for extra safety in case of partial matches.
				const beforeFilter = filtered.length;
				filtered = filtered.filter((icon) => !areIconsEqual(icon, current));
				currentIsModpackEquivalent = beforeFilter > filtered.length;
			}
			console.log(
				"[InstanceDetails] createEffect - after filtering:",
				filtered.length,
				"icons",
			);
			// Add current icon if it's not a default, not the modpack icon, not equivalent to modpack icon, and not already in the filtered list
			if (
				current &&
				!isDefaultIcon(current) &&
				!areIconsEqual(current, modpackIcon) &&
				!currentIsModpackEquivalent &&
				!filtered.some((icon) => areIconsEqual(icon, current))
			) {
				filtered = [current, ...filtered];
				console.log(
					"[InstanceDetails] createEffect - added current icon to session",
				);
			}
			console.log(
				"[InstanceDetails] createEffect - final session icons:",
				filtered.length,
			);
			return filtered;
		});
	});

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

	// Register refetch callback with router so reload button can trigger it
	const handleRefetch = async () => {
		await Promise.all([refetch(), refetchResources()]);
	};

	onMount(() => {
		props.setRefetch?.(handleRefetch);
		activeRouter()?.setRefetch(handleRefetch);

		// Handle auto-launch from deep links or shortcuts
		const params = activeRouter()?.currentParams.get();
		if (params?.autoLaunch === "true") {
			const checkAndLaunch = () => {
				const inst = instance.latest;
				if (inst && !isRunningGlobal() && !isLaunchingGlobal() && !busy()) {
					handlePlay();
				} else if (!inst && instance.loading) {
					// Wait for load
					setTimeout(checkAndLaunch, 100);
				}
			};
			setTimeout(checkAndLaunch, 500);
		}

		// Navigation guard for unsaved changes
		activeRouter()?.setCanExit(async () => {
			if (isDirty()) {
				const confirmed = await dialogStore.confirm(
					"Unsaved Changes",
					"You have unsaved changes to this instance. Are you sure you want to leave without saving?",
					{ okLabel: "Leave", cancelLabel: "Stay" },
				);
				return confirmed;
			}
			return true;
		});

		const unlistenPromise = listen("java-paths-updated", () => {
			refetchManaged();
			refetchGlobal();
			refetchDetected();
		});
		onCleanup(() => {
			unlistenPromise.then((unlisten) => unlisten());
			activeRouter()?.setCanExit(null);
		});

		// Register state provider for pop-out window handoff
		activeRouter()?.registerStateProvider("/instance", () => {
			const { router: _, ...cleanProps } = props;
			return {
				...cleanProps,
				slug: slug(),
				activeTab: activeTab(),
				// Capture unsaved settings
				initialName: name(),
				initialIconPath: iconPath(),
				initialMinMemory: minMemory()[0],
				initialMaxMemory: maxMemory()[0],
				initialJavaArgs: javaArgs(),
				initialJavaPath: javaPath(),
				_dirty: {
					name: isNameDirty(),
					icon: isIconDirty(),
					minMem: isMinMemDirty(),
					maxMem: isMaxMemDirty(),
					jvm: isJvmDirty(),
					javaPath: isJavaPathDirty(),
				},
			};
		});
	});

	// --- Dynamic Title Support ---
	createEffect(() => {
		const nameLabel = instance()?.name;
		if (nameLabel) {
			activeRouter()?.customName.set(nameLabel);
		}
	});

	onCleanup(() => {
		activeRouter()?.customName.set(null);
		activeRouter()?.setRefetch(() => Promise.resolve());
	});

	// Tab state - initialized from query param if available
	const activeTab = createMemo<TabType>(() => {
		const params = activeRouter()?.currentParams.get();
		const tab = params?.activeTab as TabType | undefined;
		return tab &&
			["home", "console", "resources", "settings", "versioning"].includes(tab)
			? tab
			: "home";
	});

	const [showExportDialog, setShowExportDialog] = createSignal(false);

	// Running state
	const [isRunning, setIsRunning] = createSignal(false);
	const [busy, setBusy] = createSignal(false);

	const [activeAccount] = createResource<any>(async () => {
		try {
			const { getActiveAccount } = await import("@utils/auth");
			return await getActiveAccount();
		} catch {
			return null;
		}
	});

	const isGuest = () => activeAccount()?.account_type === ACCOUNT_TYPE_GUEST;

	const [requiredJava] = createResource(
		() => instance()?.id,
		async (id) => {
			if (!id) return null;
			return await invoke<number>("get_instance_required_java", {
				instanceId: id,
			});
		},
	);
	const [detectedJavas, { refetch: refetchDetected }] = createResource<any[]>(
		() => invoke("detect_java"),
	);
	const [managedJavas, { refetch: refetchManaged }] = createResource<any[]>(
		() => invoke("get_managed_javas"),
	);
	const [globalJavaPaths, { refetch: refetchGlobal }] = createResource<any[]>(
		() => invoke("get_global_java_paths"),
	);

	const jreOptions = createMemo(() => {
		const req = requiredJava();
		if (!req) return [];

		const global = globalJavaPaths()?.find((g) => g.major_version === req);
		const globalPathSuffix = global ? `→ ${global.path}` : "(not set)";

		const opts: any[] = [
			{
				label: `Global Default (Java ${req})`,
				description: globalPathSuffix,
				value: "__default__",
			},
		];

		// Managed Runtime
		const managed = managedJavas() || [];
		const managedForVersion = managed.find((j) => j.major_version === req);
		if (managedForVersion) {
			opts.push({
				label: `Managed Runtime`,
				description: managedForVersion.path,
				value: managedForVersion.path,
			});
		} else {
			opts.push({
				label: `Managed Runtime`,
				description: "Not installed - Click to download and use",
				value: `__download_${req}__`,
			});
		}

		(detectedJavas() || [])
			.filter((j) => j.major_version === req)
			.forEach((j) => {
				opts.push({
					label: `System Runtime`,
					description: j.path,
					value: j.path,
				});
			});

		opts.push({
			label: "Custom / Manual Path...",
			description: "Select a specific file",
			value: "__custom__",
		});

		return opts;
	});

	// Check if instance is currently being installed/repaired/updated
	const isInstalling = createMemo(() => {
		const inst = instance();
		return inst?.installationStatus === "installing";
	});

	/**
	 * Tracks if an instance was interrupted during a critical operation
	 * (install, repair, hard-reset) usually detected at application startup.
	 * Differs from 'installing' as it represents a passive state awaiting user resumption.
	 */
	const isInterrupted = createMemo(() => {
		const inst = instance();
		return inst?.installationStatus === "interrupted";
	});

	const isFailed = createMemo(() => {
		const inst = instance();
		return inst?.installationStatus === "failed";
	});

	const needsInstallation = createMemo(() => {
		const inst = instance();
		return !inst?.installationStatus || isFailed();
	});

	let lastSelectedRowId: string | null = null;

	const handleRowClick = (row: any, event: MouseEvent) => {
		const target = event.target as HTMLElement;
		// Prevent navigation if clicking interactive elements inside the row
		if (
			target.closest("button") ||
			target.closest("a") ||
			target.closest("input") ||
			target.closest(".v-switch") ||
			target.getAttribute("role") === "checkbox" ||
			target.getAttribute("role") === "switch"
		) {
			return;
		}

		const rowId = row.id;

		if (event.shiftKey && lastSelectedRowId) {
			const rows = table.getRowModel().rows;
			const lastIndex = rows.findIndex((r) => r.id === lastSelectedRowId);
			const currentIndex = rows.findIndex((r) => r.id === rowId);

			if (lastIndex !== -1 && currentIndex !== -1) {
				const start = Math.min(lastIndex, currentIndex);
				const end = Math.max(lastIndex, currentIndex);
				const rowSelection: Record<string, boolean> = {
					...resources.state.selection,
				};

				for (let i = start; i <= end; i++) {
					rowSelection[rows[i].id] = true;
				}
				resources.batchSetSelection(rowSelection);
			}
		} else if (event.ctrlKey || event.metaKey) {
			row.toggleSelected();
		} else {
			// Normal click - navigate
			if (
				row.original.remote_id &&
				row.original.platform !== "manual" &&
				row.original.platform !== "unknown"
			) {
				const inst = instance();
				if (inst) {
					resources.setInstance(inst.id);
					resources.setGameVersion(inst.minecraftVersion);
					resources.setLoader(inst.modloader);
				}

				activeRouter()?.navigate("/resource-details", {
					projectId: row.original.remote_id,
					platform: row.original.platform,
				});
			}
		}

		lastSelectedRowId = rowId;
	};

	const handleBatchDelete = async () => {
		const selectedCount = Object.keys(resources.state.selection).length;
		const inst = instance();
		if (selectedCount === 0 || !inst) return;

		const confirmed = await dialogStore.confirm(
			"Delete Resources",
			`Are you sure you want to delete ${selectedCount} selected resources?`,
			{ severity: "warning", isDestructive: true }
		);
		if (!confirmed) return;

		setBusy(true);
		try {
			const selectedIds = Object.keys(resources.state.selection).map(Number);
			for (const id of selectedIds) {
				await invoke("delete_resource", {
					instanceId: inst.id,
					resourceId: id,
				});
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
		const toUpdate = selectedIds.filter((id) => updates()[id]);

		if (toUpdate.length === 0) return;

		setBusy(true);
		try {
			for (const id of toUpdate) {
				const res = (installedResources() || []).find((r) => r.id === id);
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
	const [resourceTypeFilter, setResourceTypeFilter] =
		createSignal<string>("All");
	const [resourceSearch, setResourceSearch] = createSignal("");
	const [updates, setUpdates] = createSignal<Record<number, ResourceVersion>>(
		{},
	);
	const [checkingUpdates, setCheckingUpdates] = createSignal(false);
	const [totalRam, setTotalRam] = createSignal(16384);

	onMount(async () => {
		try {
			const ram = await invoke("get_system_memory_mb");
			if (typeof ram === "number" && ram > 0) setTotalRam(ram);
		} catch (e) {
			console.error("Failed to get total RAM:", e);
		}
	});
	const [lastCheckTime, setLastCheckTime] = createSignal<number>(0);

	// Modpack versions for picker
	const [selectedModpackVersionId, setSelectedModpackVersionId] = createSignal<
		string | null
	>(null);

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
				platform: inst?.modpackPlatform,
			};
		},
		async (params) => {
			if (!params.active || !params.id || !params.platform) return [];
			try {
				const vs = await resources.getVersions(
					params.platform as any,
					params.id,
				);
				return vs;
			} catch (e) {
				console.error("Failed to fetch modpack versions:", e);
				return [];
			}
		},
	);

	const searchableMcVersions = createMemo(() => {
		return (mcVersions()?.game_versions || []).map((v) => ({
			...v,
			searchString: v.id,
		}));
	});

	const searchableLoaderVersions = createMemo(() => {
		const mv = mcVersions();
		const sv = selectedMcVersion();
		const sl = selectedLoader();
		if (!mv || !sv || !sl) return [];

		const vMeta = mv.game_versions.find((gv) => gv.id === sv);
		if (!vMeta) return [];

		const loaderInfo = vMeta.loaders[sl] || [];
		return loaderInfo.map((l) => ({
			...l,
			id: l.version,
			searchString: l.version,
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
						setSelectedModpackVersionId(
							inst.modpackVersionId ? String(inst.modpackVersionId) : null,
						);
					}
				});
			}
		}
	});

	// Better version matching once data is actually loaded
	createEffect(() => {
		const vs = modpackVersions();
		const current = selectedModpackVersionId();
		if (!vs || !current) return;

		// Try to find a better match if we just have a loose ID
		const match = vs.find(
			(v) =>
				String(v.id) === String(current) ||
				String(v.version_number) === String(current),
		);
		if (match && String(match.id) !== current) {
			setSelectedModpackVersionId(String(match.id));
		}
	});

	// Sync settings data from instance when loaded
	createEffect(() => {
		const inst = instance();
		if (inst) {
			batch(() => {
				if (!isNameDirty()) setName(inst.name);
				if (!isIconDirty()) setIconPath(inst.iconPath || DEFAULT_ICONS[0]);
				if (!isMinMemDirty()) setMinMemory([inst.minMemory]);
				if (!isMaxMemDirty()) setMaxMemory([inst.maxMemory]);
				if (!isJvmDirty()) setJavaArgs(inst.javaArgs || "");
				if (!isJavaPathDirty()) setJavaPath(inst.javaPath || "");
			});
		}
	});

	const handleModpackVersionSelect = (versionId: string, version?: ModpackVersion) => {
		setSelectedModpackVersionId(versionId);
	};

	// Reset selections when switching instances
	createEffect(() => {
		const slug = activeRouter()?.currentParams.get()?.slug;
		if (slug) {
			setSelectedMcVersion("");
			setSelectedLoader("vanilla");
			setSelectedLoaderVersion("");
			setSelectedModpackVersionId(null);
		}
	});

	// Sync modpack selection with instance data
	// (Redundant effect removed)

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

		const confirmed = await dialogStore.confirm(
			"Unlink Modpack",
			"Are you sure you want to unlink this instance from the modpack? You will no longer receive updates from the platform, but your files will remain intact.",
			{ severity: "warning" }
		);
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
				modloader:
					selectedLoader().toLowerCase() === "vanilla"
						? null
						: selectedLoader(),
				modloaderVersion:
					selectedLoader().toLowerCase() === "vanilla"
						? null
						: selectedLoaderVersion(),
			});
			await repairInstance(inst.id);
			await refetch();
		} catch (e) {
			console.error("Failed to update instance version:", e);
		} finally {
			setBusy(false);
		}
	};

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
					gameDir: inst.gameDirectory,
				});
				await refetchResources();
			} catch (e) {
				console.error("Auto-sync failed:", e);
			}

			// Then check for updates if needed
			const now = Date.now();
			if (
				!installedResources.loading &&
				!checkingUpdates() &&
				now - lastCheckTime() > 5 * 60 * 1000
			) {
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
			console.log(
				`[InstanceDetails] Refreshing modpack versions for ${inst.modpackId}`,
			);
			// Resource handles its own refetching if we just trigger it
			await refetchModpackVersions();
		}

		const resourcesList = installedResources();
		if (!resourcesList) {
			setCheckingUpdates(false);
			return;
		}

		setLastCheckTime(Date.now());
		console.log(
			`[InstanceDetails] Checking updates for ${resourcesList.length} resources on MC ${inst.minecraftVersion} (${inst.modloader})`,
		);

		const newUpdates: Record<number, ResourceVersion> = {};

		for (const res of resourcesList) {
			if (res.is_manual || res.platform === "manual") continue;
			try {
				// We ignore cache here because the user explicitly asked to check for updates
				const versions = await resources.getVersions(
					res.platform as any,
					res.remote_id,
					true,
				);
				const best = findBestVersion(
					versions,
					inst.minecraftVersion,
					inst.modloader,
					res.release_type,
				);

				if (best) {
					// Some platforms return versions in slightly different formats (string vs number)
					// Compare as strings to be safe
					if (String(best.id) !== String(res.remote_version_id)) {
						console.log(
							`[InstanceDetails] Update found for ${res.display_name}: ${res.current_version} -> ${best.version_number}`,
						);
						newUpdates[res.id] = best;
					}
				}
			} catch (e) {
				console.error(`Failed to check updates for ${res.display_name}:`, e);
			}
		}

		console.log(
			`[InstanceDetails] Finished check. Found ${Object.keys(newUpdates).length} updates.`,
		);
		setUpdates(newUpdates);
		setCheckingUpdates(false);
	};

	const handleUpdate = async (
		resource: InstalledResource,
		version: ResourceVersion,
	) => {
		const inst = instance();
		if (!inst) return;

		try {
			const project = await resources.getProject(
				resource.platform as any,
				resource.remote_id,
			);
			await resources.install(project, version, inst.id);

			setUpdates((prev) => {
				const next = { ...prev };
				delete next[resource.id];
				return next;
			});
		} catch (e) {
			console.error("Update failed:", e);
		}
	};

	const selectedToUpdateCount = createMemo(() => {
		const sel = resources.state.selection;
		const ups = updates();
		return Object.keys(sel).filter((id) => sel[id] && ups[Number(id)]).length;
	});

	// Sync resources separately - only on actual instance change
	createEffect(
		on(
			() => instance()?.id,
			(id) => {
				const inst = instance();
				if (id && inst) {
					resources.clearSelection();
					resources.sync(id, slug(), inst.gameDirectory || "");
				}
			},
			{ defer: true },
		),
	);

	// Clear selection on unmount
	onCleanup(() => resources.clearSelection());

	// TanStack Table setup for Resources
	const columnHelper = createColumnHelper<InstalledResource>();

	const columns = [
		columnHelper.display({
			id: "select",
			size: 64, // Sync with CSS
			header: ({ table }) => (
				<div
					class={`${styles["col-selection-wrapper"]} ${styles.header} v-col-selection`}
				>
					<Checkbox
						class={styles["header-checkbox"]}
						checked={table.getIsAllPageRowsSelected()}
						indeterminate={table.getIsSomePageRowsSelected()}
						onChange={(checked) => table.toggleAllPageRowsSelected(checked)}
					/>
				</div>
			),
			cell: (info) => (
				<div
					class={`${styles["col-selection-wrapper"]} v-col-selection`}
				>
					<div class={styles["select-icon-container"]}
						onClick={(e: MouseEvent) => e.stopPropagation()}
						>
						<ResourceIcon
							record={projectRecords()?.[info.row.original.remote_id]}
							name={info.row.original.display_name}
						/>
						<Checkbox
							class={styles["row-checkbox"]}
							checked={info.row.getIsSelected()}
							disabled={!info.row.getCanSelect()}
							onChange={(checked) => info.row.toggleSelected(checked)}
						/>
					</div>
				</div>
			),
		}),
		columnHelper.accessor("display_name", {
			header: "Name",
			size: 150, // Default size makes it flexible in ResourcesTab
			cell: (info) => (
				<div class={styles["res-info-cell"]}>
					<div class={styles["res-title-group"]}>
						<span class={styles["res-title"]}>{info.getValue()}</span>
						<span class={styles["res-path"]}>
							{info.row.original.local_path.split(/[\\/]/).pop()}
						</span>
					</div>
				</div>
			),
		}),
		columnHelper.accessor("resource_type", {
			header: "Type",
			size: 90,
			cell: (info) => {
				const type = info.getValue().toLowerCase();
				const variant =
					type === "mod"
						? "info"
						: type === "resourcepack"
							? "success"
							: type === "shader" || type === "shaderpack"
								? "warning"
								: type === "datapack"
									? "accent"
									: "secondary";
				return <Badge variant={variant}>{info.getValue()}</Badge>;
			},
		}),
		columnHelper.accessor("current_version", {
			header: "Version",
			size: 110,
			cell: (info) => {
				const currentUpdate = () => updates()[info.row.original.id];
				return (
					<div class={styles["version-cell"]}>
						<span>{info.getValue()}</span>
						<Show when={currentUpdate()}>
							<Tooltip placement="top">
								<TooltipTrigger
									as={Button}
									variant="ghost"
									class={styles["update-btn"]}
									disabled={busy()}
									onClick={(e: MouseEvent) => {
										e.stopPropagation();
										const u = currentUpdate();
										if (u) handleUpdate(info.row.original, u);
									}}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>
									</svg>
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
			header: () => <div style="text-align: right; width: 100%;">Enabled</div>,
			size: 80,
			cell: (info) => (
				<div
					style="display: flex; justify-content: flex-end; width: 100%;"
					onClick={(e: MouseEvent) => e.stopPropagation()}
				>
					<Switch
						checked={info.getValue()}
						
						onCheckedChange={async (enabled: boolean) => {
							const previous = installedResources.latest;
							// Optimistic update
							mutateResources((prev) =>
								prev?.map((r) =>
									r.id === info.row.original.id
										? { ...r, is_enabled: enabled }
										: r,
								),
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
			size: 50,
			cell: (info) => (
				<div
					style="display: flex; justify-content: flex-end;"
				>
					<Button
						variant="ghost"
						size="icon"
						onClick={async () => {
							if (
								await dialogStore.confirm(
									"Delete Resource",
									`Are you sure you want to delete ${info.row.original.display_name}? This will remove the file from your instance.`,
									{ severity: "warning", isDestructive: true }
								)
							) {
								const previous = installedResources.latest;
								// Optimistic remove
								mutateResources((prev) =>
									prev?.filter((r) => r.id !== info.row.original.id),
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
						<TrashIcon />
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
		get state() {
			return {
				rowSelection: resources.state.selection,
				sorting: resources.state.sorting,
			};
		},
		onRowSelectionChange: (updater) => {
			batch(() => {
				if (typeof updater === "function") {
					const result = updater(resources.state.selection);
					resources.batchSetSelection(result);
				} else {
					resources.batchSetSelection(updater);
				}
			});
		},
		onSortingChange: (updater) => {
			if (typeof updater === "function") {
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
	const cleanups: (() => void)[] = [];
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

		cleanups.push(
			await listen("core://instance-log", (ev) => {
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
			}),
		);

		cleanups.push(
			await listen("core://instance-launched", (ev) => {
				const payload = (ev as { payload: { instance_id?: string } }).payload;
				if (payload.instance_id === slug()) {
					setIsRunning(true);
					// Clear console on new launch
					setLines([]);
				}
			}),
		);

		cleanups.push(
			await listen("core://instance-killed", (ev) => {
				const payload = (ev as { payload: { instance_id?: string } }).payload;
				if (payload.instance_id === slug()) {
					setIsRunning(false);
				}
			}),
		);

		// Listen for natural process exit (game closed by user)
		cleanups.push(
			await listen("core://instance-exited", (ev) => {
				const payload = (ev as { payload: { instance_id?: string } }).payload;
				if (payload.instance_id === slug()) {
					setIsRunning(false);
				}
			}),
		);

		cleanups.push(
			await listen("resources-updated", (event) => {
				const inst = instance();
				if (inst && event.payload === inst.id) {
					refetchResources();
					resources.fetchInstalled(inst.id);
				}
			}),
		);

		cleanups.push(
			await listen("core://instance-installed", (ev) => {
				const payload = (ev as { payload: { instance_id?: string } }).payload;
				if (payload.instance_id === slug()) {
					handleRefetch();
				}
			}),
		);

		cleanups.push(
			await listen("core://instance-updated", (ev) => {
				const payload = ev.payload as any;
				const current = instance();
				if (current && payload.id === current.id) {
					handleRefetch();
				}
			}),
		);
	});

	onCleanup(() => {
		for (const cb of cleanups) cb();
		resources.clearSelection();
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

	const playButtonText = createMemo(() => {
		const inst = instance();
		if (!inst) return "Play Now";

		if (isRunning()) return "Kill Instance";
		if (isInstalling()) return "Installing...";

		if (isInterrupted()) {
			const op = inst.lastOperation;
			const opName =
				op === "hard-reset"
					? "Reset"
					: op === "repair"
						? "Repair"
						: "Installation";
			return `Resume ${opName}`;
		}

		if (needsInstallation()) {
			return isFailed() ? "Retry Install" : "Install Now";
		}

		return "Play Now";
	});

	const handlePlay = async () => {
		const inst = instance();
		if (!inst || busy()) return;
		setBusy(true);
		try {
			if (isInterrupted()) {
				await resumeInstanceOperation(inst);
			} else if (needsInstallation()) {
				await installInstance(inst);
			} else {
				await launchInstance(inst);
			}
		} catch (e) {
			console.error("Action failed:", e);
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
			fresh.javaPath = javaPath() || null;
			fresh.minMemory = minMemory()[0];
			fresh.maxMemory = maxMemory()[0];
			await updateInstance(fresh);
			// Clear temporary session icons once we've successfully saved to the backend
			setCustomIconsThisSession([]);
			// Reset dirty flags after successful save
			setIsNameDirty(false);
			setIsIconDirty(false);
			setIsMinMemDirty(false);
			setIsMaxMemDirty(false);
			setIsJvmDirty(false);
			setIsJavaPathDirty(false);
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

	// Handle tab changes - use updateQuery for stable state preservation
	const handleTabChange = (tab: TabType) => {
		if (tab === activeTab()) return;
		activeRouter()?.updateQuery("activeTab", tab, true); // Push to history
	};

	const [isScrolled, setIsScrolled] = createSignal(false);

	const handleScroll = (e: Event) => {
		const target = e.currentTarget as HTMLElement;
		// Detect exactly when the toolbar hits the top (approx 115-120px)
		// depending on header shrunk height (80) + padding (24) + margin (16)
		setIsScrolled(target.scrollTop > 115);
	};

	return (
		<div class={styles["instance-details-page"]}>
			<aside class={styles["instance-details-sidebar"]}>
				<nav class={styles["instance-tabs"]}>
					<button
						classList={{ [styles.active]: activeTab() === "home" }}
						onClick={() => handleTabChange("home")}
					>
						Home
					</button>
					<button
						classList={{ [styles.active]: activeTab() === "console" }}
						onClick={() => handleTabChange("console")}
					>
						Console
					</button>
					<button
						classList={{ [styles.active]: activeTab() === "resources" }}
						onClick={() => handleTabChange("resources")}
					>
						Resources
					</button>
					<button
						classList={{ [styles.active]: activeTab() === "versioning" }}
						onClick={() => handleTabChange("versioning")}
					>
						Version
					</button>
					<button
						classList={{ [styles.active]: activeTab() === "settings" }}
						onClick={() => handleTabChange("settings")}
					>
						Settings
					</button>
				</nav>
			</aside>

			<main class={styles["instance-details-content"]} onScroll={handleScroll}>
				<div class={styles["content-wrapper"]}>
					<Show when={instance.loading && !instance.latest}>
						<div class={styles["instance-loading"]}>
							<Skeleton class={styles["skeleton-header"]} />
							<Skeleton class={styles["skeleton-content"]} />
						</div>
					</Show>
					<Show when={instance.error}>
						<div class={styles["instance-error"]}>
							<p>Failed to load instance: {String(instance.error)}</p>
						</div>
					</Show>

					<Show
						when={instance.latest}
						fallback={
							<Show when={!instance.loading}>
								<div class={styles["instance-error"]}>
									<p>
										No instance data available.{" "}
										{slug() ? `(Slug: ${slug()})` : "No slug provided."}
									</p>
									<Button onClick={() => activeRouter()?.navigate("/")}>
										Back to Home
									</Button>
								</div>
							</Show>
						}
					>
						{(inst) => (
							<>
								<header
									class={styles["instance-details-header"]}
									classList={{ [styles.shrunk]: activeTab() !== "home" }}
								>
									<div
										class={styles["header-background"]}
										style={{
											"background-image": (inst().iconPath || "").startsWith(
												"linear-gradient",
											)
												? inst().iconPath || ""
												: `url('${resolveResourceUrl(inst().iconPath || DEFAULT_ICONS[0])}')`,
										}}
									/>
									<div class={styles["header-content"]}>
										<div class={styles["header-main-info"]}>
											<ResourceAvatar
												name={inst().name}
												icon={inst().iconPath || DEFAULT_ICONS[0]}
												size={activeTab() === "home" ? 120 : 48}
												class={styles["header-icon"]}
											/>
											<div class={styles["header-text"]}>
												<h1>{inst().name}</h1>
												<p class={styles["header-meta"]}>
													{inst().minecraftVersion} •{" "}
													{inst().modloader || "Vanilla"}
													<Show when={inst().modpackId}>
														<Badge
															variant="default"
															round={true}
															title={`Linked to ${inst().modpackPlatform} modpack`}
															style={{ "margin-left": "8px" }}
														>
															<svg
																xmlns="http://www.w3.org/2000/svg"
																width="12"
																height="12"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																style="margin-right: 4px; opacity: 0.8;"
															>
																<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
																<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
															</svg>
															Linked
														</Badge>
													</Show>
												</p>
											</div>
										</div>
										<div class={styles["header-actions"]}>
											<Button
												variant="ghost"
												size="md"
												onClick={openInstanceFolder}
												title="Open Folder"
												class={styles["header-square-button"]}
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
												variant="ghost"
												size="md"
												onClick={handlePin}
												title={isPinned() ? "Unpin from Sidebar" : "Pin to Sidebar"}
												class={styles["header-square-button"]}
											>
												<Show when={isPinned()} fallback={<PinIcon width="18" height="18" />}>
													<PinOffIcon width="18" height="18" />
												</Show>
											</Button>

											<Button
												onClick={isRunning() ? handleKill : handlePlay}
												disabled={busy() || isInstalling()}
												color={isRunning() ? "destructive" : "primary"}
												variant="solid"
												size={activeTab() === "home" ? "lg" : "md"}
												class={styles["details-play-button"]}
											>
												<Show when={busy()}>
													<span class={styles["btn-spinner"]} />
												</Show>
												<Show when={isInstalling() && !busy()}>
													<span class={styles["btn-spinner"]} />
												</Show>
												{playButtonText()}
											</Button>
										</div>
									</div>
								</header>

								<div class={styles["instance-tab-content"]}>
									<Show when={activeTab() === "home"}>
										<Show when={instance.loading && !instance.latest}>
											<div class={styles["skeleton-grid"]}>
												{Array.from({ length: 4 }).map(() => (
													<Skeleton class={styles["skeleton-item"]} />
												))}
											</div>
										</Show>
										<Show when={instance.latest}>
											<HomeTab
												instance={inst()}
												installedResources={installedResources() || []}
											/>
										</Show>
									</Show>

									<Show when={activeTab() === "console"}>
										<Show when={instance.loading && !instance.latest}>
											<Skeleton class={styles["skeleton-console"]} />
										</Show>
										<Show when={instance.latest}>
											<ConsoleTab
												lines={lines()}
												consoleRef={(el) => {
													consoleRef = el;
												}}
												openLogsFolder={openLogsFolder}
												clearConsole={clearConsole}
											/>
										</Show>
									</Show>

									<Show when={activeTab() === "resources"}>
										<ResourcesTab
											instance={inst()}
											isScrolled={isScrolled()}
											resourceTypeFilter={resourceTypeFilter()}
											resourceSearch={resourceSearch()}
											setResourceSearch={setResourceSearch}
											setResourceTypeFilter={setResourceTypeFilter}
											table={table}
											resourcesStore={resources}
											installedResources={installedResources}
											router={activeRouter()}
											handleBatchUpdate={handleBatchUpdate}
											handleBatchDelete={handleBatchDelete}
											onRowClick={handleRowClick}
											selectedToUpdateCount={selectedToUpdateCount()}
											busy={busy()}
											checkingUpdates={checkingUpdates()}
											checkUpdates={checkUpdates}
										/>
									</Show>

									<Show when={activeTab() === "versioning"}>
										<Show when={instance.latest}>
											<VersioningTab
												instance={inst()}
												isGuest={isGuest()}
												busy={busy()}
												isInstalling={isInstalling()}
												checkingUpdates={checkingUpdates()}
												checkUpdates={checkUpdates}
												modpackVersions={modpackVersions}
												handleModpackVersionSelect={handleModpackVersionSelect}
												rolloutModpackUpdate={rolloutModpackUpdate}
												handleUnlink={handleUnlink}
												router={activeRouter()}
												searchableMcVersions={searchableMcVersions}
												selectedMcVersion={selectedMcVersion}
												setSelectedMcVersion={setSelectedMcVersion}
												selectedLoader={selectedLoader}
												setSelectedLoader={setSelectedLoader}
												selectedLoaderVersion={selectedLoaderVersion}
												setSelectedLoaderVersion={setSelectedLoaderVersion}
												loadersList={loadersList}
												searchableLoaderVersions={searchableLoaderVersions}
												handleStandardUpdate={handleStandardUpdate}
												setShowExportDialog={setShowExportDialog}
												handleDuplicate={async () => {
													const n = await dialogStore.prompt(
														"Duplicate Instance",
														"Enter name for the copy:",
														{ defaultValue: `${inst().name} (Copy)` },
													);
													if (n) duplicateInstance(inst().id, n);
												}}
												handleHardReset={() => handleHardReset(inst())}
												handleUninstall={() =>
													handleUninstall(inst(), () => activeRouter()?.navigate("/"))
												}
												repairInstance={repairInstance}
												mcVersions={mcVersions}
											/>
										</Show>
									</Show>

									<Show when={activeTab() === "settings"}>
										<Show when={instance.loading && !instance.latest}>
											<div class={styles["skeleton-settings"]}>
												<Skeleton class={styles["skeleton-field"]} />
												<Skeleton class={styles["skeleton-field"]} />
											</div>
										</Show>
										<Show when={instance.latest}>
											<SettingsTab
												instance={inst()}
												name={name()}
												setName={setName}
												setIsNameDirty={setIsNameDirty}
												iconPath={iconPath()}
												setIconPath={setIconPath}
												setIsIconDirty={setIsIconDirty}
												uploadedIcons={uploadedIcons}
												modpackIcon={() => modpackIconBase64() || null}
												isSuggestedSelected={() => areIconsEqual(modpackIconBase64(), iconPath())}
												isInstalling={isInstalling()}
												jreOptions={jreOptions}
												javaPath={javaPath()}
												setJavaPath={setJavaPath}
												setIsJavaPathDirty={setIsJavaPathDirty}
												isCustomMode={isCustomMode()}
												setIsCustomMode={setIsCustomMode}
												javaArgs={javaArgs()}
												setJavaArgs={setJavaArgs}
												setIsJvmDirty={setIsJvmDirty}
												minMemory={minMemory()}
												setMinMemory={setMinMemory}
												setIsMinMemDirty={setIsMinMemDirty}
												maxMemory={maxMemory()}
												setMaxMemory={setMaxMemory}
												setIsMaxMemDirty={setIsMaxMemDirty}
												handleSave={handleSave}
												saving={saving}
												totalRam={totalRam()}
												invoke={invoke}
												showToast={showToast}
											/>
										</Show>
									</Show>
								</div>
							</>
						)}
					</Show>
				</div>
			</main>

			<Show when={isDirty()}>
				<div class={styles["floating-save-footer"]}>
					<div class={styles["save-footer-content"]}>
						<p>You have unsaved changes</p>
						<div class={styles["save-footer-actions"]}>
							<Button
								variant="ghost"
								onClick={() => {
									const i = inst();
									if (!i) return;
									setName(i.name);
									setIconPath(i.iconPath || getStableIconId(DEFAULT_ICONS[0]) || DEFAULT_ICONS[0]);
									setMinMemory([i.minMemory]);
									setMaxMemory([i.maxMemory]);
									setJavaArgs(i.javaArgs || "");
									setJavaPath(i.javaPath || "");
									setIsNameDirty(false);
									setIsIconDirty(false);
									setIsMinMemDirty(false);
									setIsMaxMemDirty(false);
									setIsJvmDirty(false);
									setIsJavaPathDirty(false);
								}}
							>
								Reset
							</Button>
							<Button
								color="primary"
								variant="solid"
								onClick={handleSave}
								disabled={saving()}
							>
								<Show when={saving()} fallback={"Save Changes"}>
									<span class={styles["btn-spinner"]} />
									Saving...
								</Show>
							</Button>
						</div>
					</div>
				</div>
			</Show>

			<Show when={instance()}>
				<ExportDialog
					isOpen={showExportDialog()}
					onClose={() => setShowExportDialog(false)}
					instanceId={instance()?.id || 0}
					instanceName={instance()?.name || ""}
				/>
			</Show>
		</div>
	);
}
