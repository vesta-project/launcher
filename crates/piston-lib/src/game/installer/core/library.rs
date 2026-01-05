use super::downloader::download_to_path;
use crate::game::installer::types::ProgressReporter;
use crate::game::installer::{track_artifact_from_path, try_restore_artifact};
use anyhow::Result;
use futures::stream::{self, StreamExt};
use reqwest::Client;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

/// A library to download with its metadata
#[derive(Clone)]
pub struct LibrarySpec {
    pub name: String,
    pub maven_url: Option<String>,
    pub explicit_url: Option<String>,
    pub sha1: Option<String>,
}

pub struct LibraryDownloader<'a> {
    client: &'a Client,
    libraries_dir: &'a Path,
    reporter: std::sync::Arc<dyn ProgressReporter>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_explicit_url_relative() {
        let resolved = LibraryDownloader::resolve_explicit_url(
            Some("lib/com/example.jar"),
            Some("https://repo.example.org/"),
            "https://libraries.minecraft.net/artifact.jar",
        );
        assert_eq!(resolved, "https://repo.example.org/lib/com/example.jar");
    }

    #[test]
    fn test_resolve_explicit_url_absolute() {
        let resolved = LibraryDownloader::resolve_explicit_url(
            Some("https://cdn.example.org/lib.jar"),
            None,
            "https://libraries.minecraft.net/artifact.jar",
        );
        assert_eq!(resolved, "https://cdn.example.org/lib.jar");
    }
}
impl<'a> LibraryDownloader<'a> {
    pub fn new(
        client: &'a Client,
        libraries_dir: &'a Path,
        reporter: std::sync::Arc<dyn ProgressReporter>,
    ) -> Self {
        Self {
            client,
            libraries_dir,
            reporter,
        }
    }

    /// Download a library from a Maven repository
    pub async fn download_library(
        &self,
        name: &str,
        maven_url: Option<&str>,
        explicit_url: Option<&str>,
        sha1: Option<&str>,
    ) -> Result<()> {
        let (path, resolved_url) = self.resolve_library(name, maven_url)?;
        let full_path = self.libraries_dir.join(&path);
        let label = format!("libraries/{}", path);

        if full_path.exists() {
            // If we have a SHA1 for this file, verify it — if it matches we don't re-download.
            // If it doesn't match, remove the file and re-download.
            if let Some(expected) = sha1 {
                use sha1::{Digest, Sha1};
                use tokio::fs;
                let bytes = fs::read(&full_path).await?;
                let mut hasher = Sha1::new();
                hasher.update(&bytes);
                let computed = format!("{:x}", hasher.finalize());
                if computed.to_lowercase() == expected.to_lowercase() {
                    track_artifact_from_path(label.clone(), &full_path, None, None).await?;
                    return Ok(());
                }
                // Remove mismatched file and continue to download
                log::warn!(
                    "Existing library '{}' had mismatched sha1 ({} != {}). Re-downloading...",
                    full_path.display(),
                    computed,
                    expected
                );
                let _ = fs::remove_file(&full_path).await;
            } else {
                // No SHA1 provided — keep current behavior: skip download when file exists.
                track_artifact_from_path(label.clone(), &full_path, None, None).await?;
                return Ok(());
            }
        }

        if try_restore_artifact(&label, &full_path).await? {
            return Ok(());
        }

        let url = Self::resolve_explicit_url(explicit_url, maven_url, &resolved_url);
        download_to_path(self.client, &url, &full_path, sha1, self.reporter.as_ref()).await?;
        track_artifact_from_path(label, &full_path, None, Some(url)).await?;
        Ok(())
    }

