import { createResource, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { SettingsCard } from "@components/settings";
import styles from "./settings-page.module.css";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import Button from "@ui/button/button";

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
		// @ts-ignore
		await refetchSources();
	};

	const checkNow = async () => {
		await invoke("check_notifications_now");
	};

	const addPreset = async (title: string, url: string) => {
		await invoke("subscribe_to_rss", { title, url });
		refetch();
	};

	const subscribeToSource = async (source: any) => {
		try {
			await invoke("subscribe_to_preset_source", { source });
			await refetch();
			// @ts-ignore
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
					Notification subscriptions are currently in preview. Additional sources
					and filtering options are being added.
				</span>
			</div>

			<SettingsCard header="Subscription Sources">
				<div class={styles["subscriptions-list"]}>
					<For each={subscriptions()} fallback={<div>No subscriptions found.</div>}>
						{(sub) => (
							<div class={styles["subscription-item"]}>
								<div class={styles["sub-info"]}>
									<div class={styles["sub-title"]}>{sub.title}</div>
									<div class={styles["sub-type"]}>
										{sub.provider_type}
										{sub.metadata && (
											<span style={{ "font-size": "11px", opacity: 0.6, "margin-left": "8px" }}>
												(Filtered)
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
										<Button variant="ghost" size="sm" onClick={() => deleteSub(sub.id)}>
											Remove
										</Button>
									</Show>
								</div>
							</div>
						)}
					</For>
				</div>
			</SettingsCard>

			<SettingsCard header="Official Sources & Presets">
				<p
					class={styles["settings-field-description"]}
					style={{ "margin-bottom": "1rem" }}
				>
					Quickly subscribe to official news, patch notes, and modloader releases.
				</p>
				<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
					<For
						each={availableSources()}
						fallback={<div>Loading available sources...</div>}
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
									{isSubscribed ? `Subscribed to ${source.title}` : source.title}
								</Button>
							);
						}}
					</For>
				</div>
			</SettingsCard>

			<SettingsCard header="Manual Action">
				<p class={styles["settings-field-description"]} style={{ "margin-bottom": "1rem" }}>
					Manually trigger a check for all subscribed update sources.
				</p>
				<Button onClick={checkNow}>Check for Updates Now</Button>
			</SettingsCard>
		</div>
	);
};
