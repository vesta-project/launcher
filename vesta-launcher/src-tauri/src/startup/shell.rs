use crate::utils::config::get_app_config;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::webview::Color;
use tauri::Manager;

pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let config = get_app_config()?;

    #[cfg(desktop)]
    if let Err(error) = sync_autostart(app.handle(), config.autostart_enabled) {
        log::warn!("Failed to sync autostart state with config: {}", error);
    }
    if let Err(error) = create_tray(app.handle(), config.show_tray_icon) {
        log::warn!("Failed to initialize tray: {}", error);
    }
    if let Err(error) = crate::commands::app::sync_tray_visibility_with_config(app.handle()) {
        log::warn!(
            "Failed to sync tray visibility with persisted config at startup: {}",
            error
        );
    }

    let window = build_main_window(app, os, &config)?;
    crate::commands::app::set_window_effect(window, "none".to_string()).unwrap_or(());

    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        crate::utils::launch_intents::ingest_launch_args(&args);
    }

    Ok(())
}

fn build_main_window(
    app: &mut tauri::App,
    os: &str,
    config: &crate::utils::config::AppConfig,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let bootstrap = serde_json::json!({
        "os": os,
        "config": config,
    });
    let initialization_script = format!(
        "window.__VESTA_OS__ = {os}; window.__VESTA_BOOTSTRAP__ = {bootstrap};",
        os = serde_json::to_string(os).expect("serialize startup OS"),
        bootstrap = serde_json::to_string(&bootstrap).expect("serialize startup snapshot"),
    );
    let builder =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .initialization_script(&initialization_script)
            .title("Vesta Launcher")
            .inner_size(
                config.last_window_width as f64,
                config.last_window_height as f64,
            )
            .min_inner_size(520_f64, 465_f64)
            .disable_drag_drop_handler()
            .visible(false)
            .transparent(true)
            .decorations(false)
            .background_color(Color(20, 20, 20, 255));

    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay);

    builder.build()
}

fn create_tray(
    app: &tauri::AppHandle,
    show_tray_icon: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "tray_show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray_hide", "Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let icon = app.default_window_icon().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "default window icon is missing",
        )
    })?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon.clone())
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
fn sync_autostart(app: &tauri::AppHandle, should_enable: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    let is_enabled = manager
        .is_enabled()
        .map_err(|error| format!("Failed to get autostart status: {}", error))?;
    if should_enable == is_enabled {
        return Ok(());
    }

    if should_enable {
        manager
            .enable()
            .map_err(|error| format!("Failed to enable autostart: {}", error))
    } else {
        manager
            .disable()
            .map_err(|error| format!("Failed to disable autostart: {}", error))
    }
}
