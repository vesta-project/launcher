use anyhow::Result;
use diesel::prelude::*;
use piston_lib::game::installer::core::jre_manager::{get_or_install_jre, JavaVersion};
use piston_lib::game::installer::types::{ProgressReporter, NotificationActionSpec};
use tauri::{AppHandle, Manager, Emitter};
use tokio::sync::watch;
use crate::tasks::manager::{Task, TaskContext};
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use crate::utils::db_manager::get_app_config_dir;
use crate::utils::db::get_config_conn;
use crate::models::GlobalJavaPath;
use crate::schema::global_java_paths::dsl::*;

pub struct DownloadJavaTask {
    pub major_version: u32,
}

impl Task for DownloadJavaTask {
    fn name(&self) -> String {
        format!("Downloading Java {}", self.major_version)
    }

    fn id(&self) -> Option<String> {
        Some(format!("download_java_{}", self.major_version))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        format!("Preparing to download Java {}...", self.major_version)
    }

    fn completion_description(&self) -> String {
        format!("Java {} installed successfully.", self.major_version)
    }

    fn run(&self, ctx: TaskContext) -> crate::tasks::manager::BoxFuture<'static, Result<(), String>> {
        let major = self.major_version;
        
        Box::pin(async move {
            let jre_dir = get_app_config_dir()
                .map_err(|e| e.to_string())?
                .join("data")
                .join("jre");
            
            let reporter = TaskProgressReporter {
                app_handle: ctx.app_handle.clone(),
                notification_id: ctx.notification_id.clone(),
                cancel_rx: ctx.cancel_rx.clone(),
                pause_rx: ctx.pause_rx.clone(),
            };

            let version = JavaVersion::new(major);
            
            let java_path = get_or_install_jre(&jre_dir, &version, &reporter)
                .await
                .map_err(|e| e.to_string())?;

            // Save to database
            let mut conn = get_config_conn().map_err(|e| e.to_string())?;
            let new_entry = GlobalJavaPath {
                major_version: major as i32,
                path: java_path.to_string_lossy().to_string(),
                is_managed: true,
            };

            diesel::insert_into(global_java_paths)
                .values(&new_entry)
                .on_conflict(major_version)
                .do_update()
                .set(&new_entry)
                .execute(&mut conn)
                .map_err(|e| e.to_string())?;
            // Emit event to notify frontend to refetch Java paths
            let _ = ctx.app_handle.emit("java-paths-updated", ());
            Ok(())
        })
    }
}

struct TaskProgressReporter {
    app_handle: AppHandle,
    notification_id: String,
    cancel_rx: watch::Receiver<bool>,
    pause_rx: watch::Receiver<bool>,
}

impl ProgressReporter for TaskProgressReporter {
    fn start_step(&self, name: &str, _total_steps: Option<u32>) {
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress_with_description(
            self.notification_id.clone(),
            -1,
            None,
            None,
            name.to_string(),
        );
    }

    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        if let Some(total) = total {
            let percent = (transferred as f64 / total as f64 * 100.0) as i32;
            let manager = self.app_handle.state::<NotificationManager>();
            let _ = manager.update_progress(self.notification_id.clone(), percent, None, None);
        }
    }

    fn set_percent(&self, percent: i32) {
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress(self.notification_id.clone(), percent, None, None);
    }

    fn set_message(&self, message: &str) {
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress_with_description(
            self.notification_id.clone(),
            -1,
            None,
            None,
            message.to_string(),
        );
    }

    fn set_step_count(&self, current: u32, total: Option<u32>) {
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress(
            self.notification_id.clone(),
            -1,
            Some(current as i32),
            total.map(|t| t as i32),
        );
    }

    fn set_substep(&self, name: Option<&str>, _current: Option<u32>, _total: Option<u32>) {
        if let Some(n) = name {
            let manager = self.app_handle.state::<NotificationManager>();
            let _ = manager.update_progress_with_description(
                self.notification_id.clone(),
                -1,
                None,
                None,
                n.to_string(),
            );
        }
    }

    fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {}

    fn done(&self, success: bool, message: Option<&str>) {
        let manager = self.app_handle.state::<NotificationManager>();
        if !success {
             let input = CreateNotificationInput {
                client_key: Some(self.notification_id.clone()),
                title: Some("Java Download Failed".to_string()),
                description: Some(message.unwrap_or("Unknown error").to_string()),
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
    }

    fn is_cancelled(&self) -> bool {
        *self.cancel_rx.borrow()
    }

    fn is_paused(&self) -> bool {
        *self.pause_rx.borrow()
    }
}
