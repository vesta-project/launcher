use crate::models::instance::Instance;
use crate::tasks::manager::{
    resourcepacks_conflict_key, saves_conflict_key, world_conflict_key, BoxFuture, Task,
    TaskContext,
};
use crate::worlds::transfer::{self, TransferMode};
use crate::worlds::WorldRef;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub struct WorldTransferTask {
    source_instance: Instance,
    destination_instance: Instance,
    world_ref: WorldRef,
    mode: TransferMode,
    risk_acknowledged: bool,
    cleanup_warning: Arc<Mutex<Option<String>>>,
}

impl WorldTransferTask {
    pub fn new(
        source_instance: Instance,
        destination_instance: Instance,
        world_ref: WorldRef,
        mode: TransferMode,
        risk_acknowledged: bool,
    ) -> Self {
        Self {
            source_instance,
            destination_instance,
            world_ref,
            mode,
            risk_acknowledged,
            cleanup_warning: Arc::new(Mutex::new(None)),
        }
    }
}

impl Task for WorldTransferTask {
    fn name(&self) -> String {
        format!("{:?} world {}", self.mode, self.world_ref.directory_name)
    }

    fn id(&self) -> Option<String> {
        Some(format!(
            "world_transfer_{}_{}",
            self.source_instance.id, self.world_ref.directory_name
        ))
    }

    fn cancellable(&self) -> bool {
        false
    }

    fn conflict_keys(&self) -> Vec<String> {
        vec![
            world_conflict_key(self.source_instance.id, &self.world_ref.directory_name),
            resourcepacks_conflict_key(self.source_instance.id),
            saves_conflict_key(self.destination_instance.id),
            resourcepacks_conflict_key(self.destination_instance.id),
        ]
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn total_steps(&self) -> i32 {
        3
    }

    fn starting_description(&self) -> String {
        "Validating world transfer…".to_string()
    }

    fn completion_description(&self) -> String {
        self.cleanup_warning
            .lock()
            .ok()
            .and_then(|warning| warning.clone())
            .unwrap_or_else(|| "World transfer completed".to_string())
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let source = self.source_instance.clone();
        let destination = self.destination_instance.clone();
        let world_ref = self.world_ref.clone();
        let mode = self.mode;
        let acknowledged = self.risk_acknowledged;
        let cleanup_warning = self.cleanup_warning.clone();
        Box::pin(async move {
            ctx.update_full(
                20,
                "Copying and verifying world…".to_string(),
                Some(1),
                Some(3),
            );
            let source_for_task = source.clone();
            let destination_for_task = destination.clone();
            let mut result = tauri::async_runtime::spawn_blocking(move || {
                transfer::prepare_world_transfer(
                    &source_for_task,
                    &destination_for_task,
                    &world_ref,
                    mode,
                    acknowledged,
                )
            })
            .await
            .map_err(|error| format!("World transfer task failed: {error}"))??;

            ctx.update_full(
                85,
                "Updating installed resource records…".to_string(),
                Some(2),
                Some(3),
            );
            let companion_paths = result
                .companion_publications
                .iter()
                .map(|companion| {
                    (
                        companion.source_path.clone(),
                        companion.destination_path.clone(),
                    )
                })
                .collect::<Vec<_>>();
            let ledger_result = crate::resources::ledger::publish_world_transfer(
                source.id,
                destination.id,
                &result.source_path,
                &result.destination_path,
                mode == TransferMode::Move,
                &companion_paths,
            );
            if let Err(error) = ledger_result {
                let rollback = transfer::rollback_prepared_transfer(&result, mode);
                return Err(match rollback {
                    Ok(()) => format!("Failed to update installed resource records: {error}"),
                    Err(rollback_error) => format!(
                        "Failed to update installed resource records: {error}; rollback also failed: {rollback_error}"
                    ),
                });
            }
            if mode == TransferMode::Move {
                transfer::finalize_prepared_move(&mut result);
            }

            ctx.update_full(
                100,
                "World transfer completed".to_string(),
                Some(3),
                Some(3),
            );
            let reason = match mode {
                TransferMode::Move => "moved",
                TransferMode::Copy => "copied",
                TransferMode::Duplicate => "duplicated",
            };
            let mut affected_instances = vec![source.id, destination.id];
            affected_instances.sort_unstable();
            affected_instances.dedup();
            for instance_id in affected_instances {
                if let Some(world_manager) =
                    ctx.app_handle.try_state::<crate::worlds::WorldManager>()
                {
                    world_manager.invalidate(instance_id);
                }
                let _ = ctx.app_handle.emit(
                    "core://instance-worlds-changed",
                    serde_json::json!({
                        "instanceId": instance_id,
                        "revision": chrono::Utc::now().timestamp_millis(),
                        "reason": reason,
                    }),
                );
            }
            if let Some(warning) = result.cleanup_warning {
                log::warn!("World move completed with cleanup warning: {warning}");
                if let Ok(mut completion) = cleanup_warning.lock() {
                    *completion = Some(format!(
                        "World moved, but cleanup needs attention: {warning}"
                    ));
                }
            }
            Ok(())
        })
    }
}
