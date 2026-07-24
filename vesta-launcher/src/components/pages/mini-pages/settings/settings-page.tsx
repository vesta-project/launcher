import { PageSidebar } from "@components/page-sidebar/page-sidebar";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { cleanupSettings, initSettings, loading } from "@stores/settings";
import { TabsContent } from "@ui/tabs/tabs";
import {
	createEffect,
	createMemo,
	createSignal,
	ErrorBoundary,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { t } from "~/localization";
import { AccountSettingsTab } from "./account/AccountTab";
import { AppearanceSettingsTab } from "./appearance/AppearanceTab";
import { InstanceDefaultsTab } from "./defaults/DefaultsTab";
import { DeveloperSettingsTab } from "./developer/DeveloperTab";
import { GeneralSettingsTab } from "./general/GeneralTab";
import { HelpSettingsTab } from "./help/HelpTab";
import { JavaSettingsTab } from "./java/JavaTab";
import { NotificationSettingsTab } from "./notifications/NotificationsTab";
import styles from "./settings-page.module.css";

function SettingsPage(props: { close?: () => void; router?: MiniRouter }) {
	const activeRouter = createMemo(() => props.router || router());

	const activeTab = createMemo(() => {
		if (activeRouter()?.currentPath.get() !== "/config") return "general";
		const params = activeRouter()?.currentParams.get();
		return (params?.activeTab as string) || "general";
	});

	const [selectedTab, setSelectedTab] = createSignal(activeTab());

	createEffect(() => {
		setSelectedTab(activeTab());
	});

	onMount(async () => {
		await initSettings();
		activeRouter()?.registerStateProvider("/config", () => ({
			activeTab: activeTab(),
		}));
	});

	onCleanup(() => {
		cleanupSettings();
	});

	const settingsTabs = createMemo(() => [
		{ value: "general", label: t("settings-tab-general") },
		{ value: "account", label: t("settings-tab-account") },
		{ value: "appearance", label: t("settings-tab-appearance") },
		{ value: "java", label: t("settings-tab-java") },
		{ value: "notifications", label: t("settings-tab-notifications") },
		{ value: "defaults", label: t("settings-tab-defaults") },
		{ value: "developer", label: t("settings-tab-developer") },
		{ value: "help", label: t("settings-tab-help") },
	]);

	return (
		<div class={styles["settings-page"]}>
			<Show
				when={!loading()}
				fallback={
					<div class={styles["settings-loading"]}>{t("settings-loading")}</div>
				}
			>
				<PageSidebar
					tabs={settingsTabs()}
					activeTab={selectedTab()}
					onTabChange={(v) => {
						setSelectedTab(v);
						activeRouter()?.updateQuery("activeTab", v, true);
					}}
				>
					<TabsContent class={styles["tabs-content"]} value="general">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									{t("settings-general-loading")}
								</div>
							}
						>
							<ErrorBoundary
								fallback={(error) => (
									<div class={styles["settings-tab-error"]}>
										<strong>{t("settings-general-error")}</strong>
										<span>{String(error)}</span>
									</div>
								)}
							>
								<GeneralSettingsTab />
							</ErrorBoundary>
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="account">
						<AccountSettingsTab />
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="appearance">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									{t("settings-appearance-loading")}
								</div>
							}
						>
							<AppearanceSettingsTab />
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="java">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									{t("settings-java-loading")}
								</div>
							}
						>
							<JavaSettingsTab />
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="notifications">
						<NotificationSettingsTab />
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="defaults">
						<InstanceDefaultsTab />
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="developer">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									{t("settings-developer-loading")}
								</div>
							}
						>
							<DeveloperSettingsTab />
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="help">
						<Suspense
							fallback={
								<div class={styles["settings-tab-loading"]}>
									{t("settings-generic-loading")}
								</div>
							}
						>
							<HelpSettingsTab close={props.close} />
						</Suspense>
					</TabsContent>
				</PageSidebar>
			</Show>
		</div>
	);
}

export default SettingsPage;
