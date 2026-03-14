use crate::models::account::Account;
use crate::models::skin_history::{AccountSkinHistory, NewAccountSkinHistory};
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use crate::schema::vesta::{account, account_skin_history};
use crate::utils::db::get_vesta_conn;
use crate::{auth::get_account_profile, auth::invalidate_account_profile_cache};
use base64::{engine::general_purpose, Engine as _};
use log::{debug, error, info, warn};
use diesel::prelude::*;
use hex;
use image;
use piston_lib::api::minecraft_skins::detect_skin_variant;
use piston_lib::api::minecraft_skins::get_default_skins as get_skins;
use piston_lib::models::common::{MinecraftSkinVariant, Skin};
use sha2::{Digest, Sha256};
use tauri::{command, Manager};
use tauri::Emitter;

// Emit an account-heads-updated event after a skin/cape mutation so all
// avatar listeners (sidebar, settings) refresh without relying on frontend timing.
fn emit_heads_updated(app: &tauri::AppHandle, uuid: &str, force: bool) {
    let _ = app.emit(
        "core://account-heads-updated",
        serde_json::json!({ "uuid": uuid, "force": force }),
    );
}

fn pick_active_skin(
    profile: &piston_lib::api::mojang::MinecraftProfile,
) -> Option<&piston_lib::api::mojang::ProfileSkin> {
    profile
        .skins
        .iter()
        .find(|s| s.state.eq_ignore_ascii_case("ACTIVE"))
        .or_else(|| profile.skins.first())
}

fn normalize_texture_url(url: &str) -> String {
    url.split('?').next().unwrap_or(url).trim().to_string()
}

fn normalize_skin_variant(variant: &str) -> String {
    if variant.eq_ignore_ascii_case("slim") {
        "slim".to_string()
    } else {
        "classic".to_string()
    }
}

/// Computes a stable, content-based hash for an image.
/// This canonicalizes the image to RGBA8 and includes dimensions in the hash
/// to ensure that visually identical skins result in the same texture_key,
/// which we use for deduplication and matching against history/presets.
fn compute_texture_key(image_bytes: &[u8]) -> String {
    if let Ok(img) = image::load_from_memory(image_bytes) {
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();

        let mut hasher = Sha256::new();
        hasher.update(rgba.as_raw());
        hasher.update(width.to_le_bytes());
        hasher.update(height.to_le_bytes());
        let hex = hex::encode(hasher.finalize());
        return hex;
    }

    // Fallback to raw bytes hash if image parsing fails (e.g. corrupted file)
    let mut hasher = Sha256::new();
    hasher.update(image_bytes);
    let hex = hex::encode(hasher.finalize());
    hex
}

fn is_mojang_rate_limited(error_message: &str) -> bool {
    let lower = error_message.to_lowercase();
    lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("rate-limited")
}

fn notify_mojang_rate_limit(app: &tauri::AppHandle, account_uuid: &str, operation: &str) {
    let manager = app.state::<NotificationManager>();
    let _ = manager.create(CreateNotificationInput {
        client_key: Some(format!("mojang_rate_limit_{}", account_uuid)),
        title: Some("Mojang API Rate Limited".to_string()),
        description: Some(format!(
            "{} was rate-limited by Mojang. Please wait a moment and retry.",
            operation
        )),
        severity: Some("warning".to_string()),
        notification_type: Some(NotificationType::Immediate),
        dismissible: Some(true),
        progress: None,
        current_step: None,
        total_steps: None,
        actions: None,
        metadata: None,
        show_on_completion: None,
    });
}

#[command]
pub async fn get_default_skins() -> Result<Vec<Skin>, String> {
    Ok(get_skins())
}

#[derive(serde::Serialize)]
pub struct LocalSkinResponse {
    pub variant: MinecraftSkinVariant,
    pub base64_data: String,
}

