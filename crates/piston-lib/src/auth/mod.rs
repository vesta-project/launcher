//! Microsoft OAuth authentication module
//!
//! Provides OAuth2 device-code flow for Microsoft authentication and
//! token exchange for Minecraft services.

use anyhow::Result;
use oauth2::TokenResponse;
use oauth2::{
    basic::BasicErrorResponseType,
    basic::{BasicClient, BasicTokenResponse},
    AuthUrl, ClientId, DeviceAuthorizationUrl, DeviceCodeErrorResponse, RefreshToken,
    RequestTokenError, Scope, StandardDeviceAuthorizationResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthService {
    Microsoft,
    XboxLive,
    MinecraftServices,
}

impl AuthService {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Microsoft => "microsoft",
            Self::XboxLive => "xbox_live",
            Self::MinecraftServices => "minecraft_services",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthPhase {
    DeviceCode,
    TokenPolling,
    TokenRefresh,
    MinecraftTokenExchange,
    Entitlements,
    Profile,
}

/// Authentication errors with enough structure for callers to distinguish
/// invalid credentials from unavailable authentication dependencies.
#[derive(Debug, Clone, Error)]
pub enum PistonAuthError {
    #[error("Refresh token expired or invalid (invalid_grant)")]
    SessionExpired,
    #[error("{service:?} could not be reached during {phase:?}: {detail}")]
    NetworkError {
        service: AuthService,
        phase: AuthPhase,
        detail: String,
    },
    #[error("{service:?} is unavailable during {phase:?} (HTTP {status})")]
    ServiceUnavailable {
        service: AuthService,
        phase: AuthPhase,
        status: u16,
    },
    #[error("{service:?} rejected authentication during {phase:?} (HTTP {status})")]
    Unauthorized {
        service: AuthService,
        phase: AuthPhase,
        status: u16,
    },
    #[error("Microsoft account does not have an Xbox profile")]
    NoXboxProfile,
    #[error("Microsoft account must be added to a Microsoft family")]
    MinorNeedsFamily,
    #[error("Microsoft account does not own Minecraft")]
    NoMinecraftEntitlement,
    #[error("{service:?} returned an unexpected response during {phase:?}: {detail}")]
    UnexpectedResponse {
        service: AuthService,
        phase: AuthPhase,
        status: Option<u16>,
        detail: String,
    },
    #[error("Other authentication error: {0}")]
    Other(String),
}

impl PistonAuthError {
    pub fn from_http_status(
        service: AuthService,
        phase: AuthPhase,
        status: u16,
        detail: impl Into<String>,
    ) -> Self {
        match status {
            401 | 403 => Self::Unauthorized {
                service,
                phase,
                status,
            },
            // A 404 is an ambiguous service response, never proof that the
            // account is unauthenticated. Treat it as retryable/unavailable.
            404 | 408 | 425 | 429 | 500..=599 => Self::ServiceUnavailable {
                service,
                phase,
                status,
            },
            _ => Self::unexpected(service, phase, Some(status), detail),
        }
    }

    pub fn network(service: AuthService, phase: AuthPhase, detail: impl Into<String>) -> Self {
        Self::NetworkError {
            service,
            phase,
            detail: detail.into(),
        }
    }

    pub fn unexpected(
        service: AuthService,
        phase: AuthPhase,
        status: Option<u16>,
        detail: impl Into<String>,
    ) -> Self {
        Self::UnexpectedResponse {
            service,
            phase,
            status,
            detail: detail.into(),
        }
    }

    pub fn service(&self) -> Option<AuthService> {
        match self {
            Self::NetworkError { service, .. }
            | Self::ServiceUnavailable { service, .. }
            | Self::Unauthorized { service, .. }
            | Self::UnexpectedResponse { service, .. } => Some(*service),
            Self::SessionExpired
            | Self::NoXboxProfile
            | Self::MinorNeedsFamily
            | Self::NoMinecraftEntitlement
            | Self::Other(_) => None,
        }
    }

    pub fn phase(&self) -> Option<AuthPhase> {
        match self {
            Self::NetworkError { phase, .. }
            | Self::ServiceUnavailable { phase, .. }
            | Self::Unauthorized { phase, .. }
            | Self::UnexpectedResponse { phase, .. } => Some(*phase),
            _ => None,
        }
    }

    pub fn status_code(&self) -> Option<u16> {
        match self {
            Self::ServiceUnavailable { status, .. } | Self::Unauthorized { status, .. } => {
                Some(*status)
            }
            Self::UnexpectedResponse { status, .. } => *status,
            _ => None,
        }
    }

    pub fn is_retryable_outage(&self) -> bool {
        matches!(
            self,
            Self::NetworkError { .. } | Self::ServiceUnavailable { .. }
        )
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::SessionExpired => "session_expired",
            Self::NetworkError { .. } => "network_unavailable",
            Self::ServiceUnavailable { .. } => "service_unavailable",
            Self::Unauthorized { .. } => "authentication_rejected",
            Self::NoXboxProfile => "xbox_profile_required",
            Self::MinorNeedsFamily => "microsoft_family_required",
            Self::NoMinecraftEntitlement => "minecraft_ownership_required",
            Self::UnexpectedResponse { .. } => "unexpected_service_response",
            Self::Other(_) => "authentication_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::SessionExpired => {
                "Your Microsoft session has expired or been revoked. Sign in again.".to_string()
            }
            Self::NetworkError { .. } => {
                "Vesta could not connect to Minecraft authentication services. Check your connection and try again.".to_string()
            }
            Self::ServiceUnavailable { status, .. } => format!(
                "Minecraft authentication services are temporarily unavailable (HTTP {status}). Try again later."
            ),
            Self::Unauthorized { .. } => {
                "Minecraft authentication rejected this session. Sign in again.".to_string()
            }
            Self::NoXboxProfile => {
                "This Microsoft account needs an Xbox profile before it can use Minecraft."
                    .to_string()
            }
            Self::MinorNeedsFamily => {
                "This Microsoft account must be added to a Microsoft family before it can use Minecraft."
                    .to_string()
            }
            Self::NoMinecraftEntitlement => {
                "This Microsoft account does not own Minecraft.".to_string()
            }
            Self::UnexpectedResponse { status, .. } => match status {
                Some(status) => format!(
                    "Minecraft authentication services returned an unexpected response (HTTP {status}). Try again later."
                ),
                None => "Minecraft authentication services returned an unexpected response. Try again later.".to_string(),
            },
            Self::Other(_) => "Authentication could not be completed. Try again.".to_string(),
        }
    }
}

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
pub async fn get_device_code(
    client: &BasicClient,
) -> std::result::Result<StandardDeviceAuthorizationResponse, PistonAuthError> {
    let scopes: Vec<Scope> = SCOPES.iter().map(|s| Scope::new(s.to_string())).collect();

    let details = client
        .exchange_device_code()
        .map_err(|error| PistonAuthError::Other(error.to_string()))?
        .add_scopes(scopes)
        .request_async(crate::client::oauth_http_client)
        .await
        .map_err(|error| {
            let detail = crate::client::redact_configured_proxy_secrets(&format!("{error:?}"));
            match error {
                RequestTokenError::Request(_) => {
                    PistonAuthError::network(AuthService::Microsoft, AuthPhase::DeviceCode, detail)
                }
                RequestTokenError::ServerResponse(_) => PistonAuthError::unexpected(
                    AuthService::Microsoft,
                    AuthPhase::DeviceCode,
                    None,
                    detail,
                ),
                _ => PistonAuthError::Other(detail),
            }
        })?;

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
        .request_async(crate::client::oauth_http_client, tokio::time::sleep, None)
        .await
}

