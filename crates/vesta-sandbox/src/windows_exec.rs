//! Windows AppContainer launch helper.
//!
//! The helper stays outside the AppContainer, synchronizes a stable
//! per-instance package SID's access to the resolved policy roots, launches
//! the target with AppContainer capabilities, and waits while retaining a
//! kill-on-close Job.

use crate::policy::{PathAccess, SandboxPolicy};
use rappct::acl::{grant_to_package, AccessMask, ResourcePath};
use rappct::{
    launch_in_container_with_io, AppContainerProfile, KnownCapability, LaunchOptions,
    SecurityCapabilitiesBuilder, StdioConfig,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const FILE_GENERIC_READ: u32 = 1_179_785;
const FILE_GENERIC_WRITE: u32 = 1_179_926;
const FILE_GENERIC_EXECUTE: u32 = 1_179_808;
const FILE_LIST_DIRECTORY: u32 = 0x0000_0001;
const DIRECTORY_RESOLVE_ACCESS: u32 = FILE_GENERIC_EXECUTE | FILE_LIST_DIRECTORY;
const ACL_JOURNAL_FORMAT_VERSION: u32 = 2;
const DELETE: u32 = 65_536;
const FILE_DELETE_CHILD: u32 = 64;
const WRITE_AUTHORITY: u32 = 0x0002 | 0x0004 | 0x0010 | 0x0040 | 0x0100 | DELETE;
const WINDOWS_HELPER_PROTOCOL_VERSION: &str = "5";

pub fn windows_helper_path() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in [
                "vesta-sandbox-exec.exe",
                "vesta-sandbox-exec-x86_64-pc-windows-msvc.exe",
                "vesta-sandbox-exec-aarch64-pc-windows-msvc.exe",
            ] {
                let candidate = dir.join(name);
                if compatible_windows_helper(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }

    // Release builds trust only the helper bundled beside the launcher. PATH,
    // build-directory, and environment overrides are development conveniences
    // and must never turn a missing production sidecar into arbitrary code
    // execution outside the sandbox.
    if !cfg!(debug_assertions) {
        return None;
    }
    if let Some(path) = option_env!("CARGO_BIN_EXE_vesta_sandbox_exec").map(PathBuf::from) {
        if compatible_windows_helper(&path) {
            return Some(path);
        }
    }
    if let Some(path) = option_env!("VESTA_SANDBOX_EXEC").map(PathBuf::from) {
        if compatible_windows_helper(&path) {
            return Some(path);
        }
    }
    if let Ok(path) = std::env::var("VESTA_SANDBOX_EXEC") {
        let path = PathBuf::from(path);
        if compatible_windows_helper(&path) {
            return Some(path);
        }
    }
    for profile in ["debug", "release"] {
        let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target")
            .join(profile)
            .join("vesta-sandbox-exec.exe");
        if compatible_windows_helper(&candidate) {
            return candidate.canonicalize().ok();
        }
    }
    which::which("vesta-sandbox-exec.exe")
        .ok()
        .filter(|path| compatible_windows_helper(path))
}

fn compatible_windows_helper(path: &Path) -> bool {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    path.is_file()
        && std::process::Command::new(path)
            .arg("--windows-helper-protocol-version")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|output| {
                output.status.success()
                    && String::from_utf8_lossy(&output.stdout).trim()
                        == WINDOWS_HELPER_PROTOCOL_VERSION
            })
}

pub fn run_windows_exec_cli<I, S>(args: I) -> i32
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args
        .into_iter()
        .map(|arg| arg.as_ref().to_string())
        .collect();
    if args
        .get(1)
        .is_some_and(|arg| arg == "--windows-helper-protocol-version")
    {
        println!("{WINDOWS_HELPER_PROTOCOL_VERSION}");
        return 0;
    }
    if args
        .get(1)
        .is_some_and(|arg| arg == "--windows-filesystem-probe")
    {
        return run_filesystem_probe();
    }
    if args
        .get(1)
        .is_some_and(|arg| arg == "--windows-restricted-target")
    {
        return match run_restricted_target(&args) {
            Ok(code) => code as i32,
            Err(err) => {
                eprintln!("Windows restricted target launch failed: {err}");
                1
            }
        };
    }

    match parse_cli(&args).and_then(|invocation| run_invocation(&invocation)) {
        Ok(code) => code as i32,
        Err(err) => {
            eprintln!("Windows sandbox launch failed: {err}");
            1
        }
    }
}

struct Invocation {
    policy_path: PathBuf,
    program: PathBuf,
    args: Vec<String>,
}

fn parse_cli(args: &[String]) -> Result<Invocation, String> {
    if args.len() < 5 || args[1] != "--windows-policy" {
        return Err(
            "usage: vesta-sandbox-exec --windows-policy <policy.json> -- <program> [args...]"
                .to_string(),
        );
    }
    let separator = args
        .iter()
        .position(|arg| arg == "--")
        .ok_or_else(|| "missing `--` separator before target program".to_string())?;
    if separator != 3 {
        return Err("unexpected argument before `--` separator".to_string());
    }
    let program = args
        .get(separator + 1)
        .ok_or_else(|| "no target program provided after `--`".to_string())?;
    Ok(Invocation {
        policy_path: PathBuf::from(&args[2]),
        program: PathBuf::from(program),
        args: args[separator + 2..].to_vec(),
    })
}

fn run_invocation(invocation: &Invocation) -> Result<u32, String> {
    let policy_bytes = std::fs::read(&invocation.policy_path).map_err(|err| {
        format!(
            "could not read policy {}: {err}",
            invocation.policy_path.display()
        )
    })?;
    let policy: SandboxPolicy = serde_json::from_slice(&policy_bytes)
        .map_err(|err| format!("invalid Windows sandbox policy: {err}"))?;
    if !policy.enabled {
        return Err("Windows helper refuses a disabled sandbox policy".to_string());
    }

    let canonical_program = std::fs::canonicalize(&invocation.program).map_err(|err| {
        format!(
            "target program {} could not be canonicalized: {err}",
            invocation.program.display()
        )
    })?;
    if !policy
        .exec_allowlist
        .iter()
        .any(|allowed| path_matches_exec_allowlist(allowed, &canonical_program))
    {
        return Err(format!(
            "target program {} is outside the executable allowlist",
            canonical_program.display()
        ));
    }
    let profile_name = profile_name_for_policy(&policy)?;
    // A restricted target shares this AppContainer identity with its broker.
    // Serialize the complete lifetime per profile so no already-running target
    // can race a newly created broker before that broker hardens its own DACL.
    let _profile_launch_lock = acquire_profile_launch_lock(&profile_name)?;
    let profile = AppContainerProfile::ensure(
        &profile_name,
        "Vesta Play Sandbox",
        Some("Per-instance Vesta Minecraft sandbox"),
    )
    .map_err(|err| format!("could not create AppContainer profile: {err}"))?;
    // The trusted sidecar runs briefly inside AppContainer as a trampoline so
    // it can create the real target with the token-level no-child policy. Its
    // executable is an Adapter implementation detail, not portable exec intent.
    let broker_program = std::fs::canonicalize(
        std::env::current_exe()
            .map_err(|err| format!("could not resolve sandbox sidecar: {err}"))?,
    )
    .map_err(|err| format!("could not canonicalize sandbox sidecar: {err}"))?;
    let mut access_policy = policy.clone();
    if !access_policy
        .exec_allowlist
        .iter()
        .any(|path| windows_paths_equal(path, &broker_program))
    {
        access_policy.exec_allowlist.push(broker_program.clone());
    }
    sync_policy_access(&profile, &access_policy, &profile_name)?;
    // Java 25 canonicalizes java.home one component at a time with
    // FindFirstFile. A standard user cannot add an AppContainer ACE to the
    // shared C:\Users directory, even though the declared JRE itself is
    // allowlisted. Launch Java through a short-lived DOS drive rooted directly
    // at its runtime so canonicalization never crosses that shared directory.
    let java_runtime_drive = JavaRuntimeDrive::for_program(&canonical_program)?;
    if java_runtime_drive.is_some()
        && invocation
            .args
            .iter()
            .any(|arg| arg.starts_with("-Djava.home="))
    {
        return Err(
            "sandboxed Java reserves java.home for its allowlisted runtime mapping".to_string(),
        );
    }
    let launch_program = java_runtime_drive
        .as_ref()
        .map(|drive| drive.program.clone())
        .unwrap_or_else(|| win32_process_path(&canonical_program));

    // A registry-read compatibility capability keeps Win32/JVM startup working
    // while adding no filesystem, network, microphone, or device authority.
    let mut capability_builder =
        SecurityCapabilitiesBuilder::new(&profile.sid).with_named(&["registryRead"]);
    if policy.network_allowed {
        capability_builder = capability_builder.with_known(&[
            KnownCapability::InternetClient,
            KnownCapability::InternetClientServer,
            KnownCapability::PrivateNetworkClientServer,
        ]);
    }
    if policy.mic_allowed {
        capability_builder = capability_builder.with_named(&["microphone"]);
    }
    let capabilities = capability_builder
        .build()
        .map_err(|err| format!("could not derive AppContainer capabilities: {err}"))?;
    // Assign the sidecar before target creation. Windows automatically places
    // its descendants in the same Job, eliminating the create-then-assign race.
    // The raw handle intentionally remains open until this helper exits.
    let _job = attach_current_process_to_kill_job()?;

    let mut environment: Vec<_> = std::env::vars_os().collect();
    environment.sort_by(|(left, _), (right, _)| {
        left.to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&right.to_string_lossy().to_ascii_lowercase())
    });
    let mut broker_args = vec![
        "--windows-restricted-target".to_string(),
        "--".to_string(),
        launch_program.to_string_lossy().into_owned(),
    ];
    broker_args.extend(invocation.args.iter().cloned());
    let mut child = launch_in_container_with_io(
        &capabilities,
        &LaunchOptions {
            exe: win32_process_path(&broker_program),
            cmdline: build_command_line(&broker_args),
            cwd: Some(
                std::env::current_dir()
                    .map_err(|err| format!("could not resolve sandbox working directory: {err}"))?,
            ),
            // CreateProcess with an AppContainer security-capabilities attribute
            // is unreliable with a null environment on supported Windows builds.
            // The sidecar already inherited the launcher's complete environment
            // plus policy overrides, so forward that exact environment explicitly.
            env: Some(environment),
            // CreateProcess cannot reliably inherit the launcher's redirected
            // handles through this security boundary. Relay explicit pipes so
            // Minecraft logs still reach piston-lib unchanged.
            stdio: StdioConfig::Pipe,
            suspended: false,
            join_job: None,
            startup_timeout: None,
        },
    )
    .map_err(|err| format!("CreateProcess AppContainer launch failed: {err}"))?;

    let stdout_relay = child.stdout.take().map(|mut source| {
        std::thread::spawn(move || -> io::Result<()> {
            let mut destination = io::stdout().lock();
            io::copy(&mut source, &mut destination)?;
            destination.flush()
        })
    });
    let stderr_relay = child.stderr.take().map(|mut source| {
        std::thread::spawn(move || -> io::Result<()> {
            let mut destination = io::stderr().lock();
            io::copy(&mut source, &mut destination)?;
            destination.flush()
        })
    });

    let wait_result = child
        .wait(None)
        .map_err(|err| format!("waiting for AppContainer process failed: {err}"));
    join_relay(stdout_relay, "stdout")?;
    join_relay(stderr_relay, "stderr")?;
    wait_result
}

