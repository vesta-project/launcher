import BackArrowIcon from "@assets/back-arrow.svg";
import ClipboardIcon from "@assets/clipboard.svg";
import CubeIcon from "@assets/cube.svg";
import DownloadIcon from "@assets/download-compact.svg";
import FabricIcon from "@assets/fabric-logo.svg";
import FolderIcon from "@assets/folder.svg";
import ForgeIcon from "@assets/forge-logo.svg";
import HistoryIcon from "@assets/history.svg";
import NeoForgeIcon from "@assets/neoforge-logo.svg";
import OpenIcon from "@assets/open.svg";
import QuiltIcon from "@assets/quilt-logo.svg";
import RightArrowIcon from "@assets/right-arrow.svg";
import TrashIcon from "@assets/trash.svg";
import { InlineLoadingRow } from "@components/fetching-overlay/inline-loading-row";
import type {
	ResourceDependency,
	ResourceProject,
	ResourceVersion,
	ResourceVersionDetails,
} from "@stores/resources";
import Button from "@ui/button/button";
import { formatDate } from "@utils/date";
import { formatBytesCompact } from "@utils/format-bytes";
import {
	type Component,
	createMemo,
	createSignal,
	For,
	type JSX,
	Show,
} from "solid-js";
import styles from "./resource-details.module.css";
import {
	minecraftGameVersions,
	renderVersionChangelog,
	summarizeGameVersions,
} from "./resource-version-view";

const loaderIcons: Record<
	string,
	Component<{ width?: number; height?: number }>
> = {
	fabric: FabricIcon,
	forge: ForgeIcon,
	quilt: QuiltIcon,
	neoforge: NeoForgeIcon,
};

export type VersionActionKind = "download" | "external" | "progress" | "remove";

export const VersionActionIcon: Component<{
	kind: VersionActionKind;
	size?: number;
}> = (props) => (
	<Show
		when={props.kind !== "progress"}
		fallback={
			<span
				class={styles["version-action-spinner"]}
				style={{
					width: `${props.size || 14}px`,
					height: `${props.size || 14}px`,
				}}
				aria-hidden="true"
			/>
		}
	>
		<Show
			when={props.kind === "remove"}
			fallback={
				<Show
					when={props.kind === "external"}
					fallback={
						<DownloadIcon width={props.size || 14} height={props.size || 14} />
					}
				>
					<OpenIcon width={props.size || 14} height={props.size || 14} />
				</Show>
			}
		>
			<TrashIcon width={props.size || 14} height={props.size || 14} />
		</Show>
	</Show>
);

export const VersionSummaryRow: Component<{
	version: ResourceVersion;
	compact?: boolean;
	onSelect: (version: ResourceVersion) => void;
	actionLabel: string;
	actionKind: VersionActionKind;
	actionDisabled?: boolean;
	onAction: (version: ResourceVersion) => void;
	onPrefetch?: (version: ResourceVersion) => void;
}> = (props) => {
	return (
		<div
			class={
				styles[props.compact ? "recent-version-row" : "version-summary-row"]
			}
			onPointerEnter={() => props.onPrefetch?.(props.version)}
			onFocusIn={() => props.onPrefetch?.(props.version)}
		>
			<button
				type="button"
				class={styles["version-summary-main"]}
				onClick={() => props.onSelect(props.version)}
				aria-label={`View details for ${props.version.version_number}`}
			>
				<div class={styles["version-summary-identity"]}>
					<div class={styles["version-summary-copy"]}>
						<div class={styles["version-summary-title"]}>
							<strong title={props.version.version_number}>
								{props.version.version_number}
							</strong>
							<small
								class={`${styles["release-label"]} ${styles[`release-label--${props.version.release_type}`]}`}
								title={props.version.release_type}
								aria-label={props.version.release_type}
							>
								{props.compact
									? props.version.release_type.slice(0, 1)
									: props.version.release_type}
							</small>
						</div>
						<Show when={!props.compact}>
							<span title={props.version.file_name}>
								{props.version.file_name}
							</span>
						</Show>
					</div>
				</div>
				<div class={styles["version-summary-environment"]}>
					<span>{summarizeGameVersions(props.version.game_versions)}</span>
					<Show when={!props.compact}>
						<div class={styles["loader-icon-row"]}>
							<For each={props.version.loaders.slice(0, 3)}>
								{(loader) => {
									const Icon = loaderIcons[loader.toLowerCase()];
									return (
										<span class={styles["loader-icon"]} title={loader}>
											<Show
												when={Icon}
												fallback={loader.slice(0, 1).toUpperCase()}
											>
												<Icon width={15} height={15} />
											</Show>
										</span>
									);
								}}
							</For>
						</div>
					</Show>
				</div>
				<Show when={!props.compact}>
					<span class={styles["version-summary-date"]}>
						{props.version.published_at
							? formatDate(props.version.published_at)
							: props.version.release_type}
					</span>
				</Show>
			</button>
			<button
				type="button"
				class={styles["version-summary-action"]}
				classList={{
					[styles["version-summary-action--remove"]]:
						props.actionKind === "remove",
				}}
				disabled={props.actionDisabled}
				onClick={() => props.onAction(props.version)}
				aria-label={`${props.actionLabel} ${props.version.version_number}`}
				title={props.actionLabel}
			>
				<VersionActionIcon kind={props.actionKind} />
			</button>
		</div>
	);
};

