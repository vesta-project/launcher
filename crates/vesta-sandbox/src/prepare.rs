use crate::enforcement::{validate_required_controls, EnforcementReport};
use crate::error::SandboxError;
use crate::platform;
use crate::policy::SandboxPolicy;
use crate::spawn::{RunPlan, SandboxedSpawn};

/// Resolve a portable run plan and policy into a sandboxed spawn plan and
/// enforcement report.
///
/// Trusted presets passthrough unchanged with all controls marked
/// `NotRequired`. Modded/Paranoid require working OS adapters; platforms
/// without one fail closed when a required control is `Unsupported`.
pub fn prepare(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> Result<(SandboxedSpawn, EnforcementReport), SandboxError> {
    if !policy.enabled {
        return Ok((
            SandboxedSpawn::Passthrough,
            EnforcementReport::not_required(),
        ));
    }

    let (spawn, report) = platform::prepare_platform(run_plan, policy);
    validate_required_controls(policy, &report)?;
    Ok((spawn, report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{resolve_preset, SandboxPreset};
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn sample_run_plan() -> RunPlan {
        RunPlan::new(
            "/usr/bin/java",
            vec!["-jar".into(), "game.jar".into()],
            std::env::temp_dir(),
            HashMap::new(),
        )
    }

    #[test]
    fn trusted_prepare_passthrough() {
        let caps = resolve_preset(SandboxPreset::Trusted);
        let policy = SandboxPolicy {
            enabled: caps.enabled,
            preset: SandboxPreset::Trusted,
            filesystem_allowlist: Vec::new(),
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: Vec::new(),
            wrapper_nesting: Default::default(),
            extra_paths: Vec::new(),
        };

        let (spawn, report) = prepare(&sample_run_plan(), &policy).unwrap();

        assert_eq!(spawn, SandboxedSpawn::Passthrough);
        assert_eq!(report, EnforcementReport::not_required());
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn modded_prepare_fails_closed_on_stub_platforms() {
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: caps.enabled,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![crate::policy::PathAccess::new(
                PathBuf::from("/data"),
                true,
                true,
                false,
            )],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/java")],
            wrapper_nesting: Default::default(),
            extra_paths: Vec::new(),
        };

        let err = prepare(&sample_run_plan(), &policy).unwrap_err();
        assert!(matches!(
            err,
            SandboxError::RequiredControlUnsupported { .. }
        ));
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn paranoid_prepare_fails_closed_on_stub_platforms() {
        let caps = resolve_preset(SandboxPreset::Paranoid);
        let policy = SandboxPolicy {
            enabled: caps.enabled,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![crate::policy::PathAccess::new(
                PathBuf::from("/data"),
                true,
                true,
                false,
            )],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/java")],
            wrapper_nesting: Default::default(),
            extra_paths: Vec::new(),
        };

        let err = prepare(&sample_run_plan(), &policy).unwrap_err();
        assert!(matches!(
            err,
            SandboxError::RequiredControlUnsupported { .. }
        ));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn modded_prepare_succeeds_with_seatbelt_adapter() {
        let caps = resolve_preset(SandboxPreset::Modded);
        let policy = SandboxPolicy {
            enabled: caps.enabled,
            preset: SandboxPreset::Modded,
            filesystem_allowlist: vec![crate::policy::PathAccess::new(
                std::env::temp_dir(),
                true,
                true,
                false,
            )],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/usr/bin/java")],
            wrapper_nesting: Default::default(),
            extra_paths: Vec::new(),
        };

        let (spawn, report) = prepare(&sample_run_plan(), &policy).expect("macOS prepare");
        let SandboxedSpawn::Prepared { cleanup_paths, .. } = spawn else {
            panic!("expected prepared sandbox spawn");
        };
        for path in cleanup_paths {
            std::fs::remove_dir_all(path).unwrap();
        }
        assert_eq!(
            report.filesystem,
            crate::enforcement::EnforcementStatus::Enforced
        );
        assert_eq!(report.exec, crate::enforcement::EnforcementStatus::Enforced);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn paranoid_prepare_enforces_mic_denial() {
        let caps = resolve_preset(SandboxPreset::Paranoid);
        let policy = SandboxPolicy {
            enabled: caps.enabled,
            preset: SandboxPreset::Paranoid,
            filesystem_allowlist: vec![crate::policy::PathAccess::new(
                std::env::temp_dir(),
                true,
                true,
                false,
            )],
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: vec![PathBuf::from("/usr/bin/java")],
            wrapper_nesting: Default::default(),
            extra_paths: Vec::new(),
        };

        let (spawn, report) = prepare(&sample_run_plan(), &policy).expect("macOS prepare");
        let SandboxedSpawn::Prepared { cleanup_paths, .. } = spawn else {
            panic!("expected prepared sandbox spawn");
        };
        for path in cleanup_paths {
            std::fs::remove_dir_all(path).unwrap();
        }
        assert_eq!(report.mic, crate::enforcement::EnforcementStatus::Enforced);
        assert_eq!(
            report.network,
            crate::enforcement::EnforcementStatus::Enforced
        );
    }
}
