use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use crate::launcher_import::providers::atlauncher::ATLauncherProvider;
use crate::launcher_import::providers::curseforge::CurseforgeProvider;
use crate::launcher_import::providers::ftb::FTBProvider;
use crate::launcher_import::providers::gdlauncher::GDLauncherProvider;
use crate::launcher_import::providers::modrinth_app::ModrinthAppProvider;
use crate::launcher_import::providers::multimc::MultiMCProvider;
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

    pub async fn detect_launchers(&self) -> Result<Vec<DetectedLauncher>, String> {
        use futures::{stream, FutureExt, StreamExt};
        let providers = self.providers.as_ref().clone();
        let jobs: Vec<_> = providers
            .into_iter()
            .enumerate()
            .map(|(index, provider)| {
                async move {
                    let source = provider.clone();
                    let paths =
                        super::scan::blocking(std::time::Duration::from_secs(2), move || {
                            Ok(source.detect_paths())
                        })
                        .await?;
                    let count_paths = paths.clone();
                    let instance_count = if paths.is_empty() {
                        Some(0)
                    } else {
                        super::scan::blocking(std::time::Duration::from_secs(2), move || {
                            let mut identities = HashSet::new();
                            for root in count_paths {
                                identities.extend(
                                    provider
                                        .instance_paths(&root)
                                        .map_err(|error| error.to_string())?,
                                );
                            }
                            Ok(identities.len())
                        })
                        .await
                        .ok()
                    };
                    Ok::<_, String>((index, paths, instance_count))
                }
                .boxed()
            })
            .collect();
        let mut rows = stream::iter(jobs)
            .buffer_unordered(2)
            .collect::<Vec<_>>()
            .await;
        if rows.iter().all(Result::is_err) {
            return Err("Unable to detect external launchers; try again".into());
        }
        rows.sort_by_key(|row| row.as_ref().map(|row| row.0).unwrap_or(usize::MAX));
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let (index, paths, instance_count) = match row {
                    Ok(row) => row,
                    Err(error) => {
                        log::warn!("Launcher discovery failed: {}", error);
                        return None;
                    }
                };
                let provider = &self.providers[index];
                Some(DetectedLauncher {
                    kind: provider.kind(),
                    display_name: provider.display_name().into(),
                    detected_paths: paths
                        .into_iter()
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect(),
                    instance_count,
                })
            })
            .collect())
    }

    pub fn instance_details(
        &self,
        launcher: &LauncherKind,
        instance_path: &str,
        base_path_override: Option<&str>,
    ) -> Result<ExternalInstanceCandidate> {
        let mut candidate = self
            .list_instances(launcher, base_path_override)?
            .into_iter()
            .find(|candidate| candidate.instance_path == instance_path)
            .ok_or_else(|| anyhow!("The selected launcher instance is no longer available"))?;
        crate::launcher_import::providers::instance_stats::enrich_candidate_stats(&mut candidate);
        Ok(candidate)
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
        if provider_errors > 0 {
            return Err(anyhow!(
                "Unable to read {} launcher root(s); check access and try again",
                provider_errors
            ));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    struct Provider(ExternalInstanceCandidate);
    impl ExternalLauncherProvider for Provider {
        fn kind(&self) -> LauncherKind {
            LauncherKind::Prism
        }
        fn display_name(&self) -> &'static str {
            "Test"
        }
        fn detect_paths(&self) -> Vec<PathBuf> {
            Vec::new()
        }
        fn list_instances(&self, _: &Path) -> Result<Vec<ExternalInstanceCandidate>> {
            Ok(vec![self.0.clone()])
        }
    }
    #[test]
    fn statistics_are_only_loaded_for_an_existing_selected_candidate() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("mods")).unwrap();
        std::fs::write(root.path().join("mods/one.jar"), "mod").unwrap();
        let path = root.path().to_str().unwrap();
        let manager = ImportManager {
            providers: Arc::new(vec![Arc::new(Provider(ExternalInstanceCandidate {
                instance_path: path.into(),
                game_directory: path.into(),
                ..Default::default()
            }))]),
        };
        let listed = manager
            .list_instances(&LauncherKind::Prism, Some(path))
            .unwrap();
        assert_eq!(listed[0].mods_count, None);
        assert_eq!(listed[0].game_directory_size_bytes, None);
        let selected = manager
            .instance_details(&LauncherKind::Prism, path, Some(path))
            .unwrap();
        assert_eq!(selected.mods_count, Some(1));
        assert!(manager
            .instance_details(&LauncherKind::Prism, "/unlisted", Some(path))
            .is_err());
    }
}
