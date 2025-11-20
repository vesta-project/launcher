use crate::utils::db_manager::get_data_db;
use crate::notifications::models::{Notification, NotificationSeverity, NotificationType};
use anyhow::Result;
use rusqlite::OptionalExtension;

pub struct NotificationStore;

impl NotificationStore {
    pub fn create(notification: &Notification) -> Result<i32> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        
        conn.execute(
            "INSERT INTO notification (
                client_key, title, description, severity, notification_type, dismissible,
                progress, current_step, total_steps, read, actions, metadata, 
                created_at, updated_at, expires_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                notification.client_key,
                notification.title,
                notification.description,
                notification.severity.to_string(),
                notification.notification_type.to_string(),
                notification.dismissible as i32,
                notification.progress,
                notification.current_step,
                notification.total_steps,
                notification.read as i32,
                serde_json::to_string(&notification.actions).ok(),
                notification.metadata,
                notification.created_at,
                notification.updated_at,
                notification.expires_at
            ],
        )?;
        
        Ok(conn.last_insert_rowid() as i32)
    }

    pub fn update(id: i32, notification: &Notification) -> Result<()> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        
        conn.execute(
            "UPDATE notification SET 
                title = ?1, description = ?2, severity = ?3, notification_type = ?4, dismissible = ?5,
                progress = ?6, current_step = ?7, total_steps = ?8, 
                actions = ?9, metadata = ?10, updated_at = ?11 
            WHERE id = ?12",
            rusqlite::params![
                notification.title,
                notification.description,
                notification.severity.to_string(),
                notification.notification_type.to_string(),
                notification.dismissible as i32,
                notification.progress,
                notification.current_step,
                notification.total_steps,
                serde_json::to_string(&notification.actions).ok(),
                notification.metadata,
                notification.updated_at,
                id
            ],
        )?;
        Ok(())
    }

    pub fn get_by_client_key(client_key: &str) -> Result<Option<Notification>> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        
        let mut stmt = conn.prepare("SELECT * FROM notification WHERE client_key = ?1")?;
        let notification = stmt.query_row([client_key], |row| {
            Ok(Self::map_row(row))
        }).optional()?;
        
        Ok(notification)
    }

    pub fn get_by_id(id: i32) -> Result<Option<Notification>> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        
        let mut stmt = conn.prepare("SELECT * FROM notification WHERE id = ?1")?;
        let notification = stmt.query_row([id], |row| {
            Ok(Self::map_row(row))
        }).optional()?;
        
        Ok(notification)
    }

    pub fn list(only_persisted: bool, only_unread: bool) -> Result<Vec<Notification>> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        
        let mut query = "SELECT * FROM notification WHERE 1=1".to_string();
        if only_persisted {
            // Convert old persist=true to new notification_type IN ('alert', 'patient', 'progress')
            query.push_str(" AND notification_type IN ('alert', 'patient', 'progress')");
        }
        if only_unread {
            query.push_str(" AND read = 0");
        }
        query.push_str(" ORDER BY created_at DESC");
        
        let mut stmt = conn.prepare(&query)?;
        let notifications = stmt.query_map([], |row| {
            Ok(Self::map_row(row))
        })?
        .collect::<Result<Vec<_>, _>>()?;
        
        Ok(notifications)
    }

    pub fn mark_read(id: i32) -> Result<()> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        conn.execute("UPDATE notification SET read = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete(id: i32) -> Result<()> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        conn.execute("DELETE FROM notification WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn cleanup(retention_days: i32) -> Result<usize> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let count = conn.execute(
            "DELETE FROM notification WHERE created_at < ?1 AND read = 1",
            [cutoff.to_rfc3339()],
        )?;
        Ok(count)
    }

    /// Clear all Immediate notifications (called on app startup)
    pub fn clear_immediate_notifications() -> Result<usize> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        let count = conn.execute(
            "DELETE FROM notification WHERE notification_type = 'immediate'",
            [],
        )?;
        Ok(count)
    }

    /// Get notifications by type
    pub fn get_by_type(notification_type: &str) -> Result<Vec<Notification>> {
        let db = get_data_db()?;
        let conn = db.get_connection();
        
        let mut stmt = conn.prepare("SELECT * FROM notification WHERE notification_type = ?1 ORDER BY created_at DESC")?;
        let notifications = stmt.query_map([notification_type], |row| {
            Ok(Self::map_row(row))
        })?
        .collect::<Result<Vec<_>, _>>()?;
        
        Ok(notifications)
    }

    fn map_row(row: &rusqlite::Row) -> Notification {
        // Migration support: convert old persist/cancellable fields to new notification_type/dismissible
        let notification_type = if let Ok(nt) = row.get::<_, String>("notification_type") {
            NotificationType::from(nt)
        } else {
            // Fallback: convert old persist field
            let persist = row.get::<_, i32>("persist").unwrap_or(0) == 1;
            if persist { NotificationType::Patient } else { NotificationType::Immediate }
        };
        
        let dismissible = if let Ok(d) = row.get::<_, i32>("dismissible") {
            d == 1
        } else {
            // Fallback: immediate and patient are dismissible, alert and progress are not
            matches!(notification_type, NotificationType::Immediate | NotificationType::Patient)
        };
        
        let actions_json = row.get::<_, Option<String>>("actions").ok().flatten();
        let actions = if let Some(json_str) = actions_json {
            serde_json::from_str(&json_str).unwrap_or_default()
        } else {
            Vec::new()
        };
        
        Notification {
            id: row.get("id").ok(),
            client_key: row.get("client_key").ok(),
            title: row.get("title").unwrap_or_default(),
            description: row.get("description").ok(),
            severity: NotificationSeverity::from(row.get::<_, String>("severity").unwrap_or_default()),
            notification_type,
            dismissible,
            progress: row.get("progress").ok(),
            current_step: row.get("current_step").ok(),
            total_steps: row.get("total_steps").ok(),
            read: row.get::<_, i32>("read").unwrap_or(0) == 1,
            actions,
            metadata: row.get("metadata").ok(),
            created_at: row.get("created_at").unwrap_or_default(),
            updated_at: row.get("updated_at").unwrap_or_default(),
            expires_at: row.get("expires_at").ok(),
        }
    }
}
