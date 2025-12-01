use anyhow::Result;
use serde_json::to_string_pretty;
use tauri::Manager;
use tokio::fs;

use crate::metadata_cache::MetadataCache;
use crate::notifications::manager::NotificationManager;
use crate::notifications::metadata_adapter::notification_hint_to_create_input;
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

            // Load or fetch metadata
            let metadata = if force_refresh {
                log::info!("Force refreshing PistonMetadata (bypassing cache)...");
                // Delete cache to force fresh fetch
                let cache_path = config_dir.join("metadata.json");
                if cache_path.exists() {
                    log::info!("Deleting cache file to force refresh");
                    let _ = fs::remove_file(&cache_path).await;
                }
                piston_lib::game::metadata::cache::refresh_metadata(&config_dir)
                    .await
                    .map_err(|e| {
                        log::error!("Failed to refresh metadata: {}", e);
                        e.to_string()
                    })?
            } else {
                log::info!("Fetching PistonMetadata from piston-lib cache...");
                piston_lib::game::metadata::cache::load_or_fetch_metadata(&config_dir)
                    .await
                    .map_err(|e| {
                        log::error!("Failed to load/fetch metadata: {}", e);
                        e.to_string()
                    })?
            };

            log::info!(
                "Metadata loaded successfully: {} game versions, last_updated: {}",
                metadata.game_versions.len(),
                metadata.last_updated
            );

            let _ = manager.update_progress_with_description(
                notif_key.clone(),
                90,
                Some(4),
                Some(5),
                "Saving piston_manifest.json...".to_string(),
            );

            // Save pretty JSON under required filename
            log::info!("Serializing metadata to JSON...");
            let json = to_string_pretty(&metadata).map_err(|e| {
                log::error!("Failed to serialize metadata: {}", e);
                e.to_string()
            })?;
            let manifest_path = config_dir.join("piston_manifest.json");
            log::info!("Writing piston_manifest.json to: {:?}", manifest_path);

            fs::write(&manifest_path, &json).await.map_err(|e| {
                log::error!("Failed to write piston_manifest.json: {}", e);
                e.to_string()
            })?;

            let file_size = fs::metadata(&manifest_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            log::info!(
                "piston_manifest.json written successfully ({} bytes)",
                file_size
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

            // Create notifications for any generator-provided notification hints found in metadata
            for gv in metadata.game_versions.iter() {
                for (loader, loader_list) in gv.loaders.iter() {
                    for li in loader_list.iter() {
                        if let Some(ref hint) = li.notification {
                            // Map hint -> CreateNotificationInput and call manager.create
                            let input = notification_hint_to_create_input(&hint);
                            let _ = manager.create(input);
                        }
                    }
                }
            }

            log::info!("PistonManifest generation completed successfully");
            Ok(())
        })
    }
}
