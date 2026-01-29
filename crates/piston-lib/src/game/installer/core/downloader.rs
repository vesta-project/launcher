use crate::game::installer::types::ProgressReporter;
use anyhow::{Context, Result};
use reqwest::Client;
use sha1::{Digest, Sha1};
use std::path::Path;
use tokio::fs::{create_dir_all, File};
use tokio::io::AsyncWriteExt;
// TODO: Re-add settings imports when centralized config is restored.
use std::time::Instant;

// NOTE: Retry delay is a base value; we apply a simple linear backoff (delay * attempt).

/// Check if a file is locked by another process (e.g., game is running)
/// Returns true if the file appears to be locked/in-use
fn is_file_locked(path: &Path) -> bool {
    use std::fs::OpenOptions;

    if !path.exists() {
        return false; // File doesn't exist, so it's not locked
    }

    // Try to open the file for reading
    // On Windows, if a file is opened exclusively by another process, this will fail
    match OpenOptions::new().read(true).open(path) {
        Ok(_) => false, // File is accessible
        Err(e) => {
            // Check for permission denied or sharing violation (Windows)
            // These typically indicate the file is locked by another process
            match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    log::debug!("File appears to be locked: {:?}", path);
                    true
                }
                _ => {
                    // Other errors (e.g., file doesn't exist) mean not locked
                    false
                }
            }
        }
    }
}

/// Set a file to read-only to prevent accidental modification
/// This helps prevent corruption and race conditions
fn set_read_only(path: &Path) -> Result<()> {
    let mut perms = std::fs::metadata(path)
        .context("Failed to get file metadata for read-only protection")?
        .permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(path, perms).context("Failed to set file to read-only")?;
    log::debug!("Set file to read-only: {:?}", path);
    Ok(())
}

/// Download a file to a path with progress reporting, SHA1 validation, and retry logic
pub async fn download_to_path(
    client: &Client,
    url: &str,
    path: &Path,
    expected_sha1: Option<&str>,
    reporter: &dyn ProgressReporter,
) -> Result<()> {
    log::debug!("Downloading: {} -> {:?}", url, path);

    if reporter.is_dry_run() {
        log::info!("[Dry-Run] Would download {} to {:?}", url, path);
        reporter.set_message(&format!("[Dry-Run] Would download {} to {:?}", url, path));
        return Ok(());
    }

    // Check if file exists
    if path.exists() {
        // Check if locked by another process
        if is_file_locked(path) {
            // File is locked - check if it's valid
            if let Some(expected) = expected_sha1 {
                match tokio::fs::read(path).await {
                    Ok(bytes) => {
                        let mut hasher = Sha1::new();
                        hasher.update(&bytes);
                        let computed = format!("{:x}", hasher.finalize());
                        if computed.to_lowercase() == expected.to_lowercase() {
                            log::info!("File is locked but hash matches, skipping: {:?}", path);
                            return Ok(());
                        } else {
                            log::warn!(
                                "File is locked and hash mismatches ({} != {}), cannot fix while in use: {:?}",
                                computed,
                                expected,
                                path
                            );
                            return Ok(());
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "File is locked and cannot be read ({}), skipping: {:?}",
                            e,
                            path
                        );
                        return Ok(());
                    }
                }
            } else {
                log::info!("File is locked, assuming valid and skipping: {:?}", path);
                return Ok(());
            }
        } else {
            // File exists and is NOT locked
            // Check if it's valid (if we have a hash)
            if let Some(expected) = expected_sha1 {
                match tokio::fs::read(path).await {
                    Ok(bytes) => {
                        let mut hasher = Sha1::new();
                        hasher.update(&bytes);
                        let computed = format!("{:x}", hasher.finalize());
                        if computed.to_lowercase() == expected.to_lowercase() {
                            log::debug!("File exists and hash matches, skipping: {:?}", path);
                            return Ok(());
                        }
                        log::info!(
                            "File exists but hash mismatches ({} != {}), re-downloading: {:?}",
                            computed,
                            expected,
                            path
                        );
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to read existing file for validation: {} - {}",
                            e,
                            path.display()
                        );
                    }
                }
            } else {
                // No hash provided, but file exists and is not locked.
                log::debug!("File exists and no hash provided, assuming valid and skipping: {:?}", path);
                return Ok(());
            }

            // If we're here, we need to overwrite the file.
            // Ensure it's not read-only, otherwise the overwrite will fail on Windows.
            if let Ok(metadata) = std::fs::metadata(path) {
                if metadata.permissions().readonly() {
                    log::debug!(
                        "Removing read-only attribute before overwriting: {:?}",
                        path
                    );
                    let mut perms = metadata.permissions();
                    perms.set_readonly(false);
                    if let Err(e) = std::fs::set_permissions(path, perms) {
                        log::warn!(
                            "Failed to remove read-only attribute: {} - {}",
                            e,
                            path.display()
                        );
                    }
                }
            }
        }
    }

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        create_dir_all(parent).await?;
    }

    let mut retries = 0;
    loop {
        match download_with_validation(client, url, path, expected_sha1, reporter).await {
            Ok(()) => {
                log::debug!("Download complete: {:?}", path);

                // Set file to read-only to prevent accidental modification
                if let Err(e) = set_read_only(path) {
                    log::warn!("Failed to set file to read-only: {:?} - {}", path, e);
                    // Don't fail the download if we can't set read-only
                }

                return Ok(());
            }
            Err(e) => {
                retries += 1;
                if retries >= 3 {
                    // TODO: Restore config value
                    log::error!("Download failed after {} retries: {}", 3, e);
                    return Err(e)
                        .context(format!("Failed to download {} after {} retries", url, 3));
                }
                log::warn!(
                    "Download failed (attempt {}/{}) : {}. Retrying...",
                    retries,
                    3,
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(1000 * retries as u64)) // TODO: Restore config value
                    .await;
            }
        }
    }
}

