use diesel::QueryableByName;
use diesel::sql_types::{Nullable, Text};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct GDResourceHint {
    pub project_id: String,
    pub version_id: String,
    pub platform: String,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GDLegacyConfig {
    pub loader: GDLegacyLoader,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GDLegacyLoader {
    pub loader_type: String,
    pub loader_version: Option<String>,
    pub mc_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GDCarbonInstance {
    pub name: Option<String>,
    #[serde(default)]
    pub game_configuration: Option<GDCarbonGameConfiguration>,
    #[serde(default)]
    pub modpack: Option<GDCarbonModpack>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GDCarbonGameConfiguration {
    #[serde(default)]
    pub version: Option<GDCarbonVersionInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GDCarbonVersionInfo {
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub modloaders: Vec<GDCarbonModloader>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GDCarbonModloader {
    #[serde(rename = "type")]
    pub loader_type: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GDCarbonModpack {
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    #[serde(alias = "projectId")]
    #[serde(alias = "projectID")]
    pub project_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "fileId")]
    #[serde(alias = "fileID")]
    pub file_id: Option<Value>,
}

#[derive(Debug, QueryableByName)]
pub(super) struct GDHintRow {
    #[diesel(sql_type = Nullable<Text>)]
    pub project_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub version_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub platform: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    pub file_name: Option<String>,
}
