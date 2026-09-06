use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementStatus {
    Enforced,
    Partial,
    Unsupported,
    NotRequired,
}

impl fmt::Display for EnforcementStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Enforced => write!(f, "enforced"),
            Self::Partial => write!(f, "partial"),
            Self::Unsupported => write!(f, "unsupported"),
            Self::NotRequired => write!(f, "not_required"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlKind {
    Filesystem,
    Network,
    Exec,
    Mic,
}

impl fmt::Display for ControlKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Filesystem => write!(f, "filesystem"),
            Self::Network => write!(f, "network"),
            Self::Exec => write!(f, "exec"),
            Self::Mic => write!(f, "mic"),
        }
    }
}

/// Per-control enforcement outcome returned from `prepare`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnforcementReport {
    pub filesystem: EnforcementStatus,
    pub network: EnforcementStatus,
    pub exec: EnforcementStatus,
    pub mic: EnforcementStatus,
    pub notes: Vec<String>,
}

impl EnforcementReport {
    pub fn not_required() -> Self {
        Self {
            filesystem: EnforcementStatus::NotRequired,
            network: EnforcementStatus::NotRequired,
            exec: EnforcementStatus::NotRequired,
            mic: EnforcementStatus::NotRequired,
            notes: Vec::new(),
        }
    }

    pub fn status_for(&self, control: ControlKind) -> EnforcementStatus {
        match control {
            ControlKind::Filesystem => self.filesystem,
            ControlKind::Network => self.network,
            ControlKind::Exec => self.exec,
            ControlKind::Mic => self.mic,
        }
    }
}

pub fn required_controls(policy: &crate::policy::SandboxPolicy) -> Vec<ControlKind> {
    if !policy.enabled {
        return Vec::new();
    }

    let mut controls = vec![ControlKind::Filesystem, ControlKind::Exec];
    if !policy.network_allowed {
        controls.push(ControlKind::Network);
    }
    if !policy.mic_allowed {
        controls.push(ControlKind::Mic);
    }
    controls
}

pub fn validate_required_controls(
    policy: &crate::policy::SandboxPolicy,
    report: &EnforcementReport,
) -> Result<(), crate::error::SandboxError> {
    for control in required_controls(policy) {
        match report.status_for(control) {
            EnforcementStatus::Enforced | EnforcementStatus::NotRequired => {}
            EnforcementStatus::Partial | EnforcementStatus::Unsupported => {
                return Err(crate::error::SandboxError::RequiredControlUnsupported { control });
            }
        }
    }
    Ok(())
}
