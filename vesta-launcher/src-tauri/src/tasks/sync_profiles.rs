use crate::auth::{get_account_profile, invalidate_account_profile_cache};
use crate::models::account::Account;
use crate::models::skin_history::NewAccountSkinHistory;
use crate::schema::vesta::account;
use crate::schema::vesta::account_skin_history;
use crate::tasks::manager::{BoxFuture, Task, TaskContext};
use crate::utils::cape_cache::get_or_cache_cape_bytes;
use crate::utils::db::get_vesta_conn;
use crate::utils::texture::compute_texture_key;
use base64::{engine::general_purpose, Engine as _};
use diesel::prelude::*;
use log::{debug, info, warn};
use tauri::{Emitter, Manager};

pub struct SyncAccountProfilesTask;

impl SyncAccountProfilesTask {
    pub fn new() -> Self {
        Self
    }
}

pub async fn download_to_base64_data_uri(url: &str) -> std::result::Result<String, String> {
    if url.starts_with("data:") {
        return Ok(url.to_string());
    }

    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Bad status: {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let base64_str = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:image/png;base64,{}", base64_str))
}

pub async fn sync_account_profile_data(
    normalized_uuid: &str,
    app_handle: Option<tauri::AppHandle>,
    notify_remote_change: bool,
) -> Result<(), String> {
    info!(
        "[Sync] Starting profile sync for account={}",
        normalized_uuid
    );
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let mut acc = account::table
        .filter(account::uuid.eq(normalized_uuid))
        .first::<crate::models::account::Account>(&mut conn)
        .map_err(|_| "Account not found".to_string())?;

    if acc.account_type == "Guest" || acc.account_type == "Demo" {
        debug!(
            "[Sync] Skipping sync for {} account: {}",
            acc.account_type, acc.uuid
        );
        return Ok(());
    }

    invalidate_account_profile_cache(normalized_uuid).await;
    let profile = match get_account_profile(normalized_uuid.to_string()).await {
        Ok(p) => p,
        Err(e) => {
            warn!(
                "[Sync] Failed to fetch profile from Mojang for {}: {}",
                normalized_uuid, e
            );
            return Err(e);
        }
    };

    let active_skin = profile
        .skins
        .iter()
        .find(|s| s.state == "ACTIVE")
        .or_else(|| profile.skins.first())
        .cloned();
    let active_cape = profile
        .capes
        .iter()
        .find(|c| c.state == "ACTIVE")
        .or_else(|| profile.capes.first())
        .cloned();

    let mut needs_db_update = false;
    let mut remote_change_detected = false;

    if let Some(mojang_skin) = active_skin {
        info!("[Sync] Active Mojang skin found: {}", mojang_skin.url);
        let server_variant = if mojang_skin.variant.to_lowercase() == "slim" {
            "slim"
        } else {
            "classic"
        };
        let skin_url_changed = acc.skin_url.as_deref() != Some(mojang_skin.url.as_str());

        let skin_url = mojang_skin.url.clone();

        // PERSISTENCE CHECK: We want to ensure the current skin is ALWAYS in the history table.
        let mut base64_for_history = acc.skin_data.clone();

        if skin_url_changed || acc.skin_data.is_none() {
            if skin_url_changed && acc.skin_url.is_some() {
                info!("[Sync] Remote skin change detected for {}", acc.uuid);
                remote_change_detected = true;
            }

            match download_to_base64_data_uri(&skin_url).await {
                Ok(base64_data) => {
                    info!("[Sync] Downloaded skin to base64 for history insertion");
                    acc.skin_url = Some(skin_url);
                    acc.skin_data = Some(base64_data.clone());
                    base64_for_history = Some(base64_data);
                    acc.skin_variant = server_variant.to_string();
                    needs_db_update = true;
                }
                Err(e) => warn!("[Sync] Failed to download skin to base64: {}", e),
            }
        } else if acc.skin_variant != server_variant {
            info!(
                "[Sync] Variant mismatch detected for {}: {} vs {}",
                acc.uuid, acc.skin_variant, server_variant
            );
            acc.skin_variant = server_variant.to_string();
            needs_db_update = true;
        }

        // Now ensure the skin is in history if we have base64 data available
        if let Some(image_data) = base64_for_history {
            debug!("[Sync] Checking persistence for skin data...");
            let clean_base64 = if let Some(pos) = image_data.find(',') {
                &image_data[pos + 1..]
            } else {
                &image_data
            };

            if let Ok(bytes) = general_purpose::STANDARD.decode(clean_base64) {
                let texture_key = compute_texture_key(&bytes);
                let default_skins = piston_lib::api::minecraft_skins::get_default_skins();
                let is_default = default_skins.iter().any(|s| {
                    let variants = [
                        piston_lib::models::common::MinecraftSkinVariant::Classic,
                        piston_lib::models::common::MinecraftSkinVariant::Slim,
                    ];
                    variants.iter().any(|v| {
                        let tex_url = s.get_texture(*v);
                        let tex_str: &str = tex_url.as_ref();
                        let mojang_str: &str = mojang_skin.url.as_ref();
                        tex_str == mojang_str
                    })
                });

                if !is_default {
                    let new_history = NewAccountSkinHistory {
                        account_uuid: acc.uuid.clone(),
                        texture_key: texture_key.clone(),
                        name: "Mojang Sync".to_string(),
                        variant: server_variant.to_string(),
                        image_data: image_data.clone(),
                        source: "mojang".to_string(),
                    };

                    match diesel::insert_into(account_skin_history::table)
                        .values(&new_history)
                        .on_conflict((
                            account_skin_history::account_uuid,
                            account_skin_history::texture_key,
                        ))
                        .do_update()
                        .set((
                            account_skin_history::variant.eq(server_variant.to_string()),
                            account_skin_history::image_data.eq(image_data),
                            account_skin_history::added_at.eq(diesel::dsl::sql::<
                                diesel::sql_types::Text,
                            >(
                                "CURRENT_TIMESTAMP"
                            )),
                        ))
                        .execute(&mut conn)
                    {
                        Ok(_) => {
                            debug!(
                                "[Sync] Persistence: Upserted skin history for account={} texture_key={}",
                                acc.uuid, texture_key
                            );
                        }
                        Err(e) => {
                            warn!(
                                "[Sync] Persistence: Failed to upsert skin history for account={} texture_key={}: {}",
                                acc.uuid, texture_key, e
                            );
                        }
                    }
                } else {
                    info!("[Sync] Persistence: Current skin matches a default look. Skipping history.");
                }
            } else {
                warn!("[Sync] Persistence: Failed to decode base64 data for hashing");
            }
        } else {
            warn!(
                "[Sync] Persistence: No image data available to check history for {}",
                acc.uuid
            );
        }
    } else {
        warn!(
            "[Sync] No active skin found on Mojang profile for {}",
            acc.uuid
        );
    }

    if let Some(mojang_cape) = active_cape {
        let cape_url_changed = acc.cape_url.as_deref() != Some(mojang_cape.url.as_str());
        let cape_url = mojang_cape.url.clone();

        if cape_url_changed {
            acc.cape_url = Some(cape_url.clone());
            needs_db_update = true;
        }

        if let Err(e) =
            get_or_cache_cape_bytes(app_handle.as_ref(), &acc.uuid, &mojang_cape.id, &cape_url)
                .await
        {
            warn!("[Sync] Failed to cache active cape for {}: {}", acc.uuid, e);
        }
    } else if acc.cape_url.is_some() {
        acc.cape_url = None;
        needs_db_update = true;
    }

    if needs_db_update {
        let _ = diesel::update(account::table.filter(account::uuid.eq(&acc.uuid)))
            .set((
                account::skin_url.eq(acc.skin_url),
                account::skin_data.eq(acc.skin_data),
                account::skin_variant.eq(acc.skin_variant),
                account::cape_url.eq(acc.cape_url),
            ))
            .execute(&mut conn);

        if let Some(app) = app_handle {
            let _ = app.emit("core://account-heads-updated", ());

            if notify_remote_change && remote_change_detected {
                let manager = app.state::<crate::notifications::manager::NotificationManager>();
                let _ = manager.create(crate::notifications::models::CreateNotificationInput {
                    client_key: Some("remote_skin_update".into()),
                    title: Some("Profile Synced".into()),
                    description: Some(
                        "Your Minecraft skin/cape was updated to match your Mojang profile.".into(),
                    ),
                    notification_type: Some(
                        crate::notifications::models::NotificationType::Immediate,
                    ),
                    severity: Some("info".into()),
                    dismissible: Some(true),
                    ..Default::default()
                });
            }
        }
    }

    Ok(())
}

impl Task for SyncAccountProfilesTask {
    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        Box::pin(async move {
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

            let accounts = account::table
                .filter(account::account_type.ne("Guest".to_string()))
                .filter(account::account_type.ne("Demo".to_string()))
                .load::<Account>(&mut conn)
                .map_err(|e| e.to_string())?;

            if accounts.is_empty() {
                return Ok(());
            }

            ctx.update_full(0, "Initializing sync...".into(), Some(1), Some(100));

            let total = accounts.len();
            for (idx, acc) in accounts.into_iter().enumerate() {
                let p = (((idx + 1) as f32 / total as f32) * 100.0) as i32;
                ctx.update_full(
                    p,
                    format!("Syncing profile for {}", acc.username),
                    Some((idx + 1) as i32),
                    Some(total as i32),
                );

                let _ =
                    sync_account_profile_data(&acc.uuid, Some(ctx.app_handle.clone()), true).await;
            }

            Ok(())
        })
    }

    fn name(&self) -> String {
        "Sync Profile Data".to_string()
    }
}
