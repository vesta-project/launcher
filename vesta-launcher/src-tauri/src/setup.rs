use crate::metadata_cache::MetadataCache;
use crate::notifications::manager::NotificationManager;
use crate::tasks::manager::TaskManager;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::db_manager::{get_config_db, get_data_db};
use tauri::Manager;
use winver::WindowsVersion;
// use crate::instances::InstanceManager;  // TODO: InstanceManager doesn't exist yet
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Clean up old log files (>30 days)
    cleanup_old_logs(app.handle());

    // Initialize NotificationManager
    let notification_manager = NotificationManager::new(app.handle().clone());

    // Clear old task-related notifications from previous sessions
    // This includes Progress (unfinished tasks) and Patient (completed tasks)
    let _ = notification_manager.clear_task_notifications();

    app.manage(notification_manager);

    // Initialize TaskManager
    let task_manager = TaskManager::new(app.handle().clone());
    app.manage(task_manager);

    // Initialize MetadataCache (in-memory fast path for manifest)
    app.manage(MetadataCache::new());

    // TODO: InstanceManager doesn't exist yet - commenting out for now
    /*
    // Initialize InstanceManager
    let instance_manager = InstanceManager::new();
    app.manage(instance_manager.clone());

    // Scan for running instances on startup
    let instance_manager_clone = instance_manager.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(db) = get_data_db() {
            let conn = db.get_connection();
            let mut stmt = match conn.prepare(
                "SELECT id, name, minecraft_version, modloader, modloader_version, java_path,
                        java_args, game_directory, width, height, memory_mb, icon_path,
                        last_played, total_playtime_minutes, created_at, updated_at
                 FROM instance"
            ) {
                Ok(stmt) => stmt,
                Err(e) => {
                    log::warn!("Failed to prepare instance query: {}", e);
                    return;
                }
            };

            let instances_result = stmt.query_map([], |row| {
                Ok(crate::models::instance::Instance {
                    id: crate::utils::sqlite::AUTOINCREMENT::VALUE(row.get(0)?),
                    name: row.get(1)?,
                    minecraft_version: row.get(2)?,
                    modloader: row.get(3)?,
                    modloader_version: row.get(4)?,
                    java_path: row.get(5)?,
                    java_args: row.get(6)?,
                    game_directory: row.get(7)?,
                    width: row.get(8)?,
                    height: row.get(9)?,
                    memory_mb: row.get(10)?,
                    icon_path: row.get(11)?,
                    last_played: row.get(12)?,
                    total_playtime_minutes: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            });

            if let Ok(instances_iter) = instances_result {
                let instances: Vec<crate::models::instance::Instance> = instances_iter.filter_map(|r| r.ok()).collect();
                let running = instance_manager_clone.scan_for_running_instances(&instances);
                if !running.is_empty() {
                    log::info!("Found {} running instances on startup", running.len());
                }
            }
        }
    });
    */

    // Initialize databases in background thread to not block window creation
    // This triggers the lazy initialization in db_manager
    tauri::async_runtime::spawn(async {
        if let Err(e) = get_config_db() {
            eprintln!("Failed to initialize config database: {}", e);
        }
        if let Err(e) = get_data_db() {
            eprintln!("Failed to initialize data database: {}", e);
        }
    });

    // Initialize process registry (in-memory only, no persistence)
    {
        tauri::async_runtime::spawn(async move {
            log::info!("Initializing process registry");
            if let Err(e) = piston_lib::game::launcher::load_registry().await {
                log::error!("Failed to initialize process registry: {}", e);
            }
        });
    }

    let win_builder =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("Vesta Launcher")
            .inner_size(1200_f64, 700_f64)
            .min_inner_size(520_f64, 465_f64)
            .disable_drag_drop_handler() // Disable so overlay can capture drag events
            .transparent(true)
            .decorations(false);

    #[cfg(target_os = "windows")]
    let version = WindowsVersion::detect().expect("Failed to detect windows version");

    #[cfg(target_os = "windows")]
    // If on windows 11
    let win_builder = if version.major == 10 && version.build >= 22000 {
        win_builder.effects(
            tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::MicaDark)
                .build(),
        )
    } else if version.major == 6 && version.minor == 1 {
        // On windows 7
        win_builder.effects(
            tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::Blur)
                .build(),
        )
    } else {
        // TODO: Eventually windows 10
        win_builder.effects(
            tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::Acrylic)
                .build(),
        )
    };

    #[cfg(target_os = "macos")]
    let win_builder = win_builder.effects(
        tauri::window::EffectsBuilder::new()
            .effect(tauri::window::Effect::Vibrancy)
            .build(),
    );

    win_builder.build()?;

    // Generate PistonManifest in background on launch
    // Add a small delay to ensure TaskManager is fully initialized
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            // Give TaskManager time to start its worker loop
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            log::info!("Submitting GenerateManifestTask to TaskManager");
            let tm = app_handle.state::<TaskManager>();
            match tm.submit(Box::new(GenerateManifestTask::new())).await {
                Ok(_) => log::info!("GenerateManifestTask submitted successfully"),
                Err(e) => log::error!("Failed to submit GenerateManifestTask: {}", e),
            }
        });
    }

    // File drop overlay disabled for now
    // let app_handle = app.handle().clone();
    // if let Err(e) = tauri::async_runtime::block_on(create_file_drop_overlay(app_handle)) {
    //     eprintln!("Failed to create file drop overlay: {}", e);
    // }

    Ok(())
}

fn cleanup_old_logs(app_handle: &tauri::AppHandle) {
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(log_dir) = app_handle_clone.path().app_log_dir() {
            log::debug!("Cleaning up old logs in: {:?}", log_dir);

            if let Ok(entries) = fs::read_dir(&log_dir) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                let retention_secs = 30 * 24 * 60 * 60; // 30 days

                for entry in entries.flatten() {
                    if let Ok(metadata) = entry.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                                let age_secs = now.saturating_sub(duration.as_secs());
                                if age_secs > retention_secs {
                                    if let Err(e) = fs::remove_file(entry.path()) {
                                        log::warn!(
                                            "Failed to remove old log file {:?}: {}",
                                            entry.path(),
                                            e
                                        );
                                    } else {
                                        log::debug!("Removed old log file: {:?}", entry.path());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}
