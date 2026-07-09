//! App-specific preparation for launching an Instance.
//!
//! This Module adapts Vesta app state into `piston-lib` launch/runtime specs.
//! `piston-lib` owns Minecraft/runtime preparation; this Module owns app paths,
//! settings, account/offline policy, notifications, and status restoration.

use crate::auth::{ACCOUNT_TYPE_DEMO, ACCOUNT_TYPE_GUEST};
use crate::models::instance::Instance;
use lazy_static::lazy_static;
use piston_lib::game::installer::types::{
    InstallSpec, RemediationPolicy, RepairScope, SilentProgressReporter,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
use walkdir::WalkDir;

lazy_static! {
    static ref LAUNCH_AUTO_REPAIR_GUARD: Mutex<HashMap<String, Instant>> =
        Mutex::new(HashMap::new());
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum LauncherActionOnLaunch {
    StayOpen,
    Minimize,
    HideToTray,
    Quit,
}

impl LauncherActionOnLaunch {
    fn from_config_value(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "minimize" => Self::Minimize,
            "hide-to-tray" => Self::HideToTray,
            "quit" => Self::Quit,
            _ => Self::StayOpen,
        }
    }
}

#[derive(Debug)]
pub(crate) struct PreparedInstanceLaunch {
    pub instance_id: String,
    pub instance_name: String,
    pub install_spec: InstallSpec,
    pub launch_spec: piston_lib::game::launcher::LaunchSpec,
    pub launcher_action: LauncherActionOnLaunch,
    pub tray_visible: bool,
    pub offline: bool,
}

pub(crate) async fn prepare_instance_launch(
    app_handle: &tauri::AppHandle,
    instance_data: &Instance,
) -> Result<PreparedInstanceLaunch, String> {
    let instance_id = instance_data.slug();
    let app_config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
    let launcher_action = resolve_launcher_action(instance_data, &app_config);
    let tray_visible = app_config.show_tray_icon;

    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let java_path_str = crate::utils::java::ensure_java_for_instance(
        app_handle,
        instance_data,
        None,
        Some(format!(
            "repair_managed_java_launch_{}",
            instance_data.slug()
        )),
    )
    .await?;

    let spec_data_dir = if data_dir.join("data").exists() {
        data_dir.join("data")
    } else {
        data_dir.clone()
    };

    let instances_root = crate::utils::instance_helpers::resolve_instances_root(
        &data_dir,
        app_config.default_game_dir.as_deref(),
    );
    let game_dir = crate::utils::instance_helpers::resolve_instance_game_directory(
        instance_data,
        &instances_root,
        &data_dir,
    );

    verify_modpack_resource_presence(instance_data, &game_dir)?;

    let res_width = if instance_data.use_global_resolution {
        app_config.default_width
    } else {
        instance_data.game_width
    };
    let res_height = if instance_data.use_global_resolution {
        app_config.default_height
    } else {
        instance_data.game_height
    };
    let system_ram_mb = piston_lib::utils::hardware::get_total_memory_mb() as i32;
    let resolved_memory = crate::utils::memory_policy::clamp_manual_memory_range(
        instance_data.min_memory,
        instance_data.max_memory,
        system_ram_mb,
    );
    let java_args_raw = if instance_data.use_global_java_args {
        app_config.default_java_args.clone()
    } else {
        instance_data.java_args.clone()
    };
    let mut resolved_jvm_args = parse_user_jvm_args(java_args_raw)?;
    resolved_jvm_args.extend(game_proxy_jvm_args(&app_config));

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let mut env_vars = crate::utils::hooks::resolve_env_vars(&app_config, instance_data);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let env_vars = crate::utils::hooks::resolve_env_vars(&app_config, instance_data);

    let res_pre_launch_hook = if instance_data.use_global_hooks {
        app_config.default_pre_launch_hook.clone()
    } else {
        instance_data.pre_launch_hook.clone()
    };
    let res_wrapper_command = if instance_data.use_global_hooks {
        app_config.default_wrapper_command.clone()
    } else {
        instance_data.wrapper_command.clone()
    };
    let res_post_exit_hook = if instance_data.use_global_hooks {
        app_config.default_post_exit_hook.clone()
    } else {
        instance_data.post_exit_hook.clone()
    };

    let modloader_type = instance_data
        .modloader
        .as_ref()
        .and_then(|m| m.parse::<piston_lib::game::ModloaderType>().ok());

    let install_spec = InstallSpec {
        version_id: instance_data.minecraft_version.clone(),
        modloader: modloader_type.clone(),
        modloader_version: instance_data.modloader_version.clone(),
        data_dir: spec_data_dir.clone(),
        game_dir: game_dir.clone(),
        java_path: Some(PathBuf::from(&java_path_str)),
        dry_run: false,
        concurrency: 8,
        artifact_cache_max_bytes: crate::utils::storage::normalize_artifact_cache_limit_bytes(
            app_config.artifact_cache_max_bytes,
        ) as u64,
        force_overwrite_configs: false,
        repair_scope: RepairScope::Full,
        remediation_policy: RemediationPolicy::RepairIfNeeded,
        finalize_reporter: true,
    };

    let mut active_account = match crate::auth::get_active_account() {
        Ok(Some(acc)) => Some(acc),
        Ok(None) => None,
        Err(e) => {
            log::warn!("[launch_instance] Failed to read active account: {}", e);
            None
        }
    };

    let network_manager = app_handle.state::<crate::utils::network::NetworkManager>();
    let is_offline = network_manager.get_status() == crate::utils::network::NetworkStatus::Offline;

    if let Some(acc) = active_account.clone() {
        if acc.account_type == ACCOUNT_TYPE_GUEST || acc.account_type == ACCOUNT_TYPE_DEMO {
            log::warn!(
                "[launch_instance] Blocked launch attempt from {} account",
                acc.account_type
            );
            notify_login_required(app_handle, &acc.account_type);
            return Err(
                "You must be signed in with a Microsoft account to launch Minecraft.".to_string(),
            );
        } else if !is_offline {
            if let Err(e) =
                crate::auth::ensure_account_tokens_valid(app_handle.clone(), acc.uuid.clone()).await
            {
                log::error!("[launch_instance] Failed to refresh token: {}", e);
                return Err(format!("Failed to refresh authentication: {}", e));
            }

            active_account = match crate::auth::get_active_account() {
                Ok(Some(acc)) => Some(acc),
                Ok(None) => None,
                Err(_) => None,
            };
        } else {
            log::info!("[launch_instance] Offline mode: skipping token refresh");
        }
    }

    let exit_handler_jar = app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("exit-handler.jar"))
        .filter(|p| p.exists())
        .or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| {
                    p.join("resources")
                        .join("exit-handler")
                        .join("exit-handler.jar")
                })
                .filter(|p| p.exists())
        });

    let log_file = spec_data_dir
        .join("logs")
        .join(format!("{}.log", instance_id));

    let username = active_account
        .as_ref()
        .map(|a| a.username.clone())
        .unwrap_or_else(|| "Player".to_string());

    let uuid = if is_offline {
        piston_lib::auth::generate_offline_uuid(&username)
    } else {
        active_account
            .as_ref()
            .map(|a| a.uuid.clone())
            .unwrap_or_else(|| "00000000-0000-0000-0000-000000000000".to_string())
    };

    if app_config.use_dedicated_gpu {
        #[cfg(target_os = "linux")]
        {
            log::info!("[launch_instance] Enabling dedicated GPU variables for Linux (NVIDIA Prime / Mesa)");
            env_vars.insert("__NV_PRIME_RENDER_OFFLOAD".to_string(), "1".to_string());
            env_vars.insert(
                "__GLX_VENDOR_LIBRARY_NAME".to_string(),
                "nvidia".to_string(),
            );
            env_vars.insert("DRI_PRIME".to_string(), "1".to_string());
        }

        #[cfg(target_os = "windows")]
        {
            log::info!("[launch_instance] Setting Windows GPU preference for High Performance");
            let _ = crate::utils::windows::set_windows_gpu_preference(Path::new(&java_path_str));
            env_vars.insert("SHHighPerformanceGpuSelection".to_string(), "1".to_string());
        }
    }

    let launch_spec = piston_lib::game::launcher::LaunchSpec {
        instance_id: instance_id.clone(),
        version_id: instance_data.minecraft_version.clone(),
        modloader: modloader_type,
        modloader_version: instance_data.modloader_version.clone(),
        data_dir: spec_data_dir,
        game_dir,
        java_path: PathBuf::from(&java_path_str),
        min_memory: Some(resolved_memory.min as u32),
        max_memory: Some(resolved_memory.max as u32),
        username,
        uuid,
        access_token: if is_offline {
            "offline".to_string()
        } else {
            active_account
                .as_ref()
                .and_then(|a| a.access_token.clone())
                .unwrap_or_else(|| "offline".to_string())
        },
        xuid: None,
        client_id: piston_lib::auth::CLIENT_ID.to_string(),
        user_type: "msa".to_string(),
        jvm_args: resolved_jvm_args,
        game_args: vec![],
        window_width: Some(res_width as u32),
        window_height: Some(res_height as u32),
        exit_handler_jar,
        log_file: Some(log_file),
        env_vars,
        wrapper_command: res_wrapper_command,
        pre_launch_hook: res_pre_launch_hook,
        post_exit_hook: res_post_exit_hook,
    };

    Ok(PreparedInstanceLaunch {
        instance_id,
        instance_name: instance_data.name.clone(),
        install_spec,
        launch_spec,
        launcher_action,
        tray_visible,
        offline: is_offline,
    })
}

