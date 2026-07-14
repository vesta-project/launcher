//! App-specific lifecycle for running instances.
//!
//! `piston-lib` owns Minecraft launch correctness. This Module owns Vesta's
//! app policy around a running process: persisted run state, startup reattach,
//! exit reconciliation, crash/playtime updates, and UI events.

use crate::discord::DiscordManager;
use crate::models::instance::Instance;
use crate::schema::instance::dsl as instance_dsl;
use crate::utils::db::get_vesta_conn;
use crate::utils::process_state::InstanceRunState;
use diesel::prelude::*;
use std::time::SystemTime;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct ExitStatusFile {
    #[serde(rename = "instance_id")]
    _instance_id: String,
    exit_code: i32,
    exited_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExitOutcome {
    pub instance_id: String,
    pub pid: u32,
    pub crashed: bool,
}

pub(crate) async fn record_started_launch(
    app_handle: &tauri::AppHandle,
    inst: &Instance,
    mut launch_result: piston_lib::game::launcher::LaunchResult,
) -> Result<InstanceRunState, String> {
    let instance_id = inst.slug();

    clear_crash_flag(&instance_id, Some(app_handle))?;

    let run_state = InstanceRunState {
        instance_id: instance_id.clone(),
        pid: launch_result.instance.pid,
        log_file: launch_result.log_file.clone(),
        game_dir: launch_result.instance.game_dir.clone(),
        version_id: launch_result.instance.version_id.clone(),
        modloader: launch_result
            .instance
            .modloader
            .as_ref()
            .map(|m| m.to_string()),
        started_at: launch_result.instance.started_at.to_rfc3339(),
    };

    if let Err(e) = crate::utils::process_state::add_running_process(run_state.clone()) {
        log::warn!("Failed to persist process state: {}", e);
    }

    if let Some(handle) = launch_result.handle.take() {
        if let Some(mut child) = handle.child {
            let iid_for_registry = instance_id.clone();
            tokio::spawn(async move {
                if let Err(e) = child.wait().await {
                    log::error!(
                        "[instance::lifecycle] Failed to wait for game process for {}: {}",
                        iid_for_registry,
                        e
                    );
                }
                if let Err(e) =
                    piston_lib::game::launcher::registry::unregister_instance(&iid_for_registry)
                        .await
                {
                    log::error!(
                        "[instance::lifecycle] Failed to unregister instance {} from piston-lib registry: {}",
                        iid_for_registry,
                        e
                    );
                }
            });
        }
    }

    let _ = app_handle.emit(
        "core://instance-launched",
        serde_json::json!({
            "instance_id": instance_id,
            "name": inst.name,
            "pid": run_state.pid,
            "start_time": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        }),
    );

    if let Some(dm) = app_handle.try_state::<DiscordManager>() {
        dm.add_running_instance(&inst.name).await;
    }

    Ok(run_state)
}

pub(crate) fn spawn_exit_monitor(
    app_handle: tauri::AppHandle,
    instance_name: String,
    run_state: InstanceRunState,
) {
    tokio::spawn(async move {
        use sysinfo::System;

        let mut sys = System::new_all();
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            sys.refresh_all();
            if sys.process(sysinfo::Pid::from_u32(run_state.pid)).is_some() {
                continue;
            }

            log::info!(
                "[instance::lifecycle] Process exited for {}",
                run_state.instance_id
            );

            if let Some(dm) = app_handle.try_state::<DiscordManager>() {
                dm.remove_running_instance(&instance_name).await;
            }

            if let Err(e) = reconcile_finished_process(&app_handle, run_state.clone()).await {
                log::error!(
                    "[instance::lifecycle] Failed to reconcile exited instance {}: {}",
                    run_state.instance_id,
                    e
                );
            }
            break;
        }
    });
}

