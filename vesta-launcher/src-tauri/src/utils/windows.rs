use std::collections::HashMap;
use std::sync::Mutex;
use winver::WindowsVersion;

static WINDOW_ID: Mutex<i32> = Mutex::new(0);

#[tauri::command]
pub async fn launch_new_window(
    app_handle: tauri::AppHandle,
    path: Option<String>,
    props: Option<HashMap<String, String>>,
    history: Option<String>,
) -> Result<(), tauri::Error> {
    let mut window_id = WINDOW_ID.lock().unwrap();

    // Build URL with path parameter for routing
    let url_path = path.unwrap_or_else(|| "/config".to_string());
    let mut url = format!("standalone?path={}", urlencoding::encode(&url_path));
    
    // Add props as URL parameters
    if let Some(props_map) = props {
        for (key, value) in props_map {
            url.push_str(&format!("&{}={}", urlencoding::encode(&key), urlencoding::encode(&value)));
        }
    }
    
    // Add history as URL parameter (as JSON string)
    if let Some(history_data) = history {
        url.push_str(&format!("&history={}", urlencoding::encode(&history_data)));
    }

    let win_builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        format!("page-viewer-{}", &window_id),
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Vesta Launcher - Page Viewer")
    .inner_size(900_f64, 600_f64)
    .min_inner_size(400_f64, 300_f64)
    .disable_drag_drop_handler() // Disable so overlay can capture drag events
    .transparent(true)
    .decorations(false);

    *window_id += 1;

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

    Ok(())
}
