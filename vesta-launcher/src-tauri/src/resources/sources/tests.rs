#[cfg(test)]
mod tests {
    use crate::resources::sources::modrinth::ModrinthSource;
    use crate::resources::sources::curseforge::CurseForgeSource;
    use crate::resources::sources::ResourceSource;
    use crate::models::resource::{SearchQuery, ResourceType};

    #[tokio::test]
    async fn test_modrinth_search() {
        let source = ModrinthSource::new();
        let query = SearchQuery {
            text: Some("Abandoned Prismarine Tower".to_string()),
            resource_type: ResourceType::Mod,
            limit: 1,
            ..Default::default()
        };

        let result = source.search(query).await;
        assert!(result.is_ok(), "Modrinth search failed: {:?}", result.err());
        let response = result.unwrap();
        assert!(!response.hits.is_empty(), "No hits found for Modrinth search");
        
        let project = &response.hits[0];
        assert_eq!(project.name, "Abandoned Prismarine Tower");
        assert!(project.author.len() > 0, "Author should not be empty");
        assert!(project.published_at.is_some(), "Published date should be present");
    }

    #[tokio::test]
    async fn test_curseforge_search() {
        let source = CurseForgeSource::new();
        let query = SearchQuery {
            text: Some("Mouse Tweaks".to_string()),
            resource_type: ResourceType::Mod,
            limit: 1,
            ..Default::default()
        };

        let result = source.search(query).await;
        assert!(result.is_ok(), "CurseForge search failed: {:?}", result.err());
        let response = result.unwrap();
        assert!(!response.hits.is_empty(), "No hits found for CurseForge search");
        
        let project = &response.hits[0];
        assert!(project.author.len() > 0, "Author should not be empty");
        assert!(project.published_at.is_some(), "Published date should be present");
    }

    #[tokio::test]
    async fn test_modrinth_versions() {
        let source = ModrinthSource::new();
        // Use the ID for Abandoned Prismarine Tower if known, or search first
        let versions = source.get_versions("abandoned-prismarine-tower", None, None).await;
        assert!(versions.is_ok(), "Modrinth get_versions failed: {:?}", versions.err());
        let versions = versions.unwrap();
        assert!(!versions.is_empty(), "No versions found for Modrinth project");
        
        for version in versions {
            assert!(version.download_url.starts_with("https://"), "Download URL should be absolute: {}", version.download_url);
        }
    }

    #[tokio::test]
    async fn test_curseforge_versions() {
        let source = CurseForgeSource::new();
        
        // First search for the mod to get a fresh ID
        let query = SearchQuery {
            text: Some("Mouse Tweaks".to_string()),
            resource_type: ResourceType::Mod,
            limit: 1,
            ..Default::default()
        };
        
        let search_result = source.search(query).await;
        assert!(search_result.is_ok(), "CurseForge search in versions test failed");
        let hits = search_result.unwrap().hits;
        assert!(!hits.is_empty(), "Could not find Mouse Tweaks to test versions");
        
        let project_id = &hits[0].id;
        let versions = source.get_versions(project_id, None, None).await;
        assert!(versions.is_ok(), "CurseForge get_versions failed for ID {}: {:?}", project_id, versions.err());
        let versions = versions.unwrap();
        assert!(!versions.is_empty(), "No versions found for CurseForge project {}", project_id);
        
        for version in versions {
            if !version.download_url.is_empty() {
                assert!(version.download_url.starts_with("http"), "Download URL should be absolute: {}", version.download_url);
            }
        }
    }
}
