pub mod java;
pub mod modpack;

use anyhow::Result;
use piston_lib::game::installer::install_instance;
use piston_lib::game::installer::types::{
    CancelToken, InstallSpec, ModloaderType, NotificationActionSpec, ProgressReporter,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

use crate::models::instance::Instance;
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use crate::tasks::manager::{Task, TaskContext};

/// Task adapter for game installation
pub struct InstallInstanceTask {
    instance: Instance,
    dry_run: bool,
}

impl InstallInstanceTask {
    pub fn new(instance: Instance) -> Self {
        Self {
            instance,
            dry_run: false,
        }
    }

    pub fn set_dry_run(&mut self, dry_run: bool) {
        self.dry_run = dry_run;
    }
}

impl Task for InstallInstanceTask {
    fn name(&self) -> String {
        format!("Install {}", self.instance.name)
    }

    fn id(&self) -> Option<String> {
        Some(format!("install_instance_{}", self.instance.id))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn pausable(&self) -> bool {
        true
    }

    fn total_steps(&self) -> i32 {
        // Return 0 to indicate dynamic steps - piston-lib reports actual progress
        0
    }

    fn starting_description(&self) -> String {
        // Build friendly version string for notification
        let modloader = self.instance.modloader.as_deref().unwrap_or("vanilla");
        if modloader != "vanilla" && self.instance.modloader_version.is_some() {
            format!(
                "Minecraft {} ({} {})",
                self.instance.minecraft_version,
                modloader,
                self.instance.modloader_version.as_ref().unwrap()
            )
        } else if modloader != "vanilla" {
            format!(
                "Minecraft {} ({})",
                self.instance.minecraft_version, modloader
            )
        } else {
            format!("Minecraft {}", self.instance.minecraft_version)
        }
    }

    fn completion_description(&self) -> String {
        format!("Successfully installed {}", self.instance.name)
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance = self.instance.clone();
        let dry_run = self.dry_run;
        let app_handle = ctx.app_handle.clone();
        let cancel_rx = ctx.cancel_rx.clone();
        let pause_rx = ctx.pause_rx.clone();
        let notification_id = ctx.notification_id.clone();

        Box::pin(async move {
            log::info!(
                "[InstallTask] Starting installation for instance '{}' (dry_run={})",
                instance.name,
                dry_run
            );
            log::info!(
                "[InstallTask] Version: {}, Modloader: {:?}, Modloader Version: {:?}",
                instance.minecraft_version,
                instance.modloader,
                instance.modloader_version
            );

            // Resolve directories
            let config_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| {
                log::error!("[InstallTask] Failed to get config directory: {}", e);
                e.to_string()
            })?;
            let data_dir = config_dir.join("data");
            let game_dir = instance
                .game_directory
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("instances").join(&instance.slug()));

            log::info!(
                "[InstallTask] Data dir: {:?}, Game dir: {:?}",
                data_dir,
                game_dir
            );

            let spec = InstallSpec {
                version_id: instance.minecraft_version.clone(),
                modloader: parse_modloader(instance.modloader.as_deref().unwrap_or("vanilla")),
                modloader_version: instance.modloader_version.clone(),
                data_dir: data_dir.clone(),
                game_dir: game_dir.clone(),
                java_path: instance.java_path.as_ref().map(PathBuf::from),
                dry_run,
                concurrency: 8, // TODO: Make this configurable in app settings
            };

            // Background task to handle pause/resume UI updates
            let pause_app_handle = app_handle.clone();
            let pause_notification_id = notification_id.clone();
            let mut pause_rx_watcher = pause_rx.clone();
            let current_step_for_pause = Arc::new(RwLock::new(String::new()));
            let reporter_current_step = current_step_for_pause.clone();

            let reporter: std::sync::Arc<dyn ProgressReporter> =
                std::sync::Arc::new(TauriProgressReporter {
                    app_handle: app_handle.clone(),
                    notification_id: notification_id.clone(),
                    cancel_token: CancelToken::new(cancel_rx),
                    pause_rx: pause_rx.clone(),
                    current_step: reporter_current_step,
                    dry_run,
                    last_emit: Arc::new(std::sync::Mutex::new(
                        std::time::Instant::now() - std::time::Duration::from_secs(1),
                    )),
                    last_percent: std::sync::atomic::AtomicI32::new(-1),
                });

            tauri::async_runtime::spawn(async move {
                while pause_rx_watcher.changed().await.is_ok() {
                    let is_paused = *pause_rx_watcher.borrow();
                    let manager = pause_app_handle.state::<NotificationManager>();

                    let actions = if is_paused {
                        vec![
                            crate::notifications::models::NotificationAction {
                                action_id: "cancel_task".to_string(),
                                label: "Cancel".to_string(),
                                action_type: "secondary".to_string(),
                                payload: None,
                            },
                            crate::notifications::models::NotificationAction {
                                action_id: "resume_task".to_string(),
                                label: "Resume".to_string(),
                                action_type: "primary".to_string(),
                                payload: None,
                            },
                        ]
                    } else {
                        vec![
                            crate::notifications::models::NotificationAction {
                                action_id: "cancel_task".to_string(),
                                label: "Cancel".to_string(),
                                action_type: "secondary".to_string(),
                                payload: None,
                            },
                            crate::notifications::models::NotificationAction {
                                action_id: "pause_task".to_string(),
                                label: "Pause".to_string(),
                                action_type: "secondary".to_string(),
                                payload: None,
                            },
                        ]
                    };

                    let _ =
                        manager.update_notification_actions(pause_notification_id.clone(), actions);

                    if is_paused {
                        let _ = manager.upsert_description(&pause_notification_id, "Paused");
                    } else {
                        // Restore the current step description when resuming
                        let step = current_step_for_pause.read().await;
                        let _ = manager.upsert_description(&pause_notification_id, &*step);
                    }
                }
            });

            // Run installation in blocking thread (piston-lib handles all progress reporting)
            log::info!("[InstallTask] Dispatching to piston-lib installer");
            let reporter_for_thread = reporter.clone();
            let join = tauri::async_runtime::spawn_blocking(move || {
                tauri::async_runtime::block_on(install_instance(spec, reporter_for_thread))
            });

            // Wait for completion and update database accordingly
            let result = match join.await {
                Ok(res) => res,
                Err(join_err) => {
                    let msg = format!("Installation task join error: {}", join_err);
                    log::error!("{}", msg);
                    return Err(msg);
                }
            };

            match result {
                Ok(_) => {
                    log::info!(
                        "[InstallTask] Installation completed successfully for '{}'",
                        instance.name
                    );

                    // Update database status to 'installed'
                    if instance.id > 0 {
                        if let Err(e) = crate::commands::instances::update_installation_status(
                            &app_handle,
                            instance.id,
                            "installed",
                        ) {
                            log::error!("[InstallTask] Failed to update status: {}", e);
                        }
                    }

                    // Emit installed event for frontend
                    use tauri::Emitter;
                    let _ = app_handle.emit(
                        "core://instance-installed",
                        serde_json::json!({
                            "name": instance.name,
                            "instance_id": instance.slug()
                        }),
                    );

                    Ok(())
                }
                Err(e) => {
                    log::error!("[InstallTask] Installation failed: {}", e);

                    // Update database status to 'failed' with reason
                    if instance.id > 0 {
                        let status_val = format!("failed:{}", e);
                        if let Err(status_err) =
                            crate::commands::instances::update_installation_status(
                                &app_handle,
                                instance.id,
                                &status_val,
                            )
                        {
                            log::error!(
                                "[InstallTask] Failed to update error status: {}",
                                status_err
                            );
                        }
                    }

                    Err(e.to_string())
                }
            }
        })
    }
}

