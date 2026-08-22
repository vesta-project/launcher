//! Linux sandbox adapter via bubblewrap (`bwrap`).
//!
//! Maps the portable [`SandboxPolicy`] to bind mounts, namespaces, and spawn argv.
//! Modded/Paranoid require a working `bwrap` binary; Trusted passes through upstream.

use crate::enforcement::{EnforcementReport, EnforcementStatus};
use crate::policy::{PathAccess, SandboxPolicy, WrapperNesting};
use crate::spawn::{RunPlan, SandboxedSpawn};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

const BWRAP_CANDIDATES: &[&str] = &["/usr/bin/bwrap", "/bin/bwrap"];

/// Immutable host paths commonly required by a JVM/LWJGL stack on Linux.
const COMPAT_RO_ROOTS: &[&str] = &[
    "/usr",
    "/lib",
    "/lib64",
    "/lib32",
    "/bin",
    "/sbin",
    "/etc",
];

/// Returns the resolved bubblewrap executable path when present on this host.
pub(crate) fn bubblewrap_path() -> Option<PathBuf> {
    for candidate in BWRAP_CANDIDATES {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }

    which::which("bwrap").ok()
}

/// Whether bubblewrap is installed and usable for Linux sandbox presets.
pub fn bubblewrap_available() -> bool {
    bubblewrap_path().is_some()
}

