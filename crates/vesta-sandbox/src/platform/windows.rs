//! Windows AppContainer adapter via the `vesta-sandbox-exec` sidecar.

use crate::enforcement::{EnforcementReport, EnforcementStatus};
use crate::policy::{PathAccess, SandboxPolicy, WrapperNesting};
use crate::spawn::{RunPlan, SandboxedSpawn};

pub fn sandbox_enforcement_ready() -> bool {
    // The Adapter can now give one AppContainer target a token-level no-child
    // policy, but the production target is currently the launcher-owned exit
    // handler, which must create the game JVM. Do not advertise readiness until
    // the launch graph places the restriction on the actual game process and
    // preserves the documented hook/wrapper behavior.
    false
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

    let mut windows_policy = policy.clone();
    windows_policy
        .filesystem_allowlist
        .push(PathAccess::new(sandbox_temp.clone(), true, true, false).loadable());
    let policy_path = sandbox_temp.join("windows-policy.json");
    let policy_json = match serde_json::to_vec(&windows_policy) {
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
        "The process tree is contained by a kill-on-close Job Object and descendants retain AppContainer authority.".to_string(),
        "Native-image loading is granted only for policy paths marked loadable. NTFS uses the same file right for image loading and execution, so loadable roots also have OS-level execute access.".to_string(),
        "The initial target is validated against the portable exec allowlist, then a trusted AppContainer trampoline creates it with Windows' token-level no-child policy and only standard-I/O handles. The trampoline denies all Everyone and Owner Rights access to itself before the target starts, preventing ACL replacement, process creation, and memory injection through the broker.".to_string(),
        "Denying every child is stronger than an allowlist for the game JVM but cannot represent policy-approved descendants. Production exit-handler, hook, and wrapper composition is not migrated yet, so exec remains Partial and required presets fail closed.".to_string(),
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

    let mut env = run_plan.env.clone();
    env.insert(
        "TEMP".to_string(),
        sandbox_temp.to_string_lossy().into_owned(),
    );
    env.insert(
        "TMP".to_string(),
        sandbox_temp.to_string_lossy().into_owned(),
    );

    let spawn = SandboxedSpawn::Prepared {
        program: helper,
        args: vec![
            "--windows-policy".to_string(),
            policy_path.to_string_lossy().into_owned(),
            "--".to_string(),
        ],
        env,
        cwd: run_plan.cwd.clone(),
        pre_exec_notes: notes.clone(),
        cleanup_paths: vec![sandbox_temp],
    };
    let report = EnforcementReport {
        filesystem: EnforcementStatus::Enforced,
        network,
        exec: EnforcementStatus::Partial,
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
    use crate::policy::{resolve_preset, SandboxPreset};
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
        assert_eq!(report.filesystem, EnforcementStatus::Enforced);
        assert_eq!(report.network, EnforcementStatus::Enforced);
        assert_eq!(report.mic, EnforcementStatus::Enforced);
        assert_eq!(report.exec, EnforcementStatus::Partial);
        for path in cleanup_paths {
            std::fs::remove_dir_all(path).unwrap();
        }
    }
}