    /// Download multiple libraries concurrently
    /// Returns the number of libraries successfully downloaded
    pub async fn download_libraries_concurrent(
        &self,
        libraries: Vec<LibrarySpec>,
        concurrency: usize,
        progress_base: i32,
        progress_range: i32,
    ) -> Result<usize> {
        // Deduplicate libraries by name to avoid concurrent writes to the same file
        let mut unique_libraries = Vec::new();
        let mut seen_libs = std::collections::HashSet::new();
        for lib in libraries {
            if seen_libs.insert(lib.name.clone()) {
                unique_libraries.push(lib);
            }
        }

        let total = unique_libraries.len();
        if total == 0 {
            return Ok(0);
        }

        let downloaded = Arc::new(AtomicUsize::new(0));
        let last_update = Arc::new(Mutex::new(
            std::time::Instant::now() - std::time::Duration::from_secs(1),
        ));

        self.reporter.set_step_count(0, Some(total as u32));

        let results: Vec<Result<()>> = stream::iter(unique_libraries)
            .map(|lib| {
                let downloaded = Arc::clone(&downloaded);
                let last_update = Arc::clone(&last_update);
                let reporter = self.reporter.clone();
                let client = self.client;
                let libraries_dir = self.libraries_dir.to_path_buf();

                async move {
                    if reporter.is_cancelled() {
                        return Err(anyhow::anyhow!("Installation cancelled by user"));
                    }

                    // Resolve library path and URL
                    let (path, resolved_url) =
                        Self::resolve_library_static(&lib.name, lib.maven_url.as_deref())?;
                    let full_path = libraries_dir.join(&path);
                    let label = format!("libraries/{}", path);

                    // Check if exists and valid
                    if full_path.exists() {
                        if let Some(ref expected) = lib.sha1 {
                            use sha1::{Digest, Sha1};
                            let bytes = tokio::fs::read(&full_path).await?;
                            let mut hasher = Sha1::new();
                            hasher.update(&bytes);
                            let computed = format!("{:x}", hasher.finalize());
                            if computed.to_lowercase() == expected.to_lowercase() {
                                track_artifact_from_path(label.clone(), &full_path, None, None)
                                    .await?;
                                // Update progress for cached library
                                let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                                let progress = progress_base
                                    + ((count as f32 / total as f32) * progress_range as f32)
                                        as i32;
                                let mut last = last_update.lock().await;
                                if (count % 4 == 0)
                                    || last.elapsed() > std::time::Duration::from_millis(250)
                                {
                                    reporter.set_percent(progress);
                                    reporter.set_step_count(count as u32, Some(total as u32));
                                    *last = std::time::Instant::now();
                                }
                                return Ok(());
                            }
                            log::warn!("Library sha1 mismatch for {}, re-downloading...", lib.name);
                            let _ = tokio::fs::remove_file(&full_path).await;
                        } else {
                            track_artifact_from_path(label.clone(), &full_path, None, None).await?;
                            let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                            let progress = progress_base
                                + ((count as f32 / total as f32) * progress_range as f32) as i32;
                            let mut last = last_update.lock().await;
                            if (count % 4 == 0)
                                || last.elapsed() > std::time::Duration::from_millis(250)
                            {
                                reporter.set_percent(progress);
                                reporter.set_step_count(count as u32, Some(total as u32));
                                *last = std::time::Instant::now();
                            }
                            return Ok(());
                        }
                    }

                    // Try restore from cache
                    if try_restore_artifact(&label, &full_path).await? {
                        let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                        let progress = progress_base
                            + ((count as f32 / total as f32) * progress_range as f32) as i32;
                        let mut last = last_update.lock().await;
                        if (count % 4 == 0)
                            || last.elapsed() > std::time::Duration::from_millis(250)
                        {
                            reporter.set_percent(progress);
                            reporter.set_step_count(count as u32, Some(total as u32));
                            *last = std::time::Instant::now();
                        }
                        return Ok(());
                    }

                    // Download
                    let url = Self::resolve_explicit_url(
                        lib.explicit_url.as_deref(),
                        lib.maven_url.as_deref(),
                        &resolved_url,
                    );

                    // Create a no-op reporter for individual downloads to avoid progress spam
                    struct NoopReporter {
                        dry_run: bool,
                    }
                    impl ProgressReporter for NoopReporter {
                        fn start_step(&self, _: &str, _: Option<u32>) {}
                        fn update_bytes(&self, _: u64, _: Option<u64>) {}
                        fn set_percent(&self, _: i32) {}
                        fn set_message(&self, _: &str) {}
                        fn set_step_count(&self, _: u32, _: Option<u32>) {}
                        fn set_substep(&self, _: Option<&str>, _: Option<u32>, _: Option<u32>) {}
                        fn set_actions(
                            &self,
                            _: Option<Vec<crate::game::installer::types::NotificationActionSpec>>,
                        ) {
                        }
                        fn done(&self, _: bool, _: Option<&str>) {}
                        fn is_cancelled(&self) -> bool {
                            false
                        }
                        fn is_paused(&self) -> bool {
                            false
                        }
                        fn is_dry_run(&self) -> bool {
                            self.dry_run
                        }
                    }

                    download_to_path(
                        client,
                        &url,
                        &full_path,
                        lib.sha1.as_deref(),
                        &NoopReporter {
                            dry_run: reporter.is_dry_run(),
                        },
                    )
                    .await?;
                    track_artifact_from_path(label, &full_path, None, Some(url)).await?;

                    // Update progress
                    let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                    let progress = progress_base
                        + ((count as f32 / total as f32) * progress_range as f32) as i32;

                    let mut last = last_update.lock().await;
                    if (count % 4 == 0) || last.elapsed() > std::time::Duration::from_millis(250) {
                        reporter.set_percent(progress);
                        reporter.set_step_count(count as u32, Some(total as u32));
                        log::debug!("Libraries: {}/{} -> {}%", count, total, progress);
                        *last = std::time::Instant::now();
                    }

                    Ok(())
                }
            })
            .buffer_unordered(concurrency)
            .collect()
            .await;

        // Collect errors
        let mut errors = Vec::new();
        for result in results {
            if let Err(e) = result {
                errors.push(e);
            }
        }

        if !errors.is_empty() {
            // Return first error, log others
            for (i, e) in errors.iter().enumerate().skip(1) {
                log::error!("Additional library download error {}: {}", i + 1, e);
            }
            return Err(errors.into_iter().next().unwrap());
        }

        Ok(downloaded.load(Ordering::SeqCst))
    }

