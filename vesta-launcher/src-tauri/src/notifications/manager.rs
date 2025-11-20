use tauri::{AppHandle, Emitter};
use crate::notifications::models::{Notification, CreateNotificationInput, NotificationType, NotificationSeverity};
use crate::notifications::store::NotificationStore;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Action handler trait for notification actions
pub trait ActionHandler: Send + Sync {
    fn handle(&self, app_handle: &AppHandle, client_key: Option<String>) -> Result<()>;
}

#[derive(Clone)]
pub struct NotificationManager {
    app_handle: AppHandle,
    action_registry: Arc<Mutex<HashMap<String, Arc<dyn ActionHandler>>>>,
}

impl NotificationManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let manager = Self { 
            app_handle,
            action_registry: Arc::new(Mutex::new(HashMap::new())),
        };
        
        // Register built-in action handlers
        // TODO: Implement these handlers
        // manager.register_action("cancel_task", ...);
        // manager.register_action("pause_task", ...);
        
        manager
    }

    /// Register an action handler
    pub fn register_action(&self, action_id: &str, handler: Arc<dyn ActionHandler>) {
        let mut registry = self.action_registry.lock().unwrap();
        registry.insert(action_id.to_string(), handler);
    }

    /// Invoke an action handler
    pub fn invoke_action(&self, action_id: &str, client_key: Option<String>) -> Result<()> {
        let registry = self.action_registry.lock().unwrap();
        if let Some(handler) = registry.get(action_id) {
            handler.handle(&self.app_handle, client_key)?;
        } else {
            anyhow::bail!("Action handler not found: {}", action_id);
        }
        Ok(())
    }

    pub fn create(&self, input: CreateNotificationInput) -> Result<i32> {
        let now = chrono::Utc::now().to_rfc3339();
        
        let severity = input.severity
            .map(|s| NotificationSeverity::from(s))
            .unwrap_or(NotificationSeverity::Info);
        
        let mut notification = Notification {
            id: None,
            client_key: input.client_key.clone(),
            title: input.title.unwrap_or_else(|| "Notification".to_string()),
            description: input.description,
            severity,
            notification_type: input.notification_type.unwrap_or(NotificationType::Immediate),
            dismissible: input.dismissible.unwrap_or(true),
            actions: input.actions.unwrap_or_default(),
            read: false,
            progress: input.progress,
            current_step: input.current_step,
            total_steps: input.total_steps,
            metadata: input.metadata,
            created_at: now.clone(),
            updated_at: now,
            expires_at: None,
        };

        // Check if we should update an existing notification by client_key
        if let Some(ref key) = notification.client_key {
            if let Ok(Some(existing)) = NotificationStore::get_by_client_key(key) {
                if let Some(id) = existing.id {
                    notification.id = Some(id);
                    // Preserve creation time
                    notification.created_at = existing.created_at;
                    NotificationStore::update(id, &notification)?;
                    
                    self.app_handle.emit("core://notification", &notification)?;
                    return Ok(id);
                }
            }
        }

        let id = NotificationStore::create(&notification)?;
        notification.id = Some(id);
        
        self.app_handle.emit("core://notification", &notification)?;
        
        Ok(id)
    }

    pub fn update_progress(&self, id_or_key: String, progress: i32, current_step: Option<i32>, total_steps: Option<i32>) -> Result<()> {
        println!("NotificationManager: Updating progress for {} to {}%", id_or_key, progress);
        let notification_opt = if let Ok(id) = id_or_key.parse::<i32>() {
            NotificationStore::get_by_id(id)?
        } else {
            NotificationStore::get_by_client_key(&id_or_key)?
        };

        if let Some(mut notification) = notification_opt {
            println!("NotificationManager: Found notification with {} actions", notification.actions.len());
            notification.progress = Some(progress);
            notification.current_step = current_step;
            notification.total_steps = total_steps;
            notification.updated_at = chrono::Utc::now().to_rfc3339();

            // Auto-convert Progress → Patient when complete
            if progress >= 100 && notification.notification_type == NotificationType::Progress {
                println!("NotificationManager: Converting Progress → Patient (completed), dismissible was: {}, setting to true", notification.dismissible);
                notification.notification_type = NotificationType::Patient;
                notification.dismissible = true;
                // Clear actions when converting to Patient (task is done, can't cancel)
                notification.actions.clear();
                println!("NotificationManager: Converted notification - type: {:?}, dismissible: {}, actions: {}", notification.notification_type, notification.dismissible, notification.actions.len());
            }

            if let Some(id) = notification.id {
                println!("NotificationManager: Saving notification with {} actions", notification.actions.len());
                NotificationStore::update(id, &notification)?;
            } else {
                println!("NotificationManager: Warning - Notification has no ID, skipping DB update");
            }
            
            println!("NotificationManager: Emitting progress event for {} - type: {:?}, dismissible: {}, progress: {:?}", 
                notification.client_key.as_deref().unwrap_or("unknown"), 
                notification.notification_type, 
                notification.dismissible, 
                notification.progress);
            self.app_handle.emit("core://notification-progress", &notification)?;
        } else {
            println!("NotificationManager: Notification not found for {}", id_or_key);
        }
        Ok(())
    }

    pub fn list(&self, only_persisted: bool, only_unread: bool) -> Result<Vec<Notification>> {
        NotificationStore::list(only_persisted, only_unread)
    }

    pub fn mark_read(&self, id_or_key: String) -> Result<()> {
        let id = if let Ok(id) = id_or_key.parse::<i32>() {
            id
        } else {
            if let Some(n) = NotificationStore::get_by_client_key(&id_or_key)? {
                n.id.unwrap_or(0)
            } else {
                return Ok(());
            }
        };

        if id > 0 {
            NotificationStore::mark_read(id)?;
            self.app_handle.emit("core://notification-updated", serde_json::json!({
                "id": id,
                "read": true
            }))?;
        }
        Ok(())
    }

    pub fn delete(&self, id_or_key: String) -> Result<()> {
        // TODO: Alert notifications should require privileged dismissal mechanism
        // Current implementation allows all notifications to be deleted
        // Future: Add permission check for Alert type dismissal
        
        let id = if let Ok(id) = id_or_key.parse::<i32>() {
            id
        } else {
            if let Some(n) = NotificationStore::get_by_client_key(&id_or_key)? {
                n.id.unwrap_or(0)
            } else {
                return Ok(());
            }
        };

        if id > 0 {
            NotificationStore::delete(id)?;
            self.app_handle.emit("core://notification-updated", serde_json::json!({
                "id": id,
                "deleted": true
            }))?;
        }
        Ok(())
    }

    /// Clear all Immediate notifications (should be called on app startup)
    pub fn clear_immediate_notifications(&self) -> Result<()> {
        NotificationStore::clear_immediate_notifications()?;
        Ok(())
    }
}
