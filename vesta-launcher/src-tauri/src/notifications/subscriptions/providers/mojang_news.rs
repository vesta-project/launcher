use anyhow::Result;
use async_trait::async_trait;
use crate::models::NotificationSubscription;
use crate::notifications::subscriptions::{NotificationUpdateItem, SubscriptionProvider, AvailableNotificationSource};
use serde::Deserialize;

const MOJANG_NEWS_URL: &str = "https://launchercontent.mojang.com/v2/news.json";

pub struct MojangNewsProvider;

#[derive(Debug, Deserialize)]
struct MojangNewsResponse {
    version: i32,
    entries: Vec<MojangNewsEntry>,
}

#[derive(Debug, Deserialize)]
struct MojangNewsEntry {
    tag: Option<String>,
    category: String,
    title: String,
    text: String,
    #[serde(rename = "readMoreLink")]
    read_more_link: String,
}

#[async_trait]
impl SubscriptionProvider for MojangNewsProvider {
    fn provider_type(&self) -> &str {
        "news"
    }

    fn get_available_sources(&self) -> Vec<AvailableNotificationSource> {
        vec![AvailableNotificationSource {
            id: "mojang_news".to_string(),
            title: "Minecraft News".to_string(),
            provider_type: "news".to_string(),
            target_url: Some(MOJANG_NEWS_URL.to_string()),
            target_id: None,
            metadata: Some(serde_json::json!({ "tags": ["News", "Community"] }).to_string()),
        }]
    }

    async fn check(&self, _app_handle: &tauri::AppHandle, sub: &NotificationSubscription) -> Result<Vec<NotificationUpdateItem>> {
        let url = sub.target_url.as_deref().unwrap_or(MOJANG_NEWS_URL);
        let response = reqwest::get(url).await?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Failed to fetch Mojang news from {}: {}", url, response.status()));
        }

        let news: MojangNewsResponse = response.json().await?;

        // Filter by tags if present in metadata
        let allowed_tags: Vec<String> = sub.metadata.as_ref()
            .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
            .and_then(|v| {
                v.get("tags")
                    .and_then(|t| t.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>())
            })
            .unwrap_or_default();

        let mut items = Vec::new();
        for entry in news.entries {
            let entry_tag = entry.tag.as_deref().unwrap_or("News");

            // Keep filter logic: if tags are specified, check them. If none specified, allow all.
            if !allowed_tags.is_empty() && !allowed_tags.iter().any(|t| t.eq_ignore_ascii_case(entry_tag)) {
                continue;
            }

            items.push(NotificationUpdateItem {
                id: entry.read_more_link.clone(),
                title: super::decode_title(&entry.title),
                description: Some(super::clean_and_truncate(&entry.text, 240)),
                link: Some(entry.read_more_link),
                metadata: serde_json::json!({
                    "tag": entry_tag,
                    "category": entry.category,
                }),
                severity: Some("info".to_string()),
            });
        }

        Ok(items)
    }
}