pub(crate) async fn reconcile_finished_process(
    app_handle: &tauri::AppHandle,
    run_state: InstanceRunState,
) -> Result<ExitOutcome, String> {
    let exit_status_path = run_state.game_dir.join(".vesta").join("exit_status.json");
    let stop_requested = consume_stop_requested(&run_state.game_dir, &run_state.instance_id);
    let mut crashed = false;

    if exit_status_path.exists() {
        match read_exit_status_file(exit_status_path.clone()).await {
            Ok(exit_status) => {
                log::info!(
                    "Found exit status for {}: exit_code={}, exited_at={}",
                    run_state.instance_id,
                    exit_status.exit_code,
                    exit_status.exited_at
                );

                if should_check_for_crash(exit_status.exit_code, stop_requested) {
                    crashed = detect_store_and_emit_crash(app_handle, &run_state).unwrap_or(false);
                }

                if !crashed {
                    if let Err(error) = update_instance_playtime(
                        app_handle,
                        &run_state.instance_id,
                        &run_state.started_at,
                        &exit_status.exited_at,
                    ) {
                        log::error!(
                            "Failed to update playtime for {}: {}",
                            run_state.instance_id,
                            error
                        );
                    }
                }

                if let Err(e) = std::fs::remove_file(&exit_status_path) {
                    log::warn!("Failed to remove exit status file: {}", e);
                }
            }
            Err(e) => {
                log::warn!(
                    "Failed to read exit status for {}: {}",
                    run_state.instance_id,
                    e
                );
            }
        }
    } else if let Some(exited_at) = fallback_exit_time_from_log(&run_state.log_file) {
        log::info!(
            "No exit status file for {}, using log file mtime as fallback",
            run_state.instance_id
        );
        if let Err(error) = update_instance_playtime(
            app_handle,
            &run_state.instance_id,
            &run_state.started_at,
            &exited_at,
        ) {
            log::error!(
                "Failed to update playtime for {} (fallback): {}",
                run_state.instance_id,
                error
            );
        }
    }

    let outcome = ExitOutcome {
        instance_id: run_state.instance_id.clone(),
        pid: run_state.pid,
        crashed,
    };

    let _ = app_handle.emit(
        "core://instance-exited",
        serde_json::json!({
            "instance_id": outcome.instance_id,
            "pid": outcome.pid,
            "crashed": outcome.crashed,
        }),
    );

    if let Err(e) = crate::utils::process_state::remove_running_process(&run_state.instance_id) {
        log::error!("Failed to remove running process: {}", e);
    }

    Ok(outcome)
}

