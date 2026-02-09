use crate::schema::pinned_page;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Queryable, Selectable, Insertable, AsChangeset, Serialize, Deserialize, Clone)]
#[diesel(table_name = pinned_page)]
pub struct PinnedPage {
    pub id: i32,
    pub page_type: String,
    pub target_id: String,
    pub platform: Option<String>,
    pub label: String,
    pub icon_url: Option<String>,
    pub order_index: i32,
    pub created_at: Option<String>,
}

#[derive(Debug, Insertable, Deserialize)]
#[diesel(table_name = pinned_page)]
pub struct NewPinnedPage {
    pub page_type: String,
    pub target_id: String,
    pub platform: Option<String>,
    pub label: String,
    pub icon_url: Option<String>,
    pub order_index: i32,
}
