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
    instance_id: String,
    exit_code: i32,
    exited_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExitOutcome {
    pub instance_id: String,
    pub pid: u32,
    pub crashed: bool,
    /// False when the top-level PID vanished but the launch process group is
    /// still alive (common with short-lived sandbox wrappers).
    pub finished: bool,
}

pub(crate) async fn record_started_launch(
    app_handle: &tauri::AppHandle,
    inst: &Instance,
    mut launch_result: piston_lib::game::launcher::LaunchResult,
) -> Result<InstanceRunState, String> {
    let instance_id = inst.slug();

    clear_crash_flag(&instance_id, Some(app_handle))?;

    let cleanup_paths = launch_result
        .handle
        .as_ref()
        .map(|handle| handle.cleanup_paths.clone())
        .unwrap_or_default();

    let run_state = InstanceRunState {
        instance_id: instance_id.clone(),
        pid: launch_result.instance.pid,
        process_group_id: Some(capture_process_group_id(launch_result.instance.pid)),
        log_file: launch_result.log_file.clone(),
        game_dir: launch_result.instance.game_dir.clone(),
        version_id: launch_result.instance.version_id.clone(),
        modloader: launch_result
            .instance
            .modloader
            .as_ref()
            .map(|m| m.to_string()),
        started_at: launch_result.instance.started_at.to_rfc3339(),
        cleanup_paths,
        console_from_log_file: launch_result.console_from_log_file,
    };

    if let Err(e) = crate::utils::process_state::add_running_process(run_state.clone()) {
        log::warn!("Failed to persist process state: {}", e);
    }

    if let Some(handle) = launch_result.handle.take() {
        let cleanup_paths = handle.cleanup_paths;
        if let Some(mut child) = handle.child {
            let iid_for_registry = instance_id.clone();
            let game_dir_for_wait = run_state.game_dir.clone();
            let wrapper_pid = run_state.pid;
            tokio::spawn(async move {
                if let Err(e) = child.wait().await {
                    log::error!(
                        "[instance::lifecycle] Failed to wait for game process for {}: {}",
                        iid_for_registry,
                        e
                    );
                }

                // Sandbox/exit-handler wrappers can exit while the game JVM is
                // still alive (Crash Assistant child trees, SIGPIPE on pipes, OOM
                // of the wrapper). Keep temp dirs and registry entry until the
                // exit monitor confirms the game itself is gone.
                let surviving = find_java_pid_for_game_dir(&game_dir_for_wait, wrapper_pid)
                    .or_else(|| {
                        let pid_path = game_dir_for_wait.join(".vesta").join("game_pid");
                        std::fs::read_to_string(pid_path)
                            .ok()
                            .and_then(|s| s.trim().parse::<u32>().ok())
                            .filter(|pid| *pid != wrapper_pid && is_pid_running(*pid))
                    });
                if let Some(game_pid) = surviving {
                    log::warn!(
                        "[instance::lifecycle] Wrapper PID for {} exited; game PID {} still alive — deferring sandbox cleanup",
                        iid_for_registry,
                        game_pid
                    );
                    // cleanup_paths remain on InstanceRunState for final reconcile
                    let _ = cleanup_paths;
                    return;
                }

                piston_lib::game::launcher::cleanup_sandbox_paths(cleanup_paths);
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
        } else {
            piston_lib::game::launcher::cleanup_sandbox_paths(cleanup_paths);
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

    if run_state.console_from_log_file {
        spawn_log_file_follower(app_handle.clone(), run_state.clone());
    }

    Ok(run_state)
}

/// Tail session / game log files and emit `core://instance-log` while the
/// instance remains in persisted running state. Used when the exit-handler
/// owns stdio (so the launcher cannot read process pipes).
pub(crate) fn spawn_log_file_follower(app_handle: tauri::AppHandle, run_state: InstanceRunState) {
    tokio::spawn(async move {
        let session_log = run_state.log_file.clone();
        let latest_log = run_state.game_dir.join("logs").join("latest.log");
        let instance_id = run_state.instance_id.clone();

        // Session log is truncated at launch preparation; start from the
        // beginning so early exit-handler lines are not missed.
        let mut session_offset: u64 = 0;
        let mut latest_offset = tokio::task::spawn_blocking({
            let path = latest_log.clone();
            move || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
        })
        .await
        .unwrap_or(0);
        let mut session_stall_ticks: u8 = 0;
        let mut follow_latest = false;
        let mut session_carry = String::new();
        let mut latest_carry = String::new();

        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;

            let still_tracked = crate::utils::process_state::load_running_processes()
                .ok()
                .is_some_and(|procs| procs.iter().any(|p| p.instance_id == instance_id));
            if !still_tracked {
                break;
            }

            let (new_session_offset, session_chunk) = read_log_growth(
                &session_log,
                session_offset,
                &mut session_carry,
            )
            .await;
            if new_session_offset > session_offset {
                session_offset = new_session_offset;
                session_stall_ticks = 0;
            } else {
                session_stall_ticks = session_stall_ticks.saturating_add(1);
            }

            if !session_chunk.is_empty() {
                emit_console_lines(&app_handle, &instance_id, &session_chunk);
            }

            // When the exit-handler/session log stops growing but the game is
            // still alive, keep the console fed from Minecraft's own latest.log.
            if !follow_latest && session_stall_ticks >= 8 {
                if is_pid_running(run_state.pid)
                    || find_surviving_game_pid(&run_state).is_some()
                    || is_launch_alive(run_state.pid, run_state.process_group_id)
                {
                    follow_latest = true;
                    latest_offset = tokio::task::spawn_blocking({
                        let path = latest_log.clone();
                        move || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
                    })
                    .await
                    .unwrap_or(latest_offset);
                    log::info!(
                        "[instance::lifecycle] Session log stalled for {}; following {}",
                        instance_id,
                        latest_log.display()
                    );
                }
            }

            if follow_latest {
                let (new_latest_offset, latest_chunk) =
                    read_log_growth(&latest_log, latest_offset, &mut latest_carry).await;
                latest_offset = new_latest_offset;
                if !latest_chunk.is_empty() {
                    emit_console_lines(&app_handle, &instance_id, &latest_chunk);
                }
            }
        }
    });
}

fn emit_console_lines(app_handle: &tauri::AppHandle, instance_id: &str, lines: &[String]) {
    use tauri::Emitter;
    if lines.is_empty() {
        return;
    }
    let payload: Vec<serde_json::Value> = lines
        .iter()
        .map(|line| {
            serde_json::json!({
                "instance_id": instance_id,
                "line": line,
                "stream": "stdout",
            })
        })
        .collect();
    let _ = app_handle.emit(
        "core://instance-log",
        serde_json::json!({ "lines": payload }),
    );
}

async fn read_log_growth(
    path: &std::path::Path,
    offset: u64,
    carry: &mut String,
) -> (u64, Vec<String>) {
    let path = path.to_path_buf();
    let carry_in = std::mem::take(carry);
    let result = tokio::task::spawn_blocking(move || -> (u64, String, Vec<String>) {
        use std::io::{Read, Seek, SeekFrom};
        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => return (offset, carry_in, Vec::new()),
        };
        let len = meta.len();
        let mut read_from = offset;
        if len < offset {
            read_from = 0;
        }
        if len == read_from {
            return (len, carry_in, Vec::new());
        }
        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => return (offset, carry_in, Vec::new()),
        };
        if file.seek(SeekFrom::Start(read_from)).is_err() {
            return (offset, carry_in, Vec::new());
        }
        let mut buf = String::new();
        if file.read_to_string(&mut buf).is_err() {
            return (offset, carry_in, Vec::new());
        }

        let mut combined = carry_in;
        combined.push_str(&buf);
        let mut new_carry = String::new();
        let mut out_lines = Vec::new();
        let mut parts = combined.split_inclusive('\n').peekable();
        while let Some(part) = parts.next() {
            if parts.peek().is_none() && !part.ends_with('\n') {
                new_carry = part.to_string();
                break;
            }
            out_lines.push(part.trim_end_matches(['\r', '\n']).to_string());
        }
        (len, new_carry, out_lines)
    })
    .await;

    match result {
        Ok((new_offset, new_carry, lines)) => {
            *carry = new_carry;
            (new_offset, lines)
        }
        Err(_) => (offset, Vec::new()),
    }
}

pub(crate) fn spawn_exit_monitor(
    app_handle: tauri::AppHandle,
    instance_name: String,
    run_state: InstanceRunState,
) {
    tokio::spawn(async move {
        use sysinfo::System;

        let mut sys = System::new_all();
        let mut run_state = run_state;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            sys.refresh_all();
            if is_launch_alive(run_state.pid, run_state.process_group_id) {
                continue;
            }

            log::info!(
                "[instance::lifecycle] Process exited for {}",
                run_state.instance_id
            );

            match reconcile_finished_process(&app_handle, run_state.clone()).await {
                Ok(outcome) if !outcome.finished => {
                    log::info!(
                        "[instance::lifecycle] Launch still alive for {} under PID {}; resuming monitor",
                        run_state.instance_id,
                        outcome.pid
                    );
                    run_state.pid = outcome.pid;
                    run_state.process_group_id = Some(capture_process_group_id(outcome.pid));
                    if let Err(e) =
                        crate::utils::process_state::add_running_process(run_state.clone())
                    {
                        log::warn!("Failed to persist reattached process state: {}", e);
                    }
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
                    if let Err(e) =
                        piston_lib::game::launcher::register_instance(game_instance).await
                    {
                        log::warn!(
                            "Failed to re-register instance {} after wrapper exit: {}",
                            run_state.instance_id,
                            e
                        );
                    }
                    let _ = app_handle.emit(
                        "core://instance-launched",
                        serde_json::json!({
                            "instance_id": run_state.instance_id,
                            "pid": run_state.pid,
                            "reattached": true,
                        }),
                    );
                    continue;
                }
                Ok(_) => {
                    if let Some(dm) = app_handle.try_state::<DiscordManager>() {
                        dm.remove_running_instance(&instance_name).await;
                    }
                }
                Err(e) => {
                    log::error!(
                        "[instance::lifecycle] Failed to reconcile exited instance {}: {}",
                        run_state.instance_id,
                        e
                    );
                    if let Some(dm) = app_handle.try_state::<DiscordManager>() {
                        dm.remove_running_instance(&instance_name).await;
                    }
                }
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
    let mut exit_status_handled = false;

    if exit_status_path.exists() {
        match read_exit_status_file(exit_status_path.clone()).await {
            Ok(exit_status) if exit_status_belongs_to_launch(&exit_status, &run_state) => {
                exit_status_handled = true;
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
            Ok(_) => {
                log::warn!(
                    "Ignoring stale exit status file for {}",
                    run_state.instance_id
                );
            }
            Err(e) => {
                log::warn!(
                    "Failed to read exit status for {}: {}",
                    run_state.instance_id,
                    e
                );
            }
        }
    }

    if !exit_status_handled {
        if let Some(surviving_pid) = find_surviving_game_pid(&run_state) {
            log::warn!(
                "Top-level PID {} for {} exited without exit_status.json, but game PID {} is still alive; reattaching",
                run_state.pid,
                run_state.instance_id,
                surviving_pid
            );
            return Ok(ExitOutcome {
                instance_id: run_state.instance_id.clone(),
                pid: surviving_pid,
                crashed: false,
                finished: false,
            });
        }

        if is_launch_alive(run_state.pid, run_state.process_group_id) {
            log::warn!(
                "Top-level PID {} for {} is gone but the launch process group is still alive; skipping reconciliation",
                run_state.pid,
                run_state.instance_id
            );
            return Ok(ExitOutcome {
                instance_id: run_state.instance_id.clone(),
                pid: run_state.pid,
                crashed: false,
                finished: false,
            });
        } else if let Some(exited_at) = fallback_exit_time_from_log(&run_state.log_file) {
            log::info!(
                "No exit status file for {}, using log file mtime as fallback",
                run_state.instance_id
            );

            // Exit handler never reported status — treat as an abnormal exit unless
            // the user requested stop. Sandbox/profile failures often die before the
            // exit handler can write exit_status.json.
            if !stop_requested {
                crashed = detect_store_and_emit_crash(app_handle, &run_state).unwrap_or(false);
                if !crashed {
                    crashed = store_and_emit_abnormal_exit(app_handle, &run_state).unwrap_or(false);
                }
            }

            if !crashed {
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
        } else if !stop_requested {
            log::warn!(
                "No exit status file or usable log mtime for {}; treating as abnormal exit",
                run_state.instance_id
            );
            crashed = detect_store_and_emit_crash(app_handle, &run_state).unwrap_or(false);
            if !crashed {
                crashed = store_and_emit_abnormal_exit(app_handle, &run_state).unwrap_or(false);
            }
        }
    }

    let outcome = ExitOutcome {
        instance_id: run_state.instance_id.clone(),
        pid: run_state.pid,
        crashed,
        finished: true,
    };

    if !run_state.cleanup_paths.is_empty() {
        piston_lib::game::launcher::cleanup_sandbox_paths(run_state.cleanup_paths.clone());
    }

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

    if let Err(e) =
        piston_lib::game::launcher::registry::unregister_instance(&run_state.instance_id).await
    {
        log::debug!(
            "Registry unregister for {} after reconcile: {}",
            run_state.instance_id,
            e
        );
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

                for mut run_state in processes {
                    if !is_launch_alive(run_state.pid, run_state.process_group_id) {
                        if let Some(surviving_pid) = find_surviving_game_pid(&run_state) {
                            log::warn!(
                                "Persisted wrapper PID {} for {} is gone; reattaching to game PID {}",
                                run_state.pid,
                                run_state.instance_id,
                                surviving_pid
                            );
                            run_state.pid = surviving_pid;
                            run_state.process_group_id =
                                Some(capture_process_group_id(surviving_pid));
                            let _ = crate::utils::process_state::add_running_process(
                                run_state.clone(),
                            );
                        }
                    }

                    if is_launch_alive(run_state.pid, run_state.process_group_id)
                        || is_pid_running(run_state.pid)
                    {
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

fn store_and_emit_abnormal_exit(
    app_handle: &tauri::AppHandle,
    run_state: &InstanceRunState,
) -> Result<bool, String> {
    let crash_info = crate::utils::crash_parser::CrashDetails {
        crash_id: uuid::Uuid::new_v4().to_string(),
        crash_type: "launch_other".to_string(),
        category: "abnormal_exit".to_string(),
        title: "Launch ended unexpectedly".to_string(),
        message: "The game process exited before reporting a normal exit status. This often means the process was killed early (for example by an OS sandbox profile, a wrapper, or a native crash before logging)."
            .to_string(),
        evidence: Some(
            "Missing exit_status.json from the exit handler after the process disappeared."
                .to_string(),
        ),
        suspected_resources: Vec::new(),
        suspects: Vec::new(),
        suggested_fixes: vec![
            "If sandbox is enabled, try Trusted (no sandbox) to confirm the profile is the cause."
                .to_string(),
            "Check the instance log for sandbox or JVM errors.".to_string(),
            "Re-launch once; if it keeps failing, repair the instance.".to_string(),
        ],
        affected_mod_count: None,
        report_path: None,
        log_path: Some(run_state.log_file.to_string_lossy().to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        confidence: 0.7,
        mclogs_url: None,
        analysis: None,
    };

    log::error!(
        "Abnormal exit detected for {}: missing exit status file",
        run_state.instance_id
    );
    store_crash_details(&run_state.instance_id, &crash_info)?;
    let _ = app_handle.emit(
        "core://instance-crashed",
        crash_event_payload(&run_state.instance_id, &crash_info),
    );
    Ok(true)
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

fn capture_process_group_id(pid: u32) -> u32 {
    #[cfg(unix)]
    {
        let pgid = unsafe { libc::getpgid(pid as i32) };
        if pgid > 0 {
            return pgid as u32;
        }
    }
    pid
}

fn is_launch_alive(pid: u32, process_group_id: Option<u32>) -> bool {
    #[cfg(unix)]
    {
        let pgid = process_group_id.unwrap_or(pid) as i32;
        unsafe {
            if libc::kill(-pgid, 0) == 0 {
                return true;
            }
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EPERM) {
                return true;
            }
        }
    }

    is_pid_running(pid)
}

/// Prefer the exit-handler's published game PID, then fall back to scanning for a
/// still-running JVM whose command line references this instance game directory.
fn find_surviving_game_pid(run_state: &InstanceRunState) -> Option<u32> {
    let pid_path = run_state.game_dir.join(".vesta").join("game_pid");
    if let Ok(contents) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = contents.trim().parse::<u32>() {
            if pid != run_state.pid && is_pid_running(pid) {
                return Some(pid);
            }
        }
    }

    find_java_pid_for_game_dir(&run_state.game_dir, run_state.pid)
}

fn find_java_pid_for_game_dir(game_dir: &std::path::Path, exclude_pid: u32) -> Option<u32> {
    #[cfg(target_os = "linux")]
    {
        let needle = game_dir.to_string_lossy();
        let proc = std::fs::read_dir("/proc").ok()?;
        let mut matches = Vec::new();
        for entry in proc.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Ok(pid) = name.parse::<u32>() else {
                continue;
            };
            if pid == exclude_pid {
                continue;
            }
            let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
            if cmdline.is_empty() {
                continue;
            }
            let joined = cmdline
                .split(|b| *b == 0)
                .filter(|part| !part.is_empty())
                .filter_map(|part| std::str::from_utf8(part).ok())
                .collect::<Vec<_>>()
                .join(" ");
            let is_java = joined.contains("java")
                || joined.contains("KnotClient")
                || joined.contains("net.minecraft");
            let mentions_game_dir = joined.contains(needle.as_ref())
                || joined.contains(&format!("--gameDir {}", needle))
                || joined.contains(&format!("--gameDir={}", needle));
            if is_java && mentions_game_dir && is_pid_running(pid) {
                matches.push(pid);
            }
        }
        // Prefer the newest (highest) PID when multiple JVMs mention the game dir
        // (Crash Assistant + Minecraft). Minecraft is usually started first and
        // has the lower PID, but Crash Assistant's cmdline also includes gameDir
        // paths. Prefer the process whose cmdline looks like the game itself.
        if let Some(game) = matches.iter().copied().find(|pid| {
            std::fs::read(format!("/proc/{pid}/cmdline"))
                .ok()
                .map(|cmdline| {
                    let joined = cmdline
                        .split(|b| *b == 0)
                        .filter_map(|part| std::str::from_utf8(part).ok())
                        .collect::<Vec<_>>()
                        .join(" ");
                    joined.contains("KnotClient")
                        || joined.contains("net.minecraft.client.main.Main")
                        || (joined.contains("Forge") && joined.contains("minecraft"))
                })
                .unwrap_or(false)
        }) {
            return Some(game);
        }
        matches.into_iter().min()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (game_dir, exclude_pid);
        None
    }
}

fn exit_status_belongs_to_launch(
    exit_status: &ExitStatusFile,
    run_state: &InstanceRunState,
) -> bool {
    if exit_status.instance_id != run_state.instance_id {
        return false;
    }

    let Ok(started_at) = chrono::DateTime::parse_from_rfc3339(&run_state.started_at) else {
        return false;
    };
    let Ok(exited_at) = chrono::DateTime::parse_from_rfc3339(&exit_status.exited_at) else {
        return false;
    };

    exited_at + chrono::Duration::seconds(2) >= started_at
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
    use std::path::PathBuf;

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
    fn exit_status_belongs_to_launch_rejects_stale_file() {
        let run_state = InstanceRunState {
            instance_id: "demo".to_string(),
            pid: 42,
            process_group_id: Some(42),
            log_file: PathBuf::from("/tmp/test.log"),
            game_dir: PathBuf::from("/tmp/game"),
            version_id: "1.20.1".to_string(),
            modloader: None,
            started_at: "2026-07-08T10:05:00Z".to_string(),
            cleanup_paths: Vec::new(),
            console_from_log_file: false,
        };
        let stale = ExitStatusFile {
            instance_id: "demo".to_string(),
            exit_code: 1,
            exited_at: "2026-07-08T10:00:00Z".to_string(),
        };

        assert!(!exit_status_belongs_to_launch(&stale, &run_state));
    }

    #[test]
    fn exit_outcome_records_instance_pid_and_crash_state() {
        let outcome = ExitOutcome {
            instance_id: "demo".to_string(),
            pid: 42,
            crashed: true,
            finished: true,
        };

        assert_eq!(outcome.instance_id, "demo");
        assert_eq!(outcome.pid, 42);
        assert!(outcome.crashed);
        assert!(outcome.finished);
    }
}