/// Whether unprivileged user namespaces are enabled and functional for bubblewrap.
pub fn user_namespace_available() -> bool {
    let Some(bwrap) = bubblewrap_path() else {
        return false;
    };

    let mut probe_args = vec![
        "--unshare-user".to_string(),
        "--die-with-parent".to_string(),
    ];
    for root in ["/usr", "/bin", "/lib", "/lib64"] {
        let path = Path::new(root);
        if path.exists() {
            probe_args.push("--ro-bind".to_string());
            probe_args.push(path.to_string_lossy().into_owned());
            probe_args.push(path.to_string_lossy().into_owned());
        }
    }
    probe_args.extend(["--".to_string(), "/bin/true".to_string()]);

    // Functional probe is authoritative: setuid bubblewrap works on some distros
    // even when kernel.unprivileged_userns_clone is 0.
    Command::new(&bwrap)
        .args(&probe_args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Whether bubblewrap sandbox enforcement is ready on this host.
pub fn sandbox_enforcement_ready() -> bool {
    bubblewrap_path().is_some()
        && user_namespace_available()
        && crate::landlock_exec::landlock_enforcement_ready()
}

pub(crate) fn prepare(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (SandboxedSpawn, EnforcementReport) {
    let Some(bwrap) = bubblewrap_path() else {
        return missing_bubblewrap(run_plan, policy);
    };

    let sandbox_temp = match tempfile::Builder::new()
        .prefix("vesta-sandbox-")
        .tempdir()
    {
        Ok(dir) => dir.keep(),
        Err(err) => {
            return unsupported_with_note(
                run_plan,
                policy,
                format!("Failed to create a private sandbox temp directory: {err}"),
            );
        }
    };

    let mut args = build_bwrap_args(policy, run_plan, &sandbox_temp);
    let landlock_helper = match append_landlock_exec_wrapper(&mut args, policy) {
        Ok(()) => crate::landlock_exec::landlock_helper_path(),
        Err(note) => {
            return unsupported_with_note(run_plan, policy, note);
        }
    };

    let mut notes = vec![
        format!(
            "Linux bubblewrap sandbox via {}.",
            bwrap.to_string_lossy()
        ),
        "Filesystem confined via bind mounts; only declared roots and JVM compatibility paths are visible."
            .to_string(),
        "Exec confinement on Linux combines Landlock execute allowlists with bubblewrap filesystem visibility (macOS uses Seatbelt process-exec rules)."
            .to_string(),
    ];
    if let Some(helper) = &landlock_helper {
        notes.push(format!(
            "Landlock exec allowlist enforced via {}.",
            helper.to_string_lossy()
        ));
    }

    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push(
            "Wrapper-outside nesting selected: the wrapper itself has normal user access; confinement begins at bubblewrap around the Java process tree."
                .to_string(),
        );
    }

    let network_status = if policy.network_allowed {
        EnforcementStatus::NotRequired
    } else {
        notes.push("Network denied via bubblewrap (--unshare-net).".to_string());
        EnforcementStatus::Enforced
    };

    let mic_status = if policy.mic_allowed {
        notes.push(
            "Microphone allowed; IPC namespace retained for desktop audio when present.".to_string(),
        );
        EnforcementStatus::NotRequired
    } else {
        notes.push(
            "Microphone denied via bubblewrap (--unshare-ipc, read-only XDG_RUNTIME_DIR, and no /dev/snd bind); GPU device nodes remain available."
                .to_string(),
        );
        EnforcementStatus::Enforced
    };

    let mut env = run_plan.env.clone();
    env.insert(
        "TMPDIR".to_string(),
        sandbox_temp.to_string_lossy().to_string(),
    );

    let spawn = SandboxedSpawn::Prepared {
        program: bwrap,
        args,
        env,
        cwd: run_plan.cwd.clone(),
        pre_exec_notes: notes.clone(),
        cleanup_paths: vec![sandbox_temp],
    };

    let report = EnforcementReport {
        filesystem: EnforcementStatus::Enforced,
        network: network_status,
        exec: EnforcementStatus::Enforced,
        mic: mic_status,
        notes,
    };

    (spawn, report)
}

fn missing_bubblewrap(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (SandboxedSpawn, EnforcementReport) {
    let mut notes = vec![
        "bubblewrap (bwrap) is not installed.".to_string(),
        "Install the bubblewrap package to use Modded or Paranoid sandbox presets on Linux."
            .to_string(),
        "Fedora/RHEL: sudo dnf install bubblewrap".to_string(),
        "Debian/Ubuntu: sudo apt-get install bubblewrap".to_string(),
    ];

    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push("Wrapper-outside nesting is configured.".to_string());
    }

    (
        SandboxedSpawn::Prepared {
            program: run_plan.program.clone(),
            args: run_plan.args.clone(),
            env: run_plan.env.clone(),
            cwd: run_plan.cwd.clone(),
            pre_exec_notes: notes.clone(),
            cleanup_paths: Vec::new(),
        },
        EnforcementReport {
            filesystem: EnforcementStatus::Unsupported,
            network: if policy.network_allowed {
                EnforcementStatus::NotRequired
            } else {
                EnforcementStatus::Unsupported
            },
            exec: EnforcementStatus::Unsupported,
            mic: if policy.mic_allowed {
                EnforcementStatus::NotRequired
            } else {
                EnforcementStatus::Unsupported
            },
            notes,
        },
    )
}

fn unsupported_with_note(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
    note: String,
) -> (SandboxedSpawn, EnforcementReport) {
    let mut notes = vec![note];
    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push("Wrapper-outside nesting is configured.".to_string());
    }

    (
        SandboxedSpawn::Prepared {
            program: run_plan.program.clone(),
            args: run_plan.args.clone(),
            env: run_plan.env.clone(),
            cwd: run_plan.cwd.clone(),
            pre_exec_notes: notes.clone(),
            cleanup_paths: Vec::new(),
        },
        EnforcementReport {
            filesystem: EnforcementStatus::Unsupported,
            network: if policy.network_allowed {
                EnforcementStatus::NotRequired
            } else {
                EnforcementStatus::Unsupported
            },
            exec: EnforcementStatus::Unsupported,
            mic: if policy.mic_allowed {
                EnforcementStatus::NotRequired
            } else {
                EnforcementStatus::Unsupported
            },
            notes,
        },
    )
}

fn build_bwrap_args(
    policy: &SandboxPolicy,
    run_plan: &RunPlan,
    sandbox_temp: &Path,
) -> Vec<String> {
    let mut args = vec![
        "--unshare-user".to_string(),
        "--die-with-parent".to_string(),
        "--new-session".to_string(),
    ];

    if !policy.network_allowed {
        args.push("--unshare-net".to_string());
    }

    if !policy.mic_allowed {
        args.push("--unshare-ipc".to_string());
    }

    args.push("--proc".to_string());
    args.push("/proc".to_string());
    push_device_binds(&mut args, policy.mic_allowed);

    push_bind_mount(&mut args, sandbox_temp, sandbox_temp, true);

    for root in COMPAT_RO_ROOTS {
        push_existing_ro_bind(&mut args, Path::new(root));
    }

    let mut seen = BTreeSet::new();
    for entry in policy
        .filesystem_allowlist
        .iter()
        .chain(policy.extra_paths.iter())
    {
        push_path_access(&mut args, entry, &mut seen);
    }

    push_existing_ro_bind(&mut args, Path::new("/tmp/.X11-unix"));
    if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
        let runtime_path = Path::new(&runtime_dir);
        if policy.mic_allowed {
            push_existing_bind(&mut args, runtime_path, true);
        } else {
            // Read-only runtime dir keeps Wayland display sockets visible while blocking
            // PipeWire/Pulse socket writes when mic is denied.
            push_existing_ro_bind(&mut args, runtime_path);
        }
    }

    args.push("--clearenv".to_string());
    push_host_env_if_missing(
        &mut args,
        run_plan,
        &[
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XAUTHORITY",
            "XDG_RUNTIME_DIR",
            "XDG_SESSION_TYPE",
        ],
    );
    for (key, value) in &run_plan.env {
        if key == "TMPDIR" {
            continue;
        }
        args.push("--setenv".to_string());
        args.push(key.clone());
        args.push(value.clone());
    }

    args.push("--setenv".to_string());
    args.push("TMPDIR".to_string());
    args.push(sandbox_temp.to_string_lossy().into_owned());

    args.push("--chdir".to_string());
    args.push(run_plan.cwd.to_string_lossy().into_owned());

    args
}

