use crate::notifications::models::{
    CreateNotificationInput, Notification, NotificationSeverity, NotificationType,
};
use crate::notifications::store::NotificationStore;
use crate::tasks::manager::TaskManager;
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Action handler trait for notification actions
pub trait ActionHandler: Send + Sync {
    fn handle(&self, app_handle: &AppHandle, client_key: Option<String>) -> Result<()>;
}

/// Handler that cancels running tasks when the notification action 'cancel_task' is invoked.
struct CancelTaskHandler {}

impl ActionHandler for CancelTaskHandler {
    fn handle(&self, app_handle: &AppHandle, client_key: Option<String>) -> Result<()> {
        // Defensive: client_key is required for task cancellation
        let key = match client_key {
            Some(k) => k,
            None => anyhow::bail!("Missing client_key for cancel_task action"),
        };

        // Resolve TaskManager from app state and forward cancellation
        // NOTE: `try_state` may not be available on older Tauri versions; use `state` which is
        // present and will panic if not registered. Tests/registering TaskManager should ensure
        // it is managed on app start. If it's missing at runtime, return an error instead of panicking.
        let tm = app_handle.state::<TaskManager>();
        tm.cancel_task(&key).map_err(|e: String| anyhow::anyhow!(e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::models::{Notification, NotificationSeverity, NotificationType};

    // Helper to build a minimal Tauri app for manager tests
    // NOTE: Upsert tests disabled on Windows due to Tauri event loop constraints (must run on main thread).
    // Integration tests should cover upsert behavior in a runtime context.

    #[test]
    fn should_persist_when_notification_flag_true() {
        let n = Notification {
            id: Some(1),
            client_key: Some("task_1".to_string()),
            title: "t".to_string(),
            description: None,
            severity: NotificationSeverity::Info,
            notification_type: NotificationType::Progress,
            dismissible: false,
            read: false,
            progress: Some(50),
            current_step: None,
            total_steps: None,
            actions: vec![],
            metadata: None,
            created_at: String::new(),
            updated_at: String::new(),
            expires_at: None,
            show_on_completion: Some(true),
        };

        let keys = HashSet::new();
        let ids = HashSet::new();

        assert!(NotificationManager::should_persist_on_completion(
            &n, &keys, &ids
        ));
    }

    #[test]
    fn should_persist_when_key_registered() {
        let n = Notification {
            id: Some(2),
            client_key: Some("task_keep".to_string()),
            title: "t2".to_string(),
            description: None,
            severity: NotificationSeverity::Info,
            notification_type: NotificationType::Progress,
            dismissible: false,
            read: false,
            progress: Some(99),
            current_step: None,
            total_steps: None,
            actions: vec![],
            metadata: None,
            created_at: String::new(),
            updated_at: String::new(),
            expires_at: None,
            show_on_completion: None,
        };

        let mut keys = HashSet::new();
        keys.insert("task_keep".to_string());
        let ids = HashSet::new();

        assert!(NotificationManager::should_persist_on_completion(
            &n, &keys, &ids
        ));
    }

    #[test]
    fn should_persist_when_id_registered() {
        let n = Notification {
            id: Some(99),
            client_key: None,
            title: "t3".to_string(),
            description: None,
            severity: NotificationSeverity::Info,
            notification_type: NotificationType::Progress,
            dismissible: false,
            read: false,
            progress: Some(100),
            current_step: None,
            total_steps: None,
            actions: vec![],
            metadata: None,
            created_at: String::new(),
            updated_at: String::new(),
            expires_at: None,
            show_on_completion: None,
        };

        let keys = HashSet::new();
        let mut ids = HashSet::new();
        ids.insert(99);

        assert!(NotificationManager::should_persist_on_completion(
            &n, &keys, &ids
        ));
    }

    #[test]
    fn should_not_persist_by_default() {
        let n = Notification {
            id: Some(123),
            client_key: Some("task_auto".to_string()),
            title: "t4".to_string(),
            description: None,
            severity: NotificationSeverity::Info,
            notification_type: NotificationType::Progress,
            dismissible: false,
            read: false,
            progress: Some(100),
            current_step: None,
            total_steps: None,
            actions: vec![],
            metadata: None,
            created_at: String::new(),
            updated_at: String::new(),
            expires_at: None,
            show_on_completion: None,
        };

        let keys = HashSet::new();
        let ids = HashSet::new();

        assert!(!NotificationManager::should_persist_on_completion(
            &n, &keys, &ids
        ));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn invoke_action_dispatches_to_registered_handler() {
        // Build a minimal tauri app handle for testing
        let app = Builder::default()
            .build(tauri::generate_context!())
            .unwrap();
        let handle = app.handle();

        let manager = NotificationManager::new(handle.clone());

        // shared capture for test
        let captured: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let cap_clone = captured.clone();

        struct TestHandler {
            cap: Arc<Mutex<Option<String>>>,
        }

        impl super::ActionHandler for TestHandler {
            fn handle(&self, _app_handle: &AppHandle, client_key: Option<String>) -> Result<()> {
                let mut g = self.cap.lock().unwrap();
                *g = client_key;
                Ok(())
            }
        }

        manager.register_action("test_invoker", Arc::new(TestHandler { cap: cap_clone }));

        manager
            .invoke_action("test_invoker", Some("task_abc".to_string()))
            .unwrap();

        // check captured key
        let g = captured.lock().unwrap();
        assert_eq!(g.as_deref(), Some("task_abc"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn integration_cancel_task_flow() {
        // Build app and managers
        let app = Builder::default()
            .build(tauri::generate_context!())
            .unwrap();
        let handle = app.handle();

        // Initialize managers and add to app state
        let notification_manager = NotificationManager::new(handle.clone());
        let task_manager = crate::tasks::manager::TaskManager::new(handle.clone());

        // Move managers into app state so handlers/commands can access them.
        handle.manage(notification_manager.clone());
        handle.manage(task_manager);

        // Submit a TestTask that runs for several seconds so there's time to cancel
        let task = crate::tasks::manager::TestTask {
            title: "cancel-integration-test".to_string(),
            duration_secs: 8,
        };

        // Submit task via app-managed TaskManager
        let tm_state = handle.state::<crate::tasks::manager::TaskManager>();
        tauri::async_runtime::block_on(tm_state.submit(Box::new(task))).expect("submit ok");

        // Wait for NotificationStore to contain our task notification and capture client_key
        let start = Instant::now();
        let client_key = loop {
            // look for a notification with our task title
            let all = NotificationStore::list(false, false).unwrap_or_default();
            if let Some(n) = all.into_iter().find(|n| {
                n.client_key
                    .as_ref()
                    .map(|k| k.starts_with("task_"))
                    .unwrap_or(false)
                    && n.title.contains("cancel-integration-test")
            }) {
                break n.client_key.unwrap_or_default();
            }
            if start.elapsed() > Duration::from_secs(6) {
                panic!("timed out waiting for task notification creation");
            }
            std::thread::sleep(Duration::from_millis(100));
        };

        // Invoke cancel via notification manager
        let notification_manager = handle.state::<NotificationManager>();
        notification_manager
            .invoke_action("cancel_task", Some(client_key.clone()))
            .expect("invoke works");

        // Wait for a final patient 'Cancelled' notification to exist
        let start2 = Instant::now();
        let cancelled = loop {
            if start2.elapsed() > Duration::from_secs(6) {
                panic!("timed out waiting for cancelled notification");
            }
            if let Ok(Some(n)) = NotificationStore::get_by_client_key(&client_key) {
                if n.notification_type.to_string() == "patient" && n.title.contains("Cancelled") {
                    break true;
                }
            }
            std::thread::sleep(Duration::from_millis(150));
        };

        assert!(
            cancelled,
            "expected cancelled patient notification after invoking cancel_task"
        );
    }
}

#[derive(Clone)]
pub struct NotificationManager {
    app_handle: AppHandle,
    action_registry: Arc<Mutex<HashMap<String, Arc<dyn ActionHandler>>>>,
    // In-memory tracking for notifications that should be kept on completion
    show_on_completion_keys: Arc<Mutex<HashSet<String>>>,
    show_on_completion_ids: Arc<Mutex<HashSet<i32>>>,
}

#[allow(dead_code)]
impl NotificationManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let manager = Self {
            app_handle,
            action_registry: Arc::new(Mutex::new(HashMap::new())),
            show_on_completion_keys: Arc::new(Mutex::new(HashSet::new())),
            show_on_completion_ids: Arc::new(Mutex::new(HashSet::new())),
        };

        // Register built-in action handlers
        manager.register_action("cancel_task", Arc::new(CancelTaskHandler {}));
        // Future handlers (pause, resume, etc.) can be added here

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

        let severity = input
            .severity
            .map(|s| NotificationSeverity::from(s))
            .unwrap_or(NotificationSeverity::Info);

        let mut notification = Notification {
            id: None,
            client_key: input.client_key.clone(),
            title: input.title.unwrap_or_else(|| "Notification".to_string()),
            description: input.description,
            severity,
            notification_type: input
                .notification_type
                .unwrap_or(NotificationType::Immediate),
            dismissible: input.dismissible.unwrap_or(true),
            actions: input
                .actions
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default(),
            read: false,
            progress: input.progress,
            current_step: input.current_step,
            total_steps: input.total_steps,
            metadata: input.metadata,
            show_on_completion: input.show_on_completion,
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
                    // Track show_on_completion if provided
                    if let Some(true) = input.show_on_completion {
                        if let Some(ref key) = notification.client_key {
                            let mut keys = self.show_on_completion_keys.lock().unwrap();
                            keys.insert(key.clone());
                        } else {
                            let mut ids = self.show_on_completion_ids.lock().unwrap();
                            ids.insert(id);
                        }
                        notification.show_on_completion = Some(true);
                    }

                    self.app_handle.emit("core://notification", &notification)?;
                    return Ok(id);
                }
            }
        }

        let id = NotificationStore::create(&notification)?;
        notification.id = Some(id);
        // Track show_on_completion mapping if provided
        if let Some(true) = input.show_on_completion {
            if let Some(ref key) = notification.client_key {
                let mut keys = self.show_on_completion_keys.lock().unwrap();
                keys.insert(key.clone());
            } else {
                let mut ids = self.show_on_completion_ids.lock().unwrap();
                ids.insert(id);
            }
            // copy into outgoing notification so frontend sees it
            notification.show_on_completion = Some(true);
        }

        self.app_handle.emit("core://notification", &notification)?;

        Ok(id)
    }

    pub fn update_progress(
        &self,
        id_or_key: String,
        progress: i32,
        current_step: Option<i32>,
        total_steps: Option<i32>,
    ) -> Result<()> {
        self.update_progress_with_description(
            id_or_key,
            progress,
            current_step,
            total_steps,
            String::new(),
        )
    }

    pub fn update_progress_with_description(
        &self,
        id_or_key: String,
        progress: i32,
        current_step: Option<i32>,
        total_steps: Option<i32>,
        description: String,
    ) -> Result<()> {
        // println!("NotificationManager: Updating progress for {} to {}%", id_or_key, progress);
        let notification_opt = if let Ok(id) = id_or_key.parse::<i32>() {
            NotificationStore::get_by_id(id)?
        } else {
            NotificationStore::get_by_client_key(&id_or_key)?
        };

        if let Some(mut notification) = notification_opt {
            // println!("NotificationManager: Found notification with {} actions", notification.actions.len());
            notification.progress = Some(progress);
            notification.current_step = current_step;
            notification.total_steps = total_steps;

            // Update description if provided
            if !description.is_empty() {
                notification.description = Some(description);
            }

            notification.updated_at = chrono::Utc::now().to_rfc3339();

            // Auto-convert Progress → Patient when complete
            // ensure we respect any in-memory show_on_completion flags
            let mut show_flag = notification.show_on_completion.unwrap_or(false);
            if !show_flag {
                if let Some(ref key) = notification.client_key {
                    show_flag = self.show_on_completion_keys.lock().unwrap().contains(key);
                }
                if let Some(id) = notification.id {
                    show_flag =
                        show_flag || self.show_on_completion_ids.lock().unwrap().contains(&id);
                }
            }

            if progress >= 100 && notification.notification_type == NotificationType::Progress {
                // println!("NotificationManager: Converting Progress → Patient (completed), dismissible was: {}, setting to true", notification.dismissible);
                if show_flag {
                    notification.notification_type = NotificationType::Patient;
                    notification.dismissible = true;
                    // Clear actions when converting to Patient (task is done, can't cancel)
                    notification.actions.clear();
                } else {
                    // Default behavior: auto-delete completed progress notifications
                    if let Some(id) = notification.id {
                        // delegate to existing delete path which emits events and cleans up the store
                        let _ = self.delete(id.to_string());
                    } else if let Some(ref key) = notification.client_key {
                        let _ = self.delete(key.clone());
                    }
                    // early return — notification removed
                    return Ok(());
                }
                // println!("NotificationManager: Converted notification - type: {:?}, dismissible: {}, actions: {}", notification.notification_type, notification.dismissible, notification.actions.len());
            }

            if let Some(id) = notification.id {
                // println!("NotificationManager: Saving notification with {} actions", notification.actions.len());
                NotificationStore::update(id, &notification)?;
            } else {
                // println!("NotificationManager: Warning - Notification has no ID, skipping DB update");
            }

            // println!("NotificationManager: Emitting progress event for {} - type: {:?}, dismissible: {}, progress: {:?}",
            //     notification.client_key.as_deref().unwrap_or("unknown"),
            //     notification.notification_type,
            //     notification.dismissible,
            //     notification.progress);
            self.app_handle
                .emit("core://notification-progress", &notification)?;
        } else {
            // println!("NotificationManager: Notification not found for {}", id_or_key);
        }
        Ok(())
    }

    /// Upsert only the description for a notification identified by id or client_key.
    /// If the notification does not yet exist (race between create and first step),
    /// create a minimal indeterminate Progress notification so the UI shows the step text immediately.
    pub fn upsert_description(&self, id_or_key: &str, description: &str) -> Result<()> {
        let notification_opt = if let Ok(id) = id_or_key.parse::<i32>() {
            NotificationStore::get_by_id(id)?
        } else {
            NotificationStore::get_by_client_key(id_or_key)?
        };

        if let Some(mut notification) = notification_opt {
            notification.description = Some(description.to_string());
            notification.updated_at = chrono::Utc::now().to_rfc3339();
            // Persist updated description
            if let Some(id) = notification.id {
                NotificationStore::update(id, &notification)?;
            }
            // Emit progress event so frontend updates existing toast/card
            self.app_handle
                .emit("core://notification-progress", &notification)?;
            return Ok(());
        }

        // Create a new minimal progress notification (indeterminate) when missing.
        // Use description for both title and description if no prior record.
        let create_input = CreateNotificationInput {
            client_key: if id_or_key.parse::<i32>().is_err() {
                Some(id_or_key.to_string())
            } else {
                None
            },
            title: Some(description.to_string()),
            description: Some(description.to_string()),
            severity: Some("info".to_string()),
            notification_type: Some(NotificationType::Progress),
            dismissible: Some(false),
            progress: Some(-1),
            current_step: None,
            total_steps: None,
            actions: None,
            metadata: None,
            show_on_completion: None,
        };
        let _ = self.create(create_input)?;
        Ok(())
    }

    /// Helper to determine whether a Progress notification should remain persistent on successful
    /// completion (converted to Patient) based on the notification's own flag or the manager's
    /// in-memory registry. This is extracted to make the logic unit-testable.
    pub(crate) fn should_persist_on_completion(
        notification: &Notification,
        keys: &HashSet<String>,
        ids: &HashSet<i32>,
    ) -> bool {
        // Explicit field on notification takes precedence
        if notification.show_on_completion.unwrap_or(false) {
            return true;
        }

        if let Some(ref k) = notification.client_key {
            if keys.contains(k) {
                return true;
            }
        }

        if let Some(id) = notification.id {
            if ids.contains(&id) {
                return true;
            }
        }

        false
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
            self.app_handle.emit(
                "core://notification-updated",
                serde_json::json!({
                    "id": id,
                    "read": true
                }),
            )?;
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

        // remove any show_on_completion tracking for this notification
        if id > 0 {
            // Try to fetch the existing notification and remove any show_on_completion tracking
            let existing_opt = NotificationStore::get_by_id(id)?;
            if let Some(existing) = &existing_opt {
                if let Some(k) = existing.client_key.as_ref() {
                    let mut keys = self.show_on_completion_keys.lock().unwrap();
                    keys.remove(k);
                }
            }

            let mut ids = self.show_on_completion_ids.lock().unwrap();
            ids.remove(&id);

            // capture client_key to help frontend remove any ephemeral toast for this notification
            let client_key = existing_opt.and_then(|e| e.client_key);
            NotificationStore::delete(id)?;
            self.app_handle.emit(
                "core://notification-updated",
                serde_json::json!({
                    "id": id,
                    "deleted": true,
                    "client_key": client_key,
                }),
            )?;
        }
        Ok(())
    }

    /// Clear all Immediate notifications (should be called on app startup)
    pub fn clear_immediate_notifications(&self) -> Result<()> {
        NotificationStore::clear_immediate_notifications()?;
        Ok(())
    }

    /// Clear all dismissible notifications (Patient and completed Progress)
    pub fn clear_all_dismissible_notifications(&self) -> Result<usize> {
        let count = NotificationStore::clear_all_dismissible_notifications()?;
        // Emit update event to refresh frontend
        self.app_handle.emit(
            "core://notification-updated",
            serde_json::json!({
                "cleared_all": true
            }),
        )?;
        Ok(count)
    }

    /// Clear all Progress notifications (should be called on app startup)
    pub fn clear_progress_notifications(&self) -> Result<()> {
        NotificationStore::clear_progress_notifications()?;
        Ok(())
    }

    /// Clear all task-related notifications (Progress and Patient from tasks)
    pub fn clear_task_notifications(&self) -> Result<usize> {
        let count = NotificationStore::clear_task_notifications()?;
        Ok(count)
    }
}
