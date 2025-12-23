//! Mojang API client for Minecraft profile information
//!
//! Provides methods to fetch user profile data, skins, and verify game ownership.

use anyhow::{Context, Result};
use reqwest::Client;
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

    let response = client
        .get(format!("{}/minecraft/profile", MOJANG_API_BASE))
        .bearer_auth(bearer_token)
        .send()
        .await
        .context("Failed to fetch Minecraft profile")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
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
