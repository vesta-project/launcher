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

impl SourcePlatform {
    pub const ALL: [SourcePlatform; 2] = [SourcePlatform::Modrinth, SourcePlatform::CurseForge];

    pub fn as_str(self) -> &'static str {
        match self {
            SourcePlatform::Modrinth => "modrinth",
            SourcePlatform::CurseForge => "curseforge",
        }
    }

    pub fn from_str_id(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "modrinth" => Some(SourcePlatform::Modrinth),
            "curseforge" => Some(SourcePlatform::CurseForge),
            _ => None,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            SourcePlatform::Modrinth => "Modrinth",
            SourcePlatform::CurseForge => "CurseForge",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Queryable, Insertable)]
#[diesel(table_name = crate::schema::vesta::resource_metadata_cache)]
pub struct ResourceMetadataCacheRecord {
    pub id: Option<i32>,
    pub source: String,
    pub remote_id: String,
    pub project_data: String,
    pub versions_data: Option<String>,
    pub last_updated: String,
    pub expires_at: String,
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
    pub authors: Vec<String>,
    pub download_count: u64,
    pub follower_count: u64,
    pub categories: Vec<String>,
    pub web_url: String,
    pub external_ids: Option<std::collections::HashMap<String, String>>,
    pub gallery: Vec<String>,
    pub featured_gallery: Option<String>,
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

/// A downloadable artifact belonging to a provider version. Roles allow the
/// shared installer to plan compound versions without knowing the provider.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ResourceVersionFile {
    pub url: String,
    pub file_name: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub file_size: Option<u64>,
    /// Semantic role such as `primary`, `datapack`, or `resourcepack`.
    pub role: String,
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
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub file_size: Option<u64>,
    /// All known artifacts for this version. Empty for legacy cache rows.
    #[serde(default)]
    pub files: Vec<ResourceVersionFile>,
}

impl ResourceVersion {
    pub fn file_for_role(&self, role: &str) -> Option<&ResourceVersionFile> {
        self.files.iter().find(|file| file.role == role)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResourceChangelogFormat {
    Markdown,
    Html,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResourceChangelogStatus {
    Available,
    Empty,
    Unavailable,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourceVersionDetails {
    pub version: ResourceVersion,
    pub changelog: Option<String>,
    pub changelog_format: ResourceChangelogFormat,
    pub changelog_status: ResourceChangelogStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = crate::schema::vesta::resource_project)]
pub struct ResourceProjectRecord {
    pub id: String,
    pub source: String,
    pub name: String,
    pub summary: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub icon_data: Option<Vec<u8>>,
    pub project_type: String,
    pub last_updated: String,
    pub metadata_synced_at: Option<String>,
    pub icon_synced_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = crate::schema::vesta::resource_project_peer)]
pub struct ResourceProjectPeerRecord {
    pub source: String,
    pub project_id: String,
    pub peer_source: String,
    pub peer_project_id: String,
    pub evidence: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProjectRef {
    pub platform: SourcePlatform,
    pub id: String,
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

#[cfg(test)]
mod tests {
    use super::ResourceVersion;

    #[test]
    fn cached_resource_version_without_detail_stats_still_deserializes() {
        let cached = r#"{
            "id":"version-1",
            "project_id":"project-1",
            "version_number":"1.0.0",
            "game_versions":["1.21.1"],
            "loaders":["fabric"],
            "download_url":"https://example.invalid/file.jar",
            "file_name":"file.jar",
            "release_type":"release",
            "hash":"abc123",
            "dependencies":[]
        }"#;

        let version: ResourceVersion = serde_json::from_str(cached).unwrap();

        assert_eq!(version.published_at, None);
        assert_eq!(version.download_count, None);
        assert_eq!(version.file_size, None);
    }
}
