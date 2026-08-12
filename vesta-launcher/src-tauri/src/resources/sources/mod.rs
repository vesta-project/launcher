use crate::models::resource::{
    ResourceCategory, ResourceProject, ResourceVersion, ResourceVersionDetails, SearchQuery,
    SearchResponse, SourcePlatform,
};
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;

pub mod capabilities;
pub mod curseforge;
pub mod modrinth;
pub mod smithed;

#[cfg(test)]
mod tests;

pub use capabilities::SourceCapabilities;

#[async_trait]
pub trait ResourceSource: Send + Sync {
    async fn search(&self, query: SearchQuery) -> Result<SearchResponse>;
    async fn get_project(&self, id: &str) -> Result<ResourceProject>;
    async fn get_projects(&self, ids: &[String]) -> Result<Vec<ResourceProject>>;
    async fn get_versions(
        &self,
        project_id: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<ResourceVersion>>;
    async fn get_version(&self, project_id: &str, version_id: &str) -> Result<ResourceVersion>;
    async fn get_version_details(
        &self,
        project_id: &str,
        version_id: &str,
    ) -> Result<ResourceVersionDetails>;
    async fn get_by_hash(&self, hash: &str) -> Result<(ResourceProject, ResourceVersion)>;
    async fn get_by_hashes(
        &self,
        hashes: &[String],
    ) -> Result<HashMap<String, (ResourceProject, ResourceVersion)>>;
    fn identification_batch_size(&self) -> usize {
        100
    }
    fn identification_concurrency(&self) -> usize {
        2
    }
    async fn get_categories(&self) -> Result<Vec<ResourceCategory>>;

    fn platform(&self) -> SourcePlatform;

    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities::for_platform(self.platform())
    }
}
