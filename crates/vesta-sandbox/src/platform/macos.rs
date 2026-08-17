//! macOS Seatbelt adapter via `sandbox-exec`.
//!
//! Uses `(allow default)` plus targeted filesystem, network, microphone, and
//! process-exec denials. A hard `(deny default)` profile aborts the JVM during
//! platform initialization because Java also needs JIT, Mach, and IOKit access.

use crate::enforcement::{EnforcementReport, EnforcementStatus};
use crate::policy::{SandboxPolicy, WrapperNesting};
use crate::spawn::{RunPlan, SandboxedSpawn};
use std::path::{Path, PathBuf};

pub(crate) fn prepare(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (SandboxedSpawn, EnforcementReport) {
    let sandbox_exec = PathBuf::from("/usr/bin/sandbox-exec");
    if !sandbox_exec.is_file() {
        return unsupported_with_note(
            run_plan,
            policy,
            "sandbox-exec not found at /usr/bin/sandbox-exec".to_string(),
        );
    }

    // Create the private temp directory beneath the OS-owned temporary root,
    // not beneath the attacker-writable game directory. `tempfile` uses an
    // unpredictable name and creates the directory atomically with mode 0700.
    let sandbox_temp = match tempfile::Builder::new().prefix("vesta-sandbox-").tempdir() {
        Ok(dir) => dir.keep(),
        Err(err) => {
            return unsupported_with_note(
                run_plan,
                policy,
                format!("Failed to create a private sandbox temp directory: {err}"),
            );
        }
    };
    let profile = build_seatbelt_profile(policy, &sandbox_temp);

    // Keep the profile in argv rather than a shared temp file. A PID-named file
    // could be overwritten by another concurrently prepared instance or by an
    // already-running sandboxed process with temp-directory access.
    let args = vec!["-p".to_string(), profile];
    let mut notes = vec![
        "macOS Seatbelt profile passed inline to sandbox-exec.".to_string(),
        "Profile denies reads and writes outside declared and system compatibility roots."
            .to_string(),
        "Exec confined via process-exec allowlist.".to_string(),
    ];

    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push(
            "Wrapper-outside nesting selected: the wrapper itself has normal user access; filesystem and exec confinement begin at sandbox-exec around the Java process tree."
                .to_string(),
        );
    }

    let network_status = if policy.network_allowed {
        EnforcementStatus::NotRequired
    } else {
        notes.push("Network denied via Seatbelt (deny network*).".to_string());
        EnforcementStatus::Enforced
    };

    let mic_status = if policy.mic_allowed {
        notes.push(
            "Microphone allowed via Seatbelt (allow device-microphone); TCC consent still handled by the launcher when needed."
                .to_string(),
        );
        EnforcementStatus::NotRequired
    } else {
        notes.push("Microphone denied via Seatbelt (deny device-microphone).".to_string());
        EnforcementStatus::Enforced
    };

    let mut env = run_plan.env.clone();
    env.insert(
        "TMPDIR".to_string(),
        sandbox_temp.to_string_lossy().to_string(),
    );

    let spawn = SandboxedSpawn::Prepared {
        program: sandbox_exec,
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

fn build_seatbelt_profile(policy: &SandboxPolicy, sandbox_temp: &Path) -> String {
    let mut lines = vec!["(version 1)".to_string(), "(allow default)".to_string()];
    let mut read_filters = Vec::new();
    let mut metadata_filters = Vec::new();
    let mut write_filters = Vec::new();

    // Reading the root vnode is required to resolve any absolute path. This
    // exposes only the root directory entry, not files beneath other roots.
    read_filters.push(path_filter("literal", Path::new("/")));

    // Immutable operating-system resources required by the JVM, dynamic
    // linker, fonts, graphics, audio, and native libraries. These are adapter
    // mechanics rather than portable user policy.
    for root in [
        "/System",
        "/usr/bin",
        "/usr/sbin",
        "/usr/lib",
        "/usr/libexec",
        "/usr/share",
        "/bin",
        "/sbin",
        "/Library/Fonts",
        "/Library/Java",
        "/Library/Audio",
        "/Library/Preferences",
        "/private/etc",
        "/private/var/db",
    ] {
        read_filters.push(path_filter("subpath", Path::new(root)));
    }

    read_filters.push(path_filter("subpath", sandbox_temp));
    write_filters.push(path_filter("subpath", sandbox_temp));

    for device in ["/dev/null", "/dev/random", "/dev/urandom", "/dev/zero"] {
        read_filters.push(path_filter("literal", Path::new(device)));
        write_filters.push(path_filter("literal", Path::new(device)));
    }

    for entry in policy
        .filesystem_allowlist
        .iter()
        .chain(policy.extra_paths.iter())
    {
        if entry.read {
            read_filters.push(path_filter(
                if entry.recursive {
                    "subpath"
                } else {
                    "literal"
                },
                &entry.path,
            ));
        }
        if entry.write {
            write_filters.push(path_filter(
                if entry.recursive {
                    "subpath"
                } else {
                    "literal"
                },
                &entry.path,
            ));
        }
    }

    metadata_filters.extend(read_filters.iter().cloned());
    // Directory metadata is needed to traverse to the immutable compatibility
    // subtrees, but this does not grant file contents in user-managed siblings
    // such as /usr/local.
    for ancestor in ["/usr", "/Library", "/private", "/private/var", "/dev"] {
        metadata_filters.push(path_filter("literal", Path::new(ancestor)));
    }
    for ancestor in sandbox_temp.ancestors().skip(1) {
        metadata_filters.push(path_filter("literal", ancestor));
    }
    for entry in policy
        .filesystem_allowlist
        .iter()
        .chain(policy.extra_paths.iter())
    {
        for ancestor in entry.path.ancestors().skip(1) {
            metadata_filters.push(path_filter("literal", ancestor));
        }
    }

    // With allow-default profiles an unconditional deny outranks later allows.
    // Deny only operations whose path does not match any approved filter.
    push_deny_outside(&mut lines, "file-read-data", &read_filters);
    push_deny_outside(&mut lines, "file-read-metadata", &metadata_filters);
    push_deny_outside(&mut lines, "file-write*", &write_filters);

    if policy.network_allowed {
        // default already allows network
    } else {
        lines.push("(deny network*)".to_string());
    }

    if policy.mic_allowed {
        lines.push("(allow device-microphone)".to_string());
    } else {
        lines.push("(deny device-microphone)".to_string());
    }

    let mut exec_filters = Vec::new();

    for exec in &policy.exec_allowlist {
        exec_filters.push(exec_filter(exec));
    }
    push_deny_outside(&mut lines, "process-exec*", &exec_filters);

    lines.join("\n") + "\n"
}

fn exec_filter(path: &Path) -> String {
    path_filter(if path.is_dir() { "subpath" } else { "literal" }, path)
}

fn path_filter(kind: &str, path: &Path) -> String {
    let literal = escape_sbpl(path);
    format!("({kind} \"{literal}\")")
}

fn push_deny_outside(lines: &mut Vec<String>, operation: &str, filters: &[String]) {
    debug_assert!(!filters.is_empty());
    lines.push(format!(
        "(deny {operation}\n  (require-not\n    (require-any\n      {})))",
        filters.join("\n      ")
    ));
}

fn escape_sbpl(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{resolve_preset, PathAccess, SandboxPreset};
    use std::collections::HashMap;
    use std::fs;
    use std::process::Command;

    fn test_profile(policy: &SandboxPolicy) -> String {
        let temp = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        build_seatbelt_profile(policy, &temp)
    }

    #[test]
    fn profile_denies_network_and_mic_when_disallowed() {
        let caps = resolve_preset(SandboxPreset::Paranoid);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![PathAccess::new("/tmp/game", true, true, false)],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/usr/bin/java")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let profile = test_profile(&policy);
        assert!(profile.contains("(allow default)"));
        assert!(profile.contains("(deny file-read-data"));
        assert!(profile.contains("(deny file-read-metadata"));
        assert!(profile.contains("(deny file-write*\n"));
        assert!(profile.contains("(subpath \"/tmp/game\")"));
        assert!(profile.contains("(deny network*)"));
        assert!(profile.contains("(deny device-microphone)"));
        assert!(profile.contains("(deny process-exec*\n"));
        assert!(!profile.contains("(literal \"/usr/bin/open\")"));
        assert!(!profile.contains("(subpath \"/private/var/folders\")"));
        assert!(!profile.contains("(subpath \"/usr\")"));
        assert!(!profile.contains("(subpath \"/usr/local\")"));
        assert!(!profile.contains("(literal \"/bin/bash\")"));
    }

    #[test]
    fn profile_allows_microphone_for_modded() {
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![PathAccess::new("/tmp/game", true, true, false)],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/usr/bin/java")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let profile = test_profile(&policy);
        assert!(profile.contains("(allow device-microphone)"));
        assert!(!profile.contains("(deny device-microphone)"));
        assert!(!profile.contains("(deny network*)"));
        assert!(!profile.contains("(literal \"/usr/bin/open\")"));
    }

    #[test]
    fn prepare_uses_sandbox_exec() {
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![PathAccess::new("/tmp/game", true, true, false)],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/usr/bin/java")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let plan = RunPlan::new(
            "/usr/bin/java",
            vec!["-version".into()],
            "/tmp",
            HashMap::new(),
        );
        let (spawn, report) = prepare(&plan, &policy);
        match spawn {
            SandboxedSpawn::Prepared {
                program,
                args,
                cleanup_paths,
                ..
            } => {
                assert_eq!(program, PathBuf::from("/usr/bin/sandbox-exec"));
                assert_eq!(args[0], "-p");
                assert!(args[1].contains("(deny file-read-data"));
                for path in cleanup_paths {
                    fs::remove_dir_all(path).unwrap();
                }
            }
            SandboxedSpawn::Passthrough => panic!("expected Prepared"),
        }
        assert_eq!(report.filesystem, EnforcementStatus::Enforced);
        assert_eq!(report.exec, EnforcementStatus::Enforced);
        assert_eq!(report.network, EnforcementStatus::NotRequired);
    }

    #[test]
    fn read_only_entry_does_not_gain_write_access() {
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![PathAccess::new("/opt/vesta/shared", true, false, false)],
            network_allowed: false,
            mic_allowed: false,
            usb_allowed: true,
            exec_allowlist: vec![PathBuf::from("/bin/sh"), PathBuf::from("/bin/bash")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };

        let profile = test_profile(&policy);
        // The path appears once in read-data and once in read-metadata filters,
        // but never in the write filter.
        assert_eq!(
            profile.matches("(subpath \"/opt/vesta/shared\")").count(),
            2
        );
        assert!(profile.contains("(literal \"/bin/sh\")"));
        let exec_rule = &profile[profile.find("(deny process-exec*").unwrap()..];
        assert!(!exec_rule.contains("(subpath \"/bin\")"));
    }

    #[test]
    fn inline_profiles_are_owned_by_each_preparation() {
        let mut first_policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![PathAccess::new("/opt/vesta/first", true, true, false)],
            network_allowed: true,
            mic_allowed: true,
            usb_allowed: true,
            exec_allowlist: vec![PathBuf::from("/bin/sh"), PathBuf::from("/bin/bash")],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let second_policy = SandboxPolicy {
            filesystem_allowlist: vec![PathAccess::new("/opt/vesta/second", true, true, false)],
            ..first_policy.clone()
        };
        first_policy.preset = SandboxPreset::Paranoid;
        first_policy.network_allowed = false;
        first_policy.mic_allowed = false;

        let plan = RunPlan::new("/bin/sh", Vec::new(), "/", HashMap::new());
        let (first, _) = prepare(&plan, &first_policy);
        let (second, _) = prepare(&plan, &second_policy);

        let profile = |spawn: SandboxedSpawn| match spawn {
            SandboxedSpawn::Prepared {
                args,
                cleanup_paths,
                ..
            } => {
                for path in cleanup_paths {
                    fs::remove_dir_all(path).unwrap();
                }
                args[1].clone()
            }
            SandboxedSpawn::Passthrough => panic!("expected inline profile"),
        };
        let first_profile = profile(first);
        let second_profile = profile(second);
        assert!(first_profile.contains("/opt/vesta/first"));
        assert!(!first_profile.contains("/opt/vesta/second"));
        assert!(second_profile.contains("/opt/vesta/second"));
        assert!(!second_profile.contains("/opt/vesta/first"));
    }

    #[test]
    fn seatbelt_enforces_declared_read_and_write_access() {
        let probe = tempfile::Builder::new()
            .prefix(".vesta-seatbelt-probe-")
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
        let profile = test_profile(&policy);
        let output = Command::new("/usr/bin/sandbox-exec")
            .args([
                "-p",
                &profile,
                "/bin/sh",
                "-c",
                r#"
                    IFS= read -r allowed_value < "$ALLOWED_READ" || exit 10
                    [ "$allowed_value" = "allowed" ] || exit 11
                    IFS= read -r shared_value < "$READ_ONLY_FILE" || exit 12
                    [ "$shared_value" = "shared" ] || exit 13
                    IFS= read -r blocked_value < "$BLOCKED_READ" && exit 14
                    printf 'written\n' > "$ALLOWED_WRITE" || exit 15
                    printf 'changed\n' > "$READ_ONLY_WRITE" && exit 16
                    printf 'changed\n' > "$BLOCKED_WRITE" && exit 17
                    /usr/bin/true && exit 18
                    exit 0
                "#,
            ])
            .current_dir("/System")
            .env("ALLOWED_READ", &allowed_read)
            .env("READ_ONLY_FILE", &read_only_file)
            .env("READ_ONLY_WRITE", &read_only_write)
            .env("BLOCKED_READ", &blocked_read)
            .env("ALLOWED_WRITE", &allowed_write)
            .env("BLOCKED_WRITE", &blocked_write)
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "Seatbelt probe exited with {}; stdout={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read_to_string(&allowed_write).unwrap(), "written\n");
        assert!(!read_only_write.exists());
        assert_eq!(fs::read_to_string(&blocked_write).unwrap(), "unchanged\n");
    }

    #[test]
    fn paranoid_denies_loopback_network_connections() {
        use std::net::TcpListener;

        let sandbox_exec = Path::new("/usr/bin/sandbox-exec");
        let netcat = Path::new("/usr/bin/nc");
        if !sandbox_exec.is_file() || !netcat.is_file() {
            return;
        }

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: Vec::new(),
            network_allowed: false,
            mic_allowed: false,
            usb_allowed: true,
            exec_allowlist: vec![netcat.to_path_buf()],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let profile = test_profile(&policy);

        let sandboxed = Command::new(sandbox_exec)
            .args([
                "-p",
                &profile,
                netcat.to_str().unwrap(),
                "-z",
                "-w",
                "1",
                "127.0.0.1",
                &port,
            ])
            .status()
            .unwrap();
        assert!(
            !sandboxed.success(),
            "Paranoid profile allowed a loopback connection"
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
    fn seatbelt_starts_an_installed_java_runtime() {
        let java_home_output = Command::new("/usr/libexec/java_home").output().unwrap();
        if !java_home_output.status.success() {
            return;
        }
        let java_home = PathBuf::from(
            String::from_utf8_lossy(&java_home_output.stdout)
                .trim()
                .to_string(),
        );
        let java = java_home.join("bin/java");
        if !java.is_file() {
            return;
        }

        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![PathAccess::new(&java_home, true, false, true)],
            network_allowed: false,
            mic_allowed: false,
            usb_allowed: true,
            exec_allowlist: vec![java.clone()],
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        };
        let plan = RunPlan::new(&java, vec!["-version".into()], &java_home, HashMap::new());
        let (spawn, report) = prepare(&plan, &policy);
        assert_eq!(report.filesystem, EnforcementStatus::Enforced);
        let SandboxedSpawn::Prepared {
            program,
            args,
            env,
            cwd,
            cleanup_paths,
            ..
        } = spawn
        else {
            panic!("expected prepared sandbox spawn");
        };
        let output = Command::new(program)
            .args(args)
            .arg(&java)
            .arg("-version")
            .current_dir(cwd)
            .envs(env)
            .output()
            .unwrap();
        for path in cleanup_paths {
            fs::remove_dir_all(path).unwrap();
        }

        assert!(
            output.status.success(),
            "Sandboxed Java exited with {}; stdout={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
