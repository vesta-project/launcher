use std::path::PathBuf;

use crate::notifications::models::NotificationContext;
use crate::sync::safeguards;
use crate::tasks::manager::{instance_play_conflict_key, Task, TaskContext};
use tauri::Manager;

pub struct UpdateModpackTask {
    pub instance_id: i32,
    pub instance_name: String,
    pub new_version_id: String,
    pub game_dir: PathBuf,
}

impl UpdateModpackTask {
    pub fn new(
        instance_id: i32,
        instance_name: String,
        new_version_id: String,
        game_dir: PathBuf,
    ) -> Self {
        Self {
            instance_id,
            instance_name,
            new_version_id,
            game_dir,
        }
    }

    async fn wait_for_instance_exit(game_dir: &PathBuf, ctx: &TaskContext) -> Result<(), String> {
        let mut cancel = ctx.cancel_rx.clone();
        while safeguards::check_instance_not_running(game_dir).is_err() {
            ctx.update_description(
                "Update queued — close Minecraft for this instance to continue, or cancel."
                    .to_string(),
            );
            if *cancel.borrow() {
                return Err("Update cancelled".to_string());
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {},
                _ = cancel.changed() => {
                    if *cancel.borrow() {
                        return Err("Update cancelled".to_string());
                    }
                }
            }
        }
        Ok(())
    }
}

impl Task for UpdateModpackTask {
    fn name(&self) -> String {
        "Updating Modpack".to_string()
    }

    fn id(&self) -> Option<String> {
        Some(format!("update_modpack_{}", self.instance_id))
    }

