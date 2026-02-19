use anyhow::Result;
use async_trait::async_trait;
use crate::models::NotificationSubscription;
use serde::{Deserialize, Serialize};

pub mod manager;
pub mod providers;

#[async_trait]
pub trait SubscriptionProvider: Send + Sync {
    fn provider_type(&self) -> &str;
    async fn check(&self, app_handle: &tauri::AppHandle, sub: &NotificationSubscription) -> Result<Vec<NotificationUpdateItem>>;
    fn get_available_sources(&self) -> Vec<AvailableNotificationSource> {
        vec![]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableNotificationSource {
    pub id: String, // internal id or preset key
    pub title: String,
    pub provider_type: String,
    pub target_url: Option<String>,
    pub target_id: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationUpdateItem {
    pub id: String, // unique ID for seen tracking
    pub title: String,
    pub description: Option<String>,
    pub link: Option<String>,
    pub metadata: serde_json::Value,
    pub severity: Option<String>,
}

pub fn clean_and_truncate(text: &str, max_len: usize) -> String {
    // 1. Strip HTML tags
    let mut cleaned = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            cleaned.push(c);
        }
    }

    // 2. Decode entities (like &amp;)
    let decoded = html_escape::decode_html_entities(&cleaned);

    // 3. Normalize whitespace
    let normalized = decoded.split_whitespace().collect::<Vec<_>>().join(" ");

    // 4. Truncate
    if normalized.chars().count() <= max_len {
        normalized
    } else {
        let truncated: String = normalized.chars().take(max_len - 3).collect();
        format!("{}...", truncated)
    }
}

pub fn decode_title(title: &str) -> String {
    html_escape::decode_html_entities(title).into_owned()
}
