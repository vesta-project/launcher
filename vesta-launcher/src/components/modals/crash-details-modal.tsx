import LauncherButton from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import { getCrashDetails } from "@utils/crash-handler";
import { createSignal, Match, Show, Switch } from "solid-js";
import "./crash-details-modal.css";

interface CrashDetailsModalProps {
	instanceId: string;
	isOpen: boolean;
	onClose: () => void;
}

export default function CrashDetailsModal(props: CrashDetailsModalProps) {
	const crashDetails = () => getCrashDetails(props.instanceId);

	const _getCrashTypeIcon = (crashType: string) => {
		switch (crashType) {
			case "runtime":
				return "⚠️";
			case "launch_mod":
				return "📦";
			case "launch_other":
				return "🚫";
			case "jvm":
				return "☕";
			default:
				return "❌";
		}
	};

	const _getCrashTypeLabel = (crashType: string) => {
		switch (crashType) {
			case "runtime":
				return "Runtime Crash";
			case "launch_mod":
				return "Mod Incompatibility";
			case "launch_other":
				return "Launch Failed";
			case "jvm":
				return "Java Virtual Machine Crash";
			default:
				return "Unknown Crash";
		}
	};

	const getCrashTypeDescription = (crashType: string) => {
		switch (crashType) {
			case "runtime":
				return "The game crashed while running. This is usually caused by a mod conflict or unsupported game configuration.";
			case "launch_mod":
				return "One or more mods are incompatible with this version or with each other. Check your mods and try removing recently added ones.";
			case "launch_other":
				return "The game failed to launch. Check your Java installation and game settings.";
			case "jvm":
				return "The Java Virtual Machine crashed. This may indicate a serious compatibility issue or memory problem.";
			default:
				return "An unknown error occurred while running the instance.";
		}
	};

	const openCrashReport = () => {
		const report = crashDetails();
		if (report?.report_path) {
			// TODO: integrate tauri open once available; temporary log
			console.log("Crash report location:", report.report_path);
		}
	};

	return (
		<Dialog open={props.isOpen} onOpenChange={props.onClose}>
			<DialogContent class="crash-details-modal">
				<DialogHeader>
					<DialogTitle class="crash-title">
						<span class="crash-icon">
							<Switch fallback={<span>❌</span>}>
								<Match when={crashDetails()?.crash_type === "runtime"}>
									<span>⚠️</span>
								</Match>
								<Match when={crashDetails()?.crash_type === "launch_mod"}>
									<span>📦</span>
								</Match>
								<Match when={crashDetails()?.crash_type === "launch_other"}>
									<span>🚫</span>
								</Match>
								<Match when={crashDetails()?.crash_type === "jvm"}>
									<span>☕</span>
								</Match>
							</Switch>
						</span>
						Instance Crashed
					</DialogTitle>
					<DialogDescription>
						<Switch fallback={<span>Unknown crash</span>}>
							<Match when={crashDetails()?.crash_type === "runtime"}>
								<span>Runtime Crash</span>
							</Match>
							<Match when={crashDetails()?.crash_type === "launch_mod"}>
								<span>Mod Incompatibility</span>
							</Match>
							<Match when={crashDetails()?.crash_type === "launch_other"}>
								<span>Launch Failed</span>
							</Match>
							<Match when={crashDetails()?.crash_type === "jvm"}>
								<span>Java Virtual Machine Crash</span>
							</Match>
						</Switch>
					</DialogDescription>
				</DialogHeader>

				<Show when={crashDetails()}>
					{(details) => (
						<div class="crash-details-content">
							<div class="crash-description">
								<p>{getCrashTypeDescription(details().crash_type)}</p>
							</div>

							<div class="crash-info">
								<div class="info-section">
									<h3>Error Message</h3>
									<div class="error-message">
										{details().message || "No error message available"}
									</div>
								</div>

								<div class="info-section">
									<h3>Timestamp</h3>
									<p class="timestamp">
										{new Date(details().timestamp).toLocaleString()}
									</p>
								</div>

								<Show when={details().report_path}>
									<div class="info-section">
										<h3>Crash Report</h3>
										<p class="report-path">{details().report_path}</p>
										<LauncherButton
											onClick={openCrashReport}
											variant="outline"
											size="sm"
										>
											View Report
										</LauncherButton>
									</div>
								</Show>
							</div>

							<div class="crash-actions">
								<p class="action-hint">Try these steps to fix the crash:</p>
								<ul>
									<Switch>
										<Match when={crashDetails()?.crash_type === "launch_mod"}>
											<li>Remove recently added mods</li>
											<li>Update all mods to compatible versions</li>
											<li>Check mod dependencies and conflicts</li>
										</Match>
										<Match when={crashDetails()?.crash_type === "runtime"}>
											<li>Update your graphics drivers</li>
											<li>Increase allocated RAM in instance settings</li>
											<li>Remove conflicting mods</li>
										</Match>
										<Match when={crashDetails()?.crash_type === "jvm"}>
											<li>Update Java to latest version</li>
											<li>Increase allocated memory (Xmx flag)</li>
											<li>Try a different Java version (Java 8, 11, 17, 21)</li>
										</Match>
									</Switch>
								</ul>
							</div>
						</div>
					)}
				</Show>

				<div class="crash-buttons">
					<LauncherButton onClick={props.onClose} variant="outline">
						Close
					</LauncherButton>
				</div>
			</DialogContent>
		</Dialog>
	);
}
