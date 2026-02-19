use anyhow::Result;
use async_trait::async_trait;
use crate::models::NotificationSubscription;
use crate::notifications::subscriptions::{NotificationUpdateItem, SubscriptionProvider, AvailableNotificationSource};
use serde::Deserialize;

const PATCH_NOTES_URL: &str = "https://launchercontent.mojang.com/javaPatchNotes.json";

pub struct PatchNotesProvider;

#[derive(Debug, Deserialize)]
struct PatchNotesResponse {
    entries: Vec<PatchNotesEntry>,
}

#[derive(Debug, Deserialize)]
struct PatchNotesEntry {
    id: String,
    title: String,
    version: String,
    #[serde(rename = "type")]
    version_type: String, // release, snapshot
    body: String,
    // image: Option<serde_json::Value>, // Not needed for now
    // contentPath: String, // Not needed
}

#[async_trait]
impl SubscriptionProvider for PatchNotesProvider {
    fn provider_type(&self) -> &str {
        "patch_notes"
    }

    fn get_available_sources(&self) -> Vec<AvailableNotificationSource> {
        vec![AvailableNotificationSource {
            id: "patch_notes".to_string(),
            title: "Java Patch Notes".to_string(),
            provider_type: "patch_notes".to_string(),
            target_url: Some(PATCH_NOTES_URL.to_string()),
            target_id: None,
            metadata: Some(serde_json::json!({ "types": ["release"] }).to_string()),
        }]
    }

    async fn check(&self, _app_handle: &tauri::AppHandle, sub: &NotificationSubscription) -> Result<Vec<NotificationUpdateItem>> {
        let url = sub.target_url.as_deref().unwrap_or(PATCH_NOTES_URL);
        let response = reqwest::get(url).await?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Failed to fetch patch notes from {}: {}", url, response.status()));
        }

        let response_data: PatchNotesResponse = response.json().await?;
        let entries = response_data.entries;

        // Filter by types if present in metadata (e.g. release, snapshot)
        let allowed_types: Vec<String> = sub.metadata.as_ref()
            .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
            .and_then(|v| {
                v.get("types")
                    .and_then(|t| t.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>())
            })
            .unwrap_or_default();

        let mut items = Vec::new();
        for entry in entries {
            if !allowed_types.is_empty() && !allowed_types.iter().any(|t| t.eq_ignore_ascii_case(&entry.version_type)) {
                continue;
            }

            items.push(NotificationUpdateItem {
                id: format!("patch-{}", entry.id),
                title: super::decode_title(&entry.title),
                description: Some(super::clean_and_truncate(&entry.body, 180)),
                link: Some(format!("https://www.minecraft.net/en-us/article/minecraft-java-edition-{}", entry.version.replace(".", "-"))),
                metadata: serde_json::json!({
                    "version": entry.version,
                    "type": entry.version_type,
                }),
                severity: Some("info".to_string()),
            });
        }

        Ok(items)
    }
}
