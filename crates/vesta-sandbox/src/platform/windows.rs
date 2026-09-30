//! Windows AppContainer adapter via the `vesta-sandbox-exec` sidecar.

use crate::enforcement::{EnforcementReport, EnforcementStatus};
use crate::policy::{SandboxPolicy, WrapperNesting};
use crate::spawn::{RunPlan, SandboxCommandPlacement, SandboxedSpawn};

pub fn sandbox_enforcement_ready() -> bool {
    crate::windows_exec::windows_helper_path().is_some()
}

pub(crate) fn prepare(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (SandboxedSpawn, EnforcementReport) {
    let Some(helper) = crate::windows_exec::windows_helper_path() else {
        return unsupported_with_note(
            run_plan,
            policy,
            "vesta-sandbox-exec was not found next to the launcher".to_string(),
        );
    };

    let sandbox_temp = match crate::windows_exec::create_windows_policy_temp() {
        Ok(dir) => dir.keep(),
        Err(err) => {
            return unsupported_with_note(
                run_plan,
                policy,
                format!("Failed to create protected Windows sandbox policy state: {err}"),
            );
        }
    };

    // This directory contains only trusted policy state. Each helper invocation
    // creates its writable/loadable target temp beneath the AppContainer's own
    // package temp and removes it after the restricted target exits.
    let policy_path = sandbox_temp.join("windows-policy.json");
    let policy_json = match serde_json::to_vec(policy) {
        Ok(json) => json,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&sandbox_temp);
            return unsupported_with_note(
                run_plan,
                policy,
                format!("Failed to serialize the Windows sandbox policy: {err}"),
            );
        }
    };
    if let Err(err) = std::fs::write(&policy_path, policy_json) {
        let _ = std::fs::remove_dir_all(&sandbox_temp);
        return unsupported_with_note(
            run_plan,
            policy,
            format!("Failed to write the private Windows sandbox policy: {err}"),
        );
    }

    let mut notes = vec![
        "Windows AppContainer confinement launched through vesta-sandbox-exec.".to_string(),
        "Filesystem authority is synchronized to declared roots using a stable per-instance AppContainer SID; stale grants are revoked before launch.".to_string(),
        "Win32 path resolution requires non-inheriting traversal, metadata, and name-enumeration access on private ancestor directories of declared roots. This exposes ancestor entry names, but not child-file contents or writes.".to_string(),
        "Sandboxed Java uses per-launch DOS drives for its user-profile paths and, when needed, an external runtime. Java path canonicalization therefore does not require elevated ACL changes on shared profile parents. Mappings are mutex-reserved and removed at process exit.".to_string(),
        "Each restricted invocation is contained by a kill-on-close Job Object. Launches sharing an instance profile are serialized for their complete lifetime so an existing target cannot race a new trampoline before DACL hardening.".to_string(),
        "Native-image loading is granted only for policy paths marked loadable. NTFS uses the same file right for image loading and execution, so loadable roots also have OS-level execute access.".to_string(),
        "The initial target is validated against the portable exec allowlist, then a trusted AppContainer trampoline creates it with Windows' token-level no-child policy and only standard-I/O handles. The trampoline denies all Everyone and Owner Rights access to itself before the target starts, preventing ACL replacement, process creation, and memory injection through the broker.".to_string(),
        "The launcher-owned exit supervisor remains outside AppContainer and invokes the helper separately for the pre-hook shell, game JVM, and post-hook shell. Each restricted target is validated against the exec allowlist and then denied all descendants.".to_string(),
        "Windows' deny-all child policy is stricter than the portable maximum-authority allowlist: the game cannot start even another allowlisted executable. Generic sandbox-outside wrappers are rejected because they must create Java; wrapper-outside remains an explicit weaker compatibility mode.".to_string(),
        "The reusable policy file is kept outside AppContainer-writable storage. Each restricted invocation receives a fresh package-private temp directory that is removed after exit.".to_string(),
    ];
    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push(
            "Wrapper-outside nesting selected: the wrapper itself has normal user access; AppContainer confinement begins at vesta-sandbox-exec around the Java process tree."
                .to_string(),
        );
    }

    let network = if policy.network_allowed {
        notes.push(
            "Network enabled through AppContainer internet and private-network capabilities."
                .to_string(),
        );
        notes.push(
            "Windows AppContainer loopback remains unavailable unless an administrator manages a package exemption; Vesta does not silently create one."
                .to_string(),
        );
        EnforcementStatus::NotRequired
    } else {
        notes.push("Network denied by omitting AppContainer network capabilities.".to_string());
        EnforcementStatus::Enforced
    };
    let mic = if policy.mic_allowed {
        notes.push(
            "Microphone enabled through the AppContainer microphone capability; Windows privacy consent still applies."
                .to_string(),
        );
        EnforcementStatus::NotRequired
    } else {
        notes.push(
            "Microphone denied by omitting the AppContainer microphone capability.".to_string(),
        );
        EnforcementStatus::Enforced
    };

    let spawn = SandboxedSpawn::Prepared {
        program: helper,
        args: vec![
            "--windows-policy".to_string(),
            policy_path.to_string_lossy().into_owned(),
            "--".to_string(),
        ],
        env: run_plan.env.clone(),
        cwd: run_plan.cwd.clone(),
        pre_exec_notes: notes.clone(),
        placement: SandboxCommandPlacement::GameAndHooks,
        cleanup_paths: vec![sandbox_temp],
    };
    let report = EnforcementReport {
        filesystem: EnforcementStatus::Enforced,
        network,
        exec: EnforcementStatus::Enforced,
        mic,
        notes,
    };
    (spawn, report)
}

