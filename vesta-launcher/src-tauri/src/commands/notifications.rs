use crate::models::NotificationSubscription;
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, Notification};
use crate::notifications::store::NotificationStore;
use crate::notifications::subscriptions::manager::SubscriptionManager;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
pub struct UpdateProgressPayload {
    pub id: Option<i32>,
    pub client_key: Option<String>,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
}

#[tauri::command]
pub async fn create_notification(
    state: State<'_, NotificationManager>,
    payload: CreateNotificationInput,
) -> Result<i32, String> {
    state.create(payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_notification_progress(
    state: State<'_, NotificationManager>,
    payload: UpdateProgressPayload,
) -> Result<(), String> {
    let id_or_key = if let Some(id) = payload.id {
        id.to_string()
    } else if let Some(key) = payload.client_key {
        key
    } else {
        return Err("Missing id or client_key".to_string());
    };

    state
        .update_progress(
            id_or_key,
            payload.progress.unwrap_or(0),
            payload.current_step,
            payload.total_steps,
        )
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct NotificationFilters {
    pub notification_type: Option<String>,
    pub read: Option<bool>,
    pub _severity: Option<String>,
}

#[tauri::command]
pub async fn list_notifications(
    state: State<'_, NotificationManager>,
    filters: Option<NotificationFilters>,
) -> Result<Vec<Notification>, String> {
    let only_persisted = filters
        .as_ref()
        .and_then(|f| f.notification_type.as_ref())
        .map(|_| true)
        .unwrap_or(false);
    let only_unread = filters
        .as_ref()
        .and_then(|f| f.read)
        .map(|r| !r)
        .unwrap_or(false);

    let notifications = state
        .list(only_persisted, only_unread)
        .map_err(|e| e.to_string())?;
    // println!("list_notifications returning {} notifications", notifications.len());
    // for n in &notifications {
    //     println!("  - {}: type={:?}, dismissible={}, progress={:?}", n.title, n.notification_type, n.dismissible, n.progress);
    // }
    Ok(notifications)
}

#[tauri::command]
pub async fn mark_notification_read(
    state: State<'_, NotificationManager>,
    id: serde_json::Value,
) -> Result<(), String> {
    let id_str = if id.is_number() {
        id.as_i64().unwrap().to_string()
    } else {
        id.as_str().unwrap_or("").to_string()
    };
    state.mark_read(id_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_notification(
    state: State<'_, NotificationManager>,
    id: serde_json::Value,
) -> Result<(), String> {
    let id_str = if id.is_number() {
        id.as_i64().unwrap().to_string()
    } else {
        id.as_str().unwrap_or("").to_string()
    };
    state.delete(id_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn invoke_notification_action(
    state: State<'_, NotificationManager>,
    action_id: String,
    client_key: Option<String>,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    state
        .invoke_action(&action_id, client_key, payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_notifications(retention_days: i32) -> Result<usize, String> {
    NotificationStore::cleanup(retention_days).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_immediate_notifications(
    state: State<'_, NotificationManager>,
) -> Result<(), String> {
    state
        .clear_immediate_notifications()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_dismissible_notifications(
    state: State<'_, NotificationManager>,
) -> Result<usize, String> {
    state
        .clear_all_dismissible_notifications()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_notification_subscriptions(
    sm: State<'_, Arc<SubscriptionManager>>,
) -> Result<Vec<NotificationSubscription>, String> {
    sm.get_all_subscriptions().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_available_notification_sources(
    sm: State<'_, Arc<SubscriptionManager>>,
) -> Result<Vec<crate::notifications::subscriptions::AvailableNotificationSource>, String> {
    Ok(sm.get_available_sources())
}

#[tauri::command]
pub async fn reset_notification_system(
    nm: State<'_, NotificationManager>,
    sm: State<'_, Arc<SubscriptionManager>>,
) -> Result<(), String> {
    // 1. Reset seen items
    sm.reset_system().map_err(|e| e.to_string())?;

    // 2. Clear all notifications (hard reset)
    let all = nm.list(false, false).map_err(|e| e.to_string())?;
    for n in all {
        if let Some(id) = n.id {
            let _ = nm.delete(id.to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn subscribe_to_preset_source(
    sm: State<'_, Arc<SubscriptionManager>>,
    source: crate::notifications::subscriptions::AvailableNotificationSource,
) -> Result<String, String> {
    sm.subscribe(
        source.provider_type,
        source.title,
        source.target_url,
        source.target_id,
        source.metadata,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_notification_subscription(
    sm: State<'_, Arc<SubscriptionManager>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    sm.toggle_subscription(id, enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_notification_subscription_metadata(
    sm: State<'_, Arc<SubscriptionManager>>,
    id: String,
    metadata: String,
) -> Result<(), String> {
    sm.update_metadata(id, metadata)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_notification_subscription(
    sm: State<'_, Arc<SubscriptionManager>>,
    id: String,
) -> Result<(), String> {
    sm.delete_subscription(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn subscribe_to_resource_updates(
    sm: State<'_, Arc<SubscriptionManager>>,
    project_id: String,
    platform: String,
    title: String,
) -> Result<String, String> {
    sm.subscribe_resource(project_id, platform, title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn subscribe_to_rss(
    sm: State<'_, Arc<SubscriptionManager>>,
    url: String,
    title: String,
) -> Result<String, String> {
    sm.subscribe_rss(url, title).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_notifications_now(
    sm: State<'_, Arc<SubscriptionManager>>,
) -> Result<(), String> {
    sm.check_all().await.map_err(|e| e.to_string())
}
