// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod utils;
pub mod models;
pub mod auth;
mod structs;
mod tasks;
mod notifications;
mod commands;
mod setup;

use utils::windows::launch_new_window;
use utils::config::{get_config, set_config, update_config_field};

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

fn main() {
    std::panic::set_hook(Box::new(|e| {
        println!("Vesta Launcher closed unexpectedly: {e:?}");
    }));

    tauri::Builder::default()
        .setup(setup::init)
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::debug::test_command,
            commands::debug::debug_check_tables,
            commands::debug::debug_rerun_migrations,
            launch_new_window,
            get_config,
            set_config,
            update_config_field,
            commands::app::open_app_config_dir,
            commands::app::close_all_windows_and_reset,
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
            auth::get_player_head_path,
            auth::preload_account_heads,
            notifications::commands::create_notification,
            notifications::commands::update_notification_progress,
            notifications::commands::list_notifications,
            notifications::commands::mark_notification_read,
            notifications::commands::delete_notification,
            notifications::commands::invoke_notification_action,
            notifications::commands::cleanup_notifications,
            notifications::commands::clear_immediate_notifications,
            notifications::commands::test_notification_info,
            notifications::commands::test_notification_success,
            notifications::commands::test_notification_warning,
            notifications::commands::test_notification_error,
            notifications::commands::test_notification_pulsing,
            notifications::commands::test_notification_progress,
            notifications::commands::test_notification_multiple,
            tasks::commands::submit_test_task,
            tasks::commands::set_worker_limit,
            tasks::commands::cancel_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
