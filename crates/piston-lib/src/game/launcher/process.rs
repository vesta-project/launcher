/// Process management and game launch orchestration
use crate::game::launcher::{
    arguments::{build_game_arguments, build_jvm_arguments},
    classpath::{build_classpath_filtered, validate_classpath},
    natives::extract_natives,
    registry::register_instance,
    types::{GameInstance, LaunchResult, LaunchSpec, SandboxCommandPlacement},
};
use crate::game::runtime_plan::{RuntimePlan, RuntimeRequest};
use crate::utils::process::PistonCommandExt;
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;

struct SandboxCleanupGuard(Vec<std::path::PathBuf>);

impl SandboxCleanupGuard {
    fn disarm(&mut self) -> Vec<std::path::PathBuf> {
        std::mem::take(&mut self.0)
    }
}

impl Drop for SandboxCleanupGuard {
    fn drop(&mut self) {
        cleanup_sandbox_paths(self.0.iter().cloned());
    }
}

/// Remove private directories created by `vesta-sandbox`, rejecting arbitrary
/// paths even if a malformed LaunchSpec reaches this Adapter.
pub fn cleanup_sandbox_paths(paths: impl IntoIterator<Item = std::path::PathBuf>) {
    let temp_root = std::env::temp_dir()
        .canonicalize()
        .unwrap_or_else(|_| std::env::temp_dir());
    #[cfg(windows)]
    let windows_policy_root = std::env::var_os("LOCALAPPDATA").map(|root| {
        std::path::PathBuf::from(root)
            .join("VestaLauncher")
            .join("sandbox-profiles")
    });
    for path in paths {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let canonical_parent = path.parent().and_then(|parent| parent.canonicalize().ok());
        let owned_system_temp = file_name.starts_with("vesta-sandbox-")
            && canonical_parent
                .as_ref()
                .is_some_and(|parent| parent == &temp_root);
        #[cfg(windows)]
        let owned_windows_policy = file_name.starts_with("policy-")
            && windows_policy_root.as_ref().is_some_and(|root| {
                let root = root.canonicalize().unwrap_or_else(|_| root.clone());
                canonical_parent
                    .as_ref()
                    .is_some_and(|parent| parent == &root)
            });
        #[cfg(not(windows))]
        let owned_windows_policy = false;
        if !owned_system_temp && !owned_windows_policy {
            log::error!("Refusing to remove unrecognized sandbox cleanup path");
            continue;
        }
        if let Err(err) = std::fs::remove_dir_all(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "Failed to remove sandbox temporary directory: {:?}",
                    err.kind()
                );
            }
        }
    }
}

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HWND, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, IsHungAppWindow, IsWindowVisible, PostMessageW, WM_CLOSE,
};

/// Log callback type - receives (instance_id, line, stream_type)
/// stream_type is "stdout" or "stderr"
pub type LogCallback = Arc<dyn Fn(String, String, String) + Send + Sync + 'static>;

#[cfg(windows)]
fn find_main_window(pid: u32) -> Option<HWND> {
    struct WindowSearch {
        process_ids: std::collections::HashSet<u32>,
        found: Option<HWND>,
    }

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: isize) -> i32 {
        let search = unsafe { &mut *(lparam as *mut WindowSearch) };
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
        if search.process_ids.contains(&process_id) && unsafe { IsWindowVisible(hwnd) } != 0 {
            search.found = Some(hwnd);
            return 0;
        }
        1
    }

    let mut search = WindowSearch {
        process_ids: descendant_process_ids(pid),
        found: None,
    };
    unsafe {
        EnumWindows(
            Some(enum_callback),
            (&mut search as *mut WindowSearch) as isize,
        )
    };
    search.found
}

