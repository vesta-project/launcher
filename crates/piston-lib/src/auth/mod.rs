//! Microsoft OAuth authentication module
//!
//! Provides OAuth2 device-code flow for Microsoft authentication and
//! token exchange for Minecraft services.

use anyhow::{Context, Result};
use oauth2::TokenResponse;
use oauth2::{
    basic::{BasicClient, BasicTokenResponse},
    reqwest::async_http_client,
    AuthUrl, ClientId, DeviceAuthorizationUrl, DeviceCodeErrorResponse, RefreshToken,
    RequestTokenError, Scope, StandardDeviceAuthorizationResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};

/// Microsoft OAuth endpoints
const AUTHORIZATION_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const DEVICE_CODE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";

/// Minecraft OAuth client ID - Official Minecraft Launcher client ID
pub const CLIENT_ID: &str = "9c203c7d-1816-4d24-87f2-9731ce05e187";

/// OAuth scopes required for Minecraft authentication
const SCOPES: &[&str] = &["XboxLive.signin", "offline_access"];

/// Device code login details returned to UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeDetails {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Create OAuth2 client for Microsoft authentication
pub fn get_auth_client() -> Result<BasicClient> {
    let client = BasicClient::new(
        ClientId::new(CLIENT_ID.to_string()),
        None,
        AuthUrl::new(AUTHORIZATION_URL.to_string())?,
        Some(TokenUrl::new(TOKEN_URL.to_string())?),
    )
    .set_device_authorization_url(DeviceAuthorizationUrl::new(DEVICE_CODE_URL.to_string())?);

    Ok(client)
}

/// Request device code for user authentication
pub async fn get_device_code(client: &BasicClient) -> Result<StandardDeviceAuthorizationResponse> {
    let scopes: Vec<Scope> = SCOPES.iter().map(|s| Scope::new(s.to_string())).collect();

    let details = client
        .exchange_device_code()
        .context("Failed to create device code request")?
        .add_scopes(scopes)
        .request_async(async_http_client)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to request device code: {:?}", e))?;

    Ok(details)
}

/// Convert device authorization response to UI-friendly details
pub fn device_code_to_details(response: &StandardDeviceAuthorizationResponse) -> DeviceCodeDetails {
    DeviceCodeDetails {
        user_code: response.user_code().secret().clone(),
        verification_uri: response.verification_uri().to_string(),
        expires_in: response.expires_in().as_secs(),
        interval: response.interval().as_secs(),
    }
}

/// Poll for authentication completion
///
/// This should be called in a loop until it returns Ok(token) or Err
pub async fn poll_for_token(
    client: &BasicClient,
    device_code: StandardDeviceAuthorizationResponse,
) -> Result<
    BasicTokenResponse,
    RequestTokenError<oauth2::reqwest::Error<reqwest::Error>, DeviceCodeErrorResponse>,
> {
    client
        .exchange_device_access_token(&device_code)
        .request_async(async_http_client, tokio::time::sleep, None)
        .await
}

/// Refresh an expired access token using refresh token
pub async fn refresh_access_token(
    client: &BasicClient,
    refresh_token: String,
) -> Result<BasicTokenResponse> {
    log::info!("[auth] Attempting to refresh Microsoft access token");
    match client
        .exchange_refresh_token(&RefreshToken::new(refresh_token))
        .request_async(async_http_client)
        .await
    {
        Ok(token) => {
            log::info!(
                "[auth] Successfully refreshed Microsoft access token (expires_in: {:?})",
                token.expires_in()
            );
            Ok(token)
        }
        Err(e) => {
            log::error!("[auth] Failed to refresh Microsoft access token: {:?}", e);
            Err(anyhow::anyhow!("Failed to refresh access token: {:?}", e))
        }
    }
}

/// Exchange Microsoft access token for Minecraft token
pub async fn exchange_for_minecraft_token(
    microsoft_access_token: &str,
) -> Result<minecraft_msa_auth::MinecraftAuthenticationResponse> {
    // minecraft-msa-auth uses reqwest 0.12, so we use reqwest12 alias
    let client = reqwest12::Client::new();
    log::info!("[auth] Exchanging Microsoft access token for Minecraft token");
    let response = match minecraft_msa_auth::MinecraftAuthorizationFlow::new(client)
        .exchange_microsoft_token(microsoft_access_token)
        .await
    {
        Ok(resp) => {
            log::info!("[auth] Successfully exchanged Microsoft token for Minecraft token");
            resp
        }
        Err(e) => {
            log::error!("[auth] Failed to exchange for Minecraft token: {:?}", e);
            return Err(anyhow::anyhow!(
                "Failed to exchange for Minecraft token: {:?}",
                e
            ));
        }
    };

    Ok(response)
}
