use tauri::{State};
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, Notification, NotificationType};
use crate::notifications::store::NotificationStore;
use serde::Deserialize;

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

    state.update_progress(
        id_or_key, 
        payload.progress.unwrap_or(0), 
        payload.current_step, 
        payload.total_steps
    ).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct NotificationFilters {
    pub notification_type: Option<String>,
    pub read: Option<bool>,
    pub severity: Option<String>,
}

#[tauri::command]
pub async fn list_notifications(
    state: State<'_, NotificationManager>,
    filters: Option<NotificationFilters>,
) -> Result<Vec<Notification>, String> {
    // For backward compatibility, if notification_type is not specified, default to listing persisted notifications
    let only_persisted = filters.as_ref()
        .and_then(|f| f.notification_type.as_ref())
        .map(|_| true)
        .unwrap_or(false);
    let only_unread = filters.as_ref().and_then(|f| f.read).map(|r| !r).unwrap_or(false);
    
    let notifications = state.list(only_persisted, only_unread).map_err(|e| e.to_string())?;
    println!("list_notifications returning {} notifications", notifications.len());
    for n in &notifications {
        println!("  - {}: type={:?}, dismissible={}, progress={:?}", n.title, n.notification_type, n.dismissible, n.progress);
    }
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
) -> Result<(), String> {
    state.invoke_action(&action_id, client_key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_notifications(
    retention_days: i32,
) -> Result<usize, String> {
    NotificationStore::cleanup(retention_days).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_immediate_notifications(
    state: State<'_, NotificationManager>,
) -> Result<(), String> {
    state.clear_immediate_notifications().map_err(|e| e.to_string())
}

// Test commands
#[tauri::command]
pub async fn test_notification_info(state: State<'_, NotificationManager>) -> Result<i32, String> {
    state.create(CreateNotificationInput {
        title: Some("Info Message".to_string()),
        description: Some("This is an ephemeral info notification".to_string()),
        severity: Some("info".to_string()),
        notification_type: Some(NotificationType::Immediate),
        dismissible: Some(true),
        actions: None,
        progress: None,
        current_step: None,
        total_steps: None,
        client_key: None,
        metadata: None,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_notification_success(state: State<'_, NotificationManager>) -> Result<i32, String> {
    state.create(CreateNotificationInput {
        title: Some("Success!".to_string()),
        description: Some("Operation completed successfully".to_string()),
        severity: Some("success".to_string()),
        notification_type: Some(NotificationType::Immediate),
        dismissible: Some(true),
        actions: None,
        progress: None,
        current_step: None,
        total_steps: None,
        client_key: None,
        metadata: None,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_notification_warning(state: State<'_, NotificationManager>) -> Result<i32, String> {
    state.create(CreateNotificationInput {
        title: Some("Warning Alert".to_string()),
        description: Some("This is a persistent warning".to_string()),
        severity: Some("warning".to_string()),
        notification_type: Some(NotificationType::Patient),
        dismissible: Some(true),
        actions: None,
        progress: None,
        current_step: None,
        total_steps: None,
        client_key: None,
        metadata: None,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_notification_error(state: State<'_, NotificationManager>) -> Result<i32, String> {
    state.create(CreateNotificationInput {
        title: Some("Error Occurred".to_string()),
        description: Some("Something went wrong".to_string()),
        severity: Some("error".to_string()),
        notification_type: Some(NotificationType::Patient),
        dismissible: Some(true),
        actions: None,
        progress: None,
        current_step: None,
        total_steps: None,
        client_key: None,
        metadata: None,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_notification_pulsing(state: State<'_, NotificationManager>) -> Result<i32, String> {
    let client_key = format!("pulsing_task_{}", chrono::Utc::now().timestamp_millis());
    
    let id = state.create(CreateNotificationInput {
        title: Some("Processing...".to_string()),
        description: Some("Task in progress".to_string()),
        severity: Some("info".to_string()),
        notification_type: Some(NotificationType::Progress),
        dismissible: Some(false),
        actions: None,
        progress: Some(-1),
        current_step: None,
        total_steps: None,
        client_key: Some(client_key.clone()),
        metadata: None,
    }).map_err(|e| e.to_string())?;

    let manager = state.inner().clone();
    let key = client_key.clone();
    
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        let _ = manager.update_progress(key, 100, None, None);
    });

    Ok(id)
}

#[tauri::command]
pub async fn test_notification_progress(state: State<'_, NotificationManager>) -> Result<i32, String> {
    let client_key = format!("progress_task_{}", chrono::Utc::now().timestamp_millis());
    
    let id = state.create(CreateNotificationInput {
        title: Some("Downloading Files".to_string()),
        description: Some("Installing modpack dependencies...".to_string()),
        severity: Some("info".to_string()),
        notification_type: Some(NotificationType::Progress),
        dismissible: Some(false),
        actions: None,
        progress: Some(0),
        current_step: Some(0),
        total_steps: Some(10),
        client_key: Some(client_key.clone()),
        metadata: None,
    }).map_err(|e| e.to_string())?;

    let manager = state.inner().clone();
    let key = client_key.clone();

    tauri::async_runtime::spawn(async move {
        for i in 1..=10 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            let _ = manager.update_progress(key.clone(), (i * 100) / 10, Some(i), Some(10));
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn test_notification_multiple(state: State<'_, NotificationManager>) -> Result<(), String> {
    let notifications = vec![
        ("First notification", "info", "This is info notification"),
        ("Second notification", "success", "This is success notification"),
        ("Third notification", "warning", "This is warning notification"),
        ("Fourth notification", "error", "This is error notification"),
    ];

    for (title, severity, description) in notifications {
        state.create(CreateNotificationInput {
            title: Some(title.to_string()),
            description: Some(description.to_string()),
            severity: Some(severity.to_string()),
            notification_type: Some(NotificationType::Immediate),
            dismissible: Some(true),
            actions: None,
            progress: None,
            current_step: None,
            total_steps: None,
            client_key: None,
            metadata: None,
        }).map_err(|e| e.to_string())?;
        
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    Ok(())
}