pub(crate) async fn ensure_runtime_ready_for_launch(
    app_handle: &tauri::AppHandle,
    inst: &Instance,
    install_spec: InstallSpec,
) -> Result<piston_lib::game::runtime_preparation::RuntimePreparationReport, String> {
    let initial_report = piston_lib::game::runtime_preparation::verify_runtime(&install_spec)
        .map_err(|e| format!("Launch preflight verification failed: {}", e))?;
    log_verification_report(&initial_report);

    if initial_report.ready {
        return Ok(
            piston_lib::game::runtime_preparation::RuntimePreparationReport {
                final_report: initial_report.clone(),
                initial_report,
                repaired: false,
            },
        );
    }

    if recently_attempted_repair(&inst.slug())? {
        restore_installed_status(app_handle, inst);
        return Err(format!(
            "Launch blocked: runtime files are still missing/corrupt (missing={}, mismatched={}). Auto-repair was already attempted recently; run Repair to view detailed errors.",
            initial_report.missing_count(),
            initial_report.mismatch_count()
        ));
    }
    record_repair_attempt(&inst.slug())?;

    log::info!(
        "[launch_instance] runtime gaps detected, running one-shot auto-repair instance={}",
        inst.slug()
    );
    if inst.id > 0 {
        let _ = crate::commands::instances::update_installation_status(
            app_handle,
            inst.id,
            "launch-preflight-repair",
        );
    }

    let report = piston_lib::game::runtime_preparation::prepare_runtime(
        install_spec,
        Arc::new(SilentProgressReporter),
    )
    .await
    .map_err(|e| {
        restore_installed_status(app_handle, inst);
        format!(
            "Launch auto-repair failed (missing={}, mismatched={}): {}",
            initial_report.missing_count(),
            initial_report.mismatch_count(),
            e
        )
    })?;

    restore_installed_status(app_handle, inst);
    if !report.final_report.ready {
        return Err(format!(
            "Launch blocked after auto-repair: runtime files still missing/corrupt (missing={}, mismatched={}).",
            report.final_report.missing_count(),
            report.final_report.mismatch_count()
        ));
    }

    Ok(report)
}

