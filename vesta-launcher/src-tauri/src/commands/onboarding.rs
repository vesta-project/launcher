use crate::metadata_cache::MetadataCache;
use crate::models::GlobalJavaPath;
use crate::schema::global_java_paths::dsl::{global_java_paths, major_version};
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

#[tauri::command]
pub async fn get_required_java_versions(
    app_handle: AppHandle,
) -> Result<Vec<JavaRequirement>, String> {
    let cache = app_handle.state::<MetadataCache>();
    let metadata = cache.get();

    let mut requirements = Vec::new();

    if let Some(meta) = metadata {
        log::info!(
            "Metadata cache accessed, versions found: {}, required_javas: {:?}",
            meta.game_versions.len(),
            meta.required_java_major_versions
        );

        if meta.required_java_major_versions.is_empty() {
            log::warn!(
                "Metadata cache present but required_java_major_versions is empty. Using defaults."
            );
            let default_versions = vec![21, 17, 8];
            for version in default_versions {
                requirements.push(JavaRequirement {
                    major_version: version,
                    recommended_name: match version {
                        21 => "Java 21 (Modern)".to_string(),
                        17 => "Java 17 (1.18 - 1.20)".to_string(),
                        8 => "Java 8 (Legacy)".to_string(),
                        _ => format!("Java {}", version),
                    },
                    is_required_for_latest: version == 21,
                });
            }
            return Ok(requirements);
        }

        for version in meta.required_java_major_versions {
            let is_latest = version == 25 || version == 21; // Simple heuristic for now

            let name = match version {
                25 => "Java 25".to_string(),
                21 => "Java 21".to_string(),
                17 => "Java 17 (1.18 - 1.20)".to_string(),
                8 => "Java 8 (Legacy)".to_string(),
                _ => format!("Java {}", version),
            };

            requirements.push(JavaRequirement {
                major_version: version,
                recommended_name: name,
                is_required_for_latest: is_latest,
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
pub async fn pick_java_path(app_handle: AppHandle) -> Result<Option<String>, String> {
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
                .set(&new_entry)
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