export const VersionFocusMainLoading: Component<{
	onBack: () => void;
}> = (props) => (
	<div
		class={`${styles["version-focus-main"]} ${styles["version-focus-loading-shell"]}`}
		aria-busy="true"
		aria-label="Loading version details"
	>
		<button
			type="button"
			class={styles["all-versions-link"]}
			onClick={props.onBack}
		>
			<BackArrowIcon width={15} height={15} />
			<span>All versions</span>
		</button>
		<section class={styles["artifact-card"]} aria-hidden="true">
			<div
				class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--icon"]}`}
			/>
			<div class={styles["focus-skeleton-stack"]}>
				<div
					class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--label"]}`}
				/>
				<div
					class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--file"]}`}
				/>
			</div>
			<div
				class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--stat"]}`}
			/>
			<div
				class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--hash"]}`}
			/>
		</section>
		<section class={styles["changelog-panel"]} aria-hidden="true">
			<div class={styles["focus-skeleton-stack"]}>
				<div
					class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--heading"]}`}
				/>
				<div
					class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--line"]}`}
				/>
				<div
					class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--line-short"]}`}
				/>
			</div>
		</section>
	</div>
);

export const VersionFocusSidebarLoading: Component<{
	sections?: "all" | "install" | "metadata";
}> = (props) => (
	<div
		class={`${styles["version-focus-sidebar"]} ${styles["version-focus-loading-shell"]}`}
		aria-busy="true"
		aria-label="Loading version installation details"
	>
		<Show when={props.sections !== "metadata"}>
			<section class={styles["focus-action-card"]} aria-hidden="true">
				<div class={styles["focus-skeleton-stack"]}>
					<div
						class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--control"]}`}
					/>
					<div
						class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--control"]}`}
					/>
					<div
						class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--button"]}`}
					/>
				</div>
			</section>
		</Show>
		<Show when={props.sections !== "install"}>
			<For each={[0, 1, 2]}>
				{() => (
					<section class={styles["focus-sidebar-section"]} aria-hidden="true">
						<div class={styles["focus-skeleton-stack"]}>
							<div
								class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--sidebar-heading"]}`}
							/>
							<div
								class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--line"]}`}
							/>
							<div
								class={`${styles["focus-skeleton"]} ${styles["focus-skeleton--line-short"]}`}
							/>
						</div>
					</section>
				)}
			</For>
		</Show>
	</div>
);

