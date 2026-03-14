use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::vesta::account_skin_history;

#[derive(Debug, Clone, Serialize, Deserialize, Queryable, Selectable, Insertable)]
#[diesel(table_name = account_skin_history)]
pub struct AccountSkinHistory {
    pub id: i32,
    pub account_uuid: String,
    pub texture_key: String,
    pub name: String,
    pub variant: String,
    pub image_data: String,
    pub source: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Insertable)]
#[diesel(table_name = account_skin_history)]
pub struct NewAccountSkinHistory {
    pub account_uuid: String,
    pub texture_key: String,
    pub name: String,
    pub variant: String,
    pub image_data: String,
    pub source: String,
}
