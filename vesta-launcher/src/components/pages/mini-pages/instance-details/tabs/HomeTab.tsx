import { Show, createMemo } from "solid-js";
import { formatDate } from "@utils/date";
import styles from "../instance-details.module.css";
import TimerIcon from "@assets/timer.svg";
import CubeIcon from "@assets/cube.svg";
import ChipIcon from "@assets/chip.svg";

interface HomeTabProps {
	instance: any;
	installedResources: any[];
}

export const HomeTab = (props: HomeTabProps) => {
	const inst = () => props.instance;

	const getOperationInfo = (op: string) => {
		switch (op) {
			case "install":
				return { title: "Installed", desc: "Initial instance setup", icon: "✦" };
			case "update":
				return { title: "Updated", desc: "Updated to a newer version", icon: "↺" };
			case "repair":
				return { title: "Repaired", desc: "Checked and fixed files", icon: "⚙" };
			case "hard-reset":
				return { title: "Reset", desc: "Wiped and reinstalled", icon: "⚠" };
			case "import":
				return { title: "Imported", desc: "Imported from external source", icon: "📥" };
			case "duplicate":
				return { title: "Duplicated", desc: "Created from another instance", icon: "⎘" };
			default:
				return {
					title: op.charAt(0).toUpperCase() + op.slice(1).replaceAll("-", " "),
					desc: "Recorded lifecycle operation",
					icon: "◇",
				};
		}
	};

	return (
		<section class={styles["tab-home"]}>
			{/* Quick Stats Grid */}
			<div class={styles["stats-grid"]}>
				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<TimerIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["stat-value"]}>
							{Math.floor((inst().totalPlaytimeMinutes ?? 0) / 60)}h{" "}
							{(inst().totalPlaytimeMinutes ?? 0) % 60}m
						</div>
						<div class={styles["stat-label"]}>Playtime</div>
					</div>
				</div>

				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<CubeIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["stat-value"]}>
							{(props.installedResources || []).length}
						</div>
						<div class={styles["stat-label"]}>Resources</div>
					</div>
				</div>

				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<ChipIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["stat-value"]}>
							{inst().minMemory}/{inst().maxMemory}
						</div>
						<div class={styles["stat-label"]}>Memory (MB)</div>
					</div>
				</div>

				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<Show when={inst().installationStatus === "installed"}>
							<span style="color: var(--success)">◆</span>
						</Show>
						<Show when={inst().installationStatus === "interrupted"}>
							<span style="color: var(--error)">▲</span>
						</Show>
						<Show when={inst().installationStatus === "installing"}>
							<span style="color: var(--accent)" class={styles["pulse"]}>◇</span>
						</Show>
						<Show when={!["installed", "interrupted", "installing"].includes(inst().installationStatus)}>
							<span>◈</span>
						</Show>
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["stat-value"]}>
							{inst().installationStatus || "Unknown"}
						</div>
						<div class={styles["stat-label"]}>Status</div>
					</div>
				</div>
			</div>

			{/* Recent Activity */}
			<div class={styles["activity-list"]}>
				<div class={styles["activity-item"]}>
					<div class={styles["activity-icon"]}>◈</div>
					<div class={styles["activity-content"]}>
						<div class={styles["activity-primary"]}>
							Last played{" "}
							{inst().lastPlayed
								? formatDate(inst().lastPlayed as string)
								: "Never"}
						</div>
						<div class={styles["activity-secondary"]}>
							{inst().isRunning ? "Currently running" : "Ready to launch"}
						</div>
					</div>
				</div>

				<Show
					when={inst().lastOperation}
					fallback={
						<div class={styles["activity-item"]}>
							<div class={styles["activity-icon"]}>✧</div>
							<div class={styles["activity-content"]}>
								<div class={styles["activity-primary"]}>
									Created{" "}
									{inst().createdAt
										? formatDate(inst().createdAt as string)
										: "Unknown"}
								</div>
								<div class={styles["activity-secondary"]}>
									Instance creation event
								</div>
							</div>
						</div>
					}
				>
					{(op) => {
						const info = getOperationInfo(op());
						return (
							<div class={styles["activity-item"]}>
								<div class={styles["activity-icon"]}>{info.icon}</div>
								<div class={styles["activity-content"]}>
									<div class={styles["activity-primary"]}>
										{info.title}{" "}
										{inst().updatedAt
											? formatDate(inst().updatedAt as string)
											: inst().createdAt
												? formatDate(inst().createdAt as string)
												: "Unknown"}
									</div>
									<div class={styles["activity-secondary"]}>{info.desc}</div>
								</div>
							</div>
						);
					}}
				</Show>
			</div>
		</section>
	);
};