struct NamedMutexGuard(windows_sys::Win32::Foundation::HANDLE);

impl Drop for NamedMutexGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::System::Threading::ReleaseMutex(self.0);
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

struct JavaRuntimeDrive {
    program: PathBuf,
    device_name: Vec<u16>,
    target_name: Vec<u16>,
    mutex: windows_sys::Win32::Foundation::HANDLE,
}

impl JavaRuntimeDrive {
    fn for_program(program: &Path) -> Result<Option<Self>, String> {
        let is_java = program
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.eq_ignore_ascii_case("java.exe") || name.eq_ignore_ascii_case("javaw.exe")
            });
        if !is_java {
            return Ok(None);
        }
        let java_home = program
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| format!("Java executable has no runtime root: {}", program.display()))?;
        let relative_program = program.strip_prefix(java_home).map_err(|_| {
            format!(
                "Java executable {} is outside its inferred runtime {}",
                program.display(),
                java_home.display()
            )
        })?;
        let target = java_drive_target(java_home)?;

        use windows_sys::Win32::Foundation::{
            CloseHandle, ERROR_FILE_NOT_FOUND, WAIT_ABANDONED, WAIT_OBJECT_0,
        };
        use windows_sys::Win32::Storage::FileSystem::{
            DefineDosDeviceW, QueryDosDeviceW, DDD_NO_BROADCAST_SYSTEM, DDD_RAW_TARGET_PATH,
        };
        use windows_sys::Win32::System::Threading::{
            CreateMutexW, ReleaseMutex, WaitForSingleObject,
        };

        for letter in (b'D'..=b'Z').rev() {
            let drive = format!("{}:", letter as char);
            let device_name: Vec<u16> = drive.encode_utf16().chain(Some(0)).collect();
            let mutex_name: Vec<u16> = format!("Local\\VestaSandboxJavaDrive-{}", letter as char)
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr()) };
            if mutex.is_null() {
                continue;
            }
            let wait = unsafe { WaitForSingleObject(mutex, 0) };
            if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
                unsafe { CloseHandle(mutex) };
                continue;
            }

            let mut existing = [0u16; 512];
            let occupied = unsafe {
                QueryDosDeviceW(
                    device_name.as_ptr(),
                    existing.as_mut_ptr(),
                    existing.len() as u32,
                ) != 0
            };
            if occupied
                || io::Error::last_os_error().raw_os_error() != Some(ERROR_FILE_NOT_FOUND as i32)
            {
                unsafe {
                    ReleaseMutex(mutex);
                    CloseHandle(mutex);
                }
                continue;
            }

            let target_name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
            let defined = unsafe {
                DefineDosDeviceW(
                    DDD_RAW_TARGET_PATH | DDD_NO_BROADCAST_SYSTEM,
                    device_name.as_ptr(),
                    target_name.as_ptr(),
                )
            };
            if defined == 0 {
                unsafe {
                    ReleaseMutex(mutex);
                    CloseHandle(mutex);
                }
                continue;
            }

            return Ok(Some(Self {
                program: PathBuf::from(format!("{}:\\", letter as char)).join(relative_program),
                device_name,
                target_name,
                mutex,
            }));
        }

        Err("no free DOS drive is available for sandboxed Java path resolution".to_string())
    }
}

impl Drop for JavaRuntimeDrive {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            DefineDosDeviceW, DDD_EXACT_MATCH_ON_REMOVE, DDD_NO_BROADCAST_SYSTEM,
            DDD_RAW_TARGET_PATH, DDD_REMOVE_DEFINITION,
        };
        use windows_sys::Win32::System::Threading::ReleaseMutex;

        unsafe {
            DefineDosDeviceW(
                DDD_REMOVE_DEFINITION
                    | DDD_EXACT_MATCH_ON_REMOVE
                    | DDD_RAW_TARGET_PATH
                    | DDD_NO_BROADCAST_SYSTEM,
                self.device_name.as_ptr(),
                self.target_name.as_ptr(),
            );
            ReleaseMutex(self.mutex);
            CloseHandle(self.mutex);
        }
    }
}

fn java_drive_target(java_home: &Path) -> Result<String, String> {
    let path = java_home.to_string_lossy();
    if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        return Ok(format!(r"\??\UNC\{unc}"));
    }
    if let Some(dos) = path.strip_prefix(r"\\?\") {
        return Ok(format!(r"\??\{dos}"));
    }
    if let Some(unc) = path.strip_prefix(r"\\") {
        return Ok(format!(r"\??\UNC\{unc}"));
    }
    if java_home.is_absolute() {
        return Ok(format!(r"\??\{path}"));
    }
    Err(format!(
        "Java runtime path is not absolute: {}",
        java_home.display()
    ))
}

fn acquire_named_mutex(name: &str, purpose: &str) -> Result<NamedMutexGuard, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{CreateMutexW, WaitForSingleObject, INFINITE};

    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return Err(format!(
            "could not create {purpose} mutex: {}",
            io::Error::last_os_error()
        ));
    }
    let wait = unsafe { WaitForSingleObject(handle, INFINITE) };
    if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
        unsafe {
            CloseHandle(handle);
        }
        return Err(format!(
            "could not acquire {purpose} mutex: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(NamedMutexGuard(handle))
}

fn acquire_profile_launch_lock(profile_name: &str) -> Result<NamedMutexGuard, String> {
    acquire_named_mutex(
        &format!(r"Local\VestaSandboxLaunch-{profile_name}"),
        "per-profile launch",
    )
}

fn acquire_acl_reconciliation_lock() -> Result<NamedMutexGuard, String> {
    // Different instance profiles share launcher resource and JRE roots. ACL
    // updates are read/modify/write operations, so serialize them across every
    // profile or concurrent launches can lose (or resurrect) another SID ACE.
    acquire_named_mutex(
        r"Local\VestaSandboxAclReconciliation-v2",
        "cross-profile ACL reconciliation",
    )
}

/// Create the real AppContainer target with a token-level prohibition on child
/// process creation. This mode runs only inside the AppContainer trampoline
/// launched by [`run_invocation`]; the target inherits that AppContainer token
/// and only the three standard-I/O handles.
fn run_restricted_target(args: &[String]) -> Result<u32, String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{
        CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, GetExitCodeProcess, InitializeProcThreadAttributeList,
        UpdateProcThreadAttribute, WaitForSingleObject, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
        PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };
    use windows_sys::Win32::System::WindowsProgramming::PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;

    if args.get(2).is_none_or(|arg| arg != "--") {
        return Err(
            "usage: vesta-sandbox-exec --windows-restricted-target -- <program> [args...]"
                .to_string(),
        );
    }
    let program = args
        .get(3)
        .ok_or_else(|| "restricted target program is missing".to_string())?;
    // The outer trusted sidecar already canonicalized and allowlist-checked the
    // target before entering AppContainer. Re-canonicalizing here can require
    // metadata access to undeclared ancestor directories.
    let program = win32_process_path(Path::new(program));

    let stdin = io::stdin();
    let stdout = io::stdout();
    let stderr = io::stderr();
    let handles: [HANDLE; 3] = [
        stdin.as_raw_handle().cast(),
        stdout.as_raw_handle().cast(),
        stderr.as_raw_handle().cast(),
    ];
    for handle in handles {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err("sandbox trampoline received an invalid standard-I/O handle".to_string());
        }
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
            return Err(format!(
                "could not make sandbox standard-I/O handle inheritable: {}",
                io::Error::last_os_error()
            ));
        }
    }

    let mut attribute_bytes = 0usize;
    unsafe {
        InitializeProcThreadAttributeList(std::ptr::null_mut(), 2, 0, &mut attribute_bytes);
    }
    if attribute_bytes == 0 {
        return Err(format!(
            "could not size restricted process attributes: {}",
            io::Error::last_os_error()
        ));
    }
    let word_size = std::mem::size_of::<usize>();
    let mut attribute_storage = vec![0usize; attribute_bytes.div_ceil(word_size)];
    let attribute_list = attribute_storage.as_mut_ptr().cast();
    if unsafe { InitializeProcThreadAttributeList(attribute_list, 2, 0, &mut attribute_bytes) } == 0
    {
        return Err(format!(
            "could not initialize restricted process attributes: {}",
            io::Error::last_os_error()
        ));
    }
    struct AttributeListGuard(windows_sys::Win32::System::Threading::LPPROC_THREAD_ATTRIBUTE_LIST);
    impl Drop for AttributeListGuard {
        fn drop(&mut self) {
            unsafe {
                windows_sys::Win32::System::Threading::DeleteProcThreadAttributeList(self.0);
            }
        }
    }
    let _attribute_guard = AttributeListGuard(attribute_list);

    let child_policy = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
    if unsafe {
        UpdateProcThreadAttribute(
            attribute_list,
            0,
            PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY as usize,
            (&child_policy as *const u32).cast(),
            std::mem::size_of::<u32>(),
            std::ptr::null_mut(),
            std::ptr::null(),
        )
    } == 0
    {
        return Err(format!(
            "could not set no-child process policy: {}",
            io::Error::last_os_error()
        ));
    }
    if unsafe {
        UpdateProcThreadAttribute(
            attribute_list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            handles.as_ptr().cast(),
            std::mem::size_of_val(&handles),
            std::ptr::null_mut(),
            std::ptr::null(),
        )
    } == 0
    {
        return Err(format!(
            "could not restrict inherited target handles: {}",
            io::Error::last_os_error()
        ));
    }

    deny_dangerous_broker_handles()?;

    // Expose the broker PID only to adversarial tests. Production targets do
    // not need to know that a trusted trampoline exists.
    if std::env::var_os("VESTA_WINDOWS_SANDBOX_TEST_BROKER").is_some() {
        std::env::set_var("VESTA_SANDBOX_BROKER_PID", std::process::id().to_string());
    } else {
        std::env::remove_var("VESTA_SANDBOX_BROKER_PID");
    }
    let application: Vec<u16> = program.as_os_str().encode_wide().chain(Some(0)).collect();
    let command_line = std::iter::once(program.to_string_lossy().into_owned())
        .chain(args[4..].iter().cloned())
        .map(|arg| quote_windows_arg(&arg))
        .collect::<Vec<_>>()
        .join(" ");
    let mut command_line: Vec<u16> = command_line.encode_utf16().chain(Some(0)).collect();
    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attribute_list;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT,
            std::ptr::null(),
            std::ptr::null(),
            &startup.StartupInfo,
            &mut process,
        )
    } == 0
    {
        return Err(format!(
            "CreateProcess with no-child policy failed: {}",
            io::Error::last_os_error()
        ));
    }

    unsafe {
        CloseHandle(process.hThread);
    }
    let wait = unsafe { WaitForSingleObject(process.hProcess, INFINITE) };
    if wait == u32::MAX {
        unsafe {
            CloseHandle(process.hProcess);
        }
        return Err(format!(
            "waiting for restricted target failed: {}",
            io::Error::last_os_error()
        ));
    }
    let mut exit_code = 0u32;
    if unsafe { GetExitCodeProcess(process.hProcess, &mut exit_code) } == 0 {
        unsafe {
            CloseHandle(process.hProcess);
        }
        return Err(format!(
            "could not read restricted target exit code: {}",
            io::Error::last_os_error()
        ));
    }
    unsafe {
        CloseHandle(process.hProcess);
    }
    Ok(exit_code)
}

