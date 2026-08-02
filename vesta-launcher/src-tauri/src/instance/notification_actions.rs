use crate::notifications::manager::{ActionHandler, NotificationManager};
use crate::tasks::manager::TaskManager;
use anyhow::Result;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

struct ResumeInstanceOperation;

fn instance_id_from_key(client_key: Option<String>) -> Result<i32> {
    let key = client_key.ok_or_else(|| {
        anyhow::anyhow!("Missing client_key for resume_instance_operation action")
    })?;
    key.strip_prefix("interrupted_instance_")
        .ok_or_else(|| anyhow::anyhow!("Invalid interrupted instance client_key"))?
        .parse::<i32>()
        .map_err(|_| anyhow::anyhow!("Invalid instance ID in client_key"))
}

fn should_auto_dismiss(last_operation: Option<&str>) -> bool {
    last_operation != Some("update")
}

impl ActionHandler for ResumeInstanceOperation {
    fn handle(
        &self,
        app_handle: &AppHandle,
        client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        let instance_id = instance_id_from_key(client_key)?;
        let handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let task_manager = handle.state::<TaskManager>();
            if let Err(error) = crate::commands::instances::resume_instance_operation(
                handle.clone(),
                task_manager,
                instance_id,
            )
            .await
            {
                log::error!("Failed to resume instance operation: {error}");
            }
        });
        Ok(())
    }

    fn auto_dismiss(&self, _app_handle: &AppHandle, client_key: Option<&str>) -> bool {
        let instance_id = client_key
            .map(str::to_string)
            .and_then(|key| instance_id_from_key(Some(key)).ok());
        match instance_id.and_then(|id| crate::commands::instances::get_instance(id).ok()) {
            Some(instance) => should_auto_dismiss(instance.last_operation.as_deref()),
            None => false,
        }
    }
}

pub fn register(manager: &NotificationManager) {
    manager.register_action(
        "resume_instance_operation",
        Arc::new(ResumeInstanceOperation),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_interrupted_instance_keys() {
        assert_eq!(
            instance_id_from_key(Some("interrupted_instance_42".into())).unwrap(),
            42
        );
        assert!(instance_id_from_key(Some("task_42".into())).is_err());
        assert!(instance_id_from_key(None).is_err());
    }

    #[test]
    fn update_recovery_notification_remains_until_async_result() {
        assert!(!should_auto_dismiss(Some("update")));
        assert!(should_auto_dismiss(Some("repair")));
        assert!(should_auto_dismiss(None));
    }
}
