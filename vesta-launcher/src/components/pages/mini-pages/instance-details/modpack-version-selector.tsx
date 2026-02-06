import { Badge } from "@ui/badge";
import Button from "@ui/button/button";
import { Skeleton } from "@ui/skeleton/skeleton";
import { Show, createSignal, createMemo, For, createEffect } from "solid-js";
import clsx from "clsx";
import styles from "./modpack-version-selector.module.css";

export interface ModpackVersion {
	id: string;
	version_number: string;
	release_type: string;
	game_versions: string[];
	loaders: string[];
}

interface ModpackVersionSelectorProps {
	versions: ModpackVersion[] | undefined;
	loading: boolean;
	currentVersionId: string | null;
	onVersionSelect: (versionId: string, version?: ModpackVersion) => void;
	onUpdate: () => void;
	disabled?: boolean;
}

export function ModpackVersionSelector(props: ModpackVersionSelectorProps) {
	const [selectedId, setSelectedId] = createSignal<string | null>(props.currentVersionId);
	const [searchQuery, setSearchQuery] = createSignal("");
	const [isOpen, setIsOpen] = createSignal(false);
	const [confirmingId, setConfirmingId] = createSignal<string | null>(null);

	let activeRowRef: HTMLDivElement | undefined;

	// Track prop changes
	createEffect(() => {
		setSelectedId(props.currentVersionId);
	});

	// Scroll active row into view when popover opens
	createEffect(() => {
		if (isOpen() && activeRowRef) {
			setTimeout(() => {
				activeRowRef?.scrollIntoView({ block: "center", behavior: "smooth" });
			}, 50);
		}
	});

	// Transform and Filter versions
	const filteredVersions = createMemo(() => {
		if (!props.versions) return [];

		const query = searchQuery().toLowerCase().trim();
		const options = props.versions.map((version) => ({
			...version,
			searchString: `${version.version_number} ${version.game_versions.join(" ")} ${version.loaders.join(" ")}`.toLowerCase(),
		}));

		if (!query) return options;
		return options.filter(v => v.searchString.includes(query));
	});

	// Get selected version metadata
	const selectedVersion = createMemo(() => {
		const id = selectedId();
		if (!id || !props.versions) return null;
		return props.versions.find(v => String(v.id) === id) || null;
	});

	const handleAction = (version: ModpackVersion) => {
		if (props.disabled) return;
		if (confirmingId() === version.id) {
			// Second click: Confirm
			props.onVersionSelect(version.id, version);
			props.onUpdate();
			setConfirmingId(null);
			setIsOpen(false);
		} else {
			// First click: Ask to confirm
			setConfirmingId(version.id);
		}
	};

	const needsUpdate = createMemo(() => {
		return selectedId() !== props.currentVersionId && selectedId() !== null;
	});

	return (
		<div>
			<div class={clsx("flex items-center justify-between px-1", styles.header)}>
				<div class="flex flex-col gap-0.5">
					<span class="text-sm font-bold text-foreground/90 tracking-tight">
						Modpack Version
					</span>
					<span class="text-[11px] text-muted-foreground font-medium">
						Manage installed builds and engine settings.
					</span>
				</div>
			</div>

			<Show when={!props.loading} fallback={<Skeleton class="h-20 w-full rounded-2xl" />}>
				<div 
					onClick={() => { if (!props.disabled) setIsOpen(!isOpen()); }}
					class={clsx(styles.triggerCard, props.disabled && styles.disabled)}
					data-expanded={isOpen()}
				>
					<div class="flex items-center flex-1 min-w-0">
						<div class={styles.triggerIcon}>
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
								<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
								<line x1="12" y1="22.08" x2="12" y2="12"/>
							</svg>
						</div>
						<div class={styles.triggerContent}>
							<div class={styles.triggerTitle}>
								{selectedVersion()?.version_number || "Select Version"}
							</div>
							<div class={styles.triggerMeta}>
								<span class="flex items-center gap-1.5">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
										<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/>
									</svg>
									{selectedVersion()?.game_versions[0]}
								</span>
								<span class="flex items-center gap-1.5">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
										<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
									</svg>
									{selectedVersion()?.loaders[0]}
								</span>
							</div>
						</div>
					</div>
					<div class="flex items-center gap-3">
						<Show when={needsUpdate()}>
							<Badge variant="accent" class="animate-pulse">Update Pending</Badge>
						</Show>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class={styles.chevron}>
							<path d="m6 9 6 6 6-6"/>
						</svg>
					</div>
				</div>

				<Show when={isOpen()}>
					<div 
						class={clsx(styles.selectionContainer, "liquid-glass")}
						onClick={(e) => e.stopPropagation()}
					>
						<div class={styles.searchBarContainer}>
							<div class={styles.searchBar}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
									<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
								</svg>
								<input 
									type="text" 
									placeholder="Search versions..." 
									onInput={(e) => setSearchQuery(e.currentTarget.value)}
									value={searchQuery()}
									autofocus
								/>
							</div>
						</div>

						<div class={styles.versionListContainer} style={{ "max-height": "400px" }}>
							<For each={filteredVersions()}>
								{(version) => {
									const isCurrent = String(version.id) === props.currentVersionId;
									const isConfirming = () => confirmingId() === version.id;

									return (
										<div 
											ref={(el) => { if (isCurrent) activeRowRef = el; }}
											onMouseLeave={() => { if (confirmingId() === version.id) setConfirmingId(null); }}
											class={clsx(
												styles.versionRow,
												isCurrent && styles.activeRow,
												isConfirming() && styles.isConfirming
											)}
										>
											<div class={styles.versionInfo}>
												<div class={styles.versionIcon}>
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
														<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
													</svg>
												</div>
												<div class={styles.metaContainer}>
													<div class={styles.versionHeader}>
														<span class={styles.versionNumber}>{version.version_number}</span>
														<Badge 
															variant={version.release_type === 'release' ? 'secondary' : 'outline'} 
															class="h-4 px-1.5 text-[9px] font-bold uppercase"
														>
															{version.release_type}
														</Badge>
													</div>
													<div class={styles.versionSub}>
														<span>MC {version.game_versions[0]}</span>
														<span>•</span>
														<span>{version.loaders[0]}</span>
													</div>
												</div>
											</div>

											<div class={styles.actionArea}>
												<Show when={isCurrent} fallback={
													<Button
														size="sm"
														color={isConfirming() ? "warning" : "none"}
														variant={isConfirming() ? "solid" : "outline"}
														class={styles.switchButton}
														disabled={props.disabled}
														onClick={(e) => {
															e.stopPropagation();
															handleAction(version);
														}}
													>
														<div class={styles.confirmSlide}>
															<div class={styles.slideInner}>
																<span class={styles.slideText}>Switch</span>
																<span class={styles.slideText}>Confirm?</span>
															</div>
														</div>
													</Button>
												}>
													<div class={styles.installedLabel}>
														Installed
													</div>
												</Show>
											</div>
										</div>
									);
								}}
							</For>
						</div>
					</div>
				</Show>
			</Show>
		</div>
	);
}
