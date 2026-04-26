use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
use helpers::candidates_from_root;

pub struct TechnicProvider;

impl ExternalLauncherProvider for TechnicProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::Technic
    }

    fn display_name(&self) -> &'static str {
        "Technic Launcher"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::Technic)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let mut roots = vec![base_path.to_path_buf()];
        roots.push(base_path.join("technic"));

        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for root in roots {
            if !root.exists() || !root.is_dir() {
                continue;
            }
            for candidate in candidates_from_root(&root)? {
                if seen.insert(candidate.instance_path.clone()) {
                    out.push(candidate);
                }
            }
        }
        Ok(out)
    }
}