export const VersionFocusMain: Component<{
	version: ResourceVersion;
	details?: ResourceVersionDetails;
	loading: boolean;
	error?: string;
	onBack: () => void;
	onRetry: () => void;
	onCopyHash: () => void;
	onContentLink: (url: string) => void;
}> = (props) => {
	const renderedChangelog = createMemo(() => {
		const details = props.details;
		return renderVersionChangelog(
			details?.changelog,
			details?.changelog_format || "html",
		);
	});

	return (
		<div class={styles["version-focus-main"]}>
			<button
				type="button"
				class={styles["all-versions-link"]}
				onClick={props.onBack}
			>
				<BackArrowIcon width={15} height={15} />
				<span>All versions</span>
			</button>

			<section class={styles["artifact-card"]} aria-labelledby="artifact-title">
				<div class={styles["artifact-icon"]} aria-hidden="true">
					<FolderIcon width={20} height={20} />
				</div>
				<div class={styles["artifact-name"]}>
					<span id="artifact-title">Release file</span>
					<strong title={props.version.file_name}>
						{props.version.file_name}
					</strong>
				</div>
				<div class={styles["artifact-stat"]}>
					<span>Size</span>
					<strong>
						{formatBytesCompact(props.version.file_size) || "Unknown"}
					</strong>
				</div>
				<button
					type="button"
					class={styles["artifact-hash"]}
					disabled={!props.version.hash}
					onClick={props.onCopyHash}
					aria-label={
						props.version.hash ? "Copy SHA-1 hash" : "SHA-1 hash not provided"
					}
				>
					<span>SHA-1</span>
					<code title={props.version.hash}>
						{props.version.hash || "Not provided"}
					</code>
					<Show when={props.version.hash}>
						<span class={styles["artifact-hash-copy"]} aria-hidden="true">
							<ClipboardIcon width={14} height={14} />
						</span>
					</Show>
				</button>
			</section>

			<section
				class={styles["changelog-panel"]}
				aria-labelledby="changelog-title"
			>
				<div class={styles["focus-section-heading"]}>
					<HistoryIcon width={18} height={18} />
					<div>
						<span>Release notes</span>
						<h2 id="changelog-title">Changelog</h2>
					</div>
				</div>
				<Show
					when={!props.loading}
					fallback={<InlineLoadingRow message="Loading changelog..." />}
				>
					<Show
						when={!props.error}
						fallback={
							<div class={styles["changelog-state"]}>
								<strong>Changelog unavailable</strong>
								<span>{props.error}</span>
								<Button size="sm" variant="outline" onClick={props.onRetry}>
									Retry
								</Button>
							</div>
						}
					>
						<Show
							when={
								props.details?.changelog_status === "available" &&
								renderedChangelog()
							}
							fallback={
								<div class={styles["changelog-state"]}>
									<strong>
										{props.details?.changelog_status === "unavailable"
											? "Release notes could not be loaded"
											: "No changelog provided"}
									</strong>
									<span>
										The remaining version details are still available.
									</span>
									<Show
										when={props.details?.changelog_status === "unavailable"}
									>
										<Button size="sm" variant="outline" onClick={props.onRetry}>
											Retry
										</Button>
									</Show>
								</div>
							}
						>
							<div
								class={`${styles.description} ${styles["version-changelog"]}`}
								innerHTML={renderedChangelog()}
								onClick={(event) => {
									const anchor = (event.target as HTMLElement).closest("a");
									if (!anchor) return;
									event.preventDefault();
									props.onContentLink(anchor.href);
								}}
							/>
						</Show>
					</Show>
				</Show>
			</section>
		</div>
	);
};

const DependencyGroup: Component<{
	title: string;
	tone: string;
	dependencies: ResourceDependency[];
	projects: Map<string, ResourceProject>;
	onOpenProject: (project: ResourceProject) => void;
}> = (props) => (
	<Show when={props.dependencies.length > 0}>
		<section
			class={`${styles["focus-dependency-group"]} ${styles[`focus-dependency-group--${props.tone}`]}`}
		>
			<h4>{props.title}</h4>
			<For each={props.dependencies}>
				{(dependency) => {
					const project = () => props.projects.get(dependency.project_id);
					return (
						<button
							type="button"
							class={styles["focus-dependency-row"]}
							disabled={!project()}
							onClick={() => project() && props.onOpenProject(project()!)}
						>
							<Show
								when={project()?.icon_url}
								fallback={<CubeIcon width={20} height={20} />}
							>
								<img src={project()?.icon_url || ""} alt="" />
							</Show>
							<span>
								<strong>
									{project()?.name ||
										dependency.file_name ||
										dependency.project_id}
								</strong>
								<small>{dependency.file_name || props.title}</small>
							</span>
							<RightArrowIcon width={14} height={14} />
						</button>
					);
				}}
			</For>
		</section>
	</Show>
);

