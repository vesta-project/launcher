import ErrorIcon from "@assets/error.svg";
import PinIcon from "@assets/pin.svg";
import PinOffIcon from "@assets/pin-off.svg";
import PlayIcon from "@assets/play.svg";
import KillIcon from "@assets/rounded-square.svg";
import FloatingSaveFooter from "@components/floating-save-footer/floating-save-footer";
import {
	PageSidebar,
	type PageSidebarTab,
} from "@components/page-sidebar/page-sidebar";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { consoleStore } from "@stores/console";
import { dialogStore } from "@stores/dialog-store";
import {
	clearRunning,
	instancesState,
	isInstanceRunningInStore,
	setLaunching,
	setRunning,
} from "@stores/instances";
import {
	isPinned as isPinnedInStore,
	pinning,
	pinPage,
	unpinPage,
} from "@stores/pinning";
import {
	type InstalledResource,
	type ResourceVersion,
	resources,
} from "@stores/resources";
import {
	createColumnHelper,
	createSolidTable,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
} from "@tanstack/solid-table";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { Checkbox } from "@ui/checkbox/checkbox";
import { ExportDialog } from "@ui/export-dialog";
import { Skeleton } from "@ui/skeleton/skeleton";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { TabsContent } from "@ui/tabs/tabs";
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { resolveResourceUrl } from "@utils/assets";
import { ACCOUNT_TYPE_GUEST, getActiveAccount } from "@utils/auth";
import { getCrashDetails, parseCrashDetails } from "@utils/crash-handler";
import { createAnimatedIconPreview } from "@utils/icon-animation";
import {
	applyInstanceEditDraft,
	type InstanceEditDirty,
	type InstanceEditDraft,
	isInstanceEditDirty,
	toInstanceEditHandoff,
} from "@utils/instance-draft";
import type { Instance } from "@utils/instances";
import {
	DEFAULT_ICONS,
	duplicateInstance,
	getInstance,
	getInstanceBySlug,
	getInstanceOperationLabel,
	getInstanceSlug,
	getMinecraftVersions,
	getStableIconId,
	installInstance,
	isDefaultIcon,
	isInstanceOperationInProgress,
	isInstanceRunning,
	killInstance,
	launchInstance,
	repairInstance,
	resumeInstanceOperation,
	startModpackUpdate,
	unlinkInstance,
	updateInstance,
	updateInstanceModpackVersion,
} from "@utils/instances";
import { confirmMinecraftVersionChange } from "@utils/minecraft-version-confirm";
import { selectEligibleModpackUpdate } from "@utils/modpack-update";
import {
	describeSelectionAdjustments,
	getAllModloaders,
	getLoaderVersionsForGameVersion,
	getModloaderDisplayName,
	getModloadersForGameVersion,
	getNotifiableSelectionAdjustments,
	resolveCompatibleVersionSelection,
} from "@utils/version-selection";
import {
	createPreloadableLazyComponent,
	createRetainedTabLoader,
} from "@utils/preloadable-lazy";
import {
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	on,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { handleHardReset, handleUninstall } from "~/handlers/instance-handler";
import { useModpackIcon } from "~/hooks/use-modpack-icon";
import styles from "./instance-details.module.css";
import type { ModpackVersion } from "./modpack-version-selector";
// Tabs
import { HomeTab } from "./tabs/HomeTab";
import { ResourceRowActions } from "./tabs/ResourceRowActions";

const ConsoleTabModule = createPreloadableLazyComponent(() =>
	import("./tabs/ConsoleTab").then((module) => ({
		default: module.ConsoleTab,
	})),
);
const CrashTabModule = createPreloadableLazyComponent(() =>
	import("./tabs/CrashTab").then((module) => ({
		default: module.CrashTab,
	})),
);
const ResourcesTabModule = createPreloadableLazyComponent(() =>
	import("./tabs/ResourcesTab").then((module) => ({
		default: module.ResourcesTab,
	})),
);
const ScreenshotsTabModule = createPreloadableLazyComponent(() =>
	import("./tabs/ScreenshotsTab").then((module) => ({
		default: module.ScreenshotsTab,
	})),
);
const SettingsTabModule = createPreloadableLazyComponent(() =>
	import("./tabs/SettingsTab").then((module) => ({
		default: module.SettingsTab,
	})),
);
const VersioningTabModule = createPreloadableLazyComponent(() =>
	import("./tabs/VersioningTab").then((module) => ({
		default: module.VersioningTab,
	})),
);

const ConsoleTab = ConsoleTabModule.Component;
const CrashTab = CrashTabModule.Component;
const ResourcesTab = ResourcesTabModule.Component;
const ScreenshotsTab = ScreenshotsTabModule.Component;
const SettingsTab = SettingsTabModule.Component;
const VersioningTab = VersioningTabModule.Component;

const instanceTabLoaders: Partial<Record<TabType, () => Promise<unknown>>> = {
	console: ConsoleTabModule.preload,
	crash: CrashTabModule.preload,
	resources: ResourcesTabModule.preload,
	screenshots: ScreenshotsTabModule.preload,
	settings: SettingsTabModule.preload,
	versioning: VersioningTabModule.preload,
};

function InstanceTabLoading(props: { label: string }) {
	return (
		<div class={styles["instance-tab-loading"]} aria-live="polite">
			<span
				class={styles["instance-tab-loading__spinner"]}
				data-essential-motion
			/>
			<span>Loading {props.label}…</span>
		</div>
	);
}

type LightweightUpdateCheckResult = {
	resourceUpdates: Array<{
		resourceId: number;
		version: ResourceVersion;
	}>;
	modpackVersions: ResourceVersion[];
};

type InstanceUpdateSnapshot = {
	checkedAt: string;
	resourceUpdates: Array<{
		resourceId: number;
		version: ResourceVersion;
	}>;
	modpackVersions: ResourceVersion[];
	isStale: boolean;
};

type TabType =
	| "home"
	| "console"
	| "resources"
	| "crash"
	| "settings"
	| "versioning"
	| "screenshots";

interface InstanceDetailsProps {
	id?: number;
	slug?: string; // Optional fallback - can come from props or router params
	prefetchedInstance?: Instance;
	activeTab?: TabType;
	initialData?: any;
	initialName?: string;
	initialIconPath?: string;
	initialMinMemory?: number;
	initialMaxMemory?: number;
	initialJavaArgs?: string;
	initialJavaPath?: string;
	initialGameWidth?: number;
	initialGameHeight?: number;
	initialUseGlobalResolution?: boolean;
	initialUseGlobalJavaArgs?: boolean;
	initialUseGlobalJavaPath?: boolean;
	initialUseGlobalHooks?: boolean;
	initialUseGlobalEnvironmentVariables?: boolean;
	initialUseGlobalLauncherAction?: boolean;
	initialLauncherActionOnLaunch?: string;
	initialPreLaunchHook?: string;
	initialPostExitHook?: string;
	initialWrapperCommand?: string;
	initialEnvironmentVariables?: string;
	_dirty?: Record<string, boolean>;
}

/** Distance (pixels) below the viewport at which table row icons begin resolving.
 *  Larger values preload sooner; smaller values reduce initial network burst. */
const ICON_LOAD_MARGIN_PX = 600;

const ResourceIcon = (props: { record?: any; name: string }) => {
	const displayChar = createMemo(() => {
		const match = props.name.match(/[a-zA-Z]/);
		if (match) return match[0].toUpperCase();
		// charAt(0) on empty string returns "" — catch that before toUpperCase
		const first = props.name.charAt(0);
		return (first || "?").toUpperCase();
	});

	// Only accept data: URLs from the backend (icon_data → base64 encoded server-side).
	// External http/https URLs are rejected because:
	// 1. CSP blocks external image sources that aren't explicitly allowed
	// 2. macOS ATS blocks insecure connections in production
	// The backend's process_resource_record_icon() already strips external URLs,
	// so icon_url will be either a data: URL (icon_data available) or null/absent.
	const resolvedUrl = createMemo(() => {
		const url = props.record?.icon_url;
		if (url && url.startsWith("data:")) {
			return url;
		}
		return null;
	});
	const iconPreview = createAnimatedIconPreview(resolvedUrl);

	let wrapperRef: HTMLDivElement | undefined;
	const [isNearViewport, setIsNearViewport] = createSignal(false);

	onMount(() => {
		if (!wrapperRef) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setIsNearViewport(true);
					observer.disconnect();
				}
			},
			{ rootMargin: `${ICON_LOAD_MARGIN_PX}px` },
		);
		observer.observe(wrapperRef);
		onCleanup(() => observer.disconnect());
	});

	return (
		<div ref={wrapperRef} style="display: inline-flex; align-items: center;">
			<Show
				when={
					iconPreview.displaySource() && isNearViewport()
						? iconPreview.displaySource()
						: false
				}
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
		</div>
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
		if (partA && partB) {
			const equal = partA === partB;
			return equal;
		}
	}

	return false;
};

