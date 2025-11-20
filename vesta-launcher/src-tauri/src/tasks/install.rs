// Game installation task
// Integrates the installer with the Tauri task system and notification manager

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use tauri::Manager;

use piston_lib::game::installer::{
    VanillaInstaller, FabricInstaller, QuiltInstaller, ForgeInstaller, NeoForgeInstaller,
    ProgressCallback
};
use piston_lib::game::java::JavaManager;
use piston_lib::models::common::ModloaderType;
use piston_lib::models::minecraft::VersionManifest;

use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use crate::tasks::manager::{BoxFuture, Task, TaskContext};

pub struct InstallGameTask {
    pub game_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub version_id: String,
    pub modloader: ModloaderType,
    pub loader_version: Option<String>,
    pub version_manifest: VersionManifest,
}

impl Task for InstallGameTask {
    fn name(&self) -> String {
        match &self.modloader {
            ModloaderType::None => format!("Installing Minecraft {}", self.version_id),
            _ => format!("Installing {} {} with {}", self.modloader, self.version_id, self.loader_version.as_ref().unwrap_or(&"latest".to_string())),
        }
    }
    
    fn cancellable(&self) -> bool {
        true
    }
    
    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let game_dir = self.game_dir.clone();
        let runtime_dir = self.runtime_dir.clone();
        let version_id = self.version_id.clone();
        let modloader = self.modloader.clone();
        let loader_version = self.loader_version.clone();
        let version_manifest = self.version_manifest.clone();
        let client_key = ctx.notification_id.clone();
        
        // Extract NotificationManager as Arc before async block to satisfy 'static lifetime
        let notification_manager = {
            let manager = ctx.app_handle.state::<NotificationManager>();
            Arc::new(manager.inner().clone())
        };
        
        let mut cancel_rx = ctx.cancel_rx;
        
        Box::pin(async move {
            log::info!("Starting installation: {} {} (Modloader: {:?})", version_id, loader_version.as_ref().unwrap_or(&"none".to_string()), modloader);
            log::debug!("Installation paths - Game: {:?}, Runtime: {:?}", game_dir, runtime_dir);
            
            // Create progress tracking struct
            let progress = TaskProgressTracker {
                notification_manager: notification_manager.clone(),
                client_key: client_key.clone(),
                current_step: Arc::new(AtomicU32::new(0)),
                total_steps: Arc::new(AtomicU32::new(100)),
                current_file: Arc::new(parking_lot::Mutex::new(String::new())),
                downloaded_bytes: Arc::new(AtomicU64::new(0)),
                total_bytes: Arc::new(AtomicU64::new(0)),
            };
            
            // Update initial notification
            notification_manager.create(CreateNotificationInput {
                client_key: Some(client_key.clone()),
                title: Some(format!("Installing {}", version_id)),
                description: Some("Preparing installation...".to_string()),
                severity: Some("info".to_string()),
                notification_type: Some(NotificationType::Progress),
                dismissible: Some(false),
                actions: Some(vec![
                    crate::notifications::models::NotificationAction {
                        id: "cancel_task".to_string(),
                        label: "Cancel".to_string(),
                        action_type: crate::notifications::models::NotificationActionType::Destructive,
                    }
                ]),
                progress: Some(0),
                current_step: Some(0),
                total_steps: Some(100),
                metadata: None,
            }).map_err(|e| e.to_string())?;
            
            // Check for cancellation
            if *cancel_rx.borrow() {
                return Err("Installation cancelled by user".to_string());
            }
            
            // Run the appropriate installer
            log::info!("Executing installer for modloader: {:?}", modloader);
            let result = match modloader {
                ModloaderType::None => {
                    log::debug!("Using VanillaInstaller");
                    let installer = VanillaInstaller::new(
                        game_dir,
                        version_id.clone(),
                        version_manifest,
                    );
                    installer.install(&progress).await
                }
                ModloaderType::Fabric => {
                    log::debug!("Using FabricInstaller with version: {}", loader_version.as_ref().unwrap_or(&"latest".to_string()));
                    let installer = FabricInstaller::new(
                        game_dir,
                        version_id.clone(),
                        loader_version.clone().ok_or("Fabric loader version required")?,
                    );
                    installer.install(&progress).await
                }
                ModloaderType::Quilt => {
                    log::debug!("Using QuiltInstaller with version: {}", loader_version.as_ref().unwrap_or(&"latest".to_string()));
                    let installer = QuiltInstaller::new(
                        game_dir,
                        version_id.clone(),
                        loader_version.clone().ok_or("Quilt loader version required")?,
                    );
                    installer.install(&progress).await
                }
                ModloaderType::Forge => {
                    log::debug!("Using ForgeInstaller with version: {}", loader_version.as_ref().unwrap_or(&"latest".to_string()));
                    let java_manager = JavaManager::new(runtime_dir);
                    let installer = ForgeInstaller::new(
                        game_dir,
                        version_id.clone(),
                        loader_version.clone().ok_or("Forge version required")?,
                        java_manager,
                    );
                    installer.install(&progress).await
                }
                ModloaderType::NeoForge => {
                    log::debug!("Using NeoForgeInstaller with version: {}", loader_version.as_ref().unwrap_or(&"latest".to_string()));
                    let java_manager = JavaManager::new(runtime_dir);
                    let installer = NeoForgeInstaller::new(
                        game_dir,
                        version_id.clone(),
                        loader_version.clone().ok_or("NeoForge version required")?,
                        java_manager,
                    );
                    installer.install(&progress).await
                }
            };
            
            // Check for cancellation again
            if *cancel_rx.borrow() {
                return Err("Installation cancelled by user".to_string());
            }
            
            match result {
                Ok(_) => {
                    log::info!("Installation completed successfully: {} {} {:?}", version_id, loader_version.as_ref().unwrap_or(&"none".to_string()), modloader);
                    notification_manager.create(CreateNotificationInput {
                        client_key: Some(client_key.clone()),
                        title: Some(format!("{} {} Installed", modloader, version_id)),
                        description: Some("Installation completed successfully.".to_string()),
                        severity: Some("success".to_string()),
                        notification_type: Some(NotificationType::Patient),
                        dismissible: Some(true),
                        actions: None,
                        progress: Some(100),
                        current_step: Some(100),
                        total_steps: Some(100),
                        metadata: None,
                    }).map_err(|e| e.to_string())?;
                    
                    Ok(())
                }
                Err(e) => {
                    log::error!("Installation failed for {} {}: {}", version_id, loader_version.as_ref().unwrap_or(&"none".to_string()), e);
                    notification_manager.create(CreateNotificationInput {
                        client_key: Some(client_key.clone()),
                        title: Some(format!("Installation Failed")),
                        description: Some(format!("Error: {}", e)),
                        severity: Some("error".to_string()),
                        notification_type: Some(NotificationType::Patient),
                        dismissible: Some(true),
                        actions: None,
                        progress: None,
                        current_step: None,
                        total_steps: None,
                        metadata: None,
                    }).map_err(|e| e.to_string())?;
                    
                    Err(format!("Installation failed: {}", e))
                }
            }
        })
    }
}

