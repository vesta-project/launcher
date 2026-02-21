// Instance Card component with play/kill button and toast notifications

import ErrorIcon from "@assets/error.svg";
import FabricLogo from "@assets/fabric-logo.svg";
import ForgeLogo from "@assets/forge-logo.svg";
import NeoForgeLogo from "@assets/neoforge-logo.svg";
import PlayIcon from "@assets/play.svg";
import QuiltLogo from "@assets/quilt-logo.svg";
import RefreshIcon from "@assets/refresh.svg";
import KillIcon from "@assets/rounded-square.svg";
import CrashDetailsModal from "@components/modals/crash-details-modal";
import { router, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { ResourceAvatar } from "@ui/avatar";
import { Badge } from "@ui/badge";
import LauncherButton from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuGroupLabel,
	ContextMenuItem,
	ContextMenuItemLabel,
	ContextMenuLabel,
	ContextMenuPortal,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
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
} from "@utils/crash-handler";
import type { Instance } from "@utils/instances";
import {
	DEFAULT_ICONS,
	deleteInstance,
	duplicateInstance,
	getInstanceId,
	getInstanceSlug,
	installInstance,
	isInstanceRunning,
	killInstance,
	launchInstance,
	repairInstance,
	resetInstance,
	resumeInstanceOperation,
} from "@utils/instances";
import {
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
	handleLaunch,
	handleRepair,
	handleUninstall,
} from "../../../../handlers/instance-handler";
import styles from "./instance-card.module.css";

// getInstanceSlug now imported above

interface InstanceCardProps {
	instance: Instance;
}

