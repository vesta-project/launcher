use crate::models::instance::Instance;
use crate::tasks::manager::TaskContext;
use crate::worlds::archive::{self, InstalledWorld};
use crate::worlds::install_selection;
use crate::worlds::manifest::WorldSource;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

pub async fn install_world_archive(
    app_handle: tauri::AppHandle,
    instance: Instance,
    archive_path: PathBuf,
    source: Option<WorldSource>,
    project: serde_json::Value,
    ctx: TaskContext,
) -> Result<Vec<InstalledWorld>, String> {
    let saves = crate::worlds::instance_game_directory(&instance)?.join("saves");
    ensure_saves_directory(&saves)?;
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
                    30 + ((written
                        .saturating_mul(65)
                        .checked_div(total)
                        .unwrap_or(0)
                        .min(65)) as i32)
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

fn ensure_saves_directory(saves: &Path) -> Result<(), String> {
    std::fs::create_dir_all(saves).map_err(|error| {
        format!(
            "Failed to access the world saves directory {}: {error}",
            saves.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_directory_errors_include_the_affected_path() {
        let temp = tempfile::TempDir::new().unwrap();
        let saves = temp.path().join("saves");
        std::fs::write(&saves, b"not a directory").unwrap();

        let error = ensure_saves_directory(&saves).unwrap_err();

        assert!(error.contains("Failed to access the world saves directory"));
        assert!(error.contains(&saves.display().to_string()));
    }
}
