//! Authentication module for Microsoft OAuth and Minecraft login
//!
//! Handles device-code authentication flow, token management, and account persistence.

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use diesel::prelude::*;
use lazy_static::lazy_static;
use oauth2::TokenResponse;
use piston_lib::api::mojang::get_minecraft_profile;
use piston_lib::auth::{device_code_to_details, get_auth_client, get_device_code, poll_for_token};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::models::account::{Account, NewAccount};
use crate::schema::account::dsl::*; // Bring table and column names into scope for queries
use crate::utils::config::{get_app_config, update_app_config};
use crate::utils::db::get_vesta_conn;

lazy_static! {
    /// Global cancel channel for aborting authentication
    static ref CANCEL_SENDER: Arc<Mutex<Option<oneshot::Sender<()>>>> = Arc::new(Mutex::new(None));
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
        message: String,
    },
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
    let client = get_auth_client().map_err(|e| e.to_string())?;

    // Request device code
    let device_code_response = get_device_code(&client)
        .await
        .map_err(|e| format!("Failed to get device code: {}", e))?;

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
                        let _ = app_clone.emit(
                            "vesta://auth",
                            AuthStage::Error {
                                message: format!("Failed to complete login: {}", e),
                            },
                        );
                    }
                }
            }
            Ok(None) => {
                // Cancelled
                let _ = app_clone.emit("vesta://auth", AuthStage::Cancelled);
            }
            Err(e) => {
                log::error!("[auth] Poll for token failed: {}", e);
                let _ = app_clone.emit(
                    "vesta://auth",
                    AuthStage::Error {
                        message: format!("Authentication failed: {}", e),
                    },
                );
            }
        }
    });

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
) -> Result<Option<oauth2::basic::BasicTokenResponse>> {
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
                        anyhow::bail!("Device code expired");
                    }
                    _ => {
                        anyhow::bail!("Authorization failed: {:?}", resp.error());
                    }
                }
            }
            Err(e) => {
                anyhow::bail!("Failed to poll for token: {}", e);
            }
        }
    }
}

/// Process successful login: exchange tokens and save account
async fn process_login_completion(
    app_handle: AppHandle,
    token_response: oauth2::basic::BasicTokenResponse,
) -> Result<(String, String)> {
    let microsoft_access_token = token_response.access_token().secret();
    let refresh_token_val = token_response
        .refresh_token()
        .context("No refresh token provided")?
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
        .context("Failed to exchange for Minecraft token")?;

    let minecraft_access_token = minecraft_token.access_token().clone();
    let minecraft_access_token_str = minecraft_access_token.clone().into_inner();

    // Fetch Minecraft profile
    let profile = get_minecraft_profile(&minecraft_access_token_str)
        .await
        .context("Failed to fetch Minecraft profile")?;

    // Normalize UUID
    let normalized_uuid = profile.id.replace("-", "");

    let skin_url_val = profile.skins.first().map(|s| s.url.clone());
    let cape_url_val = profile.capes.first().map(|c| c.url.clone());

    log::info!(
        "[auth] Completed token exchange and profile fetch for user {} ({})",
        profile.name,
        normalized_uuid
    );

    // Save to database
    let mut conn =
        get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

    // Check if account already exists
    let existing_count: i64 = account
        .filter(uuid.eq(&normalized_uuid))
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);

    let now_str = Utc::now().to_rfc3339();
    let current_config = get_app_config().unwrap_or_default();

    if existing_count == 0 {
        // Insert new account
        log::info!("[auth] Inserting new account for uuid: {}", normalized_uuid);

        let new_account = NewAccount {
            uuid: normalized_uuid.clone(),
            username: profile.name.clone(),
            display_name: Some(profile.name.clone()),
            access_token: Some(minecraft_access_token.into_inner()),
            refresh_token: Some(refresh_token_val),
            token_expires_at: Some(token_expires_at_val.to_rfc3339()),
            is_active: true,
            skin_url: skin_url_val,
            cape_url: cape_url_val,
            created_at: Some(now_str.clone()),
            updated_at: Some(now_str.clone()),
            theme_id: Some(current_config.theme_id),
            theme_mode: Some(current_config.theme_mode),
            theme_primary_hue: Some(current_config.theme_primary_hue),
            theme_primary_sat: current_config.theme_primary_sat,
            theme_primary_light: current_config.theme_primary_light,
            theme_style: Some(current_config.theme_style),
            theme_gradient_enabled: Some(current_config.theme_gradient_enabled),
            theme_gradient_angle: current_config.theme_gradient_angle,
            theme_gradient_type: current_config.theme_gradient_type,
            theme_gradient_harmony: current_config.theme_gradient_harmony,
            theme_advanced_overrides: current_config.theme_advanced_overrides,
        };

        diesel::insert_into(account)
            .values(&new_account)
            .execute(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to insert account: {}", e))?;

        log::info!("[auth] Account inserted successfully");
    } else {
        // Update existing account
        diesel::update(account.filter(uuid.eq(&normalized_uuid)))
            .set((
                username.eq(&profile.name),
                display_name.eq(&profile.name),
                access_token.eq(Some(minecraft_access_token.into_inner())),
                refresh_token.eq(Some(refresh_token_val)),
                token_expires_at.eq(Some(token_expires_at_val.to_rfc3339())),
                skin_url.eq(skin_url_val),
                cape_url.eq(cape_url_val),
                updated_at.eq(Some(now_str.clone())),
            ))
            .execute(&mut conn)
            .map_err(|e| anyhow::anyhow!("Failed to update account: {}", e))?;

        log::info!("[auth] Account updated successfully");
    }

    // Update active account in config
    let mut config = get_app_config().context("Failed to get app config")?;
    config.active_account_uuid = Some(normalized_uuid.clone());
    update_app_config(&config).context("Failed to update app config")?;

    // Emit config update event so UI knows active account changed
    let _ = app_handle.emit(
        "config-updated",
        serde_json::json!({
            "field": "active_account_uuid",
            "value": normalized_uuid
        }),
    );

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
            .first::<Account>(&mut conn)
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(acct)
    } else {
        Ok(None)
    }
}

