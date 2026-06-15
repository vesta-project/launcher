/// Process management and game launch orchestration
use crate::game::installer::types::OsType;
use crate::game::launcher::{
    arguments::{build_game_arguments, build_jvm_arguments},
    classpath::{build_classpath_filtered, validate_classpath},
    natives::extract_natives,
    registry::register_instance,
    types::{GameInstance, LaunchResult, LaunchSpec},
    unified_manifest::UnifiedManifest,
    version_parser::resolve_version_chain,
};
use crate::utils::process::PistonCommandExt;
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;

#[cfg(windows)]
use windows_sys::Win32::Foundation::HWND;
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, IsHungAppWindow, IsWindowVisible, PostMessageW, WM_CLOSE,
};

/// Log callback type - receives (instance_id, line, stream_type)
/// stream_type is "stdout" or "stderr"
pub type LogCallback = Arc<dyn Fn(String, String, String) + Send + Sync + 'static>;

#[cfg(windows)]
fn find_main_window(pid: u32) -> Option<HWND> {
    static mut FOUND_HWND: Option<HWND> = None;
    static mut TARGET_PID: u32 = 0;

    unsafe {
        FOUND_HWND = None;
        TARGET_PID = pid;

        extern "system" fn enum_callback(hwnd: HWND, _lparam: isize) -> i32 {
            unsafe {
                let mut proc_id = 0;
                GetWindowThreadProcessId(hwnd, &mut proc_id);

                if proc_id == TARGET_PID && IsWindowVisible(hwnd) != 0 {
                    FOUND_HWND = Some(hwnd);
                    return 0; // stop enumeration
                }
                1 // continue enumeration
            }
        }

        EnumWindows(Some(enum_callback), 0);
        FOUND_HWND
    }
}

#[cfg(windows)]
fn is_process_stalled_windows(pid: u32) -> bool {
    if let Some(hwnd) = find_main_window(pid) {
        unsafe { IsHungAppWindow(hwnd) != 0 }
    } else {
        false
    }
}