/// Deny the soon-to-be-created target enough access to use this trusted
/// trampoline as a process-creation or memory-injection proxy. The outer
/// sidecar already owns its wait handle, so prepending this deny ACE does not
/// disrupt lifecycle supervision.
fn deny_dangerous_broker_handles() -> Result<(), String> {
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Authorization::{
        GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, DENY_ACCESS, EXPLICIT_ACCESS_W,
        NO_MULTIPLE_TRUSTEE, SE_KERNEL_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP,
        TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        CreateWellKnownSid, WinCreatorOwnerRightsSid, WinWorldSid, ACL, DACL_SECURITY_INFORMATION,
        NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID, SECURITY_MAX_SID_SIZE,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, PROCESS_ALL_ACCESS};

    let mut everyone_storage = [0u8; SECURITY_MAX_SID_SIZE as usize];
    let mut everyone_size = everyone_storage.len() as u32;
    let everyone: PSID = everyone_storage.as_mut_ptr().cast();
    if unsafe {
        CreateWellKnownSid(
            WinWorldSid,
            std::ptr::null_mut(),
            everyone,
            &mut everyone_size,
        )
    } == 0
    {
        return Err(format!(
            "could not derive broker deny SID: {}",
            io::Error::last_os_error()
        ));
    }

    // A process owner is otherwise implicitly entitled to WRITE_DAC even when
    // the DACL denies that bit. An OWNER RIGHTS ACE makes the owner's access
    // fully subject to the DACL, preventing the same-user/AppContainer target
    // from removing the broker deny ACE before attacking the trampoline.
    let mut owner_rights_storage = [0u8; SECURITY_MAX_SID_SIZE as usize];
    let mut owner_rights_size = owner_rights_storage.len() as u32;
    let owner_rights: PSID = owner_rights_storage.as_mut_ptr().cast();
    if unsafe {
        CreateWellKnownSid(
            WinCreatorOwnerRightsSid,
            std::ptr::null_mut(),
            owner_rights,
            &mut owner_rights_size,
        )
    } == 0
    {
        return Err(format!(
            "could not derive broker owner-rights SID: {}",
            io::Error::last_os_error()
        ));
    }

    let mut old_acl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            GetCurrentProcess(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_acl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(format!("could not inspect broker process ACL: {status}"));
    }

    let deny_entry = |sid: PSID| EXPLICIT_ACCESS_W {
        grfAccessPermissions: PROCESS_ALL_ACCESS,
        grfAccessMode: DENY_ACCESS,
        grfInheritance: NO_INHERITANCE,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
            ptstrName: sid.cast(),
        },
    };
    let denies = [deny_entry(everyone), deny_entry(owner_rights)];
    let mut hardened_acl: *mut ACL = std::ptr::null_mut();
    let acl_status = unsafe {
        SetEntriesInAclW(
            denies.len() as u32,
            denies.as_ptr(),
            old_acl,
            &mut hardened_acl,
        )
    };
    if acl_status != 0 {
        unsafe {
            LocalFree(descriptor.cast::<core::ffi::c_void>() as HLOCAL);
        }
        return Err(format!("could not build broker deny ACL: {acl_status}"));
    }
    let set_status = unsafe {
        SetSecurityInfo(
            GetCurrentProcess(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hardened_acl,
            std::ptr::null_mut(),
        )
    };
    unsafe {
        LocalFree(hardened_acl.cast::<core::ffi::c_void>() as HLOCAL);
        LocalFree(descriptor.cast::<core::ffi::c_void>() as HLOCAL);
    }
    if set_status != 0 {
        return Err(format!("could not harden broker process ACL: {set_status}"));
    }
    Ok(())
}

struct ProcessTreeJob {
    _handle: windows_sys::Win32::Foundation::HANDLE,
}

fn attach_current_process_to_kill_job() -> Result<ProcessTreeJob, String> {
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(format!(
                "could not create process-tree Job: {}",
                io::Error::last_os_error()
            ));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            return Err(format!(
                "could not configure process-tree Job: {}",
                io::Error::last_os_error()
            ));
        }
        if AssignProcessToJobObject(handle, GetCurrentProcess()) == 0 {
            return Err(format!(
                "could not atomically contain the sandbox helper in its Job: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(ProcessTreeJob { _handle: handle })
    }
}

fn join_relay(
    relay: Option<std::thread::JoinHandle<io::Result<()>>>,
    stream: &str,
) -> Result<(), String> {
    let Some(relay) = relay else {
        return Ok(());
    };
    relay
        .join()
        .map_err(|_| format!("AppContainer {stream} relay panicked"))?
        .map_err(|err| format!("AppContainer {stream} relay failed: {err}"))
}

fn win32_process_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(dos) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(dos);
    }
    path.to_path_buf()
}

fn profile_name_for_policy(policy: &SandboxPolicy) -> Result<String, String> {
    let scope = policy
        .filesystem_allowlist
        .iter()
        .find(|entry| entry.write && entry.recursive && entry.path.is_dir())
        .ok_or_else(|| "Windows sandbox policy has no writable instance scope".to_string())?;
    // Fixed FNV-1a keeps profile names stable across compiler/library upgrades.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in scope.path.to_string_lossy().to_ascii_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!("com.vesta.play.{hash:016x}"))
}

fn path_matches_exec_allowlist(allowed: &Path, program: &Path) -> bool {
    let Ok(allowed) = std::fs::canonicalize(allowed) else {
        return false;
    };
    if allowed.is_dir() {
        windows_path_starts_with(program, &allowed)
    } else {
        windows_paths_equal(program, &allowed)
    }
}

fn windows_paths_equal(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

fn windows_path_starts_with(path: &Path, root: &Path) -> bool {
    let path_components: Vec<OsString> = path
        .components()
        .map(|part| part.as_os_str().to_os_string())
        .collect();
    let root_components: Vec<OsString> = root
        .components()
        .map(|part| part.as_os_str().to_os_string())
        .collect();
    path_components.len() >= root_components.len()
        && path_components
            .iter()
            .zip(root_components.iter())
            .all(|(left, right)| {
                left.to_string_lossy()
                    .eq_ignore_ascii_case(&right.to_string_lossy())
            })
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
struct AclEntry {
    path: PathBuf,
    access: u32,
    recursive: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AclJournal {
    #[serde(default)]
    format_version: u32,
    committed: bool,
    entries: Vec<AclEntry>,
}

fn sync_policy_access(
    profile: &AppContainerProfile,
    policy: &SandboxPolicy,
    profile_name: &str,
) -> Result<(), String> {
    // Production callers already hold the per-profile lifetime mutex. Always
    // acquire this cross-profile lock second and keep it across the complete
    // journal plus DACL transaction.
    let _acl_reconciliation_lock = acquire_acl_reconciliation_lock()?;
    let desired = compile_acl_entries(policy);
    let journal_path = acl_journal_path(profile_name)?;
    let journal_root = journal_path
        .parent()
        .ok_or_else(|| "sandbox ACL journal has no parent directory".to_string())?;
    if desired.iter().any(|entry| {
        entry.access & WRITE_AUTHORITY != 0
            && (windows_path_starts_with(journal_root, &entry.path)
                || windows_path_starts_with(&entry.path, journal_root))
    }) {
        return Err(format!(
            "sandbox writable roots must not overlap protected ACL state {}",
            journal_root.display()
        ));
    }
    let mut previous = read_acl_journal(&journal_path)?;
    if previous.format_version > ACL_JOURNAL_FORMAT_VERSION {
        return Err(format!(
            "sandbox ACL journal {} uses unsupported format {}",
            journal_path.display(),
            previous.format_version
        ));
    }
    if previous.format_version < ACL_JOURNAL_FORMAT_VERSION && !previous.entries.is_empty() {
        // Format 1 explicitly wrote the package SID onto every descendant.
        // Remove those legacy ACEs once before switching to inheritable root
        // grants; otherwise a later root revocation could leave explicit child
        // grants behind.
        for entry in &previous.entries {
            revoke_legacy_acl_entry(entry, profile.sid.as_string())?;
        }
        previous = AclJournal::default();
    }
    if previous.committed && previous.entries == desired {
        return Ok(());
    }

    let desired_set: HashSet<&AclEntry> = desired.iter().collect();
    let removed: Vec<&AclEntry> = previous
        .entries
        .iter()
        .filter(|entry| !desired_set.contains(entry))
        .collect();
    for entry in &removed {
        revoke_acl_entry(entry, profile.sid.as_string())?;
    }

    write_acl_journal(
        &journal_path,
        &AclJournal {
            format_version: ACL_JOURNAL_FORMAT_VERSION,
            committed: false,
            entries: desired.clone(),
        },
    )?;

    let previous_set: HashSet<&AclEntry> = previous.entries.iter().collect();
    for entry in &desired {
        let overlaps_removed = removed
            .iter()
            .any(|removed| acl_revocation_affects(entry, removed));
        if !previous.committed || !previous_set.contains(entry) || overlaps_removed {
            grant_acl_entry(entry, profile)?;
        }
    }

    write_acl_journal(
        &journal_path,
        &AclJournal {
            format_version: ACL_JOURNAL_FORMAT_VERSION,
            committed: true,
            entries: desired,
        },
    )
}

fn compile_acl_entries(policy: &SandboxPolicy) -> Vec<AclEntry> {
    let mut entries: BTreeMap<(PathBuf, bool), u32> = BTreeMap::new();
    let filesystem_entries: Vec<_> = policy
        .filesystem_allowlist
        .iter()
        .chain(policy.extra_paths.iter())
        .collect();
    for entry in &filesystem_entries {
        let access = filesystem_access_mask(entry);
        if access != 0 {
            *entries
                .entry((entry.path.clone(), entry.recursive && entry.path.is_dir()))
                .or_default() |= access;
        }
    }
    for executable in &policy.exec_allowlist {
        let is_directory = executable.is_dir();
        *entries
            .entry((executable.clone(), is_directory))
            .or_default() |= FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
    }

    // An AppContainer ACE on a declared leaf does not make its undeclared
    // parents resolvable. This matters for APIs such as Path::toRealPath: Java
    // calls FindFirstFile for every component before opening java.security,
    // classpath JARs, and native images. Add non-inheriting traversal, metadata,
    // and exact-directory listing authority without granting child-file reads.
    let mut ancestor_sources: Vec<&Path> = filesystem_entries
        .iter()
        .map(|entry| entry.path.as_path())
        .collect();
    ancestor_sources.extend(policy.exec_allowlist.iter().map(PathBuf::as_path));
    let user_profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .and_then(|path| std::fs::canonicalize(path).ok());
    for source in ancestor_sources {
        // Platform-owned additions such as the private scratch directory are
        // created after Tauri canonicalizes the user policy. Normalize again
        // here so `C:\...` and `\\?\C:\...` cannot bypass the profile cutoff.
        let source = std::fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
        if is_appcontainer_baseline_path(&source) {
            continue;
        }
        for ancestor in acl_ancestor_paths(&source, user_profile.as_deref()) {
            let exact_key = (ancestor.clone(), false);
            if let Some(access) = entries.get_mut(&exact_key) {
                *access |= DIRECTORY_RESOLVE_ACCESS;
                continue;
            }
            let recursive_key = (ancestor.clone(), true);
            if entries
                .get(&recursive_key)
                .is_some_and(|access| access & DIRECTORY_RESOLVE_ACCESS == DIRECTORY_RESOLVE_ACCESS)
            {
                continue;
            }
            entries.insert(exact_key, DIRECTORY_RESOLVE_ACCESS);
        }
    }

    entries
        .into_iter()
        .map(|((path, recursive), access)| AclEntry {
            path,
            access,
            recursive,
        })
        .collect()
}

fn acl_ancestor_paths(path: &Path, user_profile: Option<&Path>) -> Vec<PathBuf> {
    let within_user_profile =
        user_profile.filter(|profile| windows_path_starts_with(path, profile));
    let mut ancestors = Vec::new();
    let mut current = path.parent();
    while let Some(ancestor) = current {
        // Never try to rewrite a drive root or UNC share root. Windows gives
        // AppContainers the baseline traversal needed to reach child scopes.
        if ancestor.parent().is_none() {
            break;
        }
        if within_user_profile.is_some_and(|profile| !windows_path_starts_with(ancestor, profile)) {
            break;
        }
        ancestors.push(ancestor.to_path_buf());
        current = ancestor.parent();
    }
    ancestors
}

fn acl_revocation_affects(desired: &AclEntry, removed: &AclEntry) -> bool {
    windows_paths_equal(&desired.path, &removed.path)
        || (removed.recursive && windows_path_starts_with(&desired.path, &removed.path))
        || (desired.recursive && windows_path_starts_with(&removed.path, &desired.path))
}

fn acl_journal_path(profile_name: &str) -> Result<PathBuf, String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "LOCALAPPDATA is unavailable for Windows sandbox state".to_string())?;
    Ok(PathBuf::from(local_app_data)
        .join("VestaLauncher")
        .join("sandbox-profiles")
        .join(format!("{profile_name}.json")))
}

fn read_acl_journal(path: &Path) -> Result<AclJournal, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|err| format!("invalid sandbox ACL journal {}: {err}", path.display())),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(AclJournal::default()),
        Err(err) => Err(format!(
            "could not read sandbox ACL journal {}: {err}",
            path.display()
        )),
    }
}

