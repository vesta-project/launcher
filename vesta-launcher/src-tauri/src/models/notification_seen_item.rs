use crate::schema::notification_seen_items;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Insertable, Identifiable, Clone, Associations)]
#[diesel(table_name = notification_seen_items)]
#[diesel(belongs_to(crate::models::notification_subscription::NotificationSubscription, foreign_key = subscription_id))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct NotificationSeenItem {
    pub id: i32,
    pub subscription_id: String,
    pub item_id: String,
    pub seen_at: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = notification_seen_items)]
pub struct NewNotificationSeenItem {
    pub subscription_id: String,
    pub item_id: String,
    pub seen_at: String,
}
