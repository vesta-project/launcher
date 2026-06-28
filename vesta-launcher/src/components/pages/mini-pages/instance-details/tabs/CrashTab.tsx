import type { MiniRouter } from "@components/page-viewer/mini-router";
import CopyIcon from "@assets/clipboard.svg";
import LinkIcon from "@assets/link.svg";
import { openMiniPage } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledResource } from "@stores/resources";
import { resources } from "@stores/resources";
import { Badge } from "@ui/badge";
import Button from "@ui/button/button";
import { showToast } from "@ui/toast/toast";
import type { CrashEvent, CrashSuspect } from "@utils/crash-handler";
import { clearCrashDetails, formatCrashCategory } from "@utils/crash-handler";
import { openExternal } from "@utils/external-link";
import { createMemo, createSignal, For, Show } from "solid-js";
import { getRequiredVersionIssue, matchSuspectToResource } from "./crash-resource-match";
import styles from "./crash-tab.module.css";

type MclogsUploadResult = {
	url: string;
	raw?: string | null;
	id?: string | null;
	expires?: number | null;
};

const getProjectRecordKey = (platform: string | null | undefined, id: string | null | undefined) => {
	if (!platform || !id) return null;
	return `${platform.toLowerCase()}:${id}`;
};

const hasCanonicalResourceLink = (resource: InstalledResource | undefined) =>
	!!resource?.remote_id && (resource.platform === "modrinth" || resource.platform === "curseforge");

function SuspectIcon(props: { name: string; iconUrl?: string | null }) {
	const displayChar = () => {
		const match = props.name.match(/[a-zA-Z]/);
		if (match) return match[0].toUpperCase();
		return (props.name.charAt(0) || "?").toUpperCase();
	};

	return (
		<Show
			when={props.iconUrl?.startsWith("data:") ? props.iconUrl : null}
			fallback={<div class={styles.suspectIconPlaceholder}>{displayChar()}</div>}
		>
			{(url) => <img src={url()} alt="" class={styles.suspectIcon} />}
		</Show>
	);
}

function CrashSuspectCard(props: {
	suspect: CrashSuspect;
	resource?: InstalledResource;
	projectRecord?: Record<string, any>;
	instanceId?: number;
	gameVersion?: string;
	loader?: string;
	router?: MiniRouter;
}) {
	const clickable = () => hasCanonicalResourceLink(props.resource);
	const versionIssue = () => getRequiredVersionIssue(props.resource, props.suspect.reason);
	const statusLabel = () => {
		if (versionIssue()) return "Update";
		if (props.resource && !props.resource.is_enabled) return "Disabled";
		if (!props.resource) return "Missing";
		return null;
	};
	const showStatusMeta = () => !!versionIssue() || (!props.resource && !!props.instanceId);

	const navigateToResource = () => {
		const resource = props.resource;
		if (!resource || !hasCanonicalResourceLink(resource)) return;

		if (props.instanceId) {
			resources.setInstance(props.instanceId);
			if (props.gameVersion) resources.setGameVersion(props.gameVersion);
			if (props.loader) resources.setLoader(props.loader);
		}

		props.router?.navigate("/resource-details", {
			projectId: resource.remote_id,
			platform: resource.platform,
			name: resource.display_name,
		});
	};

	const browseMods = () => {
		if (!props.instanceId) return;
		openMiniPage("/resources", { selectedInstanceId: props.instanceId });
	};

	return (
		<div
			classList={{
				[styles.suspectCard]: true,
				[styles.suspectCardClickable]: clickable(),
				[styles.suspectCardDisabled]: !!props.resource && !props.resource.is_enabled,
			}}
			role={clickable() ? "button" : undefined}
			tabIndex={clickable() ? 0 : undefined}
			onClick={() => {
				if (clickable()) navigateToResource();
			}}
			onKeyDown={(event) => {
				if (!clickable()) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					navigateToResource();
				}
			}}
		>
			<div class={styles.suspectIconWrap}>
				<SuspectIcon
					name={props.suspect.display_name}
					iconUrl={props.projectRecord?.icon_url ?? null}
				/>
			</div>
			<div class={styles.suspectBody}>
				<div class={styles.suspectTitleRow}>
					<strong>{props.suspect.display_name}</strong>
					<Show
						when={
							props.suspect.mod_id &&
							props.suspect.mod_id.toLowerCase() !==
								props.suspect.display_name.toLowerCase().replace(/\s+/g, "-")
						}
					>
						<span class={styles.suspectModId}>{props.suspect.mod_id}</span>
					</Show>
					<Show when={props.suspect.suspect_kind === "missing_dependency" && statusLabel()}>
						{(label) => (
							<Badge
								class={styles.suspectStatusBadge}
								variant={label() === "Missing" ? "error" : "warning"}
							>
								{label()}
							</Badge>
						)}
					</Show>
				</div>
				<Show when={props.suspect.reason}>
					<p class={styles.suspectReason}>{props.suspect.reason}</p>
				</Show>
				<Show
					when={
						props.suspect.suspect_kind === "missing_dependency" &&
						showStatusMeta()
					}
				>
					<div class={styles.suspectMeta}>
						<Show when={versionIssue()}>
							<span class={styles.suspectStatusNote}>{versionIssue()}</span>
						</Show>
						<Show when={!props.resource && props.instanceId}>
							<button
								type="button"
								class={styles.suspectLink}
								onClick={(event) => {
									event.stopPropagation();
									browseMods();
								}}
							>
								Browse mods
							</button>
						</Show>
					</div>
				</Show>
			</div>
		</div>
	);
}

