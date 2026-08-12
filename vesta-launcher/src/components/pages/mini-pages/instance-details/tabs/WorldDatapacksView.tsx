import BackIcon from "@assets/back-arrow.svg";
import DownloadIcon from "@assets/download-compact.svg";
import FolderIcon from "@assets/folder.svg";
import PlusIcon from "@assets/plus.svg";
import ReloadIcon from "@assets/reload.svg";
import TrashIcon from "@assets/trash.svg";
import { WorldIcon } from "@components/worlds/WorldIcon";
import { dialogStore } from "@stores/dialog-store";
import type {
	ResourceProjectOverviewRecord,
	ResourceProjectRef,
} from "@stores/instance-resource-overview";
import { resources, type SourcePlatform } from "@stores/resources";
import {
	checkWorldDatapackUpdates,
	deleteWorldDatapack,
	listWorldDatapacks,
	openWorldDatapacksFolder,
	toggleWorldDatapack,
	type WorldDatapackSummary,
	type WorldDatapackUpdateStatus,
	type WorldSummary,
	worldDatapacksState,
	worldRefKey,
} from "@stores/worlds";
import { invoke } from "@tauri-apps/api/core";
import { ResourceAvatar } from "@ui/avatar";
import { Badge } from "@ui/badge/badge";
import Button from "@ui/button/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ui/dropdown-menu/dropdown-menu";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { showToast } from "@ui/toast/toast";
import { formatDate } from "@utils/date";
import { formatBytes } from "@utils/format-bytes";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import styles from "./WorldDatapacksView.module.css";

const MoreIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<circle cx="12" cy="5" r="1.5" />
		<circle cx="12" cy="12" r="1.5" />
		<circle cx="12" cy="19" r="1.5" />
	</svg>
);

const PackIcon: Component = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="m12 3 9 5-9 5-9-5 9-5Z" />
		<path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
	</svg>
);

const providerName = (platform: string | null) => {
	if (!platform || platform === "manual" || platform === "local")
		return "Local";
	if (platform.toLowerCase() === "modrinth") return "Modrinth";
	if (platform.toLowerCase() === "curseforge") return "CurseForge";
	return platform;
};

const displayVersion = (entry: WorldDatapackSummary) =>
	entry.versionNumber || (entry.managed ? "Managed" : "Local pack");

const projectKey = (platform: string | null, projectId: string | null) =>
	platform && projectId ? `${platform.toLowerCase()}:${projectId}` : null;

type ProviderProjectRef = {
	platform: string;
	id: string;
};

