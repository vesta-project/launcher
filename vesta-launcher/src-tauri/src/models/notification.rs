use crate::utils::sqlite::{SqlTable, AUTOINCREMENT};
use piston_macros::SqlTable;
use serde::{Deserialize, Serialize};

/// Notification model for persisted notifications with flexible types
///
/// Supports four notification types:
/// - Alert: Non-dismissible critical notifications
/// - Progress: Task notifications with progress tracking
/// - Immediate: Auto-cleared on app restart (crashes, status updates)
/// - Patient: Persistent until manually dismissed (updates, releases)
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.5.1")]
#[migration_description("Added cancellable field")]
pub struct Notification {
    #[primary_key]
    #[autoincrement]
    pub id: AUTOINCREMENT,

    /// Optional unique key for external updates (e.g., "download:task123")
    /// Use this to update the same logical notification multiple times
    pub client_key: Option<String>,

    pub title: Option<String>,
    pub description: Option<String>,

    /// Severity level: "info", "success", "warning", "error"
    pub severity: String,

    /// Notification type: "alert", "progress", "immediate", "patient"
    /// Converted from old persist field:
    /// - persist=true -> "patient"
    /// - persist=false -> "immediate"
    pub notification_type: String,

    /// Whether this notification can be dismissed by the user
    /// - Alert: false (non-dismissible)
    /// - Progress: false (until complete)
    /// - Immediate: true
    /// - Patient: true
    pub dismissible: bool,

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

    /// JSON array of action buttons: [{id, label, type}]
    /// type can be: "primary", "secondary", "destructive"
    pub actions: Option<String>,

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
            "CREATE INDEX IF NOT EXISTS idx_notification_client_key ON notification(client_key)"
                .to_string(),
            // Index on created_at for retention cleanup queries
            "CREATE INDEX IF NOT EXISTS idx_notification_created_at ON notification(created_at)"
                .to_string(),
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

        // Verify table name (lowercase)
        assert!(schema.contains("CREATE TABLE IF NOT EXISTS notification"));

        // Verify key fields exist
        assert!(schema.contains("id"));
        assert!(schema.contains("client_key"));
        assert!(schema.contains("title"));
        assert!(schema.contains("description"));
        assert!(schema.contains("severity"));
        assert!(schema.contains("notification_type"));
        assert!(schema.contains("dismissible"));
        assert!(schema.contains("progress"));
        assert!(schema.contains("current_step"));
        assert!(schema.contains("total_steps"));
        assert!(schema.contains("read"));
        assert!(schema.contains("actions"));
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