async fn download_with_validation(
    client: &Client,
    url: &str,
    path: &Path,
    expected_sha1: Option<&str>,
    reporter: &dyn ProgressReporter,
) -> Result<()> {
    let start = Instant::now();
    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("HTTP error {}: {}", response.status(), url);
    }

    let total_size = response.content_length();
    log::debug!("Download size: {:?} bytes", total_size);

    // Write to a temporary file first, then atomically rename to the final path.
    // This prevents leaving partial files at the destination if the download fails.
    let tmp_name = format!(
        "{}.part",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("download")
    );
    let tmp_path = path.with_file_name(tmp_name);
    let mut file = File::create(&tmp_path).await?;
    let mut downloaded: u64 = 0;
    let mut chunk_count: u64 = 0;
    let mut hasher = Sha1::new();

    let mut stream = response.bytes_stream();
    use futures::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        if reporter.is_cancelled() {
            log::warn!("Download cancelled: {:?}", path);
            anyhow::bail!("Download cancelled by user");
        }

        // Handle pause
        while reporter.is_paused() {
            if reporter.is_cancelled() {
                anyhow::bail!("Download cancelled by user");
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        let chunk = chunk_result?;
        file.write_all(&chunk).await?;
        hasher.update(&chunk);

        downloaded += chunk.len() as u64;
        chunk_count += 1;
        reporter.update_bytes(downloaded, total_size);
    }
    file.flush().await?;
    // Ensure data is flushed to disk
    file.sync_all().await?;
    drop(file);

    // Validate SHA1 if provided
    if let Some(expected) = expected_sha1 {
        let computed = format!("{:x}", hasher.finalize());
        if computed.to_lowercase() != expected.to_lowercase() {
            // Delete invalid temp file
            let _ = tokio::fs::remove_file(&tmp_path).await;
            anyhow::bail!(
                "SHA1 mismatch for {}: expected {}, got {}",
                url,
                expected,
                computed
            );
        }
        log::debug!("SHA1 validated: {}", computed);
    }

    // Atomic move into place
    tokio::fs::rename(&tmp_path, path).await?;

    let elapsed = start.elapsed();
    if downloaded > 0 {
        let secs = elapsed.as_secs_f64();
        let throughput = (downloaded as f64 / 1024.0 / 1024.0) / secs.max(0.001); // MB/s
        log::info!(
            "Download stats: url={}, size={} bytes, chunks={}, time={:.2}s, throughput={:.2} MB/s",
            url,
            downloaded,
            chunk_count,
            secs,
            throughput
        );
    } else {
        log::info!(
            "Download completed but size reported as 0 bytes (url={}), elapsed={:.2}s",
            url,
            elapsed.as_secs_f64()
        );
    }

    Ok(())
}

/// Download a file to memory and return the bytes
pub async fn download_to_memory(url: &str, expected_sha1: Option<&str>) -> Result<Vec<u8>> {
    log::debug!("Downloading to memory: {}", url);

    // Convenience wrapper that creates its own client. For bulk downloads prefer
    // `download_to_memory_with_client` to reuse a single Client.
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120)) // TODO: Restore config value
        .build()?;

    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("HTTP error {}: {}", response.status(), url);
    }

    let bytes = response.bytes().await?;

    // Validate SHA1 if provided
    if let Some(expected) = expected_sha1 {
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let computed = format!("{:x}", hasher.finalize());

        if computed.to_lowercase() != expected.to_lowercase() {
            anyhow::bail!(
                "SHA1 mismatch for {}: expected {}, got {}",
                url,
                expected,
                computed
            );
        }
    }

    Ok(bytes.to_vec())
}

