/// Process management and game launch orchestration
use crate::game::launcher::{
    arguments::{build_game_arguments, build_jvm_arguments},
    classpath::{build_classpath, validate_classpath, OsType},
    natives::extract_natives,
    registry::register_instance,
    types::{GameInstance, LaunchResult, LaunchSpec},
    version_parser::{get_main_class, is_legacy_version, resolve_version_chain},
};
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;

#[cfg(unix)]
use sysinfo::{Pid as SysPid, ProcessRefreshKind, ProcessStatus, System};

#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsHungAppWindow, IsWindowVisible, PostMessageW, WM_CLOSE};
#[cfg(windows)]
use windows_sys::Win32::Foundation::HWND;


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

#[cfg(unix)]
fn is_process_stalled_unix(pid: i32) -> bool {
    let mut system = System::new();
    let pid_sys = SysPid::from(pid as usize);

    system.refresh_processes_specifics(pid_sys, ProcessRefreshKind::new().with_cpu().with_status());

    if let Some(proc1) = system.process(pid_sys) {
        if matches!(proc1.status(), ProcessStatus::Dead | ProcessStatus::Zombie | ProcessStatus::Stop) {
            return true;
        }

        let cpu1 = proc1.cpu_usage();
        std::thread::sleep(std::time::Duration::from_secs(1));
        system.refresh_processes_specifics(pid_sys, ProcessRefreshKind::new().with_cpu());

        if let Some(proc2) = system.process(pid_sys) {
            let cpu2 = proc2.cpu_usage();
            return cpu1 < 0.1 && cpu2 < 0.1;
        }
    }

    // If process disappeared or could not be read, treat as stalled/dead
    true
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
    log::info!(
        "[launch_game] start: instance_id={}, version_id={}",
        spec.instance_id,
        spec.version_id
    );

    // 1. Resolve version chain (handle inheritsFrom)
    // Prefer a loader-specific manifest (installed id) when available and
    // fall back to the vanilla manifest to preserve backward compatibility.
    let installed_id = spec.installed_version_id();
    log::debug!(
        "Resolving version chain for: {} (installed id: {})",
        spec.version_id,
        installed_id
    );
    let manifest = if spec.version_id != installed_id
        && spec
            .versions_dir()
            .join(&installed_id)
            .join(format!("{}.json", installed_id))
            .exists()
    {
        resolve_version_chain(&installed_id, &spec.data_dir)
    } else {
        resolve_version_chain(&spec.version_id, &spec.data_dir)
    }
    .await
    .context(format!(
        "Failed to resolve version chain for {}",
        spec.version_id
    ))?;

    // 2. Verify Java installation
    verify_java(&spec.java_path).context("Java verification failed")?;

    // 3. Extract natives
    log::debug!("Extracting native libraries");
    // Natives are shared per version, not per instance - use spec.natives_dir()
    let natives_dir = spec.natives_dir();
    extract_natives(
        &manifest.libraries,
        &spec.libraries_dir(),
        &natives_dir,
        OsType::current(),
    )
    .await
    .context("Failed to extract native libraries")?;

    // Quick runtime verification: ensure some native libraries were actually
    // extracted into the natives dir (DLL/.so/.dylib) so the render system
    // and LWJGL can initialize. If none are present, abort with an error that
    // includes directory diagnostics to make debugging easier.
    log::debug!("Verifying natives directory: {:?}", natives_dir);
    // Determine whether this manifest actually contains native libraries for THIS OS.
    // Some versions have no natives at all (common in some older or headless builds).
    let expected_native = crate::game::launcher::classifier::manifest_has_natives_for_os(
        &manifest,
        OsType::current().as_str(),
    );
    let mut found_native = false;
    let mut listing: Vec<String> = Vec::new();
    match tokio::fs::read_dir(&natives_dir).await {
        Ok(mut rdr) => {
            while let Ok(Some(entry)) = rdr.next_entry().await {
                let fname = entry.file_name().to_string_lossy().to_string();
                listing.push(fname.clone());
                let lower = fname.to_lowercase();
                if cfg!(target_os = "windows") {
                    if lower.ends_with(".dll") {
                        found_native = true;
                    }
                } else if cfg!(target_os = "macos") {
                    if lower.ends_with(".dylib") {
                        found_native = true;
                    }
                } else {
                    // assume unix-like
                    if lower.ends_with(".so") {
                        found_native = true;
                    }
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to read natives folder {:?}: {}", natives_dir, e);
        }
    }

    log::debug!("Natives ({:?}) contents: {:?}", natives_dir, listing);

    if !found_native {
        if !expected_native {
            // Nothing found and nothing expected — normal for versions with no natives
            log::info!(
                "No native library files were found, but manifest indicates no natives are required for version {} — continuing",
                spec.version_id
            );
        } else {
            log::error!(
                "No native library files found in natives directory {:?} — this will likely cause RenderSystem failures. Aborting launch",
                natives_dir
            );

            anyhow::bail!(
                "No native library files in {:?} — check extraction logs and verify platform natives are present",
                natives_dir
            );
        }
    }

    // Determine if this is a legacy version (pre-LaunchWrapper, before Minecraft 1.6)
    let is_legacy = is_legacy_version(&manifest);
    if is_legacy {
        log::info!(
            "Version {} detected as legacy (pre-LaunchWrapper) - using direct launch",
            spec.version_id
        );
    }

    // For legacy versions, filter out LaunchWrapper-related libraries
    // These were added retroactively by Mojang but don't work for old versions
    let libraries_for_classpath = if is_legacy {
        manifest.libraries.iter()
            .filter(|lib| {
                let name_lower = lib.name.to_lowercase();
                // Filter out LaunchWrapper and its related dependencies
                if name_lower.contains("launchwrapper") 
                    || name_lower.contains("jopt-simple")
                    || name_lower.contains("asm-all") 
                {
                    log::debug!("Filtering legacy-incompatible library: {}", lib.name);
                    false
                } else {
                    true
                }
            })
            .cloned()
            .collect::<Vec<_>>()
    } else {
        manifest.libraries.clone()
    };

    // 4. Validate classpath requirements before building
    log::debug!("Validating classpath requirements");
    let validation = validate_classpath(
        &libraries_for_classpath,
        &spec.libraries_dir(),
        OsType::current(),
    )
    .context("Classpath validation failed - missing required libraries")?;
    
    log::info!(
        "Classpath validation: {} valid, {} excluded libraries", 
        validation.valid_libraries.len(),
        validation.excluded_libraries.len()
    );

    // 5. Build classpath (now guaranteed to succeed)
    log::debug!("Building classpath");
    let mut classpath = build_classpath(
        &libraries_for_classpath,
        &spec.libraries_dir(),
        OsType::current(),
    )
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

    if game_jar.exists() {
        let separator = OsType::current().classpath_separator();
        classpath = format!("{}{}{}", classpath, separator, game_jar.to_string_lossy());
    } else {
        log::warn!("Game JAR not found: {:?}", game_jar);
    }

    // 5. Build JVM arguments (substitutes ${classpath} in manifest with our classpath string)
    log::debug!("Building JVM arguments");
    let jvm_args = build_jvm_arguments(&spec, &manifest, &natives_dir, &classpath);

    // 6. Build game arguments
    log::debug!("Building game arguments");
    let game_args = build_game_arguments(&spec, &manifest);

    // 7. Get main class
    let main_class = get_main_class(&manifest).context("Failed to get main class")?;

    // 8. Set up logging - use spec.log_file if provided, otherwise use default
    let log_file = spec
        .log_file
        .clone()
        .unwrap_or_else(|| spec.data_dir.join("logs").join(format!("{}.log", spec.instance_id)));

    tokio::fs::create_dir_all(log_file.parent().unwrap()).await?;

    // 9. Construct command - may wrap with exit handler if provided
    let mut command;
    
    // Build the original game command arguments
    let mut original_game_args: Vec<String> = Vec::new();
    original_game_args.push(spec.java_path.to_string_lossy().to_string());
    original_game_args.extend(jvm_args.clone());
    original_game_args.push(main_class.clone());
    original_game_args.extend(game_args.clone());
    
    if let Some(ref exit_handler_jar) = spec.exit_handler_jar {
        // Wrap with exit handler JAR
        // Command: <java> -jar <exit-handler.jar> --instance-id <id> --exit-file <path> --log-file <path> -- <original game command>
        log::info!("Using exit handler JAR: {:?}", exit_handler_jar);
        
        let exit_file = spec.game_dir.join(".vesta").join("exit_status.json");
        
        // Ensure .vesta directory exists
        tokio::fs::create_dir_all(spec.game_dir.join(".vesta")).await?;
        
        command = tokio::process::Command::new(&spec.java_path);
        command.arg("-jar");
        command.arg(exit_handler_jar);
        command.arg("--instance-id");
        command.arg(&spec.instance_id);
        command.arg("--exit-file");
        command.arg(&exit_file);
        command.arg("--log-file");
        command.arg(&log_file);
        command.arg("--");
        // Pass the original game command (java path and all args)
        command.args(&original_game_args);
    } else {
        // No exit handler, use original command structure
        command = tokio::process::Command::new(&spec.java_path);
        command.args(&jvm_args);
        command.arg(&main_class);
        command.args(&game_args);
    }
    
    command.current_dir(&spec.game_dir);

    // Pipe stdout and stderr for real-time console streaming
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    // Configure process to be detached so it survives launcher close
    // On Windows: Use CREATE_NEW_PROCESS_GROUP to detach from launcher
    // On Unix: Use setsid() to create new session
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        // Note: We don't use DETACHED_PROCESS (0x8) as it would prevent stdout/stderr piping
        // CREATE_NEW_PROCESS_GROUP alone allows the process to survive parent exit while
        // still allowing us to capture output
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Create a new session so the process is not a child of the launcher
        // This allows it to survive when the launcher exits
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    // 10. Ensure working dir exists and is a directory, then spawn process
    if !spec.game_dir.exists() {
        // Try to create it - the installer normally creates the instance directory for installed instances,
        // but creating it as a safety net should allow direct launches for new instances
        if let Err(e) = std::fs::create_dir_all(&spec.game_dir) {
            anyhow::bail!("Failed to create game directory {:?}: {}", spec.game_dir, e);
        }
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
        wrapper_cmd.push(spec.exit_handler_jar.as_ref().unwrap().to_string_lossy().to_string());
        wrapper_cmd.push("--instance-id".to_string());
        wrapper_cmd.push(spec.instance_id.clone());
        wrapper_cmd.push("--exit-file".to_string());
        wrapper_cmd.push(exit_file.to_string_lossy().to_string());
        wrapper_cmd.push("--log-file".to_string());
        wrapper_cmd.push(log_file.to_string_lossy().to_string());
        wrapper_cmd.push("--".to_string());
        wrapper_cmd.extend(original_game_args.clone());
        wrapper_cmd.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" ")
    } else {
        original_game_args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" ")
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
                let file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_file_stdout)
                    .ok();
                Some(std::io::BufWriter::new(file.unwrap_or_else(|| {
                    std::fs::File::create(&log_file_stdout).unwrap()
                })))
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
                let file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_file_stderr)
                    .ok();
                Some(std::io::BufWriter::new(file.unwrap_or_else(|| {
                    std::fs::File::create(&log_file_stderr).unwrap()
                })))
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

    // Spawn a background task to monitor the process exit
    let instance_id_monitor = spec.instance_id.clone();
    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) => {
                if !status.success() {
                    log::error!(
                        "Game process {} (PID {}) exited with error: {}",
                        instance_id_monitor,
                        pid,
                        status
                    );
                } else {
                    log::info!(
                        "Game process {} (PID {}) exited successfully",
                        instance_id_monitor,
                        pid
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "Failed to wait for game process {} (PID {}): {}",
                    instance_id_monitor,
                    pid,
                    e
                );
            }
        }

        // Unregister the instance when it exits
        if let Err(e) =
            crate::game::launcher::registry::unregister_instance(&instance_id_monitor).await
        {
            log::warn!(
                "Failed to unregister instance {} after exit: {}",
                instance_id_monitor,
                e
            );
        }
    });

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

    Ok(LaunchResult { instance, log_file })
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

