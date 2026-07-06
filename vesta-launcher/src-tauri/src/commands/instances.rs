use crate::auth::{ACCOUNT_TYPE_DEMO, ACCOUNT_TYPE_GUEST};
use crate::discord::DiscordManager;
use crate::models::instance::{Instance, NewInstance};
use crate::resources::ResourceWatcher;
use crate::schema::instance::dsl::*;
use crate::tasks::installers::external_import::ImportExternalInstanceTask;
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::maintenance::{CloneInstanceTask, RepairInstanceTask, ResetInstanceTask};
use crate::tasks::manager::TaskManager;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use lazy_static::lazy_static;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

const MCLOGS_MAX_BYTES: u64 = 10 * 1024 * 1024;
const MCLOGS_MAX_LINES: usize = 25_000;

lazy_static! {
    static ref LAUNCH_AUTO_REPAIR_GUARD: Mutex<HashMap<String, Instant>> =
        Mutex::new(HashMap::new());
    static ref LAUNCH_IN_PROGRESS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

fn find_instance_by_slug(instance_id_slug: &str) -> Result<Instance, String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;
    instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?
        .into_iter()
        .find(|inst| inst.slug() == instance_id_slug)
        .ok_or_else(|| format!("Instance {} not found in database", instance_id_slug))
}

fn crash_event_payload(
    instance_id_slug: &str,
    crash_info: &crate::utils::crash_parser::CrashDetails,
) -> serde_json::Value {
    let mut value = serde_json::to_value(crash_info).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "instance_id".to_string(),
            serde_json::Value::String(instance_id_slug.to_string()),
        );
    }
    value
}

struct LaunchInProgressGuard {
    instance_id: String,
}

impl LaunchInProgressGuard {
    async fn acquire(instance_id: String) -> Result<Self, String> {
        if piston_lib::game::launcher::is_instance_running(&instance_id)
            .await
            .map_err(|e| format!("Failed to check instance run state: {}", e))?
        {
            return Err("Instance is already starting or running".to_string());
        }

        let mut guard = LAUNCH_IN_PROGRESS
            .lock()
            .map_err(|_| "Failed to lock launch in-progress guard".to_string())?;
        if !guard.insert(instance_id.clone()) {
            return Err("Instance is already starting or running".to_string());
        }

        Ok(Self { instance_id })
    }
}