pub(crate) fn apply_launcher_action_after_launch(
    app_handle: &tauri::AppHandle,
    resolved_action: LauncherActionOnLaunch,
    tray_visible: bool,
) {
    let Some(main_window) = app_handle.get_webview_window("main") else {
        log::warn!("Launcher action skipped: main window not found");
        return;
    };

    match resolved_action {
        LauncherActionOnLaunch::StayOpen => {
            log::info!("Launcher action on launch resolved to stay-open");
        }
        LauncherActionOnLaunch::Minimize => {
            log::info!("Launcher action on launch resolved to minimize");
            let _ = main_window.minimize();
        }
        LauncherActionOnLaunch::HideToTray => {
            log::info!("Launcher action on launch resolved to hide-to-tray");
            if tray_visible {
                let _ = main_window.hide();
            } else {
                log::info!("Tray hidden/unavailable, falling back to minimize");
                let _ = main_window.minimize();
            }
        }
        LauncherActionOnLaunch::Quit => {
            log::info!("Launcher action on launch resolved to quit (guarded exit)");
            let _ = crate::commands::app::request_guarded_exit(app_handle, "launch-action-quit");
        }
    }
}

fn resolve_launcher_action(
    inst: &Instance,
    app_config: &crate::utils::config::AppConfig,
) -> LauncherActionOnLaunch {
    if !inst.use_global_launcher_action {
        if let Some(local_value) = inst.launcher_action_on_launch.as_deref() {
            return LauncherActionOnLaunch::from_config_value(local_value);
        }
    }

    LauncherActionOnLaunch::from_config_value(&app_config.default_launcher_action_on_launch)
}

