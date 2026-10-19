use crate::notifications::models::ProgressUpdate;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::java::install_managed_java;
use anyhow::Result;
use piston_lib::game::installer::types::{NotificationActionSpec, ProgressReporter};

pub struct DownloadJavaTask {
    pub major_version: u32,
}

impl Task for DownloadJavaTask {
    fn activity_kind(&self) -> crate::tasks::activity::ActivityKind {
        crate::tasks::activity::ActivityKind::JavaDownload
    }
    fn activity_subject(&self) -> Option<crate::tasks::activity::Subject> {
        Some(crate::tasks::activity::Subject {
            id: Some(self.major_version.to_string()),
            name: self.major_version.to_string(),
            icon_url: None,
            instance_id: None,
        })
    }

    fn name(&self) -> String {
        format!("Downloading Java {}", self.major_version)
    }

    fn id(&self) -> Option<String> {
        Some(format!("download_java_{}", self.major_version))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
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
            let reporter = TaskProgressReporter {
                ctx: ctx.clone(),
                last_percent: std::sync::atomic::AtomicI32::new(-1),
                last_emit: std::sync::Mutex::new(std::time::Instant::now()),
            };

            ctx.set_stage("downloading");
            install_managed_java(&ctx.app_handle, major, &reporter).await?;
            Ok(())
        })
    }
}

struct TaskProgressReporter {
    ctx: TaskContext,
    last_percent: std::sync::atomic::AtomicI32,
    last_emit: std::sync::Mutex<std::time::Instant>,
}

impl ProgressReporter for TaskProgressReporter {
    fn set_stage(&self, stage: &str) {
        self.ctx.set_stage(stage);
    }
    fn start_step(&self, name: &str, total_steps: Option<u32>) {
        if let Some(total) = total_steps {
            self.ctx.update_items(0, Some(total as u64));
        }
        self.ctx.update_description(name.to_string());
        if let Some(ref channel) = self.ctx.progress_channel {
            let _ = channel.send(ProgressUpdate::Step {
                name: name.to_string(),
                total: total_steps,
            });
        }
    }

    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        if let Some(total) = total.filter(|total| *total > 0) {
            let before = self.last_percent.load(std::sync::atomic::Ordering::Relaxed);
            self.set_percent(
                ((transferred as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as i32,
            );
            if before != self.last_percent.load(std::sync::atomic::Ordering::Relaxed)
                || transferred >= total
            {
                self.ctx.update_bytes(transferred, Some(total));
            }
        } else {
            let mut last = self.last_emit.lock().unwrap();
            if last.elapsed() >= std::time::Duration::from_millis(150) {
                *last = std::time::Instant::now();
                self.ctx.update_bytes(transferred, None);
            }
        }
    }

    fn set_percent(&self, percent: i32) {
        const MIN_INTERVAL_MS: u64 = 150;
        const MIN_PERCENT_DELTA: i32 = 1;

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
            if percent >= 0 {
                self.ctx.update_overall_progress(percent * 9 / 10);
            }
            self.ctx.update_progress(percent, None, None);
        }
    }

    fn set_message(&self, message: &str) {
        self.ctx.update_description(message.to_string());
    }

    fn set_step_count(&self, current: u32, total: Option<u32>) {
        self.ctx.update_items(current as u64, total.map(u64::from));
        let known_percent = self.last_percent.load(std::sync::atomic::Ordering::Relaxed);
        self.ctx.update_progress(
            if known_percent >= 0 {
                known_percent
            } else {
                -1
            },
            Some(current as i32),
            total.map(|t| t as i32),
        );

        if let Some(ref channel) = self.ctx.progress_channel {
            let _ = channel.send(ProgressUpdate::StepCount { current, total });
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
            self.ctx
                .update_description(message.unwrap_or("Java download failed").to_string());
        }
    }

    fn is_cancelled(&self) -> bool {
        *self.ctx.cancel_rx.borrow()
    }

    fn is_paused(&self) -> bool {
        *self.ctx.pause_rx.borrow()
    }
}
