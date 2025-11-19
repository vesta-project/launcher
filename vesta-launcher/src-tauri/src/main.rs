// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod utils;
pub mod models;
pub mod auth;
mod structs;
mod tasks;
mod notifications;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use winver::WindowsVersion;
use utils::windows::launch_new_window;
use utils::config::{initialize_config_db, get_config, set_config, update_config_field};
use utils::data::initialize_data_db;
use utils::db_manager::get_app_config_dir;
// use utils::file_drop::{create_file_drop_overlay, position_overlay, show_overlay, hide_overlay, set_overlay_visual_state};

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

fn main() {
    std::panic::set_hook(Box::new(|e| {
        println!("Vesta Launcher closed unexpectedly: {e:?}");
    }));

    tauri::Builder::default()
        .setup(|app| {
            // Initialize config database (app_config.db) with migrations
            if let Err(e) = initialize_config_db() {
                eprintln!("Failed to initialize config database: {}", e);
                // You might want to show an error dialog here
            }

            // Initialize data database (vesta.db) with migrations
            if let Err(e) = initialize_data_db() {
                eprintln!("Failed to initialize data database: {}", e);
                // You might want to show an error dialog here
            }

            let win_builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
                .title("Vesta Launcher")
                .inner_size(1200_f64, 700_f64)
                .min_inner_size(520_f64, 465_f64)
                .disable_drag_drop_handler()  // Disable so overlay can capture drag events
                .transparent(true)
                .decorations(false);

            #[cfg(target_os = "windows")]
            let version = WindowsVersion::detect().expect("Failed to detect windows version");

            #[cfg(target_os = "windows")]
            // If on windows 11
            let win_builder = if version.major == 10 && version.build >= 22000 {
                win_builder.effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::MicaDark)
                        .build(),
                )
            }
            else if version.major == 6 && version.minor == 1 {
                // On windows 7
                win_builder.effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::Blur)
                        .build(),
                )
            }
            else {
                // TODO: Eventually windows 10
                win_builder.effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::Acrylic)
                        .build(),
                )
            };

            #[cfg(target_os = "macos")]
            let win_builder = win_builder.effects(
                tauri::window::EffectsBuilder::new()
                    .effect(tauri::window::Effect::Vibrancy)
                    .build()
            );

            win_builder.build()?;
            
            // File drop overlay disabled for now
            // let app_handle = app.handle().clone();
            // if let Err(e) = tauri::async_runtime::block_on(create_file_drop_overlay(app_handle)) {
            //     eprintln!("Failed to create file drop overlay: {}", e);
            // }
            
            Ok(())
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            test_command,
            debug_check_tables,
            debug_rerun_migrations,
            launch_new_window,
            get_config,
            set_config,
            update_config_field,
            open_app_config_dir,
            // create_file_drop_overlay,
            // position_overlay,
            // show_overlay,
            // hide_overlay,
            // set_overlay_visual_state,
            auth::start_login,
            auth::cancel_login,
            auth::get_accounts,
            auth::get_active_account,
            auth::set_active_account,
            auth::remove_account,
            notifications::create_notification,
            notifications::update_notification_progress,
            notifications::list_notifications,
            notifications::mark_notification_read,
            notifications::delete_notification,
            notifications::cleanup_notifications,
            notifications::test_notification_info,
            notifications::test_notification_success,
            notifications::test_notification_warning,
            notifications::test_notification_error,
            notifications::test_notification_pulsing,
            notifications::test_notification_progress,
            notifications::test_notification_multiple
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn open_app_config_dir() -> Result<(), String> {
    let config_path = get_app_config_dir().map_err(|e| e.to_string())?;

    // Determine directory to open: if the path is a file, open its parent directory
    let dir_to_open = if config_path.is_dir() {
        config_path.clone()
    } else if config_path.is_file() {
        config_path.parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("No parent directory for path: {:?}", config_path))?
    } else {
        // Path does not exist
        return Err(format!("Path does not exist: {:?}", config_path));
    };

    // Use open crate to open directory in file explorer
    open::that(&dir_to_open).map_err(|e| format!("Failed to open directory: {} (path: {:?})", e, dir_to_open))?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct TestPayload {
    title: String,
    message: String,
}

#[tauri::command]
fn test_command(app_handle: tauri::AppHandle) {
    app_handle.emit("core://crash", TestPayload { title: "Test".to_string(), message: "Test message".to_string()}).unwrap();
    println!("Test command invoked");
}

#[tauri::command]
fn debug_check_tables() -> Result<Vec<String>, String> {
    use utils::db_manager::{get_config_db, get_data_db};
    
    let config_db = get_config_db().map_err(|e| e.to_string())?;
    let data_db = get_data_db().map_err(|e| e.to_string())?;
    
    let config_conn = config_db.get_connection();
    let data_conn = data_db.get_connection();
    
    let mut stmt = config_conn.prepare("SELECT 'CONFIG: ' || name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| e.to_string())?;
    
    let mut tables: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    
    let mut stmt2 = data_conn.prepare("SELECT 'DATA: ' || name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| e.to_string())?;
    
    let data_tables: Vec<String> = stmt2.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    
    tables.extend(data_tables);
    
    println!("Tables in databases:\n{}", tables.join("\n"));
    Ok(tables)
}

#[tauri::command]
fn debug_rerun_migrations() -> Result<String, String> {
    use utils::config::initialize_config_db;
    use utils::data::initialize_data_db;
    
    let mut results = Vec::new();
    
    match initialize_config_db() {
        Ok(_) => results.push("✓ Config migrations completed".to_string()),
        Err(e) => results.push(format!("✗ Config migration failed: {}", e)),
    }
    
    match initialize_data_db() {
        Ok(_) => results.push("✓ Data migrations completed".to_string()),
        Err(e) => results.push(format!("✗ Data migration failed: {}", e)),
    }
    
    let result = results.join("\n");
    println!("{}", result);
    Ok(result)
}