/// Launch the game
///
/// If `log_callback` is provided, it will be called for each line of stdout/stderr output.
/// The callback receives (instance_id, line, stream_type) where stream_type is "stdout" or "stderr".
pub async fn launch_game(
    spec: LaunchSpec,
    log_callback: Option<LogCallback>,
) -> Result<LaunchResult> {
    log::info!("Launching game instance: {}", spec.instance_id);
    let os = OsType::current();
    log::info!(
        "[launch_game] start: instance_id={}, version_id={}, os={:?}",
        spec.instance_id,
        spec.version_id,
        os
    );

    // 1. Resolve version chain (handle inheritsFrom)
    // Prefer a loader-specific manifest (installed id) when available and
    // fall back to the vanilla manifest to preserve backward compatibility.
    let installed_id = spec.installed_version_id();
    log::info!(
        "Resolving version chain for: {} (installed id: {})",
        spec.version_id,
        installed_id
    );

    let manifest_path = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.json", installed_id));

    // TODO: Implement a lighter-weight preflight check for the loader manifest.
    // This should cheaply verify that `manifest_path` points to a readable JSON file and
    // emit a clear, user-facing error if the loader manifest is missing or obviously corrupt,
    // instead of relying solely on `resolve_version_chain` to fail later. For now, we only
    // check for existence here and assume `resolve_version_chain` will handle any deeper issues.

    let manifest = if manifest_path.exists() {
        log::info!("Found loader manifest at: {:?}", manifest_path);

        // Try to load as a pre-resolved UnifiedManifest first (this is what our installer writes)
        match UnifiedManifest::normalize_and_save_if_stale(&manifest_path) {
            Ok(m) => {
                log::info!("Successfully loaded pre-resolved UnifiedManifest");
                m
            }
            Err(e) => {
                log::info!(
                    "File at {:?} is not a UnifiedManifest, trying to resolve version chain: {}",
                    manifest_path,
                    e
                );
                let v = resolve_version_chain(&installed_id, &spec.data_dir)
                    .await
                    .context(format!(
                        "Failed to resolve version chain for loader version {}",
                        installed_id
                    ))?;
                UnifiedManifest::from(v)
            }
        }
    } else {
        log::info!(
            "No loader manifest found at {:?}, falling back to vanilla: {}",
            manifest_path,
            spec.version_id
        );
        let v = resolve_version_chain(&spec.version_id, &spec.data_dir)
            .await
            .context(format!(
                "Failed to resolve version chain for vanilla version {}",
                spec.version_id
            ))?;
        UnifiedManifest::from(v)
    };

    // 2. Verify Java installation
    verify_java(&spec.java_path).context("Java verification failed")?;

    if let Err(e) = crate::utils::stop_intent::clear_stop_requested(&spec.game_dir) {
        log::warn!(
            "Failed to clear stop-request marker for {}: {}",
            spec.instance_id,
            e
        );
    }

    // 3. Extract natives
    log::debug!("Extracting native libraries");
    // Natives are shared per version, not per instance - use spec.natives_dir()
    let natives_dir = spec.natives_dir();

    // Perform extraction
    extract_natives(&manifest.libraries, &spec.libraries_dir(), &natives_dir, os)
        .await
        .context("Failed to extract native libraries")?;

    let libraries_for_classpath = manifest.libraries.clone();

    // 4. Validate classpath requirements before building
    log::debug!("Validating classpath requirements");
    let validation = validate_classpath(&libraries_for_classpath, &spec.libraries_dir(), os)
        .context("Classpath validation failed")?;

    if !validation.missing_libraries.is_empty() {
        log::warn!(
            "Missing {} libraries: {:?}",
            validation.missing_libraries.len(),
            validation.missing_libraries
        );
        // TODO: Silent repair is disabled for now as it re-runs the full installation process.
        // We should implement a "repair-only" mode for the installer that skips metadata/cache work.
    }

    log::info!(
        "Classpath validation: {} valid, {} excluded libraries",
        validation.valid_libraries.len(),
        validation.excluded_libraries.len()
    );

    // 5. Build classpath (now guaranteed to succeed)
    log::debug!("Building classpath");

    let mut classpath =
        build_classpath_filtered(&libraries_for_classpath, &spec.libraries_dir(), os, &[])
            .context("Failed to build classpath")?;

    // Add the game JAR to classpath. Prefer a modloader-installed JAR (e.g.
    // versions/fabric-loader-.../fabric-loader-....jar) and fall back to the
    // vanilla path if the installed variant doesn't exist.
    let installed_id = spec.installed_version_id();
    let installed_jar = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.jar", installed_id));

    let vanilla_jar = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.jar", spec.version_id));

    let game_jar = if installed_jar.exists() {
        installed_jar
    } else {
        vanilla_jar
    };

    if !game_jar.exists() {
        log::error!("Game JAR not found: {:?}", game_jar);
        return Err(anyhow::anyhow!(
            "Main game JAR not found (looked for {:?}). Please try reinstalling the version.",
            game_jar
        ));
    }

    let separator = os.classpath_separator();

    classpath = format!("{}{}{}", classpath, separator, game_jar.to_string_lossy());

    // 5. Build JVM arguments (substitutes ${classpath} in manifest with our classpath string)
    log::debug!("Building JVM arguments");
    let jvm_args = build_jvm_arguments(&spec, &manifest, &natives_dir, &classpath, os);
    log::info!("Launch JVM arguments: {:?}", jvm_args);

    // 6. Build game arguments
    log::debug!("Building game arguments");
    let game_args = build_game_arguments(&spec, &manifest, os);

    // 7. Get main class
    let main_class = manifest.main_class.clone();

    // 8. Set up logging - use spec.log_file if provided, otherwise use default
    let log_file = spec.log_file.clone().unwrap_or_else(|| {
        spec.data_dir
            .join("logs")
            .join(format!("{}.log", spec.instance_id))
    });

    tokio::fs::create_dir_all(log_file.parent().unwrap()).await?;

    // 9. Construct command - may wrap with exit handler if provided
    let mut command;

    // Build the "core" game command arguments (java path and all args)
    let mut game_base_command: Vec<String> = Vec::new();
    game_base_command.push(spec.java_path.to_string_lossy().to_string());
    game_base_command.extend(jvm_args.clone());
    game_base_command.push(main_class.clone());
    game_base_command.extend(game_args.clone());

    // Resolve what the actual executable and its initial args are
    let (executable, initial_args) = if let Some(ref wrapper) = spec.wrapper_command {
        let parts = shlex::split(wrapper)
            .unwrap_or_else(|| wrapper.split_whitespace().map(|s| s.to_string()).collect());
        if parts.is_empty() {
            (spec.java_path.to_string_lossy().to_string(), Vec::new())
        } else {
            (parts[0].clone(), parts[1..].to_vec())
        }
    } else {
        (spec.java_path.to_string_lossy().to_string(), Vec::new())
    };

    if let Some(ref exit_handler_jar) = spec.exit_handler_jar {
        // Wrap with exit handler JAR
        // Structure: [Wrapper] <java> -jar <exit-handler.jar> ... -- <original game command>
        log::info!("Using exit handler JAR: {:?}", exit_handler_jar);

        let exit_file = spec.game_dir.join(".vesta").join("exit_status.json");

        // Ensure .vesta directory exists
        tokio::fs::create_dir_all(spec.game_dir.join(".vesta")).await?;

        // If we have a wrapper, the executable is the wrapper, and its FIRST argument after its own args
        // should be the java path to run the exit handler.
        // Wait, if executable is Java (no wrapper), this works too.
        command = tokio::process::Command::new(executable);
        command.args(initial_args);

        // If there WAS a wrapper, we need to push Java path as the next arg
        if spec.wrapper_command.is_some() {
            command.arg(&spec.java_path);
        }

        command.arg("-jar");
        command.arg(exit_handler_jar);
        command.arg("--instance-id");
        command.arg(&spec.instance_id);
        command.arg("--exit-file");
        command.arg(&exit_file);
        command.arg("--log-file");
        command.arg(&log_file);

        if let Some(ref pre_hook) = spec.pre_launch_hook {
            command.arg("--pre-launch-hook");
            command.arg(pre_hook);
        }

        if let Some(ref post_hook) = spec.post_exit_hook {
            command.arg("--post-exit-hook");
            command.arg(post_hook);
        }

        command.arg("--");

        // Pass the original game command (java path and all args)
        command.args(&game_base_command);
    } else {
        // No exit handler, just wrapper + game
        command = tokio::process::Command::new(executable);
        command.args(initial_args);

        // If there WAS a wrapper, we need to push Java path as the next arg
        if spec.wrapper_command.is_some() {
            command.arg(&spec.java_path);
        }

        command.args(&jvm_args);
        command.arg(&main_class);
        command.args(&game_args);
    }

    command.current_dir(&spec.game_dir);
    command.envs(&spec.env_vars);

    // Pipe stdout and stderr for real-time console streaming
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    // Configure process to be detached so it survives launcher close
    // We use our unified suppress_console and detach helper
    command.detach();

    // 10. Ensure working dir exists and is a directory, then spawn process
    if !spec.game_dir.exists() {
        // Try to create it - the installer normally creates the instance directory for installed instances,
        // but creating it as a safety net should allow direct launches for new instances
        let game_dir = spec.game_dir.clone();
        tokio::task::spawn_blocking(move || std::fs::create_dir_all(&game_dir))
            .await
            .context("spawn_blocking panicked")?
            .with_context(|| format!("Failed to create game directory {:?}", spec.game_dir))?;
    } else if !spec.game_dir.is_dir() {
        anyhow::bail!(
            "Game directory path exists but is not a directory: {:?}",
            spec.game_dir
        );
    }

    // 10. Spawn process
    log::info!("Spawning Minecraft process");
    // Log the full command for debugging. Construct a human-readable command string
    // which includes proper quoting for arguments. This is helpful for reproducing
    // the exact invocation in logs and debugging.

    // Make the quoting helper top-level so it can be unit-tested.
    fn quote_arg(s: &str) -> String {
        crate::game::launcher::process::quote_arg_internal(s)
    }

    // Log the actual command being executed (with or without exit handler wrapper)
    let full_cmd_str = if spec.exit_handler_jar.is_some() {
        let exit_file = spec.game_dir.join(".vesta").join("exit_status.json");
        let mut wrapper_cmd: Vec<String> = Vec::new();
        wrapper_cmd.push(spec.java_path.to_string_lossy().to_string());
        wrapper_cmd.push("-jar".to_string());
        wrapper_cmd.push(
            spec.exit_handler_jar
                .as_ref()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        );
        wrapper_cmd.push("--instance-id".to_string());
        wrapper_cmd.push(spec.instance_id.clone());
        wrapper_cmd.push("--exit-file".to_string());
        wrapper_cmd.push(exit_file.to_string_lossy().to_string());
        wrapper_cmd.push("--log-file".to_string());
        wrapper_cmd.push(log_file.to_string_lossy().to_string());
        wrapper_cmd.push("--".to_string());
        wrapper_cmd.extend(game_base_command.clone());
        wrapper_cmd
            .iter()
            .map(|a| quote_arg(a))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        game_base_command
            .iter()
            .map(|a| quote_arg(a))
            .collect::<Vec<_>>()
            .join(" ")
    };

    log::info!("Exec command: {}", full_cmd_str);
    log::debug!("Java: {:?}", spec.java_path);
    log::debug!("Main class: {}", main_class);
    log::debug!("Working directory: {:?}", spec.game_dir);
    if spec.exit_handler_jar.is_some() {
        log::debug!("Exit handler: {:?}", spec.exit_handler_jar);
    }

    let mut child = command.spawn().context("Failed to spawn game process")?;

    let pid = child
        .id()
        .ok_or_else(|| anyhow::anyhow!("Failed to get process ID"))?;

    log::info!("Game process started with PID: {}", pid);

    // Extract stdout and stderr for tee-ing to both file and console stream
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let log_file_clone = log_file.clone();

    // When exit handler is used, it writes to the log file directly, so we only invoke callback
    // When no exit handler, we write to both file and callback
    let use_exit_handler = spec.exit_handler_jar.is_some();

    // Spawn tasks to read stdout/stderr and write to file (if no exit handler) and invoke callback
    if let (Some(stdout), Some(stderr)) = (stdout, stderr) {
        let instance_id_stdout = spec.instance_id.clone();
        let log_file_stdout = log_file_clone.clone();
        let callback_stdout = log_callback.clone();
        let write_to_file_stdout = !use_exit_handler;
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stdout);
            let mut lines = reader.lines();

            // Only open file for writing if not using exit handler
            let mut file = if write_to_file_stdout {
                let log_file = log_file_stdout.clone();
                let file_opt = tokio::task::spawn_blocking(move || {
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&log_file)
                        .ok()
                })
                .await
                .unwrap_or(None);
                let writer = if let Some(f) = file_opt {
                    std::io::BufWriter::new(f)
                } else {
                    let log_file = log_file_stdout.clone();
                    let f = tokio::task::spawn_blocking(move || {
                        std::fs::File::create(&log_file).unwrap()
                    })
                    .await
                    .unwrap_or_else(|e| panic!("spawn_blocking panicked: {:?}", e));
                    std::io::BufWriter::new(f)
                };
                Some(writer)
            } else {
                None
            };
            use std::io::Write;

            while let Ok(Some(line)) = lines.next_line().await {
                // Write to file only if not using exit handler
                if let Some(ref mut f) = file {
                    let _ = writeln!(f, "{}", line);
                    let _ = f.flush();
                }
                // Invoke callback if provided
                if let Some(ref cb) = callback_stdout {
                    cb(instance_id_stdout.clone(), line, "stdout".to_string());
                }
            }
        });

        let instance_id_stderr = spec.instance_id.clone();
        let log_file_stderr = log_file_clone.clone();
        let callback_stderr = log_callback.clone();
        let write_to_file_stderr = !use_exit_handler;
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = reader.lines();

            // Only open file for writing if not using exit handler
            let mut file = if write_to_file_stderr {
                let log_file = log_file_stderr.clone();
                let file_opt = tokio::task::spawn_blocking(move || {
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&log_file)
                        .ok()
                })
                .await
                .unwrap_or(None);
                let writer = if let Some(f) = file_opt {
                    std::io::BufWriter::new(f)
                } else {
                    let log_file = log_file_stderr.clone();
                    let f = tokio::task::spawn_blocking(move || {
                        std::fs::File::create(&log_file).unwrap()
                    })
                    .await
                    .unwrap_or_else(|e| panic!("spawn_blocking panicked: {:?}", e));
                    std::io::BufWriter::new(f)
                };
                Some(writer)
            } else {
                None
            };
            use std::io::Write;

            while let Ok(Some(line)) = lines.next_line().await {
                // Write to file only if not using exit handler
                if let Some(ref mut f) = file {
                    let _ = writeln!(f, "{}", line);
                    let _ = f.flush();
                }
                // Invoke callback if provided
                if let Some(ref cb) = callback_stderr {
                    cb(instance_id_stderr.clone(), line, "stderr".to_string());
                }
            }
        });
    }

    // Create game instance
    let instance = GameInstance {
        instance_id: spec.instance_id.clone(),
        version_id: spec.version_id.clone(),
        modloader: spec.modloader,
        pid,
        started_at: chrono::Utc::now(),
        log_file: log_file.clone(),
        game_dir: spec.game_dir.clone(),
    };

    // Register the instance
    register_instance(instance.clone())
        .await
        .context("Failed to register instance")?;

    log::info!(
        "[launch_game] completed successfully for instance: {} (pid={})",
        spec.instance_id,
        pid
    );

    // NOTE: We transfer ownership of the child process handle to the caller.
    // The caller is responsible for waiting on the child process and calling
    // `unregister_instance` when it exits. This is to allow the caller to
    // implement their own exit-hooks or monitoring logic (e.g. in Tauri commands).
    let handle = Some(crate::game::launcher::types::ProcessHandle {
        pid,
        child: Some(child),
    });

    Ok(LaunchResult {
        instance,
        log_file,
        handle,
    })
}

