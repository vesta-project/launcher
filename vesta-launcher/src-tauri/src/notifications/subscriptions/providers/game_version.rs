use anyhow::Result;
use async_trait::async_trait;
use crate::models::NotificationSubscription;
use crate::notifications::subscriptions::{NotificationUpdateItem, SubscriptionProvider, AvailableNotificationSource};
use crate::utils::version_tracking::VersionTrackingRepository;

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

    async fn check(&self, _app_handle: &tauri::AppHandle, _sub: &NotificationSubscription) -> Result<Vec<NotificationUpdateItem>> {
        // Ensure defaults are initialized
        if let Err(e) = VersionTrackingRepository::initialize_defaults() {
            log::error!("Failed to initialize version tracking defaults: {}", e);
        }
        
        let manifest = piston_lib::game::metadata::fetch_metadata().await.map_err(|e| anyhow::anyhow!("Failed to fetch manifest: {}", e))?;
        
        let mut items = Vec::new();
        
        // Release check
        let latest_release = &manifest.latest.release;
        if VersionTrackingRepository::is_version_newer("minecraft_release", latest_release)? {
            items.push(NotificationUpdateItem {
                id: format!("minecraft_release_{}", latest_release),
                title: "New Minecraft Release Available".to_string(),
                description: Some(format!("Minecraft {} is now available for download!", latest_release)),
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
        let latest_snapshot = &manifest.latest.snapshot;
        if VersionTrackingRepository::is_version_newer("minecraft_snapshot", latest_snapshot)? {
            items.push(NotificationUpdateItem {
                id: format!("minecraft_snapshot_{}", latest_snapshot),
                title: "New Minecraft Snapshot Available".to_string(),
                description: Some(format!("Minecraft snapshot {} is now available for testing!", latest_snapshot)),
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
