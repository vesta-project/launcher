use crate::models::instance::Instance;
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationAction, NotificationType};
use crate::schema::instance::dsl::*;
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use tauri::Manager;

pub enum RecoveryNoticeKind {
    Interrupted,
    UpdateRestored,
    UpdateCommitted,
    UpdateRecoveryRequired(String),
}

fn interrupted_notice_kind(operation: Option<&str>) -> RecoveryNoticeKind {
    if operation == Some("update") {
        RecoveryNoticeKind::UpdateRecoveryRequired(
            "The persisted update recovery transaction is missing or unreadable".to_string(),
        )
    } else {
        RecoveryNoticeKind::Interrupted
    }
}

pub struct RecoveryNotice {
    pub instance: Instance,
    pub kind: RecoveryNoticeKind,
}

pub fn recover_interrupted_operations(
    app_handle: &tauri::AppHandle,
) -> Result<Vec<RecoveryNotice>, String> {
    let mut conn = get_vesta_conn().map_err(|error| error.to_string())?;

    log::info!("Checking for interrupted operations and update recovery...");
    let interrupted_count = diesel::update(instance.filter(installation_status.eq("installing")))
        .set(installation_status.eq("interrupted"))
        .execute(&mut conn)
        .map_err(|error| error.to_string())?;
    if interrupted_count > 0 {
        log::info!(
            "Recovered {} interrupted operation(s) at startup",
            interrupted_count
        );
    }

    let candidates = instance
        .load::<Instance>(&mut conn)
        .map_err(|error| error.to_string())?;
    drop(conn);

    let config_dir =
        crate::utils::db_manager::get_app_config_dir().map_err(|error| error.to_string())?;
    let data_dir = config_dir.join("data");
    let instances_root = data_dir.join("instances");
    let mut notices = Vec::new();

    for candidate in candidates {
        let game_dir = crate::utils::instance_helpers::resolve_instance_game_directory(
            &candidate,
            &instances_root,
            &data_dir,
        );
        if crate::modpack::update::has_pending_recovery(&game_dir) {
            match crate::modpack::update::recover_previous_instance(
                app_handle,
                candidate.id,
                &game_dir,
            ) {
                Ok(crate::modpack::update::UpdateRecoveryOutcome::Restored) => {
                    let restored = crate::commands::instances::get_instance(candidate.id)?;
                    notices.push(RecoveryNotice {
                        instance: restored,
                        kind: RecoveryNoticeKind::UpdateRestored,
                    });
                }
                Ok(crate::modpack::update::UpdateRecoveryOutcome::Committed) => {
                    let committed = crate::commands::instances::get_instance(candidate.id)?;
                    notices.push(RecoveryNotice {
                        instance: committed,
                        kind: RecoveryNoticeKind::UpdateCommitted,
                    });
                }
                Ok(crate::modpack::update::UpdateRecoveryOutcome::None) => {}
                Err(error) => {
                    let _ =
                        crate::modpack::update::mark_recovery_interrupted(app_handle, candidate.id);
                    let interrupted = crate::commands::instances::get_instance(candidate.id)?;
                    notices.push(RecoveryNotice {
                        instance: interrupted,
                        kind: RecoveryNoticeKind::UpdateRecoveryRequired(error),
                    });
                }
            }
            continue;
        }

        if candidate.installation_status.as_deref() == Some("interrupted") {
            notices.push(RecoveryNotice {
                kind: interrupted_notice_kind(candidate.last_operation.as_deref()),
                instance: candidate,
            });
        }
    }

    Ok(notices)
}

pub fn publish_interrupted_notifications(
    app_handle: tauri::AppHandle,
    manager: NotificationManager,
    recovery_notices: Vec<RecoveryNotice>,
) {
    if recovery_notices.is_empty() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let localization = app_handle.state::<crate::localization::LocalizationManager>();
        for notice in recovery_notices {
            let interrupted = notice.instance;
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
            let (title, description, severity, actions) = match notice.kind {
                RecoveryNoticeKind::Interrupted => {
                    let mut args = fluent_bundle::FluentArgs::new();
                    args.set("operation", display_operation);
                    args.set("instanceName", interrupted.name.as_str());
                    (
                    localization.text("rust-native-interrupted-operation-title"),
                    localization.format("rust-native-interrupted-operation-description", Some(&args)),
                    "warning".to_string(),
                    vec![NotificationAction {
                        action_id: "resume_instance_operation".to_string(),
                        label: localization.text("rust-native-resume-now"),
                        action_type: "primary".to_string(),
                        payload: None,
                    }],
                    )
                }
                RecoveryNoticeKind::UpdateRestored => {
                    let mut args = fluent_bundle::FluentArgs::new();
                    args.set("instanceName", interrupted.name.as_str());
                    (
                    localization.text("rust-native-modpack-update-restored-title"),
                    localization.format("rust-native-modpack-update-restored-description", Some(&args)),
                    "error".to_string(),
                    Vec::new(),
                    )
                }
                RecoveryNoticeKind::UpdateCommitted => {
                    let mut args = fluent_bundle::FluentArgs::new();
                    args.set("instanceName", interrupted.name.as_str());
                    (
                    localization.text("rust-native-modpack-update-completed-title"),
                    localization.format("rust-native-modpack-update-completed-description", Some(&args)),
                    "success".to_string(),
                    Vec::new(),
                    )
                }
                RecoveryNoticeKind::UpdateRecoveryRequired(error) => {
                    let mut args = fluent_bundle::FluentArgs::new();
                    args.set("instanceName", interrupted.name.as_str());
                    args.set("error", error.as_str());
                    (
                    localization.text("rust-native-update-recovery-required-title"),
                    localization.format("rust-native-update-recovery-required-description", Some(&args)),
                    "error".to_string(),
                    vec![NotificationAction {
                        action_id: "resume_instance_operation".to_string(),
                        label: localization.text("common-resume-recovery"),
                        action_type: "primary".to_string(),
                        payload: None,
                    }],
                    )
                }
            };

            if let Err(error) = manager.create(CreateNotificationInput {
                client_key: Some(format!("interrupted_instance_{}", interrupted.id)),
                title: Some(title),
                description: Some(description),
                severity: Some(severity),
                notification_type: Some(NotificationType::Patient),
                dismissible: Some(true),
                persist: Some(true),
                silent: Some(false),
                actions: if actions.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&actions).unwrap_or_default())
                },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_update_uses_recovery_notice() {
        assert!(matches!(
            interrupted_notice_kind(Some("update")),
            RecoveryNoticeKind::UpdateRecoveryRequired(_)
        ));
    }

    #[test]
    fn other_interrupted_operations_use_generic_notice() {
        assert!(matches!(
            interrupted_notice_kind(Some("repair")),
            RecoveryNoticeKind::Interrupted
        ));
        assert!(matches!(
            interrupted_notice_kind(None),
            RecoveryNoticeKind::Interrupted
        ));
    }
}
