use anyhow::Result;
use async_trait::async_trait;
use crate::models::NotificationSubscription;
use crate::notifications::subscriptions::{NotificationUpdateItem, SubscriptionProvider, AvailableNotificationSource};

pub struct RSSProvider;

#[async_trait]
impl SubscriptionProvider for RSSProvider {
    fn provider_type(&self) -> &str {
        "rss"
    }

    fn get_available_sources(&self) -> Vec<AvailableNotificationSource> {
        vec![
            AvailableNotificationSource {
                id: "fabric_news".to_string(),
                title: "Fabric News".to_string(),
                provider_type: "rss".to_string(),
                target_url: Some("https://fabricmc.net/feed.xml".to_string()),
                target_id: None,
                metadata: None,
            },
            AvailableNotificationSource {
                id: "quilt_news".to_string(),
                title: "Quilt News".to_string(),
                provider_type: "rss".to_string(),
                target_url: Some("https://quiltmc.org/feed.xml".to_string()),
                target_id: None,
                metadata: None,
            },
            AvailableNotificationSource {
                id: "forge_releases".to_string(),
                title: "Forge Releases".to_string(),
                provider_type: "rss".to_string(),
                target_url: Some(
                    "https://forums.minecraftforge.net/forum/7-releases.xml/".to_string(),
                ),
                target_id: None,
                metadata: None,
            },
            AvailableNotificationSource {
                id: "neoforge_releases".to_string(),
                title: "NeoForge All News".to_string(),
                provider_type: "rss".to_string(),
                target_url: Some("https://neoforged.net/news/index.xml".to_string()),
                target_id: None,
                metadata: None,
            },
            AvailableNotificationSource {
                id: "neoforge_announcements".to_string(),
                title: "NeoForge News".to_string(),
                provider_type: "rss".to_string(),
                target_url: Some("https://neoforged.net/news/index.xml".to_string()),
                target_id: None,
                metadata: Some(serde_json::json!({ "categories": ["Release", "News"] }).to_string()),
            },
        ]
    }

    async fn check(&self, _app_handle: &tauri::AppHandle, sub: &NotificationSubscription) -> Result<Vec<NotificationUpdateItem>> {
        let url = sub.target_url.as_deref()
            .ok_or_else(|| anyhow::anyhow!("RSS provider requires a target_url"))?;
            
        let response = reqwest::get(url).await?.bytes().await?;
        let feed = feed_rs::parser::parse(&response[..])?;

        // Filter by categories if present in metadata
        let allowed_categories: Vec<String> = sub.metadata.as_ref()
            .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
            .and_then(|v| {
                v.get("categories")
                    .and_then(|t| t.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>())
            })
            .unwrap_or_default();

        let mut items = Vec::new();
        for entry in feed.entries {
            let item_categories: Vec<String> = entry.categories.iter().map(|c| c.term.clone()).collect();

            // Filter if categories are specified
            if !allowed_categories.is_empty() && !allowed_categories.iter().any(|ac| item_categories.iter().any(|ic| ic.eq_ignore_ascii_case(ac))) {
                continue;
            }

            let guid = entry.id.clone();
            
            // Try to find a link
            let primary_link = entry.links.first().map(|l| l.href.clone());

            items.push(NotificationUpdateItem {
                id: guid,
                title: super::decode_title(&entry.title.map(|t| t.content).unwrap_or_else(|| "No Title".to_string())),
                description: entry.summary.map(|s| super::clean_and_truncate(&s.content, 240)),
                link: primary_link,
                metadata: serde_json::json!({
                    "authors": entry.authors.iter().map(|a| a.name.clone()).collect::<Vec<String>>(),
                    "published": entry.published,
                    "updated": entry.updated,
                    "categories": item_categories,
                }),
                severity: Some("info".to_string()),
            });
        }

        Ok(items)
    }
}