export function CrashTab(props: {
	instanceSlug: string;
	instanceId?: number;
	gameVersion?: string;
	loader?: string;
	crash?: CrashEvent;
	installedResources?: InstalledResource[];
	projectRecords?: Record<string, Record<string, any>>;
	router?: MiniRouter;
	onCleared?: () => void;
}) {
	const [shareUrl, setShareUrl] = createSignal<string | null>(props.crash?.mclogs_url ?? null);
	const [busy, setBusy] = createSignal(false);

	const AFFECTED_MODS_SCROLL_THRESHOLD = 4;

	const fixes = () =>
		props.crash?.suggested_fixes?.length
			? props.crash.suggested_fixes
			: ["Open the latest log and check the first error above the stack trace."];

	const suspects = createMemo((): CrashSuspect[] => {
		if (props.crash?.suspects?.length) return props.crash.suspects;
		return (props.crash?.suspected_resources ?? []).map((name) => ({
			display_name: name,
			mod_id: null,
			reason: null,
			suspect_kind: "affected_mod",
		}));
	});

	const missingDependencies = createMemo(() =>
		suspects().filter((s) => s.suspect_kind === "missing_dependency"),
	);
	const affectedMods = createMemo(() =>
		suspects().filter((s) => s.suspect_kind !== "missing_dependency"),
	);

	const openPath = async (path?: string | null) => {
		if (!path) return;
		try {
			await invoke("open_crash_report", { path });
		} catch (error) {
			showToast({
				title: "Could not open file",
				description: String(error),
				severity: "error",
			});
		}
	};

	const clearCrash = async () => {
		try {
			await invoke("clear_instance_crash", { instanceIdSlug: props.instanceSlug });
			clearCrashDetails(props.instanceSlug);
			props.onCleared?.();
		} catch (error) {
			showToast({
				title: "Could not clear crash",
				description: String(error),
				severity: "error",
			});
		}
	};

	const upload = async () => {
		setBusy(true);
		try {
			const result = await invoke<MclogsUploadResult>("upload_crash_to_mclogs", {
				instanceIdSlug: props.instanceSlug,
				crashId: props.crash?.crash_id ?? null,
			});
			setShareUrl(result.url);
		} catch (error) {
			showToast({
				title: "mclo.gs upload failed",
				description: String(error),
				severity: "error",
			});
		} finally {
			setBusy(false);
		}
	};

	const copyShareUrl = async () => {
		const url = shareUrl();
		if (!url) return;

		try {
			await navigator.clipboard.writeText(url);
			showToast({
				title: "Link copied",
				description: "Crash log URL copied to clipboard",
				severity: "success",
			});
		} catch (error) {
			showToast({
				title: "Could not copy link",
				description: String(error),
				severity: "error",
			});
		}
	};

	const resolveSuspectContext = (suspect: CrashSuspect) => {
		const installed = props.installedResources ?? [];
		const resource = matchSuspectToResource(suspect, installed);
		const projectRecord = resource
			? props.projectRecords?.[
					getProjectRecordKey(resource.platform, resource.remote_id) || ""
				]
			: undefined;
		return { resource, projectRecord };
	};

	const openShareUrl = async () => {
		const url = shareUrl();
		if (!url) return;
		await openExternal(url);
	};

	const shareLabel = () => {
		const url = shareUrl();
		if (!url) return "Share log";
		return url.replace(/^https?:\/\//, "");
	};

	const renderSuspectCards = (items: CrashSuspect[]) => (
		<For each={items}>
			{(suspect) => {
				const ctx = resolveSuspectContext(suspect);
				return (
					<CrashSuspectCard
						suspect={suspect}
						resource={ctx.resource}
						projectRecord={ctx.projectRecord}
						instanceId={props.instanceId}
						gameVersion={props.gameVersion}
						loader={props.loader}
						router={props.router}
					/>
				);
			}}
		</For>
	);

	const renderSuspectGroup = (title: string, items: CrashSuspect[]) => (
		<Show when={items.length}>
			<div class={styles.suspectGroup}>
				<h4>{title}</h4>
				<div class={styles.suspectList}>{renderSuspectCards(items)}</div>
			</div>
		</Show>
	);

	return (
		<section class={styles.root}>
			<Show
				when={props.crash}
				fallback={
					<div class={styles.empty}>
						<div class={styles.emptyMark} />
						<h2>No recent crash</h2>
					</div>
				}
			>
				{(crash) => (
					<>
						<div class={styles.hero}>
							<div class={styles.heroContent}>
								<div class={styles.kicker}>
									<Badge variant="error">
										{formatCrashCategory(crash().category || crash().crash_type)}
									</Badge>
									<span>{new Date(crash().timestamp).toLocaleString()}</span>
								</div>
								<h2>{crash().title || "Instance crashed"}</h2>
								<p>{crash().message}</p>
							</div>
							<div class={styles.heroActions}>
								<Show
									when={shareUrl()}
									fallback={
										<Button
											class={styles.shareButton}
											size="sm"
											variant="outline"
											onClick={() => void upload()}
											disabled={busy()}
										>
											<LinkIcon />
											{busy() ? "Uploading..." : "Share log"}
										</Button>
									}
								>
									<div class={styles.shareInline}>
										<button
											type="button"
											class={styles.shareLinkButton}
											onClick={() => void openShareUrl()}
										>
											<LinkIcon />
											<span>{shareLabel()}</span>
										</button>
										<button
											type="button"
											class={styles.shareCopyButton}
											onClick={() => void copyShareUrl()}
											aria-label="Copy link"
											title="Copy link"
										>
											<CopyIcon />
										</button>
									</div>
								</Show>
								<Button
									color="destructive"
									variant="outline"
									size="sm"
									onClick={() => void clearCrash()}
								>
									Clear Crash
								</Button>
							</div>
						</div>

						<div class={styles.grid}>
							<div class={styles.primary}>
								<Show when={suspects().length}>
									<section class={styles.panel}>
										<h3>Suspects</h3>
										{renderSuspectGroup("Missing dependencies", missingDependencies())}
										<Show when={affectedMods().length}>
											<div class={styles.suspectGroup}>
												<h4>Affected mods</h4>
												<div
													classList={{
														[styles.suspectList]: true,
														[styles.suspectListScrollable]:
															affectedMods().length > AFFECTED_MODS_SCROLL_THRESHOLD,
													}}
												>
													{renderSuspectCards(affectedMods())}
												</div>
											</div>
										</Show>
									</section>
								</Show>

								<section class={styles.panel}>
									<h3>Suggested Fixes</h3>
									<div class={styles.fixList}>
										<For each={fixes()}>
											{(fix, index) => (
												<div class={styles.fix}>
													<span class={styles.fixNumber}>{index() + 1}</span>
													<p>{fix}</p>
												</div>
											)}
										</For>
										<div class={`${styles.fix} ${styles.fixHelp}`}>
											<span class={styles.fixNumber}>?</span>
											<p>
												Still having issues?{" "}
												<button
													type="button"
													class={styles.helpLink}
													onClick={() => void openExternal("https://discord.gg/zuDNHNHk8E")}
												>
													Ask for help on Discord
												</button>
											</p>
										</div>
									</div>
								</section>
							</div>

							<aside class={styles.side}>
								<div class={styles.devNoticePanel}>
									<p>
										Crash detection is still in development and may be incomplete or wrong.{" "}
										<button
											type="button"
											class={styles.helpLink}
											onClick={() => void openExternal("https://discord.gg/zuDNHNHk8E")}
										>
											Report problems on Discord
										</button>
									</p>
								</div>

								<section class={styles.panel}>
									<div class={styles.logExcerptBlock}>
										<h3>Log excerpt</h3>
										<div class={styles.evidenceScroller}>
											<pre class={styles.evidence}>
												{crash().evidence ||
													"No excerpt was captured for this crash. Use Open file or Logs below to inspect the full log."}
											</pre>
										</div>
										<div class={styles.pathActions}>
										<Button
											size="sm"
											variant="outline"
											onClick={() => void openPath(crash().report_path || crash().log_path)}
											disabled={!crash().report_path && !crash().log_path}
										>
											Open file
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => void invoke("open_logs_folder", { instanceIdSlug: props.instanceSlug })}
										>
											Logs
										</Button>
										</div>
									</div>
								</section>

							</aside>
						</div>

						<div class={styles.stickyActions}>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void openPath(crash().report_path || crash().log_path)}
							>
								Open file
							</Button>
							<Button size="sm" variant="ghost" onClick={() => void clearCrash()}>
								Clear Crash
							</Button>
						</div>
					</>
				)}
			</Show>
		</section>
	);
}
