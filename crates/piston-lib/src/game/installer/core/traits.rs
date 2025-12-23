use crate::game::installer::types::{InstallSpec, ProgressReporter};
use anyhow::Result;
use futures::future::BoxFuture;
use std::sync::Arc;

/// Trait for modloader installers.
/// Allows for a modular architecture where each modloader (Fabric, Forge, etc.)
/// implements its own installation logic.
pub trait ModloaderInstaller: Send + Sync {
    /// Install the modloader based on the provided specification.
    fn install<'a>(
        &'a self,
        spec: &'a InstallSpec,
        reporter: Arc<dyn ProgressReporter>,
    ) -> BoxFuture<'a, Result<()>>;
}