/// Progress reporter implementation that forwards to NotificationManager
pub struct TauriProgressReporter {
    pub app_handle: AppHandle,
    pub notification_id: String,
    pub cancel_token: CancelToken,
    pub pause_rx: tokio::sync::watch::Receiver<bool>,
    pub current_step: Arc<RwLock<String>>,
    pub dry_run: bool,
    // Throttling state for progress events
    pub last_emit: Arc<std::sync::Mutex<std::time::Instant>>,
    pub last_percent: std::sync::atomic::AtomicI32,
}

impl ProgressReporter for TauriProgressReporter {
    fn start_step(&self, name: &str, total_steps: Option<u32>) {
        let name_str = name.to_string();
        let name_log = name_str.clone();
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        let current_step = self.current_step.clone();
        // Synchronously upsert the description to avoid races where the
        // async task is delayed behind a blocking install thread.
        {
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.upsert_description(&notification_id, &name_str);
        }

        // Update progress (indeterminate) asynchronously, but without modifying description.
        tauri::async_runtime::spawn(async move {
            *current_step.write().await = name_str.clone();
            let manager = app_handle.state::<NotificationManager>();
            let _ =
                manager.update_progress(notification_id, -1, None, total_steps.map(|s| s as i32));
        });

        log::info!("Installation step: {}", name_log);
    }

    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        if let Some(total) = total {
            if total > 0 {
                let percent = ((transferred as f64 / total as f64) * 100.0) as i32;
                self.set_percent(percent);
            }
        }
    }

    fn set_percent(&self, percent: i32) {
        // Throttling constants (placeholder for future config integration)
        const MIN_INTERVAL_MS: u64 = 150;
        const MIN_PERCENT_DELTA: i32 = 1;

        // Always emit 0 and 100 for clarity
        let prev = self.last_percent.load(std::sync::atomic::Ordering::Relaxed);
        let mut allow = percent == 0 || percent == 100;
        if !allow {
            let delta = percent - prev;
            if delta.abs() >= MIN_PERCENT_DELTA {
                let mut guard = self.last_emit.lock().unwrap();
                if guard.elapsed() >= std::time::Duration::from_millis(MIN_INTERVAL_MS) {
                    *guard = std::time::Instant::now();
                    allow = true;
                }
            }
        }
        if allow {
            self.last_percent
                .store(percent, std::sync::atomic::Ordering::Relaxed);
            let app_handle = self.app_handle.clone();
            let notification_id = self.notification_id.clone();
            tauri::async_runtime::spawn(async move {
                let manager = app_handle.state::<NotificationManager>();
                let _ = manager.update_progress(notification_id, percent, None, None);
            });
        }
    }

    fn set_message(&self, message: &str) {
        let message_str = message.to_string();
        let message_log = message_str.clone();
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();

        // Use upsert_description to update the notification description
        // This matches the behavior of start_step and avoids creating duplicate notifications
        {
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.upsert_description(&notification_id, &message_str);
        }

        log::debug!("Installation: {}", message_log);
    }

    fn set_step_count(&self, current: u32, total: Option<u32>) {
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.update_progress_with_description(
                notification_id,
                -1, // use indeterminate progress to avoid showing stale percentages
                Some(current as i32),
                total.map(|t| t as i32),
                String::new(),
            );
        });
        log::debug!("Installation step count: {}/{:?}", current, total);
    }

    fn set_substep(&self, name: Option<&str>, current: Option<u32>, total: Option<u32>) {
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();

        // Build substep description
        let substep_desc = match (name, current, total) {
            (Some(n), Some(c), Some(t)) => format!("{} ({}/{})", n, c, t),
            (Some(n), Some(c), None) => format!("{} ({})", n, c),
            (Some(n), None, None) => n.to_string(),
            (None, Some(c), Some(t)) => format!("({}/{})", c, t),
            (None, Some(c), None) => format!("({})", c),
            _ => return, // Nothing to update
        };

        // Clone the description for the async task so we can still use the
        // original `substep_desc` for local logging without moving it.
        let substep_for_task = substep_desc.clone();
        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.upsert_description(&notification_id, &substep_for_task);
        });

        log::debug!("Installation substep: {}", substep_desc);
    }

    fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {
        // Actions are set by TaskManager when task is created
        // (cancel button is automatically added for cancellable tasks)
    }

    fn done(&self, success: bool, message: Option<&str>) {
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        let message_str = message
            .unwrap_or(if success {
                "Installation complete"
            } else {
                "Installation failed"
            })
            .to_string();
        let message_log = message_str.clone();

        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();

            if success {
                // On success just update to 100% — manager will convert -> Patient or auto-delete depending on task preference
                let _ = manager.update_progress_with_description(
                    notification_id,
                    100,
                    None,
                    None,
                    message_str,
                );
            } else {
                let input = CreateNotificationInput {
                    client_key: Some(notification_id),
                    title: Some("Installation Failed".to_string()),
                    description: Some(message_str),
                    severity: Some("error".to_string()),
                    notification_type: Some(NotificationType::Patient),
                    dismissible: Some(true),
                    actions: None,
                    progress: Some(-1),
                    current_step: None,
                    total_steps: None,
                    metadata: None,
                    show_on_completion: Some(true),
                };
                let _ = manager.create(input);
            }
        });

        if success {
            log::info!("Installation completed successfully");
        } else {
            log::error!("Installation failed: {}", message_log);
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancel_token.is_cancelled()
    }

    fn is_paused(&self) -> bool {
        *self.pause_rx.borrow()
    }

    fn is_dry_run(&self) -> bool {
        self.dry_run
    }
}

fn parse_modloader(modloader: &str) -> Option<ModloaderType> {
    match modloader.to_lowercase().as_str() {
        "vanilla" => None,
        "fabric" => Some(ModloaderType::Fabric),
        "quilt" => Some(ModloaderType::Quilt),
        "forge" => Some(ModloaderType::Forge),
        "neoforge" => Some(ModloaderType::NeoForge),
        _ => None,
    }
}
