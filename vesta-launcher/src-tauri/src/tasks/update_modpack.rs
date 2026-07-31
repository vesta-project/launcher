use std::path::PathBuf;

use crate::tasks::manager::{Task, TaskContext};

use crate::sync::safeguards;

pub struct UpdateModpackTask {
    pub instance_id: i32,
    pub new_version_id: String,
    pub game_dir: PathBuf,
}

impl UpdateModpackTask {
    pub fn new(instance_id: i32, new_version_id: String, game_dir: PathBuf) -> Self {
        Self {
            instance_id,
            new_version_id,
            game_dir,
        }
    }
}

impl Task for UpdateModpackTask {
    fn name(&self) -> String {
        "Updating Modpack".to_string()
    }

    fn id(&self) -> Option<String> {
        Some(format!("update_modpack_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        "Preparing modpack update...".to_string()
    }

    fn completion_description(&self) -> String {
        "Modpack updated successfully".to_string()
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let new_version_id = self.new_version_id.clone();
        let game_dir = self.game_dir.clone();
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            // The command already marked this instance as updating. Construct
            // the guard before any fallible task setup so every failure restores
            // the last playable installation before TaskManager publishes its
            // persistent failure notification.
            let mut status_guard = crate::modpack::update::StatusGuard::new(
                app_handle.clone(),
                instance_id,
                game_dir.clone(),
            );

            // ─── Load instance ───────────────────────────────────────────
            let mut conn =
                crate::utils::db::get_vesta_conn().map_err(|e| format!("DB error: {}", e))?;
            use crate::schema::instance::dsl::*;
            use diesel::prelude::*;

            let inst: crate::models::instance::Instance = instance
                .find(instance_id)
                .first(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;

            // ─── Safeguard: ensure Minecraft is not running ──────────────
            ctx.update_description("Checking that Minecraft is not running...".to_string());
            if let Err(e) = safeguards::check_instance_not_running(&game_dir) {
                return Err(format!("{}", e));
            }

            // ─── Phase 1: Manifest Fetch & Differential Audit ────────────
            let mut plan =
                crate::modpack::engine::plan(&app_handle, &inst, &game_dir, &new_version_id, &ctx)
                    .await?;

            let total_actions = plan.actions.actionable_count();
            let already_up_to_date = plan.actions.is_empty() && total_actions == 0;
            log::info!(
                "[UpdateModpackTask] Action plan: {} actions, {} protected, {} world collisions, {} corrupted",
                total_actions,
                plan.actions.protected_count,
                plan.actions.world_collisions.len(),
                plan.actions.corrupted_configs.len(),
            );

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
            if let Err(clear_error) = crate::modpack::update::clear_pending(&game_dir) {
                // The update is durably committed. Leave both markers in place
                // so startup can retry cleanup without rolling back new files.
                log::warn!(
                    "[UpdateModpackTask] Pending update cleanup deferred for instance {}: {}",
                    instance_id,
                    clear_error
                );
                status_guard.mark_success();
                finished.publish(&app_handle, instance_id, &game_dir);
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
            finished.publish(&app_handle, instance_id, &game_dir);

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
        })
    }
}
