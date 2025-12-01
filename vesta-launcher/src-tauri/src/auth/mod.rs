//! Authentication module for Microsoft OAuth and Minecraft login
//!
//! Handles device-code authentication flow, token management, and account persistence.

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use lazy_static::lazy_static;
use oauth2::TokenResponse;
use piston_lib::api::mojang::get_minecraft_profile;
use piston_lib::auth::{device_code_to_details, get_auth_client, get_device_code, poll_for_token};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::models::account::Account;
use crate::utils::config::{get_app_config, update_app_config};
use crate::utils::db_manager::get_data_db;
use crate::utils::sqlite::SQLiteSelect;

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
        uuid: String,
        username: String,
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
                match process_login_completion(token_response).await {
                    Ok((uuid, username)) => {
                        let _ = app_clone.emit(
                            "vesta://auth",
                            AuthStage::Complete {
                                uuid: uuid.clone(),
                                username: username.clone(),
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
    token_response: oauth2::basic::BasicTokenResponse,
) -> Result<(String, String)> {
    let microsoft_access_token = token_response.access_token().secret();
    let refresh_token = token_response
        .refresh_token()
        .context("No refresh token provided")?
        .secret()
        .clone();

    let expires_in_secs = token_response
        .expires_in()
        .unwrap_or(std::time::Duration::from_secs(3600))
        .as_secs();

    let token_expires_at = Utc::now() + Duration::seconds(expires_in_secs as i64);

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

    let skin_url = profile.skins.first().map(|s| s.url.clone());
    let cape_url = profile.capes.first().map(|c| c.url.clone());

    // Create account record
    let account = Account {
        id: crate::utils::sqlite::AUTOINCREMENT::default(),
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        display_name: Some(profile.name.clone()),
        access_token: Some(minecraft_access_token.into_inner()),
        refresh_token: Some(refresh_token),
        token_expires_at: Some(token_expires_at.to_rfc3339()),
        is_active: true,
        skin_url,
        cape_url,
        created_at: Some(Utc::now().to_rfc3339()),
        updated_at: Some(Utc::now().to_rfc3339()),
    };

    log::info!(
        "[auth] Completed token exchange and profile fetch for user {} ({})",
        profile.name,
        profile.id
    );
    // Save to database
    let db = get_data_db().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

    // Check if account already exists
    let existing: Vec<Account> = db
        .search_data_serde::<Account, String, Account>(
            SQLiteSelect::ALL,
            "uuid",
            profile.id.clone(),
        )
        .unwrap_or_default();

    if existing.is_empty() {
        // Insert new account using explicit column list
        log::info!("[auth] Inserting new account for uuid: {}", account.uuid);

        let conn = db.get_connection();

        // Log the actual schema of the account table
        let mut stmt = conn
            .prepare("PRAGMA table_info(account)")
            .map_err(|e| anyhow::anyhow!("Failed to get table info: {}", e))?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| anyhow::anyhow!("Failed to query table info: {}", e))?
            .filter_map(Result::ok)
            .collect();
        log::info!("[auth] Account table columns: {:?}", columns);

        let result = conn.execute(
            "INSERT INTO account (uuid, username, display_name, access_token, refresh_token, token_expires_at, is_active, skin_url, cape_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                account.uuid,
                account.username,
                account.display_name,
                account.access_token,
                account.refresh_token,
                account.token_expires_at,
                account.is_active,
                account.skin_url,
                account.cape_url,
                account.created_at,
                account.updated_at,
            ],
        );

        match result {
            Ok(_) => log::info!("[auth] Account inserted successfully"),
            Err(e) => {
                log::error!("[auth] Failed to insert account: {}", e);
                log::error!(
                    "[auth] Account data: uuid={}, username={}, display_name={:?}",
                    account.uuid,
                    account.username,
                    account.display_name
                );
                return Err(anyhow::anyhow!("Failed to insert account: {}", e));
            }
        }
    } else {
        // Update existing account
        db.update_data_serde(&account, "uuid", profile.id.clone())
            .context("Failed to update account")?;
    }

    // Update active account in config
    let mut config = get_app_config().context("Failed to get app config")?;
    config.active_account_uuid = Some(profile.id.clone());
    update_app_config(&config).context("Failed to update app config")?;

    Ok((profile.id, profile.name))
}

/// Get all accounts from database
#[tauri::command]
pub fn get_accounts() -> Result<Vec<Account>, String> {
    let db = get_data_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT id, uuid, username, display_name, access_token, refresh_token, 
                token_expires_at, is_active, skin_url, cape_url, created_at, updated_at
         FROM account",
        )
        .map_err(|e| e.to_string())?;

    let accounts = stmt
        .query_map([], |row| {
            Ok(Account {
                id: crate::utils::sqlite::AUTOINCREMENT::default(),
                uuid: row.get(1)?,
                username: row.get(2)?,
                display_name: row.get(3)?,
                access_token: row.get(4)?,
                refresh_token: row.get(5)?,
                token_expires_at: row.get(6)?,
                is_active: row.get(7)?,
                skin_url: row.get(8)?,
                cape_url: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(accounts)
}

/// Get active account (first active one found)
#[tauri::command]
pub fn get_active_account() -> Result<Option<Account>, String> {
    let config = get_app_config().map_err(|e| e.to_string())?;

    if let Some(uuid) = config.active_account_uuid {
        let db = get_data_db().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        // Use raw SQL query to avoid AUTOINCREMENT deserialization issues
        let mut stmt = conn
            .prepare(
                "SELECT id, uuid, username, display_name, access_token, refresh_token, 
                    token_expires_at, is_active, skin_url, cape_url, created_at, updated_at
             FROM account WHERE uuid = ?1",
            )
            .map_err(|e| e.to_string())?;

        let account = stmt
            .query_row([uuid], |row| {
                Ok(Account {
                    id: crate::utils::sqlite::AUTOINCREMENT::default(),
                    uuid: row.get(1)?,
                    username: row.get(2)?,
                    display_name: row.get(3)?,
                    access_token: row.get(4)?,
                    refresh_token: row.get(5)?,
                    token_expires_at: row.get(6)?,
                    is_active: row.get(7)?,
                    skin_url: row.get(8)?,
                    cape_url: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(account)
    } else {
        Ok(None)
    }
}

/// Ensure account tokens are valid and refresh if they are near expiry
pub async fn ensure_account_tokens_valid(uuid: String) -> Result<(), String> {
    // Load account
    // Use the existing public getter rather than raw DB to avoid serde row mapping issues
    let accounts = get_accounts().map_err(|e| format!("Failed to get accounts: {}", e))?;
    let account = match accounts.into_iter().find(|a| a.uuid == uuid) {
        Some(a) => a,
        None => return Err("Account not found".to_string()),
    };

    // If no refresh token present, nothing to do
    let _refresh = match account.refresh_token.clone() {
        Some(s) => s,
        None => return Ok(()),
    };

    // Check expiry; if missing, assume token is expired and refresh
    let now = Utc::now();
    let needs_refresh = match &account.token_expires_at {
        Some(ts) => match chrono::DateTime::parse_from_rfc3339(ts) {
            Ok(datetime) => {
                let dt_utc = datetime.with_timezone(&Utc);
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
            uuid
        );
        // Call our refresh function
        match refresh_account_tokens(uuid.clone()).await {
            Ok(_) => {
                log::info!("[auth] Token refresh successful for account {}", uuid);
                Ok(())
            }
            Err(e) => {
                log::error!("[auth] Token refresh failed for account {}: {}", uuid, e);
                Err(e)
            }
        }
    } else {
        log::debug!("[auth] Token still valid for account {}", uuid);
        Ok(())
    }
}

/// Refresh the tokens for the given account
#[tauri::command]
pub async fn refresh_account_tokens(uuid: String) -> Result<(), String> {
    log::info!("[auth] Refresh requested for account: {}", uuid);
    // Use the existing getter to load the account to avoid serde deserialization issues
    let accounts = get_accounts().map_err(|e| format!("Failed to get accounts: {}", e))?;
    let mut account = match accounts.into_iter().find(|a| a.uuid == uuid) {
        Some(a) => a,
        None => {
            log::error!("[auth] No account found to refresh: {}", uuid);
            return Err("Account not found".to_string());
        }
    };

    let refresh_token = match account.refresh_token.clone() {
        Some(rt) => rt,
        None => {
            log::error!("[auth] No refresh token present for account: {}", uuid);
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

    log::info!("[auth] Attempting refresh for account: {}", uuid);

    // Attempt refresh
    let token_response =
        match piston_lib::auth::refresh_access_token(&client, refresh_token.clone()).await {
            Ok(t) => t,
            Err(e) => {
                log::error!("[auth] Refresh failed for account {}: {}", uuid, e);
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
                    uuid,
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

    let token_expires_at = (Utc::now() + Duration::seconds(expires_in_secs as i64)).to_rfc3339();

    // Update account fields
    account.access_token = Some(mc_access_token);
    if let Some(rt) = ms_refresh_token {
        account.refresh_token = Some(rt);
    }
    account.token_expires_at = Some(token_expires_at);
    account.updated_at = Some(Utc::now().to_rfc3339());

    // Save to DB
    let db = get_data_db().map_err(|e| e.to_string())?;
    match db.update_data_serde(&account, "uuid", uuid.clone()) {
        Ok(_) => {
            log::info!("[auth] Successfully refreshed tokens for account: {}", uuid);
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[auth] Failed to update refreshed tokens in DB for {}: {}",
                uuid,
                e
            );
            Err(format!("Failed to update account in DB: {}", e))
        }
    }
}

/// Set active account by UUID
#[tauri::command]
pub fn set_active_account(uuid: String) -> Result<(), String> {
    let db = get_data_db().map_err(|e| e.to_string())?;

    // Deactivate all accounts
    let mut all_accounts: Vec<Account> = db
        .get_all_data_serde::<Account, Account>()
        .map_err(|e| e.to_string())?;

    for account in &mut all_accounts {
        account.is_active = account.uuid == uuid;
        db.update_data_serde(account, "uuid", account.uuid.clone())
            .map_err(|e| e.to_string())?;
    }

    // Update config
    let mut config = get_app_config().map_err(|e| e.to_string())?;
    config.active_account_uuid = Some(uuid);
    update_app_config(&config).map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove account by UUID
#[tauri::command]
pub fn remove_account(uuid: String) -> Result<(), String> {
    let db = get_data_db().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute(
        "DELETE FROM account WHERE uuid = ?1",
        rusqlite::params![uuid],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get path to cached player head image, downloading if necessary
#[tauri::command]
pub async fn get_player_head_path(
    app: AppHandle,
    uuid: String,
    force_download: bool,
) -> Result<String, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("player_heads");

    let image_path = cache_dir.join(format!("{}.png", uuid));

    let path = piston_lib::api::player::download_player_head(
        &uuid,
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

    for account in accounts {
        let _ = get_player_head_path(app.clone(), account.uuid, false).await;
    }

    Ok(())
}
