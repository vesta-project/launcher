use crate::schema::account;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// Microsoft account for authentication
///
/// Stores OAuth tokens and user information for Microsoft authentication.
#[derive(Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone)]
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
    pub cape_data: Option<String>,
    pub theme_data: Option<String>,
    pub theme_window_effect: Option<String>,
    pub theme_background_opacity: Option<i32>,
}

impl diesel::Queryable<crate::schema::account::SqlType, diesel::sqlite::Sqlite> for Account {
    type Row = (
        i32,            // id
        String,         // uuid
        String,         // username
        Option<String>, // display_name
        Option<String>, // access_token
        Option<String>, // refresh_token
        Option<String>, // token_expires_at
        bool,           // is_active
        Option<String>, // skin_url
        Option<String>, // cape_url
        Option<String>, // created_at
        Option<String>, // updated_at
        Option<String>, // theme_id
        String,         // account_type
        bool,           // is_expired
        String,         // skin_variant
        Option<String>, // skin_data
        Option<String>, // cape_data
        Option<String>, // theme_data
        Option<String>, // theme_window_effect
        Option<i32>,    // theme_background_opacity
    );

    fn build(row: Self::Row) -> diesel::deserialize::Result<Self> {
        Ok(Account {
            id: row.0,
            uuid: row.1,
            username: row.2,
            display_name: row.3,
            access_token: row.4,
            refresh_token: row.5,
            token_expires_at: row.6,
            is_active: row.7,
            skin_url: row.8,
            cape_url: row.9,
            created_at: row.10,
            updated_at: row.11,
            theme_id: row.12,
            account_type: row.13,
            is_expired: row.14,
            skin_variant: row.15,
            skin_data: row.16,
            cape_data: row.17,
            theme_data: row.18,
            theme_window_effect: row.19,
            theme_background_opacity: row.20,
        })
    }
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
    pub cape_data: Option<String>,
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
            cape_data: None,
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
            cape_data: None,
            theme_data: None,
            theme_window_effect: None,
            theme_background_opacity: None,
        }
    }
}