#[cfg(windows)]
fn descendant_process_ids(root_pid: u32) -> std::collections::HashSet<u32> {
    let mut process_ids = std::collections::HashSet::from([root_pid]);
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return process_ids;
    }

    let mut relationships = Vec::new();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        relationships.push((entry.th32ProcessID, entry.th32ParentProcessID));
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };

    loop {
        let mut changed = false;
        for &(process_id, parent_id) in &relationships {
            if process_ids.contains(&parent_id) && process_ids.insert(process_id) {
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    process_ids
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
    let plan = match RuntimePlan::resolve_installed(RuntimeRequest::from(&spec)) {
        Ok(plan) => plan,
        Err(err) => {
            drop(SandboxCleanupGuard(spec.sandbox_cleanup_paths.clone()));
            return Err(err).context("Failed to resolve runtime plan");
        }
    };
    launch_prepared_game(spec, plan, log_callback).await
}

pub async fn launch_prepared_game(
    spec: LaunchSpec,
    plan: RuntimePlan,
    log_callback: Option<LogCallback>,
) -> Result<LaunchResult> {
    let mut sandbox_cleanup = SandboxCleanupGuard(spec.sandbox_cleanup_paths.clone());
    plan.validate_launch_spec(&spec)
        .context("Prepared runtime does not match launch")?;
    log::info!("Launching game instance: {}", spec.instance_id);
    let os = plan.request.os;
    log::info!(
        "[launch_game] start: instance_id={}, version_id={}, os={:?}",
        spec.instance_id,
        spec.version_id,
        os
    );

    let manifest = plan.manifest;

    // 2. Verify Java installation. Sandboxed launches have already validated
    // Java during host launch preparation; executing `java -version` here would
    // run the selected binary outside the prepared OS sandbox.
    if spec
        .sandbox_prefix
        .as_ref()
        .is_some_and(|prefix| !prefix.is_empty())
    {
        if !spec.java_path.is_file() {
            anyhow::bail!("Java executable not found: {:?}", spec.java_path);
        }
    } else {
        verify_java(&spec.java_path).context("Java verification failed")?;
    }

    if let Err(e) = crate::utils::stop_intent::clear_stop_requested(&spec.game_dir) {
        log::warn!(
            "Failed to clear stop-request marker for {}: {}",
            spec.instance_id,
            e
        );
    }

    // 3. Extract natives
    log::debug!("Extracting native libraries");
    let natives_dir = plan.natives_dir;

    // Perform extraction
    extract_natives(&manifest.libraries, &plan.libraries_dir, &natives_dir, os)
        .await
        .context("Failed to extract native libraries")?;

    let libraries_for_classpath = manifest.libraries.clone();

    // 4. Validate classpath requirements before building
    log::debug!("Validating classpath requirements");
    let validation = validate_classpath(&libraries_for_classpath, &plan.libraries_dir, os)
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
        build_classpath_filtered(&libraries_for_classpath, &plan.libraries_dir, os, &[])
            .context("Failed to build classpath")?;

    let game_jar = plan.client_jar;

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
    log::debug!("Built {} JVM arguments (values omitted)", jvm_args.len());

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
    let has_user_wrapper = spec
        .wrapper_command
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false);
    validate_sandbox_command_graph(
        spec.sandbox_command_placement,
        spec.sandbox_prefix.as_deref(),
        spec.exit_handler_jar.is_some(),
        spec.pre_launch_hook.is_some() || spec.post_exit_hook.is_some(),
        has_user_wrapper,
        spec.sandbox_wraps_entire_command,
    )?;
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

    let delegate_sandbox_to_exit_handler = spec.exit_handler_jar.is_some()
        && spec.sandbox_command_placement == SandboxCommandPlacement::GameAndHooks;
    let (executable, initial_args) = if delegate_sandbox_to_exit_handler {
        // Windows keeps the launcher-owned exit supervisor outside the
        // AppContainer. It will create independently restricted helper
        // invocations for hooks and the actual game JVM.
        (executable, initial_args)
    } else {
        apply_sandbox_prefix(
            executable,
            initial_args,
            has_user_wrapper,
            &spec.sandbox_prefix,
            spec.sandbox_wraps_entire_command,
        )
    };

    if let Some(ref exit_handler_jar) = spec.exit_handler_jar {
        // Wrap with exit handler JAR
        // Structure: [Wrapper] <java> -jar <exit-handler.jar> ... -- <original game command>
        log::info!("Using exit handler JAR: {:?}", exit_handler_jar);

        let exit_file = spec.game_dir.join(".vesta").join("exit_status.json");

        // Ensure .vesta directory exists and drop stale exit status from a prior run.
        let vesta_dir = spec.game_dir.join(".vesta");
        tokio::fs::create_dir_all(&vesta_dir).await?;
        let _ = tokio::fs::remove_file(vesta_dir.join("exit_status.json")).await;
        let _ = tokio::fs::remove_file(vesta_dir.join("game_pid")).await;

        // If we have a wrapper, the executable is the wrapper, and its FIRST argument after its own args
        // should be the java path to run the exit handler.
        // Wait, if executable is Java (no wrapper), this works too.
        command = tokio::process::Command::new(&executable);
        command.args(&initial_args);

        if has_user_wrapper {
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

        if delegate_sandbox_to_exit_handler {
            command.args(exit_handler_sandbox_args(&spec.sandbox_prefix));
        }

        command.arg("--");

        // Pass the original game command (java path and all args)
        command.args(&game_base_command);
    } else {
        // No exit handler, just wrapper + game
        command = tokio::process::Command::new(&executable);
        command.args(&initial_args);

        if has_user_wrapper {
            command.arg(&spec.java_path);
        }

        command.args(&jvm_args);
        command.arg(&main_class);
        command.args(&game_args);
    }

    command.current_dir(&spec.game_dir);
    command.envs(&spec.env_vars);

    // stdin is null so a closed launcher tty cannot SIGHUP the sandbox session.
    command.stdin(Stdio::null());
    if spec.exit_handler_jar.is_some() {
        // Exit handler writes the session log itself. Leaving stdout/stderr piped
        // to the launcher caused SIGPIPE / sticky PrintStream errors that killed
        // console streaming (and sometimes the wrapper JVM) under sandbox.
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());
    } else {
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
    }

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
    // Arguments (including JVM properties and hook bodies) can contain account
    // tokens or arbitrary user secrets. Do not reconstruct a command for logs.
    if spec.sandbox_prefix.is_some() {
        log::info!("OS sandbox prefix is active");
    }
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
        cleanup_paths: sandbox_cleanup.disarm(),
    });

    Ok(LaunchResult {
        instance,
        log_file,
        handle,
        console_from_log_file: use_exit_handler,
    })
}

