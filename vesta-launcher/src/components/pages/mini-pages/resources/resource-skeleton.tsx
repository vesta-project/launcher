import { Skeleton } from "@ui/skeleton/skeleton";
import { For, Show } from "solid-js";
import styles from "./resource-browser.module.css";

export function ResourceSkeletonGrid(props: {
	count: number;
	viewMode: "grid" | "list";
}) {
	return (
		<div
			class={
				props.viewMode === "grid"
					? styles["resource-grid"]
					: styles["resource-list"]
			}
		>
			<For each={Array.from({ length: props.count })}>
				{() => (
					<div
						class={`${styles["resource-card"]} ${styles["theme-card"]} ${styles[props.viewMode]} ${styles["skeleton-card"]}`}
					>
						<Show when={props.viewMode === "grid"}>
							<div class={styles["card-content"]}>
								<div class={styles["card-row-1"]}>
									<Skeleton class={styles["skeleton-icon"]} />
									<div class={styles["card-title-area"]}>
										<Skeleton class={styles["skeleton-title"]} />
										<Skeleton class={styles["skeleton-author"]} />
										<Skeleton class={styles["skeleton-stat"]} />
									</div>
								</div>
								<Skeleton class={styles["skeleton-summary"]} />
								<div class={styles["card-row-3"]}>
									<div class={styles["card-tags"]}>
										<For each={[1, 2, 3, 4]}>
											{() => <Skeleton class={styles["skeleton-tag"]} />}
										</For>
									</div>
									<Skeleton class={styles["skeleton-button"]} />
								</div>
							</div>
						</Show>
						<Show when={props.viewMode === "list"}>
							<div class={styles["card-list-thumb"]}>
								<Skeleton class={styles["skeleton-icon"]} />
							</div>
							<div class={styles["card-list-body"]}>
								<div class={styles["card-list-header"]}>
									<div class={styles["card-list-header-left"]}>
										<Skeleton class={styles["skeleton-list-line"]} />
									</div>
								</div>
								<Skeleton class={styles["skeleton-summary"]} />
								<div class={styles["card-list-tags"]}>
									<For each={[1, 2, 3]}>
										{() => <Skeleton class={styles["skeleton-tag"]} />}
									</For>
								</div>
							</div>
						</Show>
					</div>
				)}
			</For>
		</div>
	);
}
