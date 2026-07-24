//! Authentication module for Microsoft OAuth and Minecraft login
//!
//! Handles device-code authentication flow, token management, and account persistence.

pub mod notification_actions;

use anyhow::Result;
use chrono::{Duration, Utc};
use diesel::prelude::*;
use lazy_static::lazy_static;
use oauth2::TokenResponse;
use piston_lib::api::mojang::{get_minecraft_profile, verify_game_ownership, OwnershipStatus};
use piston_lib::auth::{
    device_code_to_details, get_auth_client, get_device_code, poll_for_token, AuthPhase,
    AuthService, PistonAuthError,
};
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use tokio::task;

use crate::models::account::{Account, NewAccount};
use crate::schema::account::dsl::*; // Bring table and column names into scope for queries
use crate::utils::config::{canonical_theme_data_for_theme_id, get_app_config, update_app_config};
use crate::utils::db::get_vesta_conn;

pub const ACCOUNT_TYPE_GUEST: &str = "Guest";
pub const ACCOUNT_TYPE_DEMO: &str = "Demo";
pub const GUEST_UUID: &str = "00000000000000000000000000000000";
pub const DEMO_UUID: &str = "ffffffffffffffffffffffffffffffff";
const PROFILE_CACHE_TTL_SECONDS: i64 = 120;
const AUTH_SERVICE_UNAVAILABLE_NOTIFICATION_KEY: &str = "auth_service_unavailable";

#[derive(Clone)]
struct CachedProfileEntry {
    profile: piston_lib::api::mojang::MinecraftProfile,
    cached_at: chrono::DateTime<Utc>,
}

lazy_static! {
    /// Global cancel channel for aborting authentication
    static ref CANCEL_SENDER: Arc<Mutex<Option<oneshot::Sender<()>>>> = Arc::new(Mutex::new(None));
    static ref PROFILE_CACHE: Arc<tokio::sync::Mutex<HashMap<String, CachedProfileEntry>>> = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    static ref PROFILE_FETCH_LOCKS: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = Arc::new(Mutex::new(HashMap::new()));
}

fn get_profile_fetch_lock(account_uuid: &str) -> Result<Arc<tokio::sync::Mutex<()>>, String> {
    let mut locks = PROFILE_FETCH_LOCKS.lock().map_err(|e| e.to_string())?;
    Ok(locks
        .entry(account_uuid.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone())
}

fn is_profile_cache_fresh(cached_at: chrono::DateTime<Utc>) -> bool {
    let age = Utc::now() - cached_at;
    age < Duration::seconds(PROFILE_CACHE_TTL_SECONDS)
}

fn emit_account_heads_updated(app: &AppHandle, account_uuid: Option<&str>, force: bool) {
    let payload = match account_uuid {
        Some(account_id) => serde_json::json!({ "uuid": account_id, "force": force }),
        None => serde_json::json!({ "force": force }),
    };
    let _ = app.emit("core://account-heads-updated", payload);
}

pub async fn invalidate_account_profile_cache(account_uuid: &str) {
    let normalized_uuid = account_uuid.replace("-", "");
    let mut cache = PROFILE_CACHE.lock().await;
    cache.remove(&normalized_uuid);
}

/// Authentication stage events emitted to UI
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "stage")]
pub enum AuthStage {
    Start,
    AuthCode {
        code: String,
        url: String,
        expires_in: u64,
    },
    Polling,
    Complete {
        user_uuid: String,
        user_username: String,
    },
    Cancelled,
    Error {
        code: String,
        message: String,
        service: Option<String>,
        retryable: bool,
    },
}

#[derive(Debug, Clone)]
pub struct AuthFailure {
    pub code: String,
    pub message: String,
    pub service: Option<String>,
    pub retryable: bool,
    pub status_code: Option<u16>,
}

impl AuthFailure {
    fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "authentication_error".to_string(),
            message: message.into(),
            service: None,
            retryable: false,
            status_code: None,
        }
    }

    fn device_code_expired() -> Self {
        Self {
            code: "device_code_expired".to_string(),
            message: "The Microsoft sign-in code expired. Request a new code and try again."
                .to_string(),
            service: Some(AuthService::Microsoft.as_str().to_string()),
            retryable: true,
            status_code: None,
        }
    }

    pub fn allows_offline_fallback(&self) -> bool {
        self.retryable
            && matches!(
                self.code.as_str(),
                "network_unavailable" | "service_unavailable"
            )
    }

    fn is_session_expired(&self) -> bool {
        self.code == "session_expired" || self.code == "authentication_rejected"
    }

    fn as_stage(&self) -> AuthStage {
        AuthStage::Error {
            code: self.code.clone(),
            message: self.message.clone(),
            service: self.service.clone(),
            retryable: self.retryable,
        }
    }
}

impl From<PistonAuthError> for AuthFailure {
    fn from(error: PistonAuthError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
            service: error.service().map(|service| service.as_str().to_string()),
            retryable: error.is_retryable_outage(),
            status_code: error.status_code(),
        }
    }
}

pub fn is_previously_authenticated_account(candidate: &Account) -> bool {
    candidate.account_type.eq_ignore_ascii_case("Microsoft")
        && !candidate.uuid.trim().is_empty()
        && !candidate.username.trim().is_empty()
}

fn has_previously_authenticated_account() -> bool {
    let Ok(mut conn) = get_vesta_conn() else {
        return false;
    };
    account
        .load::<Account>(&mut conn)
        .map(|accounts| accounts.iter().any(is_previously_authenticated_account))
        .unwrap_or(false)
}

fn should_publish_auth_service_unavailable(
    setup_completed: bool,
    has_authenticated_account: bool,
    already_exists: bool,
    failure: &AuthFailure,
) -> bool {
    setup_completed
        && has_authenticated_account
        && !already_exists
        && failure.allows_offline_fallback()
}