const DatapackRow: Component<{
	entry: WorldDatapackSummary;
	world: WorldSummary;
	busy: boolean;
	onBusyChange: (busy: boolean) => void;
	update?: WorldDatapackUpdateStatus;
	icon?: string | null;
	onOpenDetails: () => void;
}> = (props) => {
	const canManage = () =>
		!props.entry.readOnly && props.entry.resourceId != null;
	const canOpenDetails = () =>
		Boolean(props.entry.platform && props.entry.projectId);

	const handleToggle = async (enabled: boolean) => {
		if (!canManage() || props.busy) return;
		props.onBusyChange(true);
		try {
			await toggleWorldDatapack(
				props.world.ref,
				props.entry.resourceId!,
				enabled,
			);
		} catch (error) {
			showToast({
				title: `Could not ${enabled ? "enable" : "disable"} datapack`,
				description: String(error),
				severity: "error",
			});
		} finally {
			props.onBusyChange(false);
		}
	};

	const handleDelete = async () => {
		if (!canManage() || props.busy) return;
		const confirmed = await dialogStore.confirm(
			`Remove ${props.entry.displayName}?`,
			`This removes the datapack from ${props.world.displayName}. A linked resource pack is removed only when no other world still references it.`,
			{
				okLabel: "Remove datapack",
				severity: "warning",
			},
		);
		if (!confirmed) return;

		props.onBusyChange(true);
		try {
			const removal = await deleteWorldDatapack(
				props.world.ref,
				props.entry.resourceId!,
			);
			const companionDescription =
				removal.removedCompanionCount > 0
					? " Its linked resource pack was also removed."
					: removal.retainedCompanionCount > 0
						? " Its linked resource pack was retained because Vesta could not prove it was unused."
						: "";
			const cleanupDescription = removal.cleanupWarning
				? ` ${removal.cleanupWarning}`
				: "";
			showToast({
				title: "Datapack removed",
				description: `${props.entry.displayName} was removed from ${props.world.displayName}.${companionDescription}${cleanupDescription}`,
				severity: removal.cleanupWarning ? "warning" : "success",
			});
		} catch (error) {
			showToast({
				title: "Could not remove datapack",
				description: String(error),
				severity: "error",
			});
		} finally {
			props.onBusyChange(false);
		}
	};

	const handleUpdate = async () => {
		const version = props.update?.exactVersion;
		if (
			!version ||
			props.entry.resourceId == null ||
			!props.entry.projectId ||
			!props.entry.platform ||
			props.busy
		)
			return;
		if (!["modrinth", "curseforge"].includes(props.entry.platform)) {
			props.onOpenDetails();
			return;
		}

		props.onBusyChange(true);
		try {
			const project = await resources.getProject(
				props.entry.platform as SourcePlatform,
				props.entry.projectId,
			);
			await resources.install(
				project,
				version,
				{ kind: "world", world: props.world.ref },
				{
					installType: "datapack",
					compatibilityAcknowledged: false,
					replacementResourceId: props.entry.resourceId,
				},
			);
			showToast({
				title: "Datapack update started",
				description: `${props.entry.displayName} will update to ${version.version_number}.`,
				severity: "success",
			});
		} catch (error) {
			showToast({
				title: "Could not update datapack",
				description: String(error),
				severity: "error",
			});
		} finally {
			props.onBusyChange(false);
		}
	};

	return (
		<article
			class={styles.pack}
			data-read-only={props.entry.readOnly || undefined}
			data-interactive={canOpenDetails() || undefined}
		>
			<Show when={canOpenDetails()}>
				<button
					type="button"
					class={styles["pack-details-target"]}
					aria-label={`View details for ${props.entry.displayName}`}
					onClick={props.onOpenDetails}
				/>
			</Show>
			<ResourceAvatar
				name={props.entry.displayName}
				icon={props.icon}
				size={44}
				shape="square"
				class={styles["pack-avatar"]}
			/>
			<div class={styles["pack-copy"]}>
				<div class={styles["pack-title-row"]}>
					<h3 title={props.entry.displayName}>{props.entry.displayName}</h3>
					<Show when={props.entry.entryKind === "directory"}>
						<Badge variant="secondary">Folder pack</Badge>
					</Show>
				</div>
				<div class={styles["pack-meta"]}>
					<span>{displayVersion(props.entry)}</span>
					<span aria-hidden="true">·</span>
					<span>{providerName(props.entry.platform)}</span>
					<span aria-hidden="true">·</span>
					<span>{formatBytes(props.entry.sizeBytes)}</span>
					<Show when={props.entry.modifiedAt}>
						<span aria-hidden="true">·</span>
						<span>{formatDate(props.entry.modifiedAt)}</span>
					</Show>
				</div>
				<Show when={props.entry.fileName !== props.entry.displayName}>
					<div class={styles.filename} title={props.entry.fileName}>
						{props.entry.fileName}
					</div>
				</Show>
			</div>

			<div class={styles["pack-controls"]}>
				<Show when={props.update?.exactVersion}>
					<Button
						size="sm"
						variant="outline"
						disabled={props.busy}
						class={styles["update-button"]}
						onClick={() => void handleUpdate()}
					>
						<DownloadIcon />
						Update
					</Button>
				</Show>
				<Show
					when={canManage()}
					fallback={
						<span
							class={styles["read-only"]}
							title="Folder packs are read-only in Vesta"
						>
							Read only
						</span>
					}
				>
					<Switch
						checked={props.entry.enabled}
						disabled={props.busy}
						onCheckedChange={(enabled: boolean) => void handleToggle(enabled)}
						aria-label={`${props.entry.enabled ? "Disable" : "Enable"} ${props.entry.displayName}`}
					>
						<SwitchControl>
							<SwitchThumb />
						</SwitchControl>
					</Switch>
				</Show>

				<DropdownMenu>
					<DropdownMenuTrigger
						as="button"
						type="button"
						class={styles["menu-trigger"]}
						aria-label={`Actions for ${props.entry.displayName}`}
					>
						<MoreIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						<DropdownMenuItem
							onSelect={() => void openWorldDatapacksFolder(props.world.ref)}
						>
							<FolderIcon class={styles["menu-icon"]} />
							Show in folder
						</DropdownMenuItem>
						<Show when={canManage()}>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={props.busy}
								class={styles["delete-action"]}
								onSelect={() => void handleDelete()}
							>
								<TrashIcon class={styles["menu-icon"]} />
								Remove from world
							</DropdownMenuItem>
						</Show>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</article>
	);
};

