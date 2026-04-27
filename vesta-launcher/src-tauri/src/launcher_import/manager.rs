use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use crate::launcher_import::providers::instance_stats::enrich_candidate_stats;
use crate::launcher_import::providers::atlauncher::ATLauncherProvider;
use crate::launcher_import::providers::curseforge::CurseforgeProvider;
use crate::launcher_import::providers::ftb::FTBProvider;
use crate::launcher_import::providers::gdlauncher::GDLauncherProvider;
use crate::launcher_import::providers::multimc::MultiMCProvider;
use crate::launcher_import::providers::modrinth_app::ModrinthAppProvider;
use crate::launcher_import::providers::prism::PrismProvider;
use crate::launcher_import::providers::technic::TechnicProvider;
use crate::launcher_import::providers::ExternalLauncherProvider;
use crate::launcher_import::types::{DetectedLauncher, ExternalInstanceCandidate, LauncherKind};

#[derive(Clone)]
pub struct ImportManager {
    providers: Arc<Vec<Arc<dyn ExternalLauncherProvider>>>,
}

impl ImportManager {
    pub fn new() -> Self {
        Self {
            providers: Arc::new(vec![
                Arc::new(CurseforgeProvider),
                Arc::new(GDLauncherProvider),
                Arc::new(PrismProvider),
                Arc::new(MultiMCProvider),
                Arc::new(ModrinthAppProvider),
                Arc::new(ATLauncherProvider),
                Arc::new(FTBProvider),
                Arc::new(TechnicProvider),
            ]),
        }
    }

    pub fn detect_launchers(&self) -> Vec<DetectedLauncher> {
        log::info!("[launcher_import] detect-start providers={}", self.providers.len());
        let detected = self
            .providers
            .iter()
            .map(|provider| {
                let detected_paths = provider
                    .detect_paths()
                    .into_iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect::<Vec<_>>();

                DetectedLauncher {
                    kind: provider.kind(),
                    display_name: provider.display_name().to_string(),
                    detected_paths,
                }
            })
            .collect::<Vec<_>>();
        log::info!("[launcher_import] detect-end launchers={}", detected.len());
        detected
    }

    pub fn list_instances(
        &self,
        launcher: &LauncherKind,
        base_path_override: Option<&str>,
    ) -> Result<Vec<ExternalInstanceCandidate>> {
        let provider = self
            .providers
            .iter()
            .find(|p| &p.kind() == launcher)
            .ok_or_else(|| anyhow!("Unknown launcher provider"))?;
        log::info!(
            "[launcher_import] list-start launcher={:?} override={}",
            launcher,
            base_path_override.unwrap_or("")
        );

        let mut roots = Vec::new();
        if let Some(override_path) = base_path_override {
            roots.push(PathBuf::from(override_path));
        } else {
            roots.extend(provider.detect_paths());
        }

        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut skipped_roots = 0usize;
        let mut provider_errors = 0usize;
        for root in roots {
            if !root.exists() {
                skipped_roots += 1;
                continue;
            }
            match provider.list_instances(&root) {
                Ok(instances) => {
                    log::info!(
                        "[launcher_import] provider-list-root launcher={:?} root={} found={}",
                        launcher,
                        root.to_string_lossy(),
                        instances.len()
                    );
                    for instance in instances {
                        let mut instance = instance;
                        enrich_candidate_stats(&mut instance);
                        if seen.insert(instance.instance_path.clone()) {
                            out.push(instance);
                        }
                    }
                }
                Err(e) => {
                    provider_errors += 1;
                    log::warn!(
                        "[launcher_import] provider-list-root-failed launcher={:?} root={} error={}",
                        launcher,
                        root.to_string_lossy(),
                        e
                    );
                }
            }
        }

        log::info!(
            "[launcher_import] list-end launcher={:?} candidates={} skipped_roots={} provider_errors={}",
            launcher,
            out.len(),
            skipped_roots,
            provider_errors
        );
        Ok(out)
    }
}
