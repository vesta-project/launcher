use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, SearchResponse, ResourceCategory};
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
    async fn get_projects(&self, ids: &[String]) -> Result<Vec<ResourceProject>>;
    async fn get_versions(&self, project_id: &str, game_version: Option<&str>, loader: Option<&str>) -> Result<Vec<ResourceVersion>>;
    async fn get_version(&self, project_id: &str, version_id: &str) -> Result<ResourceVersion>;
    async fn get_by_hash(&self, hash: &str) -> Result<(ResourceProject, ResourceVersion)>;
    async fn get_categories(&self) -> Result<Vec<ResourceCategory>>;
    
    fn platform(&self) -> SourcePlatform;
}
