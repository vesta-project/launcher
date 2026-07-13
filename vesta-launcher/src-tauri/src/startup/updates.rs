use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationAction, NotificationType};
use crate::utils::config::get_app_config;
use crate::utils::version_tracking::VersionTrackingRepository;
use tauri::{Emitter, Manager};

pub fn initialize_version_tracking() {
    if let Err(error) = VersionTrackingRepository::initialize_defaults() {
        log::error!("Failed to initialize version tracking defaults: {}", error);
    }
}

pub fn notify_current_version(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let current_version = app_handle.package_info().version.to_string();
        match VersionTrackingRepository::is_version_newer("launcher", &current_version) {
            Ok(true) => {
                log::info!(
                    "New launcher version detected: {}. Triggering notification.",
                    current_version
                );
                let manager = app_handle.state::<NotificationManager>();
                let actions = vec![NotificationAction {
                    action_id: "navigate".to_string(),
                    label: "View Changelog".to_string(),
                    action_type: "primary".to_string(),
                    payload: Some(serde_json::json!({ "path": "/changelog" })),
                }];

                if let Err(error) = manager.create(CreateNotificationInput {
                    client_key: Some("launcher_update".to_string()),
                    title: Some("Vesta has been updated!".to_string()),
                    description: Some(format!(
                        "Welcome to version {}. Check out what's new in this release!",
                        current_version
                    )),
                    severity: Some("info".to_string()),
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
                    log::error!("Failed to create update notification: {}", error);
                }

                if let Err(error) = VersionTrackingRepository::update_last_seen_version(
                    "launcher",
                    &current_version,
                    true,
                ) {
                    log::error!("Failed to update last seen launcher version: {}", error);
                }
            }
            Ok(false) => log::debug!("Launcher version is up to date in tracking."),
            Err(error) => log::error!("Failed to check launcher version: {}", error),
        }
    });
}

pub fn schedule_update_check(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        let config = match get_app_config() {
            Ok(config) => config,
            Err(error) => {
                log::error!("Failed to get app config for update check: {}", error);
                return;
            }
        };
        if config.startup_check_updates {
            let _ = app_handle.emit("core://check-for-updates", ());
        }
    });
}
