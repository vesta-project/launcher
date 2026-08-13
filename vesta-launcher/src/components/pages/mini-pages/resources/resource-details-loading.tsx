import { For } from "solid-js";
import styles from "./resource-details.module.css";

const SkeletonLine = (props: { class?: string }) => (
	<div class={`${styles["focus-skeleton"]} ${props.class || ""}`} />
);

export const ResourceDescriptionLoading = () => (
	<div
		class={styles["resource-description-loading"]}
		aria-busy="true"
		aria-label="Loading resource description"
	>
		<SkeletonLine class={styles["resource-skeleton-title"]} />
		<SkeletonLine class={styles["resource-skeleton-lead"]} />
		<div class={styles["resource-skeleton-paragraph"]}>
			<SkeletonLine />
			<SkeletonLine />
			<SkeletonLine class={styles["resource-skeleton-line-short"]} />
		</div>
		<div class={styles["resource-skeleton-paragraph"]}>
			<SkeletonLine />
			<SkeletonLine class={styles["resource-skeleton-line-medium"]} />
		</div>
	</div>
);

export const ResourceVersionsLoading = () => (
	<div
		class={styles["resource-versions-loading"]}
		aria-busy="true"
		aria-label="Loading resource versions"
	>
		<For each={[0, 1, 2, 3, 4]}>
			{() => (
				<div class={styles["resource-version-loading-row"]} aria-hidden="true">
					<div class={styles["focus-skeleton-stack"]}>
						<SkeletonLine class={styles["resource-skeleton-version-name"]} />
						<SkeletonLine class={styles["resource-skeleton-version-file"]} />
					</div>
					<SkeletonLine class={styles["resource-skeleton-version-target"]} />
					<SkeletonLine class={styles["resource-skeleton-version-action"]} />
				</div>
			)}
		</For>
	</div>
);

export const ResourceDetailsSidebarLoading = () => (
	<div
		class={`${styles["sidebar-scrollable-area"]} ${styles["resource-sidebar-loading"]}`}
		aria-busy="true"
		aria-label="Loading resource installation details"
	>
		<section class={styles["resource-sidebar-loading-section"]}>
			<SkeletonLine class={styles["resource-skeleton-sidebar-heading"]} />
			<SkeletonLine class={styles["resource-skeleton-sidebar-control"]} />
			<SkeletonLine class={styles["resource-skeleton-sidebar-control"]} />
		</section>
		<For each={[0, 1, 2]}>
			{() => (
				<section class={styles["resource-sidebar-loading-section"]}>
					<SkeletonLine class={styles["resource-skeleton-sidebar-heading"]} />
					<div class={styles["focus-skeleton-stack"]}>
						<SkeletonLine />
						<SkeletonLine class={styles["resource-skeleton-line-medium"]} />
					</div>
				</section>
			)}
		</For>
	</div>
);
