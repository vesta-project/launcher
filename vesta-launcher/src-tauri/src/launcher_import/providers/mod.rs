pub mod atlauncher;
pub mod curseforge;
pub mod flame_metadata;
pub mod ftb;
pub mod gdlauncher;
pub mod instance_stats;
pub mod modrinth_app;
pub mod multimc;
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
    /// Provider metadata is needed for layouts whose identities live in JSON/DBs.
    /// Never walk game payloads or compute per-instance statistics to count them.
    fn instance_paths(&self, base_path: &Path) -> Result<Vec<String>> {
        Ok(self
            .list_instances(base_path)?
            .into_iter()
            .map(|row| row.instance_path)
            .collect())
    }
}

/// Artwork is optional: do not copy multi-megabyte images into candidate IPC.
fn read_small_icon(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    const LIMIT: u64 = 64 * 1024;
    let file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > LIMIT {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() <= LIMIT as usize).then_some(bytes)
}
