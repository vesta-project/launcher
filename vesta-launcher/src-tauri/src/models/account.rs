use crate::utils::sqlite::{SqlTable, AUTOINCREMENT};
use piston_macros::SqlTable;
use serde::{Deserialize, Serialize};

/// Microsoft account for authentication
///
/// Stores OAuth tokens and user information for Microsoft authentication.
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.4.5")]
#[migration_description("Microsoft OAuth authentication")]
pub struct Account {
    #[primary_key]
    #[autoincrement]
    pub id: AUTOINCREMENT,

    #[unique]
    #[not_null]
    pub uuid: String,

    #[not_null]
    pub username: String,

    pub display_name: Option<String>,

    pub access_token: Option<String>,

    pub refresh_token: Option<String>,

    pub token_expires_at: Option<String>, // DATETIME as TEXT in SQLite

    pub is_active: bool,

    pub skin_url: Option<String>,

    pub cape_url: Option<String>,

    pub created_at: Option<String>, // DATETIME as TEXT in SQLite

    pub updated_at: Option<String>, // DATETIME as TEXT in SQLite
}

impl Default for Account {
    fn default() -> Self {
        Self::new(
            String::new(),
            String::new(),
            None,
            None,
            None,
            None,
            true,
            None,
            None,
            None,
            None,
        )
    }
}

impl Account {
    /// Get indices to create for this table
    pub fn get_indices() -> Vec<String> {
        vec![
            "CREATE INDEX IF NOT EXISTS idx_account_uuid ON account(uuid)".to_string(),
            "CREATE INDEX IF NOT EXISTS idx_account_username ON account(username)".to_string(),
        ]
    }

    /// Get DROP INDEX statements for rollback
    pub fn get_drop_indices() -> Vec<String> {
        vec![
            "DROP INDEX IF EXISTS idx_account_username".to_string(),
            "DROP INDEX IF EXISTS idx_account_uuid".to_string(),
        ]
    }
}