fn validate_sandbox_command_graph(
    placement: SandboxCommandPlacement,
    sandbox_prefix: Option<&[String]>,
    has_exit_handler: bool,
    has_hooks: bool,
    has_user_wrapper: bool,
    sandbox_wraps_entire_command: bool,
) -> Result<()> {
    if placement != SandboxCommandPlacement::GameAndHooks {
        return Ok(());
    }
    if sandbox_prefix.is_none_or(|prefix| prefix.is_empty()) {
        anyhow::bail!("GameAndHooks sandbox placement requires a non-empty sandbox command prefix");
    }
    if !has_exit_handler && has_hooks {
        anyhow::bail!(
            "GameAndHooks sandbox placement requires an exit supervisor when hooks are configured"
        );
    }
    if has_user_wrapper && sandbox_wraps_entire_command {
        anyhow::bail!(
            "GameAndHooks cannot place a generic wrapper inside the no-child sandbox boundary; use wrapper-outside"
        );
    }
    Ok(())
}

/// Encode a prefix as repeated option/value pairs so no quoting or delimiter
/// convention can alter an argument. The Java exit supervisor reconstructs the
/// exact vector and prepends it to the game and hook shell commands.
fn exit_handler_sandbox_args(sandbox_prefix: &Option<Vec<String>>) -> Vec<String> {
    sandbox_prefix
        .as_deref()
        .unwrap_or_default()
        .iter()
        .flat_map(|arg| ["--sandbox-prefix-arg".to_string(), arg.clone()])
        .collect()
}

/// Apply an optional OS sandbox argv prefix around the resolved executable.
///
/// - `wraps_entire_command`: sandbox becomes the new executable and wraps the
///   previous executable (including a user wrapper).
/// - otherwise (wrapper-outside): keep the user wrapper as executable and append
///   the sandbox prefix before Java is pushed by the caller.
fn apply_sandbox_prefix(
    executable: String,
    initial_args: Vec<String>,
    has_user_wrapper: bool,
    sandbox_prefix: &Option<Vec<String>>,
    wraps_entire_command: bool,
) -> (String, Vec<String>) {
    let Some(prefix) = sandbox_prefix.as_ref() else {
        return (executable, initial_args);
    };
    if prefix.is_empty() {
        return (executable, initial_args);
    }

    if wraps_entire_command || !has_user_wrapper {
        let mut args = prefix[1..].to_vec();
        args.push(executable);
        args.extend(initial_args);
        (prefix[0].clone(), args)
    } else {
        let mut args = initial_args;
        args.extend(prefix.iter().cloned());
        (executable, args)
    }
}