pub(crate) fn reattach_or_reconcile_persisted_processes(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        log::info!("Checking for already-running instances...");

        match crate::utils::process_state::load_running_processes() {
            Ok(processes) => {
                if processes.is_empty() {
                    log::debug!("No persisted running processes found");
                    return;
                }

                log::info!("Found {} persisted running processes", processes.len());

                for run_state in processes {
                    if is_pid_running(run_state.pid) {
                        if let Err(e) = reattach_running_process(&app_handle, &run_state).await {
                            log::warn!(
                                "Failed to reattach instance {}: {}",
                                run_state.instance_id,
                                e
                            );
                        }
                    } else {
                        log::warn!(
                            "Persisted instance {} (PID {}) is no longer running, checking for exit status",
                            run_state.instance_id,
                            run_state.pid
                        );
                        if let Err(e) =
                            reconcile_finished_process(&app_handle, run_state.clone()).await
                        {
                            log::error!(
                                "Failed to reconcile persisted instance {}: {}",
                                run_state.instance_id,
                                e
                            );
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to load persisted running processes: {}", e);
            }
        }
    });
}

pub(crate) async fn kill_instance(
    app_handle: tauri::AppHandle,
    inst: Instance,
) -> Result<String, String> {
    log::info!("[kill_instance] Kill requested for instance: {}", inst.name);
    let instance_id = inst.slug();

    match piston_lib::game::launcher::kill_instance(&instance_id).await {
        Ok(message) => {
            let _ = crate::utils::process_state::remove_running_process(&instance_id);
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

async fn reattach_running_process(
    app_handle: &tauri::AppHandle,
    run_state: &InstanceRunState,
) -> Result<(), String> {
    log::info!(
        "Reattaching to running instance: {} (PID {})",
        run_state.instance_id,
        run_state.pid
    );

    let game_instance = piston_lib::game::launcher::GameInstance {
        instance_id: run_state.instance_id.clone(),
        version_id: run_state.version_id.clone(),
        modloader: run_state
            .modloader
            .as_ref()
            .map(|s| s.parse())
            .transpose()
            .ok()
            .flatten(),
        pid: run_state.pid,
        started_at: chrono::DateTime::parse_from_rfc3339(&run_state.started_at)
            .ok()
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(chrono::Utc::now),
        log_file: run_state.log_file.clone(),
        game_dir: run_state.game_dir.clone(),
    };

    piston_lib::game::launcher::register_instance(game_instance)
        .await
        .map_err(|e| format!("Failed to re-register instance: {}", e))?;

    let _ = app_handle.emit(
        "core://instance-launched",
        serde_json::json!({
            "instance_id": run_state.instance_id,
            "pid": run_state.pid,
            "reattached": true
        }),
    );

    log::info!(
        "Successfully reattached to instance: {}",
        run_state.instance_id
    );
    Ok(())
}

pub(crate) fn clear_crash_flag(
    instance_id_slug: &str,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let all_instances = instance_dsl::instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in all_instances {
        if inst.slug() == instance_id_slug {
            diesel::update(instance_dsl::instance.filter(instance_dsl::id.eq(inst.id)))
                .set((
                    instance_dsl::crashed.eq(false),
                    instance_dsl::crash_details.eq::<Option<String>>(None),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to clear crash flag: {}", e))?;

            if let Some(app_handle) = app_handle {
                let updated = instance_dsl::instance
                    .find(inst.id)
                    .first::<Instance>(&mut conn)
                    .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;
                let _ = app_handle.emit(
                    "core://instance-updated",
                    crate::commands::instances::process_instance_icon(updated),
                );
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

fn update_instance_playtime(
    app_handle: &tauri::AppHandle,
    instance_id_slug: &str,
    started_at_str: &str,
    exited_at_str: &str,
) -> Result<(), String> {
    let minutes = playtime_minutes(started_at_str, exited_at_str)?;

    log::info!(
        "Updating playtime for instance {}: {} minutes (from {} to {})",
        instance_id_slug,
        minutes,
        started_at_str,
        exited_at_str
    );

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let instances_list = instance_dsl::instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in instances_list {
        if inst.slug() == instance_id_slug {
            let new_playtime = inst.total_playtime_minutes + minutes;
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            diesel::update(instance_dsl::instance.filter(instance_dsl::id.eq(inst.id)))
                .set((
                    instance_dsl::total_playtime_minutes.eq(new_playtime),
                    instance_dsl::last_played.eq(&now),
                    instance_dsl::updated_at.eq(&now),
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

            if let Ok(updated_inst) = instance_dsl::instance
                .find(inst.id)
                .first::<Instance>(&mut conn)
            {
                let _ = app_handle.emit(
                    "core://instance-updated",
                    crate::commands::instances::process_instance_icon(updated_inst),
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

pub(crate) fn store_crash_details(
    instance_id_slug: &str,
    crash_info: &crate::utils::crash_parser::CrashDetails,
) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let all_instances = instance_dsl::instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in all_instances {
        if inst.slug() == instance_id_slug {
            let crash_details_json = serde_json::to_string(crash_info)
                .map_err(|e| format!("Failed to serialize crash details: {}", e))?;

            diesel::update(instance_dsl::instance.filter(instance_dsl::id.eq(inst.id)))
                .set((
                    instance_dsl::crashed.eq(true),
                    instance_dsl::crash_details.eq(crash_details_json),
                ))
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

fn detect_store_and_emit_crash(
    app_handle: &tauri::AppHandle,
    run_state: &InstanceRunState,
) -> Result<bool, String> {
    let launch_start_time = launch_start_time(&run_state.started_at);
    if let Some(crash_info) = crate::utils::crash_parser::detect_crash(
        &run_state.game_dir,
        &run_state.log_file,
        launch_start_time,
    ) {
        log::error!(
            "Crash detected for {}: {:?}",
            run_state.instance_id,
            crash_info
        );
        store_crash_details(&run_state.instance_id, &crash_info)?;
        let _ = app_handle.emit(
            "core://instance-crashed",
            crash_event_payload(&run_state.instance_id, &crash_info),
        );
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn crash_event_payload(
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

async fn read_exit_status_file(path: std::path::PathBuf) -> Result<ExitStatusFile, String> {
    tokio::task::spawn_blocking(move || -> Result<ExitStatusFile, String> {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read exit status file {:?}: {}", path, e))?;
        serde_json::from_str::<ExitStatusFile>(&content)
            .map_err(|e| format!("Failed to parse exit status file {:?}: {}", path, e))
    })
    .await
    .map_err(|e| format!("Failed to join exit status reader: {}", e))?
}

fn consume_stop_requested(game_dir: &std::path::Path, instance_id: &str) -> bool {
    match piston_lib::utils::stop_intent::consume_stop_requested(game_dir) {
        Ok(value) => value,
        Err(e) => {
            log::warn!(
                "Failed to consume stop-request marker for {}: {}",
                instance_id,
                e
            );
            false
        }
    }
}

fn should_check_for_crash(exit_code: i32, stop_requested: bool) -> bool {
    exit_code != 0 && !stop_requested
}

fn playtime_minutes(started_at_str: &str, exited_at_str: &str) -> Result<i32, String> {
    let started = chrono::DateTime::parse_from_rfc3339(started_at_str)
        .map_err(|e| format!("Failed to parse started_at: {}", e))?;
    let exited = chrono::DateTime::parse_from_rfc3339(exited_at_str)
        .map_err(|e| format!("Failed to parse exited_at: {}", e))?;
    let duration = exited.signed_duration_since(started);
    Ok((duration.num_seconds() / 60).max(0) as i32)
}

fn launch_start_time(started_at_str: &str) -> SystemTime {
    chrono::DateTime::parse_from_rfc3339(started_at_str)
        .map(SystemTime::from)
        .unwrap_or_else(|_| SystemTime::now())
}

fn fallback_exit_time_from_log(log_file: &std::path::Path) -> Option<String> {
    let metadata = std::fs::metadata(log_file).ok()?;
    let modified = metadata.modified().ok()?;
    Some(chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339())
}

fn is_pid_running(pid: u32) -> bool {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();
    sys.process(sysinfo::Pid::from_u32(pid)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn playtime_minutes_rounds_down_and_never_negative() {
        assert_eq!(
            playtime_minutes("2026-07-08T10:00:00Z", "2026-07-08T10:05:59Z").unwrap(),
            5
        );
        assert_eq!(
            playtime_minutes("2026-07-08T10:05:00Z", "2026-07-08T10:00:00Z").unwrap(),
            0
        );
    }

    #[test]
    fn stop_intent_prevents_crash_check_for_nonzero_exit() {
        assert!(should_check_for_crash(1, false));
        assert!(!should_check_for_crash(1, true));
        assert!(!should_check_for_crash(0, false));
    }

    #[test]
    fn fallback_exit_time_uses_log_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("latest.log");
        std::fs::File::create(&log)
            .unwrap()
            .write_all(b"hello")
            .unwrap();

        assert!(fallback_exit_time_from_log(&log).is_some());
        assert!(fallback_exit_time_from_log(&dir.path().join("missing.log")).is_none());
    }

    #[test]
    fn exit_outcome_records_instance_pid_and_crash_state() {
        let outcome = ExitOutcome {
            instance_id: "demo".to_string(),
            pid: 42,
            crashed: true,
        };

        assert_eq!(outcome.instance_id, "demo");
        assert_eq!(outcome.pid, 42);
        assert!(outcome.crashed);
    }
}
