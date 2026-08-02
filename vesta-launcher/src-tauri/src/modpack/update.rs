use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;

use crate::tasks::installers::modpack::spawn_manifest_resource_linking;
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::manager::{Task, TaskContext};
use piston_lib::game::modpack::manifest::ModpackManifest;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateRecoveryOutcome {
    None,
    Restored,
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PreviousInstanceMetadata {
    minecraft_version: String,
    modloader: Option<String>,
    modloader_version: Option<String>,
    modpack_version_id: Option<String>,
}

impl From<&crate::models::instance::Instance> for PreviousInstanceMetadata {
    fn from(instance: &crate::models::instance::Instance) -> Self {
        Self {
            minecraft_version: instance.minecraft_version.clone(),
            modloader: instance.modloader.clone(),
            modloader_version: instance.modloader_version.clone(),
            modpack_version_id: instance.modpack_version_id.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingUpdate {
    version_id: String,
    #[serde(default)]
    previous: Option<PreviousInstanceMetadata>,
}

pub struct FinishedUpdate {
    processed: crate::models::instance::Instance,
    manifest: ModpackManifest,
}

impl FinishedUpdate {
    pub fn publish(self, app_handle: &tauri::AppHandle, instance_id: i32, game_dir: &Path) {
        spawn_manifest_resource_linking(app_handle, instance_id, game_dir, &self.manifest);
        let _ = app_handle.emit("core://instance-updated", self.processed.clone());
        let _ = app_handle.emit("core://instance-installed", self.processed);
    }
}

pub fn begin(
    app_handle: &tauri::AppHandle,
    instance: &crate::models::instance::Instance,
    game_dir: &Path,
    version_id: &str,
) -> Result<(), String> {
    if has_pending_recovery(game_dir) {
        return Err(
            "A previous update recovery is still pending. Resume recovery before starting another update."
                .to_string(),
        );
    }
    write_pending(game_dir, version_id, Some(instance.into()))?;

    if let Err(error) =
        crate::commands::instances::update_instance_operation(app_handle, instance.id, "update")
    {
        let _ = clear_pending(game_dir);
        return Err(error);
    }

    if let Err(error) = crate::commands::instances::update_installation_status(
        app_handle,
        instance.id,
        "installing",
    ) {
        let _ = clear_pending(game_dir);
        return Err(error);
    }

    Ok(())
}

pub fn rollback_start(app_handle: &tauri::AppHandle, instance_id: i32, game_dir: &Path) {
    if let Err(error) = recover_previous_instance(app_handle, instance_id, game_dir) {
        let _ = mark_recovery_interrupted(app_handle, instance_id);
        publish_recovery_required_notification(app_handle, instance_id, &error);
        log::error!(
            "[modpack-update] Failed to roll back update submission for instance {}: {}",
            instance_id,
            error
        );
    }
}

fn restore_previous_metadata(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    previous: &PreviousInstanceMetadata,
) -> Result<(), String> {
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|error| error.to_string())?;
    use crate::schema::instance::dsl as instances;
    use diesel::prelude::*;

    diesel::update(instances::instance.filter(instances::id.eq(instance_id)))
        .set((
            instances::minecraft_version.eq(&previous.minecraft_version),
            instances::modloader.eq(&previous.modloader),
            instances::modloader_version.eq(&previous.modloader_version),
            instances::modpack_version_id.eq(&previous.modpack_version_id),
            instances::installation_status.eq(Some("installed".to_string())),
        ))
        .execute(&mut conn)
        .map_err(|error| format!("Failed to restore previous instance metadata: {}", error))?;

    let restored = crate::commands::instances::get_instance(instance_id)?;
    let _ = app_handle.emit("core://instance-updated", restored);
    Ok(())
}

pub fn recover_previous_instance(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    game_dir: &Path,
) -> Result<UpdateRecoveryOutcome, String> {
    let has_snapshot = crate::sync::staging::RollbackSnapshot::pending_exists(game_dir);
    if has_snapshot
        && crate::sync::staging::RollbackSnapshot::pending_is_committed(game_dir)
            .map_err(|error| error.to_string())?
    {
        // Keep the committed journal until the pending marker is gone. If
        // clearing the marker fails, startup can safely retry without ever
        // interpreting the new files as an update that needs rolling back.
        clear_pending(game_dir)?;
        crate::commands::instances::update_installation_status(
            app_handle,
            instance_id,
            "installed",
        )?;
        crate::sync::staging::RollbackSnapshot::cleanup_committed(game_dir)
            .map_err(|error| error.to_string())?;
        return Ok(UpdateRecoveryOutcome::Committed);
    }

    let pending = read_pending(game_dir)?;
    if pending.is_none() && !has_snapshot {
        return Ok(UpdateRecoveryOutcome::None);
    }

    let pending = pending.ok_or_else(|| {
        "Rollback files exist without update metadata; preserving them for manual recovery"
            .to_string()
    })?;
    if has_snapshot && pending.previous.is_none() {
        return Err(
            "Legacy rollback files cannot be restored safely; preserving them for manual recovery"
                .to_string(),
        );
    }

    crate::sync::staging::RollbackSnapshot::restore_pending(game_dir)
        .map_err(|error| format!("Failed to restore previous update files: {}", error))?;

    let stage_dir = game_dir.join(".update_stage");
    if stage_dir.exists() {
        std::fs::remove_dir_all(&stage_dir)
            .map_err(|error| format!("Failed to clean interrupted update staging: {}", error))?;
    }

    if let Some(previous) = pending.previous.as_ref() {
        restore_previous_metadata(app_handle, instance_id, previous)?;
    } else {
        crate::commands::instances::update_installation_status(
            app_handle,
            instance_id,
            "installed",
        )?;
    }

    clear_pending(game_dir)?;
    Ok(UpdateRecoveryOutcome::Restored)
}

pub fn mark_recovery_interrupted(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
) -> Result<(), String> {
    let mut conn = crate::utils::db::get_vesta_conn()
        .map_err(|error| format!("Failed to get database connection: {}", error))?;
    use crate::schema::instance::dsl as instances;
    use diesel::prelude::*;

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    diesel::update(instances::instance.filter(instances::id.eq(instance_id)))
        .set((
            instances::last_operation.eq(Some("update".to_string())),
            instances::installation_status.eq(Some("interrupted".to_string())),
            instances::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(|error| format!("Failed to persist interrupted update recovery: {}", error))?;

    let interrupted = crate::commands::instances::get_instance(instance_id)?;
    let _ = app_handle.emit("core://instance-updated", interrupted);
    Ok(())
}

pub(crate) fn publish_recovery_required_notification(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    error: &str,
) {
    let Some(manager) =
        app_handle.try_state::<crate::notifications::manager::NotificationManager>()
    else {
        return;
    };
    let instance_name = crate::commands::instances::get_instance(instance_id)
        .map(|instance| instance.name)
        .unwrap_or_else(|_| format!("Instance {}", instance_id));
    let actions = vec![crate::notifications::models::NotificationAction {
        action_id: "resume_instance_operation".to_string(),
        label: "Resume recovery".to_string(),
        action_type: "primary".to_string(),
        payload: None,
    }];
    let _ = manager.create(crate::notifications::models::CreateNotificationInput {
        client_key: Some(format!("interrupted_instance_{}", instance_id)),
        title: Some("Update Recovery Required".to_string()),
        description: Some(format!(
            "The previous version of '{}' could not be fully restored: {}",
            instance_name, error
        )),
        severity: Some("error".to_string()),
        notification_type: Some(crate::notifications::models::NotificationType::Patient),
        dismissible: Some(true),
        persist: Some(true),
        silent: Some(false),
        actions: serde_json::to_string(&actions).ok(),
        progress: None,
        current_step: None,
        total_steps: None,
        metadata: None,
        show_on_completion: None,
    });
}

pub fn publish_recovery_complete_notification(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    committed: bool,
) {
    let Some(manager) =
        app_handle.try_state::<crate::notifications::manager::NotificationManager>()
    else {
        return;
    };
    let instance_name = crate::commands::instances::get_instance(instance_id)
        .map(|instance| instance.name)
        .unwrap_or_else(|_| format!("Instance {}", instance_id));
    let (title, description, severity) = if committed {
        (
            "Modpack Update Completed",
            format!(
                "The completed update for '{}' was finalized successfully.",
                instance_name
            ),
            "success",
        )
    } else {
        (
            "Previous Version Restored",
            format!(
                "The failed update for '{}' was rolled back. The instance is ready to play.",
                instance_name
            ),
            "error",
        )
    };
    let _ = manager.create(crate::notifications::models::CreateNotificationInput {
        client_key: Some(format!("interrupted_instance_{}", instance_id)),
        title: Some(title.to_string()),
        description: Some(description),
        severity: Some(severity.to_string()),
        notification_type: Some(crate::notifications::models::NotificationType::Patient),
        dismissible: Some(true),
        persist: Some(true),
        silent: Some(false),
        actions: None,
        progress: None,
        current_step: None,
        total_steps: None,
        metadata: None,
        show_on_completion: None,
    });
}

pub fn has_pending_recovery(game_dir: &Path) -> bool {
    pending_path(game_dir).exists()
        || crate::sync::staging::RollbackSnapshot::pending_exists(game_dir)
}

pub fn clear_pending(game_dir: &Path) -> Result<(), String> {
    match std::fs::remove_file(pending_path(game_dir)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
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
) -> Result<FinishedUpdate, String> {
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

    let runtime_fields =
        crate::utils::instance_runtime::InstanceRuntimeFields::from_manifest(new_manifest);
    let mut updated = instance.clone();
    updated.minecraft_version = runtime_fields.minecraft_version.clone();
    updated.modloader = runtime_fields.modloader.clone();
    updated.modloader_version = runtime_fields.modloader_version.clone();
    updated.modpack_version_id = Some(new_version_id.to_string());

    if runtime_changed {
        ctx.update_description(
            "Reinstalling game runtime for new Minecraft version...".to_string(),
        );
        let mut install_task = InstallInstanceTask::new(updated.clone());
        install_task.set_update_notification_title(false);
        install_task.set_manage_instance_lifecycle(false);
        install_task.run(ctx.clone()).await?;
    }

    crate::utils::java::ensure_java_for_instance(app_handle, &updated, None, None)
        .await
        .map_err(|error| format!("Java setup failed after modpack update: {}", error))?;

    let mut conn = crate::utils::db::get_vesta_conn().map_err(|error| error.to_string())?;
    use crate::schema::instance::dsl as instances;
    use diesel::prelude::*;

    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        diesel::update(instances::instance.filter(instances::id.eq(instance.id)))
            .set((
                instances::minecraft_version.eq(&runtime_fields.minecraft_version),
                instances::modloader.eq(&runtime_fields.modloader),
                instances::modloader_version.eq(&runtime_fields.modloader_version),
                instances::modpack_version_id.eq(Some(new_version_id.to_string())),
                instances::installation_status.eq(Some("installed".to_string())),
            ))
            .execute(conn)?;
        instances::instance
            .find(instance.id)
            .first::<crate::models::instance::Instance>(conn)
    })
    .map_err(|error| format!("Failed to finalize updated instance metadata: {}", error))?;

    let processed = crate::commands::instances::get_instance(instance.id)
        .map_err(|error| format!("Failed to fetch updated instance for emit: {}", error))?;

    log::info!(
        "[modpack-update] Update complete: {} → {} (MC {} {})",
        instance.modpack_version_id.as_deref().unwrap_or("?"),
        new_version_id,
        runtime_fields.minecraft_version,
        runtime_fields.modloader.as_deref().unwrap_or("vanilla"),
    );

    Ok(FinishedUpdate {
        processed,
        manifest,
    })
}

pub struct StatusGuard {
    app_handle: tauri::AppHandle,
    instance_id: i32,
    game_dir: PathBuf,
    completed: bool,
}

impl StatusGuard {
    pub fn new(app_handle: tauri::AppHandle, instance_id: i32, game_dir: PathBuf) -> Self {
        Self {
            app_handle,
            instance_id,
            game_dir,
            completed: false,
        }
    }

    pub fn mark_success(&mut self) {
        self.completed = true;
    }

    pub fn recover_failure(&mut self) -> Result<UpdateRecoveryOutcome, String> {
        self.completed = true;
        match recover_previous_instance(&self.app_handle, self.instance_id, &self.game_dir) {
            Ok(restored) => Ok(restored),
            Err(error) => {
                if let Err(status_error) =
                    mark_recovery_interrupted(&self.app_handle, self.instance_id)
                {
                    log::error!(
                        "[modpack-update] Failed to mark instance {} as interrupted: {}",
                        self.instance_id,
                        status_error
                    );
                }
                publish_recovery_required_notification(&self.app_handle, self.instance_id, &error);
                Err(error)
            }
        }
    }
}

impl Drop for StatusGuard {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        if let Err(error) = self.recover_failure() {
            log::error!(
                "[modpack-update] Automatic recovery failed for instance {}: {}",
                self.instance_id,
                error
            );
        }
    }
}

fn read_pending(game_dir: &Path) -> Result<Option<PendingUpdate>, String> {
    let path = pending_path(game_dir);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read pending update {:?}: {}", path, error))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| format!("Invalid pending update {:?}: {}", path, error))
}

fn write_pending(
    game_dir: &Path,
    version_id: &str,
    previous: Option<PreviousInstanceMetadata>,
) -> Result<(), String> {
    let vesta_dir = game_dir.join(".vesta");
    std::fs::create_dir_all(&vesta_dir).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(&PendingUpdate {
        version_id: version_id.to_string(),
        previous,
    })
    .map_err(|error| error.to_string())?;
    let path = pending_path(game_dir);
    let temporary = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&json).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    std::fs::rename(&temporary, &path).map_err(|error| error.to_string())
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

        write_pending(temp.path(), "new-version", None).expect("persist pending update");
        assert_eq!(
            read_pending(temp.path())
                .unwrap()
                .map(|pending| pending.version_id)
                .as_deref(),
            Some("new-version")
        );

        clear_pending(temp.path()).expect("clear pending update");
        assert!(read_pending(temp.path()).unwrap().is_none());
    }

    #[test]
    fn pending_update_persists_previous_runtime_metadata() {
        let temp = tempfile::tempdir().expect("temporary game directory");
        let previous = crate::models::instance::Instance {
            minecraft_version: "1.20.1".to_string(),
            modloader: Some("fabric".to_string()),
            modloader_version: Some("0.15.11".to_string()),
            modpack_version_id: Some("old-version".to_string()),
            ..Default::default()
        };

        write_pending(
            temp.path(),
            "new-version",
            Some(PreviousInstanceMetadata::from(&previous)),
        )
        .expect("persist pending update");

        let pending = read_pending(temp.path())
            .expect("read pending update")
            .expect("pending update");
        assert_eq!(pending.version_id, "new-version");
        assert_eq!(
            pending.previous,
            Some(PreviousInstanceMetadata {
                minecraft_version: "1.20.1".to_string(),
                modloader: Some("fabric".to_string()),
                modloader_version: Some("0.15.11".to_string()),
                modpack_version_id: Some("old-version".to_string()),
            })
        );
    }
}
