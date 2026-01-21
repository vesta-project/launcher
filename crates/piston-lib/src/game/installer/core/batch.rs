use crate::game::installer::core::downloader::download_to_path;
use crate::game::installer::try_restore_artifact;
use crate::game::installer::types::ProgressReporter;
use anyhow::{Context, Result};
use futures::stream::{self, StreamExt};
use reqwest::Client;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub struct BatchArtifact {
    pub name: String,
    pub url: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
    pub label: String,
}

pub struct BatchDownloader {
    client: Client,
    concurrency: usize,
}

impl BatchDownloader {
    pub fn new(client: Client, concurrency: usize) -> Self {
        Self {
            client,
            concurrency,
        }
    }

    pub async fn download_all(
        &self,
        artifacts: Vec<BatchArtifact>,
        reporter: Arc<dyn ProgressReporter>,
        base_progress: i32,
        progress_weight: f32,
    ) -> Result<()> {
        // Deduplicate artifacts by path to avoid concurrent writes to the same file
        let mut unique_artifacts = Vec::new();
        let mut seen_paths = std::collections::HashSet::new();
        for artifact in artifacts {
            if seen_paths.insert(artifact.path.clone()) {
                unique_artifacts.push(artifact);
            }
        }

        let total = unique_artifacts.len();
        if total == 0 {
            return Ok(());
        }

        let downloaded = Arc::new(AtomicUsize::new(0));
        reporter.set_step_count(0, Some(total as u32));

        stream::iter(unique_artifacts)
            .map(|artifact| {
                let client = self.client.clone();
                let reporter = reporter.clone();
                let downloaded = downloaded.clone();

                async move {
                    // Check for cancellation/pause before starting
                    if reporter.is_cancelled() {
                        return Err(anyhow::anyhow!("Installation cancelled by user"));
                    }

                    while reporter.is_paused() {
                        if reporter.is_cancelled() {
                            return Err(anyhow::anyhow!("Installation cancelled by user"));
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }

                    // Try to restore from cache if label is provided
                    let mut restored = false;
                    if !artifact.label.is_empty() {
                        match try_restore_artifact(&artifact.label, &artifact.path).await {
                            Ok(true) => {
                                log::debug!("Restored artifact from cache: {}", artifact.label);
                                restored = true;
                            }
                            Ok(false) => {}
                            Err(e) => {
                                log::warn!("Cache restore failed for {}: {:?}", artifact.label, e);
                            }
                        }
                    }

                    if !restored {
                        log::info!("Downloading: {} from {}", artifact.name, artifact.url);
                        reporter.set_message(&format!("Downloading {}", artifact.name));
                        download_to_path(
                            &client,
                            &artifact.url,
                            &artifact.path,
                            artifact.sha1.as_deref(),
                            &*reporter,
                        )
                        .await
                        .context(format!("Failed to download artifact: {}", artifact.name))?;
                    }

                    let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                    
                    // Update progress
                    let progress = base_progress + ((count as f32 / total as f32) * progress_weight) as i32;
                    reporter.set_percent(progress);
                    reporter.set_step_count(count as u32, Some(total as u32));
                    
                    if count % 10 == 0 || count == total {
                        log::info!("Batch download progress: {}/{} ({}%)", count, total, progress);
                    }

                    Ok(())
                }
            })
            .buffer_unordered(self.concurrency)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>>>()?;

        Ok(())
    }
}
