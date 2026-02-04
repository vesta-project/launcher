use anyhow::Result;
use tauri::Manager;
use tokio::fs;

use crate::metadata_cache::MetadataCache;
use crate::notifications::manager::NotificationManager;
use crate::tasks::manager::{BoxFuture, Task, TaskContext};

pub struct GenerateManifestTask {
    force_refresh: bool,
}

impl GenerateManifestTask {
    pub fn new() -> Self {
        Self {
            force_refresh: false,
        }
    }

    pub fn new_force_refresh() -> Self {
        Self {
            force_refresh: true,
        }
    }
}

impl Task for GenerateManifestTask {
    fn name(&self) -> String {
        if self.force_refresh {
            "Refresh Piston Manifest".to_string()
        } else {
            "Generate Piston Manifest".to_string()
        }
    }

    fn cancellable(&self) -> bool {
        false
    }

    fn total_steps(&self) -> i32 {
        5
    }

    fn starting_description(&self) -> String {
        if self.force_refresh {
            "Force fetching fresh metadata...".to_string()
        } else {
            "Preparing manifest generation".to_string()
        }
    }

    fn completion_description(&self) -> String {
        if self.force_refresh {
            "Manifest refreshed successfully".to_string()
        } else {
            "Manifest generation complete".to_string()
        }
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let app = ctx.app_handle.clone();
        let notif_key = ctx.notification_id.clone();
        let force_refresh = self.force_refresh;

        Box::pin(async move {
            let manager = app.state::<NotificationManager>();

            log::info!(
                "Starting PistonManifest generation (force_refresh: {})",
                force_refresh
            );

            // Resolve AppData folder: %APPDATA%/.VestaLauncher
            log::info!("Resolving config directory...");
            let config_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| {
                log::error!("Failed to get app config dir: {}", e);
                e.to_string()
            })?;
            log::info!("Config directory resolved: {:?}", config_dir);

            let _ = manager.update_progress_with_description(
                notif_key.clone(),
                10,
                Some(1),
                Some(5),
                if force_refresh {
                    "Clearing cache and fetching fresh metadata...".to_string()
                } else {
                    "Fetching metadata from piston-lib...".to_string()
                },
            );

            let network_manager = app.state::<crate::utils::network::NetworkManager>();
            let network_status = network_manager.get_status();

            let max_age = if network_status == crate::utils::network::NetworkStatus::Weak {
                168 // 7 days
            } else if network_status == crate::utils::network::NetworkStatus::Offline {
                8760 // 1 year (basically use any cache we have)
            } else {
                24 // 1 day
            };

            // Load or fetch metadata
            let start = std::time::Instant::now();
            let metadata_res = if force_refresh {
                log::info!("Force refreshing PistonMetadata (bypassing cache)...");
                // Delete cache to force fresh fetch
                let cache_path = config_dir.join("piston_manifest.json");
                if cache_path.exists() {
                    log::info!("Deleting cache file to force refresh");
                    let _ = fs::remove_file(&cache_path).await;
                }
                piston_lib::game::metadata::cache::refresh_metadata(&config_dir).await
            } else {
                log::info!(
                    "Fetching PistonMetadata (status: {:?}, max_age: {}h)...",
                    network_status,
                    max_age
                );
                piston_lib::game::metadata::cache::load_or_fetch_metadata_ext(&config_dir, max_age)
                    .await
            };

            network_manager.report_request_result(start.elapsed().as_millis(), metadata_res.is_ok());

            let metadata = metadata_res.map_err(|e| {
                log::error!("Failed to load/fetch metadata: {}", e);
                e.to_string()
            })?;

            log::info!(
                "Metadata loaded successfully: {} game versions, last_updated: {}",
                metadata.game_versions.len(),
                metadata.last_updated
            );

            let _ = manager.update_progress_with_description(
                notif_key.clone(),
                100,
                Some(5),
                Some(5),
                "Manifest ready".to_string(),
            );

            // Update in-memory cache for fast subsequent access
            if let Some(cache) = app.try_state::<MetadataCache>() {
                cache.set(&metadata);
                log::info!(
                    "Updated in-memory MetadataCache ({} versions)",
                    metadata.game_versions.len()
                );
            } else {
                log::warn!("MetadataCache state not found; fast-path cache disabled");
            }

            log::info!("PistonManifest generation completed successfully");
            Ok(())
        })
    }
}