    fn notification_context(&self) -> Option<NotificationContext> {
        Some(NotificationContext::instance(
            self.instance_id,
            Some(self.instance_name.clone()),
        ))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn conflict_keys(&self) -> Vec<String> {
        vec![instance_play_conflict_key(self.instance_id)]
    }

    fn starting_description(&self) -> String {
        format!("Preparing the modpack update for ‘{}’…", self.instance_name)
    }

    fn completion_description(&self) -> String {
        format!(
            "Updated the modpack for ‘{}’ successfully.",
            self.instance_name
        )
    }

    fn failure_description(&self, error: &str) -> String {
        format!(
            "Failed to update the modpack for instance ‘{}’: {}",
            self.instance_name, error
        )
    }

    fn ready(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let game_dir = self.game_dir.clone();

        Box::pin(async move { Self::wait_for_instance_exit(&game_dir, &ctx).await })
    }

    fn on_abandoned(&self, app: &tauri::AppHandle) -> futures::future::BoxFuture<'static, ()> {
        let instance_id = self.instance_id;
        let game_dir = self.game_dir.clone();
        let app_handle = app.clone();
        Box::pin(async move {
            // begin() already wrote pending/status before submit; discard must restore them
            // so cancellation before run does not leave the Instance stuck installing.
            crate::modpack::update::rollback_start(&app_handle, instance_id, &game_dir);
        })
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let new_version_id = self.new_version_id.clone();
        let game_dir = self.game_dir.clone();
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            // The command already marked this instance as updating. Construct
            // the guard before pausing the watcher or any other fallible task
            // setup so every failure restores the last playable installation
            // before TaskManager publishes its persistent failure notification.
            let mut status_guard = crate::modpack::update::StatusGuard::new(
                app_handle.clone(),
                instance_id,
                game_dir.clone(),
            );

            // Revalidate under exclusion after the worker permit is held. External
            // Java launches can still appear later; readiness cannot close that OS
            // boundary, so planning and apply re-check live process state.
            if let Err(error) = Self::wait_for_instance_exit(&game_dir, &ctx).await {
                let _ = status_guard.recover_failure();
                return Err(error);
            }

            let watcher_handle = app_handle.clone();
            let resume_game_dir = game_dir.clone();
            if let Err(pause_error) = watcher_handle
                .state::<crate::resources::watcher::ResourceWatcher>()
                .unwatch_instance(instance_id)
                .await
            {
                let recovery = status_guard.recover_failure();
                return match recovery {
                    Ok(_) => Err(format!(
                        "Failed to pause resource watcher: {}",
                        pause_error
                    )),
                    Err(recovery_error) => Err(format!(
                        "Failed to pause resource watcher: {}. Automatic recovery is incomplete: {}.",
                        pause_error, recovery_error
                    )),
                };
            }
            let update_result = async move {
                // ─── Load instance ───────────────────────────────────────────
                let mut conn =
                    crate::utils::db::get_vesta_conn().map_err(|e| format!("DB error: {}", e))?;
                use crate::schema::instance::dsl::*;
                use diesel::prelude::*;

                let inst: crate::models::instance::Instance = instance
                    .find(instance_id)
                    .first(&mut conn)
                    .map_err(|e| format!("Instance not found: {}", e))?;

                // ─── Phase 1: Manifest Fetch & Differential Audit ────────────
                let mut plan = crate::modpack::engine::plan(
                    &app_handle,
                    &inst,
                    &game_dir,
                    &new_version_id,
                    &ctx,
                )
                .await?;

                if safeguards::check_instance_not_running(&game_dir).is_err() {
                    // A process appeared after the audit. Discard the plan, wait,
                    // and recompute so live mutation never races a late launch.
                    Self::wait_for_instance_exit(&game_dir, &ctx).await?;
                    plan = crate::modpack::engine::plan(
                        &app_handle,
                        &inst,
                        &game_dir,
                        &new_version_id,
                        &ctx,
                    )
                    .await?;
                    safeguards::check_instance_not_running(&game_dir).map_err(|e| e.to_string())?;
                }

                let total_actions = plan.actions.actionable_count();
                let already_up_to_date = plan.actions.is_empty() && total_actions == 0;
                log::info!(
                    "[UpdateModpackTask] Action plan: {} actions, {} protected, {} world collisions, {} corrupted",
                    total_actions,
                    plan.actions.protected_count,
                    plan.actions.world_collisions.len(),
                    plan.actions.corrupted_configs.len(),
                );

                safeguards::check_instance_not_running(&game_dir).map_err(|e| e.to_string())?;
                let outcome =
                    crate::modpack::engine::apply(&app_handle, &game_dir, &mut plan, &ctx).await?;
                let skipped_deletions = outcome.skipped_deletions;
                let preserved_worlds = outcome.preserved_worlds;

                ctx.update_full(
                    90,
                    "Saving manifest and finalizing...".to_string(),
                    Some(5),
                    Some(6),
                );
                let finished = match crate::modpack::update::finish(
                    &app_handle,
                    &ctx,
                    &inst,
                    &plan.old_manifest,
                    &plan.new_manifest,
                    &new_version_id,
                    &game_dir,
                    &plan.zip_path,
                )
                .await
                {
                Ok(finished) => finished,
                Err(update_error) => {
                    let file_rollback = outcome.rollback();
                    let metadata_rollback = status_guard.recover_failure();

                    return match (file_rollback, metadata_rollback) {
                        (Ok(()), Ok(_)) => Err(format!(
                            "{} The previous instance was restored.",
                            update_error
                        )),
                        (files, metadata) => Err(format!(
                            "{} Automatic rollback was incomplete (files: {}; metadata: {}).",
                            update_error,
                            files.err().unwrap_or_else(|| "restored".to_string()),
                            metadata.err().unwrap_or_else(|| "restored".to_string()),
                        )),
                    };
                }
                };
                if let Err(finalize_error) = outcome.finalize() {
                    return match status_guard.recover_failure() {
                    Ok(_) => Err(format!(
                        "Failed to commit update recovery state: {}. The previous instance was restored.",
                        finalize_error
                    )),
                    Err(recovery_error) => Err(format!(
                        "Failed to commit update recovery state: {}. Automatic recovery is incomplete: {}.",
                        finalize_error, recovery_error
                    )),
                    };
                }
                if let Err(reconciliation_error) =
                    finished.publish_local_facts(&app_handle, instance_id)
                {
                // Files and Instance metadata are already durably committed. Do not
                // roll them back solely because derived Ledger publication failed;
                // the next Resources load safely rebuilds these local facts.
                    status_guard.mark_success();
                    return Err(format!(
                        "The modpack update was committed, but its resource list could not be reconciled: {}. Reopen Resources to retry.",
                        reconciliation_error
                    ));
                }
                if let Err(clear_error) = crate::modpack::update::clear_pending(&game_dir) {
                // The update is durably committed. Leave both markers in place
                // so startup can retry cleanup without rolling back new files.
                    log::warn!(
                        "[UpdateModpackTask] Pending update cleanup deferred for instance {}: {}",
                        instance_id,
                        clear_error
                    );
                    status_guard.mark_success();
                    finished.publish(&app_handle, instance_id);
                    return Ok(());
                }
                if let Err(cleanup_error) =
                    crate::sync::staging::RollbackSnapshot::cleanup_committed(&game_dir)
                {
                    log::warn!(
                        "[UpdateModpackTask] Committed rollback cleanup deferred for instance {}: {}",
                        instance_id,
                        cleanup_error
                    );
                }
                status_guard.mark_success();
                finished.publish(&app_handle, instance_id);

                let skipped_msg = if skipped_deletions > 0 {
                    format!(" ({} user-modified files were kept)", skipped_deletions)
                } else {
                    String::new()
                };
                let world_msg = if preserved_worlds > 0 {
                    format!(
                        " {} world save(s) were preserved in timestamped folders.",
                        preserved_worlds
                    )
                } else {
                    String::new()
                };

                ctx.update_full(
                    100,
                    if already_up_to_date {
                        "Modpack is already up to date.".to_string()
                    } else {
                        format!(
                            "Modpack updated to version {} successfully.{}{}",
                            plan.new_manifest.version, skipped_msg, world_msg
                        )
                    },
                    Some(6),
                    Some(6),
                );

                Ok(())
            }
            .await;

            let watcher_result = watcher_handle
                .state::<crate::resources::watcher::ResourceWatcher>()
                .watch_instance_without_scan(
                    instance_id,
                    resume_game_dir.to_string_lossy().into_owned(),
                )
                .await
                .map_err(|error| format!("Failed to resume resource watcher: {error}"));

            match (update_result, watcher_result) {
                (Ok(()), Ok(())) => Ok(()),
                (Err(update_error), Ok(())) => Err(update_error),
                (Ok(()), Err(watcher_error)) => Err(format!(
                    "Modpack update completed, but its resource watcher could not be resumed: {}",
                    watcher_error
                )),
                (Err(update_error), Err(watcher_error)) => Err(format!(
                    "{}. Resource watcher could not be resumed: {}",
                    update_error, watcher_error
                )),
            }
        })
    }
}
