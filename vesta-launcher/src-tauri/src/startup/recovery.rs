use crate::models::instance::Instance;
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationAction, NotificationType};
use crate::schema::instance::dsl::*;
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;

pub fn recover_interrupted_operations() -> Result<Vec<Instance>, String> {
    let mut conn = get_vesta_conn().map_err(|error| error.to_string())?;

    log::info!("Checking for interrupted installations...");
    let count = diesel::update(instance.filter(installation_status.eq("installing")))
        .set(installation_status.eq("interrupted"))
        .execute(&mut conn)
        .map_err(|error| error.to_string())?;

    if count == 0 {
        log::debug!("No interrupted installations found");
        return Ok(Vec::new());
    }

    log::info!(
        "Recovered {} interrupted installations (set to 'interrupted')",
        count
    );
    instance
        .filter(installation_status.eq("interrupted"))
        .load::<Instance>(&mut conn)
        .map_err(|error| error.to_string())
}

pub fn publish_interrupted_notifications(
    manager: NotificationManager,
    interrupted_instances: Vec<Instance>,
) {
    if interrupted_instances.is_empty() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        for interrupted in interrupted_instances {
            let raw_operation = interrupted
                .last_operation
                .as_deref()
                .unwrap_or("installation");
            let display_operation = match raw_operation {
                "hard-reset" => "hard reset",
                "repair" => "repair",
                "external-import" => "import migration",
                "update" => "modpack update",
                _ => "installation",
            };
            let actions = vec![NotificationAction {
                action_id: "resume_instance_operation".to_string(),
                label: "Resume Now".to_string(),
                action_type: "primary".to_string(),
                payload: None,
            }];

            if let Err(error) = manager.create(CreateNotificationInput {
                client_key: Some(format!("interrupted_instance_{}", interrupted.id)),
                title: Some("Interrupted Operation Detected".to_string()),
                description: Some(format!(
                    "The {} for '{}' was interrupted. Would you like to resume?",
                    display_operation, interrupted.name
                )),
                severity: Some("warning".to_string()),
                notification_type: Some(NotificationType::Patient),
                dismissible: Some(true),
                persist: Some(true),
                silent: Some(false),
                actions: Some(serde_json::to_string(&actions).unwrap_or_default()),
                progress: None,
                current_step: None,
                total_steps: None,
                metadata: None,
                show_on_completion: None,
            }) {
                log::error!(
                    "Failed to create interrupted-instance notification for {}: {}",
                    interrupted.name,
                    error
                );
            }
        }
    });
}