fn write_acl_journal(path: &Path, journal: &AclJournal) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "sandbox ACL journal has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|err| {
        format!(
            "could not create sandbox ACL journal directory {}: {err}",
            parent.display()
        )
    })?;
    let temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|err| format!("could not create temporary sandbox ACL journal: {err}"))?;
    serde_json::to_writer(temp.as_file(), journal)
        .map_err(|err| format!("could not serialize sandbox ACL journal: {err}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|err| format!("could not sync sandbox ACL journal: {err}"))?;
    temp.persist(path)
        .map_err(|err| format!("could not publish sandbox ACL journal: {}", err.error))?;
    Ok(())
}

/// Windows grants AppContainers read/execute access to signed OS and installed
/// application roots through the ALL APPLICATION PACKAGES ACL. Standard users
/// cannot and need not add a per-package ACE to those protected roots.
fn is_appcontainer_baseline_path(path: &Path) -> bool {
    ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| {
            std::fs::canonicalize(path)
                .ok()
                .is_some_and(|path| windows_path_starts_with(&path, &root))
        })
}

fn filesystem_access_mask(entry: &PathAccess) -> u32 {
    let mut access = 0;
    if entry.read || entry.load {
        access |= FILE_GENERIC_READ;
    }
    if entry.write {
        access |= FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
    }
    // Windows uses FILE_EXECUTE both for executable image mappings and native
    // library mappings. The portable policy keeps the intents separate, but
    // NTFS cannot enforce load-only access. The target token's no-child policy
    // independently prevents these loadable images from becoming descendants.
    if entry.execute || entry.load {
        access |= FILE_GENERIC_EXECUTE;
    }
    access
}

fn grant_acl_entry(entry: &AclEntry, profile: &AppContainerProfile) -> Result<(), String> {
    match grant_path_recursive(profile, &entry.path, entry.recursive, entry.access) {
        Ok(()) => Ok(()),
        Err(_)
            if entry.access & WRITE_AUTHORITY == 0
                && is_appcontainer_baseline_path(&entry.path) =>
        {
            Ok(())
        }
        Err(err) => Err(err),
    }
}

fn grant_path_recursive(
    profile: &AppContainerProfile,
    path: &Path,
    recursive: bool,
    access: u32,
) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;

    let metadata = std::fs::symlink_metadata(path)
        .map_err(|err| format!("could not inspect {}: {err}", path.display()))?;
    // Never follow or mutate a reparse target discovered below an allowlisted
    // root. A game-controlled junction must not redirect ACL grants elsewhere.
    if metadata.file_attributes() & 0x0000_0400 != 0 {
        return Ok(());
    }
    let is_recursive_directory = recursive && metadata.is_dir();
    grant_path_access(profile, path, is_recursive_directory, access)?;
    if is_recursive_directory {
        grant_protected_descendants(profile, path, access)?;
    }
    Ok(())
}

fn grant_path_access(
    profile: &AppContainerProfile,
    path: &Path,
    recursive_directory: bool,
    access: u32,
) -> Result<(), String> {
    if recursive_directory {
        grant_to_package(
            ResourcePath::Directory(path.to_path_buf()),
            &profile.sid,
            AccessMask(access),
        )
        .map_err(|err| {
            format!(
                "could not grant AppContainer access to {}: {err}",
                path.display()
            )
        })?;
        // FILE_EXECUTE on a directory is traversal, not permission to execute
        // files beneath it. Keep the additional root ACE non-inheriting and use
        // SetFileSecurity so Windows does not reprocess the directory subtree.
        grant_sid_access_exact(
            path,
            profile.sid.as_string(),
            FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
        )?;
    } else {
        grant_sid_access_exact(path, profile.sid.as_string(), access)?;
    }
    // ResourcePath::Directory installs an object/container-inheriting ACE.
    // NTFS propagates it to existing inheriting descendants and applies it to
    // new descendants without walking the tree here. Reparse targets are not
    // traversed by ACL inheritance, avoiding both the escape risk and the
    // pathological per-file launch cost of explicit descriptor rewrites.
    Ok(())
}

fn grant_protected_descendants(
    profile: &AppContainerProfile,
    root: &Path,
    access: u32,
) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;

    for child in std::fs::read_dir(root)
        .map_err(|err| format!("could not enumerate {}: {err}", root.display()))?
    {
        let child = child
            .map_err(|err| format!("could not enumerate child of {}: {err}", root.display()))?;
        let path = child.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|err| format!("could not inspect {}: {err}", path.display()))?;
        if metadata.file_attributes() & 0x0000_0400 != 0 {
            continue;
        }
        let is_directory = metadata.is_dir();
        if dacl_is_protected(&path)? {
            grant_path_access(profile, &path, is_directory, access)?;
        }
        if is_directory {
            grant_protected_descendants(profile, &path, access)?;
        }
    }
    Ok(())
}

fn revoke_acl_entry(entry: &AclEntry, sid: &str) -> Result<(), String> {
    if !entry.path.exists() {
        return Ok(());
    }
    let recursive_directory = entry.recursive && entry.path.is_dir();
    let result = (|| {
        if recursive_directory {
            revoke_protected_descendants(&entry.path, sid)?;
        }
        revoke_sid_access(&entry.path, sid, recursive_directory)
    })();
    match result {
        Ok(()) => Ok(()),
        Err(_) if is_appcontainer_baseline_path(&entry.path) => Ok(()),
        Err(err) => Err(err),
    }
}

fn revoke_protected_descendants(root: &Path, sid: &str) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;

    for child in std::fs::read_dir(root).map_err(|err| {
        format!(
            "could not enumerate {} for ACL cleanup: {err}",
            root.display()
        )
    })? {
        let child = child.map_err(|err| {
            format!(
                "could not enumerate child of {} for ACL cleanup: {err}",
                root.display()
            )
        })?;
        let path = child.path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|err| {
            format!(
                "could not inspect {} for ACL cleanup: {err}",
                path.display()
            )
        })?;
        if metadata.file_attributes() & 0x0000_0400 != 0 {
            continue;
        }
        let is_directory = metadata.is_dir();
        if is_directory {
            revoke_protected_descendants(&path, sid)?;
        }
        if dacl_is_protected(&path)? {
            revoke_sid_access(&path, sid, is_directory)?;
        }
    }
    Ok(())
}

fn dacl_is_protected(path: &Path) -> Result<bool, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorControl, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
        SECURITY_DESCRIPTOR_CONTROL, SE_DACL_PROTECTED,
    };

    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    unsafe {
        let status = GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        );
        if status != 0 {
            return Err(format!(
                "could not inspect DACL inheritance on {}: error {status}",
                path.display()
            ));
        }
        let mut control: SECURITY_DESCRIPTOR_CONTROL = 0;
        let mut revision = 0;
        let ok = GetSecurityDescriptorControl(descriptor, &mut control, &mut revision);
        LocalFree(descriptor);
        if ok == 0 {
            return Err(format!(
                "GetSecurityDescriptorControl for {}: {}",
                path.display(),
                io::Error::last_os_error()
            ));
        }
        Ok(control & SE_DACL_PROTECTED != 0)
    }
}

fn revoke_legacy_acl_entry(entry: &AclEntry, sid: &str) -> Result<(), String> {
    if !entry.path.exists() {
        return Ok(());
    }
    revoke_path_recursive_legacy(&entry.path, entry.recursive, sid)?;
    if entry.recursive && entry.path.is_dir() {
        // The legacy root also carried an inheritable ACE. Propagate its
        // removal once after exact descendant ACE cleanup so inherited copies
        // cannot survive the migration.
        revoke_sid_access(&entry.path, sid, true)?;
    }
    Ok(())
}

fn revoke_path_recursive_legacy(path: &Path, recursive: bool, sid: &str) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;

    let metadata = std::fs::symlink_metadata(path).map_err(|err| {
        format!(
            "could not inspect {} for ACL cleanup: {err}",
            path.display()
        )
    })?;
    if metadata.file_attributes() & 0x0000_0400 != 0 {
        return Ok(());
    }
    if recursive && metadata.is_dir() {
        for child in std::fs::read_dir(path).map_err(|err| {
            format!(
                "could not enumerate {} for ACL cleanup: {err}",
                path.display()
            )
        })? {
            let child = child.map_err(|err| {
                format!(
                    "could not enumerate child of {} for ACL cleanup: {err}",
                    path.display()
                )
            })?;
            revoke_path_recursive_legacy(&child.path(), true, sid)?;
        }
    }
    revoke_sid_access(path, sid, false)
}

