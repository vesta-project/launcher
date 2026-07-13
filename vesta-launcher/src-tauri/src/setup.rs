use crate::discord::DiscordManager;
use crate::metadata_cache::MetadataCache;
use crate::notifications::manager::NotificationManager;
use crate::notifications::subscriptions::manager::SubscriptionManager;
use crate::tasks::manager::TaskManager;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::config::{
    get_app_config, init_config_db, normalize_memory_config_state, normalize_theme_config_state,
};
use crate::utils::db::{init_config_pool, init_vesta_pool};
use crate::utils::db_manager::get_app_config_dir;
use crate::utils::version_tracking::VersionTrackingRepository;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::webview::Color;
use tauri::Manager;
// use crate::instances::InstanceManager;  // TODO: InstanceManager doesn't exist yet
use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

fn setup_tray(
    app: &tauri::AppHandle,
    show_tray_icon: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "tray_show", "Show", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "tray_hide", "Hide", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => {
                let _ = crate::utils::windows::ensure_main_window_visible(app);
            }
            "tray_hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "tray_quit" => {
                let _ = crate::commands::app::request_guarded_exit(app, "tray-menu");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            if let tauri::tray::TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = crate::utils::windows::ensure_main_window_visible(tray.app_handle());
            }
        })
        .build(app)?;

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_visible(show_tray_icon);
    }

    Ok(())
}

