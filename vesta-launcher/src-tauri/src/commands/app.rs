use crate::utils::db_manager::{get_app_config_dir, get_data_db};
use tauri::Manager;

#[tauri::command]
pub fn open_app_config_dir() -> Result<(), String> {
    let config_path = get_app_config_dir().map_err(|e| e.to_string())?;

    // Determine directory to open: if the path is a file, open its parent directory
    let dir_to_open = if config_path.is_dir() {
        config_path.clone()
    } else if config_path.is_file() {
        config_path
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("No parent directory for path: {:?}", config_path))?
    } else {
        // Path does not exist
        return Err(format!("Path does not exist: {:?}", config_path));
    };

    // Use open crate to open directory in file explorer
    open::that(&dir_to_open)
        .map_err(|e| format!("Failed to open directory: {} (path: {:?})", e, dir_to_open))?;
    Ok(())
}

#[tauri::command]
pub fn open_logs_folder(instance_id: Option<String>) -> Result<(), String> {
    let logs_path = if let Some(id) = instance_id {
        // Fetch instance from database to get its game directory
        let db = get_data_db().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let mut stmt = conn
            .prepare(
                "SELECT game_directory FROM instance WHERE name = ?1 OR id = (SELECT id FROM instance WHERE LOWER(REPLACE(REPLACE(REPLACE(name, ' ', '-'), '_', '-'), '\"', '')) = LOWER(REPLACE(REPLACE(REPLACE(?1, ' ', '-'), '_', '-'), '\"', '')))",
            )
            .map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let game_dir: Option<String> = stmt
            .query_row([id.as_str()], |row| row.get(0))
            .ok();

        if let Some(game_dir) = game_dir {
            std::path::PathBuf::from(game_dir).join("logs")
        } else {
            return Err(format!("Instance not found: {}", id));
        }
    } else {
        get_app_config_dir()
            .map_err(|e| e.to_string())?
            .join("logs")
    };

    // Create logs directory if it doesn't exist
    std::fs::create_dir_all(&logs_path)
        .map_err(|e| format!("Failed to create logs directory: {}", e))?;

    // Open logs directory in file explorer
    open::that(&logs_path)
        .map_err(|e| format!("Failed to open logs directory: {} (path: {:?})", e, logs_path))?;
    Ok(())
}

#[tauri::command]
pub fn close_all_windows_and_reset(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Get all webview windows
    let windows: Vec<_> = app_handle
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label != "main")
        .collect();

    // Close all windows except main
    for (_, window) in windows {
        let _ = window.close();
    }

    // Navigate main window to init page
    if let Some(main_window) = app_handle.get_webview_window("main") {
        let _ = main_window.eval("window.location.href = '/'");
    }

    Ok(())
}
