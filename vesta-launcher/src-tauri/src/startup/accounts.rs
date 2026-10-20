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

pub fn validate_active_session(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        log::info!("[startup] Performing proactive session validation...");

        let active_account = match crate::auth::get_active_account() {
            Ok(Some(account)) => Some(account),
            Ok(None) => repair_missing_active_account(app_handle.clone()),
            Err(error) => {
                log::error!("Failed to get active account: {}", error);
                None
            }
        };

        if let Some(account) = active_account {
            if account.uuid != crate::auth::GUEST_UUID {
                match crate::auth::ensure_account_tokens_valid(app_handle, account.uuid).await {
                    Ok(_) => log::info!("[startup] Proactive session validation succeeded"),
                    Err(error) => {
                        log::warn!(
                            "[startup] Proactive session validation failed: {}",
                            error.message
                        )
                    }
                }
            }
        }
    });
}

fn repair_missing_active_account(
    app_handle: tauri::AppHandle,
) -> Option<crate::models::account::Account> {
    let Ok(config) = get_app_config() else {
        return None;
    };
    config.active_account_uuid.as_ref()?;

    log::warn!("[startup] Active account is missing from database; repairing...");
    crate::auth::repair_active_account(app_handle)
        .ok()
        .flatten()
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
    if let Err(error) = remove_guest_session() {
        log::warn!("Failed to clean up stale guest session: {}", error);
        return;
    }
    if let Ok(mut config) = get_app_config() {
        // A leftover marker after successful activation must not erase real setup progress.
        if config.active_account_uuid.as_deref() == Some(crate::auth::GUEST_UUID) {
            config.active_account_uuid = None;
            config.setup_completed = false;
            config.setup_step = 0;
        }
        if let Err(error) = update_app_config(&config) {
            log::warn!("Failed to reset config after guest cleanup: {}", error);
        }
    }
}

/// Shared by successful login, account switching, and stale startup cleanup.
/// Delete the account even if its marker is already absent; retain the marker on DB failure.
pub fn remove_guest_session() -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|error| error.to_string())?;
    let marker = get_app_config_dir()
        .map_err(|error| error.to_string())?
        .join(".guest_mode");
    remove_guest_account_and_marker(&mut conn, &marker)
}

fn remove_guest_account_and_marker(
    conn: &mut diesel::SqliteConnection,
    marker: &std::path::Path,
) -> Result<(), String> {
    use crate::schema::account::dsl::*;
    diesel::delete(account.filter(uuid.eq(crate::auth::GUEST_UUID)))
        .execute(conn)
        .map_err(|error| error.to_string())?;
    match std::fs::remove_file(marker) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
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

#[cfg(test)]
mod guest_cleanup_tests {
    use super::*;

    #[test]
    fn removes_guest_with_or_without_marker_and_preserves_real_account() {
        use crate::schema::account::dsl::*;
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join(".guest_mode");
        let mut conn = diesel::SqliteConnection::establish(":memory:").unwrap();
        diesel::sql_query("CREATE TABLE account (uuid TEXT PRIMARY KEY)")
            .execute(&mut conn)
            .unwrap();
        diesel::sql_query("INSERT INTO account VALUES ('real')")
            .execute(&mut conn)
            .unwrap();
        for with_marker in [true, false] {
            diesel::insert_into(account)
                .values(uuid.eq(crate::auth::GUEST_UUID))
                .execute(&mut conn)
                .unwrap();
            if with_marker {
                std::fs::write(&marker, "").unwrap();
            }
            remove_guest_account_and_marker(&mut conn, &marker).unwrap();
            assert!(!marker.exists());
            assert_eq!(
                account.select(uuid).load::<String>(&mut conn).unwrap(),
                vec!["real"]
            );
        }
        remove_guest_account_and_marker(&mut conn, &marker).unwrap();
    }
}
