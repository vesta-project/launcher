use crate::notifications::manager::{ActionHandler, NotificationManager};
use anyhow::Result;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

struct RestartApp;

impl ActionHandler for RestartApp {
    fn handle(
        &self,
        app_handle: &AppHandle,
        _client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        app_handle.restart();
    }
}

struct EmitUpdateEvent(&'static str);

impl ActionHandler for EmitUpdateEvent {
    fn handle(
        &self,
        app_handle: &AppHandle,
        _client_key: Option<String>,
        _payload: Option<serde_json::Value>,
    ) -> Result<()> {
        app_handle
            .emit(self.0, ())
            .map_err(|error| anyhow::anyhow!(error))
    }
}

pub fn register(manager: &NotificationManager) {
    manager.register_action("restart_app", Arc::new(RestartApp));
    manager.register_action(
        "install_app_update",
        Arc::new(EmitUpdateEvent("core://install-app-update")),
    );
    manager.register_action(
        "download_update",
        Arc::new(EmitUpdateEvent("core://download-app-update")),
    );
    manager.register_action(
        "open_update_dialog",
        Arc::new(EmitUpdateEvent("core://open-update-ui")),
    );
}
