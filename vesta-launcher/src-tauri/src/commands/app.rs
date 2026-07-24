use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use crate::utils::db_manager::get_app_config_dir;
use crate::utils::dialog_manager::{DialogAction, DialogManager, DialogRequest, DialogSeverity};
use crate::utils::storage::{self, StorageSnapshot};
use tauri::Emitter;
use tauri::Manager;

#[tauri::command]
pub async fn test_blocking_dialog(
    app_handle: tauri::AppHandle,
    dialog_manager: tauri::State<'_, DialogManager>,
) -> Result<String, String> {
    let request = DialogRequest {
        id: uuid::Uuid::new_v4(),
        title: "Backend Blocking Test".to_string(),
        description: Some(
            "This dialog was triggered by the backend! Do you want to continue?".to_string(),
        ),
        severity: DialogSeverity::Question,
        actions: vec![
            DialogAction {
                id: "no".to_string(),
                label: "No, Stop!".to_string(),
                color: Some("none".to_string()),
                variant: Some("ghost".to_string()),
            },
            DialogAction {
                id: "yes".to_string(),
                label: "Yes, Proceed".to_string(),
                color: Some("primary".to_string()),
                variant: Some("solid".to_string()),
            },
        ],
        input: None,
    };

    let response = dialog_manager
        .show_dialog(&app_handle, request)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("User chose: {}", response.action_id))
}

#[tauri::command]
pub async fn exit_check(
    task_manager: tauri::State<'_, crate::tasks::manager::TaskManager>,
) -> Result<ExitCheckResponse, String> {
    let mut response = ExitCheckResponse {
        can_exit: true,
        blocking_tasks: Vec::new(),
        running_instances: Vec::new(),
    };

    // 1. Check for running game instances
    match piston_lib::game::launcher::get_running_instances().await {
        Ok(instances) => {
            if !instances.is_empty() {
                response.can_exit = false;
                response.running_instances = instances.into_iter().map(|i| i.instance_id).collect();
            }
        }
        Err(e) => {
            log::error!("Error checking running instances: {}", e);
        }
    }

    // 2. Check for active tasks
    let active_tasks = task_manager.get_active_tasks();
    if !active_tasks.is_empty() {
        response.can_exit = false;
        response.blocking_tasks = active_tasks;
    }

    Ok(response)
}

#[derive(serde::Serialize)]
pub struct ExitCheckResponse {
    pub can_exit: bool,
    pub blocking_tasks: Vec<String>,
    pub running_instances: Vec<String>,
}

#[tauri::command]
pub fn open_app_config_dir() -> Result<(), String> {
    let config_path = get_app_config_dir().map_err(|e| e.to_string())?;

    // Determine directory to open: if the path is a file, open its parent directory
    let dir_to_open = if config_path.is_dir() {
        config_path.clone()
    } else if config_path.is_file() {
        config_path
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("No parent directory for path: {:?}", config_path))?
    } else {
        // Path does not exist
        return Err(format!("Path does not exist: {:?}", config_path));
    };

    // Use open crate to open directory in file explorer
    open::that(&dir_to_open)
        .map_err(|e| format!("Failed to open directory: {} (path: {:?})", e, dir_to_open))?;
    Ok(())
}

#[tauri::command]
pub fn open_app_runtime_storage_dir(app_handle: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve app cache directory: {}", e))?;

    std::fs::create_dir_all(&cache_dir).map_err(|e| {
        format!(
            "Failed to create cache directory: {} (path: {:?})",
            e, cache_dir
        )
    })?;

    let mut dir_to_open = cache_dir.clone();

    if let Ok(log_dir) = app_handle.path().app_log_dir() {
        if let Err(e) = std::fs::create_dir_all(&log_dir) {
            log::warn!(
                "Failed to create log directory before opening runtime storage: {} (path: {:?})",
                e,
                log_dir
            );
        }

        if let (Some(cache_parent), Some(log_parent)) = (cache_dir.parent(), log_dir.parent()) {
            if cache_parent == log_parent {
                dir_to_open = cache_parent.to_path_buf();
            }
        }
    }

    open::that(&dir_to_open).map_err(|e| {
        format!(
            "Failed to open runtime storage directory: {} (path: {:?})",
            e, dir_to_open
        )
    })?;

    Ok(())
}

