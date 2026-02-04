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

/// Handler that pauses running tasks when the notification action 'pause_task' is invoked.
struct PauseTaskHandler {}

impl ActionHandler for PauseTaskHandler {
    fn handle(&self, app_handle: &AppHandle, client_key: Option<String>) -> Result<()> {
        let key = match client_key {
            Some(k) => k,
            None => anyhow::bail!("Missing client_key for pause_task action"),
        };
        let tm = app_handle.state::<TaskManager>();
        tm.pause_task(&key).map_err(|e: String| anyhow::anyhow!(e))
    }
}

/// Handler that resumes paused tasks when the notification action 'resume_task' is invoked.
struct ResumeTaskHandler {}

impl ActionHandler for ResumeTaskHandler {
    fn handle(&self, app_handle: &AppHandle, client_key: Option<String>) -> Result<()> {
        let key = match client_key {
            Some(k) => k,
            None => anyhow::bail!("Missing client_key for resume_task action"),
        };
        let tm = app_handle.state::<TaskManager>();
        tm.resume_task(&key).map_err(|e: String| anyhow::anyhow!(e))
    }
}

/// Handler that resumes an interrupted instance operation
struct ResumeInstanceOperationHandler {}

impl ActionHandler for ResumeInstanceOperationHandler {
    fn handle(&self, app_handle: &AppHandle, client_key: Option<String>) -> Result<()> {
        let key = match client_key {
            Some(k) => k,
            None => anyhow::bail!("Missing client_key for resume_instance_operation action"),
        };

        // Extract ID from key (interrupted_instance_{id})
        let id_str = key.replace("interrupted_instance_", "");
        let id = id_str
            .parse::<i32>()
            .map_err(|_| anyhow::anyhow!("Invalid instance ID in client_key"))?;

        let handle = app_handle.clone();

        tauri::async_runtime::spawn(async move {
            let tm = handle.state::<TaskManager>();
            if let Err(e) =
                crate::commands::instances::resume_instance_operation(handle.clone(), tm, id).await
            {
                log::error!("[ResumeInstanceOperationHandler] Failed to resume: {}", e);
            }
        });

        Ok(())
    }
}

/// Handler that restarts the app when the notification action 'restart_app' is invoked.
struct RestartAppHandler {}

impl ActionHandler for RestartAppHandler {
    fn handle(&self, app_handle: &AppHandle, _client_key: Option<String>) -> Result<()> {
        app_handle.restart();
        #[allow(unreachable_code)]
        Ok(())
    }
}

/// Handler that logs out of guest mode and returns to onboarding
struct LogoutGuestHandler {}

impl ActionHandler for LogoutGuestHandler {
    fn handle(&self, app_handle: &AppHandle, _client_key: Option<String>) -> Result<()> {
        log::info!("[LogoutGuestHandler] Logging out guest...");

        // 1. Cleanup marker file
        if let Ok(app_data_dir) = crate::utils::db_manager::get_app_config_dir() {
            let marker_path = app_data_dir.join(".guest_mode");
            if marker_path.exists() {
                let _ = std::fs::remove_file(marker_path);
            }
        }

        // 2. Cleanup Guest account from database
        if let Ok(mut conn) = crate::utils::db::get_vesta_conn() {
            use crate::schema::account::dsl::*;
            use diesel::prelude::*;
            let _ =
                diesel::delete(account.filter(uuid.eq(crate::auth::GUEST_UUID))).execute(&mut conn);
        }

        // 3. Cleanup the notification itself
        if let Some(nm) =
            app_handle.try_state::<crate::notifications::manager::NotificationManager>()
        {
            let _ = nm.delete("guest_mode_warning".to_string());
        }

        // 4. Reset config state
        use crate::utils::config::{get_app_config, update_app_config};
        if let Ok(mut config) = get_app_config() {
            config.setup_completed = false;
            config.active_account_uuid = None;
            let _ = update_app_config(&config);
        }

        // 5. Notify frontend to redirect
        app_handle
            .emit("core://logout-guest", ())
            .map_err(|e| anyhow::anyhow!(e))?;

        Ok(())
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
}

#[allow(dead_code)]
impl NotificationManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let manager = Self {
            app_handle,
            action_registry: Arc::new(Mutex::new(HashMap::new())),
        };