const getProjectRecordKey = (
	platform: string | null | undefined,
	id: string | null | undefined,
) => {
	if (!platform || !id) return null;
	return `${platform.toLowerCase()}:${id}`;
};

const normalizeResourceSourceKind = (resource: InstalledResource | undefined) =>
	(resource?.source_kind || "custom").toLowerCase();

const isModpackOwnedResource = (resource: InstalledResource | undefined) =>
	normalizeResourceSourceKind(resource) === "modpack";

const isCustomResource = (resource: InstalledResource | undefined) =>
	!isModpackOwnedResource(resource);

const hasCanonicalResourceLink = (resource: InstalledResource | undefined) =>
	!!resource?.remote_id &&
	(resource.platform === "modrinth" || resource.platform === "curseforge");

const isSameCanonicalProject = (
	a: InstalledResource | undefined,
	b: InstalledResource | undefined,
) =>
	!!a &&
	!!b &&
	hasCanonicalResourceLink(a) &&
	hasCanonicalResourceLink(b) &&
	a.platform === b.platform &&
	String(a.remote_id) === String(b.remote_id);

const AUTO_RESYNC_COOLDOWN_MS = 5 * 60 * 1000;

// Frontend cache for project records to avoid re-fetching from the backend on repeated
// navigations within the same session (e.g., mini-router open/close).
interface RecordCacheEntry {
	data: Record<string, any>;
	timestamp: number;
}
const projectRecordCache = new Map<string, RecordCacheEntry>();
const RECORD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getProjectRecordCacheKey(
	refs: { platform: string; id: string }[],
): string {
	const sorted = [...refs]
		.sort((a, b) =>
			`${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`),
		)
		.map((r) => `${r.platform}:${r.id}`)
		.join(",");
	return sorted;
}