/// Download a file to memory using an existing Client and return the bytes
pub async fn download_to_memory_with_client(
    client: &Client,
    url: &str,
    expected_sha1: Option<&str>,
    reporter: Option<&dyn ProgressReporter>,
) -> Result<Vec<u8>> {
    let mut retries = 0;
    loop {
        match download_to_memory_internal(client, url, expected_sha1, reporter).await {
            Ok(bytes) => return Ok(bytes),
            Err(e) => {
                retries += 1;
                if retries >= 3 {
                    return Err(e)
                        .context(format!("Failed to download {} after {} retries", url, 3));
                }
                log::warn!(
                    "Download failed (attempt {}/3): {}. Retrying...",
                    retries,
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(1000 * retries as u64)).await;
            }
        }
    }
}

async fn download_to_memory_internal(
    client: &Client,
    url: &str,
    expected_sha1: Option<&str>,
    reporter: Option<&dyn ProgressReporter>,
) -> Result<Vec<u8>> {
    log::debug!("Downloading to memory (reused client): {}", url);

    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("HTTP error {}: {}", response.status(), url);
    }

    let total_size = response.content_length();
    let mut bytes = Vec::with_capacity(total_size.unwrap_or(0) as usize);
    let mut downloaded: u64 = 0;
    let mut hasher = Sha1::new();

    let mut stream = response.bytes_stream();
    use futures::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        if let Some(rep) = reporter {
            if rep.is_cancelled() {
                anyhow::bail!("Download cancelled by user");
            }

            while rep.is_paused() {
                if rep.is_cancelled() {
                    anyhow::bail!("Download cancelled by user");
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }

        let chunk = chunk_result?;
        bytes.extend_from_slice(&chunk);
        hasher.update(&chunk);

        downloaded += chunk.len() as u64;
        if let Some(rep) = reporter {
            rep.update_bytes(downloaded, total_size);
        }
    }

    // Validate SHA1 if provided
    if let Some(expected) = expected_sha1 {
        let computed = format!("{:x}", hasher.finalize());

        if computed.to_lowercase() != expected.to_lowercase() {
            anyhow::bail!(
                "SHA1 mismatch for {}: expected {}, got {}",
                url,
                expected,
                computed
            );
        }
    }

    Ok(bytes)
}

/// Download JSON and deserialize
pub async fn download_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T> {
    log::debug!("Downloading JSON: {}", url);

    // Convenience wrapper that creates its own client. Callers that perform many
    // requests should use `download_json_with_client` with a shared Client.
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120)) // TODO: Restore config value
        .build()?;

    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("HTTP error {}: {}", response.status(), url);
    }

    let data = response.json().await?;
    Ok(data)
}

/// Download JSON using an existing Client and deserialize
pub async fn download_json_with_client<T: serde::de::DeserializeOwned>(
    client: &Client,
    url: &str,
) -> Result<T> {
    log::debug!("Downloading JSON (reused client): {}", url);
    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("HTTP error {}: {}", response.status(), url);
    }

    let data = response.json().await?;
    Ok(data)
}

/// Extract a zip archive to a directory
pub async fn extract_zip(zip_bytes: &[u8], dest_dir: &Path) -> Result<()> {
    use std::io::Cursor;

    log::debug!("Extracting zip to: {:?}", dest_dir);

    create_dir_all(dest_dir).await?;

    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = dest_dir.join(file.name());

        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p)?;
                }
            }
            let mut outfile = std::fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }

        // Set permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode))?;
            }
        }
    }

    log::debug!("Zip extraction complete");
    Ok(())
}

/// Ensure there's a client JAR available for a loader-installed variant
/// by copying the vanilla client jar into the installed-version folder or
/// downloading the client again into the installed folder when necessary.
pub async fn ensure_installed_client(
    spec: &crate::game::installer::types::InstallSpec,
    installed_id: &str,
    reporter: Option<&dyn crate::game::installer::types::ProgressReporter>,
) -> Result<()> {
    // Paths
    let installed_dir = spec.versions_dir().join(installed_id);
    tokio::fs::create_dir_all(&installed_dir).await?;

    let installed_jar = installed_dir.join(format!("{}.jar", installed_id));
    if installed_jar.exists() {
        log::debug!("Installed jar already present: {:?}", installed_jar);
        return Ok(());
    }

    let vanilla_jar = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.jar", spec.version_id));

    // Try copy if vanilla jar exists
    if vanilla_jar.exists() {
        log::info!(
            "Copying vanilla jar {:?} -> {:?}",
            vanilla_jar,
            installed_jar
        );
        tokio::fs::copy(&vanilla_jar, &installed_jar).await?;
        return Ok(());
    }

    // Fallback: try to read vanilla version.json and download client URL into installed dir
    let version_json = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.json", spec.version_id));

    if !version_json.exists() {
        anyhow::bail!(
            "Neither vanilla jar nor version.json found for {}",
            spec.version_id
        );
    }

    let contents = tokio::fs::read_to_string(&version_json).await?;
    let parsed: serde_json::Value = serde_json::from_str(&contents)?;

    let client_url = parsed
        .get("downloads")
        .and_then(|d| d.get("client"))
        .and_then(|c| c.get("url"))
        .and_then(|u| u.as_str())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Client download URL not present in version.json for {}",
                spec.version_id
            )
        })?;

    // optional sha1
    let sha1 = parsed
        .get("downloads")
        .and_then(|d| d.get("client"))
        .and_then(|c| c.get("sha1"))
        .and_then(|s| s.as_str());

    log::info!(
        "Downloading client jar for {} into installed dir: {}",
        spec.version_id,
        installed_jar.display()
    );

    // Use a lightweight client; reuse progress reporter when given
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    // If we were passed a reporter, use it to provide progress; otherwise create a noop reporter
    let rep: &dyn crate::game::installer::types::ProgressReporter = match reporter {
        Some(r) => r,
        None => &NoopReporter {},
    };

    // Use existing download_to_path helper
    download_to_path(&client, client_url, &installed_jar, sha1, rep).await?;

    Ok(())
}