#[command]
pub async fn detect_local_skin_variant(file_path: String) -> Result<LocalSkinResponse, String> {
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Failed to read skin file: {}", e))?;

    let variant = detect_skin_variant(&bytes);
    let base64_data = general_purpose::STANDARD.encode(&bytes);
    let full_base64 = format!("data:image/png;base64,{}", base64_data);

    // Log the detection details including full base64 payload (as requested)
    info!("detect_local_skin_variant: file_path='{}' bytes_len={} variant={}", file_path, bytes.len(), variant.to_string());

    Ok(LocalSkinResponse {
        variant,
        base64_data: full_base64,
    })
}

#[command]
pub async fn detect_base64_skin_variant(
    base64_data: String,
) -> Result<MinecraftSkinVariant, String> {
    // Strip data URL prefix if present
    let clean_base64 = if let Some(pos) = base64_data.find(',') {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    info!("detect_base64_skin_variant: input_base64_len={}", base64_data.len());
    debug!("detect_base64_skin_variant: payload={}", base64_data);
    let bytes = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    Ok(detect_skin_variant(&bytes))
}

#[command]
pub async fn compute_texture_key_from_base64(base64_data: String) -> Result<String, String> {
    // Accept either a full data URI or raw base64 payload
    let clean_base64 = if let Some(pos) = base64_data.find(',') {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    let bytes = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Failed to decode base64 for texture key: {}", e))?;

    let texture_key = compute_texture_key(&bytes);
    info!("compute_texture_key_from_base64: bytes_len={} texture_key={}", bytes.len(), texture_key);
    Ok(texture_key)
}

#[command]
pub async fn upload_account_skin(
    app: tauri::AppHandle,
    account_uuid: String,
    name: String,
    variant: String,
    base64_data: String,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    // 1. Clean and decode base64
    let clean_base64 = if let Some(pos) = base64_data.find(',') {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    let file_bytes = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Failed to decode skin data: {}", e))?;

    let texture_key = compute_texture_key(&file_bytes);

    info!("upload_account_skin: account={} name='{}' variant='{}' texture_key={}", normalized_uuid, name, variant, texture_key);
    debug!("upload_account_skin: base64_len={} bytes_len={} base64_payload={}", clean_base64.len(), file_bytes.len(), clean_base64);

    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    let redacted_token = if token.len() > 6 { format!("{}...", &token[..6]) } else { "<redacted>".to_string() };
    debug!("upload_account_skin: using token={} for account={}", redacted_token, normalized_uuid);
match account_skin_history::table
        .filter(account_skin_history::account_uuid.eq(&normalized_uuid))
        .filter(account_skin_history::texture_key.eq(&texture_key))
        .first::<AccountSkinHistory>(&mut conn)
    {
        Ok(existing) => {
            info!("upload_account_skin: MatchFound history_id={} account={} texture_key={}", existing.id, normalized_uuid, texture_key);
            // refresh timestamp
            diesel::update(account_skin_history::table.filter(account_skin_history::id.eq(existing.id)))
                .set(account_skin_history::added_at.eq(diesel::dsl::sql::<diesel::sql_types::Text>("CURRENT_TIMESTAMP")))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to refresh existing skin history timestamp: {}", e))?;
            
            // Still upload to Mojang to set it as active if it matched history but isn't current on server
            piston_lib::api::mojang::upload_skin(&token, &variant, file_bytes.clone())
                .await
                .map_err(|e| {
                    let message = format!("Failed to upload skin to Mojang: {}", e);
                    if is_mojang_rate_limited(&message) {
                        notify_mojang_rate_limit(&app, &normalized_uuid, "Uploading skin");
                    }
                    message
                })?;
        }
        Err(diesel::result::Error::NotFound) => {
            // No existing entry — proceed to upload then save
            piston_lib::api::mojang::upload_skin(&token, &variant, file_bytes.clone())
                .await
                .map_err(|e| {
                    let message = format!("Failed to upload skin to Mojang: {}", e);
                    if is_mojang_rate_limited(&message) {
                        notify_mojang_rate_limit(&app, &normalized_uuid, "Uploading skin");
                    }
                    message
                })?;

            info!("upload_account_skin: Upload successful for account={} texture_key={}", normalized_uuid, texture_key);

            // 4. Save to history
            // Ensure we save the full data URI internally for consistency
            let image_data = if base64_data.starts_with("data:") {
                base64_data.clone()
            } else {
                format!("data:image/png;base64,{}", base64_data)
            };

            let new_history = NewAccountSkinHistory {
                account_uuid: normalized_uuid.clone(),
                texture_key: texture_key.clone(),
                name: name.clone(),
                variant: variant.clone(),
                image_data,
                source: "mojang".to_string(),
            };

            diesel::insert_into(account_skin_history::table)
                .values(&new_history)
                .execute(&mut conn)
                .map_err(|e| format!("Failed to save skin history: {}", e))?;
        }
        Err(e) => return Err(format!("Failed to query skin history: {}", e)),
    }

    // 5. Update active account skin URL (fetch new profile)
    invalidate_account_profile_cache(&normalized_uuid).await;
    if let Ok(profile) = get_account_profile(normalized_uuid.clone()).await {
        if let Some(skin) = pick_active_skin(&profile) {
            let server_variant = normalize_skin_variant(&skin.variant);
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set((
                    account::skin_url.eq(&skin.url),
                    account::skin_variant.eq(&server_variant),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update account skin URL: {}", e))?;
        }
    }

    emit_heads_updated(&app, &normalized_uuid, true);
    Ok(())
}

#[command]
pub async fn apply_history_skin(
    app: tauri::AppHandle,
    account_uuid: String,
    history_id: i32,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    // 1. Get history entry
    let history = account_skin_history::table
        .filter(account_skin_history::id.eq(history_id))
        .first::<AccountSkinHistory>(&mut conn)
        .map_err(|e| format!("History entry not found: {}", e))?;

    // 2. Get account token
    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    // 3. Decode base64
    let clean_base64 = if let Some(pos) = history.image_data.find(',') {
        &history.image_data[pos + 1..]
    } else {
        &history.image_data
    };

    let file_bytes = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Failed to decode skin data: {}", e))?;

    // 4. Upload to Mojang
    piston_lib::api::mojang::upload_skin(&token, &history.variant, file_bytes)
        .await
        .map_err(|e| {
            let message = format!("Failed to upload skin to Mojang: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Applying saved skin");
            }
            message
        })?;

    // 5. Update active account skin URL
    invalidate_account_profile_cache(&normalized_uuid).await;
    if let Ok(profile) = get_account_profile(normalized_uuid.clone()).await {
        if let Some(skin) = pick_active_skin(&profile) {
            let server_variant = normalize_skin_variant(&skin.variant);
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set((
                    account::skin_url.eq(&skin.url),
                    account::skin_variant.eq(&server_variant),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update account skin URL: {}", e))?;
        }
    }

    emit_heads_updated(&app, &normalized_uuid, true);
    Ok(())
}

#[command]
pub fn get_skin_history(account_uuid: String) -> Result<Vec<AccountSkinHistory>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    let history = account_skin_history::table
        .filter(account_skin_history::account_uuid.eq(&normalized_uuid))
        .order(account_skin_history::added_at.desc())
        .load::<AccountSkinHistory>(&mut conn)
        .map_err(|e| format!("Failed to load skin history: {}", e))?;

    Ok(history)
}

#[command]
pub fn delete_history_skin(history_id: i32) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    diesel::delete(account_skin_history::table.filter(account_skin_history::id.eq(history_id)))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to delete skin history: {}", e))?;

    Ok(())
}

#[command]
pub async fn reset_account_skin(app: tauri::AppHandle, account_uuid: String) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    piston_lib::api::mojang::reset_skin(&token)
        .await
        .map_err(|e| {
            let message = format!("Failed to reset skin: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Resetting skin");
            }
            message
        })?;

    invalidate_account_profile_cache(&normalized_uuid).await;
    if let Ok(profile) = get_account_profile(normalized_uuid.clone()).await {
        if let Some(skin) = pick_active_skin(&profile) {
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set((
                    account::skin_url.eq(&skin.url),
                    account::skin_variant.eq(normalize_skin_variant(&skin.variant)),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update account skin URL: {}", e))?;
        }
    }

    emit_heads_updated(&app, &normalized_uuid, true);
    Ok(())
}

#[command]
pub async fn change_account_cape(
    app: tauri::AppHandle,
    account_uuid: String,
    cape_id: String,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    piston_lib::api::mojang::change_cape(&token, &cape_id)
        .await
        .map_err(|e| {
            let message = format!("Failed to change cape: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Changing cape");
            }
            message
        })?;

    invalidate_account_profile_cache(&normalized_uuid).await;
    if let Ok(profile) = get_account_profile(normalized_uuid.clone()).await {
        if let Some(cape) = profile.capes.iter().find(|c| c.state == "ACTIVE") {
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set(account::cape_url.eq(Some(&cape.url)))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update account cape URL: {}", e))?;
        }
    }

    emit_heads_updated(&app, &normalized_uuid, true);
    Ok(())
}

#[command]
pub async fn apply_preset_skin(
    app: tauri::AppHandle,
    account_uuid: String,
    texture_url: String,
    variant: String,
    category: Option<String>,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    // 1. Get account token
    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    // 2. Resolve skin bytes
    let file_bytes = if texture_url.starts_with("data:") {
        let clean_base64 = if let Some(pos) = texture_url.find(',') {
            &texture_url[pos + 1..]
        } else {
            &texture_url
        };
        // Decode base64 bytes directly
        general_purpose::STANDARD
            .decode(clean_base64)
            .map_err(|e| format!("Failed to decode base64 preset skin: {}", e))?
    } else {
        // Only use reqwest for actual URLs
        let response = reqwest::get(&texture_url)
            .await
            .map_err(|e| format!("Failed to download preset skin ({}): {}", texture_url, e))?;
        response
            .bytes()
            .await
            .map_err(|e| format!("Failed to get preset skin bytes: {}", e))?
            .to_vec()
    };

    // 3. Upload to Mojang
    piston_lib::api::mojang::upload_skin(&token, &variant, file_bytes.clone())
        .await
        .map_err(|e| {
            let message = format!("Failed to upload preset skin to Mojang: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Applying preset skin");
            }
            message
        })?;

    // 4. Update history if it's a known preset or has category
    // We convert the bytes back to a data URL for consistent local storage
    let b64 = general_purpose::STANDARD.encode(&file_bytes);
    let image_data = format!("data:image/png;base64,{}", b64);

    let texture_key = compute_texture_key(&file_bytes);
    
    // Attempt to find a name from the texture url or category
    let skin_name = if let Some(cat) = &category {
        format!("{}: {}", cat, texture_url.split('/').last().unwrap_or("preset"))
    } else {
        texture_url.split('/').last().unwrap_or("preset").to_string()
    };

    let new_history = NewAccountSkinHistory {
        account_uuid: normalized_uuid.clone(),
        texture_key: texture_key.clone(),
        name: skin_name,
        variant: variant.clone(),
        image_data,
        source: category.unwrap_or_else(|| "preset".to_string()),
    };

    diesel::insert_into(account_skin_history::table)
        .values(&new_history)
        .on_conflict((account_skin_history::account_uuid, account_skin_history::texture_key))
        .do_update()
        .set(account_skin_history::added_at.eq(diesel::dsl::sql::<diesel::sql_types::Text>("CURRENT_TIMESTAMP")))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to save skin history: {}", e))?;

    // 5. Update active account skin URL
    invalidate_account_profile_cache(&normalized_uuid).await;
    if let Ok(profile) = get_account_profile(normalized_uuid.clone()).await {
        if let Some(skin) = pick_active_skin(&profile) {
            let server_variant = normalize_skin_variant(&skin.variant);
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set((
                    account::skin_url.eq(&skin.url),
                    account::skin_variant.eq(&server_variant),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update account skin URL: {}", e))?;
        }
    }

    emit_heads_updated(&app, &normalized_uuid, false);
    Ok(())
}

#[command]
pub async fn change_skin_variant(
    app: tauri::AppHandle,
    account_uuid: String,
    variant: String,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    // 1. Get account token
    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    // 2. Get current skin bytes to re-upload with new variant (Mojang doesn't have a simple variant toggle API)
    let profile = piston_lib::api::mojang::get_minecraft_profile(&token)
        .await
        .map_err(|e| {
            let message = format!("Failed to fetch profile: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Fetching Mojang profile");
            }
            message
        })?;

    let active_skin = profile
        .skins
        .iter()
        .find(|s| s.state == "ACTIVE")
        .ok_or_else(|| "No active skin found to change variant".to_string())?;

    let response = reqwest::get(&active_skin.url)
        .await
        .map_err(|e| format!("Failed to download current skin: {}", e))?;
    let file_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to get skin bytes: {}", e))?
        .to_vec();

    // 3. Re-upload to Mojang with new variant
    piston_lib::api::mojang::upload_skin(&token, &variant, file_bytes)
        .await
        .map_err(|e| {
            let message = format!("Failed to update skin variant on Mojang: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Changing skin variant");
            }
            message
        })?;

    // 4. Update local db from server-authoritative profile data
    invalidate_account_profile_cache(&normalized_uuid).await;
    if let Ok(profile) = get_account_profile(normalized_uuid.clone()).await {
        if let Some(skin) = pick_active_skin(&profile) {
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set((
                    account::skin_url.eq(&skin.url),
                    account::skin_variant.eq(normalize_skin_variant(&skin.variant)),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update local skin variant: {}", e))?;
        } else {
            diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
                .set(account::skin_variant.eq(&variant))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update local skin variant: {}", e))?;
        }
    } else {
        diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
            .set(account::skin_variant.eq(&variant))
            .execute(&mut conn)
            .map_err(|e| format!("Failed to update local skin variant: {}", e))?;
    }

    emit_heads_updated(&app, &normalized_uuid, false);
    Ok(())
}

#[command]
pub async fn compute_texture_key_from_url(texture_url: String) -> Result<(String, String), String> {
    // Download the texture URL and compute the same texture_key used elsewhere
    let response = reqwest::get(&texture_url)
        .await
        .map_err(|e| format!("Failed to download texture URL {}: {}", texture_url, e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read texture bytes: {}", e))?
        .to_vec();

    let texture_key = compute_texture_key(&bytes);
    let b64 = general_purpose::STANDARD.encode(&bytes);
    let data_uri = format!("data:image/png;base64,{}", b64);

    info!("compute_texture_key_from_url: url={} bytes_len={} texture_key={}", texture_url, bytes.len(), texture_key);

    Ok((texture_key, data_uri))
}

#[command]
pub async fn hide_account_cape(app: tauri::AppHandle, account_uuid: String) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    let account_model = account::table
        .filter(account::uuid.eq(&normalized_uuid))
        .first::<Account>(&mut conn)
        .map_err(|e| format!("Account not found: {}", e))?;

    let token = account_model
        .access_token
        .ok_or_else(|| "Account has no access token".to_string())?;

    piston_lib::api::mojang::hide_cape(&token)
        .await
        .map_err(|e| {
            let message = format!("Failed to hide cape: {}", e);
            if is_mojang_rate_limited(&message) {
                notify_mojang_rate_limit(&app, &normalized_uuid, "Hiding cape");
            }
            message
        })?;

    invalidate_account_profile_cache(&normalized_uuid).await;

    diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
        .set(account::cape_url.eq(None::<String>))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update account cape URL: {}", e))?;

    emit_heads_updated(&app, &normalized_uuid, false);
    Ok(())
}

/// Synchronizes the active Mojang skin with the local database history.
/// This runs on app startup to ensure that even if the user changed their skin
/// outside the launcher, it's captured in our history and accurately identified.
#[command]
pub async fn sync_current_skin_history(app: tauri::AppHandle, account_uuid: String) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let normalized_uuid = account_uuid.replace("-", "");

    info!("sync_current_skin_history: starting for account={}", normalized_uuid);

    // 1. Fetch current Mojang profile to get the active skin metadata
    let profile = get_account_profile(normalized_uuid.clone()).await.map_err(|e| {
        if is_mojang_rate_limited(&e) {
            notify_mojang_rate_limit(&app, &normalized_uuid, "Syncing current skin");
        }
        e
    })?;
    let active_skin = pick_active_skin(&profile)
        .ok_or_else(|| "No active skin found for account".to_string())?;

    let normalized_url = normalize_texture_url(&active_skin.url);
    info!("sync_current_skin_history: active_skin_url={} variant={}", normalized_url, active_skin.variant);

    // 2. Download the texture and compute its content key
    // This allows us to link the server skin to existing history/presets by actual image content.
    let (texture_key, image_data) = match reqwest::get(&active_skin.url).await {
        Ok(response) => {
            let status = response.status();
            match response.bytes().await {
                Ok(bytes) => {
                    let bytes_vec = bytes.to_vec();
                    let key = compute_texture_key(&bytes_vec);
                    let base64_data = general_purpose::STANDARD.encode(&bytes_vec);
                    info!("sync_current_skin_history: downloaded skin bytes_len={} texture_key={}", bytes_vec.len(), key);
                    (key, format!("data:image/png;base64,{}", base64_data))
                }
                Err(e) => {
                    error!("sync_current_skin_history: failed to read bytes from mojang (status={}): {}", status, e);
                    // Fallback to URL-based key if download fails
                    let mut hasher = Sha256::new();
                    hasher.update(normalized_url.as_bytes());
                    (
                        format!("mojang:{}", hex::encode(hasher.finalize())),
                        normalized_url.clone(),
                    )
                }
            }
        },
        Err(e) => {
            error!("sync_current_skin_history: failed to download skin from mojang: {}", e);
            // Fallback to URL-based key if request fails
            let mut hasher = Sha256::new();
            hasher.update(normalized_url.as_bytes());
            (
                format!("mojang:{}", hex::encode(hasher.finalize())),
                normalized_url.clone(),
            )
        }
    };

    let variant = if active_skin.variant.to_lowercase() == "slim" {
        "slim".to_string()
    } else {
        "classic".to_string()
    };
    
    let skin_name = if profile.name.is_empty() {
        "Current Skin".to_string()
    } else {
        format!("{} Current Skin", profile.name)
    };

    // 3. Search history for a matching texture_key
    // This identifies if the skin is a known preset or previously uploaded one.
    let existing = account_skin_history::table
        .filter(account_skin_history::account_uuid.eq(&normalized_uuid))
        .filter(account_skin_history::texture_key.eq(&texture_key))
        .first::<AccountSkinHistory>(&mut conn)
        .optional()
        .map_err(|e| format!("Database error checking history: {}", e))?;

    if let Some(h) = existing {
        // Skin identified! Update and re-order history entry.
        info!("sync_current_skin_history: MatchFound history_id={} texture_key={}", h.id, texture_key);
        diesel::update(account_skin_history::table.filter(account_skin_history::id.eq(h.id)))
            .set((
                account_skin_history::variant.eq(&variant),
                account_skin_history::added_at.eq(diesel::dsl::sql::<diesel::sql_types::Text>("CURRENT_TIMESTAMP")),
            ))
            .execute(&mut conn)
            .map_err(|e| format!("Failed to update history timestamp: {}", e))?;
    } else {
        // Unknown skin: Add a new entry to history.
        info!("sync_current_skin_history: No match found. Adding new skin to history. texture_key={}", texture_key);
        let new_history = NewAccountSkinHistory {
            account_uuid: normalized_uuid.clone(),
            texture_key,
            name: skin_name,
            variant: variant.clone(),
            image_data: image_data.clone(),
            source: "mojang".to_string(), // Authenticate as official skin source
        };

        diesel::insert_into(account_skin_history::table)
            .values(&new_history)
            .execute(&mut conn)
            .map_err(|e| format!("Failed to insert new skin history: {}", e))?;
    }

    // 4. Update the account record with canonical server URL and variant
    diesel::update(account::table.filter(account::uuid.eq(&normalized_uuid)))
        .set((
            account::skin_url.eq(Some(normalized_url)),
            account::skin_variant.eq(variant),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update account skin fields: {}", e))?;

    info!("sync_current_skin_history: completed for account={}", normalized_uuid);
    Ok(())
}
