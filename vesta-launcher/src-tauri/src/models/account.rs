use crate::schema::account;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// Microsoft account for authentication
///
/// Stores OAuth tokens and user information for Microsoft authentication.
#[derive(Queryable, Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone)]
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
    pub theme_mode: Option<String>,
    pub theme_primary_sat: Option<i32>,
    pub theme_primary_light: Option<i32>,
    pub theme_id: Option<String>,
    pub theme_primary_hue: Option<i32>,
    pub theme_style: Option<String>,
    pub theme_gradient_enabled: Option<bool>,
    pub theme_gradient_angle: Option<i32>,
    pub theme_gradient_type: Option<String>,
    pub theme_gradient_harmony: Option<String>,
    pub theme_advanced_overrides: Option<String>,
    pub theme_border_width: Option<i32>,
    pub account_type: String,
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
    pub theme_mode: Option<String>,
    pub theme_primary_hue: Option<i32>,
    pub theme_primary_sat: Option<i32>,
    pub theme_primary_light: Option<i32>,
    pub theme_style: Option<String>,
    pub theme_gradient_enabled: Option<bool>,
    pub theme_gradient_angle: Option<i32>,
    pub theme_gradient_type: Option<String>,
    pub theme_gradient_harmony: Option<String>,
    pub theme_advanced_overrides: Option<String>,
    pub theme_border_width: Option<i32>,
    pub account_type: String,
    pub is_expired: bool,
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
            theme_mode: None,
            theme_primary_hue: None,
            theme_primary_sat: None,
            theme_primary_light: None,
            theme_style: None,
            theme_gradient_enabled: None,
            theme_gradient_angle: None,
            theme_gradient_type: None,
            theme_gradient_harmony: None,
            theme_advanced_overrides: None,
            theme_border_width: None,
            account_type: "Microsoft".to_string(),
            is_expired: false,
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
            theme_mode: None,
            theme_primary_hue: None,
            theme_primary_sat: None,
            theme_primary_light: None,
            theme_style: None,
            theme_gradient_enabled: None,
            theme_gradient_angle: None,
            theme_gradient_type: None,
            theme_gradient_harmony: None,
            theme_advanced_overrides: None,
            theme_border_width: None,
            account_type: "Microsoft".to_string(),
            is_expired: false,
        }
    }
}
