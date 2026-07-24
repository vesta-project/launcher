use crate::discord::DiscordManager;
use crate::notifications::manager::NotificationManager;
use crate::notifications::subscriptions::manager::SubscriptionManager;
use crate::tasks::manager::TaskManager;
use crate::utils::config::{
    init_config_db, normalize_memory_config_state, normalize_theme_config_state,
};
use crate::utils::db::{init_config_pool, init_vesta_pool};
use crate::utils::db_manager::get_app_config_dir;
use std::sync::Arc;
use tauri::Manager;

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

    let config = crate::utils::config::get_app_config()?;
    app.manage(crate::localization::LocalizationManager::new(
        &config.language,
    )?);

    crate::startup::updates::initialize_version_tracking();

    log::info!("✓ Database initialization complete");

    crate::startup::accounts::cleanup_temporary_accounts();

    let interrupted_instances = crate::startup::recovery::recover_interrupted_operations()
        .unwrap_or_else(|error| {
            log::error!("Failed to recover interrupted installations: {}", error);
            Vec::new()
        });

    // Clean up old log files (>30 days)
    crate::logging::cleanup_old_logs();

    // Initialize NotificationManager
    let notification_manager = NotificationManager::new(app.handle().clone());
    let _ = notification_manager.clear_task_notifications();

    crate::startup::recovery::publish_interrupted_notifications(
        notification_manager.clone(),
        interrupted_instances,
    );

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

    crate::tasks::notification_actions::register(&notification_manager);
    crate::instance::notification_actions::register(&notification_manager);
    crate::startup::update_actions::register(&notification_manager);
    crate::auth::notification_actions::register(&notification_manager);
    app.manage(notification_manager);

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

    crate::startup::metadata::register_and_warm(app);
    crate::startup::accounts::submit_profile_sync(app);

    // Initialize ResourceManager for external resources (Modrinth, CurseForge)
    app.manage(crate::resources::ResourceManager::new());
    app.manage(crate::launcher_import::ImportManager::new());

    crate::startup::updates::notify_current_version(app.handle().clone());

    crate::startup::resources::start_resource_watchers(app);

    crate::startup::processes::start(app.handle().clone());

    crate::startup::shell::initialize(app)?;

    crate::startup::metadata::submit_manifest_generation(app.handle().clone());
    crate::startup::accounts::validate_active_session(app.handle().clone());

    crate::startup::updates::schedule_update_check(app.handle().clone());

    Ok(())
}
