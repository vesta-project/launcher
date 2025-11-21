use anyhow::Result;
use piston_lib::game::installer::types::{
    InstallSpec, ModloaderType, ProgressReporter, NotificationActionSpec, CancelToken,
};
use piston_lib::game::installer::install_instance;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use crate::tasks::manager::{Task, TaskContext};
use crate::models::instance::Instance;

/// Task adapter for game installation
pub struct InstallInstanceTask {
    instance: Instance,
}

impl InstallInstanceTask {
    pub fn new(instance: Instance) -> Self {
        Self { instance }
    }
}

impl Task for InstallInstanceTask {
    fn name(&self) -> String {
        format!("Install {}", self.instance.name)
    }
    
    fn cancellable(&self) -> bool {
        true
    }
    
    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance = self.instance.clone();
        let app_handle = ctx.app_handle.clone();
        let cancel_rx = ctx.cancel_rx.clone();
        let notification_id = ctx.notification_id.clone();
        
        Box::pin(async move {
            // Get data directory from app config or use default
            let data_dir = app_handle
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("data");
            
            // Use game_directory or default to data/instances/<name>
            let game_dir = instance.game_directory
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("instances").join(&instance.name));
            
            let spec = InstallSpec {
                version_id: instance.minecraft_version.clone(),
                modloader: parse_modloader(instance.modloader.as_deref().unwrap_or("vanilla")),
                modloader_version: instance.modloader_version.clone(),
                data_dir: data_dir.clone(),
                game_dir,
                java_path: instance.java_path.as_ref().map(PathBuf::from),
            };
            
            let reporter = TauriProgressReporter {
                app_handle: app_handle.clone(),
                notification_id: notification_id.clone(),
                cancel_token: CancelToken::new(cancel_rx),
                current_step: Arc::new(RwLock::new(String::new())),
            };
            
            // Run the installation on a blocking thread to avoid Send bounds
            let join = tauri::async_runtime::spawn_blocking(move || {
                tauri::async_runtime::block_on(install_instance(spec, &reporter))
            });

            match join.await {
                Ok(res) => res.map_err(|e| {
                    log::error!("Installation failed: {}", e);
                    e.to_string()
                }),
                Err(join_err) => {
                    let msg = format!("Installation task join error: {}", join_err);
                    log::error!("{}", msg);
                    Err(msg)
                }
            }
        })
    }
}

/// Progress reporter implementation that forwards to NotificationManager
struct TauriProgressReporter {
    app_handle: AppHandle,
    notification_id: String,
    cancel_token: CancelToken,
    current_step: Arc<RwLock<String>>,
}

impl ProgressReporter for TauriProgressReporter {
    fn start_step(&self, name: &str, total_steps: Option<u32>) {
        let name_str = name.to_string();
        let name_log = name_str.clone();
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        let current_step = self.current_step.clone();
        
        tauri::async_runtime::spawn(async move {
            *current_step.write().await = name_str.clone();
            
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.update_progress(
                notification_id,
                -1, // Indeterminate
                None,
                total_steps.map(|s| s as i32),
            );
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
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        
        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();
            let _ = manager.update_progress(
                notification_id,
                percent,
                None,
                None,
            );
        });
    }
    
    fn set_message(&self, message: &str) {
        let message_str = message.to_string();
        let message_log = message_str.clone();
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        
        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();
            
            // Update notification with new description
            let input = CreateNotificationInput {
                client_key: Some(notification_id),
                title: Some("Installing Game".to_string()),
                description: Some(message_str),
                severity: None,
                notification_type: None,
                dismissible: None,
                actions: None,
                progress: None,
                current_step: None,
                total_steps: None,
                metadata: None,
            };
            
            let _ = manager.create(input);
        });
        
        log::debug!("Installation: {}", message_log);
    }
    
    fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {
        // Actions are set by TaskManager when task is created
        // (cancel button is automatically added for cancellable tasks)
    }
    
    fn done(&self, success: bool, message: Option<&str>) {
        let app_handle = self.app_handle.clone();
        let notification_id = self.notification_id.clone();
        let message_str = message.unwrap_or(if success { "Installation complete" } else { "Installation failed" }).to_string();
        let message_log = message_str.clone();
        
        tauri::async_runtime::spawn(async move {
            let manager = app_handle.state::<NotificationManager>();
            
            let input = CreateNotificationInput {
                client_key: Some(notification_id),
                title: Some(if success { "Installation Complete" } else { "Installation Failed" }.to_string()),
                description: Some(message_str),
                severity: Some(if success { "success" } else { "error" }.to_string()),
                notification_type: Some(NotificationType::Patient),
                dismissible: Some(true),
                actions: None,
                progress: Some(if success { 100 } else { -1 }),
                current_step: None,
                total_steps: None,
                metadata: None,
            };
            
            let _ = manager.create(input);
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