#[tauri::command]
pub fn open_instance_folder(instance_id_slug: String) -> Result<(), String> {
    use crate::schema::instance::dsl::*;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    let instances_list = instance
        .select((crate::schema::instance::dsl::id, name, game_directory))
        .load::<(i32, String, Option<String>)>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    let found_dir = instances_list.into_iter().find_map(|(_id, _name, _gd)| {
        let i_slug = crate::utils::sanitize::sanitize_instance_name(&_name);
        if i_slug == instance_id_slug {
            _gd
        } else {
            None
        }
    });

    if let Some(gd) = found_dir {
        let path = std::path::PathBuf::from(gd);
        if !path.exists() {
            std::fs::create_dir_all(&path)
                .map_err(|e| format!("Failed to create instance directory: {}", e))?;
        }
        open::that(&path).map_err(|e| format!("Failed to open instance directory: {}", e))?;
        Ok(())
    } else {
        Err("Instance not found".to_string())
    }
}

#[tauri::command]
pub fn open_logs_folder(instance_id_slug: Option<String>) -> Result<(), String> {
    let logs_path = if let Some(slug_val) = instance_id_slug {
        // Fetch instance from database to get its game directory
        // We use the slug directly as that's what we expect, but we also check for matching name
        // actually open_logs_folder usually receives the slug (instance_id) from frontend

        use crate::schema::instance::dsl::*;
        use crate::utils::db::get_vesta_conn;
        use diesel::prelude::*;

        let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

        // Try to find by direct slug comparison (logic: iterate and check slug because slug is not in DB)
        // Or simpler: Just construct the path from config dir + instances + slug,
        // because that IS the game directory structure we enforce now.
        // However, `game_directory` column exists.

        let instances_list = instance
            .select((crate::schema::instance::dsl::id, name, game_directory))
            .load::<(i32, String, Option<String>)>(&mut conn)
            .map_err(|e| format!("Failed to query instances: {}", e))?;

        let found_dir = instances_list.into_iter().find_map(|(_id, _name, _gd)| {
            let i_slug = crate::utils::sanitize::sanitize_instance_name(&_name);
            if i_slug == slug_val {
                _gd
            } else {
                None
            }
        });

        if let Some(gd) = found_dir {
            std::path::PathBuf::from(gd).join("logs")
        } else {
            // Fallback: assume standard path
            let config_dir =
                crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            config_dir.join("instances").join(&slug_val).join("logs")
        }
    } else {
        crate::utils::db_manager::get_launcher_log_dir().map_err(|e| e.to_string())?
    };

    if let Some(parent) = logs_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create logs directory: {}", e))?;
        }
    }
    if !logs_path.exists() {
        std::fs::create_dir_all(&logs_path)
            .map_err(|e| format!("Failed to create logs directory: {}", e))?;
    }

    // Open logs directory in file explorer
    open::that(&logs_path).map_err(|e| {
        format!(
            "Failed to open logs directory: {} (path: {:?})",
            e, logs_path
        )
    })?;
    Ok(())
}

#[tauri::command]
pub async fn clear_cache(
    app_handle: tauri::AppHandle,
    resource_manager: tauri::State<'_, crate::resources::ResourceManager>,
    metadata_cache: tauri::State<'_, crate::metadata_cache::MetadataCache>,
) -> Result<(), String> {
    log::info!("[clear_cache] Starting cache cleanup...");

    // 1. Clear resource manager (mod metadata, etc.)
    if let Err(e) = resource_manager.clear_cache().await {
        log::error!("Failed to clear resource cache: {}", e);
        // We'll proceed with other clear steps anyway
    }

    // 2. Clear in-memory Piston metadata
    metadata_cache.clear();

    // 3. Clear cache targets defined by the shared storage policy.
    if let Ok(config_dir) = get_app_config_dir() {
        let clear_targets = storage::cache_clear_targets();
        let paths = storage::unique_storage_paths_for_targets_with_runtime(
            &app_handle,
            &config_dir,
            &clear_targets,
        );

        for path in paths {
            let path_for_task = path.clone();
            if let Err(error) =
                tokio::task::spawn_blocking(move || storage::clear_storage_path(&path_for_task))
                    .await
                    .map_err(|e| format!("spawn_blocking panicked: {}", e))?
            {
                log::warn!("Failed to clear storage path {:?}: {}", path, error);
            } else {
                log::info!("Cleared storage path {:?}", path);
            }
        }
    }

    storage::invalidate_storage_snapshot_cache();
    let _ = app_handle.emit("storage-snapshot-invalidated", ());

    log::info!("[clear_cache] Cache cleanup complete!");
    Ok(())
}

