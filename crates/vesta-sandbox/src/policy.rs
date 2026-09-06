use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxPreset {
    Trusted,
    Modded,
    Paranoid,
}

impl fmt::Display for SandboxPreset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Trusted => write!(f, "trusted"),
            Self::Modded => write!(f, "modded"),
            Self::Paranoid => write!(f, "paranoid"),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WrapperNesting {
    #[serde(rename = "sandbox_outside")]
    #[default]
    SandboxOutside,
    #[serde(rename = "wrapper_outside")]
    WrapperOutside,
}

impl fmt::Display for WrapperNesting {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SandboxOutside => write!(f, "sandbox_outside"),
            Self::WrapperOutside => write!(f, "wrapper_outside"),
        }
    }
}

/// Filesystem access for one canonicalized allowlist entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathAccess {
    pub path: PathBuf,
    pub read: bool,
    pub write: bool,
    /// Permit mapping native code from this path into an already allowed process.
    /// This is distinct from allowing the path to be started as a child process.
    /// Adapters must report when their OS cannot enforce that distinction.
    #[serde(default)]
    pub load: bool,
    pub execute: bool,
    #[serde(default = "default_recursive")]
    pub recursive: bool,
}

const fn default_recursive() -> bool {
    true
}

impl PathAccess {
    pub fn new(path: impl Into<PathBuf>, read: bool, write: bool, execute: bool) -> Self {
        Self {
            path: path.into(),
            read,
            write,
            load: false,
            execute,
            recursive: true,
        }
    }

    pub fn file(path: impl Into<PathBuf>, read: bool, write: bool, execute: bool) -> Self {
        Self {
            path: path.into(),
            read,
            write,
            load: false,
            execute,
            recursive: false,
        }
    }

    pub fn loadable(mut self) -> Self {
        // Mapping a native image necessarily reads it.
        self.read = true;
        self.load = true;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loadable_implies_read_but_not_portable_process_execute() {
        let access = PathAccess::new("native-library", false, false, false).loadable();

        assert!(access.read);
        assert!(access.load);
        assert!(!access.write);
        assert!(!access.execute);
    }

    #[test]
    fn path_access_without_load_field_remains_deserializable() {
        let access: PathAccess =
            serde_json::from_str(r#"{"path":"shared","read":true,"write":false,"execute":false}"#)
                .unwrap();

        assert!(!access.load);
        assert!(access.recursive);
    }
}

/// Base capability flags implied by a preset before path/exec resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresetCapabilities {
    pub enabled: bool,
    pub network_allowed: bool,
    pub mic_allowed: bool,
    pub usb_allowed: bool,
}

/// Resolved sandbox policy consumed by `prepare`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxPolicy {
    pub enabled: bool,
    pub preset: SandboxPreset,
    pub filesystem_allowlist: Vec<PathAccess>,
    pub network_allowed: bool,
    pub mic_allowed: bool,
    pub usb_allowed: bool,
    pub exec_allowlist: Vec<PathBuf>,
    pub wrapper_nesting: WrapperNesting,
    pub extra_paths: Vec<PathAccess>,
}

impl SandboxPolicy {
    pub fn trusted() -> Self {
        let caps = resolve_preset(SandboxPreset::Trusted);
        Self {
            enabled: caps.enabled,
            preset: SandboxPreset::Trusted,
            filesystem_allowlist: Vec::new(),
            network_allowed: caps.network_allowed,
            mic_allowed: caps.mic_allowed,
            usb_allowed: caps.usb_allowed,
            exec_allowlist: Vec::new(),
            wrapper_nesting: WrapperNesting::default(),
            extra_paths: Vec::new(),
        }
    }
}

pub fn resolve_preset(preset: SandboxPreset) -> PresetCapabilities {
    match preset {
        SandboxPreset::Trusted => PresetCapabilities {
            enabled: false,
            network_allowed: true,
            mic_allowed: true,
            usb_allowed: true,
        },
        SandboxPreset::Modded => PresetCapabilities {
            enabled: true,
            network_allowed: true,
            mic_allowed: true,
            usb_allowed: true,
        },
        SandboxPreset::Paranoid => PresetCapabilities {
            enabled: true,
            network_allowed: false,
            mic_allowed: false,
            usb_allowed: true,
        },
    }
}
