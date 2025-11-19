use crate::utils::db_manager::get_data_db;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Payload for creating or updating a notification
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationPayload {
    pub client_key: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub severity: String,
    pub persist: bool,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    pub metadata: Option<String>,
}

/// Sanitize notification input to prevent XSS and limit payload size
/// TODO: Review sanitization strategy - consider allowing safe HTML or using a proper sanitizer library
fn sanitize_notification_input(payload: &mut NotificationPayload) {
    // Strip HTML tags (basic approach - TODO: use proper HTML sanitizer)
    if let Some(ref mut title) = payload.title {
        *title = strip_html_tags(title);
        title.truncate(256); // Max 256 chars for title
    }
    
    if let Some(ref mut desc) = payload.description {
        *desc = strip_html_tags(desc);
        desc.truncate(4096); // Max 4KB for description
    }
    
    if let Some(ref mut meta) = payload.metadata {
        meta.truncate(4096); // Max 4KB for metadata JSON
    }
    
    // Validate severity
    let valid_severities = ["info", "success", "warning", "error", "debug"];
    if !valid_severities.contains(&payload.severity.as_str()) {
        payload.severity = "info".to_string();
    }
    
    // Validate progress range
    if let Some(progress) = payload.progress {
        if progress < -1 || progress > 100 {
            payload.progress = None;
        }
    }
}

/// Basic HTML tag stripper
/// TODO: Replace with proper sanitizer library (e.g., ammonia crate)
fn strip_html_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_tag = false;
    
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    
    result.trim().to_string()
}

/// Get database connection for notifications (uses data database)
fn get_db() -> Result<crate::utils::sqlite::SQLiteDB> {
    get_data_db()
}

/// Create or update a notification
/// If client_key is provided and exists, updates that notification
/// Returns the notification ID
#[tauri::command]
pub async fn create_notification(
    app_handle: AppHandle,
    mut payload: NotificationPayload,
) -> Result<i32, String> {
    sanitize_notification_input(&mut payload);
    
    let db = get_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    
    let now = chrono::Utc::now().to_rfc3339();
    
    // Check if notification with client_key exists
    let existing_id: Option<i32> = if let Some(ref client_key) = payload.client_key {
        conn.query_row(
            "SELECT id FROM notification WHERE client_key = ?1",
            [client_key],
            |row| row.get(0),
        ).ok()
    } else {
        None
    };
    
    let notification_id = if let Some(id) = existing_id {
        // Update existing notification
        conn.execute(
            "UPDATE notification SET title = ?1, description = ?2, severity = ?3, 
             persist = ?4, progress = ?5, current_step = ?6, total_steps = ?7, 
             metadata = ?8, updated_at = ?9 WHERE id = ?10",
            rusqlite::params![
                payload.title,
                payload.description,
                payload.severity,
                payload.persist as i32,
                payload.progress,
                payload.current_step,
                payload.total_steps,
                payload.metadata,
                now,
                id,
            ],
        ).map_err(|e| e.to_string())?;
        id
    } else {
        // Insert new notification
        conn.execute(
            "INSERT INTO notification (client_key, title, description, severity, persist, 
             progress, current_step, total_steps, read, metadata, created_at, updated_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, NULL)",
            rusqlite::params![
                payload.client_key,
                payload.title,
                payload.description,
                payload.severity,
                payload.persist as i32,
                payload.progress,
                payload.current_step,
                payload.total_steps,
                payload.metadata,
                now.clone(),
                now,
            ],
        ).map_err(|e| e.to_string())?;
        
        conn.last_insert_rowid() as i32
    };
    
    // Emit event to frontend
    let event_payload = serde_json::json!({
        "id": notification_id,
        "client_key": payload.client_key,
        "title": payload.title,
        "description": payload.description,
        "severity": payload.severity,
        "persist": payload.persist,
        "progress": payload.progress,
        "current_step": payload.current_step,
        "total_steps": payload.total_steps,
    });
    
    let _ = app_handle.emit("core://notification", event_payload);
    
    Ok(notification_id)
}

/// Update notification progress
#[tauri::command]
pub async fn update_notification_progress(
    app_handle: AppHandle,
    id_or_client_key: String,
    progress: i32,
    current_step: Option<i32>,
    total_steps: Option<i32>,
) -> Result<(), String> {
    let db = get_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    
    let now = chrono::Utc::now().to_rfc3339();
    
    // Try to parse as integer ID first, otherwise treat as client_key
    let rows_updated = if let Ok(id) = id_or_client_key.parse::<i32>() {
        conn.execute(
            "UPDATE notification SET progress = ?1, current_step = ?2, total_steps = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![progress, current_step, total_steps, now, id],
        )
    } else {
        conn.execute(
            "UPDATE notification SET progress = ?1, current_step = ?2, total_steps = ?3, updated_at = ?4 WHERE client_key = ?5",
            rusqlite::params![progress, current_step, total_steps, now, id_or_client_key],
        )
    }.map_err(|e| e.to_string())?;
    
    if rows_updated == 0 {
        return Err(format!("Notification not found: {}", id_or_client_key));
    }
    
    // Emit progress event to frontend
    let event_payload = serde_json::json!({
        "id_or_client_key": id_or_client_key,
        "progress": progress,
        "current_step": current_step,
        "total_steps": total_steps,
    });
    
    let _ = app_handle.emit("core://notification-progress", event_payload);
    
    Ok(())
}

