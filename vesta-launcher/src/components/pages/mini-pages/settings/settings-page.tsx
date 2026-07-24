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
	For,
	type JSXElement,
	lazy,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { GeneralSettingsTab } from "./general/GeneralTab";
import styles from "./settings-page.module.css";

const AccountSettingsTab = lazy(() =>
	import("./account/AccountTab").then((module) => ({
		default: module.AccountSettingsTab,
	})),
);
const AppearanceSettingsTab = lazy(() =>
	import("./appearance/AppearanceTab").then((module) => ({
		default: module.AppearanceSettingsTab,
	})),
);
const JavaSettingsTab = lazy(() =>
	import("./java/JavaTab").then((module) => ({
		default: module.JavaSettingsTab,
	})),
);
const NotificationSettingsTab = lazy(() =>
	import("./notifications/NotificationsTab").then((module) => ({
		default: module.NotificationSettingsTab,
	})),
);
const InstanceDefaultsTab = lazy(() =>
	import("./defaults/DefaultsTab").then((module) => ({
		default: module.InstanceDefaultsTab,
	})),
);
const DeveloperSettingsTab = lazy(() =>
	import("./developer/DeveloperTab").then((module) => ({
		default: module.DeveloperSettingsTab,
	})),
);
const HelpSettingsTab = lazy(() =>
	import("./help/HelpTab").then((module) => ({
		default: module.HelpSettingsTab,
	})),
);

interface SettingsTabDefinition {
	value: string;
	label: string;
	loadingLabel: string;
	render: (props: { close?: () => void }) => JSXElement;
}

const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
	{
		value: "general",
		label: "General",
		loadingLabel: "General Settings",
		render: () => <GeneralSettingsTab />,
	},
	{
		value: "account",
		label: "Account",
		loadingLabel: "Account Settings",
		render: () => <AccountSettingsTab />,
	},
	{
		value: "appearance",
		label: "Appearance",
		loadingLabel: "Appearance",
		render: () => <AppearanceSettingsTab />,
	},
	{
		value: "java",
		label: "Java",
		loadingLabel: "Java Settings",
		render: () => <JavaSettingsTab />,
	},
	{
		value: "notifications",
		label: "Notifications",
		loadingLabel: "Notification Settings",
		render: () => <NotificationSettingsTab />,
	},
	{
		value: "defaults",
		label: "Defaults",
		loadingLabel: "Instance Defaults",
		render: () => <InstanceDefaultsTab />,
	},
	{
		value: "developer",
		label: "Developer",
		loadingLabel: "Developer Settings",
		render: () => <DeveloperSettingsTab />,
	},
	{
		value: "help",
		label: "Help",
		loadingLabel: "Help",
		render: (props) => <HelpSettingsTab close={props.close} />,
	},
];

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

	onMount(() => {
		void initSettings();
		activeRouter()?.registerStateProvider("/config", () => ({
			activeTab: selectedTab(),
		}));
	});

	onCleanup(() => {
		cleanupSettings();
	});

	return (
		<div class={styles["settings-page"]}>
			<Show
				when={!loading()}
				fallback={
					<div class={styles["settings-loading"]}>Loading settings...</div>
				}
			>
				<PageSidebar
					tabs={[...SETTINGS_TABS]}
					activeTab={selectedTab()}
					onTabChange={(v) => {
						setSelectedTab(v);
						activeRouter()?.updateQuery("activeTab", v, true);
					}}
				>
					<For each={SETTINGS_TABS}>
						{(tab) => (
							<TabsContent class={styles["tabs-content"]} value={tab.value}>
								<Show when={selectedTab() === tab.value}>
									<Suspense
										fallback={
											<div class={styles["settings-tab-loading"]}>
												Loading {tab.loadingLabel}...
											</div>
										}
									>
										<ErrorBoundary
											fallback={(error) => (
												<div class={styles["settings-tab-error"]}>
													<strong>
														{tab.label} settings could not be displayed.
													</strong>
													<span>{String(error)}</span>
												</div>
											)}
										>
											{tab.render({ close: props.close })}
										</ErrorBoundary>
									</Suspense>
								</Show>
							</TabsContent>
						)}
					</For>
				</PageSidebar>
			</Show>
		</div>
	);
}

export default SettingsPage;