export default function InstanceCard(props: InstanceCardProps) {
	const [_hover, setHover] = createSignal(false);
	const [leaveAnim, setLeaveAnim] = createSignal(false);
	const [runningIds, setRunningIds] = createSignal<Set<string>>(new Set());
	const [hasCrashed, setHasCrashed] = createSignal(false);
	const [showCrashModal, setShowCrashModal] = createSignal(false);
	const [showExportDialog, setShowExportDialog] = createSignal(false);

	const instanceSlug = getInstanceSlug(props.instance);

	onMount(() => {
		const unlisteners: (() => void)[] = [];

		const setup = async () => {
			// Check current running status on mount
			try {
				const isCurrentlyRunning = await isInstanceRunning(props.instance);
				if (isCurrentlyRunning) {
					setRunningIds((prev) => new Set(prev).add(instanceSlug));
				}
			} catch (error) {
				console.error("Failed to check instance running status:", error);
			}

			unlisteners.push(
				await listen("core://instance-launched", (event) => {
					const payload = (event as any).payload as {
						name: string;
						instance_id?: string;
						pid?: number;
					};
					const id =
						payload.instance_id ||
						getInstanceSlug({
							id: 0,
							name: payload.name,
							minecraftVersion: "",
							modloader: null,
							modloaderVersion: null,
							javaPath: null,
							javaArgs: null,
							gameDirectory: null,
							width: 0,
							height: 0,
							minMemory: 2048,
							maxMemory: 4096,
							iconPath: null,
							lastPlayed: null,
							totalPlaytimeMinutes: 0,
							createdAt: null,
							updatedAt: null,
							installationStatus: null,
							modpackId: null,
							modpackVersionId: null,
							modpackPlatform: null,
							modpackIconUrl: null,
							iconData: null,
						});
					setRunningIds((prev) => new Set(prev).add(id));
				}),
			);
			unlisteners.push(
				await listen("core://instance-killed", (event) => {
					const payload = (event as any).payload as {
						name: string;
						instance_id?: string;
					};
					const id =
						payload.instance_id ||
						getInstanceSlug({
							id: 0,
							name: payload.name,
							minecraftVersion: "",
							modloader: null,
							modloaderVersion: null,
							javaPath: null,
							javaArgs: null,
							gameDirectory: null,
							width: 0,
							height: 0,
							minMemory: 2048,
							maxMemory: 4096,
							iconPath: null,
							lastPlayed: null,
							totalPlaytimeMinutes: 0,
							createdAt: null,
							updatedAt: null,
							installationStatus: null,
							modpackId: null,
							modpackVersionId: null,
							modpackPlatform: null,
							modpackIconUrl: null,
							iconData: null,
						});
					setRunningIds((prev) => {
						const newSet = new Set(prev);
						newSet.delete(id);
						return newSet;
					});
				}),
			);
			// Listen for instance launched (notifies that process successfully started)
			unlisteners.push(
				await listen("core://instance-launched", (event) => {
					const payload = (event as any).payload as {
						instance_id?: string;
						pid?: number;
					};
					if (payload.instance_id === instanceSlug) {
						setLaunching(false);
						setRunningIds((prev) => {
							const newSet = new Set(prev);
							newSet.add(instanceSlug);
							return newSet;
						});
					}
				}),
			);
			// Also listen for natural process exit (when game closes normally)
			unlisteners.push(
				await listen("core://instance-exited", (event) => {
					const payload = (event as any).payload as {
						instance_id?: string;
						pid?: number;
						crashed?: boolean;
					};
					if (payload.instance_id) {
						if (payload.instance_id === instanceSlug) {
							setLaunching(false);
						}
						setRunningIds((prev) => {
							const newSet = new Set(prev);
							// biome-ignore lint/style/noNonNullAssertion: instance_id is checked above
							newSet.delete(payload.instance_id!);
							return newSet;
						});
					}
				}),
			);

			// Listen for crash events
			unlisteners.push(
				await listen("core://instance-crashed", (event) => {
					const payload = (event as any).payload as {
						instance_id?: string;
						crash_type: string;
						message: string;
						report_path?: string;
						timestamp: string;
					};
					if (payload.instance_id === instanceSlug) {
						setHasCrashed(true);
					}
				}),
			);
		};

		setup();

		onCleanup(() => {
			for (const unlisten of unlisteners) {
				unlisten();
			}
		});

		// Check for crash status
		setHasCrashed(isInstanceCrashed(instanceSlug));
	});

	const isRunning = () => runningIds().has(instanceSlug);

	// Installation status checks
	const isInstalling = () => props.instance.installationStatus === "installing";
	const isInterrupted = () =>
		props.instance.installationStatus === "interrupted";
	const isInstalled = () => props.instance.installationStatus === "installed";
	const isFailed = () =>
		props.instance.installationStatus === "failed" ||
		props.instance.installationStatus?.startsWith("failed:");

	const failureReason = () => {
		if (!isFailed()) return null;
		const status = props.instance.installationStatus;
		if (status?.includes(":")) {
			return status.split(":").slice(1).join(":");
		}
		return "Installation failed";
	};

	const needsInstallation = () =>
		!props.instance.installationStatus || isFailed();

	const [busy, setBusy] = createSignal(false);
	const [launching, setLaunching] = createSignal(false);

	// Can only launch if installed and not busy/installing/running
	const _canLaunch = () =>
		!busy() && !launching() && !isInstalling() && isInstalled() && !isRunning();

	const playButtonTooltip = () => {
		if (isInterrupted()) {
			const op =
				props.instance.lastOperation === "hard-reset"
					? "Hard reset"
					: props.instance.lastOperation || "Installation";
			return `${op} interrupted. Click to resume.`;
		}

		return needsInstallation()
			? "Needs Installation"
			: isRunning()
				? "Running (click to stop)"
				: launching()
					? "Launching..."
					: "Launch";
	};

	const toggleRun = async () => {
		if (busy() || launching()) return;

		if (isRunning()) {
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
			setLaunching(true);
			try {
				// Clear crash flag when attempting to launch
				clearCrashDetails(instanceSlug);
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
				setLaunching(false);
			}
			// Note: launching state is cleared when core://instance-launched or core://instance-exited occurs,
			// but we can also clear it if launchInstance returns (meaning it's 'started')
			// or if it fails immediately above.
			// Let's keep it until either event or if it takes too long.
		}
	};

	const handleClick = async (e: MouseEvent) => {
		e.stopPropagation();

		// Prevent double-actions
		if (busy() || launching()) return;

		// If currently installing, just notify user
		if (isInstalling()) {
			return;
		}

		// If needs installation or was interrupted, start/resume installer
		if (needsInstallation() || isInterrupted()) {
			setBusy(true);
			try {
				if (isInterrupted()) {
					// Use smart resume logic based on last known operation
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

		// Otherwise instance is installed — toggle run (launch or kill)
		await toggleRun();
	};

	// Handler for context menu toggle (play/stop)
	const handleContextToggle = () => {
		void toggleRun();
	};

	// Navigate to instance details page using mini-router
	const openInstanceDetails = () => {
		router()?.navigate("/instance", { slug: instanceSlug });
		setPageViewerOpen(true);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger
				as="div"
				class={`${styles["instance-card"]}${isFailed() ? ` ${styles.failed}` : ""}${isInterrupted() ? ` ${styles.interrupted}` : ""}${leaveAnim() ? ` ${styles["instance-card-leave"]}` : ""}`}
				onMouseOver={() => {
					setHover(true);
					setLeaveAnim(false);
				}}
				onMouseLeave={() => {
					setHover(false);
					setLeaveAnim(true);
					setTimeout(() => setLeaveAnim(false), 250);
				}}
				onClick={openInstanceDetails}
				style={
					(props.instance.iconPath || "").startsWith("linear-gradient")
						? {
								// biome-ignore lint/style/noNonNullAssertion: iconPath is confirmed to be a gradient string above
								background: props.instance.iconPath!,
							}
						: {
								"background-image": `url('${resolveResourceUrl(props.instance.iconPath || DEFAULT_ICONS[0])}')`,
							}
				}
				data-instance={instanceSlug}
			>
				<Switch>
					<Match when={isInstalling()}>
						<div class={styles["instance-card-centered"]}>
							<div class={styles["instance-card-spinner"]}></div>
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
						</div>
					</Match>
					<Match when={isFailed()}>
						<div
							class={`${styles["instance-card-centered"]} ${styles["failure-overlay"]}`}
						>
							<ErrorIcon
								style={{ width: "24px", height: "24px", color: "#ff5252" }}
							/>
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
									color: "rgba(255, 255, 255, 0.6)",
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
								<Show when={isRunning()}>
									<Badge variant="success" dot={true}>
										Running
									</Badge>
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
										class={`${styles["play-button"]} ${
											isInstalling() || launching()
												? styles["installing"]
												: isInterrupted()
													? styles["resume"]
													: needsInstallation()
														? styles["install"]
														: isRunning()
															? styles["kill"]
															: styles["launch"]
										}`}
										onClick={handleClick}
										disabled={isInstalling() || launching()}
									>
										{isInstalling() || launching() ? (
											<div class={styles["instance-card-spinner"]} />
										) : isInterrupted() ? (
											<RefreshIcon />
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
								<p>{props.instance.minecraftVersion}</p>
								<div class={styles["instance-card-bottom-version-modloader"]}>
									<Switch fallback="">
										<Match when={props.instance.modloader === "forge"}>
											<ForgeLogo />
										</Match>
										<Match when={props.instance.modloader === "neoforge"}>
											<NeoForgeLogo />
										</Match>
										<Match when={props.instance.modloader === "fabric"}>
											<FabricLogo />
										</Match>
										<Match when={props.instance.modloader === "quilt"}>
											<QuiltLogo />
										</Match>
										<Match
											when={
												props.instance.modloader &&
												props.instance.modloader !== "vanilla"
											}
										>
											<p style={{ "text-transform": "capitalize" }}>
												{props.instance.modloader}
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

					<ContextMenuItem onSelect={handleContextToggle}>
						<span
							style={{
								display: "inline-flex",
								"align-items": "center",
								gap: "0.5rem",
							}}
						>
							{isRunning() ? "Stop" : "Play"}
						</span>
						<ContextMenuShortcut>
							{isRunning() ? "Ctrl-K" : "Ctrl-P"}
						</ContextMenuShortcut>
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

					<ContextMenuItem onSelect={() => setShowExportDialog(true)}>
						Export Instance
					</ContextMenuItem>

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
					{/* Additional menu items can be added here */}
				</ContextMenuContent>
			</ContextMenuPortal>
			<CrashDetailsModal
				instanceId={instanceSlug}
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