pub fn publish_auth_service_unavailable(app_handle: &AppHandle, failure: &AuthFailure) {
    let Ok(config) = get_app_config() else {
        return;
    };
    let already_exists = matches!(
        crate::notifications::store::NotificationStore::get_by_client_key(
            AUTH_SERVICE_UNAVAILABLE_NOTIFICATION_KEY
        ),
        Ok(Some(_))
    );
    if !should_publish_auth_service_unavailable(
        config.setup_completed,
        has_previously_authenticated_account(),
        already_exists,
        failure,
    ) {
        return;
    }
    let Some(manager) =
        app_handle.try_state::<crate::notifications::manager::NotificationManager>()
    else {
        return;
    };

    let _ = manager.create(crate::notifications::models::CreateNotificationInput {
        client_key: Some(AUTH_SERVICE_UNAVAILABLE_NOTIFICATION_KEY.to_string()),
        title: Some("Minecraft Authentication Unavailable".to_string()),
        description: Some(
            "Vesta cannot reach Minecraft authentication services. Previously authenticated accounts can still launch offline."
                .to_string(),
        ),
        severity: Some("warning".to_string()),
        notification_type: Some(crate::notifications::models::NotificationType::Patient),
        dismissible: Some(true),
        persist: Some(true),
        silent: Some(false),
        actions: None,
        progress: None,
        current_step: None,
        total_steps: None,
        metadata: failure.status_code.map(|status| {
            serde_json::json!({
                "service": failure.service.clone(),
                "status": status,
            })
            .to_string()
        }),
        show_on_completion: None,
    });
}

fn clear_auth_service_unavailable(app_handle: &AppHandle) {
    if let Some(manager) =
        app_handle.try_state::<crate::notifications::manager::NotificationManager>()
    {
        let _ = manager.delete(AUTH_SERVICE_UNAVAILABLE_NOTIFICATION_KEY.to_string());
    }
}

fn emit_auth_failure(app_handle: &AppHandle, failure: &AuthFailure) {
    publish_auth_service_unavailable(app_handle, failure);
    let _ = app_handle.emit("vesta://auth", failure.as_stage());
}