/// Refresh an expired access token using refresh token
pub async fn refresh_access_token(
    client: &BasicClient,
    refresh_token: String,
) -> std::result::Result<BasicTokenResponse, PistonAuthError> {
    log::info!("[auth] Attempting to refresh Microsoft access token");
    match client
        .exchange_refresh_token(&RefreshToken::new(refresh_token))
        .request_async(crate::client::oauth_http_client)
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
            let redacted_error =
                crate::client::redact_configured_proxy_secrets(&format!("{:?}", e));
            log::error!(
                "[auth] Failed to refresh Microsoft access token: {}",
                redacted_error
            );

            match e {
                RequestTokenError::ServerResponse(err) => {
                    if err.error() == &BasicErrorResponseType::InvalidGrant {
                        return Err(PistonAuthError::SessionExpired);
                    }
                    Err(PistonAuthError::unexpected(
                        AuthService::Microsoft,
                        AuthPhase::TokenRefresh,
                        None,
                        format!("Server reported error: {err:?}"),
                    ))
                }
                RequestTokenError::Request(_) => Err(PistonAuthError::network(
                    AuthService::Microsoft,
                    AuthPhase::TokenRefresh,
                    redacted_error,
                )),
                _ => Err(PistonAuthError::Other(format!(
                    "Failed to refresh access token: {}",
                    redacted_error
                ))),
            }
        }
    }
}

