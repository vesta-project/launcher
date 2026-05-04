use diesel::QueryableByName;
use diesel::sql_types::{Nullable, Text};
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct ModrinthResourceHint {
    pub project_id: String,
    pub version_id: String,
    pub file_name: Option<String>,
}

#[derive(Debug, QueryableByName)]
pub(super) struct DbProfileRow {
    #[diesel(sql_type = Text)]
    pub path: String,
    #[diesel(sql_type = Text)]
    pub name: String,
    #[diesel(sql_type = Nullable<Text>)]
    pub icon_path: Option<String>,
    #[diesel(sql_type = Text)]
    pub game_version: String,
    #[diesel(sql_type = Text)]
    pub mod_loader: String,
    #[diesel(sql_type = Nullable<Text>)]
    pub mod_loader_version: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub linked_project_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub linked_version_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModrinthProfile {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub game_version: Option<String>,
    #[serde(default)]
    pub loader: Option<String>,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub linked_project_id: Option<String>,
    #[serde(default)]
    pub linked_version_id: Option<String>,
    #[serde(default)]
    pub icon_path: Option<String>,
}

#[derive(Debug, QueryableByName)]
pub(super) struct ModrinthHintRow {
    #[diesel(sql_type = Nullable<Text>)]
    pub project_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub version_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub file_name: Option<String>,
}
