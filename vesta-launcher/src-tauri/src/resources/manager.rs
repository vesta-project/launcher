use std::sync::Arc;
use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, SearchResponse};
use crate::resources::sources::ResourceSource;
use crate::resources::sources::modrinth::ModrinthSource;
use crate::resources::sources::curseforge::CurseForgeSource;
use anyhow::{Result, anyhow};

pub struct ResourceManager {
    sources: Vec<Arc<dyn ResourceSource>>,
}

impl ResourceManager {
    pub fn new() -> Self {
        let sources: Vec<Arc<dyn ResourceSource>> = vec![
            Arc::new(ModrinthSource::new()),
            Arc::new(CurseForgeSource::new()),
        ];
        
        Self { sources }
    }

    pub async fn search(&self, platform: SourcePlatform, query: SearchQuery) -> Result<SearchResponse> {
        let source = self.get_source(platform)?;
        source.search(query).await
    }

    pub async fn get_project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject> {
        let source = self.get_source(platform)?;
        source.get_project(id).await
    }

    pub async fn get_versions(&self, platform: SourcePlatform, project_id: &str) -> Result<Vec<ResourceVersion>> {
        let source = self.get_source(platform)?;
        source.get_versions(project_id).await
    }

    fn get_source(&self, platform: SourcePlatform) -> Result<&Arc<dyn ResourceSource>> {
        self.sources.iter()
            .find(|s| s.platform() == platform)
            .ok_or_else(|| anyhow!("Source platform not supported: {:?}", platform))
    }
}
