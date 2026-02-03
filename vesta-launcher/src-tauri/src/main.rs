// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod auth;
mod commands;
mod metadata_cache;
pub mod models;
mod notifications;
pub mod resources;
pub mod schema; // Diesel schema definitions
mod setup;
mod tasks;
pub mod utils;

use utils::config::{get_config, set_config, update_config_field, update_config_fields};
use utils::windows::launch_window;
use tauri::Emitter;

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

fn main() {
    std::panic::set_hook(Box::new(|e| {
        println!("Vesta Launcher closed unexpectedly: {e:?}");
    }));

    // Early check for debug logging setting
    let mut log_level = log::LevelFilter::Info;
    if let Ok(config_dir) = utils::db_manager::get_app_config_dir() {
        // Try to init pool early to check setting. setup::init will safely re-init or handle it.
        let _ = utils::db::init_config_pool(config_dir);
        if let Ok(config) = utils::config::get_app_config() {
            if config.debug_logging {
                log_level = log::LevelFilter::Debug;
            }
        }
    }

    // Configure logging with 30-day retention in %appdata%/.VestaLauncher/logs/
    let log_plugin = tauri_plugin_log::Builder::new()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
        ])
        .level(log_level)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_macos_permissions::init())
        .invoke_handler(tauri::generate_handler![
            launch_window,
            get_config,
            set_config,
            update_config_field,
            update_config_fields,
            commands::app::open_app_config_dir,
            commands::app::open_logs_folder,
            commands::app::open_instance_folder,
            commands::app::restart_app,
            commands::app::exit_check,
            commands::app::exit_app,
            commands::app::close_all_windows_and_reset,
            commands::app::get_default_instance_dir,
            commands::app::os_type,
            commands::app::path_exists,
            utils::db::get_db_status,
            utils::file_drop::create_file_drop_overlay,
            utils::file_drop::position_overlay,
            utils::file_drop::show_overlay,
            utils::file_drop::hide_overlay,
            utils::file_drop::set_overlay_visual_state,
            utils::file_drop::reset_file_drop_sniffer,
            auth::start_login,
            auth::cancel_login,
            auth::get_accounts,
            auth::get_active_account,
            auth::set_active_account,
            auth::start_guest_session,
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
            commands::instances::get_instance_required_java,
            commands::instances::launch_instance,
            commands::instances::kill_instance,
            commands::instances::get_running_instances,
            commands::instances::is_instance_running,
            commands::instances::update_instance_modpack_version,
            commands::instances::get_minecraft_versions,
            commands::instances::regenerate_piston_manifest,
            commands::instances::read_instance_log,
            commands::instances::duplicate_instance,
            commands::instances::repair_instance,
            commands::instances::reset_instance,
            commands::instances::resume_instance_operation,
            commands::modpacks::get_modpack_info,
            commands::modpacks::get_modpack_info_from_url,
            commands::modpacks::get_system_memory_mb,
            commands::modpacks::get_hardware_info,
            commands::modpacks::install_modpack_from_zip,
            commands::modpacks::install_modpack_from_url,
            commands::modpacks::list_export_candidates,
            commands::modpacks::export_instance_to_modpack,
            commands::onboarding::get_required_java_versions,
            commands::onboarding::detect_java,
            commands::onboarding::get_managed_javas,
            commands::onboarding::pick_java_path,
            commands::onboarding::verify_java_path,
            commands::onboarding::set_global_java_path,
            commands::onboarding::get_global_java_paths,
            commands::onboarding::complete_onboarding,
            commands::onboarding::reset_onboarding,
            commands::onboarding::set_setup_step,
            commands::onboarding::download_managed_java,
            commands::resources::get_resource_categories,
            commands::resources::search_resources,
            commands::resources::get_resource_project,
            commands::resources::cache_resource_metadata,
            commands::resources::get_cached_resource_project,
            commands::resources::get_cached_resource_projects,
            commands::resources::get_resource_projects,
            commands::resources::get_resource_versions,
            commands::resources::find_peer_resource,
            commands::resources::install_resource,
            commands::resources::delete_resource,
            commands::resources::toggle_resource,
            commands::resources::sync_instance_resources,
            commands::resources::get_installed_resources,
            commands::resources::check_resource_updates,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("core://exit-requested", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
