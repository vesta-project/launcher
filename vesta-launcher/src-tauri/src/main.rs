// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod auth;
mod commands;
mod metadata_cache;
pub mod models;
mod notifications;
pub mod schema; // Diesel schema definitions
mod setup;
mod tasks;
pub mod utils;

use utils::config::{get_config, set_config, update_config_field, update_config_fields};
use utils::windows::launch_new_window;

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

fn main() {
    std::panic::set_hook(Box::new(|e| {
        println!("Vesta Launcher closed unexpectedly: {e:?}");
    }));

    // Configure logging with 30-day retention in %appdata%/.VestaLauncher/logs/
    let log_plugin = tauri_plugin_log::Builder::new()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
        ])
        .level(log::LevelFilter::Info)
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .max_file_size(10_000_000) // 10MB per file
        .build();

    tauri::Builder::default()
        .setup(setup::init)
        .plugin(log_plugin)
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            launch_new_window,
            get_config,
            set_config,
            update_config_field,
            update_config_fields,
            commands::app::open_app_config_dir,
            commands::app::open_logs_folder,
            commands::app::close_all_windows_and_reset,
            commands::app::get_default_instance_dir,
            commands::app::os_type,
            utils::db::get_db_status,
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
            commands::notifications::create_notification,
            commands::notifications::update_notification_progress,
            commands::notifications::list_notifications,
            commands::notifications::mark_notification_read,
            commands::notifications::delete_notification,
            commands::notifications::invoke_notification_action,
            commands::notifications::cleanup_notifications,
            commands::notifications::clear_immediate_notifications,
            commands::notifications::clear_all_dismissible_notifications,
            commands::tasks::set_worker_limit,
            commands::tasks::cancel_task,
            commands::instances::install_instance,
            commands::instances::list_instances,
            commands::instances::create_instance,
            commands::instances::update_instance,
            commands::instances::delete_instance,
            commands::instances::get_instance,
            commands::instances::get_instance_by_slug,
            commands::instances::launch_instance,
            commands::instances::kill_instance,
            commands::instances::get_running_instances,
            commands::instances::is_instance_running,
            commands::instances::get_minecraft_versions,
            commands::instances::regenerate_piston_manifest,
            commands::instances::read_instance_log,
            commands::onboarding::get_onboarding_requirements,
            commands::onboarding::detect_java,
            commands::onboarding::verify_java_path,
            commands::onboarding::set_global_java_path,
            commands::onboarding::get_global_java_paths,
            commands::onboarding::complete_onboarding,
            commands::onboarding::reset_onboarding,
            commands::onboarding::set_setup_step,
            commands::onboarding::download_managed_java
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