/// Ensure account tokens are valid and refresh if they are near expiry
pub async fn ensure_account_tokens_valid(target_uuid: String) -> Result<(), String> {
    // Normalize UUID
    let target_uuid = target_uuid.replace("-", "");

    // Load account
    // Use the existing public getter rather than raw DB to avoid duplication
    let accounts = get_accounts().map_err(|e| format!("Failed to get accounts: {}", e))?;
    let acct = match accounts.into_iter().find(|a| a.uuid == target_uuid) {
        Some(a) => a,
        None => return Err("Account not found".to_string()),
    };

    // If no refresh token present, nothing to do
    let _refresh = match acct.refresh_token.clone() {
        Some(s) => s,
        None => return Ok(()),
    };

    // Check expiry; if missing, assume token is expired and refresh
    let now = Utc::now();
    let needs_refresh = match &acct.token_expires_at {
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
        // Call our refresh function
        match refresh_account_tokens(target_uuid.clone()).await {
            Ok(_) => {
                log::info!(
                    "[auth] Token refresh successful for account {}",
                    target_uuid
                );
                Ok(())
            }
            Err(e) => {
                log::error!(
                    "[auth] Token refresh failed for account {}: {}",
                    target_uuid,
                    e
                );
                Err(e)
            }
        }
    } else {
        log::debug!("[auth] Token still valid for account {}", target_uuid);
        Ok(())
    }
}

