// Instance Card component with play/kill button and toast notifications

import ErrorIcon from "@assets/error.svg";
import FabricLogo from "@assets/fabric-logo.svg";
import ForgeLogo from "@assets/forge-logo.svg";
import NeoForgeLogo from "@assets/neoforge-logo.svg";
import PlayIcon from "@assets/play.svg";
import QuiltLogo from "@assets/quilt-logo.svg";
import KillIcon from "@assets/rounded-square.svg";
import CrashDetailsModal from "@components/modals/crash-details-modal";
import { router } from "@components/page-viewer/page-viewer";
import { setPageViewerOpen } from "@components/pages/home/home";
import { listen } from "@tauri-apps/api/event";
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
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	clearCrashDetails,
	getCrashDetails,
	isInstanceCrashed,
} from "@utils/crash-handler";
import type { Instance } from "@utils/instances";
import {
	DEFAULT_ICONS,
	deleteInstance,
	getInstanceId,
	getInstanceSlug,
	installInstance,
	isInstanceRunning,
	killInstance,
	launchInstance,
} from "@utils/instances";
import {
	createSignal,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import "./instance-card.css";

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
							minecraft_version: "",
							modloader: null,
							modloader_version: null,
							java_path: null,
							java_args: null,
							game_directory: null,
							width: 0,
							height: 0,
							memory_mb: 0,
							icon_path: null,
							last_played: null,
							total_playtime_minutes: 0,
							created_at: null,
							updated_at: null,
							installation_status: null,
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
							minecraft_version: "",
							modloader: null,
							modloader_version: null,
							java_path: null,
							java_args: null,
							game_directory: null,
							width: 0,
							height: 0,
							memory_mb: 0,
							icon_path: null,
							last_played: null,
							total_playtime_minutes: 0,
							created_at: null,
							updated_at: null,
							installation_status: null,
						});
					setRunningIds((prev) => {
						const newSet = new Set(prev);
						newSet.delete(id);
						return newSet;
					});
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
	const isInstalling = () =>
		props.instance.installation_status === "installing";
	const isInstalled = () => props.instance.installation_status === "installed";
	const isFailed = () => props.instance.installation_status === "failed";
	const needsInstallation = () =>
		!props.instance.installation_status ||
		props.instance.installation_status === "pending" ||
		props.instance.installation_status === "failed";

	const [busy, setBusy] = createSignal(false);

	// Can only launch if installed and not busy/installing/running
	const _canLaunch = () =>
		!busy() && !isInstalling() && isInstalled() && !isRunning();

	const playButtonTooltip = () =>
		needsInstallation()
			? "Needs Installation"
			: isRunning()
				? "Running (click to stop)"
				: "Launch";

	const toggleRun = async () => {
		if (busy()) return;
		setBusy(true);
		if (isRunning()) {
			try {
				await killInstance(props.instance);
				showToast({
					title: "Killed",
					description: `Killed instance \"${props.instance.name}\"`,
					severity: "Info",
					duration: 3000,
				});
			} catch (err) {
				console.error("Kill failed", err);
				showToast({
					title: "Kill Failed",
					description: String(err),
					severity: "Error",
					duration: 5000,
				});
			}
		} else {
			try {
				// Clear crash flag when attempting to launch
				clearCrashDetails(instanceSlug);
				setHasCrashed(false);

				await launchInstance(props.instance);
				showToast({
					title: "Launching",
					description: `Launching instance \"${props.instance.name}\"`,
					severity: "Info",
					duration: 3000,
				});
			} catch (err) {
				console.error("Launch failed", err);
				showToast({
					title: "Launch Failed",
					description: String(err),
					severity: "Error",
					duration: 5000,
				});
			}
		}
		setBusy(false);
	};

	const handleClick = async (e: MouseEvent) => {
		e.stopPropagation();

		// Prevent double-actions
		if (busy()) return;

		// If currently installing, just notify user
		if (isInstalling()) {
			return;
		}

		// If needs installation, start installer
		if (needsInstallation()) {
			setBusy(true);
			try {
				await installInstance(props.instance);
			} catch (err) {
				console.error("Install failed", err);
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

	// Handler for context-menu Reinstall action
	const handleReinstall = async () => {
		if (busy()) return;
		const confirmReinstall = window.confirm(
			`Reinstall instance \"${props.instance.name}\"? This will re-run the installer.`,
		);
		if (!confirmReinstall) return;
		setBusy(true);
		try {
			await installInstance(props.instance);
			showToast({
				title: "Reinstall started",
				description: `Reinstalling \"${props.instance.name}\"`,
				severity: "Info",
				duration: 3000,
			});
		} catch (err) {
			console.error("Reinstall failed", err);
			showToast({
				title: "Reinstall failed",
				description: String(err),
				severity: "Error",
				duration: 5000,
			});
		}
		setBusy(false);
	};

	console.log("eee Path: ", props.instance.icon_path);

	return (
		<ContextMenu>
			<ContextMenuTrigger
				as="div"
				class={`instance-card${isFailed() ? " failed" : ""}${leaveAnim() ? " instance-card-leave" : ""}`}
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
					(props.instance.icon_path || "").startsWith("linear-gradient")
						? {
								// biome-ignore lint/style/noNonNullAssertion: icon_path is confirmed to be a gradient string above
								background: props.instance.icon_path!,
							}
						: {
								"background-image": `url('${props.instance.icon_path || DEFAULT_ICONS[0]}')`,
							}
				}
				data-instance={instanceSlug}
			>
				<Switch>
					<Match when={isInstalling()}>
						<div class="instance-card-centered">
							<div class="instance-card-spinner"></div>
							<h1
								style={{
									margin: 0,
									padding: 0,
									"line-height": "16px",
									"font-weight": "bold",
								}}
							>
								{props.instance.name}
							</h1>
						</div>
					</Match>
					<Match when={isFailed()}>
						<div class="instance-card-centered">
							<ErrorIcon style={{ width: "24px", height: "24px" }} />
							<h1
								style={{
									margin: 0,
									padding: 0,
									"line-height": "16px",
									"font-weight": "bold",
								}}
							>
								{props.instance.name}
							</h1>
						</div>
					</Match>
					<Match when={true}>
						<div class="instance-card-top">
							<div class="instance-card-indicators">
								<Show when={isRunning()}>
									<span class="running">
										<div class="status-dot" />
										Running
									</span>
								</Show>
								<Show when={hasCrashed()}>
									<Tooltip placement="top">
										<TooltipTrigger>
											<span
												class="crashed"
												onClick={(e) => {
													e.stopPropagation();
													setShowCrashModal(true);
												}}
												style={{ cursor: "pointer" }}
											>
												<div class="status-dot" />
												Crashed
											</span>
										</TooltipTrigger>
										<TooltipContent>Click to view crash details</TooltipContent>
									</Tooltip>
								</Show>
							</div>
							<Tooltip placement="top">
								<TooltipTrigger>
									<button
										class={`play-button ${
											needsInstallation()
												? "install"
												: isRunning()
													? "kill"
													: "launch"
										}`}
										onClick={handleClick}
										disabled={isInstalling()}
									>
										{needsInstallation() ? (
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
						<div class="instance-card-bottom">
							<h1>{props.instance.name}</h1>
							<div class="instance-card-bottom-version">
								<p>{props.instance.minecraft_version}</p>
								<div class="instance-card-bottom-version-modloader">
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
							void handleReinstall();
						}}
					>
						Reinstall
						<ContextMenuShortcut>Ctrl-R</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem
						onSelect={async () => {
							// confirm uninstall: this removes the instance entry (does not clear shared game files)
							const confirmUninstall = window.confirm(
								`Uninstall instance \"${props.instance.name}\"? This will remove the instance but not shared game assets.`,
							);
							if (!confirmUninstall) return;
							setBusy(true);
							try {
								const idNum = getInstanceId(props.instance);
								if (idNum === null) {
									throw new Error("Invalid instance id");
								}
								await deleteInstance(idNum);
								showToast({
									title: "Uninstalled",
									description: `Instance \"${props.instance.name}\" removed`,
									severity: "Info",
									duration: 3000,
								});
							} catch (err) {
								console.error("Uninstall failed", err);
								showToast({
									title: "Uninstall failed",
									description: String(err),
									severity: "Error",
									duration: 5000,
								});
							}
							setBusy(false);
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
		</ContextMenu>
	);
}
