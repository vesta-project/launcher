import { t } from "~/localization";
// Instance Card component with play/kill button and toast notifications

import ErrorIcon from "@assets/icons/status/error.svg";
import FabricLogo from "@assets/branding/modloaders/fabric-logo.svg";
import ForgeLogo from "@assets/branding/modloaders/forge-logo.svg";
import NeoForgeLogo from "@assets/branding/modloaders/neoforge-logo.svg";
import PlayIcon from "@assets/icons/actions/play.svg";
import QuiltLogo from "@assets/branding/modloaders/quilt-logo.svg";
import ReloadIcon from "@assets/icons/actions/reload.svg";
import KillIcon from "@assets/icons/actions/stop.svg";
import { openMiniPage } from "@components/page-viewer/page-viewer";
import {
	openStandaloneMiniPage,
	preloadMiniPage,
} from "@components/page-viewer/standalone-launcher";
import {
	clearRunning,
	instancesState,
	setLaunching,
	setRunning,
} from "@stores/instances";
import {
	isPinned as isPinnedInStore,
	pinning,
	pinPage,
	unpinPage,
} from "@stores/pinning";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "@ui/badge";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuPortal,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { ExportDialog } from "@ui/export-dialog";
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { resolveResourceUrl } from "@utils/assets";
import {
	clearCrashDetails,
	getCrashDetails,
	isInstanceCrashed,
	parseCrashDetails,
} from "@utils/crash-handler";
import { createAnimatedIconPreview } from "@utils/icon-animation";
import type { Instance } from "@utils/instances";
import {
	getInstanceInstallationFailureReason,
	getInstanceOperationLabel,
	getInstanceSlug,
	installInstance,
	isInstanceInstallationFailed,
	isInstanceOperationInProgress,
	isInstanceRunning,
	isInstanceUpdateRecovery,
	killInstance,
	launchInstance,
	needsInstanceInstallation,
	resolveInstanceDisplayIcon,
	resumeInstanceOperation,
} from "@utils/instances";
import { openInstanceTab } from "@utils/launch-intents";
import clsx from "clsx";
import {
	createMemo,
	createSignal,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import {
	handleDuplicate,
	handleHardReset,
	handleRepair,
	handleUninstall,
} from "../../../../handlers/instance-handler";
import styles from "./instance-card.module.css";

interface InstanceCardProps {
	instance: Instance;
}

export default function InstanceCard(props: InstanceCardProps) {
	const [leaveAnim, setLeaveAnim] = createSignal(false);
	const [showExportDialog, setShowExportDialog] = createSignal(false);
	const [busy, setBusy] = createSignal(false);

	const instanceSlug = () => getInstanceSlug(props.instance);
	const isPinned = createMemo(() =>
		isPinnedInStore("instance", instanceSlug()),
	);

	const storeInstance = createMemo(
		() =>
			instancesState.instances.find((inst) => inst.id === props.instance.id) ??
			props.instance,
	);

	const isRunning = createMemo(
		() => !!instancesState.runningIds[instanceSlug()],
	);
	const hasCrashed = createMemo(
		() => isInstanceCrashed(instanceSlug()) || !!storeInstance().crashed,
	);

	const crashSummary = createMemo(() => {
		const slug = instanceSlug();
		const crash =
			getCrashDetails(slug) ||
			parseCrashDetails(storeInstance().crashDetails, slug);
		if (!crash?.message) return null;
		const text = crash.message.trim();
		return text.length > 72 ? `${text.slice(0, 69)}…` : text;
	});
	const isWarmingUp = createMemo(
		() => !!instancesState.launchingIds[instanceSlug()] && !isRunning(),
	);

	const isInstalling = createMemo(() =>
		isInstanceOperationInProgress(storeInstance()),
	);
	const isInterrupted = createMemo(
		() => storeInstance().installationStatus === "interrupted",
	);
	const isFailed = createMemo(() =>
		isInstanceInstallationFailed(storeInstance()),
	);
	const isUpdateRecovery = createMemo(() =>
		isInstanceUpdateRecovery(storeInstance()),
	);

	const cardIconPreview = createAnimatedIconPreview(() =>
		resolveInstanceDisplayIcon(storeInstance()),
	);

	const instanceBackgroundImage = () => {
		const source =
			cardIconPreview.displaySource() ||
			resolveResourceUrl(resolveInstanceDisplayIcon(storeInstance()));
		if (!source) return "none";
		if (source.startsWith("linear-gradient")) return source;
		return `url('${source}')`;
	};

	onMount(() => {
		const unlisteners: (() => void)[] = [];

		const setup = async () => {
			const slug = instanceSlug();
			if (!instancesState.runningIds[slug]) {
				try {
					const isCurrentlyRunning = await isInstanceRunning(props.instance);
					if (isCurrentlyRunning) {
						setRunning(slug, {
							pid: 0,
							startTime: Math.floor(Date.now() / 1000),
						});
					}
				} catch (error) {
					console.error("Failed to check instance running status:", error);
				}
			}

			unlisteners.push(
				await listen("core://instance-crashed", (event) => {
					const payload = (event as any).payload as {
						instance_id?: string;
					};
					if (payload.instance_id === slug) {
						setLaunching(slug, false);
					}
				}),
			);
		};

		void setup();

		onCleanup(() => {
			for (const unlisten of unlisteners) {
				unlisten();
			}
		});
	});

	const operationLabel = () => getInstanceOperationLabel(storeInstance());

	const failureReason = () => {
		return getInstanceInstallationFailureReason(storeInstance());
	};

	const needsInstallation = () => needsInstanceInstallation(storeInstance());

	const playButtonTooltip = () => {
		if (isInstalling()) {
			return t("app-shell-operation-progress", { operation: operationLabel() });
		}

		if (isInterrupted()) {
			if (isUpdateRecovery()) {
				return t("app-shell-update-recovery-incomplete");
			}
			const op =
				storeInstance().lastOperation === "hard-reset"
					? t("app-shell-hard-reset")
					: storeInstance().lastOperation === "update"
						? t("app-shell-update")
						: storeInstance().lastOperation || t("app-shell-installation");
			return t("app-shell-operation-interrupted", {
				operation: op.slice(0, 1).toUpperCase() + op.slice(1).toLowerCase(),
			});
		}

		if (needsInstallation()) return t("app-shell-needs-installation");
		if (isRunning()) return t("app-shell-running-click-to-stop");
		if (isWarmingUp()) return t("app-shell-warming-up");
		if (hasCrashed()) return t("app-shell-crash-details");
		return t("app-shell-launch");
	};

	const toggleRun = async () => {
		if (busy() || isWarmingUp()) return;

		if (isRunning()) {
			const slug = instanceSlug();
			setLaunching(slug, false);
			clearRunning(slug);
			setBusy(true);
			try {
				await killInstance(props.instance);
				showToast({
					title: t("app-shell-killed"),
					description: t("app-shell-killed-instance", {
						name: props.instance.name,
					}),
					severity: "info",
					duration: 3000,
				});
			} catch (err) {
				console.error("Kill failed", err);
				showToast({
					title: t("app-shell-kill-failed"),
					description: String(err),
					severity: "error",
					duration: 5000,
				});
			}
			setBusy(false);
		} else {
			const slug = instanceSlug();
			setLaunching(slug, true);
			try {
				clearCrashDetails(slug);

				await launchInstance(props.instance);
			} catch (err) {
				console.error("Launch failed", err);
				showToast({
					title: t("shared-ui-launch-failed"),
					description: String(err),
					severity: "error",
					duration: 5000,
				});
			}
		}
	};

	const handlePrimaryAction = async () => {
		if (busy() || isWarmingUp()) return;

		if (isInstalling()) {
			return;
		}

		if (needsInstallation() || isInterrupted()) {
			setBusy(true);
			try {
				if (isInterrupted()) {
					await resumeInstanceOperation(storeInstance());
				} else {
					await installInstance(storeInstance());
				}
			} catch (err) {
				console.error("Install/Resume failed", err);
			}
			setBusy(false);
			return;
		}

		if (hasCrashed()) {
			openCrashDetails();
			return;
		}

		await toggleRun();
	};

	const handleClick = async (e: MouseEvent) => {
		e.stopPropagation();
		await handlePrimaryAction();
	};

	const handleContextToggle = () => {
		void handlePrimaryAction();
	};

	const openInstanceDetails = () => {
		if (hasCrashed()) {
			openCrashDetails();
			return;
		}
		openMiniPage(
			"/instance",
			{ slug: instanceSlug() },
			{ prefetchedInstance: storeInstance() },
		);
	};

	const openCrashDetails = () => {
		openInstanceTab(instanceSlug(), "crash");
	};

	const openInstanceDetailsStandalone = () => {
		void openStandaloneMiniPage(
			"/instance",
			{ slug: instanceSlug() },
			{ prefetchedInstance: props.instance },
		);
	};

	const openAddContent = () => {
		openMiniPage("/resources", { selectedInstanceId: props.instance.id });
	};

	const openInstanceFolder = async () => {
		try {
			await invoke("open_instance_folder", { instanceIdSlug: instanceSlug() });
		} catch (e) {
			console.error("Failed to open instance folder:", e);
			showToast({
				title: t("app-shell-open-folder-failed"),
				description: String(e),
				severity: "error",
			});
		}
	};

	const handlePinToggle = async () => {
		const slug = instanceSlug();
		if (isPinned()) {
			const pin = pinning.pins.find(
				(p) => p.page_type === "instance" && p.target_id === slug,
			);
			if (pin) await unpinPage(pin.id);
			return;
		}

		await pinPage({
			page_type: "instance",
			target_id: slug,
			label: storeInstance().name,
			icon_url:
				storeInstance().iconPath || storeInstance().modpackIconUrl || null,
			platform: null,
			order_index: pinning.pins.length,
		});
	};

	const handleFakeCrash = async () => {
		try {
			await invoke("emit_fake_crash", { instanceIdSlug: instanceSlug() });
			showToast({
				title: t("app-shell-fake-crash"),
				description: t("app-shell-fake-crash-description", {
					name: props.instance.name,
				}),
				severity: "info",
			});
		} catch (err) {
			console.error("Fake crash failed:", err);
			showToast({
				title: t("app-shell-fake-crash-failed"),
				description: String(err),
				severity: "error",
			});
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger
				as="div"
				class={clsx(
					styles["instance-card"],
					isFailed() && styles.failed,
					isInterrupted() && styles.interrupted,
					isWarmingUp() && styles["instance-card--warming"],
					isRunning() && !isWarmingUp() && styles["instance-card--running"],
					hasCrashed() &&
						!isRunning() &&
						!isWarmingUp() &&
						styles["instance-card--crashed"],
					leaveAnim() && styles["instance-card-leave"],
				)}
				onMouseEnter={() => {
					setLeaveAnim(false);
					cardIconPreview.activate();
					preloadMiniPage("/instance");
				}}
				onMouseLeave={() => {
					cardIconPreview.deactivate();
					setLeaveAnim(true);
					setTimeout(() => setLeaveAnim(false), 250);
				}}
				onFocusIn={() => {
					cardIconPreview.activate();
					preloadMiniPage("/instance");
				}}
				onFocusOut={cardIconPreview.deactivate}
				onClick={openInstanceDetails}
				style={{
					"--instance-bg-image": instanceBackgroundImage(),
				}}
				data-instance={instanceSlug()}
			>
				<Switch>
					<Match when={isInstalling()}>
						<div class={styles["instance-card-centered"]}>
							<div
								class={styles["instance-card-spinner"]}
								data-essential-motion
							></div>
							<h1
								style={{
									margin: 0,
									padding: 0,
									"line-height": "16px",
									"font-weight": "bold",
									"text-align": "center",
								}}
							>
								{props.instance.name}
							</h1>
							<p
								style={{
									margin: "6px 0 0",
									padding: 0,
									"font-size": "11px",
									opacity: 0.85,
									"text-align": "center",
								}}
							>
				{t("app-shell-operation-progress", {
					operation: operationLabel(),
				})}
							</p>
						</div>
					</Match>
					<Match when={isFailed()}>
						<div
							class={`${styles["instance-card-centered"]} ${styles["failure-overlay"]}`}
						>
							<ErrorIcon />
							<h1
								style={{
									margin: "4px 0 0",
									padding: 0,
									"line-height": "16px",
									"font-weight": "bold",
									"text-align": "center",
								}}
							>
								{props.instance.name}
							</h1>
							<p
								style={{
									margin: "4px 8px 0",
									padding: 0,
									"font-size": "10px",
									"text-align": "center",
									"line-height": "1.2",
								}}
							>
								{failureReason()}
							</p>
							<button
								type="button"
								class={styles["failure-retry-button"]}
								onClick={handleClick}
								disabled={busy()}
								aria-label={t("app-shell-retry-installation")}
							>
								<ReloadIcon />
								<span>{busy() ? t("app-shell-retrying") : t("app-shell-retry-installation")}</span>
							</button>
						</div>
					</Match>
					<Match when={true}>
						<div class={styles["instance-card-top"]}>
							<div class={styles["instance-card-indicators"]}>
								<Show when={isWarmingUp()}>
									<div
										class={clsx(
											styles["status-tag"],
											styles["status-tag--warming"],
										)}
									>{t("app-shell-warming-up-status")}</div>
								</Show>
								<Show when={isRunning() && !isWarmingUp()}>
									<div
										class={clsx(
											styles["status-tag"],
											styles["status-tag--running"],
										)}
									>{t("app-shell-running")}</div>
								</Show>
								<Show when={isInterrupted()}>
									<Badge variant="warning" dot={true}>
										{isUpdateRecovery() ? t("app-shell-recovery-needed") : t("app-shell-interrupted")}
									</Badge>
								</Show>
								<Show when={hasCrashed()}>
									<div
										class={clsx(
											styles["status-tag"],
											styles["status-tag--crashed"],
										)}
										onClick={(e) => {
											e.stopPropagation();
											openCrashDetails();
										}}
										role="button"
										tabIndex={0}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												e.stopPropagation();
												openCrashDetails();
											}
										}}
									>{t("app-shell-crashed")}</div>
								</Show>
							</div>
							<Tooltip placement="top">
								<TooltipTrigger>
									<button
										class={clsx(
											"grain-overlay",
											styles["play-button"],
											isInstalling()
												? styles.installing
												: isWarmingUp()
													? styles.warming
													: isInterrupted()
														? styles.resume
														: needsInstallation()
															? styles.install
															: isRunning()
																? styles.kill
																: hasCrashed()
																	? styles.crash
																	: styles.launch,
										)}
										onClick={handleClick}
										aria-label={playButtonTooltip()}
										aria-busy={isWarmingUp()}
										aria-pressed={isRunning()}
										disabled={isInstalling() || isWarmingUp()}
									>
										{isInstalling() || isWarmingUp() ? (
											<div
												class={styles["instance-card-spinner"]}
												data-essential-motion
											/>
										) : isInterrupted() ? (
											<ReloadIcon />
										) : needsInstallation() ? (
											<ErrorIcon />
										) : isRunning() ? (
											<KillIcon />
										) : hasCrashed() ? (
											<ErrorIcon />
										) : (
											<PlayIcon />
										)}
									</button>
								</TooltipTrigger>
								<TooltipContent>{playButtonTooltip()}</TooltipContent>
							</Tooltip>
						</div>
						<div class={styles["instance-card-bottom"]}>
							<h1>{props.instance.name}</h1>
							<Show when={hasCrashed() && crashSummary()}>
								<p class={styles["crash-summary"]}>{crashSummary()}</p>
							</Show>
							<div class={styles["instance-card-bottom-version"]}>
								<p>{storeInstance().minecraftVersion}</p>
								<div class={styles["instance-card-bottom-version-modloader"]}>
									<Switch fallback="">
										<Match when={storeInstance().modloader === "forge"}>
											<ForgeLogo />
										</Match>
										<Match when={storeInstance().modloader === "neoforge"}>
											<NeoForgeLogo />
										</Match>
										<Match when={storeInstance().modloader === "fabric"}>
											<FabricLogo />
										</Match>
										<Match when={storeInstance().modloader === "quilt"}>
											<QuiltLogo />
										</Match>
										<Match
											when={
												storeInstance().modloader &&
												storeInstance().modloader !== "vanilla"
											}
										>
											<p style={{ "text-transform": "capitalize" }}>
												{storeInstance().modloader}
											</p>
										</Match>
									</Switch>
								</div>
							</div>
						</div>
					</Match>
				</Switch>
			</ContextMenuTrigger>
			<ContextMenuPortal>
				<ContextMenuContent>
					<ContextMenuItem
						onSelect={handleContextToggle}
						disabled={isWarmingUp()}
					>
						<span>
							{isRunning()
								? t("app-shell-stop")
								: isWarmingUp()
									? t("app-shell-warming-up")
									: isInterrupted()
										? isUpdateRecovery()
										? t("common-resume-recovery")
											: t("app-shell-resume-operation")
										: needsInstallation()
											? isFailed()
												? t("app-shell-retry-installation")
												: t("app-shell-install")
											: hasCrashed()
												? t("app-shell-crash-details")
												: t("app-shell-play")}
						</span>
					</ContextMenuItem>

					<ContextMenuItem onSelect={openInstanceDetails}>
						<span>{t("app-shell-open-details")}</span>
					</ContextMenuItem>

					<ContextMenuItem onSelect={openInstanceDetailsStandalone}>
						<span>{t("app-shell-open-in-new-window-menu")}</span>
					</ContextMenuItem>

					<ContextMenuSeparator />

					<ContextMenuItem onSelect={openAddContent}>
						<span>{t("app-shell-add-content")}</span>
					</ContextMenuItem>

					<ContextMenuItem
						onSelect={() => {
							void openInstanceFolder();
						}}
					>
										<span>{t("shared-ui-open-folder")}</span>
					</ContextMenuItem>

					<ContextMenuItem
						onSelect={() => {
							void handlePinToggle();
						}}
					>
						<span>{isPinned() ? t("app-shell-unpin-from-sidebar") : t("app-shell-pin-to-sidebar")}</span>
					</ContextMenuItem>

					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<span>{t("app-shell-manage")}</span>
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							<ContextMenuItem
								onSelect={() => {
									void handleRepair(props.instance);
								}}
							>
								<span>{t("app-shell-repair")}</span>
							</ContextMenuItem>

							<ContextMenuItem
								onSelect={() => {
									handleDuplicate(props.instance);
								}}
							>
								<span>{t("app-shell-duplicate")}</span>
							</ContextMenuItem>

							<ContextMenuItem onSelect={() => setShowExportDialog(true)}>
								<span>{t("app-shell-export-instance")}</span>
							</ContextMenuItem>

							<ContextMenuItem
								onSelect={() => {
									handleHardReset(props.instance);
								}}
							>
								<span>{t("app-shell-hard-reset-menu")}</span>
							</ContextMenuItem>

							<Show when={import.meta.env.DEV}>
								<ContextMenuItem
									onSelect={() => {
										void handleFakeCrash();
									}}
								>
									<span>{t("app-shell-fake-crash")}</span>
								</ContextMenuItem>
							</Show>
						</ContextMenuSubContent>
					</ContextMenuSub>

					<ContextMenuSeparator />

					<ContextMenuItem
						class={styles["menu-item--danger"]}
						onSelect={() => {
							handleUninstall(props.instance);
						}}
					>
						<span>{t("app-shell-uninstall")}</span>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenuPortal>
			<ExportDialog
				isOpen={showExportDialog()}
				onClose={() => setShowExportDialog(false)}
				instanceId={props.instance.id}
				instanceName={props.instance.name}
			/>
		</ContextMenu>
	);
}