fn game_proxy_jvm_args(app_config: &crate::utils::config::AppConfig) -> Vec<String> {
    if !app_config.proxy_enabled || !app_config.proxy_apply_to_games {
        return Vec::new();
    }

    let Some(proxy_url) = app_config.proxy_url.as_deref() else {
        return Vec::new();
    };

    let parsed = match piston_lib::client::validate_proxy_url(proxy_url) {
        Ok(parsed) => parsed,
        Err(e) => {
            log::warn!(
                "Skipping game proxy JVM args because proxy URL is invalid: {}",
                e
            );
            return Vec::new();
        }
    };

    if parsed.has_credentials {
        log::warn!(
            "Game proxy credentials are not injected into JVM arguments; host/port only will be used"
        );
    }

    match parsed.scheme.as_str() {
        "http" | "https" => vec![
            format!("-Dhttp.proxyHost={}", parsed.host),
            format!("-Dhttp.proxyPort={}", parsed.port),
            format!("-Dhttps.proxyHost={}", parsed.host),
            format!("-Dhttps.proxyPort={}", parsed.port),
        ],
        "socks5" | "socks5h" => vec![
            format!("-DsocksProxyHost={}", parsed.host),
            format!("-DsocksProxyPort={}", parsed.port),
        ],
        _ => Vec::new(),
    }
}

fn parse_user_jvm_args(raw_args: Option<String>) -> Result<Vec<String>, String> {
    let Some(args) = raw_args else {
        return Ok(Vec::new());
    };

    let trimmed = args.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    shlex::split(trimmed)
        .ok_or_else(|| "JVM arguments contain malformed quotes or escapes".to_string())
}

fn verify_modpack_resource_presence(inst: &Instance, game_dir: &Path) -> Result<(), String> {
    let has_modpack_link = inst.modpack_platform.is_some()
        || inst.modpack_id.is_some()
        || inst.modpack_version_id.is_some();
    let has_manifest = game_dir
        .join(piston_lib::game::modpack::manifest::ModpackManifest::FILE_NAME)
        .is_file()
        || game_dir
            .join(".vesta")
            .join("modpack_manifest.json")
            .is_file();

    if !(has_modpack_link || has_manifest) {
        return Ok(());
    }

    let critical_dirs = ["mods", "resourcepacks", "shaderpacks", "datapacks"];
    let mut discovered_files = 0usize;
    for dir_name in critical_dirs {
        let dir = game_dir.join(dir_name);
        if !dir.exists() {
            continue;
        }
        for entry in WalkDir::new(&dir)
            .max_depth(3)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file() {
                discovered_files += 1;
                break;
            }
        }
    }

    log::info!(
        "[launch_instance] modpack-resource-check instance={} linked={} manifest={} discovered_files={}",
        inst.slug(),
        has_modpack_link,
        has_manifest,
        discovered_files
    );

    if discovered_files == 0 {
        if inst.id > 0 {
            if let Ok(true) = crate::resources::ledger::has_indexed_launch_resources(inst.id) {
                log::warn!(
                        "[launch_instance] modpack-resource-check bypassed: no files found at {} but indexed resources exist in DB for instance={}",
                        game_dir.display(),
                        inst.slug()
                    );
                return Ok(());
            }
        }

        return Err(
            "Modpack-linked instance has no modpack-managed resource files (mods/resourcepacks/shaderpacks/datapacks). Run Repair to restore missing files."
                .to_string(),
        );
    }

    Ok(())
}

fn notify_login_required(app_handle: &tauri::AppHandle, account_type: &str) {
    if let Some(nm) = app_handle.try_state::<crate::notifications::manager::NotificationManager>() {
        let _ = nm.create(crate::notifications::models::CreateNotificationInput {
            client_key: None,
            title: Some("Login Required".to_string()),
            description: Some(format!(
                "You must be signed in with a Microsoft account to launch Minecraft. (Current: {})",
                account_type
            )),
            severity: Some("warning".to_string()),
            notification_type: Some(crate::notifications::models::NotificationType::Immediate),
            dismissible: Some(true),
            persist: Some(false),
            silent: Some(false),
            actions: None,
            progress: None,
            current_step: None,
            total_steps: None,
            metadata: None,
            show_on_completion: None,
        });
    }
}

pub(crate) fn notify_offline_launch(app_handle: &tauri::AppHandle, instance_name: &str) {
    if let Some(nm) = app_handle.try_state::<crate::notifications::manager::NotificationManager>() {
        let _ = nm.create(crate::notifications::models::CreateNotificationInput {
            client_key: None,
            title: Some(format!("Launching {} (Offline)", instance_name)),
            description: Some("Started in offline mode. Multiplayer on authenticated servers will not be available.".to_string()),
            severity: Some("info".to_string()),
            notification_type: Some(crate::notifications::models::NotificationType::Immediate),
            dismissible: Some(true),
            persist: Some(false),
            silent: Some(false),
            actions: None,
            progress: None,
            current_step: None,
            total_steps: None,
            metadata: None,
            show_on_completion: None,
        });
    }
}