/// List all notifications (optionally filter by persist status)
#[tauri::command]
pub async fn list_notifications(
    only_persisted: Option<bool>,
    only_unread: Option<bool>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = get_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    
    let mut query = "SELECT id, client_key, title, description, severity, persist, progress, 
                     current_step, total_steps, read, metadata, created_at, updated_at, expires_at 
                     FROM notification WHERE 1=1".to_string();
    
    if let Some(true) = only_persisted {
        query.push_str(" AND persist = 1");
    }
    
    if let Some(true) = only_unread {
        query.push_str(" AND read = 0");
    }
    
    query.push_str(" ORDER BY created_at DESC");
    
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    
    let notifications: Vec<serde_json::Value> = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i32>(0)?,
            "client_key": row.get::<_, Option<String>>(1)?,
            "title": row.get::<_, Option<String>>(2)?,
            "description": row.get::<_, Option<String>>(3)?,
            "severity": row.get::<_, String>(4)?,
            "persist": row.get::<_, i32>(5)? == 1,
            "progress": row.get::<_, Option<i32>>(6)?,
            "current_step": row.get::<_, Option<i32>>(7)?,
            "total_steps": row.get::<_, Option<i32>>(8)?,
            "read": row.get::<_, i32>(9)? == 1,
            "metadata": row.get::<_, Option<String>>(10)?,
            "created_at": row.get::<_, String>(11)?,
            "updated_at": row.get::<_, String>(12)?,
            "expires_at": row.get::<_, Option<String>>(13)?,
        }))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e: rusqlite::Error| e.to_string())?;
    
    Ok(notifications)
}

/// Mark a notification as read
#[tauri::command]
pub async fn mark_notification_read(
    app_handle: AppHandle,
    id_or_client_key: String,
) -> Result<(), String> {
    let db = get_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    
    let rows_updated = if let Ok(id) = id_or_client_key.parse::<i32>() {
        conn.execute(
            "UPDATE notification SET read = 1 WHERE id = ?1",
            [id],
        )
    } else {
        conn.execute(
            "UPDATE notification SET read = 1 WHERE client_key = ?1",
            [&id_or_client_key],
        )
    }.map_err(|e| e.to_string())?;
    
    if rows_updated == 0 {
        return Err(format!("Notification not found: {}", id_or_client_key));
    }
    
    let _ = app_handle.emit("core://notification-updated", serde_json::json!({
        "id_or_client_key": id_or_client_key,
        "read": true,
    }));
    
    Ok(())
}

/// Delete a notification
#[tauri::command]
pub async fn delete_notification(
    app_handle: AppHandle,
    id_or_client_key: String,
) -> Result<(), String> {
    let db = get_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    
    let rows_deleted = if let Ok(id) = id_or_client_key.parse::<i32>() {
        conn.execute("DELETE FROM notification WHERE id = ?1", [id])
    } else {
        conn.execute("DELETE FROM notification WHERE client_key = ?1", [&id_or_client_key])
    }.map_err(|e| e.to_string())?;
    
    if rows_deleted == 0 {
        return Err(format!("Notification not found: {}", id_or_client_key));
    }
    
    let _ = app_handle.emit("core://notification-updated", serde_json::json!({
        "id_or_client_key": id_or_client_key,
        "deleted": true,
    }));
    
    Ok(())
}

