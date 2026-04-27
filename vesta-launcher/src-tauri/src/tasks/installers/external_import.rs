use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use crate::models::instance::Instance;
use crate::resources::ResourceWatcher;
use crate::schema::instance::dsl::instance;
use crate::tasks::installers::external_import_resync::ImportResourceResyncTask;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use tauri::Manager;
use walkdir::WalkDir;

pub struct ImportExternalInstanceTask {
    pub instance_id: i32,
    pub instance_name: String,
    pub source_game_directory: String,
}

impl ImportExternalInstanceTask {
    pub fn new(instance_id: i32, instance_name: String, source_game_directory: String) -> Self {
        Self {
            instance_id,
            instance_name,
            source_game_directory,
        }
    }
}

impl Task for ImportExternalInstanceTask {
    fn name(&self) -> String {
        format!("Import external instance {}", self.instance_name)
    }

    fn id(&self) -> Option<String> {
        Some(format!("import_external_instance_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        format!("Preparing import for {}...", self.instance_name)
    }

    fn completion_description(&self) -> String {
        format!("Import completed for {}", self.instance_name)
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let source_dir = self.source_game_directory.clone();
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            let started_at = std::time::Instant::now();
            log::info!(
                "[external_import] start instance_id={} source={}",
                instance_id,
                source_dir
            );
            if *ctx.cancel_rx.borrow() {
                return Err("Import cancelled".to_string());
            }

            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            let target: Instance = instance
                .find(instance_id)
                .first(&mut conn)
                .map_err(|e| format!("Failed to load target instance: {e}"))?;
            let is_resumed_run = target.installation_status.as_deref() == Some("interrupted");
            let target_dir = target
                .game_directory
                .clone()
                .ok_or_else(|| "Target instance has no game directory".to_string())?;

            if is_resumed_run {
                log::info!(
                    "[external_import] resume-detected instance_id={} source={}",
                    instance_id,
                    source_dir
                );
                ctx.update_description("Resuming import from previous interruption...".to_string());
            } else {
                ctx.update_description("Preparing launcher file copy...".to_string());
            }
            ctx.update_full(5, "Preparing launcher file copy...".to_string(), Some(0), Some(3));
            log::info!("[external_import] copy-start instance_id={}", instance_id);

            let watcher = app_handle.state::<ResourceWatcher>();
            ctx.update_full(
                15,
                "Waiting for watcher handoff...".to_string(),
                Some(1),
                Some(3),
            );
            log::info!(
                "[external_import] watcher-unwatch-start instance_id={}",
                instance_id
            );
            match tokio::time::timeout(
                tokio::time::Duration::from_secs(8),
                watcher.unwatch_instance(instance_id),
            )
            .await
            {
                Ok(Ok(_)) => {
                    log::info!(
                        "[external_import] watcher-unwatch-done instance_id={}",
                        instance_id
                    );
                    ctx.update_full(
                        20,
                        "Watcher handoff complete. Starting copy...".to_string(),
                        Some(1),
                        Some(3),
                    );
                }
                Ok(Err(e)) => {
                    log::warn!(
                        "[external_import] watcher-unwatch-skip instance_id={} reason={}",
                        instance_id,
                        e
                    );
                    ctx.update_full(
                        20,
                        "Watcher handoff skipped. Starting copy...".to_string(),
                        Some(1),
                        Some(3),
                    );
                }
                Err(_) => {
                    log::warn!(
                        "[external_import] watcher-unwatch-timeout instance_id={} timeout_secs=8",
                        instance_id
                    );
                    ctx.update_full(
                        20,
                        "Watcher handoff timed out. Continuing copy...".to_string(),
                        Some(1),
                        Some(3),
                    );
                }
            }

            let cancel_flag = Arc::new(AtomicBool::new(false));
            let copied_files = Arc::new(AtomicUsize::new(0));
            let mut cancel_rx = ctx.cancel_rx.clone();
            let cancel_flag_watch = cancel_flag.clone();
            tauri::async_runtime::spawn(async move {
                while cancel_rx.changed().await.is_ok() {
                    if *cancel_rx.borrow() {
                        cancel_flag_watch.store(true, Ordering::Relaxed);
                        break;
                    }
                }
            });

            let copy_cancel_flag = cancel_flag.clone();
            let copy_progress = copied_files.clone();
            let source_dir_copy = source_dir.clone();
            let target_dir_copy = target_dir.clone();
            let (done_tx, mut done_rx) = tokio::sync::oneshot::channel::<anyhow::Result<()>>();
            let copy_started_at = std::time::Instant::now();
            log::info!(
                "[external_import] copy-worker-dispatch instance_id={}",
                instance_id
            );
            ctx.update_full(
                30,
                "Copying launcher files... (0 files)".to_string(),
                Some(2),
                Some(3),
            );
            tauri::async_runtime::spawn_blocking(move || {
                log::info!(
                    "[external_import] copy-worker-start instance_id={} source={} target={}",
                    instance_id,
                    source_dir_copy,
                    target_dir_copy
                );
                let result = copy_dir_recursive(
                    Path::new(&source_dir_copy),
                    Path::new(&target_dir_copy),
                    copy_cancel_flag,
                    copy_progress,
                );
                match &result {
                    Ok(_) => log::info!(
                        "[external_import] copy-worker-finish instance_id={} elapsed_ms={}",
                        instance_id,
                        copy_started_at.elapsed().as_millis()
                    ),
                    Err(err) => log::error!(
                        "[external_import] copy-worker-error instance_id={} elapsed_ms={} error={}",
                        instance_id,
                        copy_started_at.elapsed().as_millis(),
                        err
                    ),
                }
                let _ = done_tx.send(result);
            });

            let mut last_logged_copied = 0usize;
            let mut last_progress_log_at = std::time::Instant::now();
            loop {
                match done_rx.try_recv() {
                    Ok(result) => {
                        result.map_err(|e| format!("Copy failed: {e}"))?;
                        break;
                    }
                    Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                    Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                        return Err("Copy worker channel closed unexpectedly".to_string());
                    }
                }
                let copied = copied_files.load(Ordering::Relaxed);
                if copied == 0 {
                    ctx.update_full(
                        30,
                        "Copying launcher files... (0 files)".to_string(),
                        Some(2),
                        Some(3),
                    );
                } else {
                    ctx.update_full(
                        30,
                        format!("Copying launcher files... ({copied} files)"),
                        Some(2),
                        Some(3),
                    );
                }
                if last_progress_log_at.elapsed().as_secs() >= 2 {
                    let delta = copied.saturating_sub(last_logged_copied);
                    log::info!(
                        "[external_import] copy-progress instance_id={} copied_files={} delta_since_last={} elapsed_ms={}",
                        instance_id,
                        copied,
                        delta,
                        copy_started_at.elapsed().as_millis()
                    );
                    last_logged_copied = copied;
                    last_progress_log_at = std::time::Instant::now();
                }
                if *ctx.cancel_rx.borrow() {
                    cancel_flag.store(true, Ordering::Relaxed);
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
            }

            if *ctx.cancel_rx.borrow() {
                return Err("Import cancelled".to_string());
            }
            log::info!("[external_import] copy-end instance_id={}", instance_id);
            let copied_total = copied_files.load(Ordering::Relaxed);
            ctx.update_full(
                80,
                format!("Copy complete ({} files). Finalizing...", copied_total),
                Some(2),
                Some(3),
            );

            log::info!(
                "[external_import] finalize-watch-start instance_id={}",
                instance_id
            );
            match tokio::time::timeout(
                tokio::time::Duration::from_secs(8),
                watcher.watch_instance_without_scan(target.id, target_dir.clone()),
            )
            .await
            {
                Ok(Ok(_)) => {
                    log::info!(
                        "[external_import] finalize-watch-done instance_id={}",
                        instance_id
                    );
                    ctx.update_full(
                        86,
                        "Finalizing import... (watcher attached)".to_string(),
                        Some(3),
                        Some(3),
                    );
                }
                Ok(Err(e)) => {
                    log::warn!(
                        "[external_import] finalize-watch-skip instance_id={} reason={}",
                        instance_id,
                        e
                    );
                    ctx.update_full(
                        86,
                        "Finalizing import... (watcher attach skipped)".to_string(),
                        Some(3),
                        Some(3),
                    );
                }
                Err(_) => {
                    log::warn!(
                        "[external_import] finalize-watch-timeout instance_id={} timeout_secs=8",
                        instance_id
                    );
                    ctx.update_full(
                        86,
                        "Finalizing import... (watcher attach timed out)".to_string(),
                        Some(3),
                        Some(3),
                    );
                }
            }

            if *ctx.cancel_rx.borrow() {
                return Err("Import cancelled".to_string());
            }

            log::info!(
                "[external_import] finalize-status-update-start instance_id={}",
                instance_id
            );
            crate::commands::instances::update_installation_status(
                &app_handle,
                instance_id,
                "verifying-runtime",
            )?;
            log::info!(
                "[external_import] finalize-status-update-done instance_id={}",
                instance_id
            );
            ctx.update_full(
                92,
                "Finalizing import... (runtime verification queued)".to_string(),
                Some(3),
                Some(3),
            );

            // Queue resource resync as a follow-up background task so import completion
            // feedback is immediate even for large instance folders.
            let resync_task =
                ImportResourceResyncTask::new(instance_id, target.name.clone(), target_dir.clone());
            let task_manager = app_handle.state::<crate::tasks::manager::TaskManager>();
            log::info!(
                "[external_import] finalize-resync-queue-start instance_id={}",
                instance_id
            );
            task_manager
                .submit(Box::new(resync_task))
                .await
                .map_err(|e| format!("Failed to queue import resource resync: {e}"))?;
            log::info!(
                "[external_import] finalize-resync-queue-done instance_id={}",
                instance_id
            );

            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-imported",
                serde_json::json!({
                    "instanceId": instance_id,
                }),
            );

            ctx.update_description("Import completed".to_string());
            ctx.update_full(100, "Import completed".to_string(), Some(3), Some(3));
            log::info!(
                "[external_import] completed instance_id={} elapsed_ms={}",
                instance_id,
                started_at.elapsed().as_millis()
            );
            Ok(())
        })
    }
}

fn copy_dir_recursive(
    source: &Path,
    target: &Path,
    cancel_flag: Arc<AtomicBool>,
    copied_files: Arc<AtomicUsize>,
) -> anyhow::Result<()> {
    if !source.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(target)?;

    for entry in WalkDir::new(source) {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!("Cancelled"));
        }
        let entry = entry?;
        let src_path = entry.path();
        let relative = src_path.strip_prefix(source)?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        let dst_path: PathBuf = target.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&dst_path)?;
            continue;
        }

        if let Some(parent) = dst_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src_path, &dst_path)?;
        copied_files.fetch_add(1, Ordering::Relaxed);
    }

    Ok(())
}
