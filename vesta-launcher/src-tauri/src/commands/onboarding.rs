use crate::models::java::GlobalJavaPath;
use crate::schema::config::global_java_paths::dsl::{
    global_java_paths, is_managed as is_managed_col, major_version, path as path_col,
};
use crate::tasks::installers::java::DownloadJavaTask;
use crate::tasks::manager::TaskManager;
use crate::utils::config::{update_config_field, update_config_fields};
use crate::utils::db::get_config_conn;
use diesel::prelude::*;
use piston_lib::game::installer::core::jre_manager;
use serde_json::json;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize)]
pub struct JavaRequirement {
    pub major_version: u32,
    pub recommended_name: String,
    pub is_required_for_latest: bool,
}

fn java_requirement_name(version: u32) -> String {
    match version {
        8 => "Java 8 (Legacy)".to_string(),
        17 => "Java 17".to_string(),
        21 => "Java 21".to_string(),
        25 => "Java 25".to_string(),
        _ => format!("Java {}", version),
    }
}

#[tauri::command]
pub async fn get_required_java_versions(
    app_handle: AppHandle,
) -> Result<Vec<JavaRequirement>, String> {
    let metadata = crate::utils::java::load_manifest_for_java_resolution(&app_handle).await?;

    let mut requirements = Vec::new();

    if let Some(meta) = metadata {
        let latest_required_major =
            crate::utils::java::resolve_required_java_from_manifest(&meta, &meta.latest.release)
                .or_else(|_| {
                    crate::utils::java::resolve_required_java_from_manifest(
                        &meta,
                        &meta.latest.snapshot,
                    )
                })
                .ok()
                .or_else(|| {
                    meta.required_java_major_versions
                        .first()
                        .copied()
                        .map(crate::utils::java::preferred_java_major)
                });

        let latest_required_major = match latest_required_major {
            Some(v) => v,
            None => {
                log::warn!("Manifest does not contain Java runtime majors; forcing refresh");
                let _ = crate::utils::java::queue_manifest_generation(&app_handle, true).await;
                return Err("MANIFEST_NOT_READY".to_string());
            }
        };

        let mut versions: Vec<u32> = meta
            .required_java_major_versions
            .iter()
            .copied()
            .map(crate::utils::java::preferred_java_major)
            .collect();
        versions.sort_unstable_by(|a, b| b.cmp(a));
        versions.dedup();

        if versions.is_empty() {
            let set: std::collections::BTreeSet<u32> = meta
                .java_major_version_by_game_version
                .values()
                .copied()
                .map(crate::utils::java::preferred_java_major)
                .collect();
            versions = set.into_iter().rev().collect();
        }

        if versions.is_empty() {
            let _ = crate::utils::java::queue_manifest_generation(&app_handle, true).await;
            return Err("MANIFEST_NOT_READY".to_string());
        }

        for version in versions {
            requirements.push(JavaRequirement {
                major_version: version,
                recommended_name: java_requirement_name(version),
                is_required_for_latest: version == latest_required_major,
            });
        }
    } else {
        return Err("MANIFEST_NOT_READY".to_string());
    }

    Ok(requirements)
}

#[tauri::command]
pub async fn detect_java() -> Result<Vec<jre_manager::DetectedJava>, String> {
    tokio::task::spawn_blocking(move || Ok(crate::utils::java::scan_system_javas_filtered()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_managed_javas() -> Result<Vec<jre_manager::DetectedJava>, String> {
    tokio::task::spawn_blocking(move || Ok(crate::utils::java::get_managed_javas()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn verify_java_path(path_str: String) -> Result<jre_manager::DetectedJava, String> {
    let path_buf = std::path::PathBuf::from(path_str);
    tokio::task::spawn_blocking(move || {
        jre_manager::verify_java(&path_buf).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn select_java_file(app_handle: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    app_handle
        .dialog()
        .file()
        .set_title("Select Java Executable")
        .pick_file(move |res| {
            let _ = tx.send(res.map(|p| p.to_string()));
        });

    match rx.await {
        Ok(res) => Ok(res),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_global_java_path(version: i32, path_str: String, managed: bool) -> Result<(), String> {
    let mut conn = get_config_conn().map_err(|e| e.to_string())?;

    let new_entry = GlobalJavaPath {
        major_version: version,
        path: path_str,
        is_managed: managed,
    };

    diesel::insert_into(global_java_paths)
        .values(&new_entry)
        .on_conflict(major_version)
        .do_update()
        .set(&new_entry)
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_global_java_paths() -> Result<Vec<GlobalJavaPath>, String> {
    let mut conn = get_config_conn().map_err(|e| e.to_string())?;
    global_java_paths
        .load::<GlobalJavaPath>(&mut conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete_onboarding(app_handle: AppHandle) -> Result<(), String> {
    let mut updates = HashMap::new();
    updates.insert("setup_completed".to_string(), json!(true));
    updates.insert("setup_step".to_string(), json!(6));

    update_config_fields(app_handle, updates)
}

#[tauri::command]
pub async fn reset_onboarding(app_handle: AppHandle) -> Result<(), String> {
    let mut updates = HashMap::new();
    updates.insert("setup_completed".to_string(), json!(false));
    updates.insert("setup_step".to_string(), json!(0));
    updates.insert("tutorial_completed".to_string(), json!(false));

    update_config_fields(app_handle, updates)
}

#[tauri::command]
pub async fn set_setup_step(step: i32, app_handle: AppHandle) -> Result<(), String> {
    update_config_field(app_handle, "setup_step".to_string(), json!(step))
}

#[tauri::command]
pub async fn download_managed_java(app_handle: AppHandle, version: u32) -> Result<(), String> {
    // Check if already managed and available to avoid task overhead and notification flashing
    if let Ok(managed_dir) = crate::utils::java::get_managed_jre_dir() {
        let install_dir = managed_dir.join(format!("zulu-{}", version));
        if let Some(java_path) =
            piston_lib::game::installer::core::jre_manager::find_java_executable(&install_dir)
        {
            log::info!(
                "Managed Java {} already exists at {:?}, skipping download task.",
                version,
                java_path
            );

            let mut conn = get_config_conn().map_err(|e| e.to_string())?;
            let new_entry = GlobalJavaPath {
                major_version: version as i32,
                path: java_path.to_string_lossy().to_string(),
                is_managed: true,
            };

            diesel::insert_into(global_java_paths)
                .values(&new_entry)
                .on_conflict(major_version)
                .do_update()
                .set((
                    path_col.eq(&new_entry.path),
                    is_managed_col.eq(new_entry.is_managed),
                ))
                .execute(&mut conn)
                .map_err(|e| e.to_string())?;

            return Ok(());
        }
    }

    let task_manager = app_handle.state::<TaskManager>();
    let task = DownloadJavaTask {
        major_version: version,
    };
    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| e.to_string())
}