fn append_landlock_exec_wrapper(
    args: &mut Vec<String>,
    policy: &SandboxPolicy,
) -> Result<(), String> {
    if !crate::landlock_exec::landlock_available() {
        return Err(
            "Landlock exec allowlists are unavailable on this kernel; Modded and Paranoid presets cannot be enforced."
                .to_string(),
        );
    }

    let helper = crate::landlock_exec::landlock_helper_path().ok_or_else(|| {
        "The vesta-sandbox-exec helper was not found next to the launcher; reinstall or rebuild Vesta Launcher."
            .to_string()
    })?;

    push_existing_ro_bind(args, &helper);
    args.push("--".to_string());
    args.push(helper.to_string_lossy().into_owned());
    for exec in &policy.exec_allowlist {
        args.push("--exec-allow".to_string());
        args.push(exec.to_string_lossy().into_owned());
    }
    args.push("--exec-allow".to_string());
    args.push(helper.to_string_lossy().into_owned());
    args.push("--".to_string());
    Ok(())
}

fn push_device_binds(args: &mut Vec<String>, mic_allowed: bool) {
    if mic_allowed {
        if Path::new("/dev").exists() {
            args.push("--dev-bind".to_string());
            args.push("/dev".to_string());
            args.push("/dev".to_string());
        } else {
            args.push("--dev".to_string());
            args.push("/dev".to_string());
        }
        return;
    }

    // Mic denied: minimal devtmpfs plus GPU nodes only — omit /dev/snd capture devices.
    args.push("--dev".to_string());
    args.push("/dev".to_string());
    if Path::new("/dev/dri").exists() {
        args.push("--dev-bind".to_string());
        args.push("/dev/dri".to_string());
        args.push("/dev/dri".to_string());
    }
    for node in ["/dev/nvidia0", "/dev/nvidiactl", "/dev/nvidia-uvm"] {
        let path = Path::new(node);
        if path.exists() {
            args.push("--dev-bind".to_string());
            args.push(path.to_string_lossy().into_owned());
            args.push(path.to_string_lossy().into_owned());
        }
    }
}

fn push_host_env_if_missing(args: &mut Vec<String>, run_plan: &RunPlan, keys: &[&str]) {
    for key in keys {
        if run_plan.env.contains_key(*key) {
            continue;
        }
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                args.push("--setenv".to_string());
                args.push((*key).to_string());
                args.push(value);
            }
        }
    }
}

fn push_path_access(args: &mut Vec<String>, entry: &PathAccess, seen: &mut BTreeSet<PathBuf>) {
    let path = entry.path.clone();
    if !seen.insert(path.clone()) {
        return;
    }

    if entry.write {
        push_bind_mount(args, &path, &path, entry.recursive);
        return;
    }

    if entry.read {
        push_bind_mount(args, &path, &path, false);
    }
}

fn push_existing_ro_bind(args: &mut Vec<String>, path: &Path) {
    if path.exists() {
        push_bind_mount(args, path, path, false);
    }
}

