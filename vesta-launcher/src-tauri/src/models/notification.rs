use serde::{Deserialize, Serialize};
use crate::utils::sqlite::{AUTOINCREMENT, SqlTable};
use piston_macros::SqlTable;

/// Notification model for persisted and ephemeral notifications
/// 
/// Supports both persistent notifications (stored in DB) and ephemeral progress
/// notifications for async tasks with progress tracking.
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.5.0")]
#[migration_description("Notification system with progress tracking")]
pub struct Notification {
    #[primary_key]
    #[autoincrement]
    pub id: AUTOINCREMENT,
    
    /// Optional unique key for external updates (e.g., "download:task123")
    /// Use this to update the same logical notification multiple times
    pub client_key: Option<String>,
    
    pub title: Option<String>,
    pub description: Option<String>,
    
    /// Severity level: "info", "success", "warning", "error", "debug"
    pub severity: String,
    
    /// Whether this notification should be persisted in the database
    /// false = ephemeral (toast only), true = stored and shown in sidebar
    pub persist: bool,
    
    /// Progress indicator:
    /// - null/None: no progress display
    /// - -1: pulsing loader (task initiating)
    /// - 0-100: progress percentage
    pub progress: Option<i32>,
    
    /// Optional step tracking for multi-step tasks
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    
    /// Whether the user has read this notification
    pub read: bool,
    
    /// Optional JSON metadata for custom data
    pub metadata: Option<String>,
    
    /// Timestamps
    pub created_at: String,
    pub updated_at: String,
    
    /// Optional expiration time for automatic cleanup
    pub expires_at: Option<String>,
}

impl Notification {
    /// Helper to create indices for the notifications table
    pub fn get_indices() -> Vec<String> {
        vec![
            // Index on client_key for fast lookups during updates
            "CREATE INDEX IF NOT EXISTS idx_notification_client_key ON notification(client_key)".to_string(),
            // Index on created_at for retention cleanup queries
            "CREATE INDEX IF NOT EXISTS idx_notification_created_at ON notification(created_at)".to_string(),
            // Index on read status for filtering unread notifications
            "CREATE INDEX IF NOT EXISTS idx_notification_read ON notification(read)".to_string(),
        ]
    }

    /// Helper to drop indices (for migration rollback)
    pub fn get_drop_indices() -> Vec<String> {
        vec![
            "DROP INDEX IF EXISTS idx_notification_client_key".to_string(),
            "DROP INDEX IF EXISTS idx_notification_created_at".to_string(),
            "DROP INDEX IF EXISTS idx_notification_read".to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::sqlite::SqlTable;

    #[test]
    fn test_notification_schema() {
        let schema = Notification::schema_sql();
        
        // Verify table name
        assert!(schema.contains("CREATE TABLE IF NOT EXISTS Notification"));
        
        // Verify key fields exist
        assert!(schema.contains("id"));
        assert!(schema.contains("client_key"));
        assert!(schema.contains("title"));
        assert!(schema.contains("description"));
        assert!(schema.contains("severity"));
        assert!(schema.contains("persist"));
        assert!(schema.contains("progress"));
        assert!(schema.contains("current_step"));
        assert!(schema.contains("total_steps"));
        assert!(schema.contains("read"));
        assert!(schema.contains("metadata"));
        assert!(schema.contains("created_at"));
        assert!(schema.contains("updated_at"));
        assert!(schema.contains("expires_at"));
        
        // Verify primary key and autoincrement
        assert!(schema.contains("PRIMARY KEY"));
        assert!(schema.contains("AUTOINCREMENT"));
    }

    #[test]
    fn test_notification_indices() {
        let indices = Notification::get_indices();
        
        assert_eq!(indices.len(), 3);
        assert!(indices[0].contains("idx_notification_client_key"));
        assert!(indices[1].contains("idx_notification_created_at"));
        assert!(indices[2].contains("idx_notification_read"));
    }
}
