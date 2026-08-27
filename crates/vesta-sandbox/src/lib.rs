//! Portable sandbox policy and spawn preparation for Vesta Launcher.
//!
//! See ADR-0010 for the product contract. OS-specific enforcement lives behind
//! platform adapters; until they ship, Modded/Paranoid presets fail closed.

#[cfg(target_os = "linux")]
pub mod landlock_exec;
#[cfg(target_os = "windows")]
pub mod windows_exec;

mod canonicalize;
mod enforcement;
mod error;
mod platform;
mod policy;
mod prepare;
mod spawn;

pub use canonicalize::{canonicalize_allowlist, canonicalize_path_access};
pub use enforcement::{
    required_controls, validate_required_controls, ControlKind, EnforcementReport,
    EnforcementStatus,
};
pub use error::SandboxError;
pub use policy::{
    resolve_preset, PathAccess, PresetCapabilities, SandboxPolicy, SandboxPreset, WrapperNesting,
};
pub use prepare::prepare;
pub use spawn::{RunPlan, SandboxedSpawn};

/// Whether Landlock exec allowlists are available on Linux.
pub fn landlock_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        landlock_exec::landlock_available()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Whether Landlock exec enforcement is ready (kernel + helper binary).
pub fn landlock_enforcement_ready() -> bool {
    #[cfg(target_os = "linux")]
    {
        landlock_exec::landlock_enforcement_ready()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Resolved path to the Landlock helper binary on Linux.
pub fn landlock_helper_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "linux")]
    {
        landlock_exec::landlock_helper_path()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Whether bubblewrap is installed (Linux sandbox presets). Always `false` on other OSes.
pub fn bubblewrap_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        platform::linux::bubblewrap_available()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Whether unprivileged user namespaces work for bubblewrap on Linux.
pub fn user_namespace_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        platform::linux::user_namespace_available()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Whether sandbox presets can be enforced by the current host adapter.
pub fn sandbox_enforcement_ready() -> bool {
    #[cfg(target_os = "linux")]
    {
        platform::linux::sandbox_enforcement_ready()
    }
    #[cfg(target_os = "windows")]
    {
        platform::windows::sandbox_enforcement_ready()
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        false
    }
}

/// Resolved `vesta-sandbox-exec` sidecar path for the Windows AppContainer adapter.
pub fn windows_sandbox_helper_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        windows_exec::windows_helper_path()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Resolved bubblewrap executable path when available on Linux.
pub fn bubblewrap_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "linux")]
    {
        platform::linux::bubblewrap_path()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_preset_capabilities() {
        let trusted = resolve_preset(SandboxPreset::Trusted);
        assert!(!trusted.enabled);
        assert!(trusted.network_allowed);
        assert!(trusted.mic_allowed);
        assert!(trusted.usb_allowed);

        let modded = resolve_preset(SandboxPreset::Modded);
        assert!(modded.enabled);
        assert!(modded.network_allowed);
        assert!(modded.mic_allowed);
        assert!(modded.usb_allowed);

        let paranoid = resolve_preset(SandboxPreset::Paranoid);
        assert!(paranoid.enabled);
        assert!(!paranoid.network_allowed);
        assert!(!paranoid.mic_allowed);
        assert!(paranoid.usb_allowed);
    }
}
