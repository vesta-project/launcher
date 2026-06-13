//! Shared pipeline for downloading libraries and extracting natives.
//! Used by both vanilla and modloader installations.

use crate::game::installer::core::downloader::download_to_path;
use crate::game::installer::core::library::LibraryDownloader;
use crate::game::installer::types::{InstallSpec, OsType, ProgressReporter};
use crate::game::launcher::unified_manifest::UnifiedManifest;
use crate::game::launcher::version_parser::VersionManifest;
use anyhow::{Context, Result};
use futures::stream::{self, StreamExt};
use reqwest::Client;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Process a vanilla + optional loader manifest into a UnifiedManifest,
/// download all libraries, extract all natives, and return the result.
pub async fn process_and_download_libraries(
    spec: &InstallSpec,
    vanilla: VersionManifest,
    loader: Option<VersionManifest>,
    client: Client,
    reporter: Arc<dyn ProgressReporter>,
) -> Result<UnifiedManifest> {
    let os = OsType::current();

    // 1. Merge manifests into a UnifiedManifest
    let unified = UnifiedManifest::merge(vanilla, loader, os);

    let total_libs = unified.libraries.len();
    let native_libs: Vec<_> = unified.libraries.iter().filter(|l| l.is_native).collect();
    let regular_libs: Vec<_> = unified.libraries.iter().filter(|l| !l.is_native).collect();

    log::info!(
        "Processing {} libraries ({} regular, {} natives)",
        total_libs,
        regular_libs.len(),
        native_libs.len()
    );

    // 2. Download regular (non-native) libraries concurrently
    if !regular_libs.is_empty() {
        let lib_dir = spec.libraries_dir();
        let lib_downloader = LibraryDownloader::new(&client, &lib_dir, reporter.clone());
        let library_specs: Vec<crate::game::installer::core::library::LibrarySpec> = regular_libs
            .iter()
            .map(|lib| crate::game::installer::core::library::LibrarySpec {
                name: lib.name.clone(),
                maven_url: lib.download_url.clone(),
                explicit_url: lib.download_url.clone(),
                sha1: lib.sha1.clone(),
            })
            .collect();

        lib_downloader
            .download_libraries_concurrent(library_specs, spec.concurrency, 40, 40)
            .await?;
    }

    // 3. Download and extract native libraries
    if !native_libs.is_empty() {
        let natives_dir = spec.natives_dir();
        tokio::fs::create_dir_all(&natives_dir).await?;

        let total_natives = native_libs.len();
        log::info!(
            "Processing {} native libraries — will download and extract to {:?}",
            total_natives,
            natives_dir
        );
        let downloaded = Arc::new(AtomicUsize::new(0));

        // Clone needed fields from each library to avoid FnOnce lifetime issues
        // with async closures that borrow from their arguments.
        let native_specs: Vec<_> = native_libs
            .iter()
            .map(|lib| {
                (
                    lib.name.clone(),
                    lib.path.clone(),
                    lib.download_url.clone(),
                    lib.sha1.clone(),
                )
            })
            .collect();

        // Debug: log native specs to ensure download URLs and paths are present
        for (name, path, url, _sha) in &native_specs {
            let full_path = spec.libraries_dir().join(path);
            let exists = full_path.exists();
            log::info!(
                "Native spec prepared: name={} path={} url={:?} exists={}",
                name,
                path,
                url,
                exists
            );
        }

        stream::iter(native_specs)
            .map(|(name, path, download_url, sha1)| {
                let client = client.clone();
                let reporter = reporter.clone();
                let downloaded = Arc::clone(&downloaded);
                let libraries_dir = spec.libraries_dir().clone();
                let natives_dir = natives_dir.clone();

                async move {
                    if reporter.is_cancelled() {
                        return Err(anyhow::anyhow!("Installation cancelled by user"));
                    }

                    let full_path = libraries_dir.join(&path);

                    // Download if not cached
                    if !full_path.exists() {
                        if let Some(ref url) = download_url {
                            log::info!("Downloading native: {} -> {:?}", name, full_path);
                            download_to_path(&client, url, &full_path, sha1.as_deref(), &*reporter)
                                .await
                                .with_context(|| {
                                    format!("Failed to download native: {} ({})", name, url)
                                })?;
                        } else {
                            log::error!(
                                "Skipping native {} — no download URL available (path={})",
                                name,
                                path
                            );
                            let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                            let progress =
                                80 + ((count as f32 / total_natives as f32) * 10.0) as i32;
                            reporter.set_percent(progress);
                            return Ok(());
                        }
                    }

                    // Extract the native JAR
                    let native_bytes = match tokio::fs::read(&full_path).await {
                        Ok(b) => b,
                        Err(e) => {
                            log::warn!("Cannot read native JAR {}: {}", name, e);
                            let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                            let progress =
                                80 + ((count as f32 / total_natives as f32) * 10.0) as i32;
                            reporter.set_percent(progress);
                            return Ok(());
                        }
                    };

                    if let Err(e) = extract_native_jar(&native_bytes, &natives_dir) {
                        log::warn!("Corrupt native JAR {}: {}", name, e);
                    }

                    let count = downloaded.fetch_add(1, Ordering::SeqCst) + 1;
                    let progress = 80 + ((count as f32 / total_natives as f32) * 10.0) as i32;
                    reporter.set_percent(progress);
                    log::debug!("Extracted native: {} ({}/{})", name, count, total_natives);

                    Ok::<(), anyhow::Error>(())
                }
            })
            .buffer_unordered(spec.concurrency)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>>>()
            .map_err(|e| e)?;
    }

    Ok(unified)
}

/// Extract a native JAR (ZIP) into the natives directory.
/// Skips excluded paths (META-INF/).
fn extract_native_jar(zip_bytes: &[u8], dest: &PathBuf) -> Result<()> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).context("Failed to open native archive")?;

    std::fs::create_dir_all(dest)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let file_name = file.name().to_string();

        // Skip META-INF and other non-native content
        if file_name.starts_with("META-INF/") || file_name.contains("META-INF") {
            continue;
        }

        if !file.is_dir() {
            let outpath = dest.join(&file_name);

            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p)?;
            }

            // Attempt to write the extracted file.  If macOS XProtect blocks it
            // (false-positive malware detection on unsigned arm64 native libs),
            // the write succeeds but the file is immediately renamed with a
            // random suffix and a quarantine bit is set.  We try to remove the
            // quarantine attribute afterwards; Gatekeeper still blocks loading
            // but the game can continue without this particular native.
            if let Err(e) = (|| -> std::io::Result<()> {
                let mut outfile = std::fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
                Ok(())
            })() {
                log::warn!("Failed to write extracted native file {:?}: {}", outpath, e);
                continue;
            }

            #[cfg(target_os = "macos")]
            remove_quarantine(&outpath);
        }
    }

    Ok(())
}

/// Remove the macOS quarantine extended attribute from a file.
/// This prevents Gatekeeper warnings for extracted native libraries.
#[cfg(target_os = "macos")]
fn remove_quarantine(path: &std::path::Path) {
    use std::process::Command;
    // xattr -d com.apple.quarantine removes the quarantine flag.
    // This is necessary because the native .dylib was embedded in a JAR
    // that was downloaded, and macOS attaches the quarantine attribute
    // to any extracted files.
    if let Err(e) = Command::new("xattr")
        .args(["-d", "com.apple.quarantine"])
        .arg(path)
        .output()
    {
        log::warn!("Failed to remove quarantine from {:?}: {}", path, e);
    }
}