#[cfg(desktop)]
fn sync_autostart_with_config(app: &tauri::AppHandle, should_enable: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autostart_manager = app.autolaunch();
    let is_enabled = autostart_manager
        .is_enabled()
        .map_err(|e| format!("Failed to get autostart status: {}", e))?;

    if should_enable == is_enabled {
        return Ok(());
    }

    if should_enable {
        autostart_manager
            .enable()
            .map_err(|e| format!("Failed to enable autostart: {}", e))?;
    } else {
        autostart_manager
            .disable()
            .map_err(|e| format!("Failed to disable autostart: {}", e))?;
    }

    Ok(())
}

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Get app data directory
    let app_data_dir = get_app_config_dir()?;

    // Allow the asset protocol to access the app data directory
    // This fixes 403 Forbidden errors when loading local images/screenshots
    app.asset_protocol_scope()
        .allow_directory(&app_data_dir, true)?;

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

    // Normalize theme_data and mirrored scalar theme fields on startup
    if let Err(e) = normalize_theme_config_state() {
        log::error!("Failed to normalize startup theme config state: {}", e);
    }

    if let Err(e) = normalize_memory_config_state() {
        log::error!("Failed to normalize startup memory config state: {}", e);
    }

    // Initialize version tracking defaults (including launcher version)
    if let Err(e) = VersionTrackingRepository::initialize_defaults() {
        log::error!("Failed to initialize version tracking defaults: {}", e);
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
                }

                // Guest mode is temporary; onboarding should restart from welcome after teardown.
                config.setup_completed = false;
                config.setup_step = 0;
                let _ = crate::utils::config::update_app_config(&config);
            }
        }
    }

    // --- Demo Account Cleanup ---
    // Always remove the temporal demo account on startup if it exists
    if let Ok(mut conn) = crate::utils::db::get_vesta_conn() {
        use crate::schema::account::dsl::*;
        use diesel::prelude::*;

        log::info!("[setup] Cleaning up temporal demo account if present...");

        // Remove from DB
        let _ = diesel::delete(account.filter(account_type.eq(crate::auth::ACCOUNT_TYPE_DEMO)))
            .execute(&mut conn);

        // Reset active account if it was the demo account
        if let Ok(mut config) = crate::utils::config::get_app_config() {
            if config.active_account_uuid == Some(crate::auth::DEMO_UUID.to_string()) {
                config.active_account_uuid = None;
                let _ = crate::utils::config::update_app_config(&config);
            }
        }
    }
    // ---------------------------

    let interrupted_instances = crate::startup::recovery::recover_interrupted_operations()
        .unwrap_or_else(|error| {
            log::error!("Failed to recover interrupted installations: {}", error);
            Vec::new()
        });

    // Clean up old log files (>30 days)
    cleanup_old_logs(app.handle());

    // Initialize NotificationManager
    let notification_manager = NotificationManager::new(app.handle().clone());
    let _ = notification_manager.clear_task_notifications();

    crate::startup::recovery::publish_interrupted_notifications(
        notification_manager.clone(),
        interrupted_instances,
    );

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
        log::error!(
            "Failed to initialize default notification subscriptions: {}",
            e
        );
    }
    subscription_manager.clone().start_polling();
    app.manage(subscription_manager);

    // Initialize NetworkManager
    let network_manager = crate::utils::network::NetworkManager::new(app.handle().clone());
    app.manage(network_manager);

    // Initialize MetadataCache (in-memory fast path for manifest)
    app.manage(MetadataCache::new());

    // Start warming the manifest cache immediately in the background.
    // By the time the user opens the install page, manifests are already
    // cached in memory and on disk.
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let config_dir = get_app_config_dir().ok();
            if let Some(dir) = config_dir {
                let cache = piston_lib::game::manifest_cache::ManifestCache::new(
                    dir.join("data").join("manifests"),
                );
                log::info!("[setup] Warming manifest cache in background...");
                cache.warm_up().await;
                log::info!("[setup] Manifest cache warmup complete");

                // Populate MetadataCache from the warmed manifests
                match cache.build_piston_metadata().await {
                    Ok(meta) => {
                        if let Some(mc) = app_handle.try_state::<MetadataCache>() {
                            mc.set(&meta);
                            log::info!(
                                "[setup] MetadataCache populated: {} versions",
                                meta.game_versions.len()
                            );
                        }
                    }
                    Err(e) => log::warn!("[setup] Failed to build metadata after warmup: {}", e),
                }
            }
        });
    }

    // Sync profiles on startup
    if let Some(task_manager) = app.try_state::<TaskManager>() {
        log::info!("[setup] Submitting SyncAccountProfilesTask...");
        let _ = task_manager.submit(Box::new(
            crate::tasks::sync_profiles::SyncAccountProfilesTask::new(),
        ));
    } else {
        log::error!("[setup] Failed to get TaskManager state for startup sync");
    }

    // Initialize ResourceManager for external resources (Modrinth, CurseForge)
    app.manage(crate::resources::ResourceManager::new());
    app.manage(crate::launcher_import::ImportManager::new());

    // Check for launcher updates/changelog on startup
    {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let current_version = handle.package_info().version.to_string();
            match VersionTrackingRepository::is_version_newer("launcher", &current_version) {
                Ok(true) => {
                    log::info!(
                        "New launcher version detected: {}. Triggering notification.",
                        current_version
                    );

                    let manager = handle.state::<NotificationManager>();
                    use crate::notifications::models::{
                        CreateNotificationInput, NotificationAction, NotificationType,
                    };

                    let actions = vec![NotificationAction {
                        action_id: "navigate".to_string(),
                        label: "View Changelog".to_string(),
                        action_type: "primary".to_string(),
                        payload: Some(serde_json::json!({ "path": "/changelog" })),
                    }];

                    if let Err(e) = manager.create(CreateNotificationInput {
                        client_key: Some("launcher_update".to_string()),
                        title: Some("Vesta has been updated!".to_string()),
                        description: Some(format!(
                            "Welcome to version {}. Check out what's new in this release!",
                            current_version
                        )),
                        severity: Some("info".to_string()),
                        notification_type: Some(NotificationType::Patient),
                        dismissible: Some(true),
                        persist: Some(true),
                        silent: Some(false),
                        actions: Some(serde_json::to_string(&actions).unwrap_or_default()),
                        progress: None,
                        current_step: None,
                        total_steps: None,
                        metadata: None,
                        show_on_completion: None,
                    }) {
                        log::error!("Failed to create update notification: {}", e);
                    }

                    // Update the last seen version so we don't notify again
                    if let Err(e) = VersionTrackingRepository::update_last_seen_version(
                        "launcher",
                        &current_version,
                        true,
                    ) {
                        log::error!("Failed to update last seen launcher version: {}", e);
                    }
                }
                Ok(false) => log::debug!("Launcher version is up to date in tracking."),
                Err(e) => log::error!("Failed to check launcher version: {}", e),
            }
        });
    }

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
                        let startup_scan_limiter =
                            std::sync::Arc::new(tokio::sync::Semaphore::new(2));
                        let mut startup_scan_tasks = tokio::task::JoinSet::new();
                        for inst in instances_list {
                            if let Some(game_dir) = &inst.game_directory {
                                log::info!("[Setup] Attaching watcher for instance: {}", inst.name);
                                let _ = watcher
                                    .watch_instance_without_scan(inst.id, game_dir.clone())
                                    .await;
                                let handle_for_task = handle.clone();
                                let game_dir_clone = game_dir.clone();
                                let instance_id = inst.id;
                                let instance_name = inst.name.clone();
                                let limiter = startup_scan_limiter.clone();
                                startup_scan_tasks.spawn(async move {
                                    let Ok(_permit) = limiter.acquire_owned().await else {
                                        return;
                                    };
                                    let Some(watcher_clone) = handle_for_task.try_state::<ResourceWatcher>() else {
                                        return;
                                    };
                                    log::info!(
                                        "[Setup] Background startup resync start for instance: {}",
                                        instance_name
                                    );
                                    if let Err(err) =
                                        watcher_clone.refresh_instance(instance_id, game_dir_clone).await
                                    {
                                        log::warn!(
                                            "[Setup] Background startup resync failed for instance {}: {}",
                                            instance_name,
                                            err
                                        );
                                    } else {
                                        log::info!(
                                            "[Setup] Background startup resync done for instance: {}",
                                            instance_name
                                        );
                                    }
                                });
                            }
                        }
                        while startup_scan_tasks.join_next().await.is_some() {}
                    }
                }
            }
        });
    }

    // Reattach to already-running processes on startup
    {
        crate::instance::lifecycle::reattach_or_reconcile_persisted_processes(app.handle().clone());
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

    let os_str = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };

    let win_builder =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .initialization_script(&format!("window.__VESTA_OS__ = '{}';", os_str))
            .title("Vesta Launcher")
            .inner_size(1200_f64, 700_f64)
            .min_inner_size(520_f64, 465_f64)
            .disable_drag_drop_handler() // Allow HTML5 drag-and-drop to work
            // Keep startup hidden until frontend requests show, so the first visible frame is the loader.
            .visible(false)
            .transparent(true)
            .decorations(false)
            // Match startup loader background so the window has a solid color before webview paints.
            .background_color(Color(20, 20, 20, 255));

    let config = get_app_config()?;
    // Legacy bridge: use persisted config size as bootstrap defaults until window-state restore applies.
    let win_builder = win_builder.inner_size(
        config.last_window_width as f64,
        config.last_window_height as f64,
    );
    #[cfg(desktop)]
    if let Err(e) = sync_autostart_with_config(app.handle(), config.autostart_enabled) {
        log::warn!("Failed to sync autostart state with config: {}", e);
    }

    if let Err(e) = setup_tray(app.handle(), config.show_tray_icon) {
        log::warn!("Failed to initialize tray: {}", e);
    }
    if let Err(e) = crate::commands::app::sync_tray_visibility_with_config(app.handle()) {
        log::warn!(
            "Failed to sync tray visibility with persisted config at startup: {}",
            e
        );
    }

    // Apply the macOS-specific title bar style
    #[cfg(target_os = "macos")]
    let win_builder = win_builder
        .decorations(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay);

    let _main_win = win_builder.build()?;

    // Always start with a solid, non-transparent window effect during bootstrap.
    // The frontend theme engine will apply the persisted effect once config/theme has loaded.
    let effect = "none".to_string();

    crate::commands::app::set_window_effect(_main_win.clone(), effect).unwrap_or(());

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

    // Initial CLI Arguments Handling — queue intents until the frontend signals ready.
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        crate::utils::launch_intents::ingest_launch_args(&args);
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

fn is_launcher_log_file(name: &str) -> bool {
    name.starts_with("vesta-log-") && name.ends_with(".log")
}

fn cleanup_old_logs(_app_handle: &tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(log_dir) = crate::utils::db_manager::get_launcher_log_dir() {
            log::debug!("Cleaning up old logs in: {:?}", log_dir);

            if let Ok(entries) = fs::read_dir(&log_dir) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                let retention_secs = 30 * 24 * 60 * 60; // 30 days

                for entry in entries.flatten() {
                    let file_name = entry.file_name();
                    let file_name = file_name.to_string_lossy();
                    if !entry.path().is_file() || !is_launcher_log_file(&file_name) {
                        continue;
                    }

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