export const VersionFocusSidebar: Component<{
	project: ResourceProject;
	version: ResourceVersion;
	installControls: JSX.Element;
	dependencyProjects: Map<string, ResourceProject>;
	onOpenProject: (project: ResourceProject) => void;
	sections?: "all" | "install" | "metadata";
}> = (props) => {
	const [showAllVersions, setShowAllVersions] = createSignal(false);
	const supportedGameVersions = createMemo(() =>
		minecraftGameVersions(props.version.game_versions),
	);
	const visibleGameVersions = createMemo(() =>
		showAllVersions()
			? supportedGameVersions()
			: supportedGameVersions().slice(0, 6),
	);
	const required = createMemo(() =>
		props.version.dependencies.filter(
			(dependency) => dependency.dependency_type === "required",
		),
	);
	const optional = createMemo(() =>
		props.version.dependencies.filter(
			(dependency) =>
				dependency.dependency_type === "optional" ||
				dependency.dependency_type === "embedded",
		),
	);
	const incompatible = createMemo(() =>
		props.version.dependencies.filter(
			(dependency) => dependency.dependency_type === "incompatible",
		),
	);

	return (
		<div class={styles["version-focus-sidebar"]}>
			<Show when={props.sections !== "metadata"}>
				<section class={styles["focus-action-card"]}>
					{props.installControls}
				</section>
			</Show>

			<Show when={props.sections !== "install"}>
				<section class={styles["focus-sidebar-section"]}>
					<div class={styles["focus-sidebar-heading"]}>
						<CubeIcon width={16} height={16} />
						<h3>Supported environment</h3>
					</div>
					<div class={styles["environment-list"]}>
						<For each={visibleGameVersions()}>
							{(version) => (
								<div>
									<CubeIcon width={14} height={14} />
									<span>{version}</span>
								</div>
							)}
						</For>
					</div>
					<Show when={supportedGameVersions().length > 6}>
						<button
							type="button"
							class={styles["show-all-link"]}
							aria-expanded={showAllVersions()}
							onClick={() => setShowAllVersions((value) => !value)}
						>
							{showAllVersions()
								? "Show fewer"
								: `Show all ${supportedGameVersions().length}`}
						</button>
					</Show>
					<div class={styles["loader-detail-list"]}>
						<For each={props.version.loaders}>
							{(loader) => {
								const Icon = loaderIcons[loader.toLowerCase()];
								return (
									<div>
										<Show
											when={Icon}
											fallback={<CubeIcon width={16} height={16} />}
										>
											<Icon width={16} height={16} />
										</Show>
										<span>{loader}</span>
									</div>
								);
							}}
						</For>
					</div>
				</section>

				<section class={styles["focus-sidebar-section"]}>
					<div class={styles["focus-sidebar-heading"]}>
						<FolderIcon width={16} height={16} />
						<h3>Dependencies</h3>
					</div>
					<Show
						when={props.version.dependencies.length > 0}
						fallback={
							<p class={styles["focus-empty-copy"]}>No dependencies listed.</p>
						}
					>
						<DependencyGroup
							title="Required"
							tone="required"
							dependencies={required()}
							projects={props.dependencyProjects}
							onOpenProject={props.onOpenProject}
						/>
						<DependencyGroup
							title="Optional / embedded"
							tone="optional"
							dependencies={optional()}
							projects={props.dependencyProjects}
							onOpenProject={props.onOpenProject}
						/>
						<DependencyGroup
							title="Incompatible"
							tone="incompatible"
							dependencies={incompatible()}
							projects={props.dependencyProjects}
							onOpenProject={props.onOpenProject}
						/>
					</Show>
				</section>

				<section class={styles["focus-sidebar-section"]}>
					<div class={styles["focus-sidebar-heading"]}>
						<HistoryIcon width={16} height={16} />
						<h3>Release metadata</h3>
					</div>
					<dl class={styles["release-metadata-list"]}>
						<Show when={props.version.published_at}>
							<div>
								<dt>Published</dt>
								<dd>{formatDate(props.version.published_at || "")}</dd>
							</div>
						</Show>
						<Show when={props.version.download_count != null}>
							<div>
								<dt>Downloads</dt>
								<dd>{props.version.download_count?.toLocaleString()}</dd>
							</div>
						</Show>
						<div>
							<dt>Channel</dt>
							<dd class={styles.capitalize}>{props.version.release_type}</dd>
						</div>
						<div>
							<dt>Provider</dt>
							<dd class={styles.capitalize}>{props.project.source}</dd>
						</div>
						<div>
							<dt>Version ID</dt>
							<dd title={props.version.id}>{props.version.id}</dd>
						</div>
						<div>
							<dt>Project ID</dt>
							<dd title={props.version.project_id}>
								{props.version.project_id}
							</dd>
						</div>
					</dl>
				</section>
			</Show>
		</div>
	);
};
