import ChipIcon from "@assets/chip.svg";
import CubeIcon from "@assets/cube.svg";
import GearIcon from "@assets/gear.svg";
import TimerIcon from "@assets/timer.svg";
import { formatDate } from "@utils/date";
import styles from "../instance-details.module.css";

interface HomeTabProps {
	instance: any;
	installedResources: any[];
}

export const HomeTab = (props: HomeTabProps) => {
	const inst = () => props.instance;

	return (
		<section class={styles["tab-home"]}>
			{/* Quick Stats Grid */}
			<div class={styles["stats-grid"]}>
				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<TimerIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["home-stat-value"]}>
							{Math.floor((inst().totalPlaytimeMinutes ?? 0) / 60)}h{" "}
							{(inst().totalPlaytimeMinutes ?? 0) % 60}m
						</div>
						<div class={styles["home-stat-label"]}>Playtime</div>
					</div>
				</div>

				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<CubeIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["home-stat-value"]}>
							{(props.installedResources || []).length}
						</div>
						<div class={styles["home-stat-label"]}>Resources</div>
					</div>
				</div>

				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<ChipIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["home-stat-value"]}>
							{inst().minMemory}/{inst().maxMemory}
						</div>
						<div class={styles["home-stat-label"]}>Memory (MB)</div>
					</div>
				</div>

				<div class={styles["stat-card"]}>
					<div class={styles["stat-icon"]}>
						<GearIcon />
					</div>
					<div class={styles["stat-content"]}>
						<div class={styles["home-stat-value"]}>
							{inst().installationStatus || "Unknown"}
						</div>
						<div class={styles["home-stat-label"]}>Status</div>
					</div>
				</div>
			</div>

			<div class={styles["details-section"]}>
				<h3 class={styles["section-title"]}>Instance Details</h3>
				<div class={styles["details-list"]}>
					<div class={styles["details-row"]}>
						<span class={styles["details-key"]}>Last Played</span>
						<span class={styles["details-value"]}>
							{inst().lastPlayed
								? formatDate(inst().lastPlayed as string)
								: "Never"}
						</span>
					</div>
					<div class={styles["details-row"]}>
						<span class={styles["details-key"]}>Created</span>
						<span class={styles["details-value"]}>
							{inst().createdAt
								? formatDate(inst().createdAt as string)
								: "Unknown"}
						</span>
					</div>
					<div class={styles["details-row"]}>
						<span class={styles["details-key"]}>Updated</span>
						<span class={styles["details-value"]}>
							{inst().updatedAt
								? formatDate(inst().updatedAt as string)
								: "Unknown"}
						</span>
					</div>
					<div class={styles["details-row"]}>
						<span class={styles["details-key"]}>Runtime</span>
						<span class={styles["details-value"]}>
							{inst().isRunning ? "Running" : "Stopped"}
						</span>
					</div>
				</div>
			</div>
		</section>
	);
};