impl Drop for LaunchInProgressGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = LAUNCH_IN_PROGRESS.lock() {
            guard.remove(&self.instance_id);
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum LauncherActionOnLaunch {
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

fn apply_launcher_action_after_launch(
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

#[cfg(test)]
mod proxy_launch_tests {
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

/// Compute canonical instance game directory path under the given instances root
fn compute_instance_game_dir(root: &std::path::Path, slug: &str) -> String {
    root.join(slug).to_string_lossy().to_string()
}

fn verify_modpack_resource_presence(inst: &Instance, game_dir: &str) -> Result<(), String> {
    let has_modpack_link = inst.modpack_platform.is_some()
        || inst.modpack_id.is_some()
        || inst.modpack_version_id.is_some();
    let game_path = std::path::Path::new(game_dir);
    let has_manifest = game_path
        .join(piston_lib::game::modpack::manifest::ModpackManifest::FILE_NAME)
        .is_file()
        || game_path
            .join(".vesta")
            .join("modpack_manifest.json")
            .is_file();

    if !(has_modpack_link || has_manifest) {
        return Ok(());
    }

    let critical_dirs = ["mods", "resourcepacks", "shaderpacks", "datapacks"];
    let mut discovered_files = 0usize;
    for dir_name in critical_dirs {
        let dir = game_path.join(dir_name);
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
        // Fallback: if resources are already indexed in DB for this instance,
        // do not hard-block launch due to path-layout drift.
        if inst.id > 0 {
            use crate::schema::installed_resource::dsl as ir_dsl;
            if let Ok(mut conn) = get_vesta_conn() {
                let indexed_count = ir_dsl::installed_resource
                    .filter(ir_dsl::instance_id.eq(inst.id))
                    .filter(
                        ir_dsl::resource_type
                            .eq("mod")
                            .or(ir_dsl::resource_type.eq("resourcepack"))
                            .or(ir_dsl::resource_type.eq("shader"))
                            .or(ir_dsl::resource_type.eq("datapack")),
                    )
                    .count()
                    .get_result::<i64>(&mut conn)
                    .unwrap_or(0);
                if indexed_count > 0 {
                    log::warn!(
                        "[launch_instance] modpack-resource-check bypassed: no files found at {} but {} indexed resources exist in DB for instance={}",
                        game_dir,
                        indexed_count,
                        inst.slug()
                    );
                    return Ok(());
                }
            }
        }

        return Err(
            "Modpack-linked instance has no modpack-managed resource files (mods/resourcepacks/shaderpacks/datapacks). Run Repair to restore missing files."
                .to_string(),
        );
    }

    Ok(())
}

/// Update playtime for an instance in the database
fn update_instance_playtime(
    app_handle: &tauri::AppHandle,
    instance_id_slug: &str,
    started_at_str: &str,
    exited_at_str: &str,
) -> Result<(), String> {
    use crate::schema::instance::dsl::*;
    // Parse timestamps
    let started = chrono::DateTime::parse_from_rfc3339(started_at_str)
        .map_err(|e| format!("Failed to parse started_at: {}", e))?;
    let exited = chrono::DateTime::parse_from_rfc3339(exited_at_str)
        .map_err(|e| format!("Failed to parse exited_at: {}", e))?;

    // Calculate duration in minutes
    let duration = exited.signed_duration_since(started);
    let minutes = (duration.num_seconds() / 60).max(0) as i32;

    log::info!(
        "Updating playtime for instance {}: {} minutes (from {} to {})",
        instance_id_slug,
        minutes,
        started_at_str,
        exited_at_str
    );

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Find instance by slug
    let instances_list = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in instances_list {
        if inst.slug() == instance_id_slug {
            let new_playtime = inst.total_playtime_minutes + minutes;
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            diesel::update(instance.filter(id.eq(inst.id)))
                .set((
                    total_playtime_minutes.eq(new_playtime),
                    last_played.eq(&now),
                    updated_at.eq(&now),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update playtime: {}", e))?;

            log::info!(
                "Updated playtime for instance {} (id {}): {} -> {} minutes",
                instance_id_slug,
                inst.id,
                inst.total_playtime_minutes,
                new_playtime
            );

            // Fetch the updated instance to emit
            if let Ok(updated_inst) = instance.find(inst.id).first::<Instance>(&mut conn) {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "core://instance-updated",
                    process_instance_icon(updated_inst),
                );
            }

            return Ok(());
        }
    }

    log::warn!(
        "Instance {} not found in database for playtime update",
        instance_id_slug
    );
    Ok(())
}

/// Store crash details in the database for an instance
fn store_crash_details(
    instance_id_slug: &str,
    crash_info: &crate::utils::crash_parser::CrashDetails,
) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let all_instances = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in all_instances {
        if inst.slug() == instance_id_slug {
            let crash_details_json = serde_json::to_string(crash_info)
                .map_err(|e| format!("Failed to serialize crash details: {}", e))?;

            diesel::update(instance.filter(id.eq(inst.id)))
                .set((crashed.eq(true), crash_details.eq(crash_details_json)))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update crash details: {}", e))?;

            log::info!(
                "Stored crash details for instance {} (id {})",
                instance_id_slug,
                inst.id
            );
            return Ok(());
        }
    }

    Err(format!(
        "Instance {} not found in database",
        instance_id_slug
    ))
}

#[tauri::command]
pub fn clear_instance_crash(
    app_handle: tauri::AppHandle,
    instance_id_slug: String,
) -> Result<(), String> {
    clear_crash_flag(&instance_id_slug, Some(&app_handle))
}

#[tauri::command]
pub fn open_crash_report(instance_id_slug: String, path: String) -> Result<(), String> {
    let inst = find_instance_by_slug(&instance_id_slug)?;
    let game_dir = resolve_instance_game_dir_for_upload(&inst)?;
    let path = canonical_crash_upload_path(&PathBuf::from(path), &game_dir)?;
    open::that(&path).map_err(|e| format!("Failed to open crash report: {}", e))
}

#[derive(serde::Serialize)]
pub struct MclogsUploadResult {
    pub id: Option<String>,
    pub url: String,
    pub raw: Option<String>,
    pub expires: Option<i64>,
}

#[tauri::command]
pub async fn upload_crash_to_mclogs(
    instance_id_slug: String,
    crash_id: Option<String>,
) -> Result<MclogsUploadResult, String> {
    let persist_instance_id_slug = instance_id_slug.clone();
    let persist_crash_id = crash_id.clone();
    let content = tauri::async_runtime::spawn_blocking(move || {
        load_redacted_crash_content(&instance_id_slug, crash_id)
    })
    .await
    .map_err(|e| format!("Failed to prepare crash log upload: {}", e))??;

    let value = post_mclogs_json("https://api.mclo.gs/1/log", content).await?;
    if value.get("success").and_then(|v| v.as_bool()) == Some(false) {
        return Err(value
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("mclo.gs rejected the log")
            .to_string());
    }
    let url = value
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "mclo.gs response did not include a URL".to_string())?
        .to_string();

    persist_crash_mclogs_url(&persist_instance_id_slug, persist_crash_id.as_deref(), &url)?;

    Ok(MclogsUploadResult {
        id: value.get("id").and_then(|v| v.as_str()).map(str::to_string),
        url,
        raw: value
            .get("raw")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        expires: value.get("expires").and_then(|v| v.as_i64()),
    })
}

fn persist_crash_mclogs_url(
    instance_id_slug: &str,
    expected_crash_id: Option<&str>,
    url: &str,
) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;
    let all_instances = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;
    let inst = all_instances
        .into_iter()
        .find(|inst| inst.slug() == instance_id_slug)
        .ok_or_else(|| format!("Instance {} not found in database", instance_id_slug))?;

    let mut details = inst
        .crash_details
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .ok_or_else(|| "No crash details are available for this instance".to_string())?;

    if let Some(expected) = expected_crash_id {
        let actual = details.get("crash_id").and_then(|value| value.as_str());
        if actual.is_some() && actual != Some(expected) {
            return Err("This crash is no longer the latest crash for the instance".to_string());
        }
    }

    if let Some(obj) = details.as_object_mut() {
        obj.insert(
            "mclogs_url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
    }

    diesel::update(instance.filter(id.eq(inst.id)))
        .set(crash_details.eq(details.to_string()))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to persist mclo.gs URL: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn list_crash_scenarios() -> Vec<crate::utils::crash_fixtures::CrashScenarioInfo> {
    if !cfg!(debug_assertions) {
        return Vec::new();
    }
    crate::utils::crash_fixtures::crash_scenario_catalog()
}

fn emit_simulated_crash(
    app_handle: &tauri::AppHandle,
    instance_id_slug: &str,
    crash: crate::utils::crash_parser::CrashDetails,
) -> Result<(), String> {
    store_crash_details(instance_id_slug, &crash)?;
    app_handle
        .emit(
            "core://instance-crashed",
            crash_event_payload(instance_id_slug, &crash),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn emit_fake_crash_scenario(
    app_handle: tauri::AppHandle,
    instance_id_slug: String,
    scenario: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("Fake crash events are only available in development builds".to_string());
    }

    let crash = crate::utils::crash_fixtures::crash_from_scenario(&scenario)
        .ok_or_else(|| format!("Unknown crash scenario: {scenario}"))?;
    emit_simulated_crash(&app_handle, &instance_id_slug, crash)
}

#[tauri::command]
pub fn emit_fake_crash(
    app_handle: tauri::AppHandle,
    instance_id_slug: String,
) -> Result<(), String> {
    emit_fake_crash_scenario(
        app_handle,
        instance_id_slug,
        "fabric_missing_api".to_string(),
    )
}

fn load_redacted_crash_content(
    instance_id_slug: &str,
    expected_crash_id: Option<String>,
) -> Result<String, String> {
    let inst = find_instance_by_slug(instance_id_slug)?;
    let details = inst
        .crash_details
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());

    if let (Some(expected), Some(details)) = (expected_crash_id.as_deref(), details.as_ref()) {
        let actual = details.get("crash_id").and_then(|v| v.as_str());
        if actual.is_some() && actual != Some(expected) {
            return Err("This crash is no longer the latest crash for the instance".to_string());
        }
    }

    let game_dir = resolve_instance_game_dir_for_upload(&inst)?;
    let path = details
        .as_ref()
        .and_then(|value| {
            value
                .get("report_path")
                .or_else(|| value.get("log_path"))
                .and_then(|v| v.as_str())
        })
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| game_dir.join("logs").join("latest.log"));

    let path = canonical_crash_upload_path(&path, &game_dir)?;
    let content = read_redacted_log_file(&path)?;
    Ok(content)
}

fn resolve_instance_game_dir_for_upload(inst: &Instance) -> Result<PathBuf, String> {
    let app_config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
    let app_config_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let instances_root = crate::utils::instance_helpers::resolve_instances_root(
        &app_config_dir,
        app_config.default_game_dir.as_deref(),
    );

    Ok(
        crate::utils::instance_helpers::resolve_instance_game_directory(
            inst,
            &instances_root,
            &app_config_dir,
        ),
    )
}

fn canonical_crash_upload_path(path: &Path, game_dir: &Path) -> Result<PathBuf, String> {
    let canonical_game_dir = game_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve instance directory {:?}: {}", game_dir, e))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve crash log {:?}: {}", path, e))?;

    if !canonical_path.starts_with(&canonical_game_dir) {
        return Err("Crash log is outside this instance directory".to_string());
    }

    Ok(canonical_path)
}

fn read_redacted_log_file(path: &Path) -> Result<String, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read crash log metadata: {}", e))?;
    if metadata.len() > MCLOGS_MAX_BYTES {
        return Err("Crash log is larger than mclo.gs allows (10 MiB)".to_string());
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read crash log {:?}: {}", path, e))?;
    let redacted = redact_log_content(&content);
    enforce_mclogs_limits(&redacted)?;
    Ok(redacted)
}

async fn post_mclogs_json(url: &str, content: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to prepare mclo.gs client: {}", e))?;
    let response = client
        .post(url)
        .json(&serde_json::json!({
            "content": content,
            "source": "Vesta Launcher",
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to contact mclo.gs: {}", e))?;

    let status = response.status();
    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to read mclo.gs response: {}", e))?;
    if !status.is_success() {
        return Err(value
            .get("error")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("mclo.gs returned {}", status)));
    }
    Ok(value)
}

fn enforce_mclogs_limits(content: &str) -> Result<(), String> {
    if content.len() as u64 > MCLOGS_MAX_BYTES {
        return Err("Crash log is larger than mclo.gs allows (10 MiB)".to_string());
    }
    if content.lines().count() > MCLOGS_MAX_LINES {
        return Err("Crash log has more lines than mclo.gs allows (25,000)".to_string());
    }
    Ok(())
}

fn redact_log_content(content: &str) -> String {
    content
        .lines()
        .map(|line| {
            let mut redacted = redact_paths(line);
            redacted = redact_sensitive_assignments(&redacted);
            redact_ipv4_tokens(&redacted)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_paths(line: &str) -> String {
    let vesta_redacted = redact_vesta_path_prefixes(line);
    redact_non_vesta_absolute_paths(&vesta_redacted)
}

fn redact_vesta_path_prefixes(line: &str) -> String {
    let mut redacted = line.to_string();
    for marker in [".VestaLauncher", "VestaLauncher"] {
        let mut search_from = 0;
        while let Some(offset) = redacted[search_from..].find(marker) {
            let marker_start = search_from + offset;
            let Some(path_start) = find_path_start_before(&redacted, marker_start) else {
                search_from = marker_start + marker.len();
                continue;
            };

            redacted.replace_range(path_start..marker_start, "<path>/");
            search_from = path_start + "<path>/".len() + marker.len();
        }
    }
    redacted
}

fn find_path_start_before(line: &str, marker_start: usize) -> Option<usize> {
    let prefix = &line[..marker_start];
    let mut path_start = None;
    for (idx, _) in prefix.match_indices('/') {
        if idx == 0 || is_path_prefix_boundary(prefix.as_bytes()[idx - 1] as char) {
            path_start = Some(idx);
        }
    }

    let bytes = prefix.as_bytes();
    for idx in (0..bytes.len().saturating_sub(2)).rev() {
        if bytes[idx].is_ascii_alphabetic()
            && bytes[idx + 1] == b':'
            && (bytes[idx + 2] == b'\\' || bytes[idx + 2] == b'/')
            && (idx == 0 || is_path_prefix_boundary(bytes[idx - 1] as char))
        {
            path_start = Some(path_start.map_or(idx, |existing| existing.max(idx)));
            break;
        }
    }

    path_start
}

fn is_path_prefix_boundary(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '"' | '\'' | '(' | '[' | '{' | '<' | '=')
}

fn redact_non_vesta_absolute_paths(line: &str) -> String {
    let mut redacted = String::with_capacity(line.len());
    let mut cursor = 0;

    while cursor < line.len() {
        let Some(start) =
            find_next_absolute_path_start(line, cursor).filter(|start| *start >= cursor)
        else {
            redacted.push_str(&line[cursor..]);
            break;
        };
        let end = absolute_path_end(line, start);
        redacted.push_str(&line[cursor..start]);
        redacted.push_str("<path redacted>");
        cursor = end;
    }

    redacted
}

fn find_next_absolute_path_start(line: &str, from: usize) -> Option<usize> {
    find_unix_path_start(line, from)
        .into_iter()
        .chain(find_windows_path_start(line, from))
        .min()
}

fn find_unix_path_start(line: &str, from: usize) -> Option<usize> {
    line[from..].match_indices('/').find_map(|(offset, _)| {
        let idx = from + offset;
        if idx == 0 || is_path_prefix_boundary(line.as_bytes()[idx - 1] as char) {
            Some(idx)
        } else {
            None
        }
    })
}

fn find_windows_path_start(line: &str, from: usize) -> Option<usize> {
    let bytes = line.as_bytes();
    (from..bytes.len().saturating_sub(2)).find(|&idx| {
        bytes[idx].is_ascii_alphabetic()
            && bytes[idx + 1] == b':'
            && (bytes[idx + 2] == b'\\' || bytes[idx + 2] == b'/')
            && (idx == 0 || is_path_prefix_boundary(bytes[idx - 1] as char))
    })
}

fn absolute_path_end(line: &str, start: usize) -> usize {
    let quote = start
        .checked_sub(1)
        .and_then(|idx| line.as_bytes().get(idx))
        .copied()
        .filter(|byte| matches!(byte, b'"' | b'\''));
    if let Some(quote) = quote {
        if let Some(offset) = line[start..].find(quote as char) {
            return start + offset;
        }
    }

    let mut end = token_end(line, start);
    loop {
        let whitespace_end = skip_whitespace(line, end);
        if whitespace_end == end || whitespace_end >= line.len() {
            return end;
        }

        if find_unix_path_start(line, whitespace_end) == Some(whitespace_end)
            || find_windows_path_start(line, whitespace_end) == Some(whitespace_end)
        {
            return end;
        }

        let next_end = token_end(line, whitespace_end);
        let next = &line[whitespace_end..next_end];
        if next.contains('/') || next.contains('\\') {
            end = next_end;
            continue;
        }
        return end;
    }
}

fn token_end(line: &str, start: usize) -> usize {
    line[start..]
        .char_indices()
        .find(|(_, ch)| {
            ch.is_whitespace() || matches!(ch, '"' | '\'' | ')' | ']' | '}' | '<' | '>' | '|')
        })
        .map(|(offset, ch)| {
            if offset == 0 {
                start + ch.len_utf8()
            } else {
                start + offset
            }
        })
        .unwrap_or(line.len())
}

fn skip_whitespace(line: &str, start: usize) -> usize {
    line[start..]
        .find(|ch: char| !ch.is_whitespace())
        .map(|offset| start + offset)
        .unwrap_or(line.len())
}

fn redact_sensitive_assignments(line: &str) -> String {
    let sensitive = [
        "access_token",
        "accesstoken",
        "authorization",
        "session",
        "token",
        "client_secret",
    ];
    let lower = line.to_lowercase();
    if !sensitive.iter().any(|key| lower.contains(key)) {
        return line.to_string();
    }

    let mut redacted = line.to_string();
    for key in sensitive {
        redacted = redact_key_values(&redacted, key);
        redacted = redact_split_argument_values(&redacted, key);
    }
    redacted
}

fn redact_ipv4_tokens(line: &str) -> String {
    let mut redacted = String::with_capacity(line.len());
    let mut cursor = 0;
    while cursor < line.len() {
        let end = if line.as_bytes()[cursor].is_ascii_whitespace() {
            skip_whitespace(line, cursor)
        } else {
            token_end(line, cursor)
        };
        let part = &line[cursor..end];
        let trimmed = part.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
        if trimmed.parse::<std::net::Ipv4Addr>().is_ok() {
            redacted.push_str(&part.replace(trimmed, "**.**.**.**"));
        } else {
            redacted.push_str(part);
        }
        cursor = end;
    }
    redacted
}

fn redact_key_values(line: &str, key: &str) -> String {
    let lower = line.to_lowercase();
    let mut redacted = String::with_capacity(line.len());
    let mut cursor = 0;

    while let Some(offset) = lower[cursor..].find(key) {
        let key_start = cursor + offset;
        let key_end = key_start + key.len();
        let Some((value_start, quoted)) = find_sensitive_value_start(line, key_end) else {
            redacted.push_str(&line[cursor..key_end]);
            cursor = key_end;
            continue;
        };
        let value_end = sensitive_value_end(line, value_start, quoted);
        redacted.push_str(&line[cursor..value_start]);
        redacted.push_str("<redacted>");
        cursor = value_end;
    }

    redacted.push_str(&line[cursor..]);
    redacted
}

fn find_sensitive_value_start(line: &str, key_end: usize) -> Option<(usize, Option<u8>)> {
    let bytes = line.as_bytes();
    let mut idx = key_end;
    if matches!(bytes.get(idx), Some(b'"' | b'\'')) {
        idx += 1;
    }
    while matches!(bytes.get(idx), Some(b' ' | b'\t')) {
        idx += 1;
    }
    if !matches!(bytes.get(idx), Some(b'=' | b':')) {
        return None;
    }
    idx += 1;
    while matches!(bytes.get(idx), Some(b' ' | b'\t')) {
        idx += 1;
    }
    let quote = bytes
        .get(idx)
        .copied()
        .filter(|byte| matches!(byte, b'"' | b'\''));
    if quote.is_some() {
        idx += 1;
    }
    Some((idx, quote))
}

fn sensitive_value_end(line: &str, value_start: usize, quoted: Option<u8>) -> usize {
    if let Some(quote) = quoted {
        return line[value_start..]
            .find(quote as char)
            .map(|offset| value_start + offset)
            .unwrap_or(line.len());
    }

    let mut end = line[value_start..]
        .find(|ch: char| ch.is_whitespace() || matches!(ch, '&' | ',' | '}' | ']'))
        .map(|offset| value_start + offset)
        .unwrap_or(line.len());

    if line[value_start..end].eq_ignore_ascii_case("bearer") {
        let next_start = skip_whitespace(line, end);
        if next_start > end && next_start < line.len() {
            end = token_end(line, next_start);
        }
    }

    end
}

fn redact_split_argument_values(line: &str, key: &str) -> String {
    let lower = line.to_lowercase();
    let mut redacted = String::with_capacity(line.len());
    let mut cursor = 0;

    while let Some(offset) = lower[cursor..].find(key) {
        let key_start = cursor + offset;
        let key_end = key_start + key.len();
        if key_start < 2 || &line[key_start - 2..key_start] != "--" {
            redacted.push_str(&line[cursor..key_end]);
            cursor = key_end;
            continue;
        }

        let value_start = skip_whitespace(line, key_end);
        if value_start == key_end || value_start >= line.len() {
            redacted.push_str(&line[cursor..key_end]);
            cursor = key_end;
            continue;
        }

        let value_end = token_end(line, value_start);
        redacted.push_str(&line[cursor..value_start]);
        redacted.push_str("<redacted>");
        cursor = value_end;
    }

    redacted.push_str(&line[cursor..]);
    redacted
}

/// Clear the crashed flag for an instance when it successfully launches
fn clear_crash_flag(
    instance_id_slug: &str,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let all_instances = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in all_instances {
        if inst.slug() == instance_id_slug {
            diesel::update(instance.filter(id.eq(inst.id)))
                .set((crashed.eq(false), crash_details.eq::<Option<String>>(None)))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to clear crash flag: {}", e))?;

            if let Some(app_handle) = app_handle {
                let updated = instance
                    .find(inst.id)
                    .first::<Instance>(&mut conn)
                    .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;
                let _ = app_handle.emit("core://instance-updated", process_instance_icon(updated));
            }

            log::info!(
                "Cleared crash flag for instance {} (id {})",
                instance_id_slug,
                inst.id
            );
            return Ok(());
        }
    }

    Err(format!(
        "Instance {} not found in database",
        instance_id_slug
    ))
}

#[tauri::command]
pub async fn install_instance(
    app_handle: tauri::AppHandle,
    task_manager: State<'_, TaskManager>,
    instance_data: Instance,
    dry_run: Option<bool>,
) -> Result<(), String> {
    // If this instance originated from launcher import, reinstall should reuse
    // the same import migration path instead of normal modpack install flow.
    if instance_data.last_operation.as_deref() == Some("external-import") {
        let source_game_directory = instance_data
            .import_source_game_directory
            .clone()
            .ok_or_else(|| {
                "Cannot reinstall imported instance: missing source game directory".to_string()
            })?;
        if !std::path::Path::new(&source_game_directory).exists() {
            return Err(format!(
                "Cannot reinstall imported instance: source directory does not exist ({})",
                source_game_directory
            ));
        }

        log::info!(
            "[install_instance] rerouting to external import reinstall for instance_id={} source={}",
            instance_data.id,
            source_game_directory
        );
        if instance_data.id > 0 {
            let _ = crate::commands::instances::update_instance_operation(
                &app_handle,
                instance_data.id,
                "external-import",
            );
            let _ = crate::commands::instances::update_installation_status(
                &app_handle,
                instance_data.id,
                "installing",
            );
        }
        let task = ImportExternalInstanceTask::new(
            instance_data.id,
            instance_data.name.clone(),
            source_game_directory,
        );
        task_manager.submit(Box::new(task)).await?;
        return Ok(());
    }

    // Check if we are in guest mode
    let active_account = match crate::auth::get_active_account() {
        Ok(a) => a,
        Err(_) => None,
    };

    if let Some(acc) = active_account {
        if acc.account_type == ACCOUNT_TYPE_GUEST || acc.account_type == ACCOUNT_TYPE_DEMO {
            log::warn!(
                "[install_instance] Blocked install attempt from {} account",
                acc.account_type
            );

            // Show notification
            if let Some(nm) =
                app_handle.try_state::<crate::notifications::manager::NotificationManager>()
            {
                let _ = nm.create(crate::notifications::models::CreateNotificationInput {
                    client_key: None,
                    title: Some("Login Required".to_string()),
                    description: Some(
                        format!("You must be signed in with a Microsoft account to install Minecraft. (Current: {})", acc.account_type)
                    ),
                    severity: Some("warning".to_string()),
                    notification_type: Some(
                        crate::notifications::models::NotificationType::Immediate,
                    ),
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

            return Err(
                "You must be signed in with a Microsoft account to install Minecraft.".to_string(),
            );
        }
    }

    log::info!(
        "[install_instance] Command invoked for instance: {} (dry_run={:?})",
        instance_data.name,
        dry_run
    );
    log::info!(
        "[install_instance] Instance details - version: {}, modloader: {:?}, modloader_version: {:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    log::info!("[install_instance] Creating InstallInstanceTask");
    let mut task = InstallInstanceTask::new(instance_data.clone());
    if let Some(dr) = dry_run {
        task.set_dry_run(dr);
    }

    log::info!("[install_instance] Submitting task to TaskManager");
    match task_manager.submit(Box::new(task)).await {
        Ok(_) => {
            // Immediately update DB to 'installing' so UI shows progress without waiting
            if instance_data.id > 0 {
                let _ = crate::commands::instances::update_instance_operation(
                    &app_handle,
                    instance_data.id,
                    "install",
                );
                let _ = crate::commands::instances::update_installation_status(
                    &app_handle,
                    instance_data.id,
                    "installing",
                );
            }
            // Emit an early update so UI homescreen refreshes as soon as installation starts
            // (Note: update_installation_status already emits core://instance-updated now)

            log::info!(
                "[install_instance] Task submitted successfully for: {}",
                instance_data.name
            );
            Ok(())
        }
        Err(e) => {
            log::error!("[install_instance] Failed to submit task: {}", e);
            Err(e)
        }
    }
}

pub fn process_instance_icon(mut inst: Instance) -> Instance {
    // If we have icon_data, we should prefer serving it via base64 for offline compatibility,
    // unless the icon_path is a gradient (which doesn't use icon_data).
    let is_gradient = inst
        .icon_path
        .as_ref()
        .map(|p| p.starts_with("linear-gradient"))
        .unwrap_or(false);

    if !is_gradient {
        if let Some(ref data) = inst.icon_data {
            use base64::{engine::general_purpose, Engine as _};
            let mime = crate::utils::image::detect_image_mime(data);
            let b64 = general_purpose::STANDARD.encode(data);
            inst.icon_path = Some(format!("data:{};base64,{}", mime, b64));
        } else if inst.icon_path.is_none() && inst.modpack_icon_url.is_some() {
            // Fallback to URL if we have one but no data and no explicitly set path
            inst.icon_path = inst.modpack_icon_url.clone();
        }
    }
    inst
}

#[tauri::command]
pub fn list_instances() -> Result<Vec<Instance>, String> {
    log::info!("Fetching all instances from database");

    // Guest/Demo Mode check: If active account is Guest or Demo, we hide real instances
    // to provide a clean slate without destroying user data.
    if let Ok(Some(active_acc)) = crate::auth::get_active_account() {
        if active_acc.account_type == ACCOUNT_TYPE_GUEST
            || active_acc.account_type == ACCOUNT_TYPE_DEMO
        {
            return Ok(vec![]);
        }
    }

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let instances = instance
        .order((last_played.desc(), created_at.desc()))
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    log::info!("Retrieved {} instances", instances.len());

    let processed: Vec<Instance> = if instances.len() > 50 {
        instances
            .into_par_iter()
            .map(process_instance_icon)
            .collect()
    } else {
        instances.into_iter().map(process_instance_icon).collect()
    };
    Ok(processed)
}

#[tauri::command]
pub async fn create_instance(
    app_handle: tauri::AppHandle,
    instance_data: Instance,
    resource_watcher: State<'_, ResourceWatcher>,
) -> Result<i32, String> {
    log::info!(
        "[create_instance] Command invoked for instance: {}",
        instance_data.name
    );
    log::info!(
        "[create_instance] Instance details - version: {}, modloader: {:?}, modloader_version: {:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    log::info!("[create_instance] Getting database connection");
    let mut conn = get_vesta_conn().map_err(|e| {
        log::error!("[create_instance] Failed to get database: {}", e);
        format!("Failed to get database: {}", e)
    })?;

    log::info!("[create_instance] Determining unique slug and game directory");

    // Make a mutable copy so we can set defaults (game_directory) before inserting
    let mut inst = instance_data;
    let skip_initial_watch = inst.installation_status.as_deref() == Some("skip-initial-watch");

    // Get app config to check for custom instances directory
    let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;

    // Determine config data dir
    let app_config_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Use custom directory if set, otherwise default to the app config directory's instances folder
    let instances_root = if let Some(ref dir) = config.default_game_dir {
        if !dir.is_empty() && dir != "/" {
            std::path::PathBuf::from(dir)
        } else {
            app_config_dir.join("instances")
        }
    } else {
        app_config_dir.join("instances")
    };

    log::info!(
        "[create_instance] Using instances root: {:?}",
        instances_root
    );

    // Fetch existing instance names and compute their slugs
    let existing_names: Vec<String> = instance
        .select(name)
        .load::<String>(&mut conn)
        .map_err(|e| format!("Failed to query existing instance names: {}", e))?;

    let mut seen_names = std::collections::HashSet::new();
    let mut seen_slugs = std::collections::HashSet::new();
    for existing_name in existing_names {
        seen_names.insert(existing_name.to_lowercase());
        seen_slugs.insert(crate::utils::sanitize::sanitize_instance_name(
            &existing_name,
        ));
    }

    // Check for duplicate name (case-insensitive) and make it unique
    inst.name = crate::utils::instance_helpers::compute_unique_name(&inst.name, &seen_names);

    // Handle Icon: If it's a base64 data URL, convert to icon_data and set icon_path to reflect it's stored
    if let Some(ref path) = inst.icon_path {
        if path.starts_with("data:image/") {
            log::info!("[create_instance] Converting base64 icon to binary data");
            if let Some(base64_part) = path.split(",").collect::<Vec<&str>>().get(1) {
                use base64::{engine::general_purpose, Engine as _};
                if let Ok(bytes) = general_purpose::STANDARD.decode(base64_part) {
                    inst.icon_data = Some(bytes);
                    inst.icon_path = Some("internal://icon".to_string());
                }
            }
        } else if !path.starts_with("internal://") && !path.starts_with("linear-gradient") {
            log::debug!("[create_instance] Setting preset icon, ensuring icon_data is fresh if modpack icon exists");
            // If it's a preset, we don't clear icon_data YET because it might be the modpack icon being downloaded.
            // But if it's NOT a modpack, we should clear it.
            if inst.modpack_icon_url.is_none() {
                inst.icon_data = None;
            }
        }
    }

    // If we have a modpack icon URL but no bytes, try to download them now
    if inst.modpack_icon_url.is_some() && inst.icon_data.is_none() {
        if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(
            inst.modpack_icon_url.as_ref().unwrap(),
        )
        .await
        {
            log::info!(
                "[create_instance] Successfully downloaded icon for offline use ({} bytes)",
                bytes.len()
            );
            inst.icon_data = Some(bytes);
        }
    }

    // Default icon if none provided or set
    if inst.icon_path.is_none() && inst.icon_data.is_none() {
        log::info!(
            "[create_instance] No icon provided for {}, resetting to default placeholder",
            inst.name
        );
        inst.icon_path = Some("builtin:placeholder-1".to_string());
    }

    // Fetch existing instance names and compute their slugs
    let slug = crate::utils::instance_helpers::compute_unique_slug(
        &inst.name,
        &seen_slugs,
        &instances_root,
    );

    // Always set the instance game_directory to the configured instances root
    // using the computed instance id (slug).
    let gd = compute_instance_game_dir(&instances_root, &slug);
    if inst.game_directory.is_some() {
        log::info!(
            "[create_instance] Overriding supplied game_directory with instances root path: {}",
            gd
        );
    }
    inst.game_directory = Some(gd.clone());

    // Ensure common directories exist - specifically "mods" for modloader instances
    if let Err(e) = std::fs::create_dir_all(&gd) {
        log::error!("[create_instance] Failed to create game directory: {}", e);
    } else if inst.modloader.is_some() {
        let mods_dir = std::path::PathBuf::from(&gd).join("mods");
        if let Err(e) = std::fs::create_dir_all(&mods_dir) {
            log::error!("[create_instance] Failed to create mods directory: {}", e);
        } else {
            log::info!(
                "[create_instance] Created mods directory for modloader instance: {}",
                inst.name
            );
        }
    }

    log::info!("[create_instance] Inserting instance into database");

    // Create NewInstance from Instance (excluding ID which works automatically)
    let new_instance = NewInstance {
        name: inst.name,
        minecraft_version: inst.minecraft_version,
        modloader: inst.modloader,
        modloader_version: inst.modloader_version,
        java_path: inst.java_path,
        java_args: inst.java_args,
        game_directory: inst.game_directory,
        game_width: inst.game_width,
        game_height: inst.game_height,
        min_memory: inst.min_memory,
        max_memory: inst.max_memory,
        icon_path: inst.icon_path,
        last_played: inst.last_played,
        total_playtime_minutes: inst.total_playtime_minutes,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
        installation_status: Some("installed".to_string()),
        crashed: None,
        crash_details: None,
        modpack_id: inst.modpack_id,
        modpack_version_id: inst.modpack_version_id,
        modpack_platform: inst.modpack_platform,
        modpack_icon_url: inst.modpack_icon_url,
        icon_data: inst.icon_data,
        last_operation: inst.last_operation,
        import_source_game_directory: inst.import_source_game_directory,
        import_launcher_kind: inst.import_launcher_kind,
        import_instance_path: inst.import_instance_path,
        use_global_resolution: inst.use_global_resolution,
        use_global_java_args: inst.use_global_java_args,
        use_global_java_path: inst.use_global_java_path,
        use_global_hooks: inst.use_global_hooks,
        use_global_environment_variables: inst.use_global_environment_variables,
        use_global_game_dir: inst.use_global_game_dir,
        use_global_launcher_action: inst.use_global_launcher_action,
        launcher_action_on_launch: inst.launcher_action_on_launch,
        environment_variables: inst.environment_variables,
        pre_launch_hook: inst.pre_launch_hook,
        wrapper_command: inst.wrapper_command,
        post_exit_hook: inst.post_exit_hook,
    };

    diesel::insert_into(instance)
        .values(&new_instance)
        .execute(&mut conn)
        .map_err(|e| {
            log::error!("[create_instance] Failed to insert instance: {}", e);
            format!("Failed to insert instance: {}", e)
        })?;

    // Get the ID of the inserted row
    let inserted_id: i32 = instance
        .select(id)
        .order(id.desc())
        .first(&mut conn)
        .map_err(|e| format!("Failed to get inserted instance ID: {}", e))?;

    // Fetch the full instance and emit created event
    if let Ok(full_instance) = instance.find(inserted_id).first::<Instance>(&mut conn) {
        use tauri::Emitter;
        let _ = app_handle.emit(
            "core://instance-created",
            process_instance_icon(full_instance),
        );
    }

    // Set initial installation_status to "pending"
    let _ = crate::commands::instances::update_installation_status(
        &app_handle,
        inserted_id,
        "installing",
    );

    // Start watching the new instance's folders for mods/packs unless caller requested deferred watch.
    if skip_initial_watch {
        log::info!(
            "[create_instance] Skipping initial resource watcher for instance: {} ({})",
            slug,
            inserted_id
        );
    } else {
        log::info!(
            "[create_instance] Initializing resource watcher for instance: {} ({})",
            slug,
            inserted_id
        );
        if let Err(e) = resource_watcher
            .watch_instance(slug.clone(), inserted_id, gd)
            .await
        {
            log::error!("[create_instance] Failed to start resource watcher: {}", e);
        }
    }

    log::info!(
        "[create_instance] Instance created successfully with ID: {} and slug: {}",
        inserted_id,
        slug
    );

    Ok(inserted_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn compute_game_dir_uses_slug() {
        let root = PathBuf::from("C:/Users/test/.VestaLauncher/instances");
        let slug = "my-instance";
        let got = compute_instance_game_dir(&root, slug);
        assert_eq!(got, root.join(slug).to_string_lossy().to_string());
    }
}

#[tauri::command]
pub async fn update_instance(
    app_handle: tauri::AppHandle,
    instance_data: Instance,
    resource_watcher: tauri::State<'_, crate::resources::watcher::ResourceWatcher>,
) -> Result<(), String> {
    log::info!(
        "[update_instance] Updating instance: {:?}",
        instance_data.id
    );

    let mut final_instance = instance_data.clone();

    // Handle Icon: If it's a base64 data URL, convert to icon_data and set icon_path to reflect it's stored
    if let Some(ref path) = final_instance.icon_path {
        if path.starts_with("data:image/") {
            log::info!("[update_instance] Converting base64 icon to binary data");
            if let Some(base64_part) = path.split(",").collect::<Vec<&str>>().get(1) {
                use base64::{engine::general_purpose, Engine as _};
                if let Ok(bytes) = general_purpose::STANDARD.decode(base64_part) {
                    final_instance.icon_data = Some(bytes);
                    final_instance.icon_path = Some("internal://icon".to_string());
                }
            }
        } else if !path.starts_with("internal://") && !path.starts_with("linear-gradient") {
            // If it's a preset or something else, clear the custom icon data
            log::debug!(
                "[update_instance] Clearing binary icon data as path is now a preset: {}",
                path
            );
            final_instance.icon_data = None;
        }
    }

    // Download icon for offline use if we have a URL but no bytes (e.g. newly linked or recently updated)
    // We only do this if the user hasn't opted for a specific preset or gradient
    let is_using_custom_preset = final_instance
        .icon_path
        .as_ref()
        .map(|p| {
            (!p.starts_with("internal://") && Some(p) != final_instance.modpack_icon_url.as_ref())
                || p.starts_with("linear-gradient")
        })
        .unwrap_or(false);

    if !is_using_custom_preset
        && final_instance.modpack_icon_url.is_some()
        && final_instance.icon_data.is_none()
    {
        if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(
            final_instance.modpack_icon_url.as_ref().unwrap(),
        )
        .await
        {
            log::info!(
                "[update_instance] Successfully downloaded icon for offline use ({} bytes)",
                bytes.len()
            );
            final_instance.icon_data = Some(bytes);
        }
    }

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let update_id = instance_data.id;
    if update_id <= 0 {
        return Err("Cannot update instance with uninitialized ID".to_string());
    }

    // Fetch the existing row so we can detect name changes and old game_directory
    let existing_row: (String, Option<String>) = instance
        .find(update_id)
        .select((name, game_directory))
        .first(&mut conn)
        .map_err(|e| format!("Failed to query existing instance: {}", e))?;

    let old_name = existing_row.0;

    let old_slug = crate::utils::sanitize::sanitize_instance_name(&old_name);
    let mut new_slug = instance_data.slug();

    // If slug changes, compute unique slug against other instances and filesystem
    if old_slug != new_slug {
        // Get app config to check for custom instances directory
        let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;

        let app_config_dir = crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| format!("Failed to get app config dir: {}", e))?;

        // Use custom directory if set, otherwise default to the app config directory's instances folder
        let instances_root = if let Some(ref dir) = config.default_game_dir {
            if !dir.is_empty() && dir != "/" {
                std::path::PathBuf::from(dir)
            } else {
                app_config_dir.join("instances")
            }
        } else {
            app_config_dir.join("instances")
        };

        // Build set of seen slugs excluding current row
        let existing_instances: Vec<(i32, String)> = instance
            .select((id, name))
            .load(&mut conn)
            .map_err(|e| format!("Failed to query existing instances: {}", e))?;

        let mut seen = std::collections::HashSet::new();
        for (rid, rname) in existing_instances {
            if rid != update_id {
                seen.insert(crate::utils::sanitize::sanitize_instance_name(&rname));
            }
        }

        // Avoid filesystem collisions using shared helper
        new_slug = crate::utils::instance_helpers::compute_unique_slug(
            &final_instance.name,
            &seen,
            &instances_root,
        );

        // Attempt to rename the instance directory if it exists
        let old_dir = instances_root.join(&old_slug);
        let new_dir = instances_root.join(&new_slug);

        if old_dir.exists() {
            let rename_result = tokio::task::spawn_blocking({
                let old_dir = old_dir.clone();
                let new_dir = new_dir.clone();
                move || std::fs::rename(&old_dir, &new_dir)
            })
            .await
            .map_err(|e| format!("spawn_blocking panicked: {}", e))?;
            if let Err(e) = rename_result {
                log::warn!(
                    "[update_instance] Failed to rename instance dir: {} -> {} : {}",
                    old_dir.display(),
                    new_dir.display(),
                    e
                );
                if let Err(e2) = std::fs::create_dir_all(&new_dir) {
                    return Err(format!("Failed to create new instance directory: {}", e2));
                }
            }
        } else if !new_dir.exists() {
            // Old dir doesn't exist — create new directory
            if let Err(e) = std::fs::create_dir_all(&new_dir) {
                return Err(format!("Failed to create instance directory: {}", e));
            }
        }

        // Update the instance.game_directory to the canonical instances root
        let new_game_dir = compute_instance_game_dir(&instances_root, &new_slug);
        final_instance.game_directory = Some(new_game_dir);

        // Move log file if exists
        let app_config_dir = crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| format!("Failed to get app config dir: {}", e))?;
        let old_log = app_config_dir
            .join("data")
            .join("logs")
            .join(format!("{}.log", old_slug));
        let new_log = app_config_dir
            .join("data")
            .join("logs")
            .join(format!("{}.log", new_slug));

        if old_log.exists() {
            let rename_log_result = tokio::task::spawn_blocking({
                let old_log = old_log.clone();
                let new_log = new_log.clone();
                move || std::fs::rename(&old_log, &new_log)
            })
            .await
            .map_err(|e| format!("spawn_blocking panicked: {}", e))?;
            if let Err(e) = rename_log_result {
                log::warn!("[update_instance] Failed to move log file: {}", e);
            }
        }

        // Need to update registry if running associated with old slug
        // logic moved to background task to avoid blocking db connection
        let old_slug_clone = old_slug.clone();
        let new_slug_clone = new_slug.clone();
        let logpath = new_log.clone();
        let dirpath = final_instance.game_directory.clone().unwrap_or_default();

        tauri::async_runtime::spawn(async move {
            if let Ok(Some(running)) =
                piston_lib::game::launcher::get_instance(&old_slug_clone).await
            {
                log::info!("[update_instance] Instance currently running; updating registry id from {} to {}", old_slug_clone, new_slug_clone);
                if let Err(e) =
                    piston_lib::game::launcher::unregister_instance(&old_slug_clone).await
                {
                    log::warn!("Failed to unregister: {}", e);
                }
                let mut updated = running.clone();
                updated.instance_id = new_slug_clone;
                updated.game_dir = std::path::PathBuf::from(dirpath);
                updated.log_file = logpath;
                if let Err(e) = piston_lib::game::launcher::register_instance(updated).await {
                    log::warn!("Failed to re-register: {}", e);
                }
            }
        });

        log::info!(
            "[update_instance] Renamed/updated instance id from {} -> {}",
            old_slug,
            new_slug
        );

        // Restart watcher for new path
        if let Err(e) = resource_watcher.unwatch_instance(update_id).await {
            log::warn!("[update_instance] Failed to unwatch during rename: {}", e);
        }
        if let Some(ref gd) = final_instance.game_directory {
            if let Err(e) = resource_watcher
                .watch_instance(new_slug, update_id, gd.clone())
                .await
            {
                log::warn!("[update_instance] Failed to re-watch after rename: {}", e);
            }
        }
    }

    // Perform Update
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    diesel::update(instance.find(update_id))
        .set((
            name.eq(&final_instance.name),
            minecraft_version.eq(&final_instance.minecraft_version),
            modloader.eq(&final_instance.modloader),
            modloader_version.eq(&final_instance.modloader_version),
            java_path.eq(&final_instance.java_path),
            java_args.eq(&final_instance.java_args),
            game_directory.eq(&final_instance.game_directory),
            game_width.eq(final_instance.game_width),
            game_height.eq(final_instance.game_height),
            min_memory.eq(final_instance.min_memory),
            max_memory.eq(final_instance.max_memory),
            icon_path.eq(&final_instance.icon_path),
            icon_data.eq(&final_instance.icon_data),
            last_played.eq(&final_instance.last_played),
            total_playtime_minutes.eq(final_instance.total_playtime_minutes),
            modpack_id.eq(&final_instance.modpack_id),
            modpack_version_id.eq(&final_instance.modpack_version_id),
            modpack_platform.eq(&final_instance.modpack_platform),
            modpack_icon_url.eq(&final_instance.modpack_icon_url),
            icon_data.eq(&final_instance.icon_data),
            use_global_resolution.eq(final_instance.use_global_resolution),
            use_global_java_args.eq(final_instance.use_global_java_args),
            use_global_java_path.eq(final_instance.use_global_java_path),
            use_global_hooks.eq(final_instance.use_global_hooks),
            use_global_environment_variables.eq(final_instance.use_global_environment_variables),
            use_global_game_dir.eq(final_instance.use_global_game_dir),
            use_global_launcher_action.eq(final_instance.use_global_launcher_action),
            launcher_action_on_launch.eq(&final_instance.launcher_action_on_launch),
            environment_variables.eq(&final_instance.environment_variables),
            pre_launch_hook.eq(&final_instance.pre_launch_hook),
            wrapper_command.eq(&final_instance.wrapper_command),
            post_exit_hook.eq(&final_instance.post_exit_hook),
            updated_at.eq(&now),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update instance: {}", e))?;

    log::info!("Updated instance ID: {}", update_id);

    // Fetch the full updated instance to emit it
    let updated: crate::models::instance::Instance = instance
        .find(update_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    // Notify frontend
    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", process_instance_icon(updated));

    Ok(())
}

#[tauri::command]
pub async fn delete_instance(
    app_handle: tauri::AppHandle,
    instance_id: i32,
    task_manager: tauri::State<'_, TaskManager>,
    _resource_watcher: tauri::State<'_, crate::resources::watcher::ResourceWatcher>,
) -> Result<(), String> {
    log::info!("[delete_instance] enqueue instance_id={}", instance_id);
    task_manager.cancel_instance_tasks(instance_id);
    let task = crate::tasks::maintenance::DeleteInstanceTask::new(instance_id);
    task_manager.submit(Box::new(task)).await?;

    // Signal UI for optimistic removal immediately.
    use tauri::Emitter;
    let _ = app_handle.emit(
        "core://instance-delete-queued",
        serde_json::json!({ "id": instance_id }),
    );
    Ok(())
}

#[tauri::command]
pub async fn get_instance_required_java(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<u32, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst = instance
        .find(instance_id)
        .first::<Instance>(&mut conn)
        .map_err(|e| e.to_string())?;
    crate::utils::java::resolve_required_java_major(&app_handle, &inst.minecraft_version).await
}

#[tauri::command]
pub fn get_instance(instance_id: i32) -> Result<Instance, String> {
    log::info!("Fetching instance ID: {}", instance_id);

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let fetched_instance = instance
        .find(instance_id)
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to fetch instance: {}", e))?;

    log::info!("Retrieved instance: {}", fetched_instance.name);
    Ok(process_instance_icon(fetched_instance))
}

#[tauri::command]
pub fn get_instance_by_slug(slug_val: String) -> Result<Instance, String> {
    log::info!("Fetching instance by slug: {}", slug_val);

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Inefficient but compatible: fetch all and matching slug
    let instances_list = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in instances_list {
        if inst.slug() == slug_val {
            log::info!("Found instance by slug {}: {}", slug_val, inst.name);
            return Ok(process_instance_icon(inst));
        }
    }

    Err(format!("Instance with slug '{}' not found", slug_val))
}

#[tauri::command]
pub async fn launch_instance(
    app_handle: tauri::AppHandle,
    instance_data: Instance,
) -> Result<(), String> {
    // macOS: Ensure microphone permissions are granted before launch
    // to allow voice chat mods in Minecraft to function.
    #[cfg(target_os = "macos")]
    {
        if !tauri_plugin_macos_permissions::check_microphone_permission().await {
            log::info!("[macOS Permissions] Requesting microphone permission...");
            // We don't block the launch if permission is denied, but we try to request it.
            let _ = tauri_plugin_macos_permissions::request_microphone_permission().await;
        }
    }

    if instance_data.installation_status.as_deref() == Some("installing") {
        let op = instance_data
            .last_operation
            .as_deref()
            .unwrap_or("operation");
        return Err(format!("Cannot launch while instance is busy ({})", op));
    }

    let instance_id = instance_data.slug();
    let _launch_guard = LaunchInProgressGuard::acquire(instance_id.clone()).await?;

    use tauri::Emitter;
    let _ = app_handle.emit(
        "core://instance-launch-request",
        serde_json::json!({ "instance_id": instance_id }),
    );

    log::info!(
        "[launch_instance] Launch requested for instance: {} (ID: {})",
        instance_data.name,
        instance_data.id
    );
    log::info!(
        "[launch_instance] Instance data: MC: {}, Loader: {:?}, Loader Version: {:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    // Load app configuration for defaults
    let app_config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
    let resolved_launcher_action = resolve_launcher_action(&instance_data, &app_config);
    let tray_visible = app_config.show_tray_icon;

    // Get app config directory
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    let java_path_str = crate::utils::java::ensure_java_for_instance(
        &app_handle,
        &instance_data,
        None,
        Some(format!(
            "repair_managed_java_launch_{}",
            instance_data.slug()
        )),
    )
    .await?;

    // Determine which data_dir to use
    let spec_data_dir = if data_dir.join("data").exists() {
        data_dir.join("data")
    } else {
        data_dir.clone()
    };

    // Determine game directory using the same resolver as duplicate/repair flows.
    let app_config_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let instances_root = crate::utils::instance_helpers::resolve_instances_root(
        &app_config_dir,
        app_config.default_game_dir.as_deref(),
    );
    let game_dir = crate::utils::instance_helpers::resolve_instance_game_directory(
        &instance_data,
        &instances_root,
        &data_dir,
    )
    .to_string_lossy()
    .to_string();

    verify_modpack_resource_presence(&instance_data, &game_dir)?;

    // Resolve settings (Resolution, Memory, Java Args)
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
    let res_min_memory = resolved_memory.min;
    let res_max_memory = resolved_memory.max;
    let java_args_raw = if instance_data.use_global_java_args {
        app_config.default_java_args.clone()
    } else {
        instance_data.java_args.clone()
    };
    let mut resolved_jvm_args = parse_user_jvm_args(java_args_raw)?;
    resolved_jvm_args.extend(game_proxy_jvm_args(&app_config));

    // Resolve Environment Variables
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let mut env_vars = crate::utils::hooks::resolve_env_vars(&app_config, &instance_data);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let env_vars = crate::utils::hooks::resolve_env_vars(&app_config, &instance_data);

    // Resolve Hooks
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

    // Parse modloader type
    let modloader_type = instance_data
        .modloader
        .as_ref()
        .and_then(|m| m.parse::<piston_lib::game::ModloaderType>().ok());

    // Fast launch preflight: verify runtime artifacts before spawning JVM.
    let verify_spec = piston_lib::game::installer::types::InstallSpec {
        version_id: instance_data.minecraft_version.clone(),
        modloader: modloader_type.clone(),
        modloader_version: instance_data.modloader_version.clone(),
        data_dir: spec_data_dir.clone(),
        game_dir: std::path::PathBuf::from(&game_dir),
        java_path: Some(std::path::PathBuf::from(&java_path_str)),
        dry_run: false,
        concurrency: 8,
        artifact_cache_max_bytes: crate::utils::storage::normalize_artifact_cache_limit_bytes(
            app_config.artifact_cache_max_bytes,
        ) as u64,
        force_overwrite_configs: false,
        repair_scope: piston_lib::game::installer::types::RepairScope::Full,
        remediation_policy: piston_lib::game::installer::types::RemediationPolicy::RepairIfNeeded,
        finalize_reporter: true,
    };
    let preflight_report = piston_lib::game::installer::verify_instance(&verify_spec)
        .map_err(|e| format!("Launch preflight verification failed: {}", e))?;
    log::info!(
        "[launch_instance] verify-summary ready={} checked={} missing={} mismatch={}",
        preflight_report.ready,
        preflight_report.checked,
        preflight_report.missing_count(),
        preflight_report.mismatch_count()
    );
    if !preflight_report.ready {
        for issue in &preflight_report.issues {
            log::warn!(
                "[launch_instance] verify-issue kind={:?} class={} path={} detail={}",
                issue.kind,
                issue.artifact_class,
                issue.path,
                issue.detail
            );
        }

        let now = Instant::now();
        let recently_attempted = {
            let guard = LAUNCH_AUTO_REPAIR_GUARD
                .lock()
                .map_err(|_| "Failed to lock launch auto-repair guard".to_string())?;
            guard
                .get(&instance_id)
                .map(|t| now.duration_since(*t) < std::time::Duration::from_secs(90))
                .unwrap_or(false)
        };
        if recently_attempted {
            if instance_data.id > 0 {
                let _ = crate::commands::instances::update_installation_status(
                    &app_handle,
                    instance_data.id,
                    "installed",
                );
            }
            return Err(format!(
                "Launch blocked: runtime files are still missing/corrupt (missing={}, mismatched={}). Auto-repair was already attempted recently; run Repair to view detailed errors.",
                preflight_report.missing_count(),
                preflight_report.mismatch_count()
            ));
        }
        {
            let mut guard = LAUNCH_AUTO_REPAIR_GUARD
                .lock()
                .map_err(|_| "Failed to lock launch auto-repair guard".to_string())?;
            guard.insert(instance_id.clone(), now);
        }

        log::info!(
            "[launch_instance] runtime gaps detected, running one-shot auto-repair instance={}",
            instance_id
        );
        if instance_data.id > 0 {
            let _ = crate::commands::instances::update_installation_status(
                &app_handle,
                instance_data.id,
                "launch-preflight-repair",
            );
        }
        let silent_reporter: std::sync::Arc<
            dyn piston_lib::game::installer::types::ProgressReporter,
        > = std::sync::Arc::new(piston_lib::game::installer::types::SilentProgressReporter);
        piston_lib::game::installer::install_instance(verify_spec, silent_reporter)
            .await
            .map_err(|e| {
                if instance_data.id > 0 {
                    let _ = crate::commands::instances::update_installation_status(
                        &app_handle,
                        instance_data.id,
                        "installed",
                    );
                }
                format!(
                    "Launch auto-repair failed (missing={}, mismatched={}): {}",
                    preflight_report.missing_count(),
                    preflight_report.mismatch_count(),
                    e
                )
            })?;
        let post_repair = piston_lib::game::installer::verify_instance(
            &piston_lib::game::installer::types::InstallSpec {
                version_id: instance_data.minecraft_version.clone(),
                modloader: modloader_type.clone(),
                modloader_version: instance_data.modloader_version.clone(),
                data_dir: spec_data_dir.clone(),
                game_dir: std::path::PathBuf::from(&game_dir),
                java_path: Some(std::path::PathBuf::from(&java_path_str)),
                dry_run: false,
                concurrency: 8,
                artifact_cache_max_bytes:
                    crate::utils::storage::normalize_artifact_cache_limit_bytes(
                        app_config.artifact_cache_max_bytes,
                    ) as u64,
                force_overwrite_configs: false,
                repair_scope: piston_lib::game::installer::types::RepairScope::Full,
                remediation_policy:
                    piston_lib::game::installer::types::RemediationPolicy::RepairIfNeeded,
                finalize_reporter: true,
            },
        )
        .map_err(|e| {
            if instance_data.id > 0 {
                let _ = crate::commands::instances::update_installation_status(
                    &app_handle,
                    instance_data.id,
                    "installed",
                );
            }
            format!("Post-repair verification failed: {}", e)
        })?;
        if !post_repair.ready {
            if instance_data.id > 0 {
                let _ = crate::commands::instances::update_installation_status(
                    &app_handle,
                    instance_data.id,
                    "installed",
                );
            }
            return Err(format!(
                "Launch blocked after auto-repair: runtime files still missing/corrupt (missing={}, mismatched={}).",
                post_repair.missing_count(),
                post_repair.mismatch_count()
            ));
        }
        if instance_data.id > 0 {
            let _ = crate::commands::instances::update_installation_status(
                &app_handle,
                instance_data.id,
                "installed",
            );
        }
    }

    // Attempt to read the current active account
    let mut active_account = match crate::auth::get_active_account() {
        Ok(Some(acc)) => Some(acc),
        Ok(None) => None,
        Err(e) => {
            log::warn!("[launch_instance] Failed to read active account: {}", e);
            None
        }
    };

    // Check network status
    let network_manager = app_handle.state::<crate::utils::network::NetworkManager>();
    let is_offline = network_manager.get_status() == crate::utils::network::NetworkStatus::Offline;

    // If we have an active account, ensure token validity
    if let Some(acc) = active_account.clone() {
        if acc.account_type == ACCOUNT_TYPE_GUEST || acc.account_type == ACCOUNT_TYPE_DEMO {
            log::warn!(
                "[launch_instance] Blocked launch attempt from {} account",
                acc.account_type
            );

            // Show notification to user that Guest/Demo mode cannot launch games
            if let Some(nm) =
                app_handle.try_state::<crate::notifications::manager::NotificationManager>()
            {
                let _ = nm.create(crate::notifications::models::CreateNotificationInput {
                    client_key: None,
                    title: Some("Login Required".to_string()),
                    description: Some(
                        format!("You must be signed in with a Microsoft account to launch Minecraft. (Current: {})", acc.account_type)
                    ),
                    severity: Some("warning".to_string()),
                    notification_type: Some(
                        crate::notifications::models::NotificationType::Immediate,
                    ),
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

            // Re-fetch
            active_account = match crate::auth::get_active_account() {
                Ok(Some(acc)) => Some(acc),
                Ok(None) => None,
                Err(_) => None,
            };
        } else {
            log::info!("[launch_instance] Offline mode: skipping token refresh");
        }
    }

    // Build launch spec
    let exit_handler_jar = app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("exit-handler.jar"))
        .filter(|p| p.exists())
        .or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent() // src-tauri -> vesta-launcher
                .map(|p| {
                    p.join("resources")
                        .join("exit-handler")
                        .join("exit-handler.jar")
                })
                .filter(|p| p.exists())
        });

    // Determine log file path
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

    // Prepare GPU environment and preferences
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
            // Set Windows registry preference for the specific Java executable
            let _ = crate::utils::windows::set_windows_gpu_preference(std::path::Path::new(
                &java_path_str,
            ));
            // Hint for older drivers/wrappers
            env_vars.insert("SHHighPerformanceGpuSelection".to_string(), "1".to_string());
        }
    }

    let spec = piston_lib::game::launcher::LaunchSpec {
        instance_id: instance_id.clone(),
        version_id: instance_data.minecraft_version.clone(),
        modloader: modloader_type.clone(),
        modloader_version: instance_data.modloader_version.clone(),
        data_dir: spec_data_dir.clone(),
        game_dir: std::path::PathBuf::from(&game_dir),
        java_path: std::path::PathBuf::from(&java_path_str),
        min_memory: Some(res_min_memory as u32),
        max_memory: Some(res_max_memory as u32),
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
        env_vars: env_vars.clone(),
        wrapper_command: res_wrapper_command,
        pre_launch_hook: res_pre_launch_hook,
        post_exit_hook: res_post_exit_hook,
    };

    log::info!(
        "[launch_instance] Launching game: {} {}",
        spec.instance_id,
        spec.version_id
    );

    // Log batching setup
    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<(String, String, String)>();
    let app_for_batcher = app_handle.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        let mut batch: Vec<serde_json::Value> = Vec::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(50));

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if !batch.is_empty() {
                         let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({ "lines": batch.clone() }));
                         batch.clear();
                    }
                }
                msg = log_rx.recv() => {
                    match msg {
                        Some((iid, line, stream)) => {
                            batch.push(serde_json::json!({ "instance_id": iid, "line": line, "stream": stream }));
                            if batch.len() >= 50 {
                                let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({ "lines": batch.clone() }));
                                batch.clear();
                            }
                        }
                        None => {
                            if !batch.is_empty() {
                                let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({ "lines": batch }));
                            }
                            break;
                        }
                    }
                }
            }
        }
    });

    let log_callback: piston_lib::game::launcher::LogCallback =
        Arc::new(move |iid, line, stream| {
            let _ = log_tx.send((iid, line, stream));
        });

    if is_offline {
        if let Some(nm) =
            app_handle.try_state::<crate::notifications::manager::NotificationManager>()
        {
            let _ = nm.create(crate::notifications::models::CreateNotificationInput {
                client_key: None,
                title: Some(format!("Launching {} (Offline)", instance_data.name)),
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

    let join = tokio::task::spawn_blocking(move || {
        futures::executor::block_on(piston_lib::game::launcher::launch_game(
            spec,
            Some(log_callback),
        ))
    })
    .await
    .map_err(|e| format!("Failed to spawn blocking task: {}", e))?;

    match join {
        Ok(result) => {
            log::info!("[launch_instance] Started PID: {}", result.instance.pid);
            if let Err(e) = clear_crash_flag(&instance_id, Some(&app_handle)) {
                log::error!("Failed to clear crash flag: {}", e);
            }

            let run_state = crate::utils::process_state::InstanceRunState {
                instance_id: instance_id.clone(),
                pid: result.instance.pid,
                log_file: result.log_file.clone(),
                game_dir: result.instance.game_dir.clone(),
                version_id: result.instance.version_id.clone(),
                modloader: result.instance.modloader.as_ref().map(|m| m.to_string()),
                started_at: result.instance.started_at.to_rfc3339(),
            };

            if let Err(e) = crate::utils::process_state::add_running_process(run_state.clone()) {
                log::warn!("Failed to persist process state: {}", e);
            }

            // Handle post-exit hook and cleanup if process handle is available
            if let Some(handle) = result.handle {
                if let Some(mut child) = handle.child {
                    let iid_for_hook = instance_id.clone();
                    tokio::spawn(async move {
                        if let Err(e) = child.wait().await {
                            log::error!(
                                "[launch_instance] Failed to wait for game process for {}: {}",
                                iid_for_hook,
                                e
                            );
                        }
                        log::info!("[launch_instance] Game process exited for {}, running cleanup and post-exit hook if any", iid_for_hook);

                        // Unregister from piston-lib registry immediately
                        if let Err(e) =
                            piston_lib::game::launcher::registry::unregister_instance(&iid_for_hook)
                                .await
                        {
                            log::error!("[launch_instance] Failed to unregister instance {} from piston-lib registry: {}", iid_for_hook, e);
                        }
                    });
                }
            }

            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-launched",
                serde_json::json!({
                    "instance_id": instance_id,
                    "name": instance_data.name,
                    "pid": result.instance.pid,
                    "start_time": std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
                }),
            );

            apply_launcher_action_after_launch(&app_handle, resolved_launcher_action, tray_visible);

            // Update Discord activity
            if let Some(dm) = app_handle.try_state::<DiscordManager>() {
                dm.add_running_instance(&instance_data.name).await;
            }

            // Monitor process
            let app_handle_monitor = app_handle.clone();
            let instance_id_monitor = instance_id.clone();
            let instance_name_monitor = instance_data.name.clone();
            let pid_monitor = result.instance.pid;
            let started_at_monitor = result.instance.started_at.to_rfc3339();
            let game_dir_monitor = result.instance.game_dir.clone();

            tokio::spawn(async move {
                use sysinfo::System;
                let mut sys = System::new_all();
                let launch_time = std::time::SystemTime::now();

                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    sys.refresh_all();
                    if sys.process(sysinfo::Pid::from_u32(pid_monitor)).is_none() {
                        log::info!("Process exited");

                        // Update Discord activity on exit
                        if let Some(dm) = app_handle_monitor.try_state::<DiscordManager>() {
                            dm.remove_running_instance(&instance_name_monitor).await;
                        }

                        // Check exit status
                        let exit_status_path =
                            game_dir_monitor.join(".vesta").join("exit_status.json");
                        let stop_requested =
                            match piston_lib::utils::stop_intent::consume_stop_requested(
                                &game_dir_monitor,
                            ) {
                                Ok(value) => value,
                                Err(e) => {
                                    log::warn!(
                                        "Failed to consume stop-request marker for {}: {}",
                                        instance_id_monitor,
                                        e
                                    );
                                    false
                                }
                            };
                        let (exited_at_ts, exit_code) = if exit_status_path.exists() {
                            let path_for_blocking = exit_status_path.clone();
                            match tokio::task::spawn_blocking(move || {
                                std::fs::read_to_string(&path_for_blocking)
                            })
                            .await
                            {
                                Ok(Ok(content)) => {
                                    if let Ok(status) =
                                        serde_json::from_str::<serde_json::Value>(&content)
                                    {
                                        let ex = status
                                            .get("exited_at")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string();
                                        let code = status
                                            .get("exit_code")
                                            .and_then(|v| v.as_i64())
                                            .unwrap_or(0)
                                            as i32;
                                        (
                                            if ex.is_empty() {
                                                chrono::Utc::now().to_rfc3339()
                                            } else {
                                                ex
                                            },
                                            code,
                                        )
                                    } else {
                                        (chrono::Utc::now().to_rfc3339(), 0)
                                    }
                                }
                                _ => (chrono::Utc::now().to_rfc3339(), 0),
                            }
                        } else {
                            (chrono::Utc::now().to_rfc3339(), 0)
                        };

                        let mut is_crashed = false;
                        if exit_code != 0 && !stop_requested {
                            let log_file = game_dir_monitor.join("logs").join("latest.log");
                            if let Some(crash_info) = crate::utils::crash_parser::detect_crash(
                                &game_dir_monitor,
                                &log_file,
                                launch_time,
                            ) {
                                if let Err(e) =
                                    store_crash_details(&instance_id_monitor, &crash_info)
                                {
                                    log::error!("Failed to store crash: {}", e);
                                }
                                let _ = app_handle_monitor.emit(
                                    "core://instance-crashed",
                                    crash_event_payload(&instance_id_monitor, &crash_info),
                                );
                                is_crashed = true;
                            }
                        }

                        // Update playtime in database (only if not crashed)
                        if !is_crashed {
                            if let Err(e) = update_instance_playtime(
                                &app_handle_monitor,
                                &instance_id_monitor,
                                &started_at_monitor,
                                &exited_at_ts,
                            ) {
                                log::error!(
                                    "Failed to update playtime for {}: {}",
                                    instance_id_monitor,
                                    e
                                );
                            }
                        }

                        // Remove from running processes
                        if let Err(e) = crate::utils::process_state::remove_running_process(
                            &instance_id_monitor,
                        ) {
                            log::error!("Failed to remove running process: {}", e);
                        }

                        // Notify frontend
                        use tauri::Emitter;
                        // Use app_handle_monitor
                        let _ = app_handle_monitor.emit("core://instance-exited", serde_json::json!({
                             "instance_id": instance_id_monitor, "pid": pid_monitor, "crashed": is_crashed
                        }));
                        break;
                    }
                }
            });

            Ok(())
        }
        Err(e) => Err(format!("Failed to launch game: {}", e)),
    }
}

#[tauri::command]
pub async fn kill_instance(app_handle: tauri::AppHandle, inst: Instance) -> Result<String, String> {
    log::info!("[kill_instance] Kill requested for instance: {}", inst.name);
    let instance_id = inst.slug();

    match piston_lib::game::launcher::kill_instance(&instance_id).await {
        Ok(message) => {
            let _ = crate::utils::process_state::remove_running_process(&instance_id);
            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-killed",
                serde_json::json!({ "instance_id": instance_id, "name": inst.name, "message": message }),
            );
            Ok(message)
        }
        Err(e) => {
            if let Some(game_dir) = inst.game_directory.as_ref() {
                let _ = piston_lib::utils::stop_intent::clear_stop_requested(std::path::Path::new(
                    game_dir,
                ));
            }
            Err(format!("Failed to kill instance: {}", e))
        }
    }
}

#[tauri::command]
pub async fn get_running_instances() -> Result<Vec<piston_lib::game::launcher::GameInstance>, String>
{
    piston_lib::game::launcher::get_running_instances()
        .await
        .map_err(|e| format!("Failed to get running instances: {}", e))
}

#[tauri::command]
pub async fn is_instance_running(instance_data: Instance) -> Result<bool, String> {
    piston_lib::game::launcher::is_instance_running(&instance_data.slug())
        .await
        .map_err(|e| format!("Failed to check instance status: {}", e))
}

#[tauri::command]
pub async fn get_minecraft_versions(
    app_handle: tauri::AppHandle,
) -> Result<piston_lib::game::metadata::PistonMetadata, String> {
    crate::utils::manifest::load_manifest(&app_handle).await
}

#[tauri::command]
pub async fn regenerate_piston_manifest(app_handle: tauri::AppHandle) -> Result<(), String> {
    let task_manager = app_handle.state::<TaskManager>();
    task_manager
        .submit(Box::new(GenerateManifestTask::new_force_refresh()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the operation type for an instance
pub fn update_instance_operation(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    operation: &str,
) -> Result<(), String> {
    log::info!(
        "Updating last operation for instance {} to: {}",
        instance_id,
        operation
    );
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    diesel::update(instance.find(instance_id))
        .set(last_operation.eq(operation))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update last operation: {}", e))?;

    // Fetch the updated instance to emit it
    let updated: crate::models::instance::Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", process_instance_icon(updated));

    Ok(())
}

/// Fetch platform project metadata for a linked modpack and persist `modpack_icon_url`.
/// Does not replace a user-imported custom instance icon (`internal://icon`, etc.).
pub async fn hydrate_linked_modpack_metadata(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst: Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let project_id = match inst.modpack_id.as_deref() {
        Some(project_id_str) if !project_id_str.is_empty() => project_id_str.to_string(),
        _ => return Ok(()),
    };

    let platform = match inst.modpack_platform.as_deref() {
        Some("modrinth") => crate::models::SourcePlatform::Modrinth,
        Some("curseforge") => crate::models::SourcePlatform::CurseForge,
        _ => return Ok(()),
    };

    if inst.modpack_icon_url.is_some() {
        return Ok(());
    }

    let resource_manager = app_handle.state::<crate::resources::ResourceManager>();
    let refs = vec![crate::models::resource::ResourceProjectRef {
        platform,
        id: project_id.clone(),
    }];

    let records = resource_manager
        .get_or_hydrate_project_records(&refs, true, false)
        .await
        .map_err(|e| format!("Failed to hydrate modpack project: {}", e))?;

    let Some(record) = records.first() else {
        return Ok(());
    };

    let resolved_modpack_icon_url = record.icon_url.clone();
    if resolved_modpack_icon_url.is_none() {
        return Ok(());
    }

    let preserve_custom_icon = inst
        .icon_path
        .as_deref()
        .is_some_and(|p| p == "internal://icon" || p.starts_with("data:image/"));

    let mut icon_data_update: Option<Vec<u8>> = None;
    if !preserve_custom_icon && inst.icon_data.is_none() {
        if let Some(bytes) = record.icon_data.clone().filter(|b| !b.is_empty()) {
            icon_data_update = Some(bytes);
        } else if let Some(url) = resolved_modpack_icon_url.as_ref() {
            if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(url).await {
                icon_data_update = Some(bytes);
            }
        }
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    if let Some(icon_bytes) = icon_data_update {
        diesel::update(instance.find(instance_id))
            .set((
                modpack_icon_url.eq(&resolved_modpack_icon_url),
                icon_data.eq(Some(icon_bytes)),
                updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| format!("Failed to update modpack metadata: {}", e))?;
    } else {
        diesel::update(instance.find(instance_id))
            .set((
                modpack_icon_url.eq(&resolved_modpack_icon_url),
                updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| format!("Failed to update modpack metadata: {}", e))?;
    }

    let updated: Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", process_instance_icon(updated));

    log::info!(
        "[hydrate_linked_modpack_metadata] Hydrated modpack icon for instance {} project={}",
        instance_id,
        project_id
    );

    Ok(())
}

/// Update the installation status for an instance
pub fn update_installation_status(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    status: &str,
) -> Result<(), String> {
    log::info!(
        "Updating installation status for instance {} to: {}",
        instance_id,
        status
    );
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    diesel::update(instance.find(instance_id))
        .set((installation_status.eq(status), updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update installation status: {}", e))?;

    // Fetch the updated instance to emit it
    let updated: crate::models::instance::Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", process_instance_icon(updated));

    Ok(())
}

#[tauri::command]
pub async fn read_instance_log(
    instance_id_slug: String,
    last_lines: Option<usize>,
    since: Option<u64>,
) -> Result<Vec<String>, String> {
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let log_file = data_dir
        .join("data")
        .join("logs")
        .join(format!("{}.log", instance_id_slug));

    if !log_file.exists() {
        return Ok(vec![]);
    }

    if let Some(s) = since {
        if let Ok(meta) = tokio::fs::metadata(&log_file).await {
            if let Ok(mtime) = meta.modified() {
                if let Ok(duration) = mtime.duration_since(UNIX_EPOCH) {
                    if duration.as_secs() < s {
                        return Ok(vec![]);
                    }
                }
            }
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::BufRead;
        let file = std::fs::File::open(&log_file)
            .map_err(|e| format!("Failed to open log file: {}", e))?;
        let reader = std::io::BufReader::new(file);

        let lines: Vec<String> = reader.lines().filter_map(Result::ok).collect();
        if let Some(n) = last_lines {
            if lines.len() > n {
                return Ok(lines[lines.len() - n..].to_vec());
            }
        }
        Ok(lines)
    })
    .await
    .map_err(|e| format!("Failed to read log: {}", e))?
}

#[derive(serde::Serialize)]
pub struct LogFileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub last_modified: u64,
}

#[tauri::command]
pub fn get_instance_log_history(instance_id_slug: String) -> Result<Vec<LogFileInfo>, String> {
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // We check both the app-captured log and the game's logs folder
    let mut logs = Vec::new();

    // 1. App-captured log
    let session_log = data_dir
        .join("data")
        .join("logs")
        .join(format!("{}.log", instance_id_slug));

    if session_log.exists() {
        if let Ok(meta) = std::fs::metadata(&session_log) {
            logs.push(LogFileInfo {
                name: "Current Session (Launcher Captured)".to_string(),
                path: session_log.to_string_lossy().to_string(),
                size: meta.len(),
                last_modified: meta
                    .modified()
                    .unwrap_or_else(|_| std::time::SystemTime::now())
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            });
        }
    }

    // 2. Game logs folder
    // We need to find the instance directory.
    let instances_dir = data_dir.join("instances").join(&instance_id_slug);
    let game_logs_dir = instances_dir.join("logs");

    if game_logs_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(game_logs_dir) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_file() {
                    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                    if ext == "log" || ext == "gz" {
                        if let Ok(meta) = entry.metadata() {
                            logs.push(LogFileInfo {
                                name: entry.file_name().to_string_lossy().to_string(),
                                path: path.to_string_lossy().to_string(),
                                size: meta.len(),
                                last_modified: meta
                                    .modified()
                                    .unwrap_or_else(|_| std::time::SystemTime::now())
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort by last modified descending
    logs.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    Ok(logs)
}

#[tauri::command]
pub async fn read_specific_log_file(path: String) -> Result<Vec<String>, String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("Log file does not exist".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};
        let file =
            std::fs::File::open(&path_buf).map_err(|e| format!("Failed to open file: {}", e))?;

        let ext = path_buf.extension().and_then(|s| s.to_str()).unwrap_or("");

        if ext == "gz" {
            use flate2::read::GzDecoder;
            let decoder = GzDecoder::new(file);
            let reader = BufReader::new(decoder);
            let mut lines = Vec::new();
            for line in reader.lines() {
                if let Ok(l) = line {
                    lines.push(l);
                }
            }
            Ok(lines)
        } else {
            let reader = BufReader::new(file);
            let lines: Vec<String> = reader.lines().filter_map(Result::ok).collect();
            Ok(lines)
        }
    })
    .await
    .map_err(|e| format!("Failed to read log file: {}", e))?
}

#[tauri::command]
pub async fn duplicate_instance(
    _app_handle: tauri::AppHandle,
    task_manager: tauri::State<'_, TaskManager>,
    instance_id: i32,
    new_name: Option<String>,
) -> Result<(), String> {
    let task = CloneInstanceTask::new(instance_id, new_name);
    let _ = task_manager.submit(Box::new(task)).await;
    Ok(())
}

#[tauri::command]
pub async fn repair_instance(
    app_handle: tauri::AppHandle,
    task_manager: tauri::State<'_, TaskManager>,
    instance_id: i32,
    scope: Option<String>,
) -> Result<(), String> {
    // Set status to 'installing' so UI shows progress
    let _ =
        crate::commands::instances::update_instance_operation(&app_handle, instance_id, "repair");
    let _ = crate::commands::instances::update_installation_status(
        &app_handle,
        instance_id,
        "installing",
    );

    let task = match scope {
        Some(s) => RepairInstanceTask::with_scope(instance_id, s),
        None => RepairInstanceTask::new(instance_id),
    };
    let _ = task_manager.submit(Box::new(task)).await;
    Ok(())
}

#[tauri::command]
pub async fn reset_instance(
    app_handle: tauri::AppHandle,
    task_manager: tauri::State<'_, TaskManager>,
    instance_id: i32,
) -> Result<(), String> {
    // Set status to 'installing' so UI shows progress
    let _ = crate::commands::instances::update_instance_operation(
        &app_handle,
        instance_id,
        "hard-reset",
    );
    let _ = crate::commands::instances::update_installation_status(
        &app_handle,
        instance_id,
        "installing",
    );

    let task = ResetInstanceTask::new(instance_id);
    let _ = task_manager.submit(Box::new(task)).await;
    Ok(())
}

#[tauri::command]
pub async fn resume_instance_operation(
    app_handle: tauri::AppHandle,
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
) -> Result<(), String> {
    log::info!(
        "[resume_instance_operation] Resuming operation for instance ID: {}",
        instance_id
    );

    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst: Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let op = inst.last_operation.as_deref().unwrap_or("install");
    log::info!(
        "[resume_instance_operation] Detected last operation: {}",
        op
    );

    match op {
        "repair" => repair_instance(app_handle, task_manager, instance_id, None).await,
        "hard-reset" => reset_instance(app_handle, task_manager, instance_id).await,
        "external-import" => {
            let source_game_directory =
                inst.import_source_game_directory.clone().ok_or_else(|| {
                    "Cannot resume external import: missing source directory".to_string()
                })?;
            if !std::path::Path::new(&source_game_directory).exists() {
                return Err(format!(
                    "Cannot resume external import: source directory does not exist ({})",
                    source_game_directory
                ));
            }

            crate::commands::instances::update_instance_operation(
                &app_handle,
                instance_id,
                "external-import",
            )?;
            crate::commands::instances::update_installation_status(
                &app_handle,
                instance_id,
                "installing",
            )?;

            let task = ImportExternalInstanceTask::new(
                instance_id,
                inst.name.clone(),
                source_game_directory,
            );
            task_manager.submit(Box::new(task)).await
        }
        "update" => {
            let config_dir =
                crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            let data_dir = config_dir.join("data");
            let game_dir = inst
                .game_directory
                .as_ref()
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));

            let version_id = crate::tasks::update_modpack::read_pending_modpack_update(&game_dir)
                .ok_or_else(|| {
                    "Cannot resume modpack update: no pending version recorded. Open the instance Version tab to retry."
                        .to_string()
                })?;

            crate::commands::instances::update_instance_operation(
                &app_handle,
                instance_id,
                "update",
            )?;
            crate::commands::instances::update_installation_status(
                &app_handle,
                instance_id,
                "installing",
            )?;

            let task =
                crate::tasks::update_modpack::UpdateModpackTask::new(instance_id, version_id);
            task_manager.submit(Box::new(task)).await
        }
        "install" | _ => install_instance(app_handle, task_manager, inst, None).await,
    }
}

#[tauri::command]
pub async fn update_instance_modpack_version(
    app_handle: tauri::AppHandle,
    instance_id: i32,
    version_id: String,
) -> Result<(), String> {
    use crate::schema::instance::dsl::*;
    use tauri::Emitter;
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    diesel::update(instance.filter(id.eq(instance_id)))
        .set(modpack_version_id.eq(Some(version_id)))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Fetch updated instance to notify UI
    let updated: Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| e.to_string())?;
    let _ = app_handle.emit("core://instance-updated", process_instance_icon(updated));

    Ok(())
}

#[cfg(test)]
mod crash_upload_tests {
    use super::{
        enforce_mclogs_limits, read_redacted_log_file, redact_log_content, MCLOGS_MAX_BYTES,
    };

    #[test]
    fn redacts_common_private_values_before_upload() {
        let raw = "path=C:\\Users\\eatham\\.minecraft accessToken=secret --accessToken other Authorization: Bearer third server 203.0.113.10";
        let redacted = redact_log_content(raw);
        assert!(!redacted.contains("eatham"));
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("other"));
        assert!(!redacted.contains("third"));
        assert!(!redacted.contains("Bearer"));
        assert!(!redacted.contains("203.0.113.10"));
    }

    #[test]
    fn preserves_vesta_relative_path_context() {
        let raw = "/Users/eatham/Library/Application Support/VestaLauncher/instances/pack/logs/latest.log C:\\Users\\eatham\\AppData\\Roaming\\.VestaLauncher\\instances\\pack\\logs\\latest.log";
        let redacted = redact_log_content(raw);
        assert!(
            redacted.contains("<path>/VestaLauncher/instances/pack/logs/latest.log"),
            "redacted: {}",
            redacted
        );
        assert!(redacted.contains("<path>/.VestaLauncher\\instances\\pack\\logs\\latest.log"));
        assert!(!redacted.contains("eatham"));
        assert!(!redacted.contains("Application Support"));
        assert!(!redacted.contains("AppData"));
    }

    #[test]
    fn fully_redacts_non_vesta_absolute_paths() {
        let raw =
            "path=/Users/eatham/.minecraft/mods/foo.jar C:\\Users\\eatham\\.minecraft\\options.txt";
        let redacted = redact_log_content(raw);
        assert_eq!(redacted.matches("<path redacted>").count(), 2, "{redacted}");
        assert!(!redacted.contains("eatham"));
        assert!(!redacted.contains(".minecraft"));
    }

    #[test]
    fn redacts_non_vesta_paths_with_spaces_without_collapsing_formatting() {
        let raw = "prefix  path=/Users/eatham/Library/Application Support/foo.log  suffix";
        let redacted = redact_log_content(raw);
        assert_eq!(redacted, "prefix  path=<path redacted>  suffix");
        assert!(!redacted.contains("eatham"));
        assert!(!redacted.contains("Application Support"));
    }

    #[test]
    fn redacts_structured_secret_values() {
        let raw = r#"{"access_token":"json-secret","client_secret": "quoted-secret"} url=https://example.test/?access_token=url-secret&ok=1 Authorization: Bearer bearer-secret"#;
        let redacted = redact_log_content(raw);
        assert!(!redacted.contains("json-secret"));
        assert!(!redacted.contains("quoted-secret"));
        assert!(!redacted.contains("url-secret"));
        assert!(!redacted.contains("Bearer"));
        assert!(!redacted.contains("bearer-secret"));
        assert!(redacted.contains("ok=1"));
    }

    #[test]
    fn rejects_logs_over_mclogs_line_limit() {
        let content = (0..25_001).map(|_| "line").collect::<Vec<_>>().join("\n");
        assert!(enforce_mclogs_limits(&content).is_err());
    }

    #[test]
    fn rejects_logs_over_mclogs_byte_limit_before_reading() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("huge.log");
        let file = std::fs::File::create(&path).expect("create log");
        file.set_len(MCLOGS_MAX_BYTES + 1).expect("set len");

        let error = read_redacted_log_file(&path).expect_err("oversized log rejected");
        assert!(error.contains("10 MiB"));
    }
}
