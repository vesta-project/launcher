use std::path::PathBuf;

use crate::tasks::manager::{Task, TaskContext};

use crate::sync::safeguards;

pub struct UpdateModpackTask {
    pub instance_id: i32,
    pub new_version_id: String,
}

impl UpdateModpackTask {
    pub fn new(instance_id: i32, new_version_id: String) -> Self {
        Self {
            instance_id,
            new_version_id,
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
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            // ─── Load instance ───────────────────────────────────────────
            let mut conn =
                crate::utils::db::get_vesta_conn().map_err(|e| format!("DB error: {}", e))?;
            use crate::schema::instance::dsl::*;
            use diesel::prelude::*;

            let inst: crate::models::instance::Instance = instance
                .find(instance_id)
                .first(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;

            let config_dir =
                crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            let data_dir = config_dir.join("data");
            let game_dir = inst
                .game_directory
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));

            let mut status_guard = crate::modpack::update::StatusGuard::new(
                app_handle.clone(),
                instance_id,
                game_dir.clone(),
            );

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
            log::info!(
                "[UpdateModpackTask] Action plan: {} actions, {} protected, {} world collisions, {} corrupted",
                total_actions,
                plan.actions.protected_count,
                plan.actions.world_collisions.len(),
                plan.actions.corrupted_configs.len(),
            );

            if plan.actions.is_empty() && total_actions == 0 {
                // No changes needed — just update the version metadata
                ctx.update_full(
                    100,
                    "Modpack is already up to date.".to_string(),
                    Some(6),
                    Some(6),
                );
                crate::modpack::update::finish(
                    &app_handle,
                    &ctx,
                    &inst,
                    &plan.old_manifest,
                    &plan.new_manifest,
                    &new_version_id,
                    &game_dir,
                    &plan.zip_path,
                )
                .await?;
                status_guard.mark_success();
                return Ok(());
            }

            let outcome =
                crate::modpack::engine::apply(&app_handle, &game_dir, &mut plan, &ctx).await?;

            ctx.update_full(
                90,
                "Saving manifest and finalizing...".to_string(),
                Some(5),
                Some(6),
            );
            crate::modpack::update::finish(
                &app_handle,
                &ctx,
                &inst,
                &plan.old_manifest,
                &plan.new_manifest,
                &new_version_id,
                &game_dir,
                &plan.zip_path,
            )
            .await?;
            status_guard.mark_success();

            let skipped_msg = if outcome.skipped_deletions > 0 {
                format!(
                    " ({} user-modified files were kept)",
                    outcome.skipped_deletions
                )
            } else {
                String::new()
            };
            let world_msg = if outcome.preserved_worlds > 0 {
                format!(
                    " {} world save(s) were preserved in timestamped folders.",
                    outcome.preserved_worlds
                )
            } else {
                String::new()
            };

            ctx.update_full(
                100,
                format!(
                    "Modpack updated to version {} successfully.{}{}",
                    plan.new_manifest.version, skipped_msg, world_msg
                ),
                Some(6),
                Some(6),
            );

            Ok(())
        })
    }
}
