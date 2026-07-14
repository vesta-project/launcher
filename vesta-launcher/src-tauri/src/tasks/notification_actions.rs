use crate::notifications::manager::{ActionHandler, NotificationManager};
use crate::tasks::manager::TaskManager;
use anyhow::Result;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

struct CancelTask;
struct PauseTask;
struct ResumeTask;

fn require_client_key(client_key: Option<String>, action: &str) -> Result<String> {
    client_key.ok_or_else(|| anyhow::anyhow!("Missing client_key for {action} action"))
}

impl ActionHandler for CancelTask {
    fn handle(
        &self,
        app_handle: &AppHandle,
        client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        let key = require_client_key(client_key, "cancel_task")?;
        app_handle
            .state::<TaskManager>()
            .cancel_task(&key)
            .map_err(anyhow::Error::msg)
    }
}

impl ActionHandler for PauseTask {
    fn handle(
        &self,
        app_handle: &AppHandle,
        client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        let key = require_client_key(client_key, "pause_task")?;
        app_handle
            .state::<TaskManager>()
            .pause_task(&key)
            .map_err(anyhow::Error::msg)
    }
}

impl ActionHandler for ResumeTask {
    fn handle(
        &self,
        app_handle: &AppHandle,
        client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        let key = require_client_key(client_key, "resume_task")?;
        app_handle
            .state::<TaskManager>()
            .resume_task(&key)
            .map_err(anyhow::Error::msg)
    }
}

pub fn register(manager: &NotificationManager) {
    manager.register_action("cancel_task", Arc::new(CancelTask));
    manager.register_action("pause_task", Arc::new(PauseTask));
    manager.register_action("resume_task", Arc::new(ResumeTask));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_actions_require_a_client_key() {
        assert!(require_client_key(None, "cancel_task").is_err());
        assert_eq!(
            require_client_key(Some("task-1".into()), "cancel_task").unwrap(),
            "task-1"
        );
    }
}