/// Verify Java installation
fn verify_java(java_path: &Path) -> Result<()> {
    if !java_path.exists() {
        anyhow::bail!("Java executable not found: {:?}", java_path);
    }

    // Try to run java -version to verify it works
    let output = std::process::Command::new(java_path)
        .arg("-version")
        .suppress_console()
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
                .suppress_console()
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

    #[test]
    fn sandbox_outside_wraps_the_user_wrapper() {
        let prefix = Some(vec![
            "/usr/bin/sandbox-exec".to_string(),
            "-p".to_string(),
            "profile".to_string(),
        ]);
        let (executable, args) = apply_sandbox_prefix(
            "/usr/local/bin/wrapper".to_string(),
            vec!["--wrapper-arg".to_string()],
            true,
            &prefix,
            true,
        );

        assert_eq!(executable, "/usr/bin/sandbox-exec");
        assert_eq!(
            args,
            vec!["-p", "profile", "/usr/local/bin/wrapper", "--wrapper-arg"]
        );
    }

    #[test]
    fn wrapper_outside_places_the_sandbox_before_java() {
        let prefix = Some(vec![
            "/usr/bin/sandbox-exec".to_string(),
            "-p".to_string(),
            "profile".to_string(),
        ]);
        let (executable, args) = apply_sandbox_prefix(
            "/usr/local/bin/wrapper".to_string(),
            vec!["--wrapper-arg".to_string()],
            true,
            &prefix,
            false,
        );

        assert_eq!(executable, "/usr/local/bin/wrapper");
        assert_eq!(
            args,
            vec!["--wrapper-arg", "/usr/bin/sandbox-exec", "-p", "profile"]
        );
    }

    #[test]
    fn exit_handler_receives_lossless_repeated_sandbox_prefix_arguments() {
        let prefix = Some(vec![
            r"C:\Program Files\Vesta\vesta-sandbox-exec.exe".to_string(),
            "--windows-policy".to_string(),
            r"C:\Temp\policy with spaces.json".to_string(),
            "--".to_string(),
        ]);

        assert_eq!(
            exit_handler_sandbox_args(&prefix),
            vec![
                "--sandbox-prefix-arg",
                r"C:\Program Files\Vesta\vesta-sandbox-exec.exe",
                "--sandbox-prefix-arg",
                "--windows-policy",
                "--sandbox-prefix-arg",
                r"C:\Temp\policy with spaces.json",
                "--sandbox-prefix-arg",
                "--",
            ]
        );
    }

    #[test]
    fn game_and_hooks_placement_fails_closed_without_a_prefix() {
        for prefix in [None, Some(Vec::<String>::new())] {
            assert!(validate_sandbox_command_graph(
                SandboxCommandPlacement::GameAndHooks,
                prefix.as_deref(),
                true,
                false,
                false,
                true,
            )
            .is_err());
        }
    }

    #[test]
    fn game_and_hooks_rejects_unsupervised_hooks_and_enclosed_wrappers() {
        let prefix = ["vesta-sandbox-exec".to_string()];
        assert!(validate_sandbox_command_graph(
            SandboxCommandPlacement::GameAndHooks,
            Some(&prefix),
            false,
            true,
            false,
            true,
        )
        .is_err());
        assert!(validate_sandbox_command_graph(
            SandboxCommandPlacement::GameAndHooks,
            Some(&prefix),
            true,
            false,
            true,
            true,
        )
        .is_err());
        assert!(validate_sandbox_command_graph(
            SandboxCommandPlacement::GameAndHooks,
            Some(&prefix),
            true,
            true,
            true,
            false,
        )
        .is_ok());
    }

    #[test]
    fn sandbox_cleanup_only_removes_owned_temp_directories() {
        let owned = tempfile::Builder::new()
            .prefix("vesta-sandbox-")
            .tempdir()
            .unwrap()
            .keep();
        let unrelated = tempfile::Builder::new()
            .prefix("unrelated-")
            .tempdir()
            .unwrap();

        cleanup_sandbox_paths([owned.clone(), unrelated.path().to_path_buf()]);

        assert!(!owned.exists());
        assert!(unrelated.path().exists());
    }

    #[test]
    #[cfg(windows)]
    fn sandbox_cleanup_removes_owned_windows_policy_directories() {
        let root = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap())
            .join("VestaLauncher")
            .join("sandbox-profiles");
        std::fs::create_dir_all(&root).unwrap();
        let owned = tempfile::Builder::new()
            .prefix("policy-")
            .tempdir_in(root)
            .unwrap()
            .keep();

        cleanup_sandbox_paths([owned.clone()]);

        assert!(!owned.exists());
    }
}
