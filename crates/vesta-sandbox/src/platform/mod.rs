//! OS-specific sandbox adapters.
//!
//! Each platform module turns a resolved policy into a [`SandboxedSpawn`] and
//! [`EnforcementReport`]. Adapters that are not yet implemented report
//! `Unsupported` for controls the policy requires so `prepare` can fail closed.

mod stub;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use crate::enforcement::EnforcementReport;
use crate::policy::SandboxPolicy;
use crate::spawn::{RunPlan, SandboxedSpawn};

pub(crate) fn prepare_platform(
    run_plan: &RunPlan,
    policy: &SandboxPolicy,
) -> (SandboxedSpawn, EnforcementReport) {
    #[cfg(target_os = "macos")]
    {
        macos::prepare(run_plan, policy)
    }
    #[cfg(target_os = "linux")]
    {
        linux::prepare(run_plan, policy)
    }
    #[cfg(target_os = "windows")]
    {
        windows::prepare(run_plan, policy)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        stub::prepare_stub_report(
            run_plan,
            policy,
            "unsupported host OS",
            "none (platform not supported)",
        )
    }
}