fn log_verification_report(report: &piston_lib::game::installer::types::VerificationResult) {
    log::info!(
        "[launch_instance] verify-summary ready={} checked={} missing={} mismatch={}",
        report.ready,
        report.checked,
        report.missing_count(),
        report.mismatch_count()
    );

    if !report.ready {
        for issue in &report.issues {
            log::warn!(
                "[launch_instance] verify-issue kind={:?} class={} path={} detail={}",
                issue.kind,
                issue.artifact_class,
                issue.path,
                issue.detail
            );
        }
    }
}

fn recently_attempted_repair(instance_id: &str) -> Result<bool, String> {
    let now = Instant::now();
    let guard = LAUNCH_AUTO_REPAIR_GUARD
        .lock()
        .map_err(|_| "Failed to lock launch auto-repair guard".to_string())?;
    Ok(guard
        .get(instance_id)
        .map(|t| now.duration_since(*t) < Duration::from_secs(90))
        .unwrap_or(false))
}

fn record_repair_attempt(instance_id: &str) -> Result<(), String> {
    let mut guard = LAUNCH_AUTO_REPAIR_GUARD
        .lock()
        .map_err(|_| "Failed to lock launch auto-repair guard".to_string())?;
    guard.insert(instance_id.to_string(), Instant::now());
    Ok(())
}

fn restore_installed_status(app_handle: &tauri::AppHandle, inst: &Instance) {
    if inst.id > 0 {
        let _ = crate::commands::instances::update_installation_status(
            app_handle,
            inst.id,
            "installed",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{game_proxy_jvm_args, parse_user_jvm_args};

    #[test]
    fn game_proxy_args_are_disabled_by_default() {
        let config = crate::utils::config::AppConfig::default();
        assert!(game_proxy_jvm_args(&config).is_empty());
    }

    #[test]
    fn game_proxy_args_include_http_and_https_properties() {
        let mut config = crate::utils::config::AppConfig::default();
        config.proxy_enabled = true;
        config.proxy_apply_to_games = true;
        config.proxy_url = Some("http://127.0.0.1:8080".to_string());

        assert_eq!(
            game_proxy_jvm_args(&config),
            vec![
                "-Dhttp.proxyHost=127.0.0.1",
                "-Dhttp.proxyPort=8080",
                "-Dhttps.proxyHost=127.0.0.1",
                "-Dhttps.proxyPort=8080",
            ]
        );
    }

    #[test]
    fn game_proxy_args_include_socks_properties_without_credentials() {
        let mut config = crate::utils::config::AppConfig::default();
        config.proxy_enabled = true;
        config.proxy_apply_to_games = true;
        config.proxy_url = Some("socks5h://user:pass@example.test:1081".to_string());

        assert_eq!(
            game_proxy_jvm_args(&config),
            vec!["-DsocksProxyHost=example.test", "-DsocksProxyPort=1081",]
        );
    }

    #[test]
    fn parses_quoted_user_jvm_args() {
        assert_eq!(
            parse_user_jvm_args(Some(r#"-Dfoo="a b" -Xmx2G"#.to_string())).unwrap(),
            vec!["-Dfoo=a b", "-Xmx2G"]
        );
    }

    #[test]
    fn parses_paths_with_spaces() {
        assert_eq!(
            parse_user_jvm_args(Some(
                r#"-Djava.library.path="/tmp/path with spaces""#.to_string()
            ))
            .unwrap(),
            vec!["-Djava.library.path=/tmp/path with spaces"]
        );
    }

    #[test]
    fn rejects_malformed_user_jvm_args() {
        assert!(parse_user_jvm_args(Some(r#"-Dfoo="unterminated"#.to_string())).is_err());
    }

    #[test]
    fn appends_game_proxy_args_after_user_jvm_args() {
        let mut config = crate::utils::config::AppConfig::default();
        config.proxy_enabled = true;
        config.proxy_apply_to_games = true;
        config.proxy_url = Some("http://127.0.0.1:8080".to_string());

        let mut args = parse_user_jvm_args(Some("-Xmx2G".to_string())).unwrap();
        args.extend(game_proxy_jvm_args(&config));

        assert_eq!(args[0], "-Xmx2G");
        assert!(args.contains(&"-Dhttp.proxyHost=127.0.0.1".to_string()));
    }
}
