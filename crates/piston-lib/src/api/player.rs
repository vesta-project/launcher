use anyhow::{Context, Result};
use reqwest;
use std::path::PathBuf;
use tokio::fs;

/// Download player head/avatar from Crafatar API
///
/// # Arguments
/// * `uuid` - Player UUID (with or without dashes)
/// * `storage_path` - Full path where the image should be saved (including filename)
/// * `size` - Size of the avatar in pixels (8-512, default: 128)
/// * `overlay` - Whether to include the second skin layer (default: true)
/// * `force_download` - Download even if file exists
///
/// # Returns
/// Path to the downloaded image file
pub async fn download_player_head(
    uuid: &str,
    storage_path: PathBuf,
    size: u32,
    overlay: bool,
    force_download: bool,
) -> Result<PathBuf> {
    // Check if file already exists and we don't want to force download
    if storage_path.exists() && !force_download {
        return Ok(storage_path);
    }

    // Ensure parent directory exists
    if let Some(parent) = storage_path.parent() {
        fs::create_dir_all(parent)
            .await
            .context("Failed to create cache directory")?;
    }

    // Build Crafatar URL
    let mut url = format!("https://api.mcheads.org/avatar/{}", uuid);

    let mut params = vec![format!("size={}", size), "default=MHF_Steve".to_string()];
    if overlay {
        params.push("overlay".to_string());
    }

    if !params.is_empty() {
        url.push('?');
        url.push_str(&params.join("&"));
    }

    // Download image
    let response = reqwest::get(&url)
        .await
        .context("Failed to download player head")?;

    if !response.status().is_success() {
        anyhow::bail!("Failed to download player head: HTTP {}", response.status());
    }

    let bytes = response
        .bytes()
        .await
        .context("Failed to read response bytes")?;

    // Save to file
    fs::write(&storage_path, bytes)
        .await
        .context("Failed to write player head to file")?;

    Ok(storage_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_download_player_head() {
        let temp_dir = std::env::temp_dir();
        let test_uuid = "069a79f444e94726a5befca90e38aaf5"; // Notch
        let storage_path = temp_dir.join(format!("test_head_{}.png", test_uuid));

        let result = download_player_head(test_uuid, storage_path.clone(), 128, true, true).await;

        assert!(result.is_ok());
        assert!(storage_path.exists());

        // Clean up
        let _ = std::fs::remove_file(storage_path);
    }
}
