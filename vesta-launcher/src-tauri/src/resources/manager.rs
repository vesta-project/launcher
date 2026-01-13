use std::sync::Arc;
use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, SearchResponse, ResourceMetadataCacheRecord};
use crate::resources::sources::ResourceSource;
use crate::resources::sources::modrinth::ModrinthSource;
use crate::resources::sources::curseforge::CurseForgeSource;
use anyhow::{Result, anyhow};
use tokio::sync::Mutex;
use std::collections::HashMap;
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use crate::schema::vesta::resource_metadata_cache::dsl as rmc_dsl;

pub struct ResourceManager {
    sources: Vec<Arc<dyn ResourceSource>>,
    project_cache: Mutex<HashMap<(SourcePlatform, String), ResourceProject>>,
    version_cache: Mutex<HashMap<(SourcePlatform, String), Vec<ResourceVersion>>>,
    hash_cache: Mutex<HashMap<(SourcePlatform, String), (ResourceProject, ResourceVersion)>>,
}

impl ResourceManager {
    pub fn new() -> Self {
        let sources: Vec<Arc<dyn ResourceSource>> = vec![
            Arc::new(ModrinthSource::new()),
            Arc::new(CurseForgeSource::new()),
        ];
        
        Self { 
            sources,
            project_cache: Mutex::new(HashMap::new()),
            version_cache: Mutex::new(HashMap::new()),
            hash_cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn search(&self, platform: SourcePlatform, query: SearchQuery) -> Result<SearchResponse> {
        let source = self.get_source(platform)?;
        source.search(query).await
    }

    pub async fn get_project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject> {
        // 1. Check in-memory cache
        {
            let cache = self.project_cache.lock().await;
            if let Some(project) = cache.get(&(platform, id.to_string())) {
                return Ok(project.clone());
            }
        }

        // 2. Check DB cache
        if let Ok(Some(cached)) = self.get_cached_project(platform, id).await {
            // Update in-memory cache
            let mut cache = self.project_cache.lock().await;
            cache.insert((platform, id.to_string()), cached.clone());
            return Ok(cached);
        }

        // 3. Fetch from source
        let source = self.get_source(platform)?;
        let project = source.get_project(id).await?;
        
        // 4. Update caches
        {
            let mut cache = self.project_cache.lock().await;
            cache.insert((platform, id.to_string()), project.clone());
        }
        
        let _ = self.save_project_to_cache(platform, id, &project).await;

        Ok(project)
    }

    pub async fn get_versions(&self, platform: SourcePlatform, project_id: &str) -> Result<Vec<ResourceVersion>> {
        // 1. Check in-memory cache
        {
            let cache = self.version_cache.lock().await;
            if let Some(versions) = cache.get(&(platform, project_id.to_string())) {
                return Ok(versions.clone());
            }
        }

        // 2. Check DB cache
        if let Ok(Some(versions)) = self.get_cached_versions(platform, project_id).await {
            // Update in-memory cache
            let mut cache = self.version_cache.lock().await;
            cache.insert((platform, project_id.to_string()), versions.clone());
            return Ok(versions);
        }

        // 3. Fetch from source
        let source = self.get_source(platform)?;
        let versions = source.get_versions(project_id).await?;

        // 4. Update caches
        {
            let mut cache = self.version_cache.lock().await;
            cache.insert((platform, project_id.to_string()), versions.clone());
        }

        let _ = self.save_versions_to_cache(platform, project_id, &versions).await;

        Ok(versions)
    }

    pub async fn get_by_hash(&self, platform: SourcePlatform, hash: &str) -> Result<(ResourceProject, ResourceVersion)> {
        {
            let cache = self.hash_cache.lock().await;
            if let Some(result) = cache.get(&(platform, hash.to_string())) {
                return Ok(result.clone());
            }
        }

        let source = self.get_source(platform)?;
        let (project, version) = source.get_by_hash(hash).await?;

        {
            let mut h_cache = self.hash_cache.lock().await;
            h_cache.insert((platform, hash.to_string()), (project.clone(), version.clone()));
            
            let mut p_cache = self.project_cache.lock().await;
            p_cache.insert((platform, project.id.clone()), project.clone());
        }

        // Also save to DB cache if we got full project info
        let _ = self.save_project_to_cache(platform, &project.id, &project).await;

        Ok((project, version))
    }

    // --- Private DB Cache Helpers ---

    async fn get_cached_project(&self, platform: SourcePlatform, id: &str) -> Result<Option<ResourceProject>> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let mut conn = get_vesta_conn()?;
        
        let record = rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(&platform_str))
            .filter(rmc_dsl::remote_id.eq(id))
            .filter(rmc_dsl::expires_at.gt(chrono::Utc::now().naive_utc()))
            .first::<ResourceMetadataCacheRecord>(&mut conn)
            .optional()?;

        if let Some(rec) = record {
            let project: ResourceProject = serde_json::from_str(&rec.project_data)?;
            return Ok(Some(project));
        }
        
        Ok(None)
    }

