use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResourceType {
    Mod,
    ResourcePack,
    Shader,
    DataPack,
    Modpack,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourcePlatform {
    Modrinth,
    CurseForge,
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
    pub categories: Vec<String>,
    pub web_url: String,
    pub screenshots: Vec<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseType {
    Release,
    Beta,
    Alpha,
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchQuery {
    pub text: Option<String>,
    pub resource_type: ResourceType,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub category: Option<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResponse {
    pub hits: Vec<ResourceProject>,
    pub total_hits: u64,
}
