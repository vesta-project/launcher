use crate::utils::config::{get_app_config, update_app_config};
use crate::utils::db::get_vesta_conn;
use crate::utils::db_manager::get_app_config_dir;
use diesel::prelude::*;
use tauri::Manager;

pub fn cleanup_temporary_accounts() {
    cleanup_guest_session();
    cleanup_demo_account();
}

pub fn submit_profile_sync(app: &tauri::App) {
    if app
        .try_state::<crate::tasks::manager::TaskManager>()
        .is_none()
    {
        log::error!("[startup] TaskManager unavailable for account profile sync");
        return;
    }

    log::info!("[startup] Submitting SyncAccountProfilesTask...");
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let task_manager = app_handle.state::<crate::tasks::manager::TaskManager>();
        if let Err(error) = task_manager
            .submit(Box::new(
                crate::tasks::sync_profiles::SyncAccountProfilesTask::new(),
            ))
            .await
        {
            log::warn!("Failed to submit startup account profile sync: {}", error);
        }
    });
}

fn cleanup_guest_session() {
    let Ok(config_dir) = get_app_config_dir() else {
        return;
    };
    let marker_path = config_dir.join(".guest_mode");
    if !marker_path.exists() {
        return;
    }

    log::info!("[startup] Cleaning up stale guest session...");
    if let Err(error) = std::fs::remove_file(marker_path) {
        log::warn!("Failed to remove stale guest marker: {}", error);
    }

    if let Ok(mut conn) = get_vesta_conn() {
        use crate::schema::account::dsl::*;
        if let Err(error) =
            diesel::delete(account.filter(uuid.eq(crate::auth::GUEST_UUID))).execute(&mut conn)
        {
            log::warn!("Failed to remove stale guest account: {}", error);
        }
    }

    if let Ok(mut config) = get_app_config() {
        if config.active_account_uuid == Some(crate::auth::GUEST_UUID.to_string()) {
            config.active_account_uuid = None;
        }
        config.setup_completed = false;
        config.setup_step = 0;
        if let Err(error) = update_app_config(&config) {
            log::warn!("Failed to reset config after guest cleanup: {}", error);
        }
    }
}

fn cleanup_demo_account() {
    let Ok(mut conn) = get_vesta_conn() else {
        return;
    };

    use crate::schema::account::dsl::*;
    log::info!("[startup] Cleaning up temporary demo account if present...");
    if let Err(error) =
        diesel::delete(account.filter(account_type.eq(crate::auth::ACCOUNT_TYPE_DEMO)))
            .execute(&mut conn)
    {
        log::warn!("Failed to remove temporary demo account: {}", error);
    }

    if let Ok(mut config) = get_app_config() {
        if config.active_account_uuid == Some(crate::auth::DEMO_UUID.to_string()) {
            config.active_account_uuid = None;
            if let Err(error) = update_app_config(&config) {
                log::warn!("Failed to clear active demo account: {}", error);
            }
        }
    }
}