/// Internal quoting helper used for logs / shell-copy; kept separate so it can be
/// unit-tested where needed.
pub(crate) fn quote_arg_internal(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }
    // Add quotes if whitespace or double-quote present; escape backslashes and double quotes
    if s.chars().any(|c| c.is_whitespace() || c == '"') {
        let esc = s.replace('\\', "\\\\").replace('"', "\\\"");
        return format!("\"{}\"", esc);
    }
    s.to_string()
}

/// Verify Java installation
fn verify_java(java_path: &Path) -> Result<()> {
    if !java_path.exists() {
        anyhow::bail!("Java executable not found: {:?}", java_path);
    }

    // Try to run java -version to verify it works
    let output = std::process::Command::new(java_path)
        .arg("-version")
        .output()
        .context("Failed to execute Java")?;

    if !output.status.success() {
        anyhow::bail!("Java executable is not working properly");
    }

    log::debug!("Java verification successful");
    Ok(())
}

/// Send a signal to a game instance process, preferring the process group when the PID is
/// its group leader (requires `command.detach()` / `setsid()` at launch).
#[cfg(unix)]
fn signal_instance(pid: u32, signal: nix::sys::signal::Signal) -> Result<()> {
    use nix::sys::signal::kill;
    use nix::unistd::{getpgid, Pid};

    let pid = pid as i32;
    let leader = Pid::from_raw(pid);
    let use_group = getpgid(Some(leader))
        .map(|pgid| pgid == leader)
        .unwrap_or(false);

    let target = if use_group {
        Pid::from_raw(-pid)
    } else {
        leader
    };

    match kill(target, signal) {
        Ok(()) => Ok(()),
        Err(e) if use_group => {
            log::warn!("Process-group signal failed ({e}); falling back to single PID");
            kill(leader, signal).map_err(Into::into)
        }
        Err(e) => Err(e.into()),
    }
}

