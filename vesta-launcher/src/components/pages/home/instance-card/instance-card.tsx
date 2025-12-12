// Instance Card component with play/kill button and toast notifications
import FabricLogo from "@assets/fabric-logo.svg";
import ForgeLogo from "@assets/forge-logo.svg";
import NeoForgeLogo from "@assets/neoforge-logo.svg";
import PlayIcon from "@assets/play.svg";
import KillIcon from "@assets/rounded-square.svg";
import QuiltLogo from "@assets/quilt-logo.svg";
import ErrorIcon from "@assets/error.svg";
import LauncherButton from "@ui/button/button";
import { router } from "@components/page-viewer/page-viewer";
import { setPageViewerOpen } from "@components/pages/home/home";
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
import { createSignal, onCleanup, onMount, Show, Switch, Match } from "solid-js";
import type { Instance } from "@utils/instances";
import { launchInstance, killInstance, installInstance, deleteInstance, getInstanceId, isInstanceRunning, getInstanceSlug } from "@utils/instances";
import { listen } from "@tauri-apps/api/event";
import { showToast } from "@ui/toast/toast";
import "./instance-card.css";

// getInstanceSlug now imported above

interface InstanceCardProps {
	instance: Instance;
}

export default function InstanceCard(props: InstanceCardProps) {
	const [hover, setHover] = createSignal(false);
	const [runningIds, setRunningIds] = createSignal<Set<string>>(new Set());

	// Listen for launch/kill events from the backend
	onMount(async () => {
		// Query actual running state from backend on mount
		try {
			const running = await isInstanceRunning(props.instance);
			if (running) {
				setRunningIds((prev) => new Set(prev).add(instanceSlug));
			}
		} catch (err) {
			console.error("Failed to query instance running state:", err);
		}

		const unlistenLaunch = await listen("core://instance-launched", (event) => {
			const payload = (event as any).payload as { name: string; instance_id?: string; pid?: number };
			const id = payload.instance_id || getInstanceSlug({ id: { INIT: null }, name: payload.name, minecraft_version: "", modloader: null, modloader_version: null, java_path: null, java_args: null, game_directory: null, width: 0, height: 0, memory_mb: 0, icon_path: null, last_played: null, total_playtime_minutes: 0, created_at: null, updated_at: null, installation_status: null });
			setRunningIds((prev) => new Set(prev).add(id));
		});
		const unlistenKill = await listen("core://instance-killed", (event) => {
			const payload = (event as any).payload as { name: string; instance_id?: string };
			const id = payload.instance_id || getInstanceSlug({ id: { INIT: null }, name: payload.name, minecraft_version: "", modloader: null, modloader_version: null, java_path: null, java_args: null, game_directory: null, width: 0, height: 0, memory_mb: 0, icon_path: null, last_played: null, total_playtime_minutes: 0, created_at: null, updated_at: null, installation_status: null });
			setRunningIds((prev) => {
				const newSet = new Set(prev);
				newSet.delete(id);
				return newSet;
			});
		});
		onCleanup(() => {
			// unlistenLaunch/unlistenKill are actual functions returned by listen (we awaited them above)
			unlistenLaunch();
			unlistenKill();
		});
	});

	const instanceSlug = getInstanceSlug(props.instance);
	const isRunning = () => runningIds().has(instanceSlug);

	// Installation status checks
	const isInstalling = () => props.instance.installation_status === "installing";
	const isInstalled = () => props.instance.installation_status === "installed";
	const isFailed = () => props.instance.installation_status === "failed";
	const needsInstallation = () => !props.instance.installation_status ||
		props.instance.installation_status === "pending" ||
		props.instance.installation_status === "failed";

	const [busy, setBusy] = createSignal(false);

	// Can only launch if installed and not busy/installing/running
	const canLaunch = () => !busy() && !isInstalling() && isInstalled() && !isRunning();

	const toggleRun = async () => {
		if (busy()) return;
		setBusy(true);
		if (isRunning()) {
			try {
				await killInstance(props.instance);
				showToast({ title: "Killed", description: `Killed instance \"${props.instance.name}\"`, severity: "Info", duration: 3000 });
			} catch (err) {
				console.error("Kill failed", err);
				showToast({ title: "Kill Failed", description: String(err), severity: "Error", duration: 5000 });
			}
		} else {
			try {
				await launchInstance(props.instance);
				showToast({ title: "Launching", description: `Launching instance \"${props.instance.name}\"`, severity: "Info", duration: 3000 });
			} catch (err) {
				console.error("Launch failed", err);
				showToast({ title: "Launch Failed", description: String(err), severity: "Error", duration: 5000 });
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
		const confirmReinstall = window.confirm(`Reinstall instance \"${props.instance.name}\"? This will re-run the installer.`);
		if (!confirmReinstall) return;
		setBusy(true);
		try {
			await installInstance(props.instance);
			showToast({ title: 'Reinstall started', description: `Reinstalling \"${props.instance.name}\"`, severity: 'Info', duration: 3000 });
		} catch (err) {
			console.error('Reinstall failed', err);
			showToast({ title: 'Reinstall failed', description: String(err), severity: 'Error', duration: 5000 });
		}
		setBusy(false);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger 
				as="div" 
				class="instance-card" 
				onMouseOver={() => setHover(true)} 
				onMouseLeave={() => setHover(false)}
				onClick={openInstanceDetails}
				style={props.instance.icon_path ? { "--instance-bg-image": `url('${props.instance.icon_path}')` } : undefined}
			>
				<div class="instance-card-top">
					<Show when={hover()} fallback="">
						<button
							class="play-button"
							onClick={handleClick}
							disabled={(isInstalling())}
							title={
								isInstalling() ? "Installing..." :
									needsInstallation() ? "Needs Installation" :
										isRunning() ? "Running (click to stop)" :
											"Launch"
							}
						>
							{isInstalling() ? "⏳" : needsInstallation() ? <ErrorIcon /> : isRunning() ? <KillIcon /> : <PlayIcon />}
						</button>
					</Show>
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
								<Match when={props.instance.modloader && props.instance.modloader !== "vanilla"}>
									<p style={{ "text-transform": "capitalize" }}>{props.instance.modloader}</p>
								</Match>
							</Switch>
						</div>
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuPortal>
				<ContextMenuContent>
					<ContextMenuLabel>Actions</ContextMenuLabel>
					<ContextMenuSeparator />


					<ContextMenuItem onSelect={handleContextToggle}>
						<span style={{ display: 'inline-flex', 'align-items': 'center', gap: '0.5rem' }}>
							{isRunning() ? 'Stop' : 'Play'}
						</span>
						<ContextMenuShortcut>{isRunning() ? 'Ctrl-K' : 'Ctrl-P'}</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem onSelect={() => { void handleReinstall(); }}>
						Reinstall
						<ContextMenuShortcut>Ctrl-R</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem onSelect={async () => {
						// confirm uninstall: this removes the instance entry (does not clear shared game files)
						const confirmUninstall = window.confirm(`Uninstall instance \"${props.instance.name}\"? This will remove the instance but not shared game assets.`);
						if (!confirmUninstall) return;
						setBusy(true);
						try {
							const idNum = getInstanceId(props.instance);
							if (idNum === null) {
								throw new Error("Invalid instance id");
							}
							await deleteInstance(idNum);
							showToast({ title: 'Uninstalled', description: `Instance \"${props.instance.name}\" removed`, severity: 'Info', duration: 3000 });
						} catch (err) {
							console.error('Uninstall failed', err);
							showToast({ title: 'Uninstall failed', description: String(err), severity: 'Error', duration: 5000 });
						}
						setBusy(false);
					}}>
						Uninstall
						<ContextMenuShortcut>Ctrl-U</ContextMenuShortcut>
					</ContextMenuItem>

					<ContextMenuItem>Profile <ContextMenuShortcut>Ctrl-C</ContextMenuShortcut></ContextMenuItem>
					{/* Additional menu items can be added here */}
				</ContextMenuContent>
			</ContextMenuPortal>
		</ContextMenu>
	);
}