/// Start Microsoft OAuth device-code login flow
#[tauri::command]
pub async fn start_login(app: AppHandle) -> Result<(), String> {
    // Create cancel channel
    let (tx, rx) = oneshot::channel::<()>();
    {
        let mut sender = CANCEL_SENDER.lock().unwrap();
        *sender = Some(tx);
    }

    // Emit start event
    app.emit("vesta://auth", AuthStage::Start)
        .map_err(|e| e.to_string())?;

    // Get OAuth client
    let client = match get_auth_client() {
        Ok(client) => client,
        Err(error) => {
            let failure = AuthFailure::internal(format!(
                "Failed to initialize Microsoft authentication: {error}"
            ));
            emit_auth_failure(&app, &failure);
            return Ok(());
        }
    };

    // Request device code
    let device_code_response = match get_device_code(&client).await {
        Ok(response) => response,
        Err(error) => {
            let failure = AuthFailure::from(error);
            emit_auth_failure(&app, &failure);
            return Ok(());
        }
    };

    let details = device_code_to_details(&device_code_response);

    // Emit auth code for UI to display
    app.emit(
        "vesta://auth",
        AuthStage::AuthCode {
            code: details.user_code.clone(),
            url: details.verification_uri.clone(),
            expires_in: details.expires_in,
        },
    )
    .map_err(|e| e.to_string())?;

    // Poll for token completion
    app.emit("vesta://auth", AuthStage::Polling)
        .map_err(|e| e.to_string())?;

    // Spawn polling task
    let app_clone = app.clone();
    tokio::spawn(async move {
        let result = poll_with_cancellation(client, device_code_response, rx).await;

        match result {
            Ok(Some(token_response)) => {
                // Exchange for Minecraft token and save account
                match process_login_completion(app_clone.clone(), token_response).await {
                    Ok((uuid_res, username_res)) => {
                        let _ = app_clone.emit(
                            "vesta://auth",
                            AuthStage::Complete {
                                user_uuid: uuid_res.clone(),
                                user_username: username_res.clone(),
                            },
                        );
                    }
                    Err(e) => {
                        emit_auth_failure(&app_clone, &e);
                    }
                }
            }
            Ok(None) => {
                // Cancelled
                let _ = app_clone.emit("vesta://auth", AuthStage::Cancelled);
            }
            Err(e) => {
                log::error!("[auth] Poll for token failed: {}", e.message);
                emit_auth_failure(&app_clone, &e);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn start_guest_session(app_handle: AppHandle) -> Result<(), String> {
    log::info!("[auth] Starting guest session...");

    let app_data_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
    let marker_path = app_data_dir.join(".guest_mode");

    // Create marker file
    let marker_clone = marker_path.clone();
    task::spawn_blocking(move || {
        std::fs::File::create(&marker_clone)
            .map_err(|e| format!("Failed to create guest marker: {}", e))
    })
    .await
    .map_err(|e| format!("spawn_blocking panicked: {}", e))??;

    // Use the constant zeros for Guest UUID to ensure consistent detection
    let guest_uuid = GUEST_UUID.to_string();
    let username_v = "LocalGuest";

    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    // Create Guest Account
    let mut new_acct = NewAccount::default();
    new_acct.uuid = guest_uuid.clone();
    new_acct.username = username_v.to_string();
    new_acct.display_name = Some("Local Guest".to_string());
    new_acct.is_active = true;
    new_acct.account_type = ACCOUNT_TYPE_GUEST.to_string();

    // Deactivate others
    diesel::update(account)
        .set(is_active.eq(false))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Upsert guest (if they somehow click it twice)
    diesel::insert_into(account)
        .values(&new_acct)
        .on_conflict(uuid)
        .do_update()
        .set((is_active.eq(true), account_type.eq(ACCOUNT_TYPE_GUEST)))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Set as active account in config
    let mut config = get_app_config().map_err(|e| e.to_string())?;
    config.active_account_uuid = Some(guest_uuid.clone());
    update_app_config(&config).map_err(|e| e.to_string())?;

    // Emit config update event so UI knows active account changed
    let _ = app_handle.emit(
        "config-updated",
        serde_json::json!({
            "field": "active_account_uuid",
            "value": guest_uuid
        }),
    );

    // Notify UI
    emit_account_heads_updated(&app_handle, Some(&guest_uuid), false);

    // Create persistent warning notification
    let manager = app_handle.state::<crate::notifications::manager::NotificationManager>();

    use crate::notifications::models::{
        CreateNotificationInput, NotificationAction, NotificationType,
    };

    let actions = vec![NotificationAction {
        action_id: "logout_guest".to_string(),
        label: "Sign In".to_string(),
        action_type: "primary".to_string(),
        payload: None,
    }];

    if let Err(e) = manager.create(CreateNotificationInput {
        client_key: Some("guest_mode_warning".to_string()),
        title: Some("Guest Mode Active".to_string()),
        description: Some("You are in guest mode. Changes will not be saved, and certain features are restricted.".to_string()),
        severity: Some("info".to_string()),
        notification_type: Some(NotificationType::Patient),
        dismissible: Some(false),
        persist: Some(false), // Re-created on app launch via setup.rs logic if needed
        silent: Some(false),  // Always show toast
        actions: Some(serde_json::to_string(&actions).unwrap_or_default()),
        progress: None,
        current_step: None,
        total_steps: None,
        metadata: None,
        show_on_completion: None,
    }) {
        log::error!("Failed to create guest-mode notification: {}", e);
    }

    Ok(())
}

#[tauri::command]
pub async fn start_demo_session(app_handle: AppHandle) -> Result<(), String> {
    log::info!("[auth] Starting demo session...");

    let demo_uuid_v = DEMO_UUID.to_string();
    let username_v = "DemoUser";

    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    // Create Demo Account
    let mut new_acct = NewAccount::default();
    new_acct.uuid = demo_uuid_v.clone();
    new_acct.username = username_v.to_string();
    new_acct.display_name = Some("Temporal Demo Account".to_string());
    new_acct.is_active = true;
    new_acct.account_type = ACCOUNT_TYPE_DEMO.to_string();

    // Give the demo account a random default skin
    let default_skins = piston_lib::api::minecraft_skins::get_default_skins();
    if !default_skins.is_empty() {
        let mut rng = rand::rng();
        if let Some(random_skin) = default_skins.choose(&mut rng) {
            let preferred_variant = piston_lib::models::common::MinecraftSkinVariant::Classic;
            new_acct.skin_url = Some(random_skin.get_texture(preferred_variant).to_string());
            new_acct.skin_variant = match random_skin.get_variant(preferred_variant) {
                piston_lib::models::common::MinecraftSkinVariant::Slim => "slim".to_string(),
                _ => "classic".to_string(),
            };
            log::info!(
                "[auth] Assigned random default skin to demo account: {:?}",
                random_skin.name
            );
        }
    }

    // Deactivate others
    diesel::update(account)
        .set(is_active.eq(false))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Upsert demo
    diesel::insert_into(account)
        .values(&new_acct)
        .on_conflict(uuid)
        .do_update()
        .set((is_active.eq(true), account_type.eq(ACCOUNT_TYPE_DEMO)))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Set as active account in config
    let mut config = get_app_config().map_err(|e| e.to_string())?;
    config.active_account_uuid = Some(demo_uuid_v.clone());
    update_app_config(&config).map_err(|e| e.to_string())?;

    // Emit config update event
    let _ = app_handle.emit(
        "config-updated",
        serde_json::json!({
            "field": "active_account_uuid",
            "value": demo_uuid_v
        }),
    );

    // Notify UI
    emit_account_heads_updated(&app_handle, Some(&demo_uuid_v), false);

    Ok(())
}

/// Cancel ongoing authentication
#[tauri::command]
pub fn cancel_login() -> Result<(), String> {
    let mut sender = CANCEL_SENDER.lock().unwrap();
    if let Some(tx) = sender.take() {
        let _ = tx.send(());
    }
    Ok(())
}

/// Poll for token with cancellation support
async fn poll_with_cancellation(
    client: oauth2::basic::BasicClient,
    device_code: oauth2::StandardDeviceAuthorizationResponse,
    mut cancel_rx: oneshot::Receiver<()>,
) -> std::result::Result<Option<oauth2::basic::BasicTokenResponse>, AuthFailure> {
    let interval = std::time::Duration::from_secs(device_code.interval().as_secs());

    loop {
        // Check for cancellation
        if cancel_rx.try_recv().is_ok() {
            return Ok(None);
        }

        match poll_for_token(&client, device_code.clone()).await {
            Ok(token) => return Ok(Some(token)),
            Err(oauth2::RequestTokenError::ServerResponse(resp)) => {
                match resp.error() {
                    oauth2::DeviceCodeErrorResponseType::AuthorizationPending => {
                        // Continue polling
                        tokio::time::sleep(interval).await;
                    }
                    oauth2::DeviceCodeErrorResponseType::SlowDown => {
                        // Increase interval
                        tokio::time::sleep(interval * 2).await;
                    }
                    oauth2::DeviceCodeErrorResponseType::ExpiredToken => {
                        return Err(AuthFailure::device_code_expired());
                    }
                    _ => {
                        return Err(AuthFailure {
                            code: "authentication_rejected".to_string(),
                            message: "Microsoft authentication was not approved.".to_string(),
                            service: Some(AuthService::Microsoft.as_str().to_string()),
                            retryable: false,
                            status_code: None,
                        });
                    }
                }
            }
            Err(e) => {
                let detail = piston_lib::client::redact_configured_proxy_secrets(&format!("{e:?}"));
                let error = match e {
                    oauth2::RequestTokenError::Request(_) => PistonAuthError::network(
                        AuthService::Microsoft,
                        AuthPhase::TokenPolling,
                        detail,
                    ),
                    oauth2::RequestTokenError::ServerResponse(_) => PistonAuthError::unexpected(
                        AuthService::Microsoft,
                        AuthPhase::TokenPolling,
                        None,
                        detail,
                    ),
                    _ => PistonAuthError::Other(detail),
                };
                return Err(error.into());
            }
        }
    }
}

/// Process successful login: exchange tokens and save account
async fn process_login_completion(
    app_handle: AppHandle,
    token_response: oauth2::basic::BasicTokenResponse,
) -> std::result::Result<(String, String), AuthFailure> {
    let microsoft_access_token = token_response.access_token().secret();
    let refresh_token_val = token_response
        .refresh_token()
        .ok_or_else(|| AuthFailure::internal("Microsoft did not provide a refresh token."))?
        .secret()
        .clone();

    let expires_in_secs = token_response
        .expires_in()
        .unwrap_or(std::time::Duration::from_secs(3600))
        .as_secs();

    let token_expires_at_val = Utc::now() + Duration::seconds(expires_in_secs as i64);

    // Exchange for Minecraft token
    let minecraft_token = piston_lib::auth::exchange_for_minecraft_token(microsoft_access_token)
        .await
        .map_err(AuthFailure::from)?;

    let minecraft_access_token = minecraft_token.access_token().clone();
    let minecraft_access_token_str = minecraft_access_token.clone().into_inner();

    match verify_game_ownership(&minecraft_access_token_str)
        .await
        .map_err(AuthFailure::from)?
    {
        OwnershipStatus::Owned => {}
        OwnershipStatus::NotOwned => {
            return Err(AuthFailure::from(PistonAuthError::NoMinecraftEntitlement))
        }
    }

    // Fetch Minecraft profile
    let profile = get_minecraft_profile(&minecraft_access_token_str)
        .await
        .map_err(AuthFailure::from)?;

    // Normalize UUID
    let normalized_uuid = profile.id.replace("-", "");

    let active_skin = profile
        .skins
        .iter()
        .find(|skin| skin.state.eq_ignore_ascii_case("ACTIVE"))
        .or_else(|| profile.skins.first());
    let skin_url_val = active_skin.map(|s| s.url.clone());
    let skin_variant_val = active_skin
        .map(|s| {
            if s.variant.eq_ignore_ascii_case("slim") {
                "slim"
            } else {
                "classic"
            }
        })
        .unwrap_or("classic")
        .to_string();
    let cape_url_val = profile.capes.first().map(|c| c.url.clone());

    log::info!(
        "[auth] Completed token exchange and profile fetch for user {} ({})",
        profile.name,
        normalized_uuid
    );

    // Save to database
    let mut conn = get_vesta_conn()
        .map_err(|error| AuthFailure::internal(format!("Failed to get database: {error}")))?;

    // Check if account already exists
    let existing_account = account
        .filter(uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .optional()
        .map_err(|error| {
            AuthFailure::internal(format!("Failed to check for an existing account: {error}"))
        })?;

    let now_str = Utc::now().to_rfc3339();
    let current_config = get_app_config().unwrap_or_default();
    let resolved_theme_data = current_config
        .theme_data
        .clone()
        .unwrap_or_else(|| canonical_theme_data_for_theme_id(&current_config.theme_id));

    // Set all other accounts to inactive
    diesel::update(account)
        .set(is_active.eq(false))
        .execute(&mut conn)
        .map_err(|error| {
            AuthFailure::internal(format!("Failed to deactivate other accounts: {error}"))
        })?;

    if existing_account.is_none() {
        // Insert new account
        log::info!("[auth] Inserting new account for uuid: {}", normalized_uuid);

        let mut new_account = NewAccount::default();
        new_account.uuid = normalized_uuid.clone();
        new_account.username = profile.name.clone();
        new_account.display_name = Some(profile.name.clone());
        new_account.access_token = Some(minecraft_access_token.into_inner());
        new_account.refresh_token = Some(refresh_token_val);
        new_account.token_expires_at = Some(token_expires_at_val.to_rfc3339());
        new_account.is_active = true;
        new_account.skin_url = skin_url_val;
        new_account.cape_url = cape_url_val;
        new_account.skin_variant = skin_variant_val.clone();
        new_account.created_at = Some(now_str.clone());
        new_account.updated_at = Some(now_str.clone());
        new_account.theme_id = Some(current_config.theme_id);
        new_account.theme_data = Some(resolved_theme_data.clone());
        new_account.theme_window_effect = current_config.theme_window_effect;
        new_account.theme_background_opacity = current_config.theme_background_opacity;
        new_account.account_type = "Microsoft".to_string();

        diesel::insert_into(account)
            .values(&new_account)
            .execute(&mut conn)
            .map_err(|error| AuthFailure::internal(format!("Failed to insert account: {error}")))?;

        log::info!("[auth] Account inserted successfully");
    } else {
        let existing_skin_url = existing_account
            .as_ref()
            .and_then(|acct| acct.skin_url.as_deref());
        let skin_url_changed = existing_skin_url != skin_url_val.as_deref();
        let next_skin_data = if skin_url_changed {
            None
        } else {
            existing_account.and_then(|acct| acct.skin_data)
        };

        // Update existing account
        diesel::update(account.filter(uuid.eq(&normalized_uuid)))
            .set((
                username.eq(&profile.name),
                display_name.eq(&profile.name),
                access_token.eq(Some(minecraft_access_token.into_inner())),
                refresh_token.eq(Some(refresh_token_val)),
                token_expires_at.eq(Some(token_expires_at_val.to_rfc3339())),
                skin_url.eq(skin_url_val),
                skin_data.eq(next_skin_data),
                skin_variant.eq(skin_variant_val.clone()),
                cape_url.eq(cape_url_val),
                is_active.eq(true),
                is_expired.eq(false),
                updated_at.eq(Some(now_str.clone())),
                theme_id.eq(Some(current_config.theme_id)),
                theme_data.eq(Some(resolved_theme_data.clone())),
                theme_window_effect.eq(current_config.theme_window_effect),
                theme_background_opacity.eq(current_config.theme_background_opacity),
            ))
            .execute(&mut conn)
            .map_err(|error| AuthFailure::internal(format!("Failed to update account: {error}")))?;

        log::info!("[auth] Account updated successfully");
    }

    invalidate_account_profile_cache(&normalized_uuid).await;

    // Update active account in config
    let mut config = get_app_config()
        .map_err(|error| AuthFailure::internal(format!("Failed to get app config: {error}")))?;
    config.active_account_uuid = Some(normalized_uuid.clone());
    update_app_config(&config)
        .map_err(|error| AuthFailure::internal(format!("Failed to update app config: {error}")))?;

    // Remote authentication and persistence have succeeded. Guest cleanup is
    // deliberately last so a failed first login never destroys setup state.
    if let Ok(dir) = crate::utils::db_manager::get_app_config_dir() {
        let marker_path = dir.join(".guest_mode");
        if marker_path.exists() {
            log::info!("[auth] Cleaning up guest session after successful authentication...");
            let marker_clone = marker_path.clone();
            let _ = task::spawn_blocking(move || std::fs::remove_file(marker_clone)).await;
            if let Some(nm) =
                app_handle.try_state::<crate::notifications::manager::NotificationManager>()
            {
                let _ = nm.delete("guest_mode_warning".to_string());
            }
            if let Ok(mut connection) = get_vesta_conn() {
                let _ =
                    diesel::delete(account.filter(uuid.eq(GUEST_UUID))).execute(&mut connection);
            }
        }
    }

    // Emit config update event so UI knows active account changed
    let _ = app_handle.emit(
        "config-updated",
        serde_json::json!({
            "field": "active_account_uuid",
            "value": normalized_uuid
        }),
    );

    // Notify UI that accounts might have changed (added/updated). Force head
    // refresh because the same UUID can now point at a different skin URL.
    emit_account_heads_updated(&app_handle, Some(&normalized_uuid), true);
    clear_auth_service_unavailable(&app_handle);

    Ok((normalized_uuid, profile.name))
}

/// Get all accounts from database
#[tauri::command]
pub fn get_accounts() -> Result<Vec<Account>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    let accounts = account
        .load::<Account>(&mut conn)
        .map_err(|e| e.to_string())?;

    Ok(accounts)
}

/// Get active account (first active one found)
#[tauri::command]
pub fn get_active_account() -> Result<Option<Account>, String> {
    let config = get_app_config().map_err(|e| e.to_string())?;

    if let Some(target_uuid) = config.active_account_uuid {
        let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

        // Normalize UUID
        let target_uuid = target_uuid.replace("-", "");

        let acct = account
            .filter(uuid.eq(target_uuid))
            .first::<crate::models::account::Account>(&mut conn)
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(acct)
    } else {
        Ok(None)
    }
}

fn mark_account_expired(app_handle: &AppHandle, target_uuid: &str) {
    if let Ok(mut conn) = get_vesta_conn() {
        let _ = diesel::update(account.filter(uuid.eq(target_uuid)))
            .set(is_expired.eq(true))
            .execute(&mut conn);
        let _ = app_handle.emit("core://accounts-changed", ());
    }
}

/// Ensure account tokens are valid and refresh if they are near expiry
pub async fn ensure_account_tokens_valid(
    app_handle: tauri::AppHandle,
    target_uuid: String,
) -> std::result::Result<Account, AuthFailure> {
    // Normalize UUID
    let target_uuid = target_uuid.replace("-", "");

    // Load account
    let mut conn = get_vesta_conn()
        .map_err(|error| AuthFailure::internal(format!("Failed to get database: {error}")))?;
    let acct = account
        .filter(uuid.eq(&target_uuid))
        .first::<crate::models::account::Account>(&mut conn)
        .optional()
        .map_err(|error| AuthFailure::internal(format!("Failed to load account: {error}")))?;

    let acct = match acct {
        Some(a) => a,
        None => {
            log::warn!(
                "[auth] Account {} not found in database during token validation.",
                target_uuid
            );
            // If this was the active account, try to repair it
            let config = get_app_config().map_err(|error| {
                AuthFailure::internal(format!("Failed to get app config: {error}"))
            })?;
            if config.active_account_uuid == Some(target_uuid) {
                repair_active_account(app_handle.clone()).map_err(AuthFailure::internal)?;
            }
            return Err(AuthFailure::internal("Account not found"));
        }
    };

    if !is_previously_authenticated_account(&acct) {
        return Err(AuthFailure {
            code: "login_required".to_string(),
            message: "Sign in with a Microsoft account before launching Minecraft.".to_string(),
            service: None,
            retryable: false,
            status_code: None,
        });
    }

    // Check expiry; if missing, assume token is expired and refresh
    let now = Utc::now();
    let needs_refresh = acct.access_token.as_deref().is_none_or(str::is_empty)
        || match &acct.token_expires_at {
            Some(ts) => match chrono::DateTime::parse_from_rfc3339(ts) {
                Ok(datetime) => {
                    let dt_utc = datetime.with_timezone(&Utc);
                    // Refresh if expiring within 60 seconds
                    let margin = Duration::seconds(60);
                    dt_utc <= now + margin
                }
                Err(_) => true,
            },
            None => true,
        };

    if needs_refresh {
        log::info!(
            "[auth] Token for account {} is expired or expiring soon; refreshing",
            target_uuid
        );
        match refresh_account_tokens_internal(app_handle, target_uuid.clone()).await {
            Ok(refreshed_account) => {
                log::info!(
                    "[auth] Token refresh successful for account {}",
                    target_uuid
                );
                Ok(refreshed_account)
            }
            Err(e) => {
                log::error!(
                    "[auth] Token refresh failed for account {}: {}",
                    target_uuid,
                    e.message
                );
                Err(e)
            }
        }
    } else {
        log::debug!("[auth] Token still valid for account {}", target_uuid);
        Ok(acct)
    }
}

/// Refresh the tokens for the given account
#[tauri::command]
pub async fn refresh_account_tokens(
    app_handle: tauri::AppHandle,
    target_uuid: String,
) -> Result<(), String> {
    refresh_account_tokens_internal(app_handle, target_uuid)
        .await
        .map(|_| ())
        .map_err(|failure| failure.message)
}

async fn refresh_account_tokens_internal(
    app_handle: tauri::AppHandle,
    target_uuid: String,
) -> std::result::Result<Account, AuthFailure> {
    // Normalize UUID
    let target_uuid = target_uuid.replace("-", "");

    log::info!("[auth] Refresh requested for account: {}", target_uuid);

    // Load account to get refresh token
    let mut conn = get_vesta_conn()
        .map_err(|error| AuthFailure::internal(format!("Failed to get database: {error}")))?;
    let acct = account
        .filter(uuid.eq(&target_uuid))
        .first::<crate::models::account::Account>(&mut conn)
        .optional()
        .map_err(|error| AuthFailure::internal(format!("Failed to load account: {error}")))?;

    let acct = match acct {
        Some(a) => a,
        None => {
            log::error!("[auth] No account found to refresh: {}", target_uuid);
            // If this was the active account, try to repair it
            let config = get_app_config().map_err(|error| {
                AuthFailure::internal(format!("Failed to get app config: {error}"))
            })?;
            if config.active_account_uuid == Some(target_uuid) {
                repair_active_account(app_handle.clone()).map_err(AuthFailure::internal)?;
            }
            return Err(AuthFailure::internal("Account not found"));
        }
    };

    let refresh_token_val = match acct.refresh_token.clone() {
        Some(rt) => rt,
        None => {
            log::error!(
                "[auth] No refresh token present for account: {}",
                target_uuid
            );
            return Err(AuthFailure {
                code: "credentials_missing".to_string(),
                message: "This account has no refresh token. Sign in again.".to_string(),
                service: Some(AuthService::Microsoft.as_str().to_string()),
                retryable: false,
                status_code: None,
            });
        }
    };

    // Get auth client
    let client = match get_auth_client() {
        Ok(c) => c,
        Err(e) => {
            log::error!("[auth] Failed to create auth client: {}", e);
            return Err(AuthFailure::internal(format!(
                "Failed to create auth client: {e}"
            )));
        }
    };

    log::info!("[auth] Attempting refresh for account: {}", target_uuid);

    // Attempt refresh
    let token_response = match piston_lib::auth::refresh_access_token(
        &client,
        refresh_token_val.clone(),
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            log::error!("[auth] Refresh failed for account {}: {}", target_uuid, e);
            let failure = AuthFailure::from(e);

            // If the session expired, mark it in the database
            if failure.is_session_expired() {
                log::warn!("[auth] Refresh token for {} is revoked or expired. Marking account as expired.", target_uuid);
                mark_account_expired(&app_handle, &target_uuid);
            }

            publish_auth_service_unavailable(&app_handle, &failure);
            return Err(failure);
        }
    };

    // Exchange for Minecraft token
    let ms_access_token = token_response.access_token().secret().clone();
    let ms_refresh_token = token_response.refresh_token().map(|r| r.secret().clone());

    let minecraft_response =
        match piston_lib::auth::exchange_for_minecraft_token(&ms_access_token).await {
            Ok(resp) => resp,
            Err(e) => {
                log::error!(
                    "[auth] Failed to exchange MS token for Minecraft token for {}: {}",
                    target_uuid,
                    e
                );

                let failure = AuthFailure::from(e);
                if failure.is_session_expired() {
                    mark_account_expired(&app_handle, &target_uuid);
                }
                publish_auth_service_unavailable(&app_handle, &failure);
                return Err(failure);
            }
        };

    let mc_access_token = minecraft_response.access_token().clone().into_inner();
    match verify_game_ownership(&mc_access_token)
        .await
        .map_err(AuthFailure::from)
    {
        Ok(OwnershipStatus::Owned) => {}
        Ok(OwnershipStatus::NotOwned) => {
            return Err(AuthFailure::from(PistonAuthError::NoMinecraftEntitlement))
        }
        Err(failure) => {
            if failure.is_session_expired() {
                mark_account_expired(&app_handle, &target_uuid);
            }
            publish_auth_service_unavailable(&app_handle, &failure);
            return Err(failure);
        }
    }
    let expires_in_secs = {
        let secs: u64 = minecraft_response.expires_in() as u64;
        if secs == 0 {
            3600
        } else {
            secs
        }
    };

    let token_expires_at_val =
        (Utc::now() + Duration::seconds(expires_in_secs as i64)).to_rfc3339();
    let now_str = Utc::now().to_rfc3339();

    // Save to DB
    let next_refresh_token = ms_refresh_token.unwrap_or(refresh_token_val);
    let mut conn = get_vesta_conn()
        .map_err(|error| AuthFailure::internal(format!("Failed to get database: {error}")))?;

    diesel::update(account.filter(uuid.eq(&target_uuid)))
        .set((
            access_token.eq(Some(mc_access_token)),
            refresh_token.eq(Some(next_refresh_token)),
            token_expires_at.eq(Some(token_expires_at_val)),
            updated_at.eq(Some(now_str)),
            is_expired.eq(false),
        ))
        .execute(&mut conn)
        .map_err(|error| {
            AuthFailure::internal(format!("Failed to update account in DB: {error}"))
        })?;

    let refreshed_account = account
        .filter(uuid.eq(&target_uuid))
        .first::<Account>(&mut conn)
        .map_err(|error| {
            AuthFailure::internal(format!("Failed to reload refreshed account: {error}"))
        })?;

    log::info!(
        "[auth] Successfully refreshed tokens for account: {}",
        target_uuid
    );
    let _ = app_handle.emit("core://accounts-changed", ());
    clear_auth_service_unavailable(&app_handle);
    Ok(refreshed_account)
}

/// Set active account by UUID
#[tauri::command]
pub fn set_active_account(app_handle: AppHandle, target_uuid: String) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    // Normalize UUID
    let target_uuid = target_uuid.replace("-", "");

    // Fetch the target account to get its theme settings
    let target_account = account
        .filter(uuid.eq(&target_uuid))
        .first::<crate::models::account::Account>(&mut conn)
        .map_err(|e| format!("Failed to find account: {}", e))?;

    // Deactivate all accounts
    diesel::update(account)
        .set(is_active.eq(false))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Activate target
    diesel::update(account.filter(uuid.eq(&target_uuid)))
        .set(is_active.eq(true))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Update config
    let mut config = get_app_config().map_err(|e| e.to_string())?;
    config.active_account_uuid = Some(target_uuid.clone());

    // Apply account theme settings to global config, falling back to canonical payloads.
    let mut updates = std::collections::HashMap::new();

    let next_theme_id = target_account
        .theme_id
        .clone()
        .unwrap_or_else(|| config.theme_id.clone());
    if config.theme_id != next_theme_id {
        config.theme_id = next_theme_id.clone();
        updates.insert(
            "theme_id".to_string(),
            serde_json::Value::String(next_theme_id.clone()),
        );
    }

    let next_theme_data = target_account
        .theme_data
        .clone()
        .unwrap_or_else(|| canonical_theme_data_for_theme_id(next_theme_id.as_str()));
    if config.theme_data.as_deref() != Some(next_theme_data.as_str()) {
        config.theme_data = Some(next_theme_data.clone());
        updates.insert(
            "theme_data".to_string(),
            serde_json::Value::String(next_theme_data),
        );
    }

    if config.theme_window_effect != target_account.theme_window_effect {
        config.theme_window_effect = target_account.theme_window_effect.clone();
        let value = target_account
            .theme_window_effect
            .clone()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null);
        updates.insert("theme_window_effect".to_string(), value);
    }

    if config.theme_background_opacity != target_account.theme_background_opacity {
        config.theme_background_opacity = target_account.theme_background_opacity;
        let value = target_account
            .theme_background_opacity
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null);
        updates.insert("theme_background_opacity".to_string(), value);
    }

    update_app_config(&config).map_err(|e| e.to_string())?;

    // Emit events for each updated field so the UI updates
    for (field_name, value) in updates {
        let event_payload = serde_json::json!({
            "field": field_name,
            "value": value,
        });
        let _ = app_handle.emit("config-updated", event_payload);
    }

    // Also emit the active account change
    let _ = app_handle.emit(
        "config-updated",
        serde_json::json!({
            "field": "active_account_uuid",
            "value": &target_uuid
        }),
    );

    // Sync profile data on account change to ensure skins/capes stay up to date
    if let Some(task_manager) = app_handle.try_state::<crate::tasks::manager::TaskManager>() {
        let _ = task_manager.submit(Box::new(
            crate::tasks::sync_profiles::SyncAccountProfilesTask::new(),
        ));
    }

    Ok(())
}

/// Remove account by UUID
#[tauri::command]
pub fn remove_account(target_uuid: String) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    // Normalize UUID
    let target_uuid = target_uuid.replace("-", "");

    diesel::delete(account.filter(uuid.eq(target_uuid)))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get path to cached player head image, downloading if necessary
#[tauri::command]
pub async fn get_account_profile(
    account_uuid: String,
) -> Result<piston_lib::api::mojang::MinecraftProfile, String> {
    fetch_account_profile(account_uuid)
        .await
        .map_err(|failure| failure.message)
}

pub async fn fetch_account_profile(
    account_uuid: String,
) -> std::result::Result<piston_lib::api::mojang::MinecraftProfile, AuthFailure> {
    let normalized_uuid = account_uuid.replace("-", "");

    {
        let cache = PROFILE_CACHE.lock().await;
        if let Some(entry) = cache.get(&normalized_uuid) {
            if is_profile_cache_fresh(entry.cached_at) {
                return Ok(entry.profile.clone());
            }
        }
    }

    let fetch_lock = get_profile_fetch_lock(&normalized_uuid).map_err(AuthFailure::internal)?;
    let _fetch_guard = fetch_lock.lock().await;

    {
        let cache = PROFILE_CACHE.lock().await;
        if let Some(entry) = cache.get(&normalized_uuid) {
            if is_profile_cache_fresh(entry.cached_at) {
                return Ok(entry.profile.clone());
            }
        }
    }

    let account_model = {
        use crate::schema::account::dsl::*;
        let mut conn = get_vesta_conn()
            .map_err(|error| AuthFailure::internal(format!("Failed to get database: {error}")))?;
        account
            .filter(uuid.eq(&normalized_uuid))
            .first::<crate::models::account::Account>(&mut conn)
            .map_err(|error| AuthFailure::internal(format!("Failed to load account: {error}")))?
    };

    if account_model.account_type == ACCOUNT_TYPE_GUEST {
        return Err(AuthFailure::internal(
            "Guest accounts do not have a Minecraft profile",
        ));
    }

    let token = account_model.access_token.ok_or_else(|| AuthFailure {
        code: "credentials_missing".to_string(),
        message: "This account has no Minecraft access token. Sign in again.".to_string(),
        service: Some(AuthService::MinecraftServices.as_str().to_string()),
        retryable: false,
        status_code: None,
    })?;

    let profile = match piston_lib::api::mojang::get_minecraft_profile(&token).await {
        Ok(p) => p,
        Err(e) => {
            // Log full error (includes HTTP status and body from Mojang client)
            log::warn!(
                "Failed to get Minecraft profile for account {}: {}",
                account_model.uuid,
                e
            );

            // Helpful debug info without leaking tokens
            if account_model.refresh_token.is_some() {
                log::debug!(
                    "Account {} has a refresh token available",
                    account_model.uuid
                );
            } else {
                log::debug!("Account {} has no refresh token", account_model.uuid);
            }

            return Err(AuthFailure::from(e));
        }
    };

    {
        let mut cache = PROFILE_CACHE.lock().await;
        cache.insert(
            normalized_uuid,
            CachedProfileEntry {
                profile: profile.clone(),
                cached_at: Utc::now(),
            },
        );
    }

    Ok(profile)
}

/// Get path to cached player head image, downloading if necessary
#[tauri::command]
pub async fn get_player_head_path(
    app: AppHandle,
    player_uuid: String,
    force_download: bool,
) -> Result<String, String> {
    // Normalize UUID (remove dashes)
    let normalized_uuid = player_uuid.replace("-", "");

    // Look for account texture URL from local DB first to avoid a profile API call.
    let known_url = {
        use crate::schema::account::dsl::*;
        let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
        account
            .filter(uuid.eq(&normalized_uuid))
            .first::<crate::models::account::Account>(&mut conn)
            .ok()
            .and_then(|acct| acct.skin_url)
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("player_heads");

    let image_filename = match known_url.as_deref() {
        Some(texture_url) if !texture_url.is_empty() => {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(texture_url.as_bytes());
            let hash = hex::encode(hasher.finalize());
            format!("{}-{}.png", normalized_uuid, &hash[..16])
        }
        _ => format!("{}.png", normalized_uuid),
    };

    let image_path = cache_dir.join(image_filename);

    let path = piston_lib::api::player::download_player_head(
        &normalized_uuid,
        known_url,
        image_path.clone(),
        128,
        true,
        force_download,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

/// Pre-download all account head images on startup
#[tauri::command]
pub async fn preload_account_heads(app: AppHandle) -> Result<(), String> {
    let accounts = get_accounts()?;

    let futures = accounts.into_iter().map(|acct| {
        let app = app.clone();
        async move {
            let _ = get_player_head_path(app, acct.uuid, false).await;
        }
    });

    futures::future::join_all(futures).await;

    // Emit event so frontend knows heads might have changed
    emit_account_heads_updated(&app, None, false);

    Ok(())
}

/// Repair auth state if the active account is missing from database
pub fn repair_active_account(app_handle: AppHandle) -> Result<Option<Account>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    // Load available accounts
    let all_accounts = account
        .load::<Account>(&mut conn)
        .map_err(|e| e.to_string())?;

    if let Some(next_acc) = all_accounts.first() {
        log::info!(
            "[auth] Active account missing, switching to available fallback: {}",
            next_acc.uuid
        );

        // We call our internal command
        set_active_account(app_handle.clone(), next_acc.uuid.clone())?;

        // Return the new active account
        let config = get_app_config().map_err(|e| e.to_string())?;
        if let Some(new_uuid) = config.active_account_uuid {
            let acct = account
                .filter(uuid.eq(new_uuid.replace("-", "")))
                .first::<crate::models::account::Account>(&mut conn)
                .optional()
                .map_err(|e| e.to_string())?;
            return Ok(acct);
        }
    } else {
        log::warn!(
            "[auth] Active account missing and no other accounts found. Resetting session..."
        );
        let mut config = get_app_config().map_err(|e| e.to_string())?;
        config.active_account_uuid = None;
        update_app_config(&config).map_err(|e| e.to_string())?;

        // Notify UI
        emit_account_heads_updated(&app_handle, None, false);

        // Trigger full reset (redirects to onboarding)
        let _ = crate::commands::app::close_all_windows_and_reset(app_handle);
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_with_type(candidate_type: &str) -> Account {
        Account {
            uuid: "069a79f444e94726a5befca90e38aaf5".to_string(),
            username: "Player".to_string(),
            account_type: candidate_type.to_string(),
            ..Account::default()
        }
    }

    #[test]
    fn persisted_microsoft_account_is_previous_authentication_proof() {
        assert!(is_previously_authenticated_account(&account_with_type(
            "Microsoft"
        )));
        assert!(!is_previously_authenticated_account(&account_with_type(
            "Guest"
        )));
        assert!(!is_previously_authenticated_account(&account_with_type(
            "Demo"
        )));
        assert!(!is_previously_authenticated_account(&account_with_type(
            "Unknown"
        )));
    }

    #[test]
    fn only_connectivity_failures_allow_offline_fallback() {
        let outage = AuthFailure::from(PistonAuthError::network(
            AuthService::MinecraftServices,
            AuthPhase::MinecraftTokenExchange,
            "timeout",
        ));
        let rejected = AuthFailure::from(PistonAuthError::SessionExpired);

        assert!(outage.allows_offline_fallback());
        assert!(!rejected.allows_offline_fallback());
    }

    #[test]
    fn outage_notification_requires_completed_setup_and_previous_authentication() {
        let outage = AuthFailure::from(PistonAuthError::network(
            AuthService::MinecraftServices,
            AuthPhase::Profile,
            "offline",
        ));

        assert!(!should_publish_auth_service_unavailable(
            false, true, false, &outage
        ));
        assert!(!should_publish_auth_service_unavailable(
            true, false, false, &outage
        ));
        assert!(!should_publish_auth_service_unavailable(
            true, true, true, &outage
        ));
        assert!(should_publish_auth_service_unavailable(
            true, true, false, &outage
        ));
    }
}
