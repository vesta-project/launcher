use crate::schema::saved_themes;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Insertable, AsChangeset, Clone)]
#[diesel(table_name = saved_themes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SavedTheme {
    pub id: String,
    pub name: String,
    pub theme_data: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Insertable, Clone)]
#[diesel(table_name = saved_themes)]
pub struct NewSavedTheme {
    pub id: String,
    pub name: String,
    pub theme_data: String,
    pub created_at: String,
    pub updated_at: String,
}
