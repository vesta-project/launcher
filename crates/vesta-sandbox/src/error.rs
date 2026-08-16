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

    #[error("sandbox preset {preset} cannot be enforced on this platform")]
    PresetUnsupported { preset: crate::policy::SandboxPreset },
}
