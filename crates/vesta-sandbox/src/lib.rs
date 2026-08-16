//! Portable sandbox policy and spawn preparation for Vesta Launcher.
//!
//! See ADR-0010 for the product contract. OS-specific enforcement lives behind
//! platform adapters; until they ship, Modded/Paranoid presets fail closed.

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
