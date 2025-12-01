use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Creates the file drop overlay window (transparent, always-on-top)
#[tauri::command]
pub async fn create_file_drop_overlay(app_handle: AppHandle) -> Result<(), String> {
    // Check if overlay already exists
    if app_handle.get_webview_window("file-drop-overlay").is_some() {
        log::debug!("File drop overlay already exists");
        return Ok(());
    }

    log::debug!("Creating file drop overlay window");

    // Create a full-screen invisible overlay window with file drop enabled
    // It will stay invisible until drag is detected, then show visual feedback
    // The native file drop handler is enabled so it can receive dropped files
    WebviewWindowBuilder::new(
        &app_handle,
        "file-drop-overlay",
        WebviewUrl::App("file-drop-overlay.html".into()),
    )
    .title("File Drop Overlay")
    .inner_size(9999.0, 9999.0) // Start full-screen to capture all drags
    .position(0.0, 0.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false) // But keep invisible until drag starts
    // Note: We do NOT disable the drag drop handler here, so it can receive native events
    .build()
    .map_err(|e| {
        log::error!("Failed to create file drop overlay: {}", e);
        format!("Failed to create overlay: {}", e)
    })?;

    log::debug!("File drop overlay created successfully");
    Ok(())
}

/// Position and show the overlay window over a drop zone
#[tauri::command]
pub async fn position_overlay(
    app_handle: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    log::debug!(
        "Positioning overlay at ({}, {}) with size {}x{}",
        x,
        y,
        width,
        height
    );

    let overlay = app_handle
        .get_webview_window("file-drop-overlay")
        .ok_or("Overlay window not found")?;

    overlay
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| format!("Failed to set position: {}", e))?;

    overlay
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| format!("Failed to set size: {}", e))?;

    Ok(())
}

/// Show the overlay window
#[tauri::command]
pub async fn show_overlay(app_handle: AppHandle) -> Result<(), String> {
    log::debug!("Showing overlay");

    let overlay = app_handle
        .get_webview_window("file-drop-overlay")
        .ok_or("Overlay window not found")?;

    overlay
        .show()
        .map_err(|e| format!("Failed to show overlay: {}", e))?;

    Ok(())
}

/// Hide the overlay window
#[tauri::command]
pub async fn hide_overlay(app_handle: AppHandle) -> Result<(), String> {
    log::debug!("Hiding overlay");

    let overlay = app_handle
        .get_webview_window("file-drop-overlay")
        .ok_or("Overlay window not found")?;

    overlay
        .hide()
        .map_err(|e| format!("Failed to hide overlay: {}", e))?;

    Ok(())
}

/// Set the visual state of the overlay
#[tauri::command]
pub async fn set_overlay_visual_state(
    app_handle: AppHandle,
    background_color: String,
    border_color: String,
    border_radius: String,
    outline: String,
    opacity: String,
) -> Result<(), String> {
    log::debug!("Setting overlay visual state");

    let overlay = app_handle
        .get_webview_window("file-drop-overlay")
        .ok_or("Overlay window not found")?;

    overlay
        .emit(
            "vesta://visual-state",
            serde_json::json!({
                "backgroundColor": background_color,
                "borderColor": border_color,
                "borderRadius": border_radius,
                "outline": outline,
                "opacity": opacity
            }),
        )
        .map_err(|e| format!("Failed to emit visual state: {}", e))?;

    Ok(())
}

/// Get the overlay window handle
pub fn get_overlay_window(app_handle: &AppHandle) -> Option<tauri::WebviewWindow> {
    app_handle.get_webview_window("file-drop-overlay")
}
