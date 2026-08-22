use crate::enforcement::ControlKind;

#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("path does not exist and has no existing ancestor: {path}")]
    PathNotFound { path: String },

    #[error("failed to canonicalize {path}: {source}")]
    Canonicalize {
        path: String,
        source: std::io::Error,
    },

    #[error(
        "path {path} escapes declared root {root} after canonicalization (possible symlink escape)"
    )]
    SymlinkEscape { path: String, root: String },

    #[error("required sandbox control is unsupported on this platform: {control}")]
    RequiredControlUnsupported { control: ControlKind },

    #[error(
        "bubblewrap (bwrap) is not installed; install the bubblewrap package to use Modded or Paranoid sandbox presets on Linux"
    )]
    BubblewrapNotFound,

    #[error(
        "unprivileged user namespaces are unavailable; bubblewrap cannot enforce Modded or Paranoid sandbox presets on this Linux host (check kernel.unprivileged_userns_clone and distribution bubblewrap restrictions)"
    )]
    UserNamespaceUnavailable,

    #[error(
        "Landlock exec allowlists are unavailable on this Linux host; update the kernel or rebuild Vesta Launcher with the vesta-sandbox-exec helper"
    )]
    LandlockUnavailable,

    #[error(
        "the vesta-sandbox-exec helper was not found; reinstall or rebuild Vesta Launcher to enforce Modded or Paranoid exec allowlists on Linux"
    )]
    LandlockHelperNotFound,

    #[error("sandbox preset {preset} cannot be enforced on this platform")]
    PresetUnsupported {
        preset: crate::policy::SandboxPreset,
    },
}