export default function InstanceDetails(
	props: InstanceDetailsProps & {
		setRefetch?: (fn: () => Promise<void>) => void;
		router?: MiniRouter;
	},
) {
	const activeRouter = createMemo(() => props.router || router());

	// Handle id/slug from props first, then fallback to router params
	const getIdentifier = () => {
		if (props.id !== undefined) return `id:${props.id}`;
		if (props.slug) return `slug:${props.slug}`;
		const params = activeRouter()?.currentParams.get();
		const id = params?.id as string | undefined;
		if (id) return `id:${id}`;
		const slug = params?.slug as string | undefined;
		if (slug) return `slug:${slug}`;
		return "";
	};

	const paramsKey = createMemo(() => {
		const k = getIdentifier();
		return k;
	});

	// Resolve tab state before creating resources so tab-specific work can be
	// gated instead of every hidden tab fetching during the first render.
	const activeTab = createMemo<TabType>(() => {
		const params = activeRouter()?.currentParams.get();
		const tab = params?.activeTab as TabType | undefined;
		return tab &&
			[
				"home",
				"console",
				"resources",
				"crash",
				"screenshots",
				"settings",
				"versioning",
			].includes(tab)
			? tab
			: "home";
	});

	const prefetchedInstance = () => {
		const key = paramsKey();
		const candidate =
			props.prefetchedInstance ??
			instancesState.instances.find((stored) => {
				if (key.startsWith("id:")) {
					return stored.id === Number(key.slice(3));
				}
				return getInstanceSlug(stored) === key.slice(5);
			});
		if (!candidate || !key) return undefined;
		if (key.startsWith("id:") && candidate.id === Number(key.slice(3))) {
			return candidate;
		}
		if (
			key.startsWith("slug:") &&
			getInstanceSlug(candidate) === key.slice(5)
		) {
			return candidate;
		}
		return undefined;
	};

	const [instance, { refetch }] = createResource(
		paramsKey,
		async (key) => {
			if (!key) {
				return undefined;
			}
			try {
				let inst: Instance | undefined;
				if (key.startsWith("id:")) {
					const id = parseInt(key.slice(3), 10);
					inst = await getInstance(id);
				} else if (key.startsWith("slug:")) {
					const slugVal = key.slice(5);
					inst = await getInstanceBySlug(slugVal);
				}
				return inst;
			} catch (e) {
				console.error("[InstanceDetails] Error fetching instance:", e);
				throw e;
			}
		},
		{ initialValue: prefetchedInstance() },
	);
	const headerIconPreview = createAnimatedIconPreview(
		() => instance()?.iconPath || DEFAULT_ICONS[0],
	);

	const slug = createMemo(() => {
		const inst = instance();
		return inst ? getInstanceSlug(inst) : "";
	});

	const isPinned = createMemo(() =>
		slug() ? isPinnedInStore("instance", slug()) : false,
	);

	const handlePin = async () => {
		if (!slug()) return;
		if (isPinned()) {
			const pin = pinning.pins.find(
				(p) => p.page_type === "instance" && p.target_id === slug(),
			);
			if (pin) unpinPage(pin.id);
		} else {
			const inst = instance();
			if (!inst) return;
			await pinPage({
				page_type: "instance",
				target_id: slug(),
				label: inst.name,
				icon_url: inst.iconPath || inst.modpackIconUrl || null,
				platform: null,
				order_index: pinning.pins.length,
			});
		}
	};

	const [
		installedResources,
		{ refetch: refetchResources, mutate: mutateResources },
	] = createResource(instance, async (inst) => {
		if (!inst) return [];
		return await resources.getInstalled(inst.id);
	});

	const [projectRecords] = createResource(
		() => ({
			active: activeTab() === "resources" || activeTab() === "crash",
			resourcesList: installedResources(),
		}),
		async ({ active, resourcesList }) => {
			if (!active) return {};
			if (!resourcesList || resourcesList.length === 0) return {};
			const refs = resourcesList
				.filter(
					(r) =>
						r.remote_id &&
						(r.platform === "modrinth" || r.platform === "curseforge"),
				)
				.map((r) => ({
					platform: r.platform,
					id: r.remote_id,
				}));

			if (refs.length === 0) return {};

			// Check frontend cache first (avoids IPC + backend cache lookup)
			const cacheKey = getProjectRecordCacheKey(refs);
			const cached = projectRecordCache.get(cacheKey);
			if (cached && Date.now() - cached.timestamp < RECORD_CACHE_TTL_MS) {
				return cached.data;
			}

			try {
				const records: any[] = await invoke(
					"get_or_hydrate_resource_projects",
					{
						refs,
						allowNetwork: true,
						refreshStale: false,
					},
				);
				const map: Record<string, any> = {};
				for (const r of records) {
					const key = getProjectRecordKey(r.source, r.id);
					if (key) {
						map[key] = r;
					}
				}
				// Store in frontend cache for instant re-visits
				projectRecordCache.set(cacheKey, { data: map, timestamp: Date.now() });
				return map;
			} catch (e) {
				console.error("Failed to fetch project records:", e);
				return {};
			}
		},
	);

	const modpackOwnedResources = createMemo(() =>
		(installedResources() || []).filter(isModpackOwnedResource),
	);

	const customResources = createMemo(() =>
		(installedResources() || []).filter(isCustomResource),
	);

	const [provenanceBackfillKeys, setProvenanceBackfillKeys] = createSignal<
		Record<string, boolean>
	>({});
	const [provenanceBackfillInFlight, setProvenanceBackfillInFlight] =
		createSignal(false);

	const [autoResyncByInstance, setAutoResyncByInstance] = createSignal<
		Record<number, number>
	>({});
	const [autoResyncInFlight, setAutoResyncInFlight] = createSignal(false);

	const getLinkedResourceRefs = (
		resourcesList: InstalledResource[] | undefined,
	) => {
		if (!resourcesList || resourcesList.length === 0) return [];
		return resourcesList
			.filter(
				(r) =>
					!!r.remote_id &&
					(r.platform === "modrinth" || r.platform === "curseforge"),
			)
			.map((r) => ({ platform: r.platform, id: r.remote_id }));
	};

	const getMetadataHoleCount = (
		resourcesList: InstalledResource[] | undefined,
		recordMap: Record<string, any> | undefined,
	) => {
		const refs = getLinkedResourceRefs(resourcesList);
		if (refs.length === 0) return 0;

		let holes = 0;
		for (const ref of refs) {
			const key = getProjectRecordKey(ref.platform, ref.id);
			if (!key) {
				holes += 1;
				continue;
			}

			const record = recordMap?.[key];
			if (!record) {
				holes += 1;
				continue;
			}

			const summaryMissing = !record.summary || !String(record.summary).trim();
			const expectsIcon = !!record.icon_url;
			const iconMissing =
				expectsIcon &&
				(!record.icon_data ||
					(Array.isArray(record.icon_data) && record.icon_data.length === 0));

			if (summaryMissing || iconMissing) {
				holes += 1;
			}
		}

		return holes;
	};

	const triggerConditionalResync = async (reason: string) => {
		const current = instance();
		if (!current || !current.gameDirectory) return;
		if (autoResyncInFlight()) return;

		const now = Date.now();
		const last = autoResyncByInstance()[current.id] || 0;
		if (now - last < AUTO_RESYNC_COOLDOWN_MS) return;

		const holes = getMetadataHoleCount(installedResources(), projectRecords());
		if (holes === 0) return;

		console.info(
			`[InstanceDetails] Triggering conditional resync (${reason}), ${holes} metadata holes detected`,
		);

		setAutoResyncInFlight(true);
		setAutoResyncByInstance((prev) => ({ ...prev, [current.id]: now }));
		try {
			await resources.sync(current.id, slug(), current.gameDirectory || "");
			await refetchResources();
		} catch (e) {
			console.error("[InstanceDetails] Conditional resync failed:", e);
		} finally {
			setAutoResyncInFlight(false);
		}
	};

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

	// --- Linking & Overrides ---
	const [useGlobalResolution, setUseGlobalResolution] = createSignal(
		props.initialUseGlobalResolution ?? true,
	);
	const [gameWidth, setGameWidth] = createSignal(
		props.initialGameWidth || 1280,
	);
	const [gameHeight, setGameHeight] = createSignal(
		props.initialGameHeight || 720,
	);
	const [useGlobalJavaArgs, setUseGlobalJavaArgs] = createSignal(
		props.initialUseGlobalJavaArgs ?? true,
	);
	const [useGlobalJavaPath, setUseGlobalJavaPath] = createSignal(
		props.initialUseGlobalJavaPath ?? true,
	);
	const [useGlobalHooks, setUseGlobalHooks] = createSignal(
		props.initialUseGlobalHooks ?? true,
	);
	const [useGlobalEnvironmentVariables, setUseGlobalEnvironmentVariables] =
		createSignal(props.initialUseGlobalEnvironmentVariables ?? true);
	const [useGlobalLauncherAction, setUseGlobalLauncherAction] = createSignal(
		props.initialUseGlobalLauncherAction ?? true,
	);
	const [launcherActionOnLaunch, setLauncherActionOnLaunch] = createSignal<
		"stay-open" | "minimize" | "hide-to-tray" | "quit"
	>(
		["stay-open", "minimize", "hide-to-tray", "quit"].includes(
			props.initialLauncherActionOnLaunch || "",
		)
			? (props.initialLauncherActionOnLaunch as
					| "stay-open"
					| "minimize"
					| "hide-to-tray"
					| "quit")
			: "stay-open",
	);
	const [preLaunchHook, setPreLaunchHook] = createSignal(
		props.initialPreLaunchHook || "",
	);
	const [postExitHook, setPostExitHook] = createSignal(
		props.initialPostExitHook || "",
	);
	const [wrapperCommand, setWrapperCommand] = createSignal(
		props.initialWrapperCommand || "",
	);
	const [environmentVariables, setEnvironmentVariables] = createSignal(
		props.initialEnvironmentVariables || "",
	);

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
	const [isResolutionDirty, setIsResolutionDirty] = createSignal(
		props._dirty?.resolution || false,
	);
	const [isHooksDirty, setIsHooksDirty] = createSignal(
		props._dirty?.hooks || false,
	);
	const [isEnvDirty, setIsEnvDirty] = createSignal(props._dirty?.env || false);
	const [isLaunchActionDirty, setIsLaunchActionDirty] = createSignal(
		props._dirty?.launchAction || false,
	);

	const [saving, setSaving] = createSignal(false);
	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<
		string[]
	>([]);

	const inst = () => instance();
	const isRunningGlobal = createMemo(() =>
		Boolean(slug() ? instancesState.runningIds[slug()] : false),
	);
	const isLaunchingGlobal = createMemo(
		() =>
			(slug() ? instancesState.launchingIds[slug()] : false) &&
			!isRunningGlobal(),
	);
	const currentEditDraft = (): InstanceEditDraft => ({
		name: name(),
		iconPath: iconPath(),
		minMemory: minMemory()[0],
		maxMemory: maxMemory()[0],
		javaArgs: javaArgs(),
		javaPath: javaPath(),
		gameWidth: gameWidth(),
		gameHeight: gameHeight(),
		useGlobalResolution: useGlobalResolution(),
		useGlobalJavaArgs: useGlobalJavaArgs(),
		useGlobalJavaPath: useGlobalJavaPath(),
		useGlobalHooks: useGlobalHooks(),
		useGlobalEnvironmentVariables: useGlobalEnvironmentVariables(),
		useGlobalLauncherAction: useGlobalLauncherAction(),
		launcherActionOnLaunch: launcherActionOnLaunch(),
		preLaunchHook: preLaunchHook(),
		postExitHook: postExitHook(),
		wrapperCommand: wrapperCommand(),
		environmentVariables: environmentVariables(),
	});
	const currentEditDirty = (): InstanceEditDirty => ({
		name: isNameDirty(),
		icon: isIconDirty(),
		minMem: isMinMemDirty(),
		maxMem: isMaxMemDirty(),
		jvm: isJvmDirty(),
		javaPath: isJavaPathDirty(),
		resolution: isResolutionDirty(),
		hooks: isHooksDirty(),
		env: isEnvDirty(),
		launchAction: isLaunchActionDirty(),
	});

	const isDirty = createMemo(() => isInstanceEditDirty(currentEditDirty()));

	const modpackIconBase64 = useModpackIcon(() => {
		const current = instance();
		if (!current) return null;
		return {
			modpackId: current.modpackId,
			modpackPlatform: current.modpackPlatform,
			modpackIconUrl: current.modpackIconUrl,
		};
	});

	// Create uploadedIcons array that includes all custom icons seen this session
	const uploadedIcons = createMemo(() => {
		let result = [...customIconsThisSession()];
		const current = iconPath();
		const inst = instance();
		const originalIcon = inst?.iconPath;
		const modpackIcon = modpackIconBase64();

		// Add current icon if it's not a default, not the original, not the modpack icon, and not already in the list
		if (
			current &&
			!isDefaultIcon(current) &&
			!areIconsEqual(current, originalIcon) &&
			!areIconsEqual(current, modpackIcon) &&
			!result.some((icon) => areIconsEqual(icon, current))
		) {
			result = [current, ...result];
		}

		// Always add modpack icon first if it exists (regardless of session filtering)
		if (modpackIcon && !isDefaultIcon(modpackIcon)) {
			// Remove any existing instances (using robust comparison)
			result = result.filter((icon) => !areIconsEqual(icon, modpackIcon));
			// Add at the beginning
			result = [modpackIcon, ...result];
		}

		return result;
	});

	// Track custom icons in session list
	createEffect(() => {
		const current = iconPath();
		const modpackIcon = modpackIconBase64();
		setCustomIconsThisSession((prev) => {
			// Start with previous icons, filtering out any that are now known to be modpack icons
			let filtered = prev.filter((icon) => !areIconsEqual(icon, modpackIcon));
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
			// Add current icon if it's not a default, not the modpack icon, not equivalent to modpack icon, and not already in the filtered list
			if (
				current &&
				!isDefaultIcon(current) &&
				!areIconsEqual(current, modpackIcon) &&
				!currentIsModpackEquivalent &&
				!filtered.some((icon) => areIconsEqual(icon, current))
			) {
				filtered = [current, ...filtered];
			}
			return filtered;
		});
	});

	// Seed global running state when the backend reports a live process
	createEffect(async () => {
		const inst = instance();
		const currentSlug = slug();
		if (inst && currentSlug && !isInstanceRunningInStore(currentSlug)) {
			try {
				const running = await isInstanceRunning(inst);
				if (running) {
					setRunning(currentSlug, {
						pid: 0,
						startTime: Math.floor(Date.now() / 1000),
					});
				}
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
		const mountedRouter = activeRouter();
		mountedRouter?.setRefetch(handleRefetch, "/instance");

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
			mountedRouter?.setCanExit(null);
			mountedRouter?.clearRefetch(handleRefetch);
		});

		// Register state provider for pop-out window handoff
		activeRouter()?.registerStateProvider("/instance", () => {
			const { router: _, ...cleanProps } = props;
			return {
				...cleanProps,
				slug: slug(),
				prefetchedInstance: instance(),
				activeTab: activeTab(),
				...toInstanceEditHandoff(currentEditDraft(), currentEditDirty()),
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
	});

	const [selectedTab, setSelectedTab] = createSignal<TabType>(activeTab());
	const instanceTabLoader = createRetainedTabLoader(
		activeTab(),
		(tab) => instanceTabLoaders[tab],
		(tab, error) => {
			console.warn(`Failed to preload instance tab ${tab}:`, error);
		},
	);

	createEffect(() => {
		const tab = activeTab();
		setSelectedTab(tab);
		instanceTabLoader.retain(tab);
	});

	createEffect(
		on(
			() =>
				[
					activeTab(),
					instance()?.id,
					instance()?.modpackId,
					instance()?.modpackVersionId,
					instance()?.modpackPlatform,
				] as const,
			([tab, id, modpackId, modpackVersionId, modpackPlatform]) => {
				if (
					!id ||
					!modpackId ||
					!modpackVersionId ||
					!modpackPlatform ||
					(tab !== "resources" && tab !== "versioning")
				) {
					return;
				}

				const key = `${id}:${modpackPlatform}:${modpackId}:${modpackVersionId}`;
				if (provenanceBackfillKeys()[key] || provenanceBackfillInFlight()) {
					return;
				}

				setProvenanceBackfillInFlight(true);
				void invoke("backfill_modpack_resource_provenance_fast", {
					instanceId: id,
				})
					.catch((e) => {
						console.error(
							"Failed to start fast modpack resource provenance backfill:",
							e,
						);
					})
					.finally(() => {
						setProvenanceBackfillKeys((prev) => ({ ...prev, [key]: true }));
						setProvenanceBackfillInFlight(false);
					});
			},
			{ defer: true },
		),
	);

	const [showExportDialog, setShowExportDialog] = createSignal(false);

	const [busy, setBusy] = createSignal(false);

	const [activeAccount] = createResource<any, boolean>(
		() => activeTab() === "versioning" || undefined,
		async () => {
			try {
				return await getActiveAccount();
			} catch {
				return null;
			}
		},
	);

	const isGuest = () => activeAccount()?.account_type === ACCOUNT_TYPE_GUEST;

	const [requiredJava] = createResource(
		() => (activeTab() === "settings" ? instance()?.id : undefined),
		async (id) => {
			if (!id) return null;
			return await invoke<number>("get_instance_required_java", {
				instanceId: id,
			});
		},
	);
	const [detectedJavas, { refetch: refetchDetected }] = createResource<
		any[],
		boolean
	>(
		() => activeTab() === "settings",
		(enabled) => (enabled ? invoke("detect_java") : Promise.resolve([])),
	);
	const [managedJavas, { refetch: refetchManaged }] = createResource<
		any[],
		boolean
	>(
		() => activeTab() === "settings",
		(enabled) => (enabled ? invoke("get_managed_javas") : Promise.resolve([])),
	);
	const [globalJavaPaths, { refetch: refetchGlobal }] = createResource<
		any[],
		boolean
	>(
		() => activeTab() === "settings",
		(enabled) =>
			enabled ? invoke("get_global_java_paths") : Promise.resolve([]),
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
		return inst ? isInstanceOperationInProgress(inst) : false;
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
	let suppressRowNavigationUntil = 0;

	const suppressRowNavigation = () => {
		suppressRowNavigationUntil = Date.now() + 300;
	};

	const handleRowClick = (row: any, event: MouseEvent) => {
		const target = event.target as HTMLElement;
		if (Date.now() < suppressRowNavigationUntil) return;
		// Prevent navigation if clicking interactive elements inside the row
		if (
			target.closest("button") ||
			target.closest("a") ||
			target.closest("input") ||
			target.closest(".v-switch") ||
			target.closest(`.${styles["row-actions-cell"]}`) ||
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
					name: row.original.display_name,
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
			{ severity: "warning", isDestructive: true },
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

	// Resources Tab State
	const [resourceTypeFilter, setResourceTypeFilter] =
		createSignal<string>("All");
	const [resourceSearch, setResourceSearch] = createSignal("");
	const [isCompactTable, setIsCompactTable] = createSignal(false);
	const [modpackResourcesExpanded, setModpackResourcesExpanded] =
		createSignal(false);
	const [overrideConflictConfirmed, setOverrideConflictConfirmed] =
		createSignal(false);
	const [updates, setUpdates] = createSignal<Record<number, ResourceVersion>>(
		{},
	);
	const [checkingUpdates, setCheckingUpdates] = createSignal(false);
	const [checkingPerResource, setCheckingPerResource] = createSignal<
		Set<number>
	>(new Set());
	const [checkedPerResource, setCheckedPerResource] = createSignal<Set<number>>(
		new Set(),
	);
	const [totalRam, setTotalRam] = createSignal(16384);

	let totalRamLoaded = false;
	createEffect(() => {
		if (activeTab() !== "settings" || totalRamLoaded) return;
		totalRamLoaded = true;
		void invoke("get_system_memory_mb")
			.then((ram) => {
				if (typeof ram === "number" && ram > 0) setTotalRam(ram);
			})
			.catch((e) => {
				console.error("Failed to get total RAM:", e);
			});
	});

	// Modpack versions for picker
	const [selectedModpackVersionId, setSelectedModpackVersionId] = createSignal<
		string | null
	>(null);

	const [mcVersions] = createResource(
		() => activeTab() === "versioning" || undefined,
		() => getMinecraftVersions(),
	);
	const loadersList = createMemo(() => {
		const metadata = mcVersions();
		const loaderIds = metadata
			? getAllModloaders(metadata)
			: ["vanilla", "fabric", "forge", "neoforge", "quilt"];

		return loaderIds.map((loaderId) => ({
			label: getModloaderDisplayName(loaderId),
			value: loaderId,
		}));
	});
	const [selectedMcVersion, setSelectedMcVersion] = createSignal("");
	const [includeSnapshots, setIncludeSnapshots] = createSignal(false);
	const [selectedLoader, setSelectedLoader] = createSignal("vanilla");
	const [selectedLoaderVersion, setSelectedLoaderVersion] = createSignal("");
	const [compatibilityInitialized, setCompatibilityInitialized] =
		createSignal(false);

	const [modpackVersions, { mutate: mutateModpackVersions }] = createResource(
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

	const applyUpdateCheckResult = (result: LightweightUpdateCheckResult) => {
		const newUpdates: Record<number, ResourceVersion> = {};
		for (const update of result.resourceUpdates) {
			newUpdates[update.resourceId] = update.version;
		}
		setUpdates(newUpdates);

		if (result.modpackVersions.length > 0) {
			mutateModpackVersions(result.modpackVersions);
		}
	};

	const hydrateUpdateSnapshot = async (instanceId: number) => {
		try {
			const snapshot = await invoke<InstanceUpdateSnapshot | null>(
				"get_instance_update_snapshot",
				{
					instanceId,
				},
			);
			if (snapshot) {
				applyUpdateCheckResult(snapshot);
			} else {
				setUpdates({});
			}
			return snapshot;
		} catch (e) {
			console.error("Failed to load cached update snapshot:", e);
			setUpdates({});
			return null;
		}
	};

	createEffect(() => {
		const inst = instance();
		const tab = activeTab();
		setUpdates({});
		setCheckedPerResource(new Set());
		if (!inst || (tab !== "resources" && tab !== "versioning")) return;
		void hydrateUpdateSnapshot(inst.id);
	});

	const availableModpackUpdate = createMemo(() => {
		const inst = instance();
		const versions = modpackVersions();
		if (!inst?.modpackId || !versions || versions.length === 0) return null;
		const currentId = inst.modpackVersionId
			? String(inst.modpackVersionId)
			: null;
		return selectEligibleModpackUpdate(
			versions,
			currentId,
			inst.minecraftVersion,
		);
	});

	const currentModpackVersion = createMemo(() => {
		const inst = instance();
		const currentId = inst?.modpackVersionId
			? String(inst.modpackVersionId)
			: null;
		return (
			modpackVersions()?.find((version) => String(version.id) === currentId) ||
			null
		);
	});

	const searchableMcVersions = createMemo(() => {
		const versions = mcVersions()?.game_versions || [];
		const selected = selectedMcVersion();

		let visibleVersions = includeSnapshots()
			? versions
			: versions.filter((version) => version.stable);

		if (
			selected &&
			!visibleVersions.some((version) => version.id === selected)
		) {
			const selectedMeta = versions.find((version) => version.id === selected);
			if (selectedMeta) {
				visibleVersions = [selectedMeta, ...visibleVersions];
			}
		}

		return visibleVersions.map((version) => ({
			...version,
			searchString: `${version.id} ${version.version_type || ""}`.trim(),
		}));
	});

	const currentVersionSupportedLoaders = createMemo(() => {
		const metadata = mcVersions();
		const version = selectedMcVersion();
		if (!metadata || !version)
			return [selectedLoader().toLowerCase() || "vanilla"];

		const supported = getModloadersForGameVersion(metadata, version);
		const current = selectedLoader().toLowerCase();
		if (current && !supported.includes(current)) {
			return [current, ...supported];
		}

		return supported;
	});

	const searchableLoaderVersions = createMemo(() => {
		const metadata = mcVersions();
		const version = selectedMcVersion();
		const loader = selectedLoader();
		if (!metadata || !version || !loader) return [];

		let loaderInfo = getLoaderVersionsForGameVersion(metadata, version, loader);
		const selectedVersion = selectedLoaderVersion();
		if (
			selectedVersion &&
			!loaderInfo.some(
				(loaderVersion) => loaderVersion.version === selectedVersion,
			)
		) {
			loaderInfo = [{ version: selectedVersion, stable: true }, ...loaderInfo];
		}

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
				const metadata = mcVersions();
				const currentMeta = metadata?.game_versions.find(
					(version) => version.id === inst.minecraftVersion,
				);

				batch(() => {
					setSelectedMcVersion(inst.minecraftVersion);
					setSelectedLoader((inst.modloader || "vanilla").toLowerCase());
					setSelectedLoaderVersion(inst.modloaderVersion || "");
					setIncludeSnapshots(currentMeta ? !currentMeta.stable : false);

					if (inst.modpackId && !selectedModpackVersionId()) {
						setSelectedModpackVersionId(
							inst.modpackVersionId ? String(inst.modpackVersionId) : null,
						);
					}
				});
			}
		}
	});

	createEffect(() => {
		const inst = instance();
		const tab = activeTab();
		const metadata = mcVersions();
		const currentVersion = selectedMcVersion();

		if (
			!inst ||
			tab !== "versioning" ||
			inst.modpackId ||
			!metadata ||
			!currentVersion
		) {
			return;
		}

		const selectedMeta = metadata.game_versions.find(
			(version) => version.id === currentVersion,
		);
		if (!compatibilityInitialized() && selectedMeta && !selectedMeta.stable) {
			if (!includeSnapshots()) {
				setIncludeSnapshots(true);
				return;
			}
		}

		const resolved = resolveCompatibleVersionSelection({
			metadata,
			minecraftVersion: currentVersion,
			modloader: selectedLoader(),
			modloaderVersion: selectedLoaderVersion(),
			includeSnapshots: includeSnapshots(),
		});

		const changed =
			resolved.minecraftVersion !== currentVersion ||
			resolved.modloader !== selectedLoader() ||
			resolved.modloaderVersion !== selectedLoaderVersion();

		if (!changed) {
			if (!compatibilityInitialized()) {
				setCompatibilityInitialized(true);
			}
			return;
		}

		batch(() => {
			if (resolved.minecraftVersion !== currentVersion) {
				setSelectedMcVersion(resolved.minecraftVersion);
			}
			if (resolved.modloader !== selectedLoader()) {
				setSelectedLoader(resolved.modloader);
			}
			if (resolved.modloaderVersion !== selectedLoaderVersion()) {
				setSelectedLoaderVersion(resolved.modloaderVersion);
			}
		});

		const notifiableAdjustments = getNotifiableSelectionAdjustments(
			resolved.adjustments,
		);

		if (compatibilityInitialized() && notifiableAdjustments.length > 0) {
			showToast({
				title: "Compatibility Adjusted",
				description: describeSelectionAdjustments(notifiableAdjustments),
				severity: "info",
			});
		}

		if (!compatibilityInitialized()) {
			setCompatibilityInitialized(true);
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
			return;
		}

		if (!match && vs.length > 0) {
			const fallbackId = String(vs[0].id);
			if (fallbackId !== current) {
				setSelectedModpackVersionId(fallbackId);
				showToast({
					title: "Version Updated",
					description:
						"The previously selected modpack version is unavailable. Switched to the latest available version.",
					severity: "info",
				});
			}
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
				if (!isJvmDirty()) {
					setJavaArgs(inst.javaArgs || "");
					setUseGlobalJavaArgs(inst.useGlobalJavaArgs);
				}
				if (!isJavaPathDirty()) {
					setJavaPath(inst.javaPath || "");
					setUseGlobalJavaPath(inst.useGlobalJavaPath);
				}
				if (!isResolutionDirty()) {
					setUseGlobalResolution(inst.useGlobalResolution);
					setGameWidth(inst.gameWidth);
					setGameHeight(inst.gameHeight);
				}
				if (!isHooksDirty()) {
					setUseGlobalHooks(inst.useGlobalHooks);
					setPreLaunchHook(inst.preLaunchHook || "");
					setPostExitHook(inst.postExitHook || "");
					setWrapperCommand(inst.wrapperCommand || "");
				}
				if (!isEnvDirty()) {
					setUseGlobalEnvironmentVariables(inst.useGlobalEnvironmentVariables);
					setEnvironmentVariables(inst.environmentVariables || "");
				}
				if (!isLaunchActionDirty()) {
					setUseGlobalLauncherAction(inst.useGlobalLauncherAction);
					setLauncherActionOnLaunch(inst.launcherActionOnLaunch || "stay-open");
				}
			});
		}
	});

	const handleModpackVersionSelect = (
		versionId: string,
		version?: ModpackVersion,
	) => {
		setSelectedModpackVersionId(versionId);
	};

	// Reset selections when switching instances
	createEffect(() => {
		const slug = activeRouter()?.currentParams.get()?.slug;
		if (slug) {
			setSelectedMcVersion("");
			setIncludeSnapshots(false);
			setSelectedLoader("vanilla");
			setSelectedLoaderVersion("");
			setSelectedModpackVersionId(null);
			setCompatibilityInitialized(false);
		}
	});

	// Sync modpack selection with instance data
	// (Redundant effect removed)

	const updateModpackVersion = async (versionId: string) => {
		const inst = instance();
		if (!inst) return;

		setBusy(true);
		try {
			// Use the new delta-based update engine
			await startModpackUpdate(inst.id, versionId);
			// The task emits core://instance-installed on completion, which triggers a refetch
			await refetch();
		} catch (e) {
			console.error("Failed to update modpack version:", e);
		} finally {
			setBusy(false);
		}
	};

	const rolloutModpackUpdate = async () => {
		const inst = instance();
		const vid = selectedModpackVersionId();
		if (!inst || !vid) return;

		const targetVersion = modpackVersions()?.find(
			(version) => String(version.id) === vid,
		);
		const nextMcVersion = targetVersion?.game_versions?.[0];

		if (
			nextMcVersion &&
			nextMcVersion !== inst.minecraftVersion &&
			!(await confirmMinecraftVersionChange({
				instanceName: inst.name,
				currentVersion: inst.minecraftVersion,
				nextVersion: nextMcVersion,
				context: "modpack-update",
			}))
		) {
			return;
		}

		await updateModpackVersion(vid);
	};

	const handleUnlink = async () => {
		const inst = instance();
		if (!inst) return;

		const confirmed = await dialogStore.confirm(
			"Unlink Modpack",
			"Are you sure you want to unlink this instance from the modpack? You will no longer receive updates from the platform, but your files will remain intact.",
			{ severity: "warning" },
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

	const handleDeleteModpackFilesAndUnlink = async () => {
		const inst = instance();
		if (!inst) return;

		const bundledResources = modpackOwnedResources();
		const confirmed = await dialogStore.confirm(
			"Delete Modpack Files?",
			`This will delete ${bundledResources.length} bundled modpack resources from this instance, keep custom resources and overrides, then unlink the modpack connection.`,
			{
				severity: "warning",
				okLabel: "Delete & Unlink",
				isDestructive: true,
			},
		);
		if (!confirmed) return;

		setBusy(true);
		try {
			for (const resource of bundledResources) {
				await invoke("delete_resource", {
					instanceId: inst.id,
					resourceId: resource.id,
				});
			}

			await unlinkInstance(inst);
			await Promise.all([refetch(), refetchResources()]);
			showToast({
				title: "Modpack Files Deleted",
				description:
					"Bundled modpack resources were removed and the instance was unlinked.",
				severity: "success",
			});
		} catch (e) {
			console.error("Failed to delete modpack files and unlink:", e);
			await refetchResources();
			showToast({
				title: "Delete Failed",
				description:
					"Vesta stopped before unlinking. Your custom resources were left intact.",
				severity: "error",
			});
		} finally {
			setBusy(false);
		}
	};

	const handleStandardUpdate = async () => {
		const inst = instance();
		if (!inst) return;
		if (!selectedMcVersion()) return;

		let nextMcVersion = selectedMcVersion();
		let nextLoader = selectedLoader().toLowerCase();
		let nextLoaderVersion = selectedLoaderVersion();

		const metadata = mcVersions();
		if (metadata) {
			const resolved = resolveCompatibleVersionSelection({
				metadata,
				minecraftVersion: nextMcVersion,
				modloader: nextLoader,
				modloaderVersion: nextLoaderVersion,
				includeSnapshots: includeSnapshots(),
			});

			nextMcVersion = resolved.minecraftVersion;
			nextLoader = resolved.modloader;
			nextLoaderVersion = resolved.modloaderVersion;

			if (resolved.adjustments.length > 0) {
				batch(() => {
					setSelectedMcVersion(nextMcVersion);
					setSelectedLoader(nextLoader);
					setSelectedLoaderVersion(nextLoaderVersion);
				});

				const notifiableAdjustments = getNotifiableSelectionAdjustments(
					resolved.adjustments,
				);

				if (notifiableAdjustments.length > 0) {
					showToast({
						title: "Compatibility Adjusted",
						description: describeSelectionAdjustments(notifiableAdjustments),
						severity: "info",
					});
				}
			}
		}

		if (
			nextMcVersion !== inst.minecraftVersion &&
			!(await confirmMinecraftVersionChange({
				instanceName: inst.name,
				currentVersion: inst.minecraftVersion,
				nextVersion: nextMcVersion,
				context: "manual",
			}))
		) {
			return;
		}

		setBusy(true);
		try {
			// updateInstance expects full Instance object
			await updateInstance({
				...inst,
				minecraftVersion: nextMcVersion,
				modloader: nextLoader === "vanilla" ? null : nextLoader,
				modloaderVersion:
					nextLoader === "vanilla" ? null : nextLoaderVersion || null,
			});
			await repairInstance(inst.id);
			await refetch();
		} catch (e) {
			console.error("Failed to update instance version:", e);
		} finally {
			setBusy(false);
		}
	};

	// Check updates when entering resources tab; resync only if metadata holes are detected.
	createEffect(async () => {
		const tab = activeTab();
		const inst = instance();
		if (tab === "resources" && inst && !busy()) {
			await triggerConditionalResync("resources-tab-enter");

			if (installedResources.loading || checkingUpdates()) return;

			const snapshot = await hydrateUpdateSnapshot(inst.id);
			if (!snapshot?.isStale) return;

			void checkUpdates(false);
		}
	});

	createEffect(
		on(
			() =>
				[
					activeTab(),
					instance()?.id,
					installedResources.loading,
					projectRecords.loading,
					installedResources(),
					projectRecords(),
				] as const,
			([tab, id, installedLoading, recordsLoading, resourcesList, records]) => {
				if (tab !== "resources" && tab !== "crash") return;
				if (!id || installedLoading || recordsLoading) return;
				if (!resourcesList || resourcesList.length === 0) return;

				const holes = getMetadataHoleCount(resourcesList, records || {});
				if (holes > 0) {
					void triggerConditionalResync("instance-load-holes");
				}
			},
			{ defer: true },
		),
	);

	const checkUpdates = async (forceRefresh = false) => {
		const inst = instance();
		if (!inst || checkingUpdates()) return;

		setCheckingUpdates(true);

		try {
			const result = await invoke<LightweightUpdateCheckResult>(
				"check_instance_updates_lightweight",
				{
					instanceId: inst.id,
					forceRefresh,
				},
			);

			applyUpdateCheckResult(result);
		} catch (e) {
			console.error("Failed to check instance updates:", e);
			showToast({
				title: "Update Check Failed",
				description: "Vesta could not check for updates right now.",
				severity: "error",
			});
		} finally {
			setCheckingUpdates(false);
		}
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

	const getOppositeActiveCopies = (resource: InstalledResource) => {
		const sourceKind = normalizeResourceSourceKind(resource);
		return (installedResources() || []).filter(
			(candidate) =>
				candidate.id !== resource.id &&
				candidate.is_enabled &&
				normalizeResourceSourceKind(candidate) !== sourceKind &&
				isSameCanonicalProject(candidate, resource),
		);
	};

	const toggleResourceWithOverrides = async (
		resource: InstalledResource,
		enabled: boolean,
	) => {
		const peers = enabled ? getOppositeActiveCopies(resource) : [];

		if (peers.length > 0 && !overrideConflictConfirmed()) {
			const confirmed = await dialogStore.confirm(
				"Switch Active Resource?",
				`${resource.display_name} matches ${peers
					.map((peer) => peer.display_name)
					.join(", ")} from the ${
					isModpackOwnedResource(resource)
						? "custom resources"
						: "linked modpack"
				}. Vesta will disable the other copy so Minecraft only loads one version.`,
				{ okLabel: "Switch", cancelLabel: "Cancel", severity: "warning" },
			);
			if (!confirmed) return false;
			setOverrideConflictConfirmed(true);
		}

		const previous = installedResources.latest;
		const affectedIds = new Set([resource.id, ...peers.map((peer) => peer.id)]);

		mutateResources((prev) =>
			prev?.map((row) => {
				if (!affectedIds.has(row.id)) return row;
				if (row.id === resource.id) return { ...row, is_enabled: enabled };
				return { ...row, is_enabled: false };
			}),
		);

		try {
			for (const peer of peers) {
				await invoke("toggle_resource", {
					resourceId: peer.id,
					enabled: false,
				});
			}
			await invoke("toggle_resource", {
				resourceId: resource.id,
				enabled,
			});
			await refetchResources();
			return true;
		} catch (e) {
			console.error("Failed to toggle resource:", e);
			mutateResources(previous);
			return false;
		}
	};

	// Sync resources separately - only on actual instance change
	createEffect(
		on(
			() => instance()?.id,
			(id) => {
				const inst = instance();
				if (id && inst) {
					resources.clearSelection();
					void triggerConditionalResync("instance-switch");
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
			size: 48, // Sync with CSS
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
				<div class={`${styles["col-selection-wrapper"]} v-col-selection`}>
					<div
						class={styles["select-icon-container"]}
						onClick={(e: MouseEvent) => e.stopPropagation()}
					>
						<ResourceIcon
							record={
								projectRecords()?.[
									getProjectRecordKey(
										info.row.original.platform,
										info.row.original.remote_id,
									) || ""
								]
							}
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
			cell: (info) => {
				const displayName = info.getValue();
				const fileName =
					info.row.original.local_path.split(/[\\/]/).pop() ?? "";
				return (
					<div class={styles["res-info-cell"]}>
						<div class={styles["res-title-group"]}>
							<Tooltip placement="top">
								<TooltipTrigger as="span" class={styles["res-title"]}>
									{displayName}
								</TooltipTrigger>
								<TooltipContent>{displayName}</TooltipContent>
							</Tooltip>
							<Tooltip placement="top">
								<TooltipTrigger as="span" class={styles["res-path"]}>
									{fileName}
								</TooltipTrigger>
								<TooltipContent>{fileName}</TooltipContent>
							</Tooltip>
						</div>
					</div>
				);
			},
		}),
		columnHelper.accessor("current_version", {
			header: "Version",
			cell: (info) => (
				<span class={styles["col-version-text"]}>{info.getValue()}</span>
			),
		}),
		columnHelper.accessor("is_enabled", {
			header: () => <div style="text-align: center; width: 100%;">Enabled</div>,
			cell: (info) => (
				<div
					class={styles["col-enabled"]}
					onClick={(e: MouseEvent) => e.stopPropagation()}
				>
					<Switch
						checked={info.getValue()}
						onCheckedChange={(enabled: boolean) =>
							toggleResourceWithOverrides(info.row.original, enabled)
						}
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
			size: 68,
			cell: (info) => (
				<ResourceRowActions
					resource={info.row.original}
					update={updates()[info.row.original.id]}
					isCheckingForUpdates={checkingPerResource().has(info.row.original.id)}
					hasCheckedForUpdates={checkedPerResource().has(info.row.original.id)}
					showVersionInfo={isCompactTable()}
					currentVersion={info.row.original.current_version}
					busy={busy()}
					onMenuItemSelect={suppressRowNavigation}
					onUpdate={handleUpdate}
					onDelete={async (resource) => {
						if (
							await dialogStore.confirm(
								"Delete Resource",
								`Are you sure you want to delete ${resource.display_name}? This will remove the file from your instance.`,
								{ severity: "warning", isDestructive: true },
							)
						) {
							const previous = installedResources.latest;
							mutateResources((prev) =>
								prev?.filter((r) => r.id !== resource.id),
							);

							try {
								await invoke("delete_resource", {
									instanceId: resource.instance_id,
									resourceId: resource.id,
								});
								refetchResources();
							} catch (e) {
								console.error("Failed to delete resource:", e);
								mutateResources(previous);
							}
						}
					}}
					onCheckUpdates={async (resource) => {
						if (isModpackOwnedResource(resource)) return;
						setCheckingPerResource((prev) => new Set([...prev, resource.id]));
						const inst = instance();
						if (!inst) return;
						try {
							const result = await invoke<LightweightUpdateCheckResult>(
								"check_instance_updates_lightweight",
								{
									instanceId: inst.id,
									forceRefresh: false,
									resourceIds: [resource.id],
									forceResourceIds: [resource.id],
								},
							);
							applyUpdateCheckResult(result);
						} catch (e) {
							console.error(
								`Failed to check updates for ${resource.display_name}:`,
								e,
							);
						} finally {
							setCheckingPerResource((prev) => {
								const next = new Set(prev);
								next.delete(resource.id);
								return next;
							});
							setCheckedPerResource((prev) => new Set([...prev, resource.id]));
						}
					}}
				/>
			),
		}),
	];

	const filteredData = createMemo(() => {
		const data = instance()?.modpackId
			? [...modpackOwnedResources(), ...customResources()]
			: installedResources() || [];
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
				columnVisibility: {
					current_version: !isCompactTable(),
				},
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
		enableRowSelection: (row) =>
			!(
				instance()?.modpackId &&
				!modpackResourcesExpanded() &&
				isModpackOwnedResource(row.original)
			),
	});

	// Subscribe to console logs
	const cleanups: (() => void)[] = [];
	onMount(async () => {
		// Unified cleaning - actual log handling moved to ConsoleTab/ConsoleStore

		cleanups.push(
			await listen("core://instance-launched", (ev) => {
				const payload = (ev as { payload: { instance_id?: string } }).payload;
				if (payload.instance_id === slug()) {
					consoleStore.clear();
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

	const currentCrash = createMemo(() => {
		const currentSlug = slug();
		const inst = instance();
		if (!currentSlug || !inst) return undefined;
		return (
			getCrashDetails(currentSlug) ||
			parseCrashDetails(inst.crashDetails, currentSlug)
		);
	});

	const playButtonText = createMemo(() => {
		const inst = instance();
		if (!inst) return "Play Now";

		if (isRunningGlobal()) return "Kill Instance";
		if (isLaunchingGlobal()) return "Warming up...";
		if (isInstalling()) return `${getInstanceOperationLabel(inst)}...`;

		if (isInterrupted()) {
			const op = inst.lastOperation;
			const opName =
				op === "hard-reset"
					? "Reset"
					: op === "repair"
						? "Repair"
						: op === "update"
							? "Update"
							: "Installation";
			return `Resume ${opName}`;
		}

		if (needsInstallation()) {
			return isFailed() ? "Retry Install" : "Install Now";
		}

		if (currentCrash()) return "Crash Details";

		return "Play Now";
	});

	const handlePlay = async () => {
		const inst = instance();
		const currentSlug = slug();
		if (
			!inst ||
			!currentSlug ||
			busy() ||
			isLaunchingGlobal() ||
			isRunningGlobal()
		) {
			return;
		}

		if (currentCrash() && !isInterrupted() && !needsInstallation()) {
			handleTabChange("crash");
			return;
		}

		const willLaunch = !isInterrupted() && !needsInstallation();
		if (willLaunch) {
			setLaunching(currentSlug, true);
		}

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
			showToast({
				title: "Action Failed",
				description: String(e),
				severity: "error",
			});
		}
		setBusy(false);
	};

	const handleKill = async () => {
		const inst = instance();
		const currentSlug = slug();
		if (!inst || !currentSlug || busy()) return;

		setLaunching(currentSlug, false);
		clearRunning(currentSlug);
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
			const fresh = await getInstance(inst.id);
			await updateInstance(applyInstanceEditDraft(fresh, currentEditDraft()));
			batch(() => {
				// Clear temporary session icons once we've successfully saved to the backend
				setCustomIconsThisSession([]);
				// Reset dirty flags after successful save
				setIsNameDirty(false);
				setIsIconDirty(false);
				setIsMinMemDirty(false);
				setIsMaxMemDirty(false);
				setIsJvmDirty(false);
				setIsJavaPathDirty(false);
				setIsResolutionDirty(false);
				setIsHooksDirty(false);
				setIsEnvDirty(false);
				setIsLaunchActionDirty(false);
			});
			await refetch();
		} catch (e) {
			console.error("Failed to save instance settings:", e);
		}
		setSaving(false);
	};

	// Icon path is now handled by the IconPicker component directly

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
	const instanceTabs = createMemo(() => {
		const tabs: PageSidebarTab[] = [
			{ value: "home", label: "Home" },
			{ value: "resources", label: "Resources" },
			{ value: "console", label: "Console" },
		];
		if (currentCrash()) {
			tabs.push({ value: "crash", label: "Crash", variant: "error" as const });
		}
		tabs.push(
			{ value: "screenshots", label: "Screenshots" },
			{ value: "versioning", label: "Version" },
			{ value: "settings", label: "Settings" },
		);
		return tabs;
	});

	const handleTabChange = (tab: TabType) => {
		if (tab === activeTab()) return;
		instanceTabLoader.prepare(tab);
		setSelectedTab(tab);
		// Tabs are state within this page, not separate router entries. Replacing
		// the query keeps the instance shell mounted while tab code suspends.
		activeRouter()?.updateQuery("activeTab", tab);
	};

	createEffect(() => {
		if (
			!instance.loading &&
			instance.latest &&
			!currentCrash() &&
			activeTab() === "crash"
		) {
			handleTabChange("home");
		}
	});

	return (
		<div class={styles["instance-details-page"]}>
			<PageSidebar
				tabs={instanceTabs()}
				activeTab={selectedTab()}
				onTabChange={(v) => handleTabChange(v as TabType)}
				onTabIntent={(v) => instanceTabLoader.preload(v as TabType)}
			>
				<div
					class={styles["content-wrapper"]}
					classList={{
						[styles["content-wrapper--console"]]: activeTab() === "console",
					}}
				>
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
									onMouseEnter={headerIconPreview.activate}
									onMouseLeave={headerIconPreview.deactivate}
									onFocusIn={headerIconPreview.activate}
									onFocusOut={headerIconPreview.deactivate}
								>
									<div
										class={styles["header-background"]}
										style={{
											"background-image": (
												headerIconPreview.displaySource() || ""
											).startsWith("linear-gradient")
												? headerIconPreview.displaySource() || ""
												: `url('${headerIconPreview.displaySource() || resolveResourceUrl(inst().iconPath || DEFAULT_ICONS[0])}')`,
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
														<Tooltip placement="top">
															<TooltipTrigger>
																<svg
																	class={styles["linked-icon"]}
																	xmlns="http://www.w3.org/2000/svg"
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="2"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	onClick={() => handleTabChange("versioning")}
																>
																	<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
																	<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
																</svg>
															</TooltipTrigger>
															<TooltipContent>
																Linked to a{" "}
																{inst().modpackPlatform?.toLowerCase()} modpack
															</TooltipContent>
														</Tooltip>
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
												aria-label="Open Folder"
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
												title={
													isPinned() ? "Unpin from Sidebar" : "Pin to Sidebar"
												}
												aria-label={
													isPinned() ? "Unpin from Sidebar" : "Pin to Sidebar"
												}
												class={styles["header-square-button"]}
											>
												<Show
													when={isPinned()}
													fallback={<PinIcon width="18" height="18" />}
												>
													<PinOffIcon width="18" height="18" />
												</Show>
											</Button>

											<Button
												onClick={isRunningGlobal() ? handleKill : handlePlay}
												disabled={
													busy() || isInstalling() || isLaunchingGlobal()
												}
												color={
													isRunningGlobal() || currentCrash()
														? "destructive"
														: "primary"
												}
												data-color={
													isRunningGlobal() || currentCrash()
														? "destructive"
														: "primary"
												}
												variant="solid"
												size="lg"
												title={playButtonText()}
												aria-label={playButtonText()}
												class={styles["details-play-button"]}
											>
												<Show
													when={busy() || isInstalling() || isLaunchingGlobal()}
													fallback={
														<span class={styles["details-play-button-icon"]}>
															<Show
																when={isRunningGlobal()}
																fallback={
																	<Show
																		when={currentCrash()}
																		fallback={
																			<PlayIcon width="16" height="16" />
																		}
																	>
																		<ErrorIcon width="16" height="16" />
																	</Show>
																}
															>
																<KillIcon width="14" height="14" />
															</Show>
														</span>
													}
												>
													<span class={styles["btn-spinner"]} />
												</Show>
												<span class={styles["details-play-button-label"]}>
													{playButtonText()}
												</span>
											</Button>
										</div>
									</div>
								</header>

								<div class={styles["instance-tab-content"]}>
									<TabsContent value="home">
										<Show when={instanceTabLoader.visitedTabs().has("home")}>
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
													isRunning={isRunningGlobal()}
												/>
											</Show>
										</Show>
									</TabsContent>

									<TabsContent value="console">
										<Show when={instanceTabLoader.visitedTabs().has("console")}>
											<Show when={instance.loading && !instance.latest}>
												<Skeleton class={styles["skeleton-console"]} />
											</Show>
											<Show when={instance.latest}>
												<Suspense
													fallback={<InstanceTabLoading label="console" />}
												>
													<ConsoleTab
														instanceSlug={slug()}
														openLogsFolder={openLogsFolder}
													/>
												</Suspense>
											</Show>
										</Show>
									</TabsContent>

									<TabsContent value="resources">
										<Show
											when={
												instanceTabLoader.visitedTabs().has("resources") &&
												instance.latest
											}
										>
											<Suspense
												fallback={<InstanceTabLoading label="resources" />}
											>
												<ResourcesTab
													instance={inst()}
													resourceTypeFilter={resourceTypeFilter()}
													resourceSearch={resourceSearch()}
													setResourceSearch={setResourceSearch}
													setResourceTypeFilter={setResourceTypeFilter}
													table={table}
													resourcesStore={resources}
													installedResources={installedResources}
													modpackResources={modpackOwnedResources()}
													modpackIcon={() =>
														modpackIconBase64() || inst().modpackIconUrl || null
													}
													modpackExpanded={modpackResourcesExpanded()}
													setModpackExpanded={setModpackResourcesExpanded}
													currentModpackVersion={currentModpackVersion()}
													availableModpackUpdate={availableModpackUpdate()}
													router={activeRouter()}
													handleBatchUpdate={handleBatchUpdate}
													handleBatchDelete={handleBatchDelete}
													onManageModpackVersions={() =>
														handleTabChange("versioning")
													}
													onUnlinkModpack={handleUnlink}
													onDeleteModpackAndUnlink={
														handleDeleteModpackFilesAndUnlink
													}
													onRowClick={handleRowClick}
													selectedToUpdateCount={selectedToUpdateCount()}
													busy={busy()}
													checkingUpdates={checkingUpdates()}
													checkUpdates={() => void checkUpdates(true)}
													onCompactChange={setIsCompactTable}
												/>
											</Suspense>
										</Show>
									</TabsContent>

									<TabsContent value="crash">
										<Show
											when={
												instanceTabLoader.visitedTabs().has("crash") &&
												instance.latest
											}
										>
											<Suspense
												fallback={<InstanceTabLoading label="crash report" />}
											>
												<CrashTab
													instanceSlug={slug()}
													instanceId={inst().id}
													gameVersion={inst().minecraftVersion}
													loader={inst().modloader ?? undefined}
													crash={currentCrash()}
													installedResources={
														installedResources.latest ||
														installedResources() ||
														[]
													}
													projectRecords={
														projectRecords.latest || projectRecords()
													}
													router={activeRouter()}
													onCleared={() => void handleRefetch()}
												/>
											</Suspense>
										</Show>
									</TabsContent>

									<TabsContent value="screenshots">
										<Show
											when={
												instanceTabLoader.visitedTabs().has("screenshots") &&
												instance.latest
											}
										>
											<Suspense
												fallback={<InstanceTabLoading label="screenshots" />}
											>
												<ScreenshotsTab instanceIdSlug={slug()} />
											</Suspense>
										</Show>
									</TabsContent>

									<TabsContent value="versioning">
										<Show
											when={
												instanceTabLoader.visitedTabs().has("versioning") &&
												instance.latest
											}
										>
											<Suspense
												fallback={<InstanceTabLoading label="version tools" />}
											>
												<VersioningTab
													instance={inst()}
													modpackIcon={() =>
														modpackIconBase64() || inst().modpackIconUrl || null
													}
													isGuest={isGuest()}
													busy={busy()}
													isInstalling={isInstalling()}
													checkingUpdates={checkingUpdates()}
													checkUpdates={() => void checkUpdates(true)}
													modpackVersions={modpackVersions}
													availableModpackUpdate={availableModpackUpdate()}
													handleModpackVersionSelect={
														handleModpackVersionSelect
													}
													rolloutModpackUpdate={rolloutModpackUpdate}
													handleUnlink={handleUnlink}
													handleDeleteModpackAndUnlink={
														handleDeleteModpackFilesAndUnlink
													}
													router={activeRouter()}
													searchableMcVersions={searchableMcVersions}
													includeSnapshots={includeSnapshots}
													setIncludeSnapshots={setIncludeSnapshots}
													selectedMcVersion={selectedMcVersion}
													setSelectedMcVersion={setSelectedMcVersion}
													selectedLoader={selectedLoader}
													setSelectedLoader={setSelectedLoader}
													selectedLoaderVersion={selectedLoaderVersion}
													setSelectedLoaderVersion={setSelectedLoaderVersion}
													loadersList={loadersList()}
													currentVersionSupportedLoaders={
														currentVersionSupportedLoaders
													}
													searchableLoaderVersions={searchableLoaderVersions}
													handleStandardUpdate={handleStandardUpdate}
													setShowExportDialog={setShowExportDialog}
													handleDuplicate={async () => {
														const n = await dialogStore.prompt(
															"Duplicate Instance",
															"Enter name for the copy:",
															{
																defaultValue: `${inst().name} (Copy)`,
															},
														);
														if (n) duplicateInstance(inst().id, n);
													}}
													handleHardReset={() => handleHardReset(inst())}
													handleUninstall={() =>
														handleUninstall(inst(), () =>
															activeRouter()?.navigate("/"),
														)
													}
													repairInstance={repairInstance}
													mcVersions={mcVersions}
												/>
											</Suspense>
										</Show>
									</TabsContent>

									<TabsContent value="settings">
										<Show
											when={instanceTabLoader.visitedTabs().has("settings")}
										>
											<Show when={instance.loading && !instance.latest}>
												<div class={styles["skeleton-settings"]}>
													<Skeleton class={styles["skeleton-field"]} />
													<Skeleton class={styles["skeleton-field"]} />
												</div>
											</Show>
											<Show when={instance.latest}>
												<Suspense
													fallback={
														<InstanceTabLoading label="instance settings" />
													}
												>
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
														useGlobalResolution={useGlobalResolution()}
														setUseGlobalResolution={setUseGlobalResolution}
														gameWidth={gameWidth()}
														setGameWidth={setGameWidth}
														gameHeight={gameHeight()}
														setGameHeight={setGameHeight}
														setIsResolutionDirty={setIsResolutionDirty}
														useGlobalJavaArgs={useGlobalJavaArgs()}
														setUseGlobalJavaArgs={setUseGlobalJavaArgs}
														useGlobalJavaPath={useGlobalJavaPath()}
														setUseGlobalJavaPath={setUseGlobalJavaPath}
														preLaunchHook={preLaunchHook()}
														setPreLaunchHook={setPreLaunchHook}
														postExitHook={postExitHook()}
														setPostExitHook={setPostExitHook}
														wrapperCommand={wrapperCommand()}
														setWrapperCommand={setWrapperCommand}
														useGlobalHooks={useGlobalHooks()}
														setUseGlobalHooks={setUseGlobalHooks}
														setIsHooksDirty={setIsHooksDirty}
														environmentVariables={environmentVariables()}
														setEnvironmentVariables={setEnvironmentVariables}
														useGlobalEnvironmentVariables={useGlobalEnvironmentVariables()}
														setUseGlobalEnvironmentVariables={
															setUseGlobalEnvironmentVariables
														}
														setIsEnvDirty={setIsEnvDirty}
														useGlobalLauncherAction={useGlobalLauncherAction()}
														setUseGlobalLauncherAction={
															setUseGlobalLauncherAction
														}
														launcherActionOnLaunch={launcherActionOnLaunch()}
														setLauncherActionOnLaunch={
															setLauncherActionOnLaunch
														}
														setIsLaunchActionDirty={setIsLaunchActionDirty}
														invoke={invoke}
														showToast={showToast}
													/>
												</Suspense>
											</Show>
										</Show>
									</TabsContent>
								</div>
							</>
						)}
					</Show>
				</div>
			</PageSidebar>

			<FloatingSaveFooter
				show={isDirty()}
				onSave={handleSave}
				isSaving={saving()}
				onCancel={() => {
					const i = inst();
					if (!i) return;
					batch(() => {
						setName(i.name);
						setIconPath(
							i.iconPath ||
								getStableIconId(DEFAULT_ICONS[0]) ||
								DEFAULT_ICONS[0],
						);
						setMinMemory([i.minMemory]);
						setMaxMemory([i.maxMemory]);
						setJavaArgs(i.javaArgs || "");
						setUseGlobalJavaArgs(i.useGlobalJavaArgs);
						setJavaPath(i.javaPath || "");
						setUseGlobalJavaPath(i.useGlobalJavaPath);
						setGameWidth(i.gameWidth);
						setGameHeight(i.gameHeight);
						setUseGlobalResolution(i.useGlobalResolution);
						setPreLaunchHook(i.preLaunchHook || "");
						setPostExitHook(i.postExitHook || "");
						setWrapperCommand(i.wrapperCommand || "");
						setUseGlobalHooks(i.useGlobalHooks);
						setEnvironmentVariables(i.environmentVariables || "");
						setUseGlobalEnvironmentVariables(i.useGlobalEnvironmentVariables);
						setUseGlobalLauncherAction(i.useGlobalLauncherAction);
						setLauncherActionOnLaunch(i.launcherActionOnLaunch || "stay-open");
						setIsNameDirty(false);
						setIsIconDirty(false);
						setIsMinMemDirty(false);
						setIsMaxMemDirty(false);
						setIsJvmDirty(false);
						setIsJavaPathDirty(false);
						setIsResolutionDirty(false);
						setIsHooksDirty(false);
						setIsEnvDirty(false);
						setIsLaunchActionDirty(false);
					});
				}}
				cancelText="Reset"
				saveText={saving() ? "Saving..." : "Save Changes"}
			/>

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
