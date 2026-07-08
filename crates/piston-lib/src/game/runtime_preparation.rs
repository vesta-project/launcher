//! Runtime readiness and repair before a game launch.
//!
//! This Module owns Minecraft/runtime preparation facts for launch: verify the
//! installed version, repair when policy allows it, and verify again. App policy
//! such as notifications, status strings, and launch windows belongs in callers.

use crate::game::installer;
use crate::game::installer::types::{
    InstallSpec, ProgressReporter, RemediationPolicy, VerificationResult,
};
use anyhow::Result;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct RuntimePreparationReport {
    pub initial_report: VerificationResult,
    pub final_report: VerificationResult,
    pub repaired: bool,
}

pub async fn prepare_runtime(
    spec: InstallSpec,
    reporter: Arc<dyn ProgressReporter>,
) -> Result<RuntimePreparationReport> {
    let initial_report = installer::verify_instance(&spec)?;

    if !should_repair(&initial_report, spec.remediation_policy) {
        return Ok(RuntimePreparationReport {
            final_report: initial_report.clone(),
            initial_report,
            repaired: false,
        });
    }

    installer::install_instance(spec.clone(), reporter).await?;
    let final_report = installer::verify_instance(&spec)?;

    Ok(RuntimePreparationReport {
        initial_report,
        final_report,
        repaired: true,
    })
}

fn should_repair(report: &VerificationResult, policy: RemediationPolicy) -> bool {
    !report.ready && policy == RemediationPolicy::RepairIfNeeded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::installer::types::{
        VerificationIssue, VerificationIssueKind, VerificationResult,
    };

    fn report(ready: bool) -> VerificationResult {
        VerificationResult {
            ready,
            checked: 1,
            issues: if ready {
                Vec::new()
            } else {
                vec![VerificationIssue {
                    kind: VerificationIssueKind::Missing,
                    artifact_class: "client-jar".to_string(),
                    path: "/missing.jar".to_string(),
                    detail: "missing".to_string(),
                }]
            },
        }
    }

    #[test]
    fn ready_runtime_does_not_repair() {
        assert!(!should_repair(&report(true), RemediationPolicy::RepairIfNeeded));
    }

    #[test]
    fn verify_only_runtime_does_not_repair() {
        assert!(!should_repair(&report(false), RemediationPolicy::VerifyOnly));
    }

    #[test]
    fn not_ready_runtime_repairs_when_policy_allows() {
        assert!(should_repair(
            &report(false),
            RemediationPolicy::RepairIfNeeded
        ));
    }
}
