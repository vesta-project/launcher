use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
mod types;
use helpers::{collect_instances_from_root, resolve_scan_roots};

pub struct CurseforgeProvider;

impl ExternalLauncherProvider for CurseforgeProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::CurseforgeFlame
    }

    fn display_name(&self) -> &'static str {
        "CurseForge"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::CurseforgeFlame)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let mut instances = Vec::new();
        if !base_path.exists() {
            return Ok(instances);
        }

        for root in resolve_scan_roots(base_path) {
            if !root.exists() || !root.is_dir() {
                continue;
            }
            collect_instances_from_root(&root, base_path, &mut instances)?;
        }

        Ok(instances)
    }
}
