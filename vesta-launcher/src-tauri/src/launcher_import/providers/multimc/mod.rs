use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::launcher_import::paths::candidate_paths_for_launcher;
use crate::launcher_import::providers::flame_metadata::enrich_flame_metadata;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::providers::prism_multimc_cfg::{
    enrich_mmc_pack_metadata, list_cfg_instances, resolve_instances_root,
};
use crate::launcher_import::types::{ExternalInstanceCandidate, LauncherKind};

mod helpers;
use helpers::encode_png_as_data_url;

pub struct MultiMCProvider;

impl ExternalLauncherProvider for MultiMCProvider {
    fn kind(&self) -> LauncherKind {
        LauncherKind::MultiMC
    }

    fn display_name(&self) -> &'static str {
        "MultiMC"
    }

    fn detect_paths(&self) -> Vec<PathBuf> {
        candidate_paths_for_launcher(LauncherKind::MultiMC)
    }

    fn list_instances(&self, base_path: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
        let instances_root = resolve_instances_root(base_path);
        let mut instances = list_cfg_instances(&instances_root)?;
        for instance in &mut instances {
            enrich_flame_metadata(instance);
            enrich_mmc_pack_metadata(instance);
            if instance.icon_path.is_none() {
                let icon_path = PathBuf::from(&instance.game_directory).join("icon.png");
                instance.icon_path = encode_png_as_data_url(&icon_path);
            }
        }
        Ok(instances)
    }
}