#[tauri::command]
pub async fn get_storage_snapshot(
    app_handle: tauri::AppHandle,
    force_refresh: Option<bool>,
) -> Result<StorageSnapshot, String> {
    let app = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
        storage::collect_storage_snapshot_cached(&app, &config, force_refresh.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("spawn_blocking panicked: {}", e))?
}

#[tauri::command]
pub async fn prune_storage_cache(app_handle: tauri::AppHandle) -> Result<StorageSnapshot, String> {
    let app = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
        storage::enforce_governed_cache_limit(&app, &config)?;
        storage::collect_storage_snapshot_cached(&app, &config, true)
    })
    .await
    .map_err(|e| format!("spawn_blocking panicked: {}", e))?
}

#[tauri::command]
pub async fn get_cache_size(app_handle: tauri::AppHandle) -> Result<String, String> {
    let snapshot = get_storage_snapshot(app_handle, Some(false)).await?;
    Ok(format_size(snapshot.total_bytes))
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} bytes", bytes)
    }
}

#[tauri::command]
pub fn restart_app(app_handle: tauri::AppHandle) {
    app_handle.restart();
}

#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
pub fn close_all_windows_and_reset(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Get all webview windows
    let windows: Vec<_> = app_handle
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label != "main")
        .collect();

    // Close all windows except main
    for (_, window) in windows {
        let _ = window.close();
    }

    // Navigate main window to init page
    if let Some(main_window) = app_handle.get_webview_window("main") {
        let _ = main_window.eval("window.location.href = '/'");
    }

    Ok(())
}

