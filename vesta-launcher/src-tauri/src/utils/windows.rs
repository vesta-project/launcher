use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use tauri::webview::Color;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct MiniWindowRegistryInner {
    next_window_id: u64,
    session_windows: HashMap<String, String>,
    idle_windows: VecDeque<String>,
    priming_windows: HashSet<String>,
    pending_payloads: HashMap<String, Value>,
}

#[derive(Default)]
pub struct MiniWindowRegistry {
    inner: Mutex<MiniWindowRegistryInner>,
}

impl MiniWindowRegistry {
    fn allocate_label(inner: &mut MiniWindowRegistryInner) -> String {
        let label = format!("page-viewer-{}", inner.next_window_id);
        inner.next_window_id += 1;
        label
    }

    fn reserve_idle_label(&self) -> Option<String> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.idle_windows.is_empty() || !inner.priming_windows.is_empty() {
            return None;
        }
        let label = Self::allocate_label(&mut inner);
        inner.priming_windows.insert(label.clone());
        Some(label)
    }

    fn register_idle(&self, label: String) {
        let mut inner = self.inner.lock().unwrap();
        inner.priming_windows.remove(&label);
        inner.idle_windows.push_back(label);
    }

    fn release_idle_reservation(&self, label: &str) {
        self.inner.lock().unwrap().priming_windows.remove(label);
    }

    fn claim_session(&self, session_id: String, payload: Value) -> (String, bool) {
        let mut inner = self.inner.lock().unwrap();
        let (label, needs_build) =
            if let Some(label) = inner.session_windows.get(&session_id).cloned() {
                (label, false)
            } else if let Some(label) = inner.idle_windows.pop_front() {
                inner.session_windows.insert(session_id, label.clone());
                (label, false)
            } else {
                let label = Self::allocate_label(&mut inner);
                inner.session_windows.insert(session_id, label.clone());
                (label, true)
            };
        inner.pending_payloads.insert(label.clone(), payload);
        (label, needs_build)
    }

    fn take_payload(&self, label: &str) -> Option<Value> {
        self.inner.lock().unwrap().pending_payloads.remove(label)
    }

    pub(crate) fn is_claimed(&self, label: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .session_windows
            .values()
            .any(|claimed_label| claimed_label == label)
    }
}

fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn build_mini_window(
    app_handle: &tauri::AppHandle,
    label: &str,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let config = crate::utils::config::get_app_config().unwrap_or_default();
    let bootstrap = serde_json::json!({
        "os": os_name(),
        "config": config,
    });
    let initialization_script = format!(
        "window.__VESTA_OS__ = {os}; window.__VESTA_BOOTSTRAP__ = {bootstrap};",
        os = serde_json::to_string(os_name()).expect("serialize mini-window OS"),
        bootstrap = serde_json::to_string(&bootstrap).expect("serialize mini-window snapshot"),
    );

    let win_builder = tauri::WebviewWindowBuilder::new(
        app_handle,
        label,
        tauri::WebviewUrl::App("standalone.html".into()),
    )
    .initialization_script(&initialization_script)
    .title("Vesta Launcher - Page Viewer")
    .inner_size(900_f64, 600_f64)
    .min_inner_size(400_f64, 300_f64)
    .disable_drag_drop_handler()
    .visible(false)
    .transparent(true)
    .decorations(false)
    .background_color(Color(20, 20, 20, 255));

    #[cfg(target_os = "macos")]
    let win_builder = win_builder
        .decorations(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay);

    let window = win_builder.build()?;
    crate::commands::app::set_window_effect(window.clone(), "none".to_string()).unwrap_or(());
    Ok(window)
}

#[tauri::command]
pub async fn prime_mini_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let registry = app_handle.state::<MiniWindowRegistry>();
    let Some(label) = registry.reserve_idle_label() else {
        return Ok(());
    };

    if app_handle.get_webview_window(&label).is_none() {
        if let Err(error) = build_mini_window(&app_handle, &label) {
            registry.release_idle_reservation(&label);
            return Err(format!("Failed to prime mini window: {error}"));
        }
    }
    registry.register_idle(label);
    Ok(())
}

