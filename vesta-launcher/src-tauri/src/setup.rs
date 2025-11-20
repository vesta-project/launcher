use tauri::Manager;
use winver::WindowsVersion;
use crate::utils::db_manager::{get_config_db, get_data_db};
use crate::tasks::manager::TaskManager;
use crate::notifications::manager::NotificationManager;

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize NotificationManager
    let notification_manager = NotificationManager::new(app.handle().clone());
    app.manage(notification_manager);

    // Initialize TaskManager
    let task_manager = TaskManager::new(app.handle().clone());
    app.manage(task_manager);

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

    let win_builder = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
        .title("Vesta Launcher")
        .inner_size(1200_f64, 700_f64)
        .min_inner_size(520_f64, 465_f64)
        .disable_drag_drop_handler()  // Disable so overlay can capture drag events
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
    }
    else if version.major == 6 && version.minor == 1 {
        // On windows 7
        win_builder.effects(
            tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::Blur)
                .build(),
        )
    }
    else {
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
            .build()
    );

    win_builder.build()?;
    
    // File drop overlay disabled for now
    // let app_handle = app.handle().clone();
    // if let Err(e) = tauri::async_runtime::block_on(create_file_drop_overlay(app_handle)) {
    //     eprintln!("Failed to create file drop overlay: {}", e);
    // }
    
    Ok(())
}
