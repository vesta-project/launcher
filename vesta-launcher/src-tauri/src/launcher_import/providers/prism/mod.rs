use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::flame_metadata::enrich_flame_metadata;
use crate::launcher_import::providers::prism_multimc_cfg::{
    enrich_mmc_pack_metadata, list_cfg_instances, resolve_instances_root,
};
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
use helpers::{enrich_managed_pack_from_cfg, infer_launcher_root, resolve_prism_icon};

pub struct PrismProvider;

impl ExternalLauncherProvider for PrismProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::Prism
    }

    fn display_name(&self) -> &'static str {
        "Prism Launcher"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::Prism)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let instances_root = resolve_instances_root(base_path);
        let launcher_root = infer_launcher_root(base_path, &instances_root);
        let icons_root = launcher_root.join("icons");
        let mut instances = list_cfg_instances(&instances_root)?;
        for instance in &mut instances {
            enrich_flame_metadata(instance);
            enrich_managed_pack_from_cfg(instance);
            enrich_mmc_pack_metadata(instance);
            if instance.icon_path.is_none() {
                instance.icon_path = resolve_prism_icon(instance, &icons_root);
            }
        }
        Ok(instances)
    }
}