#[tauri::command]
pub async fn launch_window(
    app_handle: tauri::AppHandle,
    session_id: String,
    payload: Value,
) -> Result<String, String> {
    let registry = app_handle.state::<MiniWindowRegistry>();
    let (label, mut needs_build) = registry.claim_session(session_id, payload);
    if app_handle.get_webview_window(&label).is_none() {
        needs_build = true;
    }

    if needs_build {
        build_mini_window(&app_handle, &label)
            .map_err(|error| format!("Failed to create mini window: {error}"))?;
    } else {
        app_handle
            .emit_to(&label, "core://mini-window-open", ())
            .map_err(|error| format!("Failed to notify reusable mini window: {error}"))?;
    }

    Ok(label)
}

#[tauri::command]
pub fn take_mini_window_payload(window: tauri::WebviewWindow) -> Option<Value> {
    window
        .state::<MiniWindowRegistry>()
        .take_payload(window.label())
}

#[tauri::command]
pub fn hide_mini_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("page-viewer-") {
        return Err("Only mini windows can use the reusable hide lifecycle".to_string());
    }
    window
        .hide()
        .map_err(|error| format!("Failed to hide mini window: {error}"))
}

/// Ensure the main window is visible and focused (used by deep-links / CLI)
pub fn ensure_main_window_visible(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .show()
            .map_err(|e| format!("Failed to show window: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus window: {}", e))?;

        if let Err(e) = crate::commands::app::sync_tray_visibility_with_config(app) {
            log::warn!(
                "Failed to sync tray visibility after showing main window: {}",
                e
            );
        }

        Ok(())
    } else {
        Err("Main window not found".to_string())
    }
}

/// Set Windows-level GPU preference for a specific executable
/// Uses the DirectX UserGpuPreferences registry key to force "High Performance"
#[cfg(target_os = "windows")]
pub fn set_windows_gpu_preference(executable_path: &std::path::Path) -> Result<(), anyhow::Error> {
    let path_str = executable_path.to_string_lossy();

    log::info!(
        "Setting Windows GPU preference to High Performance for: {}",
        path_str
    );

    let output = std::process::Command::new("reg")
        .args([
            "add",
            "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
            "/v",
            &path_str,
            "/t",
            "REG_SZ",
            "/d",
            "GpuPreference=2;",
            "/f",
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("Failed to set Windows GPU preference: {}", stderr);
        anyhow::bail!("Registry update failed: {}", stderr);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::MiniWindowRegistry;
    use serde_json::json;

    #[test]
    fn reuses_a_window_for_the_same_logical_session() {
        let registry = MiniWindowRegistry::default();
        let (first_label, first_needs_build) =
            registry.claim_session("settings".to_string(), json!({"tab": "general"}));
        let (second_label, second_needs_build) =
            registry.claim_session("settings".to_string(), json!({"tab": "appearance"}));

        assert_eq!(first_label, second_label);
        assert!(first_needs_build);
        assert!(!second_needs_build);
        assert_eq!(
            registry.take_payload(&first_label),
            Some(json!({"tab": "appearance"}))
        );
    }

    #[test]
    fn assigns_distinct_windows_to_concurrent_sessions() {
        let registry = MiniWindowRegistry::default();
        let (settings_label, _) =
            registry.claim_session("settings".to_string(), json!({"path": "/config"}));
        let (instance_label, _) =
            registry.claim_session("instance:7".to_string(), json!({"path": "/instance"}));

        assert_ne!(settings_label, instance_label);
    }

    #[test]
    fn claims_a_prepared_window_without_rebuilding_it() {
        let registry = MiniWindowRegistry::default();
        let idle_label = registry.reserve_idle_label().expect("reserve idle label");
        assert!(
            registry.reserve_idle_label().is_none(),
            "only one idle window should be primed at once"
        );
        registry.register_idle(idle_label.clone());
        assert!(!registry.is_claimed(&idle_label));

        let (claimed_label, needs_build) =
            registry.claim_session("settings".to_string(), json!({}));

        assert_eq!(claimed_label, idle_label);
        assert!(!needs_build);
        assert!(registry.is_claimed(&claimed_label));
    }
}
