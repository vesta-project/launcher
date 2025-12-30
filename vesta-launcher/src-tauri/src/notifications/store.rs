use crate::models::notification::{NewNotification, Notification as DbNotification};
use crate::notifications::models::{
    Notification as DomainNotification, NotificationSeverity, NotificationType,
};
use crate::schema::notification::dsl::*;
use crate::utils::db::get_vesta_conn;
use anyhow::Result;
use diesel::prelude::*;

pub struct NotificationStore;

#[allow(dead_code)]
impl NotificationStore {
    // Helper to convert DB model to Domain model
    fn to_domain(db_model: DbNotification) -> DomainNotification {
        DomainNotification {
            id: Some(db_model.id),
            client_key: db_model.client_key,
            title: db_model.title.unwrap_or_default(),
            description: db_model.description,
            severity: NotificationSeverity::from(db_model.severity),
            notification_type: match db_model.notification_type.as_str() {
                "progress" => NotificationType::Progress,
                "patient" => NotificationType::Patient,
                "task" => NotificationType::Task,
                _ => NotificationType::Immediate, // Default
            },
            dismissible: db_model.dismissible,
            progress: db_model.progress,
            current_step: db_model.current_step,
            total_steps: db_model.total_steps,
            read: db_model.read,
            actions: db_model
                .actions
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default(),
            metadata: db_model.metadata,
            show_on_completion: db_model.show_on_completion,
            created_at: db_model.created_at,
            updated_at: db_model.updated_at,
            expires_at: db_model.expires_at,
        }
    }

    pub fn create(new_notification: &DomainNotification) -> Result<i32> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        // Prepare new notification for insertion
        let insert_data = NewNotification {
            client_key: new_notification.client_key.clone(),
            title: Some(new_notification.title.clone()),
            description: new_notification.description.clone(),
            severity: new_notification.severity.to_string(),
            notification_type: new_notification.notification_type.to_string(),
            dismissible: new_notification.dismissible,
            progress: new_notification.progress,
            current_step: new_notification.current_step,
            total_steps: new_notification.total_steps,
            read: new_notification.read,
            actions: serde_json::to_string(&new_notification.actions).ok(),
            metadata: new_notification.metadata.clone(),
            created_at: new_notification.created_at.clone(),
            updated_at: new_notification.updated_at.clone(),
            expires_at: new_notification.expires_at.clone(),
            show_on_completion: new_notification.show_on_completion, // Ensure model has this
        };

        diesel::insert_into(notification)
            .values(&insert_data)
            .execute(&mut conn)?;

        let inserted_id: i32 = notification.order(id.desc()).select(id).first(&mut conn)?;

        Ok(inserted_id)
    }

    pub fn update(target_id: i32, update_notification: &DomainNotification) -> Result<()> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        diesel::update(notification.find(target_id))
            .set((
                title.eq(&update_notification.title),
                description.eq(&update_notification.description),
                severity.eq(update_notification.severity.to_string()),
                notification_type.eq(update_notification.notification_type.to_string()),
                dismissible.eq(update_notification.dismissible),
                progress.eq(update_notification.progress),
                current_step.eq(update_notification.current_step),
                total_steps.eq(update_notification.total_steps),
                actions.eq(serde_json::to_string(&update_notification.actions).ok()),
                metadata.eq(&update_notification.metadata),
                updated_at.eq(&update_notification.updated_at),
                show_on_completion.eq(update_notification.show_on_completion),
            ))
            .execute(&mut conn)?;

        Ok(())
    }

    pub fn get_by_client_key(target_key: &str) -> Result<Option<DomainNotification>> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let result = notification
            .filter(client_key.eq(target_key))
            .first::<DbNotification>(&mut conn)
            .optional()?;

        Ok(result.map(Self::to_domain))
    }

    pub fn get_by_id(target_id: i32) -> Result<Option<DomainNotification>> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let result = notification
            .find(target_id)
            .first::<DbNotification>(&mut conn)
            .optional()?;

        Ok(result.map(Self::to_domain))
    }

    pub fn list(only_persisted: bool, only_unread: bool) -> Result<Vec<DomainNotification>> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let mut query = notification.into_boxed();

        if only_persisted {
            query = query.filter(
                notification_type
                    .eq("alert")
                    .or(notification_type.eq("patient"))
                    .or(notification_type.eq("progress")),
            );
        }

        if only_unread {
            query = query.filter(read.eq(false));
        }

        let results = query
            .order(created_at.desc())
            .load::<DbNotification>(&mut conn)?;

        Ok(results.into_iter().map(Self::to_domain).collect())
    }

    pub fn mark_read(target_id: i32) -> Result<()> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        diesel::update(notification.find(target_id))
            .set(read.eq(true))
            .execute(&mut conn)?;

        Ok(())
    }

    pub fn delete(target_id: i32) -> Result<()> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        diesel::delete(notification.find(target_id)).execute(&mut conn)?;

        Ok(())
    }

    pub fn cleanup(retention_days: i32) -> Result<usize> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let count = diesel::delete(
            notification
                .filter(created_at.lt(cutoff_str))
                .filter(read.eq(true)),
        )
        .execute(&mut conn)?;

        Ok(count)
    }

    /// Clear all Immediate notifications (called on app startup)
    pub fn clear_immediate_notifications() -> Result<usize> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let count = diesel::delete(notification.filter(notification_type.eq("immediate")))
            .execute(&mut conn)?;

        Ok(count)
    }

    /// Clear all dismissible notifications (Patient type and Progress with 100%)
    pub fn clear_all_dismissible_notifications() -> Result<usize> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let count = diesel::delete(notification.filter(dismissible.eq(true))).execute(&mut conn)?;

        Ok(count)
    }

    /// Clear all Progress notifications (called on app startup to remove old task notifications)
    pub fn clear_progress_notifications() -> Result<usize> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let count = diesel::delete(notification.filter(notification_type.eq("progress")))
            .execute(&mut conn)?;

        Ok(count)
    }

    /// Clear all task-related notifications (Progress and Patient from tasks)
    pub fn clear_task_notifications() -> Result<usize> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let count = diesel::delete(
            notification
                .filter(notification_type.eq("progress"))
                .or_filter(
                    notification_type
                        .eq("patient")
                        .and(client_key.like("task_%")),
                ),
        )
        .execute(&mut conn)?;

        Ok(count)
    }

    /// Get notifications by type
    pub fn get_by_type(target_type: &str) -> Result<Vec<DomainNotification>> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let results = notification
            .filter(notification_type.eq(target_type))
            .order(created_at.desc())
            .load::<DbNotification>(&mut conn)?;

        Ok(results.into_iter().map(Self::to_domain).collect())
    }
}
