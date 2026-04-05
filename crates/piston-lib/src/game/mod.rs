pub mod installer;
pub mod java_policy;
pub mod launcher;
pub mod metadata;
pub mod modpack;

// Re-export commonly used types
pub use launcher::{GameInstance, LaunchResult, LaunchSpec};
pub use metadata::{
    GameVersionMetadata, LoaderVersionInfo, ModloaderType, PistonMetadata,
};

// Re-export metadata cache functions for easy access
pub use metadata::cache::{load_or_fetch_metadata, refresh_metadata};
