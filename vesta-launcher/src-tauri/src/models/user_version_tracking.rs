use crate::utils::sqlite::{SqlTable, AUTOINCREMENT};
use piston_macros::SqlTable;
use serde::{Deserialize, Serialize};

/// Tracks user's last seen versions for notifications
/// Used to detect when new Minecraft versions are available
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.6.0")]
#[migration_description("User version tracking for update notifications")]
pub struct UserVersionTracking {
    #[primary_key]
    #[autoincrement]
    pub id: AUTOINCREMENT,

    /// Type of version being tracked (minecraft_release, minecraft_snapshot, etc.)
    #[not_null]
    pub version_type: String,

    /// The last version the user has seen/notified about
    #[not_null]
    pub last_seen_version: String,

    /// When this version was last seen/notified
    #[not_null]
    pub last_seen_at: String,

    /// Whether user has been notified about this version
    pub notified: bool,
}

impl Default for UserVersionTracking {
    fn default() -> Self {
        Self {
            id: AUTOINCREMENT::INIT,
            version_type: "minecraft_release".to_string(),
            last_seen_version: "1.21.1".to_string(), // Current latest as of Dec 2025
            last_seen_at: chrono::Utc::now().to_rfc3339(),
            notified: true, // Don't notify on first run
        }
    }
}

impl UserVersionTracking {
    /// Create a new version tracking entry
    pub fn create(version_type: String, version: String) -> Self {
        Self {
            id: AUTOINCREMENT::INIT,
            version_type,
            last_seen_version: version.clone(),
            last_seen_at: chrono::Utc::now().to_rfc3339(),
            notified: false,
        }
    }

    /// Get indices for this table
    pub fn get_indices() -> Vec<String> {
        vec![
            "CREATE INDEX IF NOT EXISTS idx_version_tracking_type ON user_version_tracking(version_type)".to_string(),
        ]
    }

    /// Get drop indices for rollback
    pub fn get_drop_indices() -> Vec<String> {
        vec![
            "DROP INDEX IF EXISTS idx_version_tracking_type".to_string(),
        ]
    }
}