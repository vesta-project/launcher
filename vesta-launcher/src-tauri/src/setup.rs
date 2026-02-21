use crate::discord::DiscordManager;
use crate::metadata_cache::MetadataCache;
use crate::notifications::manager::NotificationManager;
use crate::notifications::subscriptions::manager::SubscriptionManager;
use crate::tasks::manager::TaskManager;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::config::{get_app_config, init_config_db};
use crate::utils::db::{init_config_pool, init_vesta_pool};
use crate::utils::db_manager::get_app_config_dir;
use tauri::Manager;
#[cfg(target_os = "windows")]
use winver::WindowsVersion;
// use crate::instances::InstanceManager;  // TODO: InstanceManager doesn't exist yet
use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Exit status JSON structure written by the exit handler JAR
#[derive(serde::Deserialize, Debug)]
struct ExitStatus {
    _instance_id: String,
    exit_code: i32,
    exited_at: String,
}

/// Update playtime for an instance in the database
fn update_instance_playtime(
    app_handle: &tauri::AppHandle,
    instance_id_slug: &str,
    started_at_str: &str,
    exited_at_str: &str,
) -> Result<(), String> {
    use crate::models::instance::Instance;
    use crate::schema::instance::dsl::*;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    // Parse timestamps
    let started = chrono::DateTime::parse_from_rfc3339(started_at_str)
        .map_err(|e| format!("Failed to parse started_at: {}", e))?;
    let exited = chrono::DateTime::parse_from_rfc3339(exited_at_str)
        .map_err(|e| format!("Failed to parse exited_at: {}", e))?;

    // Calculate duration in minutes
    let duration = exited.signed_duration_since(started);
    let minutes = (duration.num_seconds() / 60).max(0) as i32;

    log::info!(
        "Updating playtime for instance {}: {} minutes (from {} to {})",
        instance_id_slug,
        minutes,
        started_at_str,
        exited_at_str
    );

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Find instance by slug
    // We need to fetch the whole instance to emit later anyway, but let's stick to the logic for now
    let instances_list = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in instances_list {
        let slug_name = crate::utils::sanitize::sanitize_instance_name(&inst.name);
        if slug_name == instance_id_slug {
            let new_playtime = inst.total_playtime_minutes + minutes;
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            diesel::update(instance.filter(id.eq(inst.id)))
                .set((
                    total_playtime_minutes.eq(new_playtime),
                    last_played.eq(&now),
                    updated_at.eq(&now),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update playtime: {}", e))?;

            log::info!(
                "Updated playtime for instance {} (id {}): {} -> {} minutes",
                instance_id_slug,
                inst.id,
                inst.total_playtime_minutes,
                new_playtime
            );

            // Fetch the updated instance to emit
            if let Ok(updated_inst) = instance.find(inst.id).first::<Instance>(&mut conn) {
                use tauri::Emitter;
                let _ = app_handle.emit("core://instance-updated", updated_inst);
            }

            return Ok(());
        }
    }

    log::warn!(
        "Instance {} not found in database for playtime update",
        instance_id_slug
    );
    Ok(())
}

/// Store crash details in the database for an instance (setup context)
fn store_crash_details_setup(
    instance_id_slug: &str,
    crash_info: &crate::utils::crash_parser::CrashDetails,
) -> Result<(), String> {
    use crate::schema::instance::dsl::*;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Find instance by slug
    let instances_list = instance
        .select((id, name))
        .load::<(i32, String)>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for (inst_id, inst_name) in instances_list {
        let slug = crate::utils::sanitize::sanitize_instance_name(&inst_name);
        if slug == instance_id_slug {
            // Create crash details JSON
            let crash_details_json = serde_json::json!({
                "crash_type": crash_info.crash_type,
                "message": crash_info.message,
                "report_path": crash_info.report_path,
                "timestamp": crash_info.timestamp,
            });

            diesel::update(instance.filter(id.eq(inst_id)))
                .set((
                    crashed.eq(true),
                    crash_details.eq(crash_details_json.to_string()),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update crash details: {}", e))?;

            log::info!(
                "Stored crash details for instance {} (id {})",
                instance_id_slug,
                inst_id
            );
            return Ok(());
        }
    }

    Err(format!(
        "Instance {} not found in database",
        instance_id_slug
    ))
}

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Get app data directory
    let app_data_dir = get_app_config_dir()?;

    // Allow the asset protocol to access the app data directory
    // This fixes 403 Forbidden errors when loading local images/screenshots
    app.asset_protocol_scope().allow_directory(&app_data_dir, true)?;

    // CRITICAL: Initialize Diesel connection pools FIRST before any other code runs
    // This ensures migrations are applied before any queries are executed
    log::info!("Initializing databases with Diesel and running migrations...");

    // Initialize connection pools (this runs migrations automatically)
    if let Err(e) = init_config_pool(app_data_dir.clone()) {
        log::error!("Failed to initialize config database pool: {}", e);
        return Err(e.into());
    }

    if let Err(e) = init_vesta_pool(app_data_dir.clone()) {
        log::error!("Failed to initialize vesta database pool: {}", e);
        return Err(e.into());
    }

    // Initialize default config row if needed
    if let Err(e) = init_config_db() {
        log::error!("Failed to initialize config table: {}", e);
    }

    log::info!("✓ Database initialization complete");

    // --- Guest Mode Cleanup ---
    // If the app was closed while in guest mode, clean up the marker and guest session data
    if let Ok(dir) = get_app_config_dir() {
        let marker_path = dir.join(".guest_mode");
        if marker_path.exists() {
            log::info!("[setup] Cleaning up stale guest session...");
            let _ = std::fs::remove_file(marker_path);

            // Evict Guest account from database
            if let Ok(mut conn) = crate::utils::db::get_vesta_conn() {
                use crate::schema::account::dsl::*;
                use diesel::prelude::*;
                let _ = diesel::delete(account.filter(uuid.eq(crate::auth::GUEST_UUID)))
                    .execute(&mut conn);
            }

            // Reset active account if it was guest
            if let Ok(mut config) = crate::utils::config::get_app_config() {
                if config.active_account_uuid == Some(crate::auth::GUEST_UUID.to_string()) {
                    config.active_account_uuid = None;
                    let _ = crate::utils::config::update_app_config(&config);
                }
            }
        }
    }
    // ---------------------------

    // Recovery for interrupted installs - move any stuck 'installing' instances to 'interrupted'
    let mut interrupted_instances = Vec::new();
    {
        use crate::schema::instance::dsl::*;
        use crate::utils::db::get_vesta_conn;
        use diesel::prelude::*;

        if let Ok(mut conn) = get_vesta_conn() {
            log::info!("Checking for interrupted installations...");
            let result = diesel::update(instance.filter(installation_status.eq("installing")))
                .set(installation_status.eq("interrupted"))
                .execute(&mut conn);

            match result {
                Ok(count) if count > 0 => {
                    log::info!(
                        "Recovered {} interrupted installations (set to 'interrupted')",
                        count
                    );
                    // Fetch them so we can notify later
                    if let Ok(list) = instance
                        .filter(installation_status.eq("interrupted"))
                        .load::<crate::models::instance::Instance>(&mut conn)
                    {
                        interrupted_instances = list;
                    }
                }
                Ok(_) => log::debug!("No interrupted installations found"),
                Err(e) => log::error!("Failed to recover interrupted installations: {}", e),
            }
        }
    }

    // Clean up old log files (>30 days)
    cleanup_old_logs(app.handle());

    // Initialize NotificationManager
    let notification_manager = NotificationManager::new(app.handle().clone());
    let _ = notification_manager.clear_task_notifications();
    
    // Create notifications for interrupted instances if any (using a clone before we manage it)
    if !interrupted_instances.is_empty() {
        let manager = notification_manager.clone();
        tauri::async_runtime::spawn(async move {
            use crate::notifications::models::{
                CreateNotificationInput, NotificationAction, NotificationType,
            };

            for inst in interrupted_instances {
                let raw_op = inst.last_operation.as_deref().unwrap_or("installation");
                let display_op = match raw_op {
                    "hard-reset" => "hard reset",
                    "repair" => "repair",
                    _ => "installation",
                };
                let description = format!(
                    "The {} for '{}' was interrupted. Would you like to resume?",
                    display_op, inst.name
                );

                let actions = vec![NotificationAction {
                    action_id: "resume_instance_operation".to_string(),
                    label: "Resume Now".to_string(),
                    action_type: "primary".to_string(),
                    payload: None,
                }];

                if let Err(e) = manager.create(CreateNotificationInput {
                    client_key: Some(format!("interrupted_instance_{}", inst.id)),
                    title: Some("Interrupted Operation Detected".to_string()),
                    description: Some(description),
                    severity: Some("warning".to_string()),
                    notification_type: Some(NotificationType::Patient),
                    dismissible: Some(true),
                    actions: Some(serde_json::to_string(&actions).unwrap_or_default()),
                    progress: None,
                    current_step: None,
                    total_steps: None,
                    metadata: None,
                    show_on_completion: None,
                }) {
                    log::error!(
                        "Failed to create interrupted-instance notification for {}: {}",
                        inst.name,
                        e
                    );
                }
            }
        });
    }

    app.manage(notification_manager);

    // Initialize DiscordManager
    let discord_manager = DiscordManager::new(app.handle().clone());
    let dm = discord_manager.clone();
    tauri::async_runtime::spawn(async move {
        dm.init().await;
    });
    app.manage(discord_manager);

    // Initialize TaskManager
    let task_manager = TaskManager::new(app.handle().clone());
    app.manage(task_manager);

    // Initialize SubscriptionManager
    let subscription_manager = Arc::new(SubscriptionManager::new(app.handle().clone()));
    if let Err(e) = subscription_manager.initialize_defaults() {
        log::error!("Failed to initialize default notification subscriptions: {}", e);
    }
    subscription_manager.clone().start_polling();
    app.manage(subscription_manager);

    // Initialize NetworkManager
    let network_manager = crate::utils::network::NetworkManager::new(app.handle().clone());
    app.manage(network_manager);

    // Initialize MetadataCache (in-memory fast path for manifest)
    app.manage(MetadataCache::new());

    // Initialize ResourceManager for external resources (Modrinth, CurseForge)
    app.manage(crate::resources::ResourceManager::new());

    // Initialize ResourceWatcher
    let resource_watcher = crate::resources::ResourceWatcher::new(app.handle().clone());
    app.manage(resource_watcher);

    // Start watching all existing instances
    {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            use crate::models::instance::Instance;
            use crate::resources::ResourceWatcher;
            use crate::schema::instance::dsl::*;
            use crate::utils::db::get_vesta_conn;
            use diesel::prelude::*;

            // Wait a bit to ensure everything is ready
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;

            if let Ok(mut conn) = get_vesta_conn() {
                if let Ok(instances_list) = instance.load::<Instance>(&mut conn) {
                    if let Some(watcher) = handle.try_state::<ResourceWatcher>() {
                        for inst in instances_list {
                            if let Some(game_dir) = &inst.game_directory {
                                log::info!("[Setup] Starting watcher for instance: {}", inst.name);
                                let _ = watcher
                                    .watch_instance(inst.slug(), inst.id, game_dir.clone())
                                    .await;
                            }
                        }
                    }
                }
            }
        });
    }

    // Reattach to already-running processes on startup
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            log::info!("Checking for already-running instances...");

            match crate::utils::process_state::load_running_processes() {
                Ok(processes) => {
                    if processes.is_empty() {
                        log::debug!("No persisted running processes found");
                        return;
                    }

                    log::info!("Found {} persisted running processes", processes.len());

                    for run_state in processes {
                        // Validate PID still exists using sysinfo
                        use sysinfo::System;
                        let mut sys = System::new_all();
                        sys.refresh_all();

                        if sys.process(sysinfo::Pid::from_u32(run_state.pid)).is_some() {
                            log::info!(
                                "Reattaching to running instance: {} (PID {})",
                                run_state.instance_id,
                                run_state.pid
                            );

                            // Re-register in the game registry
                            let game_instance = piston_lib::game::launcher::GameInstance {
                                instance_id: run_state.instance_id.clone(),
                                version_id: run_state.version_id.clone(),
                                modloader: run_state
                                    .modloader
                                    .as_ref()
                                    .map(|s| s.parse())
                                    .transpose()
                                    .ok()
                                    .flatten(),
                                pid: run_state.pid,
                                started_at: chrono::DateTime::parse_from_rfc3339(
                                    &run_state.started_at,
                                )
                                .ok()
                                .map(|dt| dt.with_timezone(&chrono::Utc))
                                .unwrap_or_else(chrono::Utc::now),
                                log_file: run_state.log_file.clone(),
                                game_dir: run_state.game_dir.clone(),
                            };

                            if let Err(e) =
                                piston_lib::game::launcher::register_instance(game_instance.clone())
                                    .await
                            {
                                log::warn!(
                                    "Failed to re-register instance {}: {}",
                                    run_state.instance_id,
                                    e
                                );
                                continue;
                            }

                            // Emit launched event to sync UI
                            use tauri::Emitter;
                            let _ = app_handle.emit(
                                "core://instance-launched",
                                serde_json::json!({
                                    "instance_id": run_state.instance_id.clone(),
                                    "pid": run_state.pid,
                                    "reattached": true
                                }),
                            );

                            log::info!(
                                "Successfully reattached to instance: {}",
                                run_state.instance_id
                            );
                        } else {
                            log::warn!(
                                "Persisted instance {} (PID {}) is no longer running, checking for exit status",
                                run_state.instance_id,
                                run_state.pid
                            );

                            // Check for exit_status.json to get accurate exit time and exit code
                            let exit_status_path =
                                run_state.game_dir.join(".vesta").join("exit_status.json");
                            let mut crashed = false;

                            if exit_status_path.exists() {
                                // Read exit status and update playtime
                                match std::fs::read_to_string(&exit_status_path) {
                                    Ok(content) => {
                                        match serde_json::from_str::<ExitStatus>(&content) {
                                            Ok(exit_status) => {
                                                log::info!(
                                                    "Found exit status for {}: exit_code={}, exited_at={}",
                                                    run_state.instance_id, exit_status.exit_code, exit_status.exited_at
                                                );

                                                // Check for crashes if exit code is non-zero
                                                if exit_status.exit_code != 0 {
                                                    // Convert started_at string to SystemTime for crash detection
                                                    let launch_start_time =
                                                        match chrono::DateTime::parse_from_rfc3339(
                                                            &run_state.started_at,
                                                        ) {
                                                            Ok(dt) => SystemTime::from(dt),
                                                            Err(_) => SystemTime::now(),
                                                        };

                                                    if let Some(crash_info) =
                                                        crate::utils::crash_parser::detect_crash(
                                                            &run_state.game_dir,
                                                            &run_state.log_file,
                                                            launch_start_time,
                                                        )
                                                    {
                                                        log::error!(
                                                            "Crash detected for {}: {:?}",
                                                            run_state.instance_id,
                                                            crash_info
                                                        );

                                                        // Store crash details in database
                                                        if let Err(e) = store_crash_details_setup(
                                                            &run_state.instance_id,
                                                            &crash_info,
                                                        ) {
                                                            log::error!(
                                                                "Failed to store crash details: {}",
                                                                e
                                                            );
                                                        } else {
                                                            crashed = true;
                                                        }

                                                        // Emit crash event to frontend
                                                        use tauri::Emitter;
                                                        let _ = app_handle.emit(
                                                            "core://instance-crashed",
                                                            serde_json::json!({
                                                                "instance_id": run_state.instance_id.clone(),
                                                                "crash_type": crash_info.crash_type,
                                                                "message": crash_info.message,
                                                                "report_path": crash_info.report_path,
                                                                "timestamp": crash_info.timestamp,
                                                            }),
                                                        );
                                                    }
                                                }

                                                // Update playtime in database (only if not crashed)
                                                if !crashed {
                                                    if let Err(e) = update_instance_playtime(
                                                        &app_handle,
                                                        &run_state.instance_id,
                                                        &run_state.started_at,
                                                        &exit_status.exited_at,
                                                    ) {
                                                        log::error!(
                                                            "Failed to update playtime for {}: {}",
                                                            run_state.instance_id,
                                                            e
                                                        );
                                                    }
                                                }

                                                // Delete the exit status file
                                                if let Err(e) =
                                                    std::fs::remove_file(&exit_status_path)
                                                {
                                                    log::warn!(
                                                        "Failed to remove exit status file: {}",
                                                        e
                                                    );
                                                }
                                            }
                                            Err(e) => {
                                                log::warn!(
                                                    "Failed to parse exit status for {}: {}",
                                                    run_state.instance_id,
                                                    e
                                                );
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        log::warn!(
                                            "Failed to read exit status file for {}: {}",
                                            run_state.instance_id,
                                            e
                                        );
                                    }
                                }
                            } else {
                                // No exit status file - use log file mtime as fallback
                                log::info!(
                                    "No exit status file for {}, using log file mtime as fallback",
                                    run_state.instance_id
                                );

                                if run_state.log_file.exists() {
                                    if let Ok(metadata) = std::fs::metadata(&run_state.log_file) {
                                        if let Ok(modified) = metadata.modified() {
                                            let exited_at =
                                                chrono::DateTime::<chrono::Utc>::from(modified)
                                                    .to_rfc3339();

                                            if let Err(e) = update_instance_playtime(
                                                &app_handle,
                                                &run_state.instance_id,
                                                &run_state.started_at,
                                                &exited_at,
                                            ) {
                                                log::error!("Failed to update playtime for {} (fallback): {}", run_state.instance_id, e);
                                            }
                                        }
                                    }
                                }
                            }

                            // Emit exited event to update UI
                            use tauri::Emitter;
                            let _ = app_handle.emit(
                                "core://instance-exited",
                                serde_json::json!({
                                    "instance_id": run_state.instance_id.clone(),
                                    "pid": run_state.pid,
                                    "crashed": crashed,
                                }),
                            );

                            let _ = crate::utils::process_state::remove_running_process(
                                &run_state.instance_id,
                            );
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to load persisted running processes: {}", e);
                }
            }
        });
    }

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
            .disable_drag_drop_handler() // Allow HTML5 drag-and-drop to work
            .transparent(true)
            .decorations(false);

    // // Setup system tray icon and menu (conditional based on config)
    // let config = get_app_config()?;
    // if config.show_tray_icon {
    //     let show_i = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    //     let hide_i = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
    //     let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    //     let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

    //     // Load tray icon
    //     let icon_path = app.path().resource_dir()?.join("icons").join("32x32.png");
    //     let icon_data = std::fs::read(&icon_path)
    //         .map_err(|e| format!("Failed to read tray icon: {}", e))?;
    //     let icon = tauri::image::Image::new_owned(icon_data, 32, 32);

    //     let _tray = TrayIconBuilder::new()
    //         .icon(icon)
    //         .menu(&menu)
    //         .on_menu_event(|app, event| match event.id.as_ref() {
    //             "show" => {
    //                 if let Some(window) = app.get_webview_window("main") {
    //                     let _ = window.show();
    //                     let _ = window.set_focus();
    //                 }
    //             }
    //             "hide" => {
    //                 if let Some(window) = app.get_webview_window("main") {
    //                     let _ = window.hide();
    //                 }
    //             }
    //             "quit" => {
    //                 app.exit(0);
    //             }
    //             _ => {
    //                 println!("menu item {:?} not handled", event.id);
    //             }
    //         })
    //         .build(app)?;
    // }

    #[cfg(target_os = "windows")]
    let version = match WindowsVersion::detect() {
        Some(v) => v,
        None => {
            log::warn!("Failed to detect Windows version. Using fallback window configuration.");
            // Return a fallback version that will use basic window configuration
            // TODO: Review this fallback later
            WindowsVersion {
                major: 10,
                minor: 0,
                build: 19000, // Pre-Windows 11 build number
            }
        }
    };

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

    let _main_win = win_builder.build()?;

    // Setup sniffer window immediately
    // Temporarily disabled file drop sniffer
    // let app_handle_for_sniffer = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        // Wait a small amount for the main window to settle before creating the primed sniffer
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        // Temporarily disabled file drop sniffer
        // let _ = crate::utils::file_drop::create_file_drop_overlay(app_handle_for_sniffer).await;
    });

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

            // Proactively check active account session
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            log::info!("[setup] Performing proactive session validation...");

            let active_acc = match crate::auth::get_active_account() {
                Ok(Some(acc)) => Some(acc),
                Ok(None) => {
                    // Check if config thinks we have an active account. If so, it's missing from DB.
                    if let Ok(config) = crate::utils::config::get_app_config() {
                        if config.active_account_uuid.is_some() {
                            log::warn!("[setup] Active account in config missing from database. repairing...");
                            crate::auth::repair_active_account(app_handle.clone())
                                .ok()
                                .flatten()
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                Err(e) => {
                    log::error!("[setup] Failed to get active account: {}", e);
                    None
                }
            };

            if let Some(acc) = active_acc {
                if acc.uuid != crate::auth::GUEST_UUID {
                    if let Err(e) =
                        crate::auth::ensure_account_tokens_valid(app_handle.clone(), acc.uuid).await
                    {
                        log::warn!("[setup] Proactive session validation failed: {}", e);
                    } else {
                        log::info!("[setup] Proactive session validation successful.");
                    }
                }
            }
        });
    }

    // Initial CLI Arguments Handling
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            // Give the frontend enough time to mount and register listeners
            tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
            use tauri::Emitter;
            // Ensure main window is visible before forwarding CLI args
            let _ = crate::utils::windows::ensure_main_window_visible(&handle);
            let _ = handle.emit("core://handle-cli", args);
        });
    }

    // Check for updates on startup
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        // Wait for system to settle
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        // Get config to check startup_check_updates
        let config = match get_app_config() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to get app config for update check: {}", e);
                return;
            }
        };

        if config.startup_check_updates {
            // Emit event to frontend to check for updates
            use tauri::Emitter;
            let _ = handle.emit("core://check-for-updates", ());
        }
    });

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
