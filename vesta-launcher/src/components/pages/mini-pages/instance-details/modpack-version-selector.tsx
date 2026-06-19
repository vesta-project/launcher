import RightArrowIcon from "@assets/right-arrow.svg";
import SearchIcon from "@assets/search.svg";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { Skeleton } from "@ui/skeleton/skeleton";
import clsx from "clsx";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import styles from "./modpack-version-selector.module.css";

export interface ModpackVersion {
	id: string;
	version_number: string;
	release_type: string;
	game_versions: string[];
	loaders: string[];
}

interface ModpackVersionSelectorProps {
	projectName: string;
	projectIcon?: string | null;
	platform?: string | null;
	minecraftVersion?: string | null;
	loader?: string | null;
	versions: ModpackVersion[] | undefined;
	loading: boolean;
	currentVersionId: string | null;
	availableUpdate?: ModpackVersion | null;
	onVersionSelect: (versionId: string, version?: ModpackVersion) => void;
	onUpdate: () => void;
	onOpenProject: () => void;
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
			searchString:
				`${version.version_number} ${version.game_versions.join(" ")} ${version.loaders.join(" ")}`.toLowerCase(),
		}));

		if (!query) return options;
		return options.filter((v) => v.searchString.includes(query));
	});

	// Get selected version metadata
	const selectedVersion = createMemo(() => {
		const id = selectedId();
		if (!id || !props.versions) return null;
		return props.versions.find((v) => String(v.id) === id) || null;
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

	const platformLabel = createMemo(() => {
		if (props.platform === "modrinth") return "Modrinth";
		if (props.platform === "curseforge") return "CurseForge";
		return "Linked";
	});

	return (
		<div class={styles["control"]}>
			<Show when={!props.loading} fallback={<Skeleton class={styles["triggerSkeleton"]} />}>
				<div
					class={clsx(styles["triggerCard"], props.disabled && styles["disabled"])}
					data-expanded={isOpen()}
				>
					<div class={styles["triggerMain"]}>
						<button
							type="button"
							class={styles["projectButton"]}
							onClick={(event) => {
								event.stopPropagation();
								props.onOpenProject();
							}}
							disabled={props.disabled}
						>
							<ResourceAvatar
								icon={props.projectIcon || null}
								name={props.projectName}
								class={styles["triggerIcon"]}
							/>
							<div class={styles["triggerContent"]}>
								<div class={styles["projectLine"]}>
									<span class={styles["projectName"]}>{props.projectName}</span>
									<span class={styles["platformLabel"]}>{platformLabel()}</span>
								</div>
							</div>
						</button>
						<button
							type="button"
							class={styles["versionButton"]}
							onClick={() => {
								if (!props.disabled) setIsOpen(!isOpen());
							}}
							aria-expanded={isOpen()}
							disabled={props.disabled}
						>
							<div class={styles["versionSummary"]}>
								<span class={styles["versionSummaryPrimary"]}>
									{selectedVersion()?.version_number || props.currentVersionId || "Current"}
								</span>
								<div class={styles["triggerMeta"]}>
									<span>MC {selectedVersion()?.game_versions[0] || props.minecraftVersion || "unknown"}</span>
									<span>{selectedVersion()?.loaders[0] || props.loader || "Vanilla"}</span>
								</div>
							</div>
							<div class={styles["statusArea"]}>
								<Show when={props.availableUpdate}>
									<span class={styles["updateSignal"]}>
										Update {props.availableUpdate?.version_number}
									</span>
								</Show>
								<span class={styles["chevronWell"]}>
									<RightArrowIcon class={styles["chevron"]} />
								</span>
							</div>
						</button>
					</div>
				</div>

				<Show when={isOpen()}>
					<div
						class={styles["selectionContainer"]}
						onClick={(e) => e.stopPropagation()}
					>
						<div class={styles["searchBarContainer"]}>
							<div class={styles["searchBar"]}>
								<SearchIcon class={styles["searchIcon"]} />
								<input
									type="text"
									placeholder="Search versions..."
									onInput={(e) => setSearchQuery(e.currentTarget.value)}
									value={searchQuery()}
									autofocus
								/>
							</div>
						</div>

						<div class={styles["versionListContainer"]}>
							<For each={filteredVersions()}>
								{(version) => {
									const isCurrent = String(version.id) === props.currentVersionId;
									const isConfirming = () => confirmingId() === version.id;

									return (
										<div
											ref={(el) => {
												if (isCurrent) activeRowRef = el;
											}}
											onMouseLeave={() => {
												if (confirmingId() === version.id) setConfirmingId(null);
											}}
											class={clsx(
												styles["versionRow"],
												isCurrent && styles["activeRow"],
												isConfirming() && styles["isConfirming"],
											)}
										>
											<div class={styles["versionInfo"]}>
												<div class={styles["metaContainer"]}>
													<div class={styles["versionHeader"]}>
														<span class={styles["versionNumber"]}>{version.version_number}</span>
														<span class={styles["releaseType"]}>
															{version.release_type}
														</span>
													</div>
													<div class={styles["versionSub"]}>
														<span>MC {version.game_versions[0]}</span>
														<span>•</span>
														<span>{version.loaders[0]}</span>
													</div>
												</div>
											</div>

											<div class={styles["actionArea"]}>
												<Show
													when={isCurrent}
													fallback={
														<Button
															size="sm"
															color={isConfirming() ? "warning" : "none"}
															variant={isConfirming() ? "solid" : "outline"}
															class={styles["switchButton"]}
															disabled={props.disabled}
															onClick={(e) => {
																e.stopPropagation();
																handleAction(version);
															}}
														>
															<div class={styles["confirmSlide"]}>
																<div class={styles["slideInner"]}>
																	<span class={styles["slideText"]}>Switch</span>
																	<span class={styles["slideText"]}>Confirm?</span>
																</div>
															</div>
														</Button>
													}
												>
													<div class={styles["installedLabel"]}>Installed</div>
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
