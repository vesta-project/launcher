use crate::schema::notification_subscriptions;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Insertable, AsChangeset, Identifiable, Clone)]
#[diesel(table_name = notification_subscriptions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct NotificationSubscription {
    pub id: String,
    pub provider_type: String, // news, patch_notes, rss, resource, game
    pub target_url: Option<String>,
    pub target_id: Option<String>,
    pub title: String,
    pub enabled: bool,
    pub metadata: Option<String>, // JSON for filters (tags, types, etc.)
    pub last_checked: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = notification_subscriptions)]
pub struct NewNotificationSubscription {
    pub id: String,
    pub provider_type: String,
    pub target_url: Option<String>,
    pub target_id: Option<String>,
    pub title: String,
    pub enabled: bool,
    pub metadata: Option<String>,
    pub last_checked: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
