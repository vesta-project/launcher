use anyhow::Result;
use async_trait::async_trait;
use crate::models::NotificationSubscription;
use crate::notifications::subscriptions::{NotificationUpdateItem, SubscriptionProvider};
use crate::resources::manager::ResourceManager;
use crate::models::resource::SourcePlatform;
use tauri::Manager;

pub struct ResourceProvider;

#[async_trait]
impl SubscriptionProvider for ResourceProvider {
    fn provider_type(&self) -> &str {
        "resource"
    }

    async fn check(&self, app_handle: &tauri::AppHandle, sub: &NotificationSubscription) -> Result<Vec<NotificationUpdateItem>> {
        let project_id = sub.target_id.as_deref()
            .ok_or_else(|| anyhow::anyhow!("Resource provider requires a target_id (project ID)"))?;
            
        let metadata: serde_json::Value = sub.metadata.as_ref()
            .and_then(|m| serde_json::from_str(m).ok())
            .unwrap_or_default();
            
        let platform_str = metadata.get("platform").and_then(|p| p.as_str()).unwrap_or("modrinth");
        let platform = if platform_str == "curseforge" {
            SourcePlatform::CurseForge
        } else {
            SourcePlatform::Modrinth
        };

        let rm = app_handle.state::<ResourceManager>();
        
        // Fetch latest versions (ignoring cache to find new ones)
        let versions = rm.get_versions(platform, project_id, true, None, None).await?;
        
        let mut items = Vec::new();
        // Just take the latest release for now
        if let Some(latest) = versions.first() {
            // Generate a direct link to the version page for the given platform
            let link = match platform {
                SourcePlatform::Modrinth => {
                    format!("https://modrinth.com/project/{}/version/{}", project_id, latest.id)
                }
                SourcePlatform::CurseForge => {
                    // Generic CurseForge URL pattern that works with numeric project ID and file ID
                    format!("https://www.curseforge.com/projects/{}/files/{}", project_id, latest.id)
                }
            };

            items.push(NotificationUpdateItem {
                id: format!("{}-{}", project_id, latest.id),
                title: format!("New Update: {}", latest.version_number),
                description: Some(format!("A new version for {} has been released on {}.", sub.title, platform_str)),
                link: Some(link),
                metadata: serde_json::json!({
                    "platform": platform_str,
                    "version_id": latest.id,
                    "version_number": latest.version_number,
                }),
                severity: Some("info".to_string()),
            });
        }
        
        Ok(items)
    }
}