/// Exchange Microsoft access token for Minecraft token
pub async fn exchange_for_minecraft_token(
    microsoft_access_token: &str,
) -> std::result::Result<minecraft_msa_auth::MinecraftAuthenticationResponse, PistonAuthError> {
    // minecraft-msa-auth uses reqwest 0.12, so we use reqwest12 alias
    let client = crate::client::build_configured_reqwest12_client().map_err(|error| {
        PistonAuthError::network(
            AuthService::MinecraftServices,
            AuthPhase::MinecraftTokenExchange,
            crate::client::redact_configured_proxy_secrets(&error.to_string()),
        )
    })?;
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
            let redacted_error =
                crate::client::redact_configured_proxy_secrets(&format!("{:?}", e));
            log::error!(
                "[auth] Failed to exchange for Minecraft token: {}",
                redacted_error
            );
            return Err(match e {
                minecraft_msa_auth::MinecraftAuthorizationError::Reqwest(error) => {
                    let service = error
                        .url()
                        .and_then(|url| url.host_str())
                        .map(|host| {
                            if host.contains("xboxlive.com") {
                                AuthService::XboxLive
                            } else {
                                AuthService::MinecraftServices
                            }
                        })
                        .unwrap_or(AuthService::MinecraftServices);
                    match error.status() {
                        Some(status) => PistonAuthError::from_http_status(
                            service,
                            AuthPhase::MinecraftTokenExchange,
                            status.as_u16(),
                            redacted_error,
                        ),
                        None => PistonAuthError::network(
                            service,
                            AuthPhase::MinecraftTokenExchange,
                            redacted_error,
                        ),
                    }
                }
                minecraft_msa_auth::MinecraftAuthorizationError::AddToFamily => {
                    PistonAuthError::MinorNeedsFamily
                }
                minecraft_msa_auth::MinecraftAuthorizationError::NoXbox => {
                    PistonAuthError::NoXboxProfile
                }
                minecraft_msa_auth::MinecraftAuthorizationError::MissingClaims => {
                    PistonAuthError::unexpected(
                        AuthService::XboxLive,
                        AuthPhase::MinecraftTokenExchange,
                        None,
                        redacted_error,
                    )
                }
            });
        }
    };

    Ok(response)
}

/// Generate a Minecraft-compatible offline UUID for a given username.
/// This matches Prism Launcher and official Minecraft behavior for offline mode.
pub fn generate_offline_uuid(username: &str) -> String {
    let uuid = Uuid::new_v3(
        &Uuid::nil(),
        format!("OfflinePlayer:{}", username).as_bytes(),
    );
    uuid.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_404_is_retryable_and_never_credential_rejection() {
        let error = PistonAuthError::from_http_status(
            AuthService::MinecraftServices,
            AuthPhase::Profile,
            404,
            "not found",
        );

        assert!(error.is_retryable_outage());
        assert_eq!(error.code(), "service_unavailable");
        assert!(!matches!(error, PistonAuthError::Unauthorized { .. }));
    }

    #[test]
    fn only_401_and_403_are_http_credential_rejections() {
        for status in [401, 403] {
            assert!(matches!(
                PistonAuthError::from_http_status(
                    AuthService::MinecraftServices,
                    AuthPhase::Profile,
                    status,
                    "rejected",
                ),
                PistonAuthError::Unauthorized { .. }
            ));
        }
    }

    #[test]
    fn outages_are_offline_fallback_eligible() {
        assert!(PistonAuthError::network(
            AuthService::Microsoft,
            AuthPhase::TokenRefresh,
            "timeout",
        )
        .is_retryable_outage());
        assert!(PistonAuthError::from_http_status(
            AuthService::MinecraftServices,
            AuthPhase::Profile,
            503,
            "unavailable",
        )
        .is_retryable_outage());
        assert!(!PistonAuthError::SessionExpired.is_retryable_outage());
    }
}
