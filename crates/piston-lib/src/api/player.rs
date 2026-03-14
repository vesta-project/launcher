use anyhow::{Context, Result};
use reqwest;
use std::path::PathBuf;
use tokio::fs;
use base64::{Engine as _, engine::general_purpose};
use serde::Deserialize;
use image::{imageops, GenericImageView};

// --- Helper Structs for Public Profile resolution ---
#[derive(Deserialize)]
struct SessionProfile { properties: Vec<ProfileProperty> }
#[derive(Deserialize)]
struct ProfileProperty { name: String, value: String }
#[derive(Deserialize)]
struct TexturesProperty { textures: Textures }
#[derive(Deserialize)]
struct Textures {
    #[serde(rename = "SKIN")]
    skin: Option<SkinTexture>,
}
#[derive(Deserialize)]
struct SkinTexture { url: String }

/// Download player head/avatar by fetching the skin and extracting the face
///
/// # Arguments
/// * `uuid` - Player UUID (with or without dashes)
/// * `known_skin_url` - The skin url if we already know it (from database profile)
/// * `storage_path` - Full path where the image should be saved (including filename)
/// * `size` - Size of the avatar in pixels (default: 128)
/// * `overlay` - Whether to include the second skin layer (default: true)
/// * `force_download` - Download even if file exists
///
/// # Returns
/// Path to the downloaded image file
pub async fn download_player_head(
    uuid: &str,
    known_skin_url: Option<String>,
    storage_path: PathBuf,
    size: u32,
    overlay: bool,
    force_download: bool,
) -> Result<PathBuf> {
    // Normalize UUID (remove dashes)
    let normalized_uuid = uuid.replace("-", "");

    // If file exists and we are not forcing download, return existing path
    if storage_path.exists() && !force_download {
        return Ok(storage_path);
    }

    // Ensure parent directory exists
    if let Some(parent) = storage_path.parent() {
        fs::create_dir_all(parent)
            .await
            .context("Failed to create cache directory")?;
    }

    // 1. Resolve URL (Use known URL from DB or query Session Server)
    let skin_url = match known_skin_url {
        Some(url) => Some(url),
        None => {
            let url = format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", normalized_uuid);
            let resp = reqwest::get(&url).await?;
            if resp.status().is_success() {
                let profile: SessionProfile = resp.json().await?;
                if let Some(prop) = profile.properties.into_iter().find(|p| p.name == "textures") {
                    let decoded = general_purpose::STANDARD.decode(prop.value)?;
                    let textures: TexturesProperty = serde_json::from_slice(&decoded)?;
                    textures.textures.skin.map(|s| s.url)
                } else { None }
            } else { None }
        }
    };

    let target_url = match skin_url {
        Some(url) => url,
        None => {
            // Fallback to minotar if we fail to get the skin from the profile
            let endpoint = if overlay { "helm" } else { "avatar" };
            let fallback_url = format!("https://minotar.net/{}/{}/{}.png", endpoint, normalized_uuid, size);
            let response = reqwest::get(&fallback_url).await.context("Failed to fallback to minotar player head")?;
            
            if response.status().is_success() {
                let bytes = response.bytes().await.context("Failed to read fallback response bytes")?;
                fs::write(&storage_path, bytes).await.context("Failed to write fallback player head to file")?;
            } else {
                anyhow::bail!("Failed to download player head: HTTP {}", response.status());
            }
            return Ok(storage_path);
        }
    };

    // 2. Download raw skin bytes
    let skin_bytes = reqwest::get(&target_url).await?.bytes().await?.to_vec();

    // 3. Process Image
    let img = image::load_from_memory(&skin_bytes).context("Failed to load skin from memory")?;

    // Crop face (x=8, y=8, width=8, height=8) 
    let face = img.crop_imm(8, 8, 8, 8);
    
    // Scale up using Nearest Neighbor to maintain pixel art style
    let mut head = imageops::resize(&face, size, size, imageops::FilterType::Nearest);

    if overlay {
        // Crop hat/helm (x=40, y=8, width=8, height=8) 
        let helm = img.crop_imm(40, 8, 8, 8);
        let scaled_helm = imageops::resize(&helm, size, size, imageops::FilterType::Nearest);
        
        // Blend helm over face
        imageops::overlay(&mut head, &scaled_helm, 0, 0);
    }

    // 4. Save to Disk
    head.save(&storage_path).context("Failed to write scaled head to disk")?;

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