    async fn get_cached_versions(&self, platform: SourcePlatform, id: &str) -> Result<Option<Vec<ResourceVersion>>> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let mut conn = get_vesta_conn()?;
        
        let record = rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(&platform_str))
            .filter(rmc_dsl::remote_id.eq(id))
            .filter(rmc_dsl::expires_at.gt(chrono::Utc::now().naive_utc()))
            .first::<ResourceMetadataCacheRecord>(&mut conn)
            .optional()?;

        if let Some(rec) = record {
            if let Some(v_data) = rec.versions_data {
                let versions: Vec<ResourceVersion> = serde_json::from_str(&v_data)?;
                return Ok(Some(versions));
            }
        }
        
        Ok(None)
    }

    async fn save_project_to_cache(&self, platform: SourcePlatform, id: &str, project: &ResourceProject) -> Result<()> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let project_json = serde_json::to_string(project)?;
        let mut conn = get_vesta_conn()?;
        
        let now = chrono::Utc::now().naive_utc();
        let expires = now + chrono::Duration::hours(24);

        diesel::insert_into(rmc_dsl::resource_metadata_cache)
            .values((
                rmc_dsl::source.eq(&platform_str),
                rmc_dsl::remote_id.eq(id),
                rmc_dsl::project_data.eq(project_json),
                rmc_dsl::last_updated.eq(now),
                rmc_dsl::expires_at.eq(expires),
            ))
            .on_conflict((rmc_dsl::source, rmc_dsl::remote_id))
            .do_update()
            .set((
                rmc_dsl::project_data.eq(&serde_json::to_string(project)?),
                rmc_dsl::last_updated.eq(now),
                rmc_dsl::expires_at.eq(expires),
            ))
            .execute(&mut conn)?;

        Ok(())
    }

    async fn save_versions_to_cache(&self, platform: SourcePlatform, id: &str, versions: &[ResourceVersion]) -> Result<()> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let versions_json = serde_json::to_string(versions)?;
        let mut conn = get_vesta_conn()?;
        
        let now = chrono::Utc::now().naive_utc();
        let expires = now + chrono::Duration::hours(24);

        // We assume project data already exists or we'll insert a placeholder if it doesn't (though usually we fetch project first)
        // To be safe, let's use a specialized update if it exists or error
        
        let affected = diesel::update(rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(&platform_str))
            .filter(rmc_dsl::remote_id.eq(id)))
            .set((
                rmc_dsl::versions_data.eq(versions_json),
                rmc_dsl::last_updated.eq(now),
                rmc_dsl::expires_at.eq(expires),
            ))
            .execute(&mut conn)?;

        if affected == 0 {
            // Need to insert with dummy project data? Actually, let's just not cache versions without a project.
            // But we can try to fetch the project if needed. For now, just skip if no project record.
            log::warn!("Tried to cache versions for {}/{} but no project record exists", platform_str, id);
        }

        Ok(())
    }

    fn get_source(&self, platform: SourcePlatform) -> Result<&Arc<dyn ResourceSource>> {
        self.sources.iter()
            .find(|s| s.platform() == platform)
            .ok_or_else(|| anyhow!("Source platform not supported: {:?}", platform))
    }
}