/// Kill a running game instance
pub async fn kill_instance(instance_id: &str) -> Result<String> {
    use crate::game::launcher::registry::{get_instance, unregister_instance};

    let instance = get_instance(instance_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Instance not found: {}", instance_id))?;

    log::info!("Killing instance: {} (PID {})", instance_id, instance.pid);

    #[cfg(unix)]
    let message = {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        let pid = Pid::from_raw(instance.pid as i32);
        let stalled = is_process_stalled_unix(instance.pid as i32);

        if stalled {
            log::warn!("Process appears stalled; sending SIGKILL");
            kill(pid, Signal::SIGKILL).context("Failed to send SIGKILL")?;
            "Process stalled - killed with SIGKILL".to_string()
        } else {
            kill(pid, Signal::SIGTERM).context("Failed to send SIGTERM")?;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            if crate::game::launcher::registry::is_instance_running(instance_id).await? {
                log::warn!("Process didn't respond to SIGTERM, sending SIGKILL");
                kill(pid, Signal::SIGKILL).context("Failed to send SIGKILL")?;
                "Graceful close failed - killed with SIGKILL".to_string()
            } else {
                "Gracefully killed with SIGTERM".to_string()
            }
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
        if which::which(&java_path).is_ok() {
            let result = verify_java(&java_path);
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
