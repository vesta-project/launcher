use crate::schema::notification;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// Notification model for persisted notifications with flexible types
#[derive(Queryable, Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = notification)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Notification {
    pub id: i32,
    pub client_key: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub severity: String,
    pub notification_type: String,
    pub dismissible: bool,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    pub read: bool,
    pub actions: Option<String>,
    pub metadata: Option<String>,
    pub show_on_completion: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: Option<String>,
}

/// New notification (without id for insertion)
#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = notification)]
pub struct NewNotification {
    pub client_key: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub severity: String,
    pub notification_type: String,
    pub dismissible: bool,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    pub read: bool,
    pub actions: Option<String>,
    pub metadata: Option<String>,
    pub show_on_completion: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: Option<String>,
}