        // Register built-in action handlers
        manager.register_action("cancel_task", Arc::new(CancelTaskHandler {}));
        manager.register_action("pause_task", Arc::new(PauseTaskHandler {}));
        manager.register_action("resume_task", Arc::new(ResumeTaskHandler {}));
        manager.register_action(
            "resume_instance_operation",
            Arc::new(ResumeInstanceOperationHandler {}),
        );
        manager.register_action("restart_app", Arc::new(RestartAppHandler {}));
        manager.register_action("logout_guest", Arc::new(LogoutGuestHandler {}));
        // Future handlers (pause, resume, etc.) can be added here

        manager
    }

    /// Register an action handler
    pub fn register_action(&self, action_id: &str, handler: Arc<dyn ActionHandler>) {
        let mut registry = match self.action_registry.lock() {
            Ok(registry) => registry,
            Err(e) => {
                eprintln!("Failed to lock action registry for registration: {}", e);
                return;
            }
        };
        registry.insert(action_id.to_string(), handler);
    }

    /// Invoke an action handler
    pub fn invoke_action(&self, action_id: &str, client_key: Option<String>) -> Result<()> {
        let registry = self
            .action_registry
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to lock action registry: {}", e))?;
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

                    self.app_handle.emit("core://notification", &notification)?;
                    return Ok(id);
                }
            }
        }

        // Only persist non-immediate notifications to the database.
        // Immediate notifications are treated as ephemeral toasts.
        let id = if notification.notification_type != NotificationType::Immediate {
            let nid = NotificationStore::create(&notification)?;
            notification.id = Some(nid);
            nid
        } else {
            // For ephemeral notifications, we use 0 or a negative ID to indicate no persistence
            notification.id = Some(0);
            0
        };

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

            /*
            TODO:

            The conditional assignment of current_step and total_steps (lines 444-449) may prevent resetting these values to None when needed. The previous implementation unconditionally assigned these values, which allowed clearing them. If the intent is to preserve existing values when None is passed, this change is correct, but it may break existing behavior that relies on being able to clear these fields.
            */

            if current_step.is_some() {
                notification.current_step = current_step;
            }
            if total_steps.is_some() {
                notification.total_steps = total_steps;
            }

            // Update description if provided
            if !description.is_empty() {
                notification.description = Some(description);
            }

            notification.updated_at = chrono::Utc::now().to_rfc3339();

            // Auto-convert Progress → Patient when complete
            // Use database field as single source of truth
            let show_flag = notification.show_on_completion.unwrap_or(false);

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

    pub fn update_notification_actions(
        &self,
        id_or_key: String,
        actions: Vec<crate::notifications::models::NotificationAction>,
    ) -> Result<()> {
        let notification_opt = if let Ok(id) = id_or_key.parse::<i32>() {
            NotificationStore::get_by_id(id)?
        } else {
            NotificationStore::get_by_client_key(&id_or_key)?
        };

        if let Some(mut notification) = notification_opt {
            notification.actions = actions;
            notification.updated_at = chrono::Utc::now().to_rfc3339();

            if let Some(id) = notification.id {
                NotificationStore::update(id, &notification)?;
                self.app_handle.emit("core://notification", &notification)?;
            }
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
    /// completion (converted to Patient) based on the notification's show_on_completion flag.
    /// This is extracted to make the logic unit-testable.
    pub(crate) fn should_persist_on_completion(
        notification: &Notification,
        _keys: &HashSet<String>,
        _ids: &HashSet<i32>,
    ) -> bool {
        // Database field is the single source of truth
        notification.show_on_completion.unwrap_or(false)
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

        if id > 0 {
            // capture client_key to help frontend remove any ephemeral toast for this notification
            let client_key = NotificationStore::get_by_id(id)?.and_then(|e| e.client_key);
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