/// Refresh the tokens for the given account
#[tauri::command]
pub async fn refresh_account_tokens(target_uuid: String) -> Result<(), String> {
    // Normalize UUID
    let target_uuid = target_uuid.replace("-", "");

    log::info!("[auth] Refresh requested for account: {}", target_uuid);

    // Load account to get refresh token
    let accounts = get_accounts().map_err(|e| format!("Failed to get accounts: {}", e))?;
    let mut acct = match accounts.into_iter().find(|a| a.uuid == target_uuid) {
        Some(a) => a,
        None => {
            log::error!("[auth] No account found to refresh: {}", target_uuid);
            return Err("Account not found".to_string());
        }
    };

    let refresh_token_val = match acct.refresh_token.clone() {
        Some(rt) => rt,
        None => {
            log::error!(
                "[auth] No refresh token present for account: {}",
                target_uuid
            );
            return Err("No refresh token available".to_string());
        }
    };

    // Get auth client
    let client = match get_auth_client() {
        Ok(c) => c,
        Err(e) => {
            log::error!("[auth] Failed to create auth client: {}", e);
            return Err(format!("Failed to create auth client: {}", e));
        }
    };

    log::info!("[auth] Attempting refresh for account: {}", target_uuid);

    // Attempt refresh
    let token_response =
        match piston_lib::auth::refresh_access_token(&client, refresh_token_val.clone()).await {
            Ok(t) => t,
            Err(e) => {
                log::error!("[auth] Refresh failed for account {}: {}", target_uuid, e);
                return Err(format!("Failed to refresh token: {}", e));
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
                return Err(format!("Failed to exchange for Minecraft token: {}", e));
            }
        };

    let mc_access_token = minecraft_response.access_token().clone().into_inner();
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

    // Update account fields (in memory copy)
    acct.access_token = Some(mc_access_token.clone());
    if let Some(rt) = ms_refresh_token.clone() {
        acct.refresh_token = Some(rt);
    }
    acct.token_expires_at = Some(token_expires_at_val.clone());
    acct.updated_at = Some(now_str.clone());

    // Save to DB
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    diesel::update(account.filter(uuid.eq(&target_uuid)))
        .set((
            access_token.eq(Some(mc_access_token)),
            refresh_token.eq(ms_refresh_token), // Handles Option logic naturally
            token_expires_at.eq(Some(token_expires_at_val)),
            updated_at.eq(Some(now_str)),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update account in DB: {}", e))?;

    log::info!(
        "[auth] Successfully refreshed tokens for account: {}",
        target_uuid
    );
    Ok(())
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
        .first::<Account>(&mut conn)
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

    // Apply account theme settings to global config if they exist
    let mut updates = std::collections::HashMap::new();

    if let Some(val) = target_account.theme_id {
        config.theme_id = val.clone();
        updates.insert("theme_id".to_string(), serde_json::Value::String(val));
    }
    if let Some(val) = target_account.theme_mode {
        config.theme_mode = val.clone();
        updates.insert("theme_mode".to_string(), serde_json::Value::String(val));
    }
    if let Some(val) = target_account.theme_primary_hue {
        config.theme_primary_hue = val;
        updates.insert("theme_primary_hue".to_string(), serde_json::Value::Number(val.into()));
    }
    if let Some(val) = target_account.theme_primary_sat {
        config.theme_primary_sat = Some(val);
        updates.insert("theme_primary_sat".to_string(), serde_json::Value::Number(val.into()));
    }
    if let Some(val) = target_account.theme_primary_light {
        config.theme_primary_light = Some(val);
        updates.insert("theme_primary_light".to_string(), serde_json::Value::Number(val.into()));
    }
    if let Some(val) = target_account.theme_style {
        config.theme_style = val.clone();
        updates.insert("theme_style".to_string(), serde_json::Value::String(val));
    }
    if let Some(val) = target_account.theme_gradient_enabled {
        config.theme_gradient_enabled = val;
        updates.insert("theme_gradient_enabled".to_string(), serde_json::Value::Bool(val));
    }
    if let Some(val) = target_account.theme_gradient_angle {
        config.theme_gradient_angle = Some(val);
        updates.insert("theme_gradient_angle".to_string(), serde_json::Value::Number(val.into()));
    }
    if let Some(val) = target_account.theme_gradient_type {
        config.theme_gradient_type = Some(val.clone());
        updates.insert("theme_gradient_type".to_string(), serde_json::Value::String(val));
    }
    if let Some(val) = target_account.theme_gradient_harmony {
        config.theme_gradient_harmony = Some(val.clone());
        updates.insert("theme_gradient_harmony".to_string(), serde_json::Value::String(val));
    }
    if let Some(val) = target_account.theme_advanced_overrides {
        config.theme_advanced_overrides = Some(val.clone());
        updates.insert("theme_advanced_overrides".to_string(), serde_json::Value::String(val));
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
    let _ = app_handle.emit("config-updated", serde_json::json!({
        "field": "active_account_uuid",
        "value": target_uuid
    }));

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
pub async fn get_player_head_path(
    app: AppHandle,
    player_uuid: String,
    force_download: bool,
) -> Result<String, String> {
    // Normalize UUID (remove dashes)
    let normalized_uuid = player_uuid.replace("-", "");

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("player_heads");

    let image_path = cache_dir.join(format!("{}.png", normalized_uuid));

    let path = piston_lib::api::player::download_player_head(
        &normalized_uuid,
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

    for acct in accounts {
        // Set force_download to true so skins update on every launch
        let _ = get_player_head_path(app.clone(), acct.uuid, true).await;
    }

    // Emit event so frontend knows heads might have changed
    use tauri::Emitter;
    let _ = app.emit("core://account-heads-updated", ());

    Ok(())
}