    /// Static version of resolve_library for use in async closures
    pub fn resolve_library_static(name: &str, maven_url: Option<&str>) -> Result<(String, String)> {
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() < 3 {
            return Err(anyhow::anyhow!("Invalid library name: {}", name));
        }

        let domain = parts[0].replace('.', "/");
        let lib_name = parts[1];
        let mut version = parts[2];
        let mut extension = "jar".to_string();
        let mut classifier = "".to_string();

        // Handle version@extension if no classifier is present
        if parts.len() == 3 {
            if let Some((v, ext)) = version.split_once('@') {
                version = v;
                extension = ext.to_string();
            }
        } else if parts.len() >= 4 {
            // Handle classifier and extension (e.g., "mappings@tsrg.lzma")
            let classifier_ext = parts[3];
            if let Some((clf, ext)) = classifier_ext.split_once('@') {
                classifier = format!("-{}", clf);
                extension = ext.to_string();
            } else {
                classifier = format!("-{}", classifier_ext);
            }
        }

        let rel_path = format!(
            "{}/{}/{}/{}-{}{}.{}",
            domain, lib_name, version, lib_name, version, classifier, extension
        );

        let base_url = maven_url.unwrap_or("https://libraries.minecraft.net/");
        let url = if base_url.ends_with('/') {
            format!("{}{}", base_url, rel_path)
        } else {
            format!("{}/{}", base_url, rel_path)
        };

        Ok((rel_path, url))
    }

    /// Resolve Maven coordinates to path and URL
    pub fn resolve_library(&self, name: &str, maven_url: Option<&str>) -> Result<(String, String)> {
        Self::resolve_library_static(name, maven_url)
    }

    /// Build final URL for an explicit URL or fall back to resolved URL.
    pub(crate) fn resolve_explicit_url(
        explicit_url: Option<&str>,
        maven_base: Option<&str>,
        resolved_url: &str,
    ) -> String {
        if let Some(explicit) = explicit_url {
            if explicit.starts_with("http://") || explicit.starts_with("https://") {
                explicit.to_string()
            } else {
                let base = maven_base.unwrap_or("https://libraries.minecraft.net/");
                if base.ends_with('/') {
                    format!("{}{}", base, explicit)
                } else {
                    format!("{}/{}", base, explicit)
                }
            }
        } else {
            resolved_url.to_string()
        }
    }
}
