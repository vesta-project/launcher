// Instance Card component with play/kill button and toast notifications

import ErrorIcon from "@assets/error.svg";
import FabricLogo from "@assets/fabric-logo.svg";
import ForgeLogo from "@assets/forge-logo.svg";
import NeoForgeLogo from "@assets/neoforge-logo.svg";
import PlayIcon from "@assets/play.svg";
import QuiltLogo from "@assets/quilt-logo.svg";
import ReloadIcon from "@assets/reload.svg";
import KillIcon from "@assets/rounded-square.svg";
import CrashDetailsModal from "@components/modals/crash-details-modal";
import { router, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import {
	clearRunning,
	instancesState,
	setLaunching,
	setRunning,
} from "@stores/instances";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "@ui/badge";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuPortal,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { ExportDialog } from "@ui/export-dialog";
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { resolveResourceUrl } from "@utils/assets";
import { clearCrashDetails, isInstanceCrashed } from "@utils/crash-handler";
import type { Instance } from "@utils/instances";
import {
	getInstanceOperationLabel,
	getInstanceSlug,
	installInstance,
	isInstanceOperationInProgress,
	isInstanceRunning,
	killInstance,
	launchInstance,
	resolveInstanceDisplayIcon,
	resumeInstanceOperation,
} from "@utils/instances";
import clsx from "clsx";
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
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
	const [hasCrashed, setHasCrashed] = createSignal(false);
	const [showCrashModal, setShowCrashModal] = createSignal(false);
	const [showExportDialog, setShowExportDialog] = createSignal(false);
	const [busy, setBusy] = createSignal(false);

	const instanceSlug = () => getInstanceSlug(props.instance);

	const storeInstance = createMemo(
		() => instancesState.instances.find((inst) => inst.id === props.instance.id) ?? props.instance,
	);

	const isRunning = createMemo(() => !!instancesState.runningIds[instanceSlug()]);
	const isWarmingUp = createMemo(
		() => !!instancesState.launchingIds[instanceSlug()] && !isRunning(),
	);

	const isInstalling = createMemo(() => isInstanceOperationInProgress(storeInstance()));
	const isInterrupted = createMemo(
		() => storeInstance().installationStatus === "interrupted",
	);
	const isInstalled = createMemo(() => storeInstance().installationStatus === "installed");
	const isFailed = createMemo(() => {
		const status = storeInstance().installationStatus;
		return status === "failed" || status?.startsWith("failed:");
	});

	const instanceBackgroundImage = () => {
		const rawPath = resolveInstanceDisplayIcon(storeInstance());
		if (rawPath.startsWith("linear-gradient")) {
			return rawPath;
		}

		return `url('${resolveResourceUrl(rawPath)}')`;
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
						setHasCrashed(true);
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

		setHasCrashed(isInstanceCrashed(instanceSlug()));
	});

	const operationLabel = () => getInstanceOperationLabel(storeInstance());

	const failureReason = () => {
		if (!isFailed()) return null;
		const status = storeInstance().installationStatus;
		if (status?.includes(":")) {
			return status.split(":").slice(1).join(":");
		}
		return "Installation failed";
	};

	const needsInstallation = () => !storeInstance().installationStatus || isFailed();

	const playButtonTooltip = () => {
		if (isInstalling()) {
			return `${operationLabel()}...`;
		}

		if (isInterrupted()) {
			const op =
				storeInstance().lastOperation === "hard-reset"
					? "Hard reset"
					: storeInstance().lastOperation === "update"
						? "Update"
						: storeInstance().lastOperation || "Installation";
			return `${op.slice(0, 1).toUpperCase() + op.slice(1).toLowerCase()} interrupted. Click to resume.`;
		}

		if (needsInstallation()) return "Needs Installation";
		if (isRunning()) return "Running (click to stop)";
		if (isWarmingUp()) return "Warming up...";
		return "Launch";
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
					title: "Killed",
					description: `Killed instance \"${props.instance.name}\"`,
					severity: "info",
					duration: 3000,
				});
			} catch (err) {
				console.error("Kill failed", err);
				showToast({
					title: "Kill Failed",
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
				setHasCrashed(false);

				await launchInstance(props.instance);
				showToast({
					title: "Launching",
					description: `Launching instance \"${props.instance.name}\"`,
					severity: "info",
					duration: 3000,
				});
			} catch (err) {
				console.error("Launch failed", err);
				showToast({
					title: "Launch Failed",
					description: String(err),
					severity: "error",
					duration: 5000,
				});
			}
		}
	};

	const handleClick = async (e: MouseEvent) => {
		e.stopPropagation();

		if (busy() || isWarmingUp()) return;

		if (isInstalling()) {
			return;
		}

		if (needsInstallation() || isInterrupted()) {
			setBusy(true);
			try {
				if (isInterrupted()) {
					await resumeInstanceOperation(props.instance);
				} else {
					await installInstance(props.instance);
				}
			} catch (err) {
				console.error("Install/Resume failed", err);
			}
			setBusy(false);
			return;
		}

		await toggleRun();
	};

	const handleContextToggle = () => {
		if (busy() || isWarmingUp() || isInstalling()) return;
		void toggleRun();
	};

	const openInstanceDetails = () => {
		router()?.navigate("/instance", { id: props.instance.id });
		setPageViewerOpen(true);
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
					leaveAnim() && styles["instance-card-leave"],
				)}
				onMouseOver={() => {
					setLeaveAnim(false);
				}}
				onMouseLeave={() => {
					setLeaveAnim(true);
					setTimeout(() => setLeaveAnim(false), 250);
				}}
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
								{operationLabel()}...
							</p>
						</div>
					</Match>
					<Match when={isFailed()}>
						<div class={`${styles["instance-card-centered"]} ${styles["failure-overlay"]}`}>
							<ErrorIcon style={{ width: "24px", height: "24px", color: "var(--semantic-error)" }} />
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
									color: "var(--text-on-accent)",
									opacity: 0.8,
									"text-align": "center",
									"line-height": "1.2",
								}}
							>
								{failureReason()}
							</p>
						</div>
					</Match>
					<Match when={true}>
						<div class={styles["instance-card-top"]}>
							<div class={styles["instance-card-indicators"]}>
								<Show when={isWarmingUp()}>
									<div class={clsx(styles["status-tag"], styles["status-tag--warming"])}>
										Warming up
									</div>
								</Show>
								<Show when={isRunning() && !isWarmingUp()}>
									<div class={clsx(styles["status-tag"], styles["status-tag--running"])}>
										Running
									</div>
								</Show>
								<Show when={isInterrupted()}>
									<Badge variant="warning" dot={true}>
										Interrupted
									</Badge>
								</Show>
								<Show when={hasCrashed()}>
									<Tooltip placement="top">
										<TooltipTrigger>
											<Badge
												variant="error"
												dot={true}
												onClick={(e) => {
													e.stopPropagation();
													setShowCrashModal(true);
												}}
												style={{ cursor: "pointer" }}
											>
												Crashed
											</Badge>
										</TooltipTrigger>
										<TooltipContent>Click to view crash details</TooltipContent>
									</Tooltip>
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
												storeInstance().modloader && storeInstance().modloader !== "vanilla"
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
					<ContextMenuLabel>Actions</ContextMenuLabel>
					<ContextMenuSeparator />

					<ContextMenuItem onSelect={handleContextToggle} disabled={isWarmingUp()}>
						<span
							style={{
								display: "inline-flex",
								"align-items": "center",
								gap: "0.5rem",
							}}
						>
							{isRunning() ? "Stop" : isWarmingUp() ? "Warming up..." : "Play"}
						</span>
						<ContextMenuShortcut>{isRunning() ? "Ctrl-K" : "Ctrl-P"}</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem
						onSelect={() => {
							void handleRepair(props.instance);
						}}
					>
						Repair
						<ContextMenuShortcut>Ctrl-R</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem
						onSelect={() => {
							handleDuplicate(props.instance);
						}}
					>
						Duplicate
					</ContextMenuItem>

					<ContextMenuItem onSelect={() => setShowExportDialog(true)}>Export Instance</ContextMenuItem>

					<ContextMenuItem
						onSelect={() => {
							handleHardReset(props.instance);
						}}
					>
						Hard Reset
					</ContextMenuItem>

					<ContextMenuSeparator />

					<ContextMenuItem
						onSelect={() => {
							handleUninstall(props.instance);
						}}
					>
						Uninstall
						<ContextMenuShortcut>Ctrl-U</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem>
						Profile <ContextMenuShortcut>Ctrl-C</ContextMenuShortcut>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenuPortal>
			<CrashDetailsModal
				instanceId={instanceSlug()}
				isOpen={showCrashModal()}
				onClose={() => setShowCrashModal(false)}
			/>
			<ExportDialog
				isOpen={showExportDialog()}
				onClose={() => setShowExportDialog(false)}
				instanceId={props.instance.id}
				instanceName={props.instance.name}
			/>
		</ContextMenu>
	);
}
