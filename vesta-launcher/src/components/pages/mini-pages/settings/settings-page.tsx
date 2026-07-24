import { PageSidebar } from "@components/page-sidebar/page-sidebar";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import { cleanupSettings, initSettings, loading } from "@stores/settings";
import { prefetchSettingsData } from "@stores/settings-cache";
import { TabsContent } from "@ui/tabs/tabs";
import {
	createPreloadableLazyComponent,
	createRetainedTabLoader,
} from "@utils/preloadable-lazy";
import {
	createEffect,
	createMemo,
	createSignal,
	ErrorBoundary,
	For,
	type JSXElement,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { GeneralSettingsTab } from "./general/GeneralTab";
import styles from "./settings-page.module.css";

const AccountSettingsModule = createPreloadableLazyComponent(() =>
	import("./account/AccountTab").then((module) => ({
		default: module.AccountSettingsTab,
	})),
);
const AppearanceSettingsModule = createPreloadableLazyComponent(() =>
	import("./appearance/AppearanceTab").then((module) => ({
		default: module.AppearanceSettingsTab,
	})),
);
const JavaSettingsModule = createPreloadableLazyComponent(() =>
	import("./java/JavaTab").then((module) => ({
		default: module.JavaSettingsTab,
	})),
);
const NotificationSettingsModule = createPreloadableLazyComponent(() =>
	import("./notifications/NotificationsTab").then((module) => ({
		default: module.NotificationSettingsTab,
	})),
);
const KeyboardSettingsModule = createPreloadableLazyComponent(() =>
	import("./keyboard/KeyboardTab").then((module) => ({
		default: module.KeyboardSettingsTab,
	})),
);
const InstanceDefaultsModule = createPreloadableLazyComponent(() =>
	import("./defaults/DefaultsTab").then((module) => ({
		default: module.InstanceDefaultsTab,
	})),
);
const DeveloperSettingsModule = createPreloadableLazyComponent(() =>
	import("./developer/DeveloperTab").then((module) => ({
		default: module.DeveloperSettingsTab,
	})),
);
const HelpSettingsModule = createPreloadableLazyComponent(() =>
	import("./help/HelpTab").then((module) => ({
		default: module.HelpSettingsTab,
	})),
);

const AccountSettingsTab = AccountSettingsModule.Component;
const AppearanceSettingsTab = AppearanceSettingsModule.Component;
const JavaSettingsTab = JavaSettingsModule.Component;
const NotificationSettingsTab = NotificationSettingsModule.Component;
const KeyboardSettingsTab = KeyboardSettingsModule.Component;
const InstanceDefaultsTab = InstanceDefaultsModule.Component;
const DeveloperSettingsTab = DeveloperSettingsModule.Component;
const HelpSettingsTab = HelpSettingsModule.Component;

interface SettingsTabDefinition {
	value: string;
	label: string;
	loadingLabel: string;
	preload?: () => Promise<unknown>;
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
		preload: AccountSettingsModule.preload,
		render: () => <AccountSettingsTab />,
	},
	{
		value: "appearance",
		label: "Appearance",
		loadingLabel: "Appearance",
		preload: AppearanceSettingsModule.preload,
		render: () => <AppearanceSettingsTab />,
	},
	{
		value: "java",
		label: "Java",
		loadingLabel: "Java Settings",
		preload: JavaSettingsModule.preload,
		render: () => <JavaSettingsTab />,
	},
	{
		value: "notifications",
		label: "Notifications",
		loadingLabel: "Notification Settings",
		preload: NotificationSettingsModule.preload,
		render: () => <NotificationSettingsTab />,
	},
	{
		value: "keyboard",
		label: "Keyboard",
		loadingLabel: "Keyboard Settings",
		preload: KeyboardSettingsModule.preload,
		render: () => <KeyboardSettingsTab />,
	},
	{
		value: "defaults",
		label: "Defaults",
		loadingLabel: "Instance Defaults",
		preload: InstanceDefaultsModule.preload,
		render: () => <InstanceDefaultsTab />,
	},
	{
		value: "developer",
		label: "Developer",
		loadingLabel: "Developer Settings",
		preload: DeveloperSettingsModule.preload,
		render: () => <DeveloperSettingsTab />,
	},
	{
		value: "help",
		label: "Help",
		loadingLabel: "Help",
		preload: HelpSettingsModule.preload,
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
	const settingsTabLoader = createRetainedTabLoader(
		activeTab(),
		(value) =>
			SETTINGS_TABS.find((candidate) => candidate.value === value)?.preload,
		(value, error) => {
			console.warn(`Failed to preload settings tab ${value}:`, error);
		},
	);

	const selectTab = (value: string) => {
		if (value === activeTab()) return;
		settingsTabLoader.prepare(value);
		setSelectedTab(value);
		activeRouter()?.updateQuery("activeTab", value);
	};

	createEffect(() => {
		const tab = activeTab();
		setSelectedTab(tab);
		settingsTabLoader.retain(tab);
	});

	onMount(() => {
		void initSettings();
		void prefetchSettingsData();
		activeRouter()?.registerStateProvider("/config", () => ({
			activeTab: selectedTab(),
		}));
	});

	onCleanup(() => {
		cleanupSettings();
	});

	return (
		<div class={styles["settings-page"]}>
			<PageSidebar
				tabs={[...SETTINGS_TABS]}
				activeTab={selectedTab()}
				onTabChange={selectTab}
				onTabIntent={settingsTabLoader.preload}
			>
				<Show
					when={!loading()}
					fallback={
						<div class={styles["settings-loading"]}>Loading settings...</div>
					}
				>
					<For each={SETTINGS_TABS}>
						{(tab) => (
							<TabsContent class={styles["tabs-content"]} value={tab.value}>
								<Show when={settingsTabLoader.visitedTabs().has(tab.value)}>
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
				</Show>
			</PageSidebar>
		</div>
	);
}

export default SettingsPage;
