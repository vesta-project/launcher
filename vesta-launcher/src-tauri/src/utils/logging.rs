//! Structured logging system with notification support
//!
//! This module provides structured logging using the `log` crate and optional
//! notification emission for important events.

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Log an info message
pub fn info(text: &str) {
    log::info!("{}", text);
}

/// Log a debug message
pub fn debug(text: &str) {
    log::debug!("{}", text);
}

/// Log a warning message
pub fn warn(text: &str) {
    log::warn!("{}", text);
}

/// Log an error message
pub fn error(text: &str) {
    log::error!("{}", text);
}

#[derive(Serialize, Debug)]
pub struct LogEvent<'a> {
    pub level: &'a str,
    pub title: Option<&'a str>,
    pub message: &'a str,
}

/// Emit a notification event to the frontend
/// 
/// This function both logs the message and optionally creates a persisted notification
/// based on the severity level and app configuration.
/// 
/// # Examples
/// 
/// ```no_run
/// use crate::utils::logging::emit_notification;
/// 
/// // emit_notification(&app_handle, "error", Some("Task Failed"), "Download failed", true, Some("download:123"));
/// ```
/// 
/// TODO: Add proper integration with AppConfig to check debug_logging flag
/// TODO: Consider adding rate limiting to prevent notification spam
pub fn emit_notification(
    app_handle: &AppHandle,
    level: &str,
    title: Option<&str>,
    message: &str,
    persist: bool,
    client_key: Option<String>,
) {
    // Log with appropriate level
    match level {
        "info" => log::info!("[{}] {}", title.unwrap_or("Info"), message),
        "success" => log::info!("[{}] {}", title.unwrap_or("Success"), message),
        "warning" | "warn" => log::warn!("[{}] {}", title.unwrap_or("Warning"), message),
        "error" => log::error!("[{}] {}", title.unwrap_or("Error"), message),
        "debug" => log::debug!("[{}] {}", title.unwrap_or("Debug"), message),
        _ => log::info!("[{}] {}", title.unwrap_or("Log"), message),
    }
    
    // TODO: Check AppConfig.debug_logging before emitting debug notifications
    // For now, always emit for error and warning levels when persist=true
    if persist && (level == "error" || level == "warning" || level == "warn") {
        use crate::notifications::manager::NotificationManager;
        use crate::notifications::models::{CreateNotificationInput, NotificationType};
        
        let input = CreateNotificationInput {
            client_key,
            title: title.map(|s| s.to_string()),
            description: Some(message.to_string()),
            severity: Some(level.to_string()),
            notification_type: Some(if persist { NotificationType::Patient } else { NotificationType::Immediate }),
            dismissible: Some(true),
            actions: None,
            progress: None,
            current_step: None,
            total_steps: None,
            metadata: None,
        };
        
        // Fire and forget - don't block on notification creation
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.create(input);
        });
    }
}