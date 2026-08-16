//! macOS Seatbelt adapter via `sandbox-exec`.
//!
//! Uses `(allow default)` plus targeted denials. A hard `(deny default)` profile
//! aborts the JVM immediately (SIGABRT) because Java needs broad system reads,
//! JIT (`dynamic-code-generation`), and mach/IOKit access that are impractical to
//! allowlist exhaustively. Write confinement, optional network/mic denial, and
//! process-exec allowlisting still provide the Modded/Paranoid product controls.

use crate::enforcement::{EnforcementReport, EnforcementStatus};
use crate::policy::{SandboxPolicy, SandboxPreset, WrapperNesting};
use crate::spawn::{RunPlan, SandboxedSpawn};
use std::path::{Path, PathBuf};

pub(crate) fn prepare(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (SandboxedSpawn, EnforcementReport) {
    let profile = build_seatbelt_profile(policy);
    let profile_path = match write_profile_temp(&profile) {
        Ok(path) => path,
        Err(err) => {
            return unsupported_with_note(
                run_plan,
                policy,
                format!("Failed to write Seatbelt profile: {err}"),
            );
        }
    };

    let sandbox_exec = PathBuf::from("/usr/bin/sandbox-exec");
    if !sandbox_exec.is_file() {
        return unsupported_with_note(
            run_plan,
            policy,
            "sandbox-exec not found at /usr/bin/sandbox-exec".to_string(),
        );
    }

    let args = vec![
        "-f".to_string(),
        profile_path.to_string_lossy().to_string(),
    ];
    let mut notes = vec![
        format!(
            "macOS Seatbelt profile written to {} (sandbox-exec).",
            profile_path.display()
        ),
        "Profile uses allow-default with denied writes outside the allowlist (JVM-compatible)."
            .to_string(),
        "Exec confined via process-exec allowlist.".to_string(),
    ];

    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push(
            "Wrapper-outside nesting selected: caller must place sandbox-exec inside the user wrapper."
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

    let spawn = SandboxedSpawn::Prepared {
        program: sandbox_exec,
        args,
        env: run_plan.env.clone(),
        cwd: run_plan.cwd.clone(),
        pre_exec_notes: notes.clone(),
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

fn write_profile_temp(profile: &str) -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join("vesta-sandbox");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("seatbelt-{}.sb", std::process::id()));
    std::fs::write(&path, profile)?;
    Ok(path)
}

fn build_seatbelt_profile(policy: &SandboxPolicy) -> String {
    let mut lines = vec![
        "(version 1)".to_string(),
        "(allow default)".to_string(),
        // Write confinement: deny all writes, then re-allow roots + temp.
        "(deny file-write*)".to_string(),
        "(allow file-write* (literal \"/dev/null\"))".to_string(),
        "(allow file-write* (subpath \"/private/var/folders\"))".to_string(),
        "(allow file-write* (subpath \"/tmp\"))".to_string(),
        "(allow file-write* (subpath \"/private/tmp\"))".to_string(),
    ];

    for entry in policy
        .filesystem_allowlist
        .iter()
        .chain(policy.extra_paths.iter())
    {
        if entry.write {
            let literal = escape_sbpl(&entry.path);
            lines.push(format!("(allow file-write* (subpath \"{literal}\"))"));
        }
    }

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

    // Exec confinement: deny then allow JRE / helpers.
    lines.push("(deny process-exec*)".to_string());
    lines.push("(allow process-fork)".to_string());
    lines.push("(allow process-exec (literal \"/usr/bin/sandbox-exec\"))".to_string());
    lines.push("(allow process-exec (literal \"/bin/sh\"))".to_string());
    lines.push("(allow process-exec (literal \"/bin/bash\"))".to_string());
    lines.push("(allow process-exec (subpath \"/usr/libexec\"))".to_string());

    // Modded: allow macOS `open` so in-game "Open folder" (resource packs, etc.)
    // works. Treated as a normal play helper, not a weakened control.
    if policy.preset == SandboxPreset::Modded {
        lines.push("(allow process-exec (literal \"/usr/bin/open\"))".to_string());
    }

    for exec in &policy.exec_allowlist {
        push_exec_rules(&mut lines, exec);
    }

    lines.join("\n") + "\n"
}

fn push_exec_rules(lines: &mut Vec<String>, path: &Path) {
    let literal = escape_sbpl(path);
    if path.is_dir() {
        lines.push(format!("(allow process-exec (subpath \"{literal}\"))"));
    } else {
        lines.push(format!("(allow process-exec (literal \"{literal}\"))"));
        if let Some(parent) = path.parent() {
            let parent_lit = escape_sbpl(parent);
            lines.push(format!("(allow process-exec (subpath \"{parent_lit}\"))"));
        }
    }
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
        let profile = build_seatbelt_profile(&policy);
        assert!(profile.contains("(allow default)"));
        assert!(profile.contains("(deny file-write*)"));
        assert!(profile.contains("(allow file-write* (subpath \"/tmp/game\"))"));
        assert!(profile.contains("(deny network*)"));
        assert!(profile.contains("(deny device-microphone)"));
        assert!(profile.contains("(deny process-exec*)"));
        assert!(!profile.contains("(allow process-exec (literal \"/usr/bin/open\"))"));
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
        let profile = build_seatbelt_profile(&policy);
        assert!(profile.contains("(allow device-microphone)"));
        assert!(!profile.contains("(deny device-microphone)"));
        assert!(!profile.contains("(deny network*)"));
        assert!(profile.contains("(allow process-exec (literal \"/usr/bin/open\"))"));
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
            SandboxedSpawn::Prepared { program, args, .. } => {
                assert_eq!(program, PathBuf::from("/usr/bin/sandbox-exec"));
                assert_eq!(args[0], "-f");
            }
            SandboxedSpawn::Passthrough => panic!("expected Prepared"),
        }
        assert_eq!(report.filesystem, EnforcementStatus::Enforced);
        assert_eq!(report.exec, EnforcementStatus::Enforced);
        assert_eq!(report.network, EnforcementStatus::NotRequired);
    }
}
