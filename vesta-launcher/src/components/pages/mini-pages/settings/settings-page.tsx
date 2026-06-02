import { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { PageSidebar } from "@components/page-sidebar/page-sidebar";
import { TabsContent } from "@ui/tabs/tabs";
import { cleanupSettings, initSettings, loading } from "@stores/settings";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, Suspense } from "solid-js";
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

	const settingsTabs = [
		{ value: "general", label: "General" },
		{ value: "account", label: "Account" },
		{ value: "appearance", label: "Appearance" },
		{ value: "java", label: "Java" },
		{ value: "notifications", label: "Notifications" },
		{ value: "defaults", label: "Defaults" },
		{ value: "developer", label: "Developer" },
		{ value: "help", label: "Help" },
	];

	return (
		<div class={styles["settings-page"]}>
			<Show
				when={!loading()}
				fallback={<div class={styles["settings-loading"]}>Loading settings...</div>}
			>
				<PageSidebar
					tabs={settingsTabs}
					activeTab={selectedTab()}
					onTabChange={(v) => {
						setSelectedTab(v);
						activeRouter()?.updateQuery("activeTab", v, true);
					}}
				>
					<TabsContent class={styles["tabs-content"]} value="general">
						<Suspense
							fallback={<div class={styles["settings-tab-loading"]}>Loading General Settings...</div>}
						>
							<GeneralSettingsTab />
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="account">
						<AccountSettingsTab />
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="appearance">
						<Suspense
							fallback={<div class={styles["settings-tab-loading"]}>Loading Appearance...</div>}
						>
							<AppearanceSettingsTab />
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="java">
						<Suspense
							fallback={<div class={styles["settings-tab-loading"]}>Loading Java Settings...</div>}
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
							fallback={<div class={styles["settings-tab-loading"]}>Loading Developer Settings...</div>}
						>
							<DeveloperSettingsTab />
						</Suspense>
					</TabsContent>

					<TabsContent class={styles["tabs-content"]} value="help">
						<Suspense
							fallback={<div class={styles["settings-tab-loading"]}>Loading...</div>}
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
