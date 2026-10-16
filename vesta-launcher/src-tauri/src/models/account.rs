use crate::schema::account;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// Microsoft account for authentication
///
/// Stores OAuth tokens and user information for Microsoft authentication.
#[derive(Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone, Queryable)]
#[diesel(table_name = account)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Account {
    pub id: i32,
    pub uuid: String,
    pub username: String,
    pub display_name: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<String>,
    pub is_active: bool,
    pub skin_url: Option<String>,
    pub cape_url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub theme_id: Option<String>,
    pub account_type: String,
    pub is_expired: bool,
    pub skin_variant: String,
    pub skin_data: Option<String>,
    pub theme_data: Option<String>,
    pub theme_window_effect: Option<String>,
    pub theme_background_opacity: Option<i32>,
}

/// Display-only account projection. Never contains credentials or skin payloads.
#[derive(Selectable, Queryable, Serialize, Debug, Clone)]
#[diesel(table_name = account)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AccountSummary {
    pub uuid: String,
    pub username: String,
    pub account_type: String,
    pub is_active: bool,
    pub is_expired: bool,
}

/// New account (without id for insertion)
#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = account)]
pub struct NewAccount {
    pub uuid: String,
    pub username: String,
    pub display_name: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<String>,
    pub is_active: bool,
    pub skin_url: Option<String>,
    pub cape_url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub theme_id: Option<String>,
    pub account_type: String,
    pub is_expired: bool,
    pub skin_variant: String,
    pub skin_data: Option<String>,
    pub theme_data: Option<String>,
    pub theme_window_effect: Option<String>,
    pub theme_background_opacity: Option<i32>,
}

impl Default for Account {
    fn default() -> Self {
        Account {
            id: 0,
            uuid: String::new(),
            username: String::new(),
            display_name: None,
            access_token: None,
            refresh_token: None,
            token_expires_at: None,
            is_active: true,
            skin_url: None,
            cape_url: None,
            created_at: None,
            updated_at: None,
            theme_id: None,
            account_type: "Microsoft".to_string(),
            is_expired: false,
            skin_variant: "classic".into(),
            skin_data: None,
            theme_data: None,
            theme_window_effect: None,
            theme_background_opacity: None,
        }
    }
}

impl Default for NewAccount {
    fn default() -> Self {
        NewAccount {
            uuid: String::new(),
            username: String::new(),
            display_name: None,
            access_token: None,
            refresh_token: None,
            token_expires_at: None,
            is_active: true,
            skin_url: None,
            cape_url: None,
            created_at: None,
            updated_at: None,
            theme_id: None,
            account_type: "Microsoft".to_string(),
            is_expired: false,
            skin_variant: "classic".into(),
            skin_data: None,
            theme_data: None,
            theme_window_effect: None,
            theme_background_opacity: None,
        }
    }
}

#[cfg(test)]
mod summary_tests {
    use super::AccountSummary;

    #[test]
    fn account_display_snapshot_has_only_public_fields() {
        let summary = AccountSummary {
            uuid: "player-id".into(),
            username: "Player".into(),
            account_type: "Microsoft".into(),
            is_active: true,
            is_expired: false,
        };
        let value = serde_json::to_value(summary).unwrap();
        let mut keys: Vec<_> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "account_type",
                "is_active",
                "is_expired",
                "username",
                "uuid"
            ]
        );
    }
}
