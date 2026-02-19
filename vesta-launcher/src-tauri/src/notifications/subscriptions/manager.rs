use anyhow::Result;
use std::sync::Arc;
use crate::models::{NotificationSubscription, NewNotificationSeenItem};
use crate::notifications::subscriptions::{SubscriptionProvider, providers::*};
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationType};
use tauri::{AppHandle, Manager};
use diesel::prelude::*;

pub struct SubscriptionManager {
    providers: Vec<Arc<dyn SubscriptionProvider>>,
    app_handle: AppHandle,
}

impl SubscriptionManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let providers: Vec<Arc<dyn SubscriptionProvider>> = vec![
            Arc::new(MojangNewsProvider),
            Arc::new(PatchNotesProvider),
            Arc::new(RSSProvider),
            Arc::new(ResourceProvider),
        ];

        Self {
            providers,
            app_handle,
        }
    }

    pub async fn check_all(&self) -> Result<()> {
        let subs = self.get_enabled_subscriptions()?;
        
        for sub in subs {
            let provider = self.providers.iter().find(|p| p.provider_type() == sub.provider_type);
            
            if let Some(provider) = provider {
                match provider.check(&self.app_handle, &sub).await {
                    Ok(items) => {
                        let is_first_run = sub.last_checked.is_none();
                        
                        for item in items {
                            if !self.is_seen(&sub.id, &item.id)? {
                                // If this is a new subscription, don't spam notifications for old items
                                if !is_first_run {
                                    if let Ok(_) = self.create_notification(&sub, &item) {
                                        if let Err(e) = self.mark_seen(&sub.id, &item.id) {
                                            log::error!("Failed to mark item seen {}: {}", item.id, e);
                                        }
                                    }
                                } else {
                                    // Just mark as seen for the first run
                                    let _ = self.mark_seen(&sub.id, &item.id);
                                }
                            }
                        }
                        
                        // Update last_checked
                        let _ = self.update_last_checked(&sub.id);
                    }
                    Err(e) => {
                        log::error!("Failed to check subscription {}: {}", sub.title, e);
                    }
                }
            } else {
                log::warn!("No provider found for type: {}", sub.provider_type);
            }
        }
        
        Ok(())
    }

    fn update_last_checked(&self, sub_id_str: &str) -> Result<()> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        diesel::update(notification_subscriptions.filter(id.eq(sub_id_str)))
            .set(last_checked.eq(chrono::Utc::now().to_rfc3339()))
            .execute(&mut conn)?;
        Ok(())
    }

    pub fn start_polling(self: Arc<Self>) {
        let sm = self.clone();
        tauri::async_runtime::spawn(async move {
            log::info!("Starting notification subscription polling loop...");
            
            // Delay initial polling by 15 seconds to avoid competing with other startup work
            // (e.g. database migrations, initial config/account loading, and network setup).
            // This helps prevent a burst of subscription network requests and DB writes
            // immediately on launch. If the app's startup sequence changes, this delay may be
            // reduced or removed, but keep in mind the potential impact on startup load.
            // TODO: Consider a more sophisticated startup coordination mechanism in the future if needed.
            tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

            loop {
                if let Err(e) = sm.check_all().await {
                    log::error!("Error in subscription polling: {}", e);
                }
                
                // Poll every hour
                tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
            }
        });
    }

    fn get_enabled_subscriptions(&self) -> Result<Vec<NotificationSubscription>> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        notification_subscriptions
            .filter(enabled.eq(true))
            .load::<NotificationSubscription>(&mut conn)
            .map_err(|e| anyhow::anyhow!(e))
    }

    fn is_seen(&self, sub_id_str: &str, item_id_str: &str) -> Result<bool> {
        use crate::schema::notification_seen_items::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        let count = notification_seen_items
            .filter(subscription_id.eq(sub_id_str))
            .filter(item_id.eq(item_id_str))
            .count()
            .get_result::<i64>(&mut conn)?;
        Ok(count > 0)
    }

    fn mark_seen(&self, sub_id_str: &str, item_id_str: &str) -> Result<()> {
        use crate::schema::notification_seen_items::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        let new_item = NewNotificationSeenItem {
            subscription_id: sub_id_str.to_string(),
            item_id: item_id_str.to_string(),
            seen_at: chrono::Utc::now().to_rfc3339(),
        };
        diesel::insert_into(notification_seen_items)
            .values(&new_item)
            .execute(&mut conn)?;
        Ok(())
    }

    fn create_notification(&self, _sub: &NotificationSubscription, item: &crate::notifications::subscriptions::NotificationUpdateItem) -> Result<()> {
        let nm = self.app_handle.state::<NotificationManager>();
        
        let actions = if let Some(link) = &item.link {
            let action = serde_json::json!([{
                "label": "Read More",
                "id": "open_url",
                "type": "primary",
                "payload": {
                    "url": link
                }
            }]);
            Some(action.to_string())
        } else {
            None
        };

        nm.create(CreateNotificationInput {
            // Use item.id directly to allow de-duplication across different subscriptions
            // that might contain the same notification item.
            client_key: Some(format!("notif_item_{}", item.id)),
            title: Some(item.title.clone()),
            description: item.description.clone(),
            severity: Some(item.severity.clone().unwrap_or_else(|| "info".to_string())),
            notification_type: Some(NotificationType::Patient),
            dismissible: Some(true),
            progress: None,
            current_step: None,
            total_steps: None,
            actions,
            metadata: Some(item.metadata.to_string()),
            show_on_completion: None,
        })?;
        
        Ok(())
    }

    pub fn get_available_sources(&self) -> Vec<crate::notifications::subscriptions::AvailableNotificationSource> {
        let mut all_sources = Vec::new();
        for provider in &self.providers {
            all_sources.extend(provider.get_available_sources());
        }
        all_sources
    }

    pub fn reset_seen_items(&self) -> Result<()> {
        use crate::schema::notification_seen_items::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        diesel::delete(notification_seen_items).execute(&mut conn)?;
        Ok(())
    }

    pub fn reset_system(&self) -> Result<()> {
        self.reset_seen_items()
    }

    pub fn get_all_subscriptions(&self) -> Result<Vec<NotificationSubscription>> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        notification_subscriptions
            .load::<NotificationSubscription>(&mut conn)
            .map_err(|e| anyhow::anyhow!(e))
    }

    pub fn toggle_subscription(&self, sub_id_str: String, is_enabled: bool) -> Result<()> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        diesel::update(notification_subscriptions.filter(id.eq(sub_id_str)))
            .set(enabled.eq(is_enabled))
            .execute(&mut conn)?;
        Ok(())
    }

    pub fn update_metadata(&self, sub_id_str: String, new_metadata: String) -> Result<()> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        diesel::update(notification_subscriptions.filter(id.eq(sub_id_str)))
            .set(metadata.eq(new_metadata))
            .execute(&mut conn)?;
        Ok(())
    }

    pub fn delete_subscription(&self, sub_id_str: String) -> Result<()> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        diesel::delete(notification_subscriptions.filter(id.eq(sub_id_str)))
            .execute(&mut conn)?;
        Ok(())
    }

    pub fn subscribe_resource(&self, project_id: String, platform: String, resource_title: String) -> Result<String> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        
        // Check if already subscribed
        let existing = notification_subscriptions
            .filter(provider_type.eq("resource"))
            .filter(target_id.eq(&project_id))
            .first::<NotificationSubscription>(&mut conn)
            .optional()?;
            
        if let Some(s) = existing {
            if !s.enabled {
                self.toggle_subscription(s.id.clone(), true)?;
            }
            return Ok(s.id);
        }

        let new_sub = crate::models::notification_subscription::NewNotificationSubscription {
            id: uuid::Uuid::new_v4().to_string(),
            provider_type: "resource".to_string(),
            target_url: None,
            target_id: Some(project_id),
            title: format!("Update: {}", resource_title),
            enabled: true,
            metadata: Some(serde_json::json!({"platform": platform}).to_string()),
            last_checked: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };

        diesel::insert_into(notification_subscriptions)
            .values(&new_sub)
            .execute(&mut conn)?;
            
        Ok(new_sub.id)
    }

    pub fn subscribe(
        &self,
        p_type: String,
        title_str: String,
        url: Option<String>,
        t_id: Option<String>,
        meta: Option<String>,
    ) -> Result<String> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;

        // Check if already subscribed
        let mut query = notification_subscriptions
            .filter(provider_type.eq(&p_type))
            .into_boxed();

        if let Some(ref u) = url {
            query = query.filter(target_url.eq(u));
        }
        if let Some(ref target_id_val) = t_id {
            query = query.filter(target_id.eq(target_id_val));
        }

        let existing = query.first::<NotificationSubscription>(&mut conn).optional()?;

        if let Some(s) = existing {
            if !s.enabled {
                self.toggle_subscription(s.id.clone(), true)?;
            }
            return Ok(s.id);
        }

        let new_sub = crate::models::notification_subscription::NewNotificationSubscription {
            id: uuid::Uuid::new_v4().to_string(),
            provider_type: p_type,
            target_url: url,
            target_id: t_id,
            title: title_str,
            enabled: true,
            metadata: meta,
            last_checked: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };

        diesel::insert_into(notification_subscriptions)
            .values(&new_sub)
            .execute(&mut conn)?;

        Ok(new_sub.id)
    }

    pub fn subscribe_rss(&self, url_str: String, title_str: String) -> Result<String> {
        self.subscribe("rss".to_string(), title_str, Some(url_str), None, None)
    }

    /// Initialize default subscriptions if they don't exist
    pub fn initialize_defaults(&self) -> Result<()> {
        use crate::schema::notification_subscriptions::dsl::*;
        let mut conn = crate::utils::db::get_vesta_conn()?;
        
        let count = notification_subscriptions.count().get_result::<i64>(&mut conn)?;
        if count == 0 {
            let available = self.get_available_sources();
            for source in available {
                let new_sub = crate::models::notification_subscription::NewNotificationSubscription {
                    id: uuid::Uuid::new_v4().to_string(),
                    provider_type: source.provider_type,
                    target_url: source.target_url,
                    target_id: source.target_id,
                    title: source.title,
                    enabled: true,
                    metadata: source.metadata,
                    last_checked: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                };
                
                diesel::insert_into(notification_subscriptions)
                    .values(&new_sub)
                    .execute(&mut conn)?;
            }
        }
        
        Ok(())
    }
}
