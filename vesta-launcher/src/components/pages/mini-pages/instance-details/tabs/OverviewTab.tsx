import Button from "@ui/button/button";
import { Show, Suspense } from "solid-js";
import { t } from "~/localization";
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
					<div>
						<h2>{t("instances-details-tab-resources")}</h2>
						<p>
							{props.installedResources.length === 0
								? t("instances-extra-overview-no-resources")
								: summarizeResources(props.installedResources, props.knownUpdateCount)}
						</p>
					</div>
				</div>
				<div class={styles["overview-resource-actions"]}>
					<Show when={props.installedResources.length > 0}>
						<Button size="sm" variant="ghost" onClick={props.onManageResources}>
							{t("app-shell-manage")}
						</Button>
					</Show>
					<Button size="sm" variant="outline" onClick={props.onAddResources}>
						{t("instances-details-resources-add")}
					</Button>
				</div>
			</div>
			<Suspense
				fallback={
					<div class={styles["overview-loading"]}>{t("instances-extra-screenshots-loading")}</div>
				}
			>
				<ScreenshotGallery instanceIdSlug={props.instanceSlug} />
			</Suspense>
		</section>
	);
};
