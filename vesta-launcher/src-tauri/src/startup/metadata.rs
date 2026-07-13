use crate::metadata_cache::MetadataCache;
use crate::utils::db_manager::get_app_config_dir;
use tauri::Manager;

pub fn register_and_warm(app: &mut tauri::App) {
    app.manage(MetadataCache::new());

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let Ok(config_dir) = get_app_config_dir() else {
            log::warn!("Unable to locate config directory for manifest cache warmup");
            return;
        };
        let cache = piston_lib::game::manifest_cache::ManifestCache::new(
            config_dir.join("data").join("manifests"),
        );

        log::info!("[startup] Warming manifest cache in background...");
        cache.warm_up().await;
        log::info!("[startup] Manifest cache warmup complete");

        match cache.build_piston_metadata().await {
            Ok(metadata) => {
                let Some(memory_cache) = app_handle.try_state::<MetadataCache>() else {
                    log::warn!("MetadataCache unavailable after manifest warmup");
                    return;
                };
                memory_cache.set(&metadata);
                log::info!(
                    "[startup] MetadataCache populated with {} versions",
                    metadata.game_versions.len()
                );
            }
            Err(error) => log::warn!("Failed to build metadata after warmup: {}", error),
        }
    });
}