export const WorldDatapacksView: Component<{
	world: WorldSummary;
	onBack: () => void;
	onAddDatapack: (world: WorldSummary) => void;
	onOpenDatapackDetails: (
		world: WorldSummary,
		entry: WorldDatapackSummary,
	) => void;
}> = (props) => {
	const key = createMemo(() => worldRefKey(props.world.ref));
	const [busyResourceIds, setBusyResourceIds] = createSignal<ReadonlySet<number>>(
		new Set(),
	);
	const [projectIcons, setProjectIcons] = createSignal<Record<string, string>>(
		{},
	);
	const overview = createMemo(() => worldDatapacksState.byWorld[key()]);
	const updates = createMemo(() => worldDatapacksState.updatesByWorld[key()]);
	const projectRefs = createMemo<ProviderProjectRef[]>(() => {
		const refs = new Map<string, ProviderProjectRef>();
		for (const entry of overview()?.entries ?? []) {
			const key = projectKey(entry.platform, entry.projectId);
			if (key && entry.platform && entry.projectId) {
				refs.set(key, {
					platform: entry.platform.toLowerCase(),
					id: entry.projectId,
				});
			}
		}
		return [...refs.values()];
	});
	let iconRequestGeneration = 0;

	createEffect(
		on(key, () => {
			const world = props.world.ref;
			void listWorldDatapacks(world).catch(() => undefined);
			void checkWorldDatapackUpdates(world).catch(() => undefined);
		}),
	);

	createEffect(() => {
		const worldKey = key();
		const refs = projectRefs();
		const generation = ++iconRequestGeneration;
		onCleanup(() => {
			if (iconRequestGeneration === generation) iconRequestGeneration += 1;
		});
		setProjectIcons({});
		if (refs.length === 0) return;

		const publish = (records: ResourceProjectOverviewRecord[]) => {
			if (generation !== iconRequestGeneration || key() !== worldKey) return;
			setProjectIcons((current) => {
				const next = { ...current };
				for (const record of records) {
					if (record.icon_url) {
						next[`${record.source.toLowerCase()}:${record.id}`] =
							record.icon_url;
					}
				}
				return next;
			});
		};

		void (async () => {
			try {
				const cached = await invoke<ResourceProjectOverviewRecord[]>(
					"get_cached_resource_projects_by_provider",
					{ refs, hydrateIcons: false },
				);
				publish(cached);

				const supportedRefs = refs.filter(
					(ref): ref is ResourceProjectRef =>
						ref.platform === "modrinth" || ref.platform === "curseforge",
				);
				if (supportedRefs.length > 0) {
					const metadata = await invoke<ResourceProjectOverviewRecord[]>(
						"get_or_hydrate_resource_projects",
						{
							refs: supportedRefs,
							allowNetwork: true,
							refreshStale: false,
						},
					);
					publish(metadata);
					const icons = await invoke<ResourceProjectOverviewRecord[]>(
						"hydrate_resource_project_icons",
						{ refs: supportedRefs },
					);
					publish(icons);
				}

				const cachedProviderRefs = refs.filter(
					(ref) => ref.platform !== "modrinth" && ref.platform !== "curseforge",
				);
				if (cachedProviderRefs.length > 0) {
					const icons = await invoke<ResourceProjectOverviewRecord[]>(
						"get_cached_resource_projects_by_provider",
						{ refs: cachedProviderRefs, hydrateIcons: true },
					);
					publish(icons);
				}
			} catch (error) {
				console.warn("Failed to load world datapack icons:", error);
			}
		})();
	});

	const refresh = () =>
		Promise.all([
			listWorldDatapacks(props.world.ref, true),
			checkWorldDatapackUpdates(props.world.ref, true),
		]).catch(() => undefined);
	const setResourceBusy = (resourceId: number | null, busy: boolean) => {
		if (resourceId == null) return;
		setBusyResourceIds((current) => {
			const next = new Set(current);
			if (busy) next.add(resourceId);
			else next.delete(resourceId);
			return next;
		});
	};

	return (
		<section
			class={styles.root}
			aria-label={`Datapacks in ${props.world.displayName}`}
		>
			<header class={styles["context-rail"]}>
				<Button
					size="sm"
					variant="ghost"
					icon_only
					class={styles.back}
					aria-label="Back to worlds"
					tooltip_text="Back to worlds"
					onClick={props.onBack}
				>
					<BackIcon />
				</Button>
				<WorldIcon
					class={styles["context-icon"]}
					src={props.world.iconDataUrl}
					name={props.world.displayName}
				/>
				<div class={styles["context-copy"]}>
					<h2>{props.world.displayName}</h2>
					<div class={styles["world-meta"]}>
						<span title="World folder">{props.world.folderName}</span>
						<span aria-hidden="true">·</span>
						<span title="World size">{formatBytes(props.world.sizeBytes)}</span>
						<Show when={props.world.lastPlayedAt}>
							<span aria-hidden="true">·</span>
							<span title="Last played">
								{formatDate(props.world.lastPlayedAt)}
							</span>
						</Show>
					</div>
				</div>
				<div class={styles.actions}>
					<Button
						size="sm"
						variant="ghost"
						icon_only
						tooltip_text="Open datapacks folder"
						aria-label="Open datapacks folder"
						onClick={() => void openWorldDatapacksFolder(props.world.ref)}
					>
						<FolderIcon />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						icon_only
						tooltip_text="Refresh datapacks"
						aria-label="Refresh datapacks"
						disabled={
							worldDatapacksState.loading[key()] ||
							worldDatapacksState.updatesLoading[key()]
						}
						onClick={() => void refresh()}
					>
						<ReloadIcon />
					</Button>
					<Button
						size="sm"
						color="primary"
						onClick={() => props.onAddDatapack(props.world)}
					>
						<PlusIcon />
						Add datapack
					</Button>
				</div>
			</header>

			<Show
				when={!worldDatapacksState.loading[key()] || overview()}
				fallback={<div class={styles.state}>Loading datapacks…</div>}
			>
				<Show
					when={!worldDatapacksState.errors[key()]}
					fallback={
						<div class={`${styles.state} ${styles.error}`}>
							<div>Datapacks could not be loaded.</div>
							<span>{worldDatapacksState.errors[key()]}</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void listWorldDatapacks(props.world.ref, true)}
							>
								Try again
							</Button>
						</div>
					}
				>
					<Show
						when={(overview()?.entries.length ?? 0) > 0}
						fallback={
							<div class={styles.state}>
								<div class={styles["empty-icon"]}>
									<PackIcon />
								</div>
								<h3>No datapacks yet</h3>
								<p>Add one from Modrinth, CurseForge, or another source.</p>
								<Button
									size="sm"
									color="primary"
									onClick={() => props.onAddDatapack(props.world)}
								>
									<PlusIcon />
									Browse datapacks
								</Button>
							</div>
						}
					>
						<div class={styles.packs}>
							<For each={overview()?.entries ?? []}>
								{(entry) => (
									<DatapackRow
										entry={entry}
										world={props.world}
										busy={
											entry.resourceId != null &&
											busyResourceIds().has(entry.resourceId)
										}
										icon={
											projectIcons()[
												projectKey(entry.platform, entry.projectId) ?? ""
											]
										}
										update={updates()?.updates.find(
											(update) => update.resourceId === entry.resourceId,
										)}
										onBusyChange={(busy) =>
											setResourceBusy(entry.resourceId, busy)
										}
										onOpenDetails={() =>
											props.onOpenDatapackDetails(props.world, entry)
										}
									/>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</Show>
		</section>
	);
};
