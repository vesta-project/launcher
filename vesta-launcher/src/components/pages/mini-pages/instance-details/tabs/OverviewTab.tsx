import CubeIcon from "@assets/cube.svg";
import Button from "@ui/button/button";
import { Show, Suspense } from "solid-js";
import styles from "../instance-details.module.css";
import { summarizeResources } from "../instance-details-view";
import { ScreenshotGallery } from "./ScreenshotGallery";

interface OverviewTabProps {
	instance: any;
	instanceSlug: string;
	installedResources: any[];
	knownUpdateCount?: number;
	onManageResources: () => void;
	onAddResources: () => void;
}

export const OverviewTab = (props: OverviewTabProps) => {
	return (
		<section class={styles["tab-overview"]}>
			<div class={styles["overview-resource-rail"]}>
				<div class={styles["overview-resource-copy"]}>
					<CubeIcon />
					<div>
						<h2>Resources</h2>
						<p>
							{props.installedResources.length === 0
								? "No resources installed"
								: summarizeResources(
										props.installedResources,
										props.knownUpdateCount,
									)}
						</p>
					</div>
				</div>
				<div class={styles["overview-resource-actions"]}>
					<Show when={props.installedResources.length > 0}>
						<Button size="sm" variant="ghost" onClick={props.onManageResources}>
							Manage
						</Button>
					</Show>
					<Button size="sm" variant="outline" onClick={props.onAddResources}>
						Add resources
					</Button>
				</div>
			</div>
			<Suspense
				fallback={
					<div class={styles["overview-loading"]}>Loading screenshots…</div>
				}
			>
				<ScreenshotGallery instanceIdSlug={props.instanceSlug} />
			</Suspense>
		</section>
	);
};
