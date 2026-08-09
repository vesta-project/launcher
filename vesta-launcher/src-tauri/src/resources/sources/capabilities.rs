use crate::models::resource::{ResourceType, SourcePlatform};
use serde::Serialize;

/// Declarative metadata for a registered content source.
/// UI and peer logic should read this instead of hardcoding platform pairs.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceCapabilities {
    pub platform: SourcePlatform,
    pub display_name: String,
    pub supported_resource_types: Vec<ResourceType>,
    pub default_sort: String,
    pub sort_options: Vec<String>,
    pub supports_hash_lookup: bool,
    pub peer_platforms: Vec<SourcePlatform>,
    /// Source may expose multiple artifacts per version (e.g. datapack + resourcepack).
    pub multi_artifact_versions: bool,
}

impl SourceCapabilities {
    pub fn for_platform(platform: SourcePlatform) -> Self {
        match platform {
            SourcePlatform::Modrinth => Self {
                platform,
                display_name: platform.display_name().to_string(),
                supported_resource_types: vec![
                    ResourceType::Mod,
                    ResourceType::ResourcePack,
                    ResourceType::Shader,
                    ResourceType::DataPack,
                    ResourceType::Modpack,
                    ResourceType::World,
                ],
                default_sort: "relevance".to_string(),
                sort_options: vec![
                    "relevance".into(),
                    "downloads".into(),
                    "follows".into(),
                    "newest".into(),
                    "updated".into(),
                ],
                supports_hash_lookup: true,
                peer_platforms: vec![SourcePlatform::CurseForge],
                multi_artifact_versions: false,
            },
            SourcePlatform::CurseForge => Self {
                platform,
                display_name: platform.display_name().to_string(),
                supported_resource_types: vec![
                    ResourceType::Mod,
                    ResourceType::ResourcePack,
                    ResourceType::Shader,
                    ResourceType::DataPack,
                    ResourceType::Modpack,
                    ResourceType::World,
                ],
                default_sort: "featured".to_string(),
                sort_options: vec![
                    "featured".into(),
                    "popularity".into(),
                    "totalDownloads".into(),
                    "lastUpdated".into(),
                    "name".into(),
                    "dateCreated".into(),
                ],
                supports_hash_lookup: true,
                peer_platforms: vec![SourcePlatform::Modrinth],
                multi_artifact_versions: false,
            },
            SourcePlatform::Smithed => Self {
                platform,
                display_name: platform.display_name().to_string(),
                supported_resource_types: vec![ResourceType::DataPack, ResourceType::ResourcePack],
                default_sort: "trending".to_string(),
                sort_options: vec![
                    "trending".into(),
                    "downloads".into(),
                    "alphabetically".into(),
                    "newest".into(),
                ],
                supports_hash_lookup: false,
                peer_platforms: vec![],
                multi_artifact_versions: true,
            },
        }
    }

    pub fn all_registered() -> Vec<Self> {
        SourcePlatform::ALL
            .into_iter()
            .map(Self::for_platform)
            .collect()
    }

    pub fn supports_resource_type(&self, resource_type: ResourceType) -> bool {
        self.supported_resource_types.contains(&resource_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smithed_is_pack_oriented_without_peers() {
        let caps = SourceCapabilities::for_platform(SourcePlatform::Smithed);
        assert!(caps.supports_resource_type(ResourceType::DataPack));
        assert!(caps.supports_resource_type(ResourceType::ResourcePack));
        assert!(!caps.supports_resource_type(ResourceType::Mod));
        assert!(caps.peer_platforms.is_empty());
        assert!(!caps.supports_hash_lookup);
        assert!(caps.multi_artifact_versions);
    }

    #[test]
    fn modrinth_and_curseforge_peer_each_other() {
        let mr = SourceCapabilities::for_platform(SourcePlatform::Modrinth);
        let cf = SourceCapabilities::for_platform(SourcePlatform::CurseForge);
        assert_eq!(mr.peer_platforms, vec![SourcePlatform::CurseForge]);
        assert_eq!(cf.peer_platforms, vec![SourcePlatform::Modrinth]);
    }

    #[test]
    fn catalog_covers_every_platform_variant() {
        let all = SourceCapabilities::all_registered();
        assert_eq!(all.len(), SourcePlatform::ALL.len());
        for platform in SourcePlatform::ALL {
            assert!(all.iter().any(|c| c.platform == platform));
        }
    }
}
