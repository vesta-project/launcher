use crate::utils::db_manager::get_app_config_dir;
use crate::utils::dialog_manager::{DialogAction, DialogManager, DialogRequest, DialogSeverity};
use tauri::Manager;

#[tauri::command]
pub async fn test_blocking_dialog(
    app_handle: tauri::AppHandle,
    dialog_manager: tauri::State<'_, DialogManager>,
) -> Result<String, String> {
    let request = DialogRequest {
        id: uuid::Uuid::new_v4(),
        title: "Backend Blocking Test".to_string(),
        description: Some("This dialog was triggered by the backend! Do you want to continue?".to_string()),
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
        crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| e.to_string())?
            .join("logs")
    };

    // Create logs directory if it doesn't exist
    std::fs::create_dir_all(&logs_path)
        .map_err(|e| format!("Failed to create logs directory: {}", e))?;

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
pub fn os_type() -> String {
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    #[cfg(target_os = "macos")]
    return "macos".to_string();
    #[cfg(target_os = "linux")]
    return "linux".to_string();
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return "unknown".to_string();
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
        let actual = network_manager.check_connectivity().await;
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
    let status = network_manager.check_connectivity().await;
    network_manager.set_status(status);
    Ok(status)
}

#[tauri::command]
pub fn get_tray_settings() -> Result<TraySettings, String> {
    let config = crate::utils::config::get_app_config()
        .map_err(|e| format!("Failed to get config: {}", e))?;
    
    Ok(TraySettings {
        show_tray_icon: config.show_tray_icon,
        minimize_to_tray: config.minimize_to_tray,
    })
}

#[tauri::command]
pub fn set_tray_icon_visibility(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    crate::utils::config::update_config_field(app, "show_tray_icon".to_string(), serde_json::json!(visible))
        .map_err(|e| format!("Failed to update tray icon visibility: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn set_minimize_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    crate::utils::config::update_config_field(app, "minimize_to_tray".to_string(), serde_json::json!(enabled))
        .map_err(|e| format!("Failed to update minimize to tray setting: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn show_window_from_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()
            .map_err(|e| format!("Failed to show window: {}", e))?;
        window.set_focus()
            .map_err(|e| format!("Failed to focus window: {}", e))?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct TraySettings {
    pub show_tray_icon: bool,
    pub minimize_to_tray: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum DeepLinkTarget {
    Install,
    ResourceDetails,
    Home,
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

    match action {
        "install" => {
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::Install,
                params,
            })
        }
        "home" => {
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::Home,
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
            if segments.len() >= 2 {
                params.insert("platform".to_string(), segments[0].to_string());
                params.insert("projectId".to_string(), segments[1].to_string());
            }
            Ok(DeepLinkMetadata {
                target: DeepLinkTarget::ResourceDetails,
                params,
            })
        }
        _ => Err(format!("Unknown action: {}", action)),
    }
}