// Minimal no-op reporter used when callers don't pass a ProgressReporter
struct NoopReporter {}

impl crate::game::installer::types::ProgressReporter for NoopReporter {
    fn start_step(&self, _name: &str, _total_steps: Option<u32>) {}
    fn update_bytes(&self, _transferred: u64, _total: Option<u64>) {}
    fn set_percent(&self, _percent: i32) {}
    fn set_message(&self, _message: &str) {}
    fn set_step_count(&self, _current: u32, _total: Option<u32>) {}
    fn set_substep(&self, _name: Option<&str>, _current: Option<u32>, _total: Option<u32>) {}
    fn set_actions(
        &self,
        _actions: Option<Vec<crate::game::installer::types::NotificationActionSpec>>,
    ) {
    }
    fn done(&self, _success: bool, _message: Option<&str>) {}
    fn is_cancelled(&self) -> bool {
        false
    }
    fn is_paused(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::installer::types::{InstallSpec, ModloaderType};
    use std::io::Write;
    use tempfile::tempdir;

    #[tokio::test]
    async fn ensure_installed_client_copies_vanilla_jar() {
        let tmp = tempdir().unwrap();
        let data_dir = tmp.path().join("data");
        let versions_dir = data_dir.join("versions");

        // create vanilla version folder with jar
        let vanilla_dir = versions_dir.join("1.20.1");
        std::fs::create_dir_all(&vanilla_dir).unwrap();
        let vanilla_jar = vanilla_dir.join("1.20.1.jar");
        {
            let mut f = std::fs::File::create(&vanilla_jar).unwrap();
            write!(f, "vanilla-jar-content").unwrap();
        }

        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Forge),
            modloader_version: Some("47.2.0".to_string()),
            data_dir: data_dir.clone(),
            game_dir: tmp.path().join("game"),
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let installed_id = "forge-loader-47.2.0-1.20.1";

        // Call helper
        ensure_installed_client(&spec, installed_id, None)
            .await
            .unwrap();

        let installed_jar = versions_dir
            .join(installed_id)
            .join(format!("{}.jar", installed_id));
        assert!(installed_jar.exists());

        let contents = std::fs::read_to_string(installed_jar).unwrap();
        assert_eq!(contents, "vanilla-jar-content");
    }

    #[tokio::test]
    async fn ensure_installed_client_idempotent_when_target_exists() {
        let tmp = tempdir().unwrap();
        let data_dir = tmp.path().join("data");
        let versions_dir = data_dir.join("versions");

        let vanilla_dir = versions_dir.join("1.20.1");
        std::fs::create_dir_all(&vanilla_dir).unwrap();
        let vanilla_jar = vanilla_dir.join("1.20.1.jar");
        std::fs::write(&vanilla_jar, "content").unwrap();

        let installed_dir = versions_dir.join("forge-loader-47.2.0-1.20.1");
        std::fs::create_dir_all(&installed_dir).unwrap();
        let installed_jar = installed_dir.join("forge-loader-47.2.0-1.20.1.jar");
        std::fs::write(&installed_jar, "existing").unwrap();

        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Forge),
            modloader_version: Some("47.2.0".to_string()),
            data_dir: data_dir.clone(),
            game_dir: tmp.path().join("game"),
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let installed_id = "forge-loader-47.2.0-1.20.1";
        // Should not overwrite existing file
        ensure_installed_client(&spec, installed_id, None)
            .await
            .unwrap();
        let contents = std::fs::read_to_string(installed_jar).unwrap();
        assert_eq!(contents, "existing");
    }
}
