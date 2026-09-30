import LauncherButton from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import { Separator } from "@ui/separator/separator";
import { getCrashDetails } from "@utils/crash-handler";
import { createSignal, Match, Show, Switch } from "solid-js";
import styles from "./crash-details-modal.module.css";
import { t } from "~/localization";

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
				return t("shared-ui-runtime-crash");
			case "launch_mod":
				return t("shared-ui-mod-incompatibility");
			case "launch_other":
				return t("shared-ui-launch-failed");
			case "jvm":
				return t("shared-ui-java-virtual-machine-crash");
			default:
				return t("shared-ui-unknown-crash");
		}
	};

	const getCrashTypeDescription = (crashType: string) => {
		switch (crashType) {
			case "runtime":
				return t("shared-ui-runtime-crash-description");
			case "launch_mod":
				return t("shared-ui-mod-incompatibility-description");
			case "launch_other":
				return t("shared-ui-launch-failed-description");
			case "jvm":
				return t("shared-ui-java-crash-description");
			default:
				return t("shared-ui-unknown-crash-description");
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
			<DialogContent class={styles["crash-details-modal"]}>
				<DialogHeader>
					<DialogTitle class={styles["crash-title"]}>
						<span class={styles["crash-icon"]}>
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
						{t("shared-ui-instance-crashed")}
					</DialogTitle>
					<DialogDescription>
						<Switch fallback={<span>{t("shared-ui-unknown-crash")}</span>}>
							<Match when={crashDetails()?.crash_type === "runtime"}>
								<span>{t("shared-ui-runtime-crash")}</span>
							</Match>
							<Match when={crashDetails()?.crash_type === "launch_mod"}>
								<span>{t("shared-ui-mod-incompatibility")}</span>
							</Match>
							<Match when={crashDetails()?.crash_type === "launch_other"}>
								<span>{t("shared-ui-launch-failed")}</span>
							</Match>
							<Match when={crashDetails()?.crash_type === "jvm"}>
								<span>{t("shared-ui-java-virtual-machine-crash")}</span>
							</Match>
						</Switch>
					</DialogDescription>
				</DialogHeader>

				<Show when={crashDetails()}>
					{(details) => (
						<div class={styles["crash-details-content"]}>
							<div class={styles["crash-description"]}>
								<p>{getCrashTypeDescription(details().crash_type)}</p>
							</div>

							<div class={styles["crash-info"]}>
								<div class={styles["info-section"]}>
									<h3>{t("shared-ui-error-message")}</h3>
									<div class={styles["error-message"]}>
										{details().message || t("shared-ui-no-error-message-available")}
									</div>
								</div>

								<div class={styles["info-section"]}>
									<h3>{t("shared-ui-timestamp")}</h3>
									<p class={styles["timestamp"]}>
										{new Date(details().timestamp).toLocaleString()}
									</p>
								</div>

								<Show when={details().report_path}>
									<div class={styles["info-section"]}>
										<h3>{t("shared-ui-crash-report")}</h3>
										<p class={styles["report-path"]}>{details().report_path}</p>
										<LauncherButton
											onClick={openCrashReport}
											variant="outline"
											size="sm"
										>
											{t("shared-ui-view-report")}
										</LauncherButton>
									</div>
								</Show>
							</div>

							<div class={styles["crash-actions"]}>
								<p class={styles["action-hint"]}>
									{t("shared-ui-crash-fix-steps")}
								</p>
								<ul>
									<Switch>
										<Match when={crashDetails()?.crash_type === "launch_mod"}>
											<li>{t("shared-ui-remove-recently-added-mods")}</li>
											<li>{t("shared-ui-update-mods-compatible-versions")}</li>
											<li>{t("shared-ui-check-mod-dependencies-conflicts")}</li>
										</Match>
										<Match when={crashDetails()?.crash_type === "runtime"}>
											<li>{t("shared-ui-update-graphics-drivers")}</li>
											<li>{t("shared-ui-increase-allocated-ram")}</li>
											<li>{t("shared-ui-remove-conflicting-mods")}</li>
										</Match>
										<Match when={crashDetails()?.crash_type === "jvm"}>
											<li>{t("shared-ui-update-java-latest")}</li>
											<li>{t("shared-ui-increase-allocated-memory-xmx")}</li>
											<li>{t("shared-ui-try-different-java-version")}</li>
										</Match>
									</Switch>
								</ul>
							</div>
						</div>
					)}
				</Show>

				<Separator />

				<div class={styles["crash-buttons"]}>
					<LauncherButton onClick={props.onClose} variant="outline">
						Close
					</LauncherButton>
				</div>
			</DialogContent>
		</Dialog>
	);
}
