//! Mojang API client for Minecraft profile information
//!
//! Provides methods to fetch user profile data, skins, and verify game ownership.

use anyhow::{Context, Result};
use reqwest::{Client, multipart};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};

const MOJANG_API_BASE: &str = "https://api.minecraftservices.com";

/// Minecraft profile information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<ProfileSkin>,
    #[serde(default)]
    pub capes: Vec<ProfileCape>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSkin {
    pub id: String,
    pub state: String,
    pub url: String,
    pub variant: String,
    #[serde(rename = "alias")]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileCape {
    pub id: String,
    pub state: String,
    pub url: String,
    #[serde(rename = "alias")]
    pub alias: String,
}

/// Fetch Minecraft profile using bearer token
pub async fn get_minecraft_profile(bearer_token: &str) -> Result<MinecraftProfile> {
    let client = Client::new();

    let url = format!("{}/minecraft/profile", MOJANG_API_BASE);
    let response = client
        .get(url.clone())
        .bearer_auth(bearer_token)
        .send()
        .await
        .context("Failed to fetch Minecraft profile")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("get_minecraft_profile: non-success {} - {}", status, body);
        anyhow::bail!("Failed to get profile: {} - {}", status, body);
    }

    let profile = response
        .json::<MinecraftProfile>()
        .await
        .context("Failed to parse Minecraft profile")?;

    Ok(profile)
}

/// Verify game ownership
pub async fn verify_game_ownership(bearer_token: &str) -> Result<bool> {
    let client = Client::new();

    let response = client
        .get(format!("{}/entitlements/mcstore", MOJANG_API_BASE))
        .bearer_auth(bearer_token)
        .send()
        .await
        .context("Failed to verify game ownership")?;

    Ok(response.status().is_success())
}

/// Upload a new skin to Mojang
pub async fn upload_skin(bearer_token: &str, variant: &str, file_bytes: Vec<u8>) -> Result<()> {
    let client = Client::new();
    let file_len = file_bytes.len();
    let part = multipart::Part::bytes(file_bytes)
        .file_name("skin.png")
        .mime_str("image/png")?;
    let form = multipart::Form::new()
        .text("variant", variant.to_string())
        .part("file", part);
    let url = format!("{}/minecraft/profile/skins", MOJANG_API_BASE);
    let response = client
        .post(url.clone())
        .bearer_auth(bearer_token)
        .multipart(form)
        .send()
        .await
        .context("Failed to upload skin")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("upload_skin: non-success {} - {}", status, body);
        anyhow::bail!("Failed to upload skin: {} - {}", status, body);
    }
    Ok(())
}

/// Reset skin to default
pub async fn reset_skin(bearer_token: &str) -> Result<()> {
    let client = Client::new();
    let response = client
        .delete(format!("{}/minecraft/profile/skins/active", MOJANG_API_BASE))
        .bearer_auth(bearer_token)
        .send()
        .await
        .context("Failed to reset skin")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Failed to reset skin: {} - {}", status, body);
    }
    Ok(())
}

/// Change active cape
pub async fn change_cape(bearer_token: &str, cape_id: &str) -> Result<()> {
    let client = Client::new();
    let response = client
        .put(format!("{}/minecraft/profile/capes/active", MOJANG_API_BASE))
        .bearer_auth(bearer_token)
        .json(&serde_json::json!({ "capeId": cape_id }))
        .send()
        .await
        .context("Failed to change cape")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Failed to change cape: {} - {}", status, body);
    }
    Ok(())
}

/// Hide active cape
pub async fn hide_cape(bearer_token: &str) -> Result<()> {
    let client = Client::new();
    let response = client
        .delete(format!("{}/minecraft/profile/capes/active", MOJANG_API_BASE))
        .bearer_auth(bearer_token)
        .send()
        .await
        .context("Failed to hide cape")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Failed to hide cape: {} - {}", status, body);
    }
    Ok(())
}