/// Progress tracker that implements ProgressCallback and updates notifications
struct TaskProgressTracker {
    notification_manager: Arc<NotificationManager>,
    client_key: String,
    current_step: Arc<AtomicU32>,
    total_steps: Arc<AtomicU32>,
    current_file: Arc<parking_lot::Mutex<String>>,
    downloaded_bytes: Arc<AtomicU64>,
    total_bytes: Arc<AtomicU64>,
}

impl ProgressCallback for TaskProgressTracker {
    fn on_progress(&self, step: &str, current: u32, total: u32) {
        log::debug!("Installation progress: {} ({}/{})", step, current, total);
        self.current_step.store(current, Ordering::Relaxed);
        self.total_steps.store(total, Ordering::Relaxed);
        
        let _ = self.notification_manager.update_progress(
            self.client_key.clone(),
            current as i32,
            Some(current as i32),
            Some(total as i32),
        );
        
        // Also update description with current step
        let _ = self.notification_manager.create(CreateNotificationInput {
            client_key: Some(self.client_key.clone()),
            title: None,
            description: Some(step.to_string()),
            severity: None,
            notification_type: None,
            dismissible: None,
            actions: None,
            progress: Some(current as i32),
            current_step: Some(current as i32),
            total_steps: Some(total as i32),
            metadata: None,
        });
    }
    
    fn on_download(&self, file: &str, downloaded: u64, total: u64) {
        if total > 0 {
            let percent = (downloaded * 100) / total;
            log::debug!("Downloading: {} - {} / {} bytes ({}%)", file, downloaded, total, percent);
        }
        
        *self.current_file.lock() = file.to_string();
        self.downloaded_bytes.store(downloaded, Ordering::Relaxed);
        self.total_bytes.store(total, Ordering::Relaxed);
        
        // Update description with file download progress
        if total > 0 {
            let percent = (downloaded * 100) / total;
            let description = format!("Downloading {} ({}%)", file, percent);
            
            let _ = self.notification_manager.create(CreateNotificationInput {
                client_key: Some(self.client_key.clone()),
                title: None,
                description: Some(description),
                severity: None,
                notification_type: None,
                dismissible: None,
                actions: None,
                progress: None,
                current_step: None,
                total_steps: None,
                metadata: None,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    struct TestProgress {
        last_step: Arc<parking_lot::Mutex<String>>,
        last_progress: Arc<AtomicU32>,
    }

    impl ProgressCallback for TestProgress {
        fn on_progress(&self, step: &str, current: u32, _total: u32) {
            *self.last_step.lock() = step.to_string();
            self.last_progress.store(current, Ordering::Relaxed);
        }

        fn on_download(&self, file: &str, downloaded: u64, total: u64) {
            println!("Downloading {}: {}/{}", file, downloaded, total);
        }
    }

    #[test]
    fn test_progress_callback() {
        let progress = TestProgress {
            last_step: Arc::new(parking_lot::Mutex::new(String::new())),
            last_progress: Arc::new(AtomicU32::new(0)),
        };

        progress.on_progress("Test step", 50, 100);
        assert_eq!(*progress.last_step.lock(), "Test step");
        assert_eq!(progress.last_progress.load(Ordering::Relaxed), 50);
    }
}
