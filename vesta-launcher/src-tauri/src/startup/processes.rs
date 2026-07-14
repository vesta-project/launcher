pub fn start(app_handle: tauri::AppHandle) {
    crate::instance::lifecycle::reattach_or_reconcile_persisted_processes(app_handle);

    tauri::async_runtime::spawn(async move {
        log::info!("[startup] Initializing process registry");
        if let Err(error) = piston_lib::game::launcher::load_registry().await {
            log::error!("Failed to initialize process registry: {}", error);
        }
    });
}
