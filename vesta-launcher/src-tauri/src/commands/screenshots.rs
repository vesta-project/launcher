use crate::utils::db::get_vesta_conn;
use crate::schema::instance::dsl::*;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub name: String,
    pub path: String,
    pub created_at: u64,
    pub size: u64,
}

#[tauri::command]
pub fn get_screenshots(instance_id_slug: String) -> Result<Vec<Screenshot>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    let instances_list = instance
        .select((name, game_directory))
        .load::<(String, Option<String>)>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    let found_dir = instances_list.into_iter().find_map(|(_name, _gd)| {
        let i_slug = crate::utils::sanitize::sanitize_instance_name(&_name);
        if i_slug == instance_id_slug {
            _gd
        } else {
            None
        }
    });

    let gd = found_dir.ok_or_else(|| format!("Instance not found: {}", instance_id_slug))?;
    let screenshots_dir = Path::new(&gd).join("screenshots");

    if !screenshots_dir.exists() {
        return Ok(Vec::new());
    }

    let mut screenshots = Vec::new();
    if let Ok(entries) = fs::read_dir(screenshots_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                if extension == "png" || extension == "jpg" || extension == "jpeg" {
                    let metadata = entry.metadata().map_err(|e| e.to_string())?;
                    let created = metadata.created().or_else(|_| metadata.modified())
                        .unwrap_or_else(|_| std::time::SystemTime::now());
                    
                    let created_ts = created.duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    screenshots.push(Screenshot {
                        name: path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown").to_string(),
                        path: path.to_string_lossy().replace("\\", "/"),
                        created_at: created_ts,
                        size: metadata.len(),
                    });
                }
            }
        }
    }

    // Sort by date descending by default
    screenshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(screenshots)
}

#[tauri::command]
pub fn delete_screenshot(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| format!("Failed to delete file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_screenshot_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("File does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg("/select,")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = p.parent() {
            open::that(parent).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_screenshot_to_clipboard(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }

    // Read image using image crate (already in dependencies)
    let img = image::open(&p).map_err(|e| format!("Failed to open image: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    
    // Create tauri::image::Image from raw bytes
    let raw_bytes = rgba.as_raw();
    let tauri_image = tauri::image::Image::new(raw_bytes, w, h);

    // Use clipboard plugin to write image
    app.clipboard().write_image(&tauri_image).map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

    Ok(())
}