fn grant_sid_access_exact(path: &Path, sid_sddl: &str, access: u32) -> Result<(), String> {
    update_sid_access(path, sid_sddl, access, false, false)
}

fn revoke_sid_access(path: &Path, sid_sddl: &str, propagate: bool) -> Result<(), String> {
    update_sid_access(path, sid_sddl, 0, true, propagate)
}

fn update_sid_access(
    path: &Path,
    sid_sddl: &str,
    access: u32,
    revoke: bool,
    propagate: bool,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSidToSidW, GetExplicitEntriesFromAclW, GetNamedSecurityInfoW,
        SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, REVOKE_ACCESS,
        SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        EqualSid, InitializeSecurityDescriptor, SetFileSecurityW, SetSecurityDescriptorDacl, ACL,
        DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_DESCRIPTOR,
    };

    let wide_sid: Vec<u16> = sid_sddl.encode_utf16().chain(Some(0)).collect();
    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut sid: PSID = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    let mut old_acl: *mut ACL = std::ptr::null_mut();
    let mut new_acl: *mut ACL = std::ptr::null_mut();

    unsafe {
        if ConvertStringSidToSidW(wide_sid.as_ptr(), &mut sid) == 0 {
            return Err(format!(
                "ConvertStringSidToSidW: {}",
                io::Error::last_os_error()
            ));
        }
        let get_status = GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_acl,
            std::ptr::null_mut(),
            &mut descriptor,
        );
        if get_status != 0 {
            LocalFree(sid);
            return Err(format!("GetNamedSecurityInfoW error {get_status}"));
        }
        if revoke {
            let mut explicit_count = 0;
            let mut explicit_entries: *mut EXPLICIT_ACCESS_W = std::ptr::null_mut();
            let explicit_status =
                GetExplicitEntriesFromAclW(old_acl, &mut explicit_count, &mut explicit_entries);
            if explicit_status != 0 {
                LocalFree(descriptor);
                LocalFree(sid);
                return Err(format!(
                    "GetExplicitEntriesFromAclW error {explicit_status}"
                ));
            }
            let contains_sid = explicit_count != 0
                && std::slice::from_raw_parts(explicit_entries, explicit_count as usize)
                    .iter()
                    .any(|entry| {
                        entry.Trustee.TrusteeForm == TRUSTEE_IS_SID
                            && EqualSid(sid, entry.Trustee.ptstrName.cast()) != 0
                    });
            LocalFree(explicit_entries.cast());
            if !contains_sid {
                LocalFree(descriptor);
                LocalFree(sid);
                return Ok(());
            }
        }

        let trustee = TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast(),
        };
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: access,
            grfAccessMode: if revoke { REVOKE_ACCESS } else { GRANT_ACCESS },
            grfInheritance: 0,
            Trustee: trustee,
        };
        let acl_status = SetEntriesInAclW(1, &entry, old_acl, &mut new_acl);
        if acl_status != 0 {
            LocalFree(descriptor);
            LocalFree(sid);
            return Err(format!("SetEntriesInAclW error {acl_status}"));
        }
        let set_status = if propagate {
            SetNamedSecurityInfoW(
                wide_path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                new_acl,
                std::ptr::null_mut(),
            )
        } else {
            // SetNamedSecurityInfo automatically imposes the inheritance model
            // on the entire subtree even for an exact ACE. SetFileSecurity is
            // deliberately used for exact entries because directory security
            // applied through it is not inherited by child objects.
            let mut security_descriptor = SECURITY_DESCRIPTOR::default();
            if InitializeSecurityDescriptor(
                (&mut security_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
                1,
            ) == 0
            {
                let error = io::Error::last_os_error();
                LocalFree(new_acl.cast());
                LocalFree(descriptor);
                LocalFree(sid);
                return Err(format!("InitializeSecurityDescriptor: {error}"));
            }
            if SetSecurityDescriptorDacl(
                (&mut security_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
                1,
                new_acl,
                0,
            ) == 0
            {
                let error = io::Error::last_os_error();
                LocalFree(new_acl.cast());
                LocalFree(descriptor);
                LocalFree(sid);
                return Err(format!("SetSecurityDescriptorDacl: {error}"));
            }
            if SetFileSecurityW(
                wide_path.as_ptr(),
                DACL_SECURITY_INFORMATION,
                (&mut security_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
            ) == 0
            {
                io::Error::last_os_error().raw_os_error().unwrap_or(1) as u32
            } else {
                0
            }
        };
        LocalFree(new_acl.cast());
        LocalFree(descriptor);
        LocalFree(sid);
        if set_status != 0 {
            return Err(format!(
                "could not apply ACL to {}: error {set_status}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn build_command_line(args: &[String]) -> Option<String> {
    if args.is_empty() {
        return None;
    }
    Some(format!(
        " {}",
        args.iter()
            .map(|arg| quote_windows_arg(arg))
            .collect::<Vec<_>>()
            .join(" ")
    ))
}

fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty()
        && !arg
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return arg.to_string();
    }
    let mut quoted = String::from("\"");
    let mut backslashes = 0;
    for character in arg.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.push_str(&"\\".repeat(backslashes));
            quoted.push(character);
        }
        backslashes = 0;
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

fn probe_path(name: &str) -> Result<PathBuf, i32> {
    std::env::var_os(name).map(PathBuf::from).ok_or_else(|| {
        eprintln!("filesystem probe is missing {name}");
        90
    })
}

/// Self-contained child mode used by the Windows integration test. Keeping
/// filesystem operations in this executable avoids shell parsing and proves
/// the actual AppContainer token, ACL, environment, and pipe behavior.
fn run_filesystem_probe() -> i32 {
    let run = || -> Result<(), i32> {
        let allowed_read = probe_path("VESTA_PROBE_ALLOWED_READ")?;
        let read_only_read = probe_path("VESTA_PROBE_READ_ONLY_READ")?;
        let blocked_read = probe_path("VESTA_PROBE_BLOCKED_READ")?;
        let allowed_write = probe_path("VESTA_PROBE_ALLOWED_WRITE")?;
        let read_only_write = probe_path("VESTA_PROBE_READ_ONLY_WRITE")?;
        let blocked_write = probe_path("VESTA_PROBE_BLOCKED_WRITE")?;
        let protected_read = std::env::var_os("VESTA_PROBE_PROTECTED_READ").map(PathBuf::from);

        std::fs::read_to_string(allowed_read).map_err(|_| 10)?;
        std::fs::read_to_string(read_only_read).map_err(|_| 11)?;
        if let Some(protected_read) = protected_read {
            std::fs::read_to_string(protected_read).map_err(|_| 17)?;
        }
        if std::fs::read_to_string(blocked_read).is_ok() {
            return Err(12);
        }
        std::fs::write(allowed_write, "written\n").map_err(|_| 13)?;
        if std::fs::write(read_only_write, "changed\n").is_ok() {
            return Err(14);
        }
        if std::fs::write(blocked_write, "changed\n").is_ok() {
            return Err(15);
        }
        if let Some(reparse_read) = std::env::var_os("VESTA_PROBE_REPARSE_READ") {
            if std::fs::read_to_string(reparse_read).is_ok() {
                return Err(16);
            }
        }
        if let Some(blocked_network) = std::env::var_os("VESTA_PROBE_BLOCKED_NETWORK") {
            let address: std::net::SocketAddr =
                blocked_network.to_string_lossy().parse().map_err(|_| 91)?;
            if std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_secs(2))
                .is_ok()
            {
                return Err(17);
            }
        }
        if let Some(system_executable) = std::env::var_os("VESTA_PROBE_SYSTEM_EXECUTABLE") {
            if std::process::Command::new(system_executable)
                .output()
                .is_ok()
            {
                return Err(18);
            }
        }
        if let Some(loadable_executable) = std::env::var_os("VESTA_PROBE_LOADABLE_EXECUTABLE") {
            if std::process::Command::new(loadable_executable)
                .arg("--windows-helper-protocol-version")
                .output()
                .is_ok()
            {
                return Err(19);
            }
        }
        for (pid_variable, failure_code) in [
            ("VESTA_SANDBOX_BROKER_PID", 20),
            ("VESTA_PROBE_HOST_SUPERVISOR_PID", 21),
        ] {
            let Some(broker_pid) = std::env::var_os(pid_variable) else {
                continue;
            };
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::{
                OpenProcess, PROCESS_CREATE_PROCESS, PROCESS_DUP_HANDLE, PROCESS_TERMINATE,
                PROCESS_VM_OPERATION, PROCESS_VM_WRITE, PROCESS_WRITE_DAC, PROCESS_WRITE_OWNER,
            };
            let broker_pid = broker_pid
                .to_string_lossy()
                .parse::<u32>()
                .map_err(|_| 92)?;
            let forbidden_masks = [
                PROCESS_WRITE_DAC,
                PROCESS_WRITE_OWNER,
                PROCESS_TERMINATE,
                PROCESS_CREATE_PROCESS
                    | PROCESS_DUP_HANDLE
                    | PROCESS_VM_OPERATION
                    | PROCESS_VM_WRITE,
            ];
            for mask in forbidden_masks {
                let broker = unsafe { OpenProcess(mask, 0, broker_pid) };
                if !broker.is_null() {
                    unsafe {
                        CloseHandle(broker);
                    }
                    return Err(failure_code);
                }
            }
        }
        println!("vesta-windows-sandbox-filesystem-probe-ok");
        Ok(())
    };

    match run() {
        Ok(()) => 0,
        Err(code) => {
            eprintln!("Windows AppContainer filesystem probe failed at check {code}");
            code
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{resolve_preset, SandboxPreset, WrapperNesting};
    use std::process::Command;

    fn current_windows_helper() -> PathBuf {
        let helper = windows_helper_path().unwrap_or_else(|| {
            panic!(
                "Windows AppContainer tests require a built sidecar; run `cargo build -p vesta-sandbox --bin vesta-sandbox-exec` first"
            )
        });
        let version = Command::new(&helper)
            .arg("--windows-helper-protocol-version")
            .output()
            .unwrap_or_else(|err| {
                panic!(
                    "could not query sandbox sidecar {}: {err}",
                    helper.display()
                )
            });
        assert!(
            version.status.success()
                && String::from_utf8_lossy(&version.stdout).trim()
                    == WINDOWS_HELPER_PROTOCOL_VERSION,
            "sandbox sidecar {} is stale; rebuild it with `cargo build -p vesta-sandbox --bin vesta-sandbox-exec`",
            helper.display()
        );
        helper
    }

    #[test]
    fn command_line_quotes_spaces_quotes_and_trailing_slashes() {
        assert_eq!(quote_windows_arg("plain"), "plain");
        assert_eq!(quote_windows_arg("two words"), "\"two words\"");
        assert_eq!(quote_windows_arg(""), "\"\"");
        assert_eq!(quote_windows_arg(r#"say "hello""#), r#""say \"hello\"""#);
        assert_eq!(
            quote_windows_arg("C:\\path with space\\"),
            "\"C:\\path with space\\\\\""
        );
    }

    #[test]
    fn parser_requires_policy_separator_and_program() {
        let parsed = parse_cli(&[
            "helper".into(),
            "--windows-policy".into(),
            "policy.json".into(),
            "--".into(),
            "java.exe".into(),
            "-version".into(),
        ])
        .unwrap();
        assert_eq!(parsed.policy_path, PathBuf::from("policy.json"));
        assert_eq!(parsed.program, PathBuf::from("java.exe"));
        assert_eq!(parsed.args, vec!["-version"]);
    }

    #[test]
    fn profile_launch_mutex_serializes_the_full_profile_lifetime() {
        let profile_name = format!("vesta-sandbox-test-{}", std::process::id());
        let first = acquire_profile_launch_lock(&profile_name).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            let second = acquire_profile_launch_lock(&profile_name).unwrap();
            sender.send(()).unwrap();
            drop(second);
        });

        assert!(receiver
            .recv_timeout(std::time::Duration::from_millis(150))
            .is_err());
        drop(first);
        receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        waiter.join().unwrap();
    }

    #[test]
    fn concurrent_profiles_preserve_both_sids_on_a_shared_root() {
        let probe = tempfile::tempdir().unwrap();
        let shared = probe.path().join("shared-runtime");
        let shared_child = shared.join("asset.txt");
        let instance_a = probe.path().join("instance-a");
        let instance_b = probe.path().join("instance-b");
        for path in [&shared, &instance_a, &instance_b] {
            std::fs::create_dir_all(path).unwrap();
        }
        std::fs::write(&shared_child, "asset\n").unwrap();

        let policy_for = |instance: &Path| SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![
                PathAccess::new(instance, true, true, false),
                PathAccess::new(&shared, true, false, false),
            ],
            network_allowed: true,
            mic_allowed: true,
            usb_allowed: true,
            exec_allowlist: Vec::new(),
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let policy_a = policy_for(&instance_a);
        let policy_b = policy_for(&instance_b);
        let _guard_a = TestProfileGuard(policy_a.clone());
        let _guard_b = TestProfileGuard(policy_b.clone());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));

        let launch_sync = |policy: SandboxPolicy, barrier: std::sync::Arc<std::sync::Barrier>| {
            std::thread::spawn(move || {
                let profile_name = profile_name_for_policy(&policy).unwrap();
                let _profile_lock = acquire_profile_launch_lock(&profile_name).unwrap();
                let profile =
                    AppContainerProfile::ensure(&profile_name, &profile_name, None).unwrap();
                barrier.wait();
                sync_policy_access(&profile, &policy, &profile_name).unwrap();
                profile.sid.as_string().to_string()
            })
        };
        let thread_a = launch_sync(policy_a, barrier.clone());
        let thread_b = launch_sync(policy_b, barrier.clone());
        barrier.wait();
        let sid_a = thread_a.join().unwrap();
        let sid_b = thread_b.join().unwrap();

        let acl = Command::new("icacls.exe")
            .arg(&shared_child)
            .output()
            .unwrap();
        let acl = String::from_utf8_lossy(&acl.stdout);
        assert!(
            acl.contains(&sid_a),
            "shared child ACL omitted {sid_a}: {acl}"
        );
        assert!(
            acl.contains(&sid_b),
            "shared child ACL omitted {sid_b}: {acl}"
        );
    }

    #[test]
    fn native_load_maps_to_windows_image_right_without_changing_portable_exec_intent() {
        let access = PathAccess::new(r"C:\game\natives", false, false, false).loadable();

        let mask = filesystem_access_mask(&access);

        assert_ne!(mask & FILE_GENERIC_READ, 0);
        assert_ne!(mask & FILE_GENERIC_EXECUTE, 0);
        assert!(!access.execute);
        assert_eq!(mask & WRITE_AUTHORITY, 0);
    }

    #[test]
    fn acl_compilation_adds_one_non_inheriting_resolution_entry_per_parent() {
        let probe = tempfile::tempdir().unwrap();
        let declared = probe.path().join("nested").join("instance");
        std::fs::create_dir_all(&declared).unwrap();
        let first = declared.join("first.txt");
        let second = declared.join("second.txt");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&second, "second").unwrap();
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![
                PathAccess::file(&first, true, false, false),
                PathAccess::file(&second, true, false, false),
            ],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: Vec::new(),
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };

        let entries = compile_acl_entries(&policy);
        let canonical_declared = std::fs::canonicalize(&declared).unwrap();
        let parent_entries: Vec<_> = entries
            .iter()
            .filter(|entry| windows_paths_equal(&entry.path, &canonical_declared))
            .collect();
        assert_eq!(parent_entries.len(), 1);
        assert_eq!(parent_entries[0].access, DIRECTORY_RESOLVE_ACCESS);
        assert!(!parent_entries[0].recursive);
        assert_ne!(parent_entries[0].access & FILE_LIST_DIRECTORY, 0);
        assert_eq!(parent_entries[0].access & WRITE_AUTHORITY, 0);

        let filesystem_root = canonical_declared
            .ancestors()
            .find(|ancestor| ancestor.parent().is_none())
            .unwrap();
        assert!(!entries
            .iter()
            .any(|entry| windows_paths_equal(&entry.path, filesystem_root)));
        if let Some(profile_parent) = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .and_then(|path| std::fs::canonicalize(path).ok())
            .and_then(|path| path.parent().map(Path::to_path_buf))
        {
            assert!(!entries
                .iter()
                .any(|entry| windows_paths_equal(&entry.path, &profile_parent)));
        }
    }

    #[test]
    fn acl_ancestor_walk_stops_before_profile_parent_and_roots() {
        let profile = Path::new(r"C:\Users\alice");
        let user_path = Path::new(r"C:\Users\alice\AppData\Roaming\Vesta\data.bin");
        let user_ancestors = acl_ancestor_paths(user_path, Some(profile));
        assert!(user_ancestors
            .iter()
            .any(|path| windows_paths_equal(path, profile)));
        assert!(!user_ancestors
            .iter()
            .any(|path| windows_paths_equal(path, Path::new(r"C:\Users"))));
        assert!(!user_ancestors
            .iter()
            .any(|path| windows_paths_equal(path, Path::new(r"C:\"))));

        let unc_root = Path::new(r"\\server\share");
        let unc_ancestors = acl_ancestor_paths(
            Path::new(r"\\server\share\games\instance\options.txt"),
            None,
        );
        assert!(unc_ancestors
            .iter()
            .any(|path| windows_paths_equal(path, Path::new(r"\\server\share\games"))));
        assert!(!unc_ancestors
            .iter()
            .any(|path| windows_paths_equal(path, unc_root)));
    }

    #[test]
    fn acl_reconciliation_replays_only_grants_touched_by_revocation_scope() {
        let runtime = AclEntry {
            path: PathBuf::from(r"C:\Users\alice\data\java"),
            access: FILE_GENERIC_READ,
            recursive: true,
        };
        let exact_parent = AclEntry {
            path: PathBuf::from(r"C:\Users\alice\data"),
            access: FILE_GENERIC_EXECUTE,
            recursive: false,
        };
        assert!(!acl_revocation_affects(&runtime, &exact_parent));

        let recursive_parent = AclEntry {
            recursive: true,
            ..exact_parent.clone()
        };
        assert!(acl_revocation_affects(&runtime, &recursive_parent));

        let exact_child = AclEntry {
            path: runtime.path.join("conf"),
            access: FILE_GENERIC_READ,
            recursive: false,
        };
        assert!(acl_revocation_affects(&runtime, &exact_child));
    }

    #[test]
    fn java_drive_targets_support_dos_and_unc_runtime_roots() {
        assert_eq!(
            java_drive_target(Path::new(r"C:\runtime")).unwrap(),
            r"\??\C:\runtime"
        );
        assert_eq!(
            java_drive_target(Path::new(r"\\?\C:\runtime")).unwrap(),
            r"\??\C:\runtime"
        );
        assert_eq!(
            java_drive_target(Path::new(r"\\server\share\runtime")).unwrap(),
            r"\??\UNC\server\share\runtime"
        );
        assert_eq!(
            java_drive_target(Path::new(r"\\?\UNC\server\share\runtime")).unwrap(),
            r"\??\UNC\server\share\runtime"
        );
    }

    #[test]
    fn exact_directory_acl_update_does_not_grant_child_access() {
        let probe = tempfile::tempdir().unwrap();
        let child = probe.path().join("child.txt");
        std::fs::write(&child, "unchanged").unwrap();
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![PathAccess::new(probe.path(), true, true, false)],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: Vec::new(),
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let profile_guard = TestProfileGuard(policy.clone());
        let profile_name = profile_name_for_policy(&policy).unwrap();
        let profile = AppContainerProfile::ensure(&profile_name, &profile_name, None).unwrap();
        let profile_sid = profile.sid.as_string().to_string();
        let grant = grant_sid_access_exact(probe.path(), &profile_sid, DIRECTORY_RESOLVE_ACCESS);
        let after = Command::new("icacls.exe").arg(&child).output().unwrap();
        let parent_with_grant = Command::new("icacls.exe")
            .arg(probe.path())
            .output()
            .unwrap();
        let revoke = revoke_sid_access(probe.path(), &profile_sid, false);
        let parent_after_revoke = Command::new("icacls.exe")
            .arg(probe.path())
            .output()
            .unwrap();
        drop(profile);
        drop(profile_guard);

        grant.unwrap();
        revoke.unwrap();
        assert!(!String::from_utf8_lossy(&after.stdout).contains(&profile_sid));
        assert!(String::from_utf8_lossy(&parent_with_grant.stdout).contains(&profile_sid));
        assert!(!String::from_utf8_lossy(&parent_after_revoke.stdout).contains(&profile_sid));
    }

    #[test]
    fn appcontainer_enforces_declared_read_and_write_access() {
        let helper = current_windows_helper();
        let probe = tempfile::tempdir().unwrap();
        let allowed = probe.path().join("allowed");
        let read_only = probe.path().join("read-only");
        let protected = allowed.join("protected-dacl");
        let blocked = probe.path().join("blocked");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(&read_only).unwrap();
        std::fs::create_dir_all(&protected).unwrap();
        std::fs::create_dir_all(&blocked).unwrap();
        let allowed_read = allowed.join("read.txt");
        let read_only_file = read_only.join("read.txt");
        let blocked_read = blocked.join("read.txt");
        let allowed_write = allowed.join("write.txt");
        let read_only_write = read_only.join("write.txt");
        let protected_read = protected.join("read.txt");
        let blocked_write = blocked.join("write.txt");
        let loadable_executable = allowed.join("loadable-child.exe");
        let junction = allowed.join("outside-junction");
        std::fs::write(&allowed_read, "allowed\n").unwrap();
        std::fs::write(&read_only_file, "shared\n").unwrap();
        std::fs::write(&protected_read, "protected\n").unwrap();
        let protected_acl = Command::new("icacls.exe")
            .arg(&protected)
            .arg("/inheritance:d")
            .output()
            .unwrap();
        assert!(
            protected_acl.status.success(),
            "could not protect test DACL: {}",
            String::from_utf8_lossy(&protected_acl.stderr)
        );
        std::fs::write(&blocked_read, "blocked\n").unwrap();
        std::fs::write(&blocked_write, "unchanged\n").unwrap();
        std::fs::copy(&helper, &loadable_executable).unwrap();
        let positive_control = Command::new(&loadable_executable)
            .arg("--windows-helper-protocol-version")
            .output()
            .unwrap();
        assert!(
            positive_control.status.success(),
            "copied loadable child must execute outside the sandbox"
        );
        let junction_output = Command::new(r"C:\Windows\System32\cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&blocked)
            .output()
            .unwrap();
        assert!(
            junction_output.status.success(),
            "could not create junction escape probe: stdout={}; stderr={}",
            String::from_utf8_lossy(&junction_output.stdout),
            String::from_utf8_lossy(&junction_output.stderr)
        );
        let network_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let network_address = network_listener.local_addr().unwrap();

        let caps = resolve_preset(SandboxPreset::Paranoid);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![
                PathAccess::new(&allowed, true, true, false).loadable(),
                PathAccess::new(&read_only, true, false, false),
            ],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![helper.clone()],
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let profile_guard = TestProfileGuard(policy.clone());
        let policy_path = probe.path().join("policy.json");
        std::fs::write(&policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();

        let output = Command::new(&helper)
            .args([
                "--windows-policy",
                policy_path.to_str().unwrap(),
                "--",
                helper.to_str().unwrap(),
                "--windows-filesystem-probe",
            ])
            .current_dir(&allowed)
            .env("VESTA_PROBE_ALLOWED_READ", &allowed_read)
            .env("VESTA_PROBE_READ_ONLY_READ", &read_only_file)
            .env("VESTA_PROBE_PROTECTED_READ", &protected_read)
            .env("VESTA_PROBE_BLOCKED_READ", &blocked_read)
            .env("VESTA_PROBE_ALLOWED_WRITE", &allowed_write)
            .env("VESTA_PROBE_READ_ONLY_WRITE", &read_only_write)
            .env("VESTA_PROBE_BLOCKED_WRITE", &blocked_write)
            .env("VESTA_PROBE_REPARSE_READ", junction.join("read.txt"))
            .env("VESTA_PROBE_BLOCKED_NETWORK", network_address.to_string())
            .env("VESTA_WINDOWS_SANDBOX_TEST_BROKER", "1")
            .env(
                "VESTA_PROBE_HOST_SUPERVISOR_PID",
                std::process::id().to_string(),
            )
            // Both targets have OS execute rights: one through Windows' system
            // baseline and one because the writable root is loadable. The
            // target token's child-process policy must still deny both.
            .env(
                "VESTA_PROBE_SYSTEM_EXECUTABLE",
                r"C:\Windows\System32\whoami.exe",
            )
            .env("VESTA_PROBE_LOADABLE_EXECUTABLE", &loadable_executable)
            .output()
            .unwrap();

        drop(profile_guard);

        assert!(
            output.status.success(),
            "AppContainer probe exited with {}; stdout={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout)
            .contains("vesta-windows-sandbox-filesystem-probe-ok"));
        assert_eq!(std::fs::read_to_string(allowed_write).unwrap(), "written\n");
        assert!(!read_only_write.exists());
        assert_eq!(
            std::fs::read_to_string(blocked_write).unwrap(),
            "unchanged\n"
        );
        assert!(junction.exists(), "junction probe was unexpectedly removed");
    }

    #[test]
    fn installed_java_starts_inside_appcontainer() {
        let helper = current_windows_helper();
        let Ok(java) = which::which("java.exe") else {
            return;
        };
        let Ok(java) = std::fs::canonicalize(java) else {
            return;
        };
        let java_home = java
            .parent()
            .and_then(Path::parent)
            .expect("Java executable should be under <home>/bin");
        let probe = tempfile::tempdir().unwrap();
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![
                PathAccess::new(probe.path(), true, true, false),
                PathAccess::new(java_home, true, false, false).loadable(),
            ],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![java.clone()],
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let profile_guard = TestProfileGuard(policy.clone());
        let policy_path = probe.path().join("policy.json");
        std::fs::write(&policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();

        let output = Command::new(&helper)
            .args([
                "--windows-policy",
                policy_path.to_str().unwrap(),
                "--",
                java.to_str().unwrap(),
                "-XshowSettings:security:providers",
                "-version",
            ])
            .current_dir(probe.path())
            .output()
            .unwrap();
        drop(profile_guard);

        assert!(
            output.status.success(),
            "sandboxed Java exited with {}; stdout={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("Provider name: SUN"),
            "Java security providers were not initialized"
        );
    }

    #[test]
    fn bundled_exit_handler_sandboxes_hooks_and_game_as_separate_invocations() {
        let helper = current_windows_helper();
        let Ok(java) = which::which("java.exe") else {
            return;
        };
        let exit_handler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../vesta-launcher/resources/exit-handler/exit-handler.jar");
        let Ok(exit_handler) = std::fs::canonicalize(exit_handler) else {
            return;
        };
        let probe = tempfile::tempdir().unwrap();
        let allowed = probe.path().join("instance");
        let read_only = probe.path().join("shared");
        let host_private = probe.path().join("host-private");
        let sandbox_scratch = host_private.join("scratch");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(&read_only).unwrap();
        std::fs::create_dir_all(&host_private).unwrap();
        std::fs::create_dir_all(&sandbox_scratch).unwrap();
        let allowed_read = allowed.join("read.txt");
        let allowed_write = allowed.join("write.txt");
        let read_only_read = read_only.join("read.txt");
        let read_only_write = read_only.join("write.txt");
        let blocked_read = host_private.join("blocked-read.txt");
        let blocked_write = host_private.join("blocked-write.txt");
        std::fs::write(&allowed_read, "allowed\n").unwrap();
        std::fs::write(&read_only_read, "shared\n").unwrap();
        std::fs::write(&blocked_read, "blocked\n").unwrap();
        std::fs::write(&blocked_write, "unchanged\n").unwrap();
        let loadable_child = allowed.join("loadable-child.exe");
        std::fs::copy(&helper, &loadable_child).unwrap();
        let command_shell = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\cmd.exe"));

        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![
                PathAccess::new(&allowed, true, true, false).loadable(),
                PathAccess::new(&read_only, true, false, false),
                PathAccess::new(&sandbox_scratch, true, true, false).loadable(),
                PathAccess::file(&command_shell, true, false, true),
            ],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![helper.clone(), command_shell],
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let profile_guard = TestProfileGuard(policy.clone());
        let policy_path = host_private.join("windows-policy.json");
        std::fs::write(&policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();
        let pre_marker = allowed.join("pre-hook.txt");
        let post_marker = allowed.join("post-hook.txt");
        let pre_external = allowed.join("pre-external.txt");
        let post_external = allowed.join("post-external.txt");
        let pre_escape = allowed.join("pre-escape.txt");
        let post_escape = allowed.join("post-escape.txt");
        let exit_file = host_private.join("exit-status.json");
        let log_file = host_private.join("game.log");
        let pre_hook = format!(
            "whoami.exe > \"{}\" 2>&1 && echo escaped> \"{}\" & echo pre> \"{}\"",
            pre_external.display(),
            pre_escape.display(),
            pre_marker.display()
        );
        let post_hook = format!(
            "whoami.exe > \"{}\" 2>&1 && echo escaped> \"{}\" & echo post> \"{}\"",
            post_external.display(),
            post_escape.display(),
            post_marker.display()
        );

        let prefix = [
            helper.to_string_lossy().into_owned(),
            "--windows-policy".to_string(),
            policy_path.to_string_lossy().into_owned(),
            "--".to_string(),
        ];
        let mut command = Command::new(java);
        command
            .arg("-jar")
            .arg(&exit_handler)
            .arg("--instance-id")
            .arg("exit-handler-sandbox-probe")
            .arg("--exit-file")
            .arg(&exit_file)
            .arg("--log-file")
            .arg(&log_file)
            .arg("--pre-launch-hook")
            .arg(&pre_hook)
            .arg("--post-exit-hook")
            .arg(&post_hook);
        for arg in &prefix {
            command.arg("--sandbox-prefix-arg").arg(arg);
        }
        let output = command
            .arg("--")
            .arg(&helper)
            .arg("--windows-filesystem-probe")
            .current_dir(&allowed)
            .env("TEMP", &sandbox_scratch)
            .env("TMP", &sandbox_scratch)
            .env("VESTA_WINDOWS_SANDBOX_TEST_BROKER", "1")
            .env(
                "VESTA_PROBE_HOST_SUPERVISOR_PID",
                std::process::id().to_string(),
            )
            .env("VESTA_PROBE_ALLOWED_READ", &allowed_read)
            .env("VESTA_PROBE_ALLOWED_WRITE", &allowed_write)
            .env("VESTA_PROBE_READ_ONLY_READ", &read_only_read)
            .env("VESTA_PROBE_READ_ONLY_WRITE", &read_only_write)
            .env("VESTA_PROBE_BLOCKED_READ", &blocked_read)
            .env("VESTA_PROBE_BLOCKED_WRITE", &blocked_write)
            .env(
                "VESTA_PROBE_SYSTEM_EXECUTABLE",
                r"C:\Windows\System32\whoami.exe",
            )
            .env("VESTA_PROBE_LOADABLE_EXECUTABLE", &loadable_child)
            .output()
            .unwrap();

        drop(profile_guard);
        assert!(
            output.status.success(),
            "exit-handler sandbox probe exited with {}; stdout={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(std::fs::read_to_string(&pre_marker).unwrap().trim(), "pre");
        assert_eq!(
            std::fs::read_to_string(&post_marker).unwrap().trim(),
            "post"
        );
        assert!(pre_external.is_file());
        assert!(post_external.is_file());
        assert!(!pre_escape.exists());
        assert!(!post_escape.exists());
        let log = std::fs::read_to_string(&log_file).unwrap();
        assert!(log.contains("vesta-windows-sandbox-filesystem-probe-ok"));
        let exit_status = std::fs::read_to_string(&exit_file).unwrap();
        assert!(exit_status.contains("\"exit_code\": 0"));
    }

    #[test]
    fn game_shaped_policy_launches_java_with_required_load_and_write_authority() {
        let helper = current_windows_helper();
        let Ok(host_java) = which::which("java.exe") else {
            return;
        };
        let Ok(javac) = which::which("javac.exe") else {
            return;
        };
        let Ok(host_java) = std::fs::canonicalize(host_java) else {
            return;
        };
        let host_java_home = host_java
            .parent()
            .and_then(Path::parent)
            .expect("Java executable should be under <home>/bin");
        let jlink = host_java_home.join("bin/jlink.exe");
        if !jlink.is_file() {
            return;
        }

        let probe = tempfile::tempdir().unwrap();
        // A linked runtime below the test root proves Vesta-managed Java gets
        // its required ACLs; Program Files Java has AppContainer baseline ACLs
        // and would not exercise this policy entry.
        let java_home = probe.path().join("managed-runtime");
        let linked = Command::new(jlink)
            .args([
                "--add-modules",
                "java.base",
                "--strip-debug",
                "--no-header-files",
                "--no-man-pages",
                "--output",
            ])
            .arg(&java_home)
            .output()
            .unwrap();
        assert!(
            linked.status.success(),
            "could not create managed Java sandbox probe runtime: stdout={}; stderr={}",
            String::from_utf8_lossy(&linked.stdout),
            String::from_utf8_lossy(&linked.stderr)
        );
        let java = std::fs::canonicalize(java_home.join("bin/java.exe")).unwrap();
        let game = probe.path().join("instance");
        let data = probe.path().join("data");
        let assets = data.join("assets");
        let libraries = data.join("libraries");
        let versions = data.join("versions");
        let natives = data.join("natives");
        let logs = data.join("logs");
        let private_temp = probe.path().join("private-temp");
        let blocked = probe.path().join("blocked");
        for directory in [
            &game,
            &assets,
            &libraries,
            &versions,
            &natives,
            &logs,
            &private_temp,
            &blocked,
        ] {
            std::fs::create_dir_all(directory).unwrap();
        }

        let asset_file = assets.join("asset.txt");
        let library_file = libraries.join("library.txt");
        let version_file = versions.join("version.txt");
        let native_marker = natives.join("native.txt");
        let log_file = logs.join("session.log");
        let game_output = game.join("game-output.txt");
        let blocked_file = blocked.join("secret.txt");
        for (path, contents) in [
            (&asset_file, "asset\n"),
            (&library_file, "library\n"),
            (&version_file, "version\n"),
            (&native_marker, "native\n"),
        ] {
            std::fs::write(path, contents).unwrap();
        }
        std::fs::write(&log_file, "before\n").unwrap();
        std::fs::write(&blocked_file, "secret\n").unwrap();

        let source = game.join("VestaSandboxGameProbe.java");
        std::fs::write(
            &source,
            r#"
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Security;

public final class VestaSandboxGameProbe {
    private static Path env(String name) {
        return Path.of(System.getenv(name));
    }

    public static void main(String[] args) throws Exception {
        if (Security.getProviders().length == 0) {
            throw new IllegalStateException("Java security providers were not initialized");
        }
        MessageDigest.getInstance("SHA-256").digest(new byte[] { 1, 2, 3 });
        new SecureRandom().nextBytes(new byte[32]);
        System.load(env("VESTA_PROBE_NATIVE_LIBRARY").toAbsolutePath().toString());
        if (args.length == 1 && args[0].equals("--load-only")) {
            return;
        }

        for (String name : new String[] {
            "VESTA_PROBE_ASSET", "VESTA_PROBE_LIBRARY",
            "VESTA_PROBE_VERSION", "VESTA_PROBE_NATIVE_MARKER"
        }) {
            if (Files.readString(env(name)).isBlank()) {
                throw new IllegalStateException("shared runtime read was empty: " + name);
            }
        }
        Files.writeString(env("VESTA_PROBE_GAME_OUTPUT"), "game-write\n");
        Files.writeString(
            env("VESTA_PROBE_LOG"),
            "sandbox-log\n",
            StandardOpenOption.TRUNCATE_EXISTING
        );
        Files.writeString(env("VESTA_PROBE_TEMP_OUTPUT"), "temp-write\n");

        try {
            Files.writeString(env("VESTA_PROBE_ASSET"), "unexpected\n");
            throw new IllegalStateException("shared runtime write unexpectedly succeeded");
        } catch (IOException | SecurityException expected) {
            // Expected: shared runtime roots are load/read-only.
        }
        try {
            Files.writeString(env("VESTA_PROBE_NATIVE_MARKER"), "unexpected\n");
            throw new IllegalStateException("native root write unexpectedly succeeded");
        } catch (IOException | SecurityException expected) {
            // Expected: native libraries are loadable but not writable.
        }
        try {
            Files.readString(env("VESTA_PROBE_BLOCKED"));
            throw new IllegalStateException("undeclared read unexpectedly succeeded");
        } catch (IOException | SecurityException expected) {
            // Expected: undeclared launcher/private data is inaccessible.
        }
        for (String name : new String[] {
            "VESTA_PROBE_SYSTEM_EXECUTABLE", "VESTA_PROBE_LOADABLE_EXECUTABLE"
        }) {
            try {
                new ProcessBuilder(env(name).toString()).start();
                throw new IllegalStateException("child process unexpectedly started: " + name);
            } catch (IOException | SecurityException expected) {
                // Expected: the game JVM token cannot create child processes.
            }
        }
        System.out.println("vesta-windows-sandbox-game-probe-ok");
    }
}
"#,
        )
        .unwrap();
        let compile = Command::new(javac)
            .arg(&source)
            .current_dir(&game)
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "could not compile Java sandbox probe: stdout={}; stderr={}",
            String::from_utf8_lossy(&compile.stdout),
            String::from_utf8_lossy(&compile.stderr)
        );

        // Choose a DLL from the managed java.base image that is independently
        // loadable after copying. The preflight separates DLL suitability from
        // the AppContainer permission assertion below.
        let mut native_preflight_errors = Vec::new();
        let native_library = ["jimage.dll", "verify.dll", "net.dll", "nio.dll", "zip.dll"]
            .into_iter()
            .find_map(|name| {
                let source = java_home.join("bin").join(name);
                if !source.is_file() {
                    return None;
                }
                let destination = natives.join(format!("vesta-native-load-{name}"));
                std::fs::copy(&source, &destination).unwrap();
                let output = Command::new(&java)
                    .arg("-cp")
                    .arg(&game)
                    .arg("VestaSandboxGameProbe")
                    .arg("--load-only")
                    .env("VESTA_PROBE_NATIVE_LIBRARY", &destination)
                    .output()
                    .unwrap();
                if output.status.success() {
                    Some(destination)
                } else {
                    native_preflight_errors.push(format!(
                        "{name}: stdout={}; stderr={}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    ));
                    let _ = std::fs::remove_file(destination);
                    None
                }
            })
            .unwrap_or_else(|| {
                panic!(
                    "no managed-runtime DLL was suitable for the native load probe: {}",
                    native_preflight_errors.join(" | ")
                )
            });
        let loadable_child = game.join("loadable-child.exe");
        std::fs::copy(&helper, &loadable_child).unwrap();

        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![
                PathAccess::new(&game, true, true, false).loadable(),
                PathAccess::file(&log_file, true, true, false),
                PathAccess::new(&assets, true, false, false),
                PathAccess::new(&libraries, true, false, false),
                PathAccess::new(&versions, true, false, false),
                PathAccess::new(&natives, true, false, false).loadable(),
                PathAccess::new(&java_home, true, false, false).loadable(),
                PathAccess::new(&private_temp, true, true, false).loadable(),
            ],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![java.clone()],
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let profile_guard = TestProfileGuard(policy.clone());
        let policy_path = private_temp.join("windows-policy.json");
        std::fs::write(&policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();

        let output = Command::new(&helper)
            .args(["--windows-policy"])
            .arg(&policy_path)
            .arg("--")
            .arg(&java)
            .arg("-cp")
            .arg(&game)
            .arg("VestaSandboxGameProbe")
            .current_dir(&game)
            .env("TEMP", &private_temp)
            .env("TMP", &private_temp)
            .env("VESTA_PROBE_ASSET", &asset_file)
            .env("VESTA_PROBE_LIBRARY", &library_file)
            .env("VESTA_PROBE_VERSION", &version_file)
            .env("VESTA_PROBE_NATIVE_MARKER", &native_marker)
            .env("VESTA_PROBE_NATIVE_LIBRARY", &native_library)
            .env("VESTA_PROBE_GAME_OUTPUT", &game_output)
            .env("VESTA_PROBE_LOG", &log_file)
            .env(
                "VESTA_PROBE_TEMP_OUTPUT",
                private_temp.join("temp-output.txt"),
            )
            .env("VESTA_PROBE_BLOCKED", &blocked_file)
            .env(
                "VESTA_PROBE_SYSTEM_EXECUTABLE",
                r"C:\Windows\System32\whoami.exe",
            )
            .env("VESTA_PROBE_LOADABLE_EXECUTABLE", &loadable_child)
            .output()
            .unwrap();
        let acl_diagnostics = if output.status.success() {
            String::new()
        } else {
            [
                java.clone(),
                java_home.join("bin/jli.dll"),
                java_home.join("bin/server/jvm.dll"),
            ]
            .iter()
            .map(|path| {
                let acl = Command::new("icacls.exe").arg(path).output().unwrap();
                format!(
                    "{}: stdout={}; stderr={}",
                    path.display(),
                    String::from_utf8_lossy(&acl.stdout),
                    String::from_utf8_lossy(&acl.stderr)
                )
            })
            .collect::<Vec<_>>()
            .join(" | ")
        };
        drop(profile_guard);

        assert!(
            output.status.success(),
            "sandboxed game-shaped Java probe exited with {}; stdout={}; stderr={}; ACLs={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
            acl_diagnostics
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("vesta-windows-sandbox-game-probe-ok")
        );
        assert_eq!(
            std::fs::read_to_string(game_output).unwrap(),
            "game-write\n"
        );
        assert_eq!(std::fs::read_to_string(log_file).unwrap(), "sandbox-log\n");
        assert_eq!(
            std::fs::read_to_string(private_temp.join("temp-output.txt")).unwrap(),
            "temp-write\n"
        );
        assert_eq!(std::fs::read_to_string(asset_file).unwrap(), "asset\n");
        assert_eq!(std::fs::read_to_string(native_marker).unwrap(), "native\n");
        assert_eq!(std::fs::read_to_string(blocked_file).unwrap(), "secret\n");
    }

    struct TestProfileGuard(SandboxPolicy);

    impl Drop for TestProfileGuard {
        fn drop(&mut self) {
            let _ = cleanup_test_profile(&self.0);
        }
    }

    fn cleanup_test_profile(policy: &SandboxPolicy) -> Result<(), String> {
        let profile_name = profile_name_for_policy(policy)?;
        cleanup_profile_name(&profile_name)
    }

    fn cleanup_profile_name(profile_name: &str) -> Result<(), String> {
        // Match production lock order: profile lifetime first, global ACL
        // reconciliation second.
        let _profile_lock = acquire_profile_launch_lock(profile_name)?;
        let _acl_reconciliation_lock = acquire_acl_reconciliation_lock()?;
        let profile = AppContainerProfile::ensure(profile_name, profile_name, None)
            .map_err(|err| format!("could not reopen test AppContainer profile: {err}"))?;
        let journal_path = acl_journal_path(profile_name)?;
        if let Ok(journal) = read_acl_journal(&journal_path) {
            for entry in &journal.entries {
                if journal.format_version < ACL_JOURNAL_FORMAT_VERSION {
                    let _ = revoke_legacy_acl_entry(entry, profile.sid.as_string());
                } else {
                    let _ = revoke_acl_entry(entry, profile.sid.as_string());
                }
            }
        }
        let _ = std::fs::remove_file(journal_path);
        let _ = profile.delete();
        Ok(())
    }
}