fn unsupported_with_note(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
    note: String,
) -> (SandboxedSpawn, EnforcementReport) {
    let notes = vec![note];
    (
        SandboxedSpawn::Prepared {
            program: run_plan.program.clone(),
            args: run_plan.args.clone(),
            env: run_plan.env.clone(),
            cwd: run_plan.cwd.clone(),
            pre_exec_notes: notes.clone(),
            placement: SandboxCommandPlacement::GameAndHooks,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{resolve_preset, PathAccess, SandboxPreset};
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn prepare_builds_windows_helper_prefix_and_private_policy() {
        let Some(helper) = crate::windows_exec::windows_helper_path() else {
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        let caps = resolve_preset(SandboxPreset::Paranoid);
        let policy = SandboxPolicy {
            enabled: true,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![PathAccess::new(temp.path(), true, true, false)],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from(r"C:\Windows\System32\cmd.exe")],
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let plan = RunPlan::new(
            r"C:\Windows\System32\cmd.exe",
            Vec::new(),
            temp.path(),
            HashMap::new(),
        );

        let (spawn, report) = prepare(&plan, &policy);
        let SandboxedSpawn::Prepared {
            program,
            args,
            env,
            placement,
            cleanup_paths,
            ..
        } = spawn
        else {
            panic!("expected prepared spawn");
        };
        assert_eq!(program, helper);
        assert_eq!(args[0], "--windows-policy");
        assert!(PathBuf::from(&args[1]).is_file());
        assert_eq!(args[2], "--");
        assert_eq!(placement, SandboxCommandPlacement::GameAndHooks);
        assert!(env.is_empty());
        assert_eq!(cleanup_paths.len(), 1);
        assert!(PathBuf::from(&args[1]).starts_with(&cleanup_paths[0]));
        let serialized: SandboxPolicy =
            serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
        assert_eq!(serialized, policy);
        assert_eq!(report.filesystem, EnforcementStatus::Enforced);
        assert_eq!(report.network, EnforcementStatus::Enforced);
        assert_eq!(report.mic, EnforcementStatus::Enforced);
        assert_eq!(report.exec, EnforcementStatus::Enforced);
        assert!(report
            .notes
            .iter()
            .any(|note| note.contains("ancestor entry names")));
        for path in cleanup_paths {
            std::fs::remove_dir_all(path).unwrap();
        }
    }
}
