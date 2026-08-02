//! Mojang API client for Minecraft profile information
//!
//! Provides methods to fetch user profile data, skins, and verify game ownership.

use crate::auth::{AuthPhase, AuthService, PistonAuthError};
use anyhow::{Context, Result};
use log::{debug, error};
use reqwest::multipart;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnershipStatus {
    Owned,
    NotOwned,
}

#[derive(Debug, Deserialize)]
struct EntitlementsResponse {
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

/// Fetch Minecraft profile using bearer token
pub async fn get_minecraft_profile(
    bearer_token: &str,
) -> std::result::Result<MinecraftProfile, PistonAuthError> {
    get_minecraft_profile_from(
        crate::client::shared_client(),
        MOJANG_API_BASE,
        bearer_token,
    )
    .await
}

async fn get_minecraft_profile_from(
    client: &reqwest::Client,
    base_url: &str,
    bearer_token: &str,
) -> std::result::Result<MinecraftProfile, PistonAuthError> {
    let url = format!("{base_url}/minecraft/profile");
    let response = client
        .get(url)
        .bearer_auth(bearer_token)
        .send()
        .await
        .map_err(|error| {
            PistonAuthError::network(
                AuthService::MinecraftServices,
                AuthPhase::Profile,
                crate::client::redact_configured_proxy_secrets(&error.to_string()),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("get_minecraft_profile: non-success {} - {}", status, body);
        return Err(PistonAuthError::from_http_status(
            AuthService::MinecraftServices,
            AuthPhase::Profile,
            status.as_u16(),
            "Minecraft profile lookup failed",
        ));
    }

    let profile = response.json::<MinecraftProfile>().await.map_err(|error| {
        PistonAuthError::unexpected(
            AuthService::MinecraftServices,
            AuthPhase::Profile,
            None,
            error.to_string(),
        )
    })?;

    Ok(profile)
}

/// Verify game ownership
pub async fn verify_game_ownership(
    bearer_token: &str,
) -> std::result::Result<OwnershipStatus, PistonAuthError> {
    verify_game_ownership_from(
        crate::client::shared_client(),
        MOJANG_API_BASE,
        bearer_token,
    )
    .await
}

async fn verify_game_ownership_from(
    client: &reqwest::Client,
    base_url: &str,
    bearer_token: &str,
) -> std::result::Result<OwnershipStatus, PistonAuthError> {
    let response = client
        .get(format!("{base_url}/entitlements/mcstore"))
        .bearer_auth(bearer_token)
        .send()
        .await
        .map_err(|error| {
            PistonAuthError::network(
                AuthService::MinecraftServices,
                AuthPhase::Entitlements,
                crate::client::redact_configured_proxy_secrets(&error.to_string()),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("verify_game_ownership: non-success {} - {}", status, body);
        return Err(PistonAuthError::from_http_status(
            AuthService::MinecraftServices,
            AuthPhase::Entitlements,
            status.as_u16(),
            "Minecraft entitlement lookup failed",
        ));
    }

    let entitlements = response
        .json::<EntitlementsResponse>()
        .await
        .map_err(|error| {
            PistonAuthError::unexpected(
                AuthService::MinecraftServices,
                AuthPhase::Entitlements,
                None,
                error.to_string(),
            )
        })?;

    Ok(if entitlements.items.is_empty() {
        OwnershipStatus::NotOwned
    } else {
        OwnershipStatus::Owned
    })
}

/// Upload a new skin to Mojang
pub async fn upload_skin(bearer_token: &str, variant: &str, file_bytes: Vec<u8>) -> Result<()> {
    let client = crate::client::shared_client();
    let file_len = file_bytes.len();
    debug!("upload_skin: preparing skin upload ({} bytes)", file_len);
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
    let client = crate::client::shared_client();
    let response = client
        .delete(format!(
            "{}/minecraft/profile/skins/active",
            MOJANG_API_BASE
        ))
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
    let client = crate::client::shared_client();
    let response = client
        .put(format!(
            "{}/minecraft/profile/capes/active",
            MOJANG_API_BASE
        ))
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
    let client = crate::client::shared_client();
    let response = client
        .delete(format!(
            "{}/minecraft/profile/capes/active",
            MOJANG_API_BASE
        ))
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

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn ownership_requires_a_successful_non_empty_entitlement_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/entitlements/mcstore"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": []
            })))
            .mount(&server)
            .await;

        let status = verify_game_ownership_from(&reqwest::Client::new(), &server.uri(), "token")
            .await
            .unwrap();
        assert_eq!(status, OwnershipStatus::NotOwned);
    }

    #[tokio::test]
    async fn ownership_accepts_a_non_empty_entitlement_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/entitlements/mcstore"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{ "name": "game_minecraft", "signature": "signature" }]
            })))
            .mount(&server)
            .await;

        let status = verify_game_ownership_from(&reqwest::Client::new(), &server.uri(), "token")
            .await
            .unwrap();
        assert_eq!(status, OwnershipStatus::Owned);
    }

    #[tokio::test]
    async fn profile_404_is_not_classified_as_unauthorized() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/minecraft/profile"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let error = get_minecraft_profile_from(&reqwest::Client::new(), &server.uri(), "token")
            .await
            .unwrap_err();
        assert!(error.is_retryable_outage());
        assert!(!matches!(error, PistonAuthError::Unauthorized { .. }));
    }

    #[tokio::test]
    async fn entitlement_401_is_classified_as_unauthorized() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/entitlements/mcstore"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let error = verify_game_ownership_from(&reqwest::Client::new(), &server.uri(), "token")
            .await
            .unwrap_err();
        assert!(matches!(error, PistonAuthError::Unauthorized { .. }));
    }
}
