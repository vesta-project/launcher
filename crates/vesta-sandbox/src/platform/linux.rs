//! Linux sandbox adapter (stub).
//!
//! Production enforcement will likely combine Landlock and/or bubblewrap (`bwrap`).
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
        "Linux",
        "Landlock rules and/or bubblewrap (bwrap) wrapper",
    )
}