/// Clean up old notifications based on retention policy
#[tauri::command]
pub async fn cleanup_notifications(retention_days: i32) -> Result<usize, String> {
    let db = get_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    
    let cutoff_date = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
    let cutoff_str = cutoff_date.to_rfc3339();
    
    let rows_deleted = conn.execute(
        "DELETE FROM notification WHERE created_at < ?1 AND read = 1",
        [cutoff_str],
    ).map_err(|e| e.to_string())?;
    
    Ok(rows_deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_html_tags() {
        assert_eq!(strip_html_tags("<p>Hello</p>"), "Hello");
        assert_eq!(strip_html_tags("<div>Test <b>bold</b> text</div>"), "Test bold text");
        assert_eq!(strip_html_tags("No tags here"), "No tags here");
        assert_eq!(strip_html_tags("<script>alert('xss')</script>"), "alert('xss')");
    }

    #[test]
    fn test_sanitize_notification_input() {
        let mut payload = NotificationPayload {
            client_key: Some("test".to_string()),
            title: Some("<b>Title</b>".to_string()),
            description: Some("<script>XSS</script>".to_string()),
            severity: "invalid".to_string(),
            persist: true,
            progress: Some(150), // Out of range
            current_step: None,
            total_steps: None,
            metadata: Some("{}".to_string()),
        };
        
        sanitize_notification_input(&mut payload);
        
        assert_eq!(payload.title, Some("Title".to_string()));
        assert_eq!(payload.description, Some("XSS".to_string()));
        assert_eq!(payload.severity, "info"); // Invalid severity corrected
        assert_eq!(payload.progress, None); // Out of range removed
    }
}

// Test commands for the notification test page
#[tauri::command]
pub async fn test_notification_info(app: tauri::AppHandle) -> Result<i32, String> {
    create_notification(
        app,
        NotificationPayload {
            title: Some("Info Message".to_string()),
            description: Some("This is an ephemeral info notification".to_string()),
            severity: "info".to_string(),
            persist: false,
            progress: None,
            current_step: None,
            total_steps: None,
            client_key: None,
            metadata: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn test_notification_success(app: tauri::AppHandle) -> Result<i32, String> {
    create_notification(
        app,
        NotificationPayload {
            title: Some("Success!".to_string()),
            description: Some("Operation completed successfully".to_string()),
            severity: "success".to_string(),
            persist: false,
            progress: None,
            current_step: None,
            total_steps: None,
            client_key: None,
            metadata: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn test_notification_warning(app: tauri::AppHandle) -> Result<i32, String> {
    create_notification(
        app,
        NotificationPayload {
            title: Some("Warning Alert".to_string()),
            description: Some("This is a persistent warning that will stay in the sidebar".to_string()),
            severity: "warning".to_string(),
            persist: true,
            progress: None,
            current_step: None,
            total_steps: None,
            client_key: None,
            metadata: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn test_notification_error(app: tauri::AppHandle) -> Result<i32, String> {
    create_notification(
        app,
        NotificationPayload {
            title: Some("Error Occurred".to_string()),
            description: Some("Something went wrong and needs your attention".to_string()),
            severity: "error".to_string(),
            persist: true,
            progress: None,
            current_step: None,
            total_steps: None,
            client_key: None,
            metadata: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn test_notification_pulsing(app: tauri::AppHandle) -> Result<i32, String> {
    let client_key = format!("pulsing_task_{}", chrono::Utc::now().timestamp_millis());
    
    let notif_id = create_notification(
        app.clone(),
        NotificationPayload {
            title: Some("Processing...".to_string()),
            description: Some("Task in progress with indeterminate duration".to_string()),
            severity: "info".to_string(),
            persist: false,
            progress: Some(-1), // Pulsing animation
            current_step: None,
            total_steps: None,
            client_key: Some(client_key.clone()),
            metadata: None,
        },
    )
    .await?;

    // Auto-complete after 3 seconds
    let app_clone = app.clone();
    let key_clone = client_key.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        let _ = update_notification_progress(
            app_clone,
            key_clone,
            100,
            None,
            None,
        )
        .await;
    });

    Ok(notif_id)
}

#[tauri::command]
pub async fn test_notification_progress(app: tauri::AppHandle) -> Result<i32, String> {
    let client_key = format!("progress_task_{}", chrono::Utc::now().timestamp_millis());
    
    let notif_id = create_notification(
        app.clone(),
        NotificationPayload {
            title: Some("Downloading Files".to_string()),
            description: Some("Installing modpack dependencies...".to_string()),
            severity: "info".to_string(),
            persist: true,
            progress: Some(0),
            current_step: Some(0),
            total_steps: Some(10),
            client_key: Some(client_key.clone()),
            metadata: None,
        },
    )
    .await?;

    // Simulate progress updates
    let app_clone = app.clone();
    let key_clone = client_key.clone();
    tauri::async_runtime::spawn(async move {
        for i in 1..=10 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            let _ = update_notification_progress(
                app_clone.clone(),
                key_clone.clone(),
                (i * 100) / 10,
                Some(i),
                Some(10),
            )
            .await;
        }
    });

    Ok(notif_id)
}

#[tauri::command]
pub async fn test_notification_multiple(app: tauri::AppHandle) -> Result<(), String> {
    let notifications = vec![
        ("First notification", "info", "This is info notification"),
        ("Second notification", "success", "This is success notification"),
        ("Third notification", "warning", "This is warning notification"),
        ("Fourth notification", "error", "This is error notification"),
    ];

    for (title, severity, description) in notifications {
        create_notification(
            app.clone(),
            NotificationPayload {
                title: Some(title.to_string()),
                description: Some(description.to_string()),
                severity: severity.to_string(),
                persist: false,
                progress: None,
                current_step: None,
                total_steps: None,
                client_key: None,
                metadata: None,
            },
        )
        .await?;
        
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    Ok(())
}
