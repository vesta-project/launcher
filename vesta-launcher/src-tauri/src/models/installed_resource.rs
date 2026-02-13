use crate::schema::installed_resource;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Insertable, AsChangeset, Clone)]
#[diesel(table_name = installed_resource)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct InstalledResource {
    pub id: i32,
    pub instance_id: i32,
    pub platform: String,
    pub remote_id: String,
    pub remote_version_id: String,
    pub resource_type: String,
    pub local_path: String,
    pub display_name: String,
    pub current_version: String,
    pub is_manual: bool,
    pub is_enabled: bool,
    pub last_updated: String,
    pub release_type: String,
    pub hash: Option<String>,
    pub file_size: i64,
    pub file_mtime: i64,
}

#[derive(Insertable, Debug, Clone)]
#[diesel(table_name = installed_resource)]
pub struct NewInstalledResource {
    pub instance_id: i32,
    pub platform: String,
    pub remote_id: String,
    pub remote_version_id: String,
    pub resource_type: String,
    pub local_path: String,
    pub display_name: String,
    pub current_version: String,
    pub is_manual: bool,
    pub is_enabled: bool,
    pub last_updated: String,
    pub release_type: String,
    pub hash: Option<String>,
    pub file_size: i64,
    pub file_mtime: i64,
}
