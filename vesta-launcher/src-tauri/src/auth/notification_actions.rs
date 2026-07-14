use crate::notifications::manager::{ActionHandler, NotificationManager};
use anyhow::Result;
use diesel::prelude::*;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

struct LogoutGuest;

impl ActionHandler for LogoutGuest {
    fn handle(
        &self,
        app_handle: &AppHandle,
        client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        if let Ok(app_data_dir) = crate::utils::db_manager::get_app_config_dir() {
            let marker_path = app_data_dir.join(".guest_mode");
            if marker_path.exists() {
                let _ = std::fs::remove_file(marker_path);
            }
        }

        if let Ok(mut connection) = crate::utils::db::get_vesta_conn() {
            use crate::schema::account::dsl::*;
            let _ = diesel::delete(account.filter(uuid.eq(crate::auth::GUEST_UUID)))
                .execute(&mut connection);
        }

        if let Some(manager) =
            app_handle.try_state::<crate::notifications::manager::NotificationManager>()
        {
            let _ = manager.delete(client_key.unwrap_or_else(|| "guest_mode_warning".into()));
        }

        use crate::utils::config::{get_app_config, update_app_config};
        if let Ok(mut config) = get_app_config() {
            config.setup_completed = false;
            config.setup_step = 0;
            config.active_account_uuid = None;
            let _ = update_app_config(&config);
        }

        app_handle
            .emit("core://logout-guest", ())
            .map_err(anyhow::Error::msg)
    }
}

pub fn register(manager: &NotificationManager) {
    manager.register_action("logout_guest", Arc::new(LogoutGuest));
}
