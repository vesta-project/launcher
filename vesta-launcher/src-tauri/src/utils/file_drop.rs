use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(serde::Serialize, Clone, Debug)]
pub struct SniffedPath {
    pub path: std::path::PathBuf,
    pub is_directory: bool,
}

/// Create the sniffer window (already visible, but off-screen)
#[tauri::command]
pub async fn create_file_drop_overlay(app_handle: AppHandle) -> Result<(), String> {
    if app_handle.get_webview_window("file-drop-overlay").is_some() {
        return Ok(());
    }

    let overlay = WebviewWindowBuilder::new(
        &app_handle,
        "file-drop-overlay",
        WebviewUrl::App("file-drop-overlay.html".into()),
    )
    .title("Vesta File Drop Sniffer")
    .transparent(true)
    .decorations(false)
    .shadow(false) // Disable shadow to prevent visible borders/glow on some platforms
    .always_on_top(true)
    .visible(true) // Always visible, just teleported off-screen
    .skip_taskbar(true)
    .fullscreen(false)
    .resizable(false)
    .position(-40000.0, -40000.0)
    .inner_size(1.0, 1.0)
    .build()
    .map_err(|e| format!("Failed to build overlay: {}", e))?;

    // Force off-screen position immediately after build to be safe
    let _ = overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: -40000,
        y: -40000,
    }));

    // On macOS, we also need to explicitly disable the shadow via private API or standard methods
    #[cfg(target_os = "macos")]
    let _ = overlay.set_has_shadow(false);

    #[cfg(target_os = "windows")]
    {
        let _ = overlay.set_effects(None);
    }

    let handle = app_handle.clone();
    let overlay_for_event = overlay.clone();
    overlay.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Enter { paths, .. }) => {
                log::debug!("[FileDrop-Rust] SNIFFED PATHS (Enter): {:?}", paths);
                emit_paths(&handle, paths);
            }
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                log::debug!("[FileDrop-Rust] SNIFFED PATHS (Drop): {:?}", paths);
                emit_paths(&handle, paths);
                let _ = handle.emit("vesta://hide-sniffer-request", ());
            }
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Leave) => {
                log::debug!("[FileDrop-Rust] Drag left sniffer");
                // Only request hide if the sniffer window is "on screen" (x >= 0)
                if let Ok(pos) = overlay_for_event.outer_position() {
                    if pos.x >= 0 {
                        let _ = handle.emit("vesta://hide-sniffer-request", ());
                    }
                }
            }
            tauri::WindowEvent::Focused(focused) => {
                if *focused {
                    log::debug!("[FileDrop-Rust] Sniffer focused");
                }
            }
            _ => {}
        }
    });

    Ok(())
}

fn emit_paths(handle: &AppHandle, paths: &Vec<std::path::PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let sniffed: Vec<SniffedPath> = paths
        .iter()
        .map(|p| SniffedPath {
            path: p.clone(),
            is_directory: p.is_dir(),
        })
        .collect();
    let _ = handle.emit("vesta://sniffed-file-drop", &sniffed);
}

/// "Teleport" the sniffer - INSTANT movement, no show/hide logic
#[tauri::command]
pub async fn position_overlay(
    app_handle: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if let Some(overlay) = app_handle.get_webview_window("file-drop-overlay") {
        // Teleport into place. We use Physical units to avoid DPI scaling issues in the bridge.
        let _ = overlay.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
        let _ = overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }
    Ok(())
}

/// Hide by teleporting off-screen - INSTANT
#[tauri::command]
pub async fn hide_overlay(app_handle: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app_handle.get_webview_window("file-drop-overlay") {
        // Teleport off-screen. NO hide() call to avoid 3s latency and white flashes.
        let _ = overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: -40000,
            y: -40000,
        }));
    }
    Ok(())
}

/// No-op for compatibility
#[tauri::command]
pub async fn show_overlay(_app_handle: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn reset_file_drop_sniffer(app_handle: AppHandle) -> Result<(), String> {
    let _ = hide_overlay(app_handle).await;
    Ok(())
}

// These are still needed for the overlay's internal script to report back
#[tauri::command]
pub async fn set_overlay_visual_state(_app_handle: AppHandle, _active: bool) -> Result<(), String> {
    Ok(())
}

pub fn handle_native_event(_handle: &AppHandle, _label: &str, _event: &tauri::WindowEvent) {
    // No-op, we are using the overlay window again
}

pub fn attach_file_drop_handler(_window: WebviewWindow) {
    // No-op
}
