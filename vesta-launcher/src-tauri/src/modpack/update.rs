use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::tasks::installers::modpack::spawn_manifest_resource_linking;
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::manager::{Task, TaskContext};
use piston_lib::game::modpack::manifest::ModpackManifest;

#[derive(Debug, Serialize, Deserialize)]
struct PendingUpdate {
    version_id: String,
}

pub fn begin(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    game_dir: &Path,
    version_id: &str,
) -> Result<(), String> {
    write_pending(game_dir, version_id)?;

    if let Err(error) =
        crate::commands::instances::update_instance_operation(app_handle, instance_id, "update")
    {
        clear_pending(game_dir);
        return Err(error);
    }

    if let Err(error) = crate::commands::instances::update_installation_status(
        app_handle,
        instance_id,
        "installing",
    ) {
        clear_pending(game_dir);
        return Err(error);
    }

    Ok(())
}

pub fn rollback_start(app_handle: &tauri::AppHandle, instance_id: i32, game_dir: &Path) {
    let _ = crate::commands::instances::update_installation_status(
        app_handle,
        instance_id,
        "installed",
    );
    clear_pending(game_dir);
}

pub fn pending_target(game_dir: &Path) -> Option<String> {
    let content = std::fs::read_to_string(pending_path(game_dir)).ok()?;
    serde_json::from_str::<PendingUpdate>(&content)
        .ok()
        .map(|pending| pending.version_id)
}

pub fn clear_pending(game_dir: &Path) {
    let _ = std::fs::remove_file(pending_path(game_dir));
}

pub async fn finish(
    app_handle: &tauri::AppHandle,
    ctx: &TaskContext,
    instance: &crate::models::instance::Instance,
    old_manifest: &ModpackManifest,
    new_manifest: &ModpackManifest,
    new_version_id: &str,
    game_dir: &Path,
    source_zip_path: &Path,
) -> Result<(), String> {
    let runtime_changed = crate::utils::instance_runtime::manifest_runtime_identity_changed(
        old_manifest,
        new_manifest,
    );

    let mut manifest = new_manifest.clone();
    manifest.installed_at = chrono::Utc::now().to_rfc3339();
    manifest.source_zip_path = Some(source_zip_path.to_path_buf());
    crate::sync::manifest::backfill_manifest_hashes(&mut manifest, game_dir, instance.id)
        .map_err(|error| format!("Failed to backfill manifest hashes: {}", error))?;
    manifest
        .persist(game_dir)
        .map_err(|error| format!("Failed to persist manifest: {}", error))?;

    spawn_manifest_resource_linking(app_handle, instance.id, game_dir, &manifest);

    let runtime_fields =
        crate::utils::instance_runtime::InstanceRuntimeFields::from_manifest(new_manifest);
    crate::utils::instance_runtime::sync_fields(instance.id, &runtime_fields)?;

    let mut conn = crate::utils::db::get_vesta_conn().map_err(|error| error.to_string())?;
    use crate::schema::instance::dsl as instances;
    use diesel::prelude::*;

    diesel::update(instances::instance.filter(instances::id.eq(instance.id)))
        .set((
            instances::modpack_version_id.eq(Some(new_version_id.to_string())),
            instances::installation_status.eq(Some("installed".to_string())),
        ))
        .execute(&mut conn)
        .map_err(|error| format!("Failed to update modpack version metadata: {}", error))?;

    let mut updated = instances::instance
        .find(instance.id)
        .first::<crate::models::instance::Instance>(&mut conn)
        .map_err(|error| format!("Failed to fetch updated instance: {}", error))?;

    if runtime_changed {
        ctx.update_description(
            "Reinstalling game runtime for new Minecraft version...".to_string(),
        );
        let mut install_task = InstallInstanceTask::new(updated.clone());
        install_task.set_update_notification_title(false);
        install_task.run(ctx.clone()).await?;

        updated = instances::instance
            .find(instance.id)
            .first::<crate::models::instance::Instance>(&mut conn)
            .map_err(|error| {
                format!("Failed to fetch instance after runtime install: {}", error)
            })?;
    }

    crate::utils::java::ensure_java_for_instance(app_handle, &updated, None, None)
        .await
        .map_err(|error| format!("Java setup failed after modpack update: {}", error))?;

    let processed = crate::commands::instances::get_instance(instance.id)
        .map_err(|error| format!("Failed to fetch updated instance for emit: {}", error))?;
    let _ = app_handle.emit("core://instance-updated", processed.clone());
    let _ = app_handle.emit("core://instance-installed", processed);

    clear_pending(game_dir);

    log::info!(
        "[modpack-update] Update complete: {} → {} (MC {} {})",
        instance.modpack_version_id.as_deref().unwrap_or("?"),
        new_version_id,
        runtime_fields.minecraft_version,
        runtime_fields.modloader.as_deref().unwrap_or("vanilla"),
    );

    Ok(())
}

pub struct StatusGuard {
    app_handle: tauri::AppHandle,
    instance_id: i32,
    game_dir: PathBuf,
    succeeded: bool,
}

impl StatusGuard {
    pub fn new(app_handle: tauri::AppHandle, instance_id: i32, game_dir: PathBuf) -> Self {
        Self {
            app_handle,
            instance_id,
            game_dir,
            succeeded: false,
        }
    }

    pub fn mark_success(&mut self) {
        self.succeeded = true;
    }
}

impl Drop for StatusGuard {
    fn drop(&mut self) {
        if self.succeeded {
            return;
        }

        let app_handle = self.app_handle.clone();
        let instance_id = self.instance_id;
        let game_dir = self.game_dir.clone();
        tauri::async_runtime::spawn(async move {
            clear_pending(&game_dir);
            if let Err(error) = crate::commands::instances::update_installation_status(
                &app_handle,
                instance_id,
                "installed",
            ) {
                log::warn!(
                    "[modpack-update] Failed to restore instance {} after update failure: {}",
                    instance_id,
                    error
                );
            }
        });
    }
}

fn write_pending(game_dir: &Path, version_id: &str) -> Result<(), String> {
    let vesta_dir = game_dir.join(".vesta");
    std::fs::create_dir_all(&vesta_dir).map_err(|error| error.to_string())?;
    let json = serde_json::to_string(&PendingUpdate {
        version_id: version_id.to_string(),
    })
    .map_err(|error| error.to_string())?;
    std::fs::write(pending_path(game_dir), json).map_err(|error| error.to_string())
}

fn pending_path(game_dir: &Path) -> PathBuf {
    game_dir.join(".vesta").join("pending_update.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_target_round_trips_and_clears() {
        let temp = tempfile::tempdir().expect("temporary game directory");

        write_pending(temp.path(), "new-version").expect("persist pending update");
        assert_eq!(pending_target(temp.path()).as_deref(), Some("new-version"));

        clear_pending(temp.path());
        assert_eq!(pending_target(temp.path()), None);
    }
}