fn push_existing_bind(args: &mut Vec<String>, path: &Path, read_write: bool) {
    if path.exists() {
        push_bind_mount(args, path, path, read_write);
    }
}

fn push_bind_mount(args: &mut Vec<String>, host: &Path, target: &Path, read_write: bool) {
    args.push(if read_write { "--bind" } else { "--ro-bind" }.to_string());
    args.push(host.to_string_lossy().into_owned());
    args.push(target.to_string_lossy().into_owned());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{resolve_preset, SandboxPreset};
    use std::collections::HashMap;
    use std::fs;
    use std::process::Command;

    fn sample_policy(preset: SandboxPreset, game_dir: &Path) -> SandboxPolicy {
        let caps = resolve_preset(preset);
        SandboxPolicy {
            enabled: caps.enabled,
            preset,
            filesystem_allowlist: vec![PathAccess::new(game_dir, true, true, false)],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/usr/bin/java")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        }
    }

    #[test]
    fn sandbox_enforcement_ready_requires_bwrap_user_namespace_and_landlock() {
        assert_eq!(
            sandbox_enforcement_ready(),
            bubblewrap_path().is_some()
                && user_namespace_available()
                && crate::landlock_exec::landlock_enforcement_ready()
        );
    }

    #[test]
    fn bubblewrap_available_matches_path_lookup() {
        assert_eq!(bubblewrap_available(), bubblewrap_path().is_some());
    }

    #[test]
    fn prepare_fails_closed_when_bwrap_missing() {
        let plan = RunPlan::new(
            "/usr/bin/java",
            vec!["-version".into()],
            "/tmp",
            HashMap::new(),
        );
        let policy = sample_policy(SandboxPreset::Modded, Path::new("/tmp/game"));

        if sandbox_enforcement_ready() {
            let (spawn, report) = prepare(&plan, &policy);
            match spawn {
                SandboxedSpawn::Prepared { cleanup_paths, .. } => {
                    for path in cleanup_paths {
                        let _ = fs::remove_dir_all(path);
                    }
                }
                SandboxedSpawn::Passthrough => panic!("expected prepared spawn"),
            }
            assert_eq!(report.filesystem, EnforcementStatus::Enforced);
            return;
        }

        if bubblewrap_available() {
            return;
        }

        let (spawn, report) = prepare(&plan, &policy);
        assert!(matches!(spawn, SandboxedSpawn::Prepared { .. }));
        assert_eq!(report.filesystem, EnforcementStatus::Unsupported);
        assert!(
            report
                .notes
                .iter()
                .any(|note| note.contains("bubblewrap"))
        );
    }

    #[test]
    fn build_bwrap_args_include_private_temp_and_allowlist() {
        let temp = std::env::temp_dir().join("vesta-bwrap-args-test");
        let _ = fs::create_dir_all(&temp);
        let policy = sample_policy(SandboxPreset::Paranoid, &temp);
        let plan = RunPlan::new("/usr/bin/java", Vec::new(), &temp, HashMap::new());
        let sandbox_temp = std::env::temp_dir().join("vesta-bwrap-private-temp");
        let args = build_bwrap_args(&policy, &plan, &sandbox_temp);

        assert!(args.iter().any(|arg| arg == "--unshare-net"));
        assert!(args.iter().any(|arg| arg == "--unshare-ipc"));
        assert!(args.iter().any(|arg| arg == "--die-with-parent"));
        assert!(args.iter().any(|arg| arg == "--clearenv"));
        if Path::new("/dev").exists() {
            assert!(
                !args.windows(3)
                    .any(|window| window == ["--dev-bind", "/dev", "/dev"]),
                "Paranoid must not bind the full host /dev tree when mic is denied"
            );
            assert!(
                args.windows(2).any(|window| window == ["--dev", "/dev"]),
                "expected minimal --dev /dev when mic is denied"
            );
        }
        assert!(
            args.windows(3)
                .any(|window| window[0] == "--bind" && window[1] == temp.to_string_lossy())
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn paranoid_build_bwrap_args_includes_display_binds_when_mic_denied() {
        let temp = std::env::temp_dir().join("vesta-bwrap-display-test");
        let _ = fs::create_dir_all(&temp);
        let policy = sample_policy(SandboxPreset::Paranoid, &temp);
        assert!(!policy.mic_allowed);
        let plan = RunPlan::new("/usr/bin/java", Vec::new(), &temp, HashMap::new());
        let sandbox_temp = std::env::temp_dir().join("vesta-bwrap-private-temp-display");
        let args = build_bwrap_args(&policy, &plan, &sandbox_temp);

        if Path::new("/tmp/.X11-unix").exists() {
            assert!(
                args.windows(3).any(|window| {
                    window[0] == "--ro-bind" && window[1] == "/tmp/.X11-unix"
                }),
                "Paranoid preset must bind /tmp/.X11-unix even when mic is denied"
            );
        }
        if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
            if Path::new(&runtime_dir).exists() {
                assert!(
                    args.windows(3).any(|window| {
                        window[0] == "--ro-bind" && window[1] == runtime_dir
                    }),
                    "Paranoid must ro-bind XDG_RUNTIME_DIR when mic is denied"
                );
            }
        }
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn build_bwrap_args_uses_dev_bind_when_dev_exists() {
        let temp = std::env::temp_dir().join("vesta-bwrap-dev-bind-test");
        let _ = fs::create_dir_all(&temp);
        let policy = sample_policy(SandboxPreset::Modded, &temp);
        let plan = RunPlan::new("/usr/bin/java", Vec::new(), &temp, HashMap::new());
        let sandbox_temp = std::env::temp_dir().join("vesta-bwrap-private-temp-dev");
        let args = build_bwrap_args(&policy, &plan, &sandbox_temp);

        if Path::new("/dev").exists() {
            assert!(
                args.windows(3)
                    .any(|window| window == ["--dev-bind", "/dev", "/dev"]),
                "expected --dev-bind /dev /dev when /dev exists"
            );
        } else {
            assert!(
                args.windows(2)
                    .any(|window| window == ["--dev", "/dev"]),
                "expected --dev /dev fallback when /dev is missing"
            );
        }
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn modded_build_bwrap_args_rw_binds_runtime_dir_when_mic_allowed() {
        let temp = std::env::temp_dir().join("vesta-bwrap-modded-runtime-test");
        let _ = fs::create_dir_all(&temp);
        let policy = sample_policy(SandboxPreset::Modded, &temp);
        assert!(policy.mic_allowed);
        let plan = RunPlan::new("/usr/bin/java", Vec::new(), &temp, HashMap::new());
        let sandbox_temp = std::env::temp_dir().join("vesta-bwrap-private-temp-modded");
        let args = build_bwrap_args(&policy, &plan, &sandbox_temp);

        if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
            if Path::new(&runtime_dir).exists() {
                assert!(
                    args.windows(3)
                        .any(|window| window[0] == "--bind" && window[1] == runtime_dir),
                    "Modded must rw-bind XDG_RUNTIME_DIR when mic is allowed"
                );
            }
        }
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn paranoid_denies_loopback_network_connections() {
        use std::net::TcpListener;

        let bwrap = match bubblewrap_path() {
            Some(path) => path,
            None => return,
        };
        if !user_namespace_available() {
            return;
        }

        let netcat = ["/usr/bin/nc", "/bin/nc"]
            .iter()
            .map(Path::new)
            .find(|path| path.is_file());
        let Some(netcat) = netcat else {
            return;
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();

        let mut sandbox_args = vec![
            "--unshare-user".to_string(),
            "--die-with-parent".to_string(),
            "--unshare-net".to_string(),
            "--proc".to_string(),
            "/proc".to_string(),
        ];
        if Path::new("/dev").exists() {
            sandbox_args.extend([
                "--dev-bind".to_string(),
                "/dev".to_string(),
                "/dev".to_string(),
            ]);
        } else {
            sandbox_args.extend(["--dev".to_string(), "/dev".to_string()]);
        }
        sandbox_args.extend([
            "--ro-bind".to_string(),
            "/usr".to_string(),
            "/usr".to_string(),
            "--ro-bind".to_string(),
            "/bin".to_string(),
            "/bin".to_string(),
            "--".to_string(),
            netcat.to_string_lossy().into_owned(),
            "-z".to_string(),
            "-w".to_string(),
            "1".to_string(),
            "127.0.0.1".to_string(),
            port.clone(),
        ]);

        let sandboxed = Command::new(&bwrap)
            .args(&sandbox_args)
            .status()
            .unwrap();
        assert!(
            !sandboxed.success(),
            "Paranoid bubblewrap profile allowed a loopback connection"
        );

        let unsandboxed = Command::new(netcat)
            .args(["-z", "-w", "1", "127.0.0.1", &port])
            .status()
            .unwrap();
        assert!(
            unsandboxed.success(),
            "network denial probe endpoint was not reachable"
        );
    }

    #[test]
    fn bubblewrap_enforces_declared_read_and_write_access() {
        if !sandbox_enforcement_ready() {
            return;
        }
        let _bwrap = bubblewrap_path().unwrap();

        let probe = tempfile::Builder::new()
            .prefix(".vesta-bwrap-probe-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        let allowed = probe.path().join("allowed");
        let read_only = probe.path().join("read-only");
        let blocked = probe.path().join("blocked");
        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&read_only).unwrap();
        fs::create_dir_all(&blocked).unwrap();
        let allowed_read = allowed.join("read.txt");
        let read_only_file = read_only.join("read.txt");
        let read_only_write = read_only.join("write.txt");
        let blocked_read = blocked.join("read.txt");
        let allowed_write = allowed.join("write.txt");
        let blocked_write = blocked.join("write.txt");
        fs::write(&allowed_read, "allowed\n").unwrap();
        fs::write(&read_only_file, "shared\n").unwrap();
        fs::write(&blocked_read, "blocked\n").unwrap();
        fs::write(&blocked_write, "unchanged\n").unwrap();

        let mut probe_env = HashMap::new();
        probe_env.insert(
            "ALLOWED_READ".to_string(),
            allowed_read.to_string_lossy().into_owned(),
        );
        probe_env.insert(
            "READ_ONLY_FILE".to_string(),
            read_only_file.to_string_lossy().into_owned(),
        );
        probe_env.insert(
            "READ_ONLY_WRITE".to_string(),
            read_only_write.to_string_lossy().into_owned(),
        );
        probe_env.insert(
            "BLOCKED_READ".to_string(),
            blocked_read.to_string_lossy().into_owned(),
        );
        probe_env.insert(
            "ALLOWED_WRITE".to_string(),
            allowed_write.to_string_lossy().into_owned(),
        );
        probe_env.insert(
            "BLOCKED_WRITE".to_string(),
            blocked_write.to_string_lossy().into_owned(),
        );

        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![
                PathAccess::new(&allowed, true, true, false),
                PathAccess::new(&read_only, true, false, false),
            ],
            network_allowed: false,
            mic_allowed: false,
            usb_allowed: true,
            exec_allowlist: vec![PathBuf::from("/bin/sh"), PathBuf::from("/bin/bash")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let plan = RunPlan::new("/bin/sh", Vec::new(), probe.path(), probe_env);
        let (spawn, report) = prepare(&plan, &policy);
        assert_eq!(report.filesystem, EnforcementStatus::Enforced);

        let SandboxedSpawn::Prepared {
            program,
            mut args,
            cleanup_paths,
            ..
        } = spawn
        else {
            panic!("expected prepared spawn");
        };

        args.push("/bin/sh".to_string());
        args.push("-c".to_string());
        args.push(
            r#"
                IFS= read -r allowed_value < "$ALLOWED_READ" || exit 10
                [ "$allowed_value" = "allowed" ] || exit 11
                IFS= read -r shared_value < "$READ_ONLY_FILE" || exit 12
                [ "$shared_value" = "shared" ] || exit 13
                IFS= read -r blocked_value < "$BLOCKED_READ" && exit 14
                printf 'written\n' > "$ALLOWED_WRITE" || exit 15
                printf 'changed\n' > "$READ_ONLY_WRITE" && exit 16
                printf 'changed\n' > "$BLOCKED_WRITE" && exit 17
                exit 0
            "#
            .to_string(),
        );

        let output = Command::new(program)
            .args(args)
            .current_dir(probe.path())
            .output()
            .unwrap();

        for path in cleanup_paths {
            let _ = fs::remove_dir_all(path);
        }

        assert!(
            output.status.success(),
            "bubblewrap probe exited with {}; stdout={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read_to_string(&allowed_write).unwrap(), "written\n");
        assert!(!read_only_write.exists());
        assert_eq!(fs::read_to_string(&blocked_write).unwrap(), "unchanged\n");
    }
}
