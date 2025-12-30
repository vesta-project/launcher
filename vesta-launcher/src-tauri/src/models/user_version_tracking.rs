use crate::schema::user_version_tracking;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// Tracks user's last seen versions for notifications
#[derive(Queryable, Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = user_version_tracking)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserVersionTracking {
    pub id: i32,
    pub version_type: String,
    pub last_seen_version: String,
    pub last_seen_at: String,
    pub notified: bool,
}

/// New version tracking (without id for insertion)
#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = user_version_tracking)]
pub struct NewUserVersionTracking {
    pub version_type: String,
    pub last_seen_version: String,
    pub last_seen_at: String,
    pub notified: bool,
}
