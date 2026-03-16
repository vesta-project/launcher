use crate::models::GlobalJavaPath;
use crate::notifications::models::ProgressUpdate;
use crate::schema::global_java_paths::dsl::*;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_config_conn;
use crate::utils::db_manager::get_app_config_dir;
use anyhow::Result;
use diesel::prelude::*;
use piston_lib::game::installer::core::jre_manager::{get_or_install_jre, JavaVersion};
use piston_lib::game::installer::types::{NotificationActionSpec, ProgressReporter};
use tauri::Emitter;

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

    fn run(
        &self,
        ctx: TaskContext,
    ) -> crate::tasks::manager::BoxFuture<'static, Result<(), String>> {
        let major = self.major_version;

        Box::pin(async move {
            let jre_dir = get_app_config_dir()
                .map_err(|e| e.to_string())?
                .join("data")
                .join("jre");

            let reporter = TaskProgressReporter {
                ctx: ctx.clone(),
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
    ctx: TaskContext,
}

impl ProgressReporter for TaskProgressReporter {
    fn start_step(&self, name: &str, total_steps: Option<u32>) {
        self.ctx.update_description(name.to_string());
        if let Some(ref channel) = self.ctx.progress_channel {
            let _ = channel.send(ProgressUpdate::Step {
                name: name.to_string(),
                total: total_steps,
            });
        }
    }

    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        if let Some(total) = total {
            let percent = (transferred as f64 / total as f64 * 100.0) as i32;
            self.ctx.update_progress(percent, None, None);
        }
    }

    fn set_percent(&self, percent: i32) {
        self.ctx.update_progress(percent, None, None);
    }

    fn set_message(&self, message: &str) {
        self.ctx.update_description(message.to_string());
    }

    fn set_step_count(&self, current: u32, total: Option<u32>) {
        self.ctx.update_progress(-1, Some(current as i32), total.map(|t| t as i32));

        if let Some(ref channel) = self.ctx.progress_channel {
            let _ = channel.send(ProgressUpdate::StepCount {
                current,
                total,
            });
        }
    }

    fn set_substep(&self, name: Option<&str>, _current: Option<u32>, _total: Option<u32>) {
        if let Some(n) = name {
            self.ctx.update_description(n.to_string());
        }
    }

    fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {}

    fn done(&self, success: bool, message: Option<&str>) {
        if success {
            log::info!("Java installation finished successfully (internal done called)");
            // self.ctx.update_full(100, "Java setup complete".to_string(), None, None);
        } else {
            self.ctx.update_description(message.unwrap_or("Java download failed").to_string());
        }
    }

    fn is_cancelled(&self) -> bool {
        *self.ctx.cancel_rx.borrow()
    }

    fn is_paused(&self) -> bool {
        *self.ctx.pause_rx.borrow()
    }
}
