pub mod installer;
pub mod launcher;
pub mod metadata;

// Re-export commonly used types
pub use launcher::{GameInstance, LaunchResult, LaunchSpec};
pub use metadata::{
    GameVersionMetadata, LoaderVersionInfo, ModloaderType, PistonMetadata,
};

// Re-export metadata cache functions for easy access
pub use metadata::cache::{load_or_fetch_metadata, refresh_metadata};