/// Kill a running game instance
pub async fn kill_instance(instance_id: &str) -> Result<String> {
    use crate::game::launcher::registry::{get_instance, unregister_instance};

    let instance = get_instance(instance_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Instance not found: {}", instance_id))?;

    log::info!("Killing instance: {} (PID {})", instance_id, instance.pid);

    if let Err(e) = crate::utils::stop_intent::mark_stop_requested(&instance.game_dir) {
        log::warn!("Failed to mark stop request for {}: {}", instance_id, e);
    }

    #[cfg(unix)]
    let message = {
        use nix::sys::signal::Signal;

        if let Err(e) = signal_instance(instance.pid, Signal::SIGTERM) {
            log::warn!("Failed to send SIGTERM for {}: {}", instance_id, e);
        }

        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        if crate::game::launcher::registry::is_instance_running(instance_id).await? {
            log::warn!("Process didn't respond to SIGTERM, sending SIGKILL");
            signal_instance(instance.pid, Signal::SIGKILL).context("Failed to send SIGKILL")?;
            "Graceful close failed - killed with SIGKILL".to_string()
        } else {
            "Gracefully killed with SIGTERM".to_string()
        }
    };

    #[cfg(windows)]
    let message = {
        let stalled = is_process_stalled_windows(instance.pid as u32);

        if stalled {
            log::warn!("Process appears stalled; force killing");
            let output = std::process::Command::new("taskkill")
                .args(["/PID", &instance.pid.to_string(), "/T", "/F"])
                .output()
                .context("Failed to execute taskkill")?;

            if !output.status.success() {
                anyhow::bail!(
                    "Failed to kill process: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }

            "Process stalled - killed via taskkill".to_string()
        } else {
            if let Some(hwnd) = find_main_window(instance.pid as u32) {
                unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }

            if crate::game::launcher::registry::is_instance_running(instance_id).await? {
                log::warn!("Process didn't respond to WM_CLOSE, force killing");
                let output = std::process::Command::new("taskkill")
                    .args(["/PID", &instance.pid.to_string(), "/T", "/F"])
                    .suppress_console()
                    .output()
                    .context("Failed to execute taskkill")?;

                if !output.status.success() {
                    anyhow::bail!(
                        "Failed to kill process: {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                }

                "Graceful close failed - killed via taskkill".to_string()
            } else {
                "Gracefully closed with WM_CLOSE".to_string()
            }
        }
    };

    unregister_instance(instance_id).await?;
    log::info!("Instance killed: {}", instance_id);
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_java() {
        // This test will only work if Java is installed
        // Try to find java in PATH
        #[cfg(windows)]
        let java_path = std::path::PathBuf::from("java.exe");

        #[cfg(unix)]
        let java_path = std::path::PathBuf::from("java");

        // Only run if java is available
        if let Ok(full_path) = which::which(&java_path) {
            let result = verify_java(&full_path);
            assert!(result.is_ok(), "Java verification should succeed");
        }
    }
}
#[test]
fn quote_arg_internal_quotes_paths_with_spaces() {
    // a path with spaces should be quoted
    let p = r"C:\Program Files\Some Libs";
    let out = quote_arg_internal(p);
    assert!(out.starts_with('"') && out.ends_with('"'));
    assert!(out.contains("Program Files"));

    // a classpath with separators and spaces should be quoted as a single token
    let cp = r"C:\Path With Spaces\lib.jar;C:\other\lib2.jar";
    let cp_out = quote_arg_internal(cp);
    assert!(cp_out.starts_with('"') && cp_out.ends_with('"'));
    assert!(cp_out.contains("Path With Spaces"));

    // when there is no whitespace, should be returned verbatim
    let simple = "no_spaces_here";
    assert_eq!(quote_arg_internal(simple), simple.to_string());
}
