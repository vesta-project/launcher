use crate::enforcement::{EnforcementReport, EnforcementStatus};
use crate::policy::{SandboxPolicy, WrapperNesting};
use crate::spawn::{RunPlan, SandboxedSpawn};

/// Shared stub used by platforms without a working sandbox adapter.
#[allow(dead_code)] // Used by Linux/Windows adapters and non-desktop cfg.
pub(crate) fn prepare_stub_report(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
    platform_label: &str,
    future_adapter: &str,
) -> (SandboxedSpawn, EnforcementReport) {
    let mut notes = vec![
        format!("{platform_label} sandbox adapter is not implemented yet."),
        format!("Planned enforcement mechanism: {future_adapter}."),
        "Modded and Paranoid presets fail closed until real enforcement ships.".to_string(),
    ];

    if policy.wrapper_nesting == WrapperNesting::WrapperOutside {
        notes.push(
            "Wrapper-outside nesting is configured; enforcement would be weaker even once implemented."
                .to_string(),
        );
    }

    let spawn = SandboxedSpawn::Prepared {
        program: run_plan.program.clone(),
        args: run_plan.args.clone(),
        env: run_plan.env.clone(),
        cwd: run_plan.cwd.clone(),
        pre_exec_notes: notes.clone(),
        cleanup_paths: Vec::new(),
    };

    let report = EnforcementReport {
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
    };

    (spawn, report)
}
