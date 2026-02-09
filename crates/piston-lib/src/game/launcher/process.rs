/// Process management and game launch orchestration
use crate::game::installer::types::OsType;
use crate::utils::process::PistonCommandExt;
use crate::game::launcher::{
    arguments::{build_game_arguments, build_jvm_arguments},
    classpath::{build_classpath_filtered, validate_classpath},
    natives::extract_natives,
    registry::register_instance,
    types::{GameInstance, LaunchResult, LaunchSpec},
    version_parser::resolve_version_chain,
    unified_manifest::UnifiedManifest,
};
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;

#[cfg(unix)]
use sysinfo::{Pid as SysPid, ProcessRefreshKind, ProcessStatus, System, ProcessesToUpdate};

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

    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid_sys]),
        true,
        ProcessRefreshKind::nothing().with_cpu(),
    );

    if let Some(proc1) = system.process(pid_sys) {
        if matches!(
            proc1.status(),
            ProcessStatus::Dead | ProcessStatus::Zombie | ProcessStatus::Stop
        ) {
            return true;
        }

        let cpu1 = proc1.cpu_usage();
        std::thread::sleep(std::time::Duration::from_secs(1));
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid_sys]),
            true,
            ProcessRefreshKind::nothing().with_cpu(),
        );

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

    let mut manifest = if manifest_path.exists() {
        log::info!("Found loader manifest at: {:?}", manifest_path);
        
        // Try to load as a pre-resolved UnifiedManifest first (this is what our installer writes)
        match UnifiedManifest::load_from_path(&manifest_path) {
            Ok(m) => {
                log::info!("Successfully loaded pre-resolved UnifiedManifest");
                m
            },
            Err(e) => {
                log::info!("File at {:?} is not a UnifiedManifest, trying to resolve version chain: {}", manifest_path, e);
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
        log::info!("No loader manifest found at {:?}, falling back to vanilla: {}", manifest_path, spec.version_id);
        let v = resolve_version_chain(&spec.version_id, &spec.data_dir)
            .await
            .context(format!(
                "Failed to resolve version chain for vanilla version {}",
                spec.version_id
            ))?;
        UnifiedManifest::from(v)
    };

    // Auto-repair: If manifest claims no natives, but they likely exist (stale cache), try re-resolving
    if !manifest.has_natives() && spec.modloader.is_none() {
        log::warn!("Vanilla manifest loaded from cache has no natives - checking if this is due to stale cache");
        
        let v = resolve_version_chain(&spec.version_id, &spec.data_dir)
            .await
            .context(format!(
                "Failed to resolve version chain for {}",
                spec.version_id
            ))?;
        let fresh_manifest = UnifiedManifest::from(v);
        
        if fresh_manifest.has_natives() {
            log::info!("Stale vanilla manifest detected! Replaced with fresh manifest containing natives.");
            manifest = fresh_manifest;
        } else {
            log::info!("Verified: This vanilla version legitimately has no natives.");
        }
    } else if !manifest.has_natives() {
        log::debug!("Modded manifest has no natives. This is common for modern versions (1.19+) or specialized loaders.");
    }

    // 2. Verify Java installation
    verify_java(&spec.java_path).context("Java verification failed")?;

    // 3. Extract natives
    log::debug!("Extracting native libraries");
    // Natives are shared per version, not per instance - use spec.natives_dir()
    let natives_dir = spec.natives_dir();
    
    // Perform extraction
    extract_natives(
        &manifest.libraries,
        &spec.libraries_dir(),
        &natives_dir,
        os,
    )
    .await
    .context("Failed to extract native libraries")?;

    // Quick runtime verification: ensure native libraries were actually
    // extracted into the natives dir (DLL/.so/.dylib/.jnilib) so the render system
    // and LWJGL can initialize.
    log::debug!("Verifying natives directory: {:?}", natives_dir);
    // Determine whether this manifest actually contains native libraries for THIS OS.
    let expected_native_jars = manifest.libraries.iter().filter(|l| l.is_native).count();
    let mut found_native = false;
    let mut native_files: Vec<String> = Vec::new();

    // Use a recursive check because some versions (especially Forge/Legacy) 
    // extract into subdirectories which must be scanned.
    let check_natives_recursive = |dir: &Path, files: &mut Vec<String>, found: &mut bool, os: OsType| {
        fn recursive(dir: &Path, files: &mut Vec<String>, found: &mut bool, os: OsType) {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        recursive(&path, files, found, os);
                    } else if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                        let lower = fname.to_lowercase();
                        let is_native_ext = match os {
                            OsType::Windows | OsType::WindowsArm64 => lower.ends_with(".dll"),
                            OsType::MacOS | OsType::MacOSArm64 => lower.ends_with(".dylib") || lower.ends_with(".jnilib"),
                            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => lower.ends_with(".so"),
                        };

                        if is_native_ext {
                            files.push(path.to_string_lossy().to_string());
                            *found = true;
                        }
                    }
                }
            }
        }
        recursive(dir, files, found, os);
    };

    check_natives_recursive(&natives_dir, &mut native_files, &mut found_native, os);

    if !found_native {
        if expected_native_jars == 0 {
            // Nothing found and nothing expected — normal for versions with no natives
            log::info!(
                "No native library files were found, but manifest indicates no natives are required for version {} — continuing",
                spec.version_id
            );
        } else {
            log::error!(
                "No native library files found in natives directory {:?} (expected contents from {} native JARs). This will likely cause RenderSystem failures.",
                natives_dir, expected_native_jars
            );

            anyhow::bail!(
                "No native library files found in {:?} — verify platform natives were correctly extracted",
                natives_dir
            );
        }
    } else {
        log::info!(
            "Verified natives: Found {} platform-specific library files (from {} expected native JARs) in {:?}",
            native_files.len(),
            expected_native_jars,
            natives_dir
        );
    }

    // Determine if this is a legacy version (pre-LaunchWrapper, before Minecraft 1.6)
    let is_legacy = manifest.is_legacy;
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
        os,
    ).context("Classpath validation failed")?;

    if !validation.missing_libraries.is_empty() {
        log::warn!("Missing {} libraries: {:?}", validation.missing_libraries.len(), validation.missing_libraries);
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

    // Identify libraries that are already explicitly mentioned in JVM arguments
    // (common in modern Forge for --module-path) to avoid "ResolutionException: Module ... reads more than one module"
    let mut excluded_from_classpath = Vec::new();
    for arg in &manifest.jvm_arguments {
        match arg {
            crate::game::launcher::version_parser::Argument::Simple(s) => {
                for lib in &libraries_for_classpath {
                    if s.contains(&lib.path) {
                        excluded_from_classpath.push(lib.path.clone());
                    }
                }
            }
            crate::game::launcher::version_parser::Argument::Conditional { value, .. } => {
                let values = match value {
                    crate::game::launcher::version_parser::ArgumentValue::Single(s) => vec![s],
                    crate::game::launcher::version_parser::ArgumentValue::Multiple(v) => v.iter().collect(),
                };
                for s in values {
                    for lib in &libraries_for_classpath {
                        if s.contains(&lib.path) {
                            excluded_from_classpath.push(lib.path.clone());
                        }
                    }
                }
            }
        }
    }

    if !excluded_from_classpath.is_empty() {
        log::debug!(
            "Excluding {} libraries from classpath that are already in JVM arguments: {:?}",
            excluded_from_classpath.len(),
            excluded_from_classpath
        );
    }

    let mut classpath = build_classpath_filtered(
        &libraries_for_classpath,
        &spec.libraries_dir(),
        os,
        &excluded_from_classpath,
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

    if !game_jar.exists() {
        log::error!("Game JAR not found: {:?}", game_jar);
        return Err(anyhow::anyhow!("Main game JAR not found (looked for {:?}). Please try reinstalling the version.", game_jar));
    }

    let separator = os.classpath_separator();
    
    // Check if the manifest libraries already include the game's JAR (common in modern Forge).
    // If it's already there, we SHOULD NOT add the vanilla/installed JAR manually 
    // to avoid "ResolutionException: Module ... reads more than one module" errors.
    let installed_id = spec.installed_version_id();
    let already_has_game_jar = installed_id.contains("forge-loader") || libraries_for_classpath.iter().any(|lib| {
        let name = lib.name.to_lowercase();
        // Modern Forge (1.13+) uses net.minecraftforge:forge:...:client
        // NeoForge uses net.neoforged:neoforge
        // Also check if the path contains forge or neoforge as a library
        (name.contains("net.minecraftforge:forge") && lib.classifier.as_deref() == Some("client"))
        || (name.contains("net.neoforged:neoforge"))
        || (lib.path.contains("net/minecraftforge/forge/") && lib.path.contains("-client.jar"))
        || (lib.path.contains("net/neoforged/neoforge/"))
    });

    // Detect if we are running modern Forge/NeoForge to apply special classpath rules
    let is_modern_forge = manifest.main_class.contains("cpw.mods.bootstraplauncher") 
                       || manifest.main_class.contains("net.minecraftforge.fml")
                       || manifest.main_class.contains("net.neoforged.fml");

    if already_has_game_jar {
        log::info!("Detected game JAR in libraries list, skipping manual game_jar addition to classpath.");
    } else if is_modern_forge {
        // For modern forge, if it's NOT in the libraries list, we still add it,
        // but we need to be very careful about conflicts.
        log::debug!("Modern Forge detected - adding vanilla game JAR to classpath");
        classpath = format!("{}{}{}", classpath, separator, game_jar.to_string_lossy());
    } else {
        // Standard behavior for vanilla/fabric/legacy
        classpath = format!("{}{}{}", classpath, separator, game_jar.to_string_lossy());
    }

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
    // We use our unified suppress_console and detach helper
    command.detach();

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
