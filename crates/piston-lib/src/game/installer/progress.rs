//! Compose estimated operation ranges without changing stage-local progress.
use super::types::{NotificationActionSpec, ProgressReporter};
use std::sync::{
    atomic::{AtomicI32, Ordering},
    Arc,
};

pub struct ProgressRange {
    inner: Arc<dyn ProgressReporter>,
    start: i32,
    end: i32,
    stage: bool,
    last_overall: AtomicI32,
}

impl ProgressRange {
    /// Map a nested operation's explicit overall progress into its parent's range.
    pub fn operation(
        inner: Arc<dyn ProgressReporter>,
        start: i32,
        end: i32,
    ) -> Arc<dyn ProgressReporter> {
        inner.set_overall_percent(start);
        Arc::new(Self {
            inner,
            start,
            end,
            stage: false,
            last_overall: AtomicI32::new(start),
        })
    }

    /// Map a single stage's local percentage into its operation's overall range.
    pub fn stage(
        inner: Arc<dyn ProgressReporter>,
        start: i32,
        end: i32,
    ) -> Arc<dyn ProgressReporter> {
        inner.set_overall_percent(start);
        Arc::new(Self {
            inner,
            start,
            end,
            stage: true,
            last_overall: AtomicI32::new(start),
        })
    }

    fn emit(&self, percent: i32) {
        let mapped = self.mapped(percent);
        if mapped > self.last_overall.fetch_max(mapped, Ordering::Relaxed) {
            self.inner.set_overall_percent(mapped);
        }
    }

    fn mapped(&self, percent: i32) -> i32 {
        self.start + (self.end - self.start) * percent.clamp(0, 100) / 100
    }
}

impl ProgressReporter for ProgressRange {
    fn set_stage(&self, stage: &str) {
        self.inner.set_stage(stage);
    }
    fn start_step(&self, name: &str, total: Option<u32>) {
        self.inner.start_step(name, total);
    }
    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        self.inner.update_bytes(transferred, total);
        if self.stage {
            if let Some(total) = total.filter(|total| *total > 0) {
                let percent = (transferred as f64 / total as f64 * 100.0).clamp(0.0, 100.0) as i32;
                self.emit(percent);
            }
        }
    }
    fn set_percent(&self, percent: i32) {
        self.inner.set_percent(percent);
        if self.stage && percent >= 0 {
            self.emit(percent);
        }
    }
    fn set_overall_percent(&self, percent: i32) {
        if percent >= 0 {
            self.emit(percent);
        }
    }
    fn set_message(&self, message: &str) {
        self.inner.set_message(message);
    }
    fn set_step_count(&self, current: u32, total: Option<u32>) {
        self.inner.set_step_count(current, total);
    }
    fn set_substep(&self, name: Option<&str>, current: Option<u32>, total: Option<u32>) {
        self.inner.set_substep(name, current, total);
    }
    fn set_actions(&self, actions: Option<Vec<NotificationActionSpec>>) {
        self.inner.set_actions(actions);
    }
    fn done(&self, success: bool, message: Option<&str>) {
        self.inner.done(success, message);
    }
    fn is_cancelled(&self) -> bool {
        self.inner.is_cancelled()
    }
    fn is_paused(&self) -> bool {
        self.inner.is_paused()
    }
    fn is_dry_run(&self) -> bool {
        self.inner.is_dry_run()
    }
}
