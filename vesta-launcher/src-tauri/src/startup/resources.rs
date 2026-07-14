use crate::models::instance::Instance;
use crate::resources::ResourceWatcher;
use crate::schema::instance::dsl::*;
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use std::sync::Arc;
use tauri::Manager;

pub fn start_resource_watchers(app: &mut tauri::App) {
    app.manage(ResourceWatcher::new(app.handle().clone()));

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let instances = match load_instances() {
            Ok(instances) => instances,
            Err(error) => {
                log::warn!(
                    "Failed to load instances for startup resource scan: {}",
                    error
                );
                return;
            }
        };
        let Some(watcher) = app_handle.try_state::<ResourceWatcher>() else {
            log::warn!("ResourceWatcher was unavailable during startup scan");
            return;
        };

        let scan_limiter = Arc::new(tokio::sync::Semaphore::new(2));
        let mut scan_tasks = tokio::task::JoinSet::new();
        for persisted_instance in instances {
            let Some(game_dir) = persisted_instance.game_directory else {
                continue;
            };

            log::info!(
                "[startup] Attaching resource watcher for instance: {}",
                persisted_instance.name
            );
            if let Err(error) = watcher
                .watch_instance_without_scan(persisted_instance.id, game_dir.clone())
                .await
            {
                log::warn!(
                    "Failed to attach resource watcher for instance {}: {}",
                    persisted_instance.name,
                    error
                );
            }

            let task_handle = app_handle.clone();
            let limiter = scan_limiter.clone();
            scan_tasks.spawn(async move {
                let Ok(_permit) = limiter.acquire_owned().await else {
                    return;
                };
                let Some(watcher) = task_handle.try_state::<ResourceWatcher>() else {
                    return;
                };

                log::info!(
                    "[startup] Background resource resync started for instance: {}",
                    persisted_instance.name
                );
                match watcher
                    .refresh_instance(persisted_instance.id, game_dir)
                    .await
                {
                    Ok(()) => log::info!(
                        "[startup] Background resource resync finished for instance: {}",
                        persisted_instance.name
                    ),
                    Err(error) => log::warn!(
                        "[startup] Background resource resync failed for instance {}: {}",
                        persisted_instance.name,
                        error
                    ),
                }
            });
        }

        while scan_tasks.join_next().await.is_some() {}
    });
}

fn load_instances() -> Result<Vec<Instance>, String> {
    let mut conn = get_vesta_conn().map_err(|error| error.to_string())?;
    instance
        .load::<Instance>(&mut conn)
        .map_err(|error| error.to_string())
}
