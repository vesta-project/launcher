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
import { t } from "~/localization";
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
	labelMessageId: string;
	loadingMessageId: string;
	errorMessageId?: string;
	preload?: () => Promise<unknown>;
	render: (props: { close?: () => void }) => JSXElement;
}

const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
	{
		value: "general",
		labelMessageId: "settings-tab-general",
		loadingMessageId: "settings-general-loading",
		errorMessageId: "settings-general-error",
		render: () => <GeneralSettingsTab />,
	},
	{
		value: "account",
		labelMessageId: "settings-tab-account",
		loadingMessageId: "settings-generic-loading",
		preload: AccountSettingsModule.preload,
		render: () => <AccountSettingsTab />,
	},
	{
		value: "appearance",
		labelMessageId: "settings-tab-appearance",
		loadingMessageId: "settings-appearance-loading",
		preload: AppearanceSettingsModule.preload,
		render: () => <AppearanceSettingsTab />,
	},
	{
		value: "java",
		labelMessageId: "settings-tab-java",
		loadingMessageId: "settings-java-loading",
		preload: JavaSettingsModule.preload,
		render: () => <JavaSettingsTab />,
	},
	{
		value: "notifications",
		labelMessageId: "settings-tab-notifications",
		loadingMessageId: "settings-generic-loading",
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
		labelMessageId: "settings-tab-defaults",
		loadingMessageId: "settings-generic-loading",
		preload: InstanceDefaultsModule.preload,
		render: () => <InstanceDefaultsTab />,
	},
	{
		value: "developer",
		labelMessageId: "settings-tab-developer",
		loadingMessageId: "settings-developer-loading",
		preload: DeveloperSettingsModule.preload,
		render: () => <DeveloperSettingsTab />,
	},
	{
		value: "help",
		labelMessageId: "settings-tab-help",
		loadingMessageId: "settings-generic-loading",
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

	const settingsTabs = createMemo(() =>
		SETTINGS_TABS.map((tab) => ({
			value: tab.value,
			label: t(tab.labelMessageId),
		})),
	);

	return (
		<div class={styles["settings-page"]}>
			<PageSidebar
				tabs={settingsTabs()}
				activeTab={selectedTab()}
				onTabChange={selectTab}
				onTabIntent={settingsTabLoader.preload}
			>
				<Show
					when={!loading()}
					fallback={
						<div class={styles["settings-loading"]}>
							{t("settings-loading")}
						</div>
					}
				>
					<For each={SETTINGS_TABS}>
						{(tab) => (
							<TabsContent class={styles["tabs-content"]} value={tab.value}>
								<Show when={settingsTabLoader.visitedTabs().has(tab.value)}>
									<Suspense
										fallback={
											<div class={styles["settings-tab-loading"]}>
												{t(tab.loadingMessageId)}
											</div>
										}
									>
										<ErrorBoundary
											fallback={(error) => (
												<div class={styles["settings-tab-error"]}>
													<strong>
														{t(tab.errorMessageId ?? "settings-tab-error", {
															tab: t(tab.labelMessageId),
														})}
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
