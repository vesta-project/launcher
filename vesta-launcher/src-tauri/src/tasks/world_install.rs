use crate::models::instance::Instance;
use crate::tasks::manager::TaskContext;
use crate::worlds::archive::{self, InstalledWorld};
use crate::worlds::install_selection;
use crate::worlds::manifest::WorldSource;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

pub async fn install_world_archive(
    app_handle: tauri::AppHandle,
    instance: Instance,
    archive_path: PathBuf,
    source: Option<WorldSource>,
    project: serde_json::Value,
    ctx: TaskContext,
) -> Result<Vec<InstalledWorld>, String> {
    if piston_lib::game::launcher::is_instance_running(&instance.slug())
        .await
        .map_err(|error| format!("Failed to check instance run state: {error}"))?
    {
        return Err("Worlds cannot be installed while the instance is running".to_string());
    }
    let saves = crate::worlds::instance_game_directory(&instance)?.join("saves");
    std::fs::create_dir_all(&saves).map_err(|error| error.to_string())?;
    let inspect_archive = archive_path.clone();
    let inspect_saves = saves.clone();
    let inspection = tauri::async_runtime::spawn_blocking(move || {
        archive::inspect_archive(&inspect_archive, &inspect_saves)
    })
    .await
    .map_err(|error| format!("World archive inspection failed: {error}"))??;
    if inspection.candidates.is_empty() {
        return Err("Archive does not contain a Java folder world".to_string());
    }

    ctx.update_full(
        20,
        "Choosing worlds to install…".to_string(),
        Some(1),
        Some(3),
    );
    let selected = if inspection.candidates.len() == 1 {
        vec![inspection.candidates[0].id.clone()]
    } else {
        install_selection::request_selection(
            &app_handle,
            project,
            inspection.candidates,
            ctx.cancel_rx.clone(),
        )
        .await?
    };
    if *ctx.cancel_rx.borrow() {
        return Err("World installation cancelled".to_string());
    }

    ctx.update_full(
        30,
        "Extracting selected worlds…".to_string(),
        Some(2),
        Some(3),
    );
    let install_archive = archive_path.clone();
    let install_saves = saves.clone();
    let progress_ctx = ctx.clone();
    let installed = tauri::async_runtime::spawn_blocking(move || {
        archive::install_archive(
            &install_archive,
            &install_saves,
            &selected,
            source,
            move |written, total| {
                if *progress_ctx.cancel_rx.borrow() {
                    return Err("World installation cancelled".to_string());
                }
                let percent = if total == 0 {
                    30
                } else {
                    30 + ((written.saturating_mul(65) / total).min(65) as i32)
                };
                progress_ctx.update_progress(percent, Some(2), Some(3));
                Ok(())
            },
        )
    })
    .await
    .map_err(|error| format!("World extraction task failed: {error}"))??;

    ctx.update_full(100, "Worlds installed".to_string(), Some(3), Some(3));
    if let Some(world_manager) = app_handle.try_state::<crate::worlds::WorldManager>() {
        world_manager.invalidate(instance.id);
    }
    let _ = app_handle.emit(
        "core://instance-worlds-changed",
        serde_json::json!({
            "instanceId": instance.id,
            "revision": chrono::Utc::now().timestamp_millis(),
            "reason": "archive-installed",
        }),
    );
    Ok(installed)
}
