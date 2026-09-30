import { SettingsCard } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { createResource, For, Show } from "solid-js";
import { t } from "~/localization";
import styles from "../settings-page.module.css";

const SOURCE_TITLE_IDS: Record<string, string> = {
	minecraft_versions: "settings-notifications-source-minecraft-version-updates",
	mojang_news: "settings-notifications-source-minecraft-news",
	patch_notes: "settings-notifications-source-java-patch-notes",
	fabric_news: "settings-notifications-source-fabric-news",
	quilt_news: "settings-notifications-source-quilt-news",
	forge_releases: "settings-notifications-source-forge-releases",
	neoforge_releases: "settings-notifications-source-neoforge-all-news",
	neoforge_announcements: "settings-notifications-source-neoforge-news",
};

const SOURCE_TITLE_IDS_BY_ENGLISH_TITLE: Record<string, string> = {
	"Minecraft Version Updates": SOURCE_TITLE_IDS.minecraft_versions,
	"Minecraft News": SOURCE_TITLE_IDS.mojang_news,
	"Java Patch Notes": SOURCE_TITLE_IDS.patch_notes,
	"Fabric News": SOURCE_TITLE_IDS.fabric_news,
	"Quilt News": SOURCE_TITLE_IDS.quilt_news,
	"Forge Releases": SOURCE_TITLE_IDS.forge_releases,
	"NeoForge All News": SOURCE_TITLE_IDS.neoforge_releases,
	"NeoForge News": SOURCE_TITLE_IDS.neoforge_announcements,
};

const PROVIDER_TYPE_IDS: Record<string, string> = {
	game: "settings-notifications-provider-game",
	news: "settings-notifications-provider-news",
	patch_notes: "settings-notifications-provider-patch-notes",
	rss: "settings-notifications-provider-rss",
};

export const NotificationSettingsTab = () => {
	const [subscriptions, { refetch }] = createResource<any[]>(() =>
		invoke("get_notification_subscriptions"),
	);

	const [availableSources, { refetch: refetchSources }] = createResource<any[]>(
		() => invoke("get_available_notification_sources"),
	);

	const toggleSub = async (id: string, enabled: boolean) => {
		await invoke("toggle_notification_subscription", { id, enabled });
		refetch();
	};

	const deleteSub = async (id: string) => {
		await invoke("delete_notification_subscription", { id });
		await refetch();
		await refetchSources();
	};

	const checkNow = async () => {
		await invoke("check_notifications_now");
	};

	const getSourceTitle = (source: any) => {
		const messageId = SOURCE_TITLE_IDS[source.id];
		return messageId ? t(messageId) : source.title;
	};

	const getSubscriptionTitle = (subscription: any) => {
		const messageId = SOURCE_TITLE_IDS_BY_ENGLISH_TITLE[subscription.title];
		return messageId ? t(messageId) : subscription.title;
	};

	const getProviderType = (providerType: string) => {
		const messageId = PROVIDER_TYPE_IDS[providerType];
		return messageId ? t(messageId) : providerType;
	};

	const _addPreset = async (title: string, url: string) => {
		await invoke("subscribe_to_rss", { title, url });
		refetch();
	};

	const subscribeToSource = async (source: any) => {
		try {
			await invoke("subscribe_to_preset_source", { source });
			await refetch();
				await refetchSources();
		} catch (e) {
			console.error("Failed to subscribe:", e);
		}
	};

	return (
		<div class={styles["settings-tab-content"]}>
			<div
				style={{
					background: "hsl(var(--color__primary-hue) 60% 50% / 10%)",
					padding: "16px",
					"border-radius": "8px",
					border: "1px solid hsl(var(--color__primary-hue) 60% 50% / 20%)",
					"margin-bottom": "24px",
					display: "flex",
					gap: "12px",
					"align-items": "center",
				}}
			>
				<div
					style={{
						width: "8px",
						height: "8px",
						"border-radius": "50%",
						background: "hsl(var(--color__primary-hue) 80% 60%)",
						animation: "pulse 2s infinite",
					}}
				/>
				<span style={{ "font-size": "13px", "font-weight": "500" }}>
					{t("settings-notifications-preview-banner")}
				</span>
			</div>

			<div class={panelStyles["settings-panel"]}>
				<SettingsCard header={t("settings-notifications-subscription-sources-title")}>
					<div class={styles["subscriptions-list"]}>
						<For
							each={subscriptions()}
							fallback={<div>{t("settings-notifications-no-subscriptions")}</div>}
						>
							{(sub) => (
								<div class={styles["subscription-item"]}>
									<div class={styles["sub-info"]}>
										<div class={styles["sub-title"]}>{getSubscriptionTitle(sub)}</div>
										<div class={styles["sub-type"]}>
											{getProviderType(sub.provider_type)}
											{sub.metadata && (
												<span
													style={{
														"font-size": "11px",
														opacity: 0.6,
														"margin-left": "8px",
													}}
												>
													{t("settings-notifications-filtered")}
												</span>
											)}
										</div>
									</div>
									<div class={styles["sub-actions"]}>
										<Switch
											checked={sub.enabled}
											onCheckedChange={(v: boolean) => toggleSub(sub.id, v)}
										>
											<SwitchControl>
												<SwitchThumb />
											</SwitchControl>
										</Switch>
										<Show
											when={
												sub.provider_type === "resource" ||
												sub.provider_type === "rss" ||
												sub.provider_type === "news" ||
												sub.provider_type === "patch_notes"
											}
										>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => deleteSub(sub.id)}
											>
												{t("settings-notifications-remove")}
											</Button>
										</Show>
									</div>
								</div>
							)}
						</For>
					</div>
				</SettingsCard>

				<SettingsCard header={t("settings-notifications-official-sources-title")}>
					<p
						class={styles["settings-field-description"]}
						style={{ "margin-bottom": "1rem" }}
					>
						{t("settings-notifications-official-sources-description")}
					</p>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
						<For
							each={availableSources()}
							fallback={<div>{t("settings-notifications-loading-sources")}</div>}
						>
							{(source) => {
								// Check if already subscribed
								const isSubscribed = subscriptions()?.some(
									(s) =>
										s.target_url === source.target_url &&
										s.provider_type === source.provider_type,
								);

								return (
									<Button
										variant={isSubscribed ? "ghost" : "outline"}
										size="sm"
										disabled={isSubscribed}
										onClick={() => subscribeToSource(source)}
									>
										{isSubscribed
											? t("settings-notifications-subscribed-to", {
													title: getSourceTitle(source),
												})
											: getSourceTitle(source)}
									</Button>
								);
							}}
						</For>
					</div>
				</SettingsCard>

				<SettingsCard header={t("settings-notifications-manual-action-title")}>
					<p
						class={styles["settings-field-description"]}
						style={{ "margin-bottom": "1rem" }}
					>
						{t("settings-notifications-manual-action-description")}
					</p>
					<Button onClick={checkNow}>
						{t("settings-notifications-check-now")}
					</Button>
				</SettingsCard>
			</div>
		</div>
	);
};
