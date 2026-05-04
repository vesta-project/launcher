pub mod atlauncher;
pub mod curseforge;
pub mod flame_metadata;
pub mod ftb;
pub mod gdlauncher;
pub mod instance_stats;
pub mod multimc;
pub mod modrinth_app;
pub mod prism;
pub mod prism_multimc_cfg;
pub mod technic;

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

pub trait ExternalLauncherProvider: Send + Sync {
    fn kind(&self) -> LauncherKind;
    fn display_name(&self) -> &'static str;
    fn detect_paths(&self) -> Vec<PathBuf>;
    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>>;
}