#[tauri::command]
pub fn get_default_instance_dir() -> Result<String, String> {
    let config_dir = get_app_config_dir().map_err(|e| e.to_string())?;
    Ok(config_dir.join("instances").to_string_lossy().to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub fn get_network_status(
    network_manager: tauri::State<'_, crate::utils::network::NetworkManager>,
) -> crate::utils::network::NetworkStatus {
    network_manager.get_status()
}

#[tauri::command]
pub async fn set_network_status(
    status: crate::utils::network::NetworkStatus,
    network_manager: tauri::State<'_, crate::utils::network::NetworkManager>,
) -> Result<(), String> {
    if status == crate::utils::network::NetworkStatus::Online {
        let actual = network_manager.verify_online().await;
        network_manager.set_status(actual);
    } else {
        network_manager.set_status(status);
    }
    Ok(())
}

#[tauri::command]
pub async fn refresh_network_status(
    network_manager: tauri::State<'_, crate::utils::network::NetworkManager>,
) -> Result<crate::utils::network::NetworkStatus, String> {
    let status = network_manager.verify_online().await;
    network_manager.set_status(status);
    Ok(status)
}

#[derive(serde::Deserialize)]
pub struct ProxyTestInput {
    pub enabled: bool,
    pub url: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ProxyTestResult {
    pub ok: bool,
    pub status: crate::utils::network::NetworkStatus,
    pub message: String,
    pub detail: Option<String>,
}

fn redact_proxy_test_message(message: &str, proxy_url: Option<&str>) -> String {
    let redacted = piston_lib::client::redact_configured_proxy_secrets(message);
    if let Some(proxy_url) = proxy_url {
        redacted.replace(proxy_url, &piston_lib::client::redact_proxy_url(proxy_url))
    } else {
        redacted
    }
}

#[tauri::command]
pub async fn test_proxy_connection(input: ProxyTestInput) -> Result<ProxyTestResult, String> {
    let proxy_url = if input.enabled {
        let url = input
            .url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .ok_or_else(|| "Proxy URL is required when proxy is enabled".to_string())?;
        piston_lib::client::validate_proxy_url(url)?;
        Some(url.to_string())
    } else {
        None
    };

    let client =
        piston_lib::client::build_client_with_proxy(proxy_url.as_deref()).map_err(|e| {
            format!(
                "Failed to build HTTP client: {}",
                redact_proxy_test_message(&e.to_string(), proxy_url.as_deref())
            )
        })?;
    let endpoints = [
        "https://api.modrinth.com/v2/tag/game_version",
        "https://aka.ms",
    ];
    let timeout = std::time::Duration::from_secs(8);
    let mut last_error: Option<(String, String)> = None;

    for endpoint in endpoints {
        match client.get(endpoint).timeout(timeout).send().await {
            Ok(response)
                if response.status().is_success() || response.status().is_redirection() =>
            {
                return Ok(ProxyTestResult {
                    ok: true,
                    status: crate::utils::network::NetworkStatus::Online,
                    message: "Proxy connection works".to_string(),
                    detail: None,
                });
            }
            Ok(response) => {
                log::warn!(
                    "Proxy test endpoint {} returned HTTP {}",
                    endpoint,
                    response.status()
                );
            }
            Err(e) => {
                let redacted_error =
                    redact_proxy_test_message(&e.to_string(), proxy_url.as_deref());
                log::warn!(
                    "Proxy test endpoint {} failed: {}",
                    endpoint,
                    redacted_error
                );
                last_error = Some((endpoint.to_string(), redacted_error));
            }
        }
    }

    if let Some((endpoint, error)) = last_error {
        let lower = error.to_ascii_lowercase();
        if lower.contains("certificate")
            || lower.contains("cert")
            || lower.contains("unknown issuer")
            || lower.contains("invalid peer")
        {
            return Ok(ProxyTestResult {
                ok: false,
                status: crate::utils::network::NetworkStatus::Offline,
                message: "Proxy connection failed".to_string(),
                detail: Some(
                    "TLS verification failed. For HTTPS inspection proxies like mitmproxy, trust the proxy CA certificate and restart Vesta Launcher."
                        .to_string(),
                ),
            });
        }

        log::warn!("Proxy test failed after checking {}: {}", endpoint, error);
        return Ok(ProxyTestResult {
            ok: false,
            status: crate::utils::network::NetworkStatus::Offline,
            message: "Proxy connection failed".to_string(),
            detail: Some("No test endpoint could be reached. See logs for details.".to_string()),
        });
    }

    Ok(ProxyTestResult {
        ok: false,
        status: crate::utils::network::NetworkStatus::Offline,
        message: "Proxy connection failed".to_string(),
        detail: Some("No test endpoint could be reached. See logs for details.".to_string()),
    })
}

#[tauri::command]
pub fn get_tray_settings() -> Result<TraySettings, String> {
    let config = crate::utils::config::get_app_config()
        .map_err(|e| format!("Failed to get config: {}", e))?;

    Ok(TraySettings {
        show_tray_icon: config.show_tray_icon,
        minimize_to_tray: config.minimize_to_tray,
        default_launcher_action_on_launch: config.default_launcher_action_on_launch,
    })
}

#[tauri::command]
pub fn set_tray_icon_visibility(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    crate::utils::config::update_config_field(
        app.clone(),
        "show_tray_icon".to_string(),
        serde_json::json!(visible),
    )
    .map_err(|e| format!("Failed to update tray icon visibility: {}", e))?;

    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_visible(visible)
            .map_err(|e| format!("Failed to apply tray icon visibility: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_minimize_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    crate::utils::config::update_config_field(
        app,
        "minimize_to_tray".to_string(),
        serde_json::json!(enabled),
    )
    .map_err(|e| format!("Failed to update minimize to tray setting: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn show_window_from_tray(app: tauri::AppHandle) -> Result<(), String> {
    crate::utils::windows::ensure_main_window_visible(&app)?;
    Ok(())
}

#[tauri::command]
pub fn present_window_when_ready(
    window: tauri::WebviewWindow,
    label: String,
) -> Result<(), String> {
    if window.label() != label {
        return Err("Window readiness label did not match the calling window".to_string());
    }

    window
        .show()
        .map_err(|error| format!("Failed to show ready window: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Failed to focus ready window: {error}"))?;

    if label == "main" {
        if let Err(error) = sync_tray_visibility_with_config(window.app_handle()) {
            log::warn!("Failed to sync tray after presenting main window: {error}");
        }
    }

    Ok(())
}

#[tauri::command]
pub fn clear_window_startup_background(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_background_color(None)
        .map_err(|e| format!("Failed to clear startup background: {}", e))
}

pub fn sync_tray_visibility_with_config(app: &tauri::AppHandle) -> Result<(), String> {
    let config = crate::utils::config::get_app_config()
        .map_err(|e| format!("Failed to get config for tray visibility sync: {}", e))?;

    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_visible(config.show_tray_icon)
            .map_err(|e| format!("Failed to sync tray icon visibility: {}", e))?;
    }

    Ok(())
}

pub fn request_guarded_exit(app_handle: &tauri::AppHandle, source: &str) -> Result<(), String> {
    log::info!("Requesting guarded exit from source: {}", source);
    let _ = crate::utils::windows::ensure_main_window_visible(app_handle);
    app_handle
        .emit("core://exit-requested", ())
        .map_err(|e| format!("Failed to emit guarded exit request: {}", e))
}

#[derive(serde::Serialize)]
pub struct TraySettings {
    pub show_tray_icon: bool,
    pub minimize_to_tray: bool,
    pub default_launcher_action_on_launch: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DeepLinkTarget {
    Install,
    ResourceDetails,
    Home,
    LaunchInstance,
    OpenInstance,
    Navigate,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct DeepLinkMetadata {
    pub target: DeepLinkTarget,
    pub params: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub fn parse_vesta_url(url: String) -> Result<DeepLinkMetadata, String> {
    use url::Url;
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    if parsed_url.scheme() != "vesta" {
        return Err("Invalid protocol".to_string());
    }

    let action = parsed_url.host_str().unwrap_or("");
    let mut params = std::collections::HashMap::new();

    // Collect query parameters
    for (key, value) in parsed_url.query_pairs() {
        params.insert(key.into_owned(), value.into_owned());
    }

    // Capture segments from path if any
    let segments: Vec<&str> = parsed_url
        .path_segments()
        .map(|s| s.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();

    // Legacy copy-link format: vesta:///instance?path=%2Finstance&slug=...
    if let Some(path) = params.get("path").cloned() {
        params.remove("path");
        return map_legacy_path_navigation(path, params);
    }

    match action {
        "install" => Ok(DeepLinkMetadata {
            target: DeepLinkTarget::Install,
            params,
        }),
        "home" => Ok(DeepLinkMetadata {
            target: DeepLinkTarget::Home,
            params,
        }),
        "launch-instance" => {
            if let Some(slug) = segments.first() {
                params.insert("slug".to_string(), (*slug).to_string());
            }
            require_param(&params, "slug", "launch-instance")?;
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::LaunchInstance,
                params,
            })
        }
        "open-instance" => {
            if let Some(slug) = segments.first() {
                params.insert("slug".to_string(), (*slug).to_string());
            }
            require_param(&params, "slug", "open-instance")?;
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::OpenInstance,
                params,
            })
        }
        "standalone" => {
            let resource_type = params.get("type").map(|s| s.as_str()).unwrap_or("");
            if resource_type == "modpack" {
                Ok(DeepLinkMetadata {
                    target: DeepLinkTarget::Install,
                    params,
                })
            } else {
                Ok(DeepLinkMetadata {
                    target: DeepLinkTarget::ResourceDetails,
                    params,
                })
            }
        }
        "open-resource" => {
            if let Some(platform) = segments.first() {
                params.insert("platform".to_string(), (*platform).to_string());
            }
            if let Some(project_id) = segments.get(1) {
                params.insert("projectId".to_string(), (*project_id).to_string());
            }
            require_param(&params, "platform", "open-resource")?;
            require_param(&params, "projectId", "open-resource")?;
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::ResourceDetails,
                params,
            })
        }
        _ => Err(format!("Unknown action: {}", action)),
    }
}

fn require_param(
    params: &std::collections::HashMap<String, String>,
    key: &str,
    action: &str,
) -> Result<(), String> {
    if params.get(key).is_some_and(|value| !value.is_empty()) {
        Ok(())
    } else {
        Err(format!("Missing {} for {}", key, action))
    }
}

fn is_allowed_navigate_path(path: &str) -> bool {
    matches!(
        path,
        "/config"
            | "/changelog"
            | "/install"
            | "/install/source"
            | "/install/import"
            | "/modding-guide"
            | "/resources"
            | "/login"
            | "/file-drop"
    )
}

fn map_legacy_path_navigation(
    path: String,
    mut params: std::collections::HashMap<String, String>,
) -> Result<DeepLinkMetadata, String> {
    match path.as_str() {
        "/instance" => {
            require_param(&params, "slug", "instance navigation")?;
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::OpenInstance,
                params,
            })
        }
        "/resource-details" => Ok(DeepLinkMetadata {
            target: DeepLinkTarget::ResourceDetails,
            params,
        }),
        "/install" => Ok(DeepLinkMetadata {
            target: DeepLinkTarget::Install,
            params,
        }),
        allowed if is_allowed_navigate_path(allowed) => Ok(DeepLinkMetadata {
            target: DeepLinkTarget::Navigate,
            params: {
                params.insert("path".to_string(), path);
                params
            },
        }),
        _ => Err(format!("Unsupported navigation path: {}", path)),
    }
}

#[tauri::command]
pub fn get_window_effect_capabilities() -> crate::utils::window_effects::WindowEffectCapabilities {
    crate::utils::window_effects::get_window_effect_capabilities()
}

fn notify_unsupported_window_effect(
    app_handle: &tauri::AppHandle,
    requested_effect: &str,
    active_effect: &str,
    os: &str,
    os_version: Option<&str>,
) {
    let manager = app_handle.state::<NotificationManager>();
    let version_suffix = os_version
        .map(|value| format!(" ({})", value))
        .unwrap_or_default();

    let _ = manager.create(CreateNotificationInput {
        client_key: Some(format!(
            "window_effect_unsupported_{}_{}",
            os, requested_effect
        )),
        title: Some("Window effect unavailable on this OS".to_string()),
        description: Some(format!(
            "The '{}' window effect is not supported on {}{}. Falling back to '{}'.",
            requested_effect, os, version_suffix, active_effect
        )),
        severity: Some("warning".to_string()),
        notification_type: Some(NotificationType::Immediate),
        dismissible: Some(true),
        persist: Some(false),
        silent: Some(false),
        progress: None,
        current_step: None,
        total_steps: None,
        actions: None,
        metadata: None,
        show_on_completion: None,
    });
}

#[tauri::command]
pub fn set_window_effect(window: tauri::WebviewWindow, effect: String) -> Result<(), String> {
    let app_handle = window.app_handle();
    let capabilities = crate::utils::window_effects::get_window_effect_capabilities();
    let (active_effect, was_coerced) =
        crate::utils::window_effects::normalize_window_effect(&effect, &capabilities);

    if was_coerced {
        notify_unsupported_window_effect(
            &app_handle,
            effect.as_str(),
            active_effect.as_str(),
            capabilities.os.as_str(),
            capabilities.os_version.as_deref(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{
            apply_acrylic, apply_blur, apply_mica, clear_acrylic, clear_blur, clear_mica,
        };

        if let Err(err) = clear_blur(&window) {
            log::warn!("Failed to clear blur window effect: {}", err);
        }
        if let Err(err) = clear_acrylic(&window) {
            log::warn!("Failed to clear acrylic window effect: {}", err);
        }
        if let Err(err) = clear_mica(&window) {
            log::warn!("Failed to clear mica window effect: {}", err);
        }

        let apply_result = match active_effect.as_str() {
            "blur" => apply_blur(&window, Some((18, 18, 18, 125))),
            "acrylic" => apply_acrylic(&window, Some((18, 18, 18, 125))),
            "mica" => apply_mica(&window, Some(true)),
            _ => Ok(()),
        };

        if let Err(err) = apply_result {
            let message = format!(
                "Failed to apply window effect '{}' (requested '{}'): {}",
                active_effect, effect, err
            );
            log::error!("{}", message);
            return Err(message);
        }
    }

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{
            apply_liquid_glass, apply_vibrancy, clear_liquid_glass, clear_vibrancy,
            NSGlassEffectViewStyle, NSVisualEffectMaterial,
        };

        if let Err(err) = clear_vibrancy(&window) {
            log::warn!("Failed to clear vibrancy window effect: {}", err);
        }
        if let Err(err) = clear_liquid_glass(&window) {
            log::warn!("Failed to clear liquid_glass window effect: {}", err);
        }

        let radius = if active_effect.as_str() == "liquid_glass" {
            16.0
        } else {
            10.0
        };

        let apply_result = match active_effect.as_str() {
            "vibrancy" => apply_vibrancy(
                &window,
                NSVisualEffectMaterial::HudWindow,
                None,
                Some(radius),
            ),
            "liquid_glass" => {
                apply_liquid_glass(&window, NSGlassEffectViewStyle::Clear, None, Some(radius))
            }
            _ => Ok(()),
        };

        if let Err(err) = apply_result {
            let message = format!(
                "Failed to apply window effect '{}' (requested '{}'): {}",
                active_effect, effect, err
            );
            log::error!("{}", message);
            return Err(message);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn trigger_test_panic() -> Result<(), String> {
    panic!("Test Sentry Backend Panic - Triggered by developer test button. Check Sentry dashboard to verify capture.");
}

#[cfg(test)]
mod parse_vesta_url_tests {
    use super::*;

    #[test]
    fn parses_install_links() {
        let result = parse_vesta_url("vesta://install?projectId=abc&platform=modrinth".to_string())
            .expect("install link should parse");
        assert_eq!(result.target, DeepLinkTarget::Install);
        assert_eq!(
            result.params.get("projectId").map(String::as_str),
            Some("abc")
        );
        assert_eq!(
            result.params.get("platform").map(String::as_str),
            Some("modrinth")
        );
    }

    #[test]
    fn parses_open_resource_links() {
        let result = parse_vesta_url("vesta://open-resource/modrinth/fabric-api".to_string())
            .expect("open-resource");
        assert_eq!(result.target, DeepLinkTarget::ResourceDetails);
        assert_eq!(
            result.params.get("platform").map(String::as_str),
            Some("modrinth")
        );
        assert_eq!(
            result.params.get("projectId").map(String::as_str),
            Some("fabric-api")
        );
    }

    #[test]
    fn parses_open_resource_query_links() {
        let result = parse_vesta_url(
            "vesta://open-resource?platform=modrinth&projectId=fabric-api".to_string(),
        )
        .expect("open-resource query");
        assert_eq!(result.target, DeepLinkTarget::ResourceDetails);
        assert_eq!(
            result.params.get("platform").map(String::as_str),
            Some("modrinth")
        );
        assert_eq!(
            result.params.get("projectId").map(String::as_str),
            Some("fabric-api")
        );
    }

    #[test]
    fn parses_launch_instance_links() {
        let result = parse_vesta_url("vesta://launch-instance/my-slug".to_string())
            .expect("launch-instance");
        assert_eq!(result.target, DeepLinkTarget::LaunchInstance);
        assert_eq!(
            result.params.get("slug").map(String::as_str),
            Some("my-slug")
        );
    }

    #[test]
    fn parses_open_instance_links() {
        let result = parse_vesta_url("vesta://open-instance?slug=my-slug".to_string())
            .expect("open-instance");
        assert_eq!(result.target, DeepLinkTarget::OpenInstance);
        assert_eq!(
            result.params.get("slug").map(String::as_str),
            Some("my-slug")
        );
    }

    #[test]
    fn parses_legacy_copy_link_format() {
        let result = parse_vesta_url("vesta:///instance?path=%2Finstance&slug=my-slug".to_string())
            .expect("legacy copy link");
        assert_eq!(result.target, DeepLinkTarget::OpenInstance);
        assert_eq!(
            result.params.get("slug").map(String::as_str),
            Some("my-slug")
        );
    }

    #[test]
    fn rejects_launch_instance_without_slug() {
        let error = parse_vesta_url("vesta://launch-instance".to_string())
            .expect_err("launch-instance without slug should fail");
        assert!(error.contains("slug"));
    }

    #[test]
    fn rejects_open_resource_without_segments() {
        let error = parse_vesta_url("vesta://open-resource/modrinth".to_string())
            .expect_err("open-resource without projectId should fail");
        assert!(error.contains("projectId"));
    }

    #[test]
    fn rejects_unsupported_legacy_navigation_path() {
        let error = parse_vesta_url("vesta://open?path=%2Fdebug-test".to_string())
            .expect_err("debug route should be rejected");
        assert!(error.contains("Unsupported navigation path"));
    }
}
