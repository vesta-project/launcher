use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum ResourceType {
    #[default]
    Mod,
    ResourcePack,
    Shader,
    DataPack,
    Modpack,
    World,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SourcePlatform {
    Modrinth,
    CurseForge,
}

#[derive(Debug, Serialize, Deserialize, Clone, Queryable, Insertable)]
#[diesel(table_name = crate::schema::vesta::resource_metadata_cache)]
pub struct ResourceMetadataCacheRecord {
    pub id: Option<i32>,
    pub source: String,
    pub remote_id: String,
    pub project_data: String,
    pub versions_data: Option<String>,
    pub last_updated: chrono::NaiveDateTime,
    pub expires_at: chrono::NaiveDateTime,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourceProject {
    pub id: String,
    pub source: SourcePlatform,
    pub resource_type: ResourceType,
    pub name: String,
    pub summary: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub author: String,
    pub download_count: u64,
    pub follower_count: u64,
    pub categories: Vec<String>,
    pub web_url: String,
    pub external_ids: Option<std::collections::HashMap<String, String>>,
    pub gallery: Vec<String>,
    pub published_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseType {
    Release,
    Beta,
    Alpha,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DependencyType {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourceDependency {
    pub project_id: String,
    pub version_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: DependencyType,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourceVersion {
    pub id: String,
    pub project_id: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub download_url: String,
    pub file_name: String,
    pub release_type: ReleaseType,
    pub hash: String, // SHA1
    pub dependencies: Vec<ResourceDependency>,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = crate::schema::vesta::resource_project)]
pub struct ResourceProjectRecord {
    pub id: String,
    pub source: String,
    pub name: String,
    pub summary: String,
    pub icon_url: Option<String>,
    pub icon_data: Option<Vec<u8>>,
    pub project_type: String,
    pub last_updated: chrono::NaiveDateTime,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SearchQuery {
    pub text: Option<String>,
    pub resource_type: ResourceType,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub categories: Option<Vec<String>>,
    pub facets: Option<Vec<String>>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResponse {
    pub hits: Vec<ResourceProject>,
    pub total_hits: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourceCategory {
    pub id: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub project_type: Option<ResourceType>,
    pub parent_id: Option<String>,
    pub display_index: Option<i32>,
}
