use crate::models::NotificationSubscription;
use crate::notifications::subscriptions::{
    AvailableNotificationSource, NotificationUpdateItem, SubscriptionProvider,
};
use crate::utils::version_tracking::VersionTrackingRepository;
use anyhow::Result;
use async_trait::async_trait;
use tauri::Manager;

pub struct GameVersionProvider;

#[async_trait]
impl SubscriptionProvider for GameVersionProvider {
    fn provider_type(&self) -> &str {
        "game"
    }

    fn get_available_sources(&self) -> Vec<AvailableNotificationSource> {
        vec![AvailableNotificationSource {
            id: "minecraft_versions".to_string(),
            title: "Minecraft Version Updates".to_string(),
            provider_type: "game".to_string(),
            target_url: None,
            target_id: None,
            metadata: None,
        }]
    }

    async fn check(
        &self,
        _app_handle: &tauri::AppHandle,
        _sub: &NotificationSubscription,
    ) -> Result<Vec<NotificationUpdateItem>> {
        // Ensure defaults are initialized
        if let Err(e) = VersionTrackingRepository::initialize_defaults() {
            log::error!("Failed to initialize version tracking defaults: {}", e);
        }

        let latest = piston_lib::game::metadata::fetch_latest_versions()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to fetch latest versions: {}", e))?;

        let mut items = Vec::new();

        // Release check
        let latest_release = &latest.release;
        if VersionTrackingRepository::is_version_newer("minecraft_release", latest_release)? {
            items.push(NotificationUpdateItem {
                id: format!("minecraft_release_{}", latest_release),
                title: _app_handle.state::<crate::localization::LocalizationManager>().text("rust-native-new-minecraft-release-title"),
                description: {
                    let localization = _app_handle.state::<crate::localization::LocalizationManager>();
                    let mut args = fluent_bundle::FluentArgs::new();
                    args.set("version", latest_release.as_str());
                    Some(localization.format("rust-native-new-minecraft-release-description", Some(&args)))
                },
                link: None,
                metadata: serde_json::json!({
                    "version": latest_release,
                    "version_type": "release"
                }),
                severity: Some("info".to_string()),
                silent: Some(true),
            });
            // Mark notified so we don't spam if polling runs again before user marks seen
            let _ = VersionTrackingRepository::mark_notified("minecraft_release", latest_release);
        }

        // Snapshot check
        let latest_snapshot = &latest.snapshot;
        if VersionTrackingRepository::is_version_newer("minecraft_snapshot", latest_snapshot)? {
            items.push(NotificationUpdateItem {
                id: format!("minecraft_snapshot_{}", latest_snapshot),
                title: _app_handle.state::<crate::localization::LocalizationManager>().text("rust-native-new-minecraft-snapshot-title"),
                description: {
                    let localization = _app_handle.state::<crate::localization::LocalizationManager>();
                    let mut args = fluent_bundle::FluentArgs::new();
                    args.set("version", latest_snapshot.as_str());
                    Some(localization.format("rust-native-new-minecraft-snapshot-description", Some(&args)))
                },
                link: None,
                metadata: serde_json::json!({
                    "version": latest_snapshot,
                    "version_type": "snapshot"
                }),
                severity: Some("info".to_string()),
                silent: Some(true),
            });
            let _ = VersionTrackingRepository::mark_notified("minecraft_snapshot", latest_snapshot);
        }

        Ok(items)
    }
}
