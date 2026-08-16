//! Windows sandbox adapter (stub).
//!
//! Production enforcement will likely use AppContainer and/or Job Object limits.
//! This stub fails closed for Modded/Paranoid until that adapter exists.

use crate::platform::stub::prepare_stub_report;
use crate::policy::SandboxPolicy;
use crate::spawn::RunPlan;

pub(crate) fn prepare(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (
    crate::spawn::SandboxedSpawn,
    crate::enforcement::EnforcementReport,
) {
    prepare_stub_report(
        run_plan,
        policy,
        "Windows",
        "AppContainer / Job Object restricted token",
    )
}
