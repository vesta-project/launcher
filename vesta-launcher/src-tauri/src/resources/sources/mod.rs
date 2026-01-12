use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, SearchResponse};
use async_trait::async_trait;
use anyhow::Result;

pub mod modrinth;
pub mod curseforge;

#[cfg(test)]
mod tests;

#[async_trait]
pub trait ResourceSource: Send + Sync {
    async fn search(&self, query: SearchQuery) -> Result<SearchResponse>;
    async fn get_project(&self, id: &str) -> Result<ResourceProject>;
    async fn get_versions(&self, project_id: &str) -> Result<Vec<ResourceVersion>>;
    
    fn platform(&self) -> SourcePlatform;
}
