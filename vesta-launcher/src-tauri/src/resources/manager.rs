use anyhow::{anyhow, Result};
use chrono::NaiveDateTime;
use diesel::prelude::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::models::installed_resource::InstalledResource;
use crate::models::resource::{
    DependencyType, ReleaseType, ResourceCategory, ResourceMetadataCacheRecord, ResourceProject,
    ResourceProjectRecord, ResourceVersion, SearchQuery, SearchResponse, SourcePlatform,
};
use crate::resources::sources::curseforge::CurseForgeSource;
use crate::resources::sources::modrinth::ModrinthSource;
use crate::resources::sources::ResourceSource;
use crate::schema::vesta::installed_resource::dsl as ir_dsl;
use crate::schema::vesta::resource_metadata_cache::dsl as rmc_dsl;
use crate::schema::vesta::resource_project::dsl as rp_dsl;
use crate::utils::db::get_vesta_conn;

#[derive(Clone)]
pub struct ResourceManager {
    sources: Arc<Mutex<Vec<Arc<dyn ResourceSource>>>>,
    project_cache: Arc<Mutex<HashMap<(SourcePlatform, String), ResourceProject>>>,
    version_cache: Arc<Mutex<HashMap<(SourcePlatform, String), Vec<ResourceVersion>>>>,
    hash_cache: Arc<Mutex<HashMap<(SourcePlatform, String), (ResourceProject, ResourceVersion)>>>,
    search_cache: Arc<Mutex<HashMap<String, (SearchResponse, NaiveDateTime)>>>,
    category_cache: Arc<Mutex<HashMap<SourcePlatform, (Vec<ResourceCategory>, NaiveDateTime)>>>,
}

impl ResourceManager {
    pub fn new() -> Self {
        let sources: Vec<Arc<dyn ResourceSource>> = vec![
            Arc::new(ModrinthSource::new()),
            Arc::new(CurseForgeSource::new()),
        ];

        Self {
            sources: Arc::new(Mutex::new(sources)),
            project_cache: Arc::new(Mutex::new(HashMap::new())),
            version_cache: Arc::new(Mutex::new(HashMap::new())),
            hash_cache: Arc::new(Mutex::new(HashMap::new())),
            search_cache: Arc::new(Mutex::new(HashMap::new())),
            category_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn clear_cache(&self) -> Result<()> {
        log::info!("[ResourceManager] Clearing all caches (in-memory and database)");

        // 1. Clear in-memory caches
        self.project_cache.lock().await.clear();
        self.version_cache.lock().await.clear();
        self.hash_cache.lock().await.clear();
        self.search_cache.lock().await.clear();
        self.category_cache.lock().await.clear();

        // 2. Clear database tables
        let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;

        diesel::delete(rmc_dsl::resource_metadata_cache)
            .execute(&mut conn)
            .map_err(|e| anyhow!("Failed to clear resource_metadata_cache: {}", e))?;

        diesel::delete(rp_dsl::resource_project)
            .execute(&mut conn)
            .map_err(|e| anyhow!("Failed to clear resource_project table: {}", e))?;

        Ok(())
    }

    pub async fn get_categories(&self, platform: SourcePlatform) -> Result<Vec<ResourceCategory>> {
        // 1. Check cache (cache for 1 hour)
        {
            let cache = self.category_cache.lock().await;
            if let Some((categories, timestamp)) = cache.get(&platform) {
                let now = chrono::Utc::now().naive_utc();
                if (now - *timestamp).num_hours() < 1 {
                    return Ok(categories.clone());
                }
            }
        }

        // 2. Fetch from source
        let sources = self.sources.lock().await;
        for source in sources.iter() {
            if source.platform() == platform {
                let categories = source.get_categories().await?;

                // 3. Update cache
                {
                    let mut cache = self.category_cache.lock().await;
                    cache.insert(
                        platform,
                        (categories.clone(), chrono::Utc::now().naive_utc()),
                    );
                }

                return Ok(categories);
            }
        }
        Err(anyhow!("Source not found for platform {:?}", platform))
    }

    pub async fn resolve_dependencies(
        &self,
        platform: SourcePlatform,
        version: &ResourceVersion,
        mc_version: &str,
        loader: &str,
    ) -> Result<Vec<(ResourceProject, ResourceVersion)>> {
        let mut resolved = Vec::new();
        let mut visited = HashSet::new();
        let mut current_level_deps = version.dependencies.clone();

        // Add current project to visited to avoid circularities
        visited.insert(version.project_id.clone());

        while !current_level_deps.is_empty() {
            let mut next_level_deps = Vec::new();

            // 1. Identify unique, unvisited, required projects in this level
            let mut dep_ids_set = HashSet::new();
            let mut unique_deps_to_process = Vec::new();

            for dep in &current_level_deps {
                let is_required = dep.dependency_type == DependencyType::Required;

                if is_required && !visited.contains(&dep.project_id) {
                    if dep_ids_set.insert(dep.project_id.clone()) {
                        unique_deps_to_process.push(dep.clone());
                    }
                }
            }

            if unique_deps_to_process.is_empty() {
                break;
            }

            let dep_ids: Vec<String> = dep_ids_set.into_iter().collect();

            // Mark as visited BEFORE fetching to avoid redundant fetches in depth
            for id in &dep_ids {
                visited.insert(id.clone());
            }

            // 2. Fetch all projects in this level in bulk
            let projects = self.get_projects(platform, &dep_ids).await?;
            let projects_map: HashMap<String, ResourceProject> =
                projects.into_iter().map(|p| (p.id.clone(), p)).collect();

            for dep in unique_deps_to_process {
                let project = match projects_map.get(&dep.project_id) {
                    Some(p) => p.clone(),
                    None => continue,
                };

                // 2. Find best version for environment
                let versions = match self
                    .get_versions(
                        platform,
                        &dep.project_id,
                        false,
                        Some(mc_version),
                        Some(loader),
                    )
                    .await
                {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!(
                            "Failed to fetch versions for dependency {}: {}",
                            dep.project_id,
                            e
                        );
                        continue;
                    }
                };

                // 3. Find compatible version
                let mut best_version = None;
                if let Some(vid) = &dep.version_id {
                    if let Some(v) = versions.iter().find(|v| &v.id == vid) {
                        if is_game_version_compatible(&v.game_versions, mc_version)
                            && is_loader_compatible(&v.loaders, loader)
                        {
                            best_version = Some(v.clone());
                        } else {
                            log::info!("Pinned version {} for {} is incompatible with current environment ({}, {}). Finding better alternative...", 
                                vid, dep.project_id, mc_version, loader);
                        }
                    }
                }

                // Otherwise find best compatible version
                if best_version.is_none() {
                    let mut compatible: Vec<ResourceVersion> = versions
                        .into_iter()
                        .filter(|v| {
                            is_game_version_compatible(&v.game_versions, mc_version)
                                && is_loader_compatible(&v.loaders, loader)
                        })
                        .collect();

                    compatible.sort_by(|a, b| {
                        let target_norm = normalize_mc_version(mc_version);
                        let a_exact = a
                            .game_versions
                            .iter()
                            .any(|gv| normalize_mc_version(gv) == target_norm);
                        let b_exact = b
                            .game_versions
                            .iter()
                            .any(|gv| normalize_mc_version(gv) == target_norm);
                        if a_exact != b_exact {
                            return b_exact.cmp(&a_exact);
                        }

                        let stability_rank = |r: ReleaseType| match r {
                            ReleaseType::Release => 0,
                            ReleaseType::Beta => 1,
                            ReleaseType::Alpha => 2,
                        };
                        let a_stable = stability_rank(a.release_type);
                        let b_stable = stability_rank(b.release_type);
                        if a_stable != b_stable {
                            return a_stable.cmp(&b_stable);
                        }

                        match (&b.published_at, &a.published_at) {
                            (Some(pb), Some(pa)) => pb.cmp(pa),
                            _ => std::cmp::Ordering::Equal,
                        }
                    });

                    best_version = compatible.into_iter().next();
                }

                if let Some(v) = best_version {
                    log::info!(
                        "[DependencyResolution] Resolved {:?}/{} to version {}",
                        platform,
                        dep.project_id,
                        v.version_number
                    );
                    next_level_deps.extend(v.dependencies.clone());
                    resolved.push((project, v));
                } else {
                    log::warn!("[DependencyResolution] Could not find compatible version for dependency {} (MC: {}, Loader: {})", 
                        dep.project_id, mc_version, loader);
                }
            }

            current_level_deps = next_level_deps;
        }

        log::info!(
            "[DependencyResolution] Finished resolution. Found {} unique dependencies.",
            resolved.len()
        );
        Ok(resolved)
    }

    pub async fn search(
        &self,
        platform: SourcePlatform,
        query: SearchQuery,
    ) -> Result<SearchResponse> {
        let cache_key = format!("{:?}_{:?}", platform, query);

        {
            let cache = self.search_cache.lock().await;
            if let Some((resp, expiry)) = cache.get(&cache_key) {
                if expiry > &chrono::Utc::now().naive_utc() {
                    return Ok(resp.clone());
                }
            }
        }

        let source = self.get_source(platform).await?;
        let response = source.search(query).await?;

        {
            let mut cache = self.search_cache.lock().await;
            let expiry = chrono::Utc::now().naive_utc() + chrono::Duration::minutes(10);
            cache.insert(cache_key, (response.clone(), expiry));
        }

        Ok(response)
    }

    pub async fn get_projects(
        &self,
        platform: SourcePlatform,
        ids: &[String],
    ) -> Result<Vec<ResourceProject>> {
        let mut results = Vec::new();
        let mut missing_ids = Vec::new();

        for id in ids {
            if let Ok(Some(cached)) = self.get_cached_project(platform, id).await {
                results.push(cached);
            } else {
                missing_ids.push(id.clone());
            }
        }

        if missing_ids.is_empty() {
            return Ok(results);
        }

        let source = self.get_source(platform).await?;
        let fetched = source.get_projects(&missing_ids).await?;

        for project in fetched {
            {
                let mut cache = self.project_cache.lock().await;
                cache.insert((platform, project.id.clone()), project.clone());
            }
            let _ = self
                .save_project_to_cache(platform, &project.id, &project)
                .await;
            let _ = self.cache_project_metadata(platform, &project).await;
            results.push(project);
        }

        Ok(results)
    }

    pub async fn get_project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject> {
        {
            let cache = self.project_cache.lock().await;
            if let Some(project) = cache.get(&(platform, id.to_string())) {
                return Ok(project.clone());
            }
        }

        if let Ok(Some(cached)) = self.get_cached_project(platform, id).await {
            let mut cache = self.project_cache.lock().await;
            cache.insert((platform, id.to_string()), cached.clone());
            return Ok(cached);
        }

        let source = self.get_source(platform).await?;
        let project = source.get_project(id).await?;

        {
            let mut cache = self.project_cache.lock().await;
            cache.insert((platform, id.to_string()), project.clone());
            if id != project.id {
                cache.insert((platform, project.id.clone()), project.clone());
            }
        }

        let _ = self.save_project_to_cache(platform, id, &project).await;
        if id != project.id {
            let _ = self.save_project_to_cache(platform, &project.id, &project).await;
        }
        let _ = self.cache_project_metadata(platform, &project).await;

        Ok(project)
    }

    pub async fn get_versions(
        &self,
        platform: SourcePlatform,
        project_id: &str,
        ignore_cache: bool,
        mc_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<ResourceVersion>> {
        if !ignore_cache && mc_version.is_none() && loader.is_none() {
            let cache = self.version_cache.lock().await;
            if let Some(versions) = cache.get(&(platform, project_id.to_string())) {
                return Ok(versions.clone());
            }
        }

        if !ignore_cache && mc_version.is_none() && loader.is_none() {
            if let Ok(Some(versions)) = self.get_cached_versions(platform, project_id).await {
                let mut cache = self.version_cache.lock().await;
                cache.insert((platform, project_id.to_string()), versions.clone());
                return Ok(versions);
            }
        }

        let source = self.get_source(platform).await?;
        let versions = source.get_versions(project_id, mc_version, loader).await?;

        if mc_version.is_none() && loader.is_none() {
            {
                let mut cache = self.version_cache.lock().await;
                cache.insert((platform, project_id.to_string()), versions.clone());
            }

            let _ = self
                .save_versions_to_cache(platform, project_id, &versions)
                .await;
        }

        Ok(versions)
    }

    pub async fn find_peer_project(
        &self,
        current: &ResourceProject,
    ) -> Result<Option<ResourceProject>> {
        let other_platform = match current.source {
            SourcePlatform::Modrinth => SourcePlatform::CurseForge,
            SourcePlatform::CurseForge => SourcePlatform::Modrinth,
        };

        if let Some(ref external_ids) = current.external_ids {
            let key = match other_platform {
                SourcePlatform::Modrinth => "modrinth",
                SourcePlatform::CurseForge => "curseforge",
            };
            if let Some(id) = external_ids.get(key) {
                if let Ok(p) = self.get_project(other_platform, id).await {
                    return Ok(Some(p));
                }
            }
        }

        if current.source == SourcePlatform::CurseForge
            && other_platform == SourcePlatform::Modrinth
        {
            let facet_query = SearchQuery {
                facets: Some(vec![format!("curseforge_id:{}", current.id)]),
                resource_type: current.resource_type,
                limit: 1,
                ..Default::default()
            };

            if let Ok(results) = self.search(other_platform, facet_query).await {
                if let Some(hit) = results.hits.into_iter().next() {
                    return Ok(Some(hit));
                }
            }
        }

        let query = SearchQuery {
            text: Some(current.name.clone()),
            resource_type: current.resource_type,
            limit: 10,
            ..Default::default()
        };

        if let Ok(results) = self.search(other_platform, query).await {
            let c_name = current.name.to_lowercase();
            let c_author = current.author.to_lowercase();

            for hit in results.hits {
                let h_name = hit.name.to_lowercase();
                let h_author = hit.author.to_lowercase();

                let name_match =
                    h_name == c_name || h_name.contains(&c_name) || c_name.contains(&h_name);
                let exact_name = h_name == c_name;
                let author_match = h_author.contains(&c_author)
                    || c_author.contains(&h_author)
                    || (c_author.starts_with("yung") && h_author.starts_with("yung"));

                if exact_name || (name_match && author_match) {
                    return Ok(Some(hit));
                }
            }
        }

        if other_platform == SourcePlatform::Modrinth {
            if let Ok(versions) = self
                .get_versions(current.source, &current.id, false, None, None)
                .await
            {
                for v in versions.iter().take(3) {
                    if v.hash.len() == 40 {
                        if let Ok((project, _)) =
                            self.get_by_hash(SourcePlatform::Modrinth, &v.hash).await
                        {
                            return Ok(Some(project));
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    pub async fn get_version(
        &self,
        platform: SourcePlatform,
        project_id: &str,
        version_id: &str,
    ) -> Result<ResourceVersion> {
        let source = self.get_source(platform).await?;
        source.get_version(project_id, version_id).await
    }

    pub async fn get_by_hash(
        &self,
        platform: SourcePlatform,
        hash: &str,
    ) -> Result<(ResourceProject, ResourceVersion)> {
        {
            let cache = self.hash_cache.lock().await;
            if let Some(result) = cache.get(&(platform, hash.to_string())) {
                return Ok(result.clone());
            }
        }

        let source = self.get_source(platform).await?;
        let (project, version) = source.get_by_hash(hash).await?;

        {
            let mut h_cache = self.hash_cache.lock().await;
            h_cache.insert(
                (platform, hash.to_string()),
                (project.clone(), version.clone()),
            );

            let mut p_cache = self.project_cache.lock().await;
            p_cache.insert((platform, project.id.clone()), project.clone());
        }

        let _ = self
            .save_project_to_cache(platform, &project.id, &project)
            .await;

        Ok((project, version))
    }

    pub async fn refresh_resources_for_instance(
        &self,
        instance_id: i32,
        mc_version: &str,
        loader: &str,
    ) -> Result<()> {
        log::info!(
            "[ResourceManager] Refreshing resources for instance {} (MC {}, {})",
            instance_id,
            mc_version,
            loader
        );

        let resources = {
            let mut conn = get_vesta_conn()?;
            ir_dsl::installed_resource
                .filter(ir_dsl::instance_id.eq(instance_id))
                .filter(ir_dsl::is_manual.eq(false))
                .load::<InstalledResource>(&mut conn)?
        };

        for res in resources {
            let platform = match res.platform.as_str() {
                "curseforge" => SourcePlatform::CurseForge,
                "modrinth" => SourcePlatform::Modrinth,
                _ => continue,
            };

            let _ = self.get_project(platform, &res.remote_id).await;
            let _ = self
                .get_versions(
                    platform,
                    &res.remote_id,
                    true,
                    Some(mc_version),
                    Some(loader),
                )
                .await;
        }

        Ok(())
    }

    async fn get_cached_project(
        &self,
        platform: SourcePlatform,
        id: &str,
    ) -> Result<Option<ResourceProject>> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let mut conn = get_vesta_conn()?;

        let record = rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(&platform_str))
            .filter(rmc_dsl::remote_id.eq(id))
            .filter(rmc_dsl::expires_at.gt(chrono::Utc::now().to_rfc3339()))
            .first::<ResourceMetadataCacheRecord>(&mut conn)
            .optional()?;

        if let Some(rec) = record {
            let project: ResourceProject = serde_json::from_str(&rec.project_data)?;
            return Ok(Some(project));
        }

        Ok(None)
    }

    async fn get_cached_versions(
        &self,
        platform: SourcePlatform,
        id: &str,
    ) -> Result<Option<Vec<ResourceVersion>>> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let mut conn = get_vesta_conn()?;

        let record = rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(&platform_str))
            .filter(rmc_dsl::remote_id.eq(id))
            .filter(rmc_dsl::expires_at.gt(chrono::Utc::now().to_rfc3339()))
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

    async fn save_project_to_cache(
        &self,
        platform: SourcePlatform,
        id: &str,
        project: &ResourceProject,
    ) -> Result<()> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let project_json = serde_json::to_string(project)?;
        let mut conn = get_vesta_conn()?;

        let now = chrono::Utc::now();
        let expires = now + chrono::Duration::hours(24);
        let now_str = now.to_rfc3339();
        let expires_str = expires.to_rfc3339();

        diesel::insert_into(rmc_dsl::resource_metadata_cache)
            .values((
                rmc_dsl::source.eq(&platform_str),
                rmc_dsl::remote_id.eq(id),
                rmc_dsl::project_data.eq(project_json),
                rmc_dsl::last_updated.eq(&now_str),
                rmc_dsl::expires_at.eq(&expires_str),
            ))
            .on_conflict((rmc_dsl::source, rmc_dsl::remote_id))
            .do_update()
            .set((
                rmc_dsl::project_data.eq(&serde_json::to_string(project)?),
                rmc_dsl::last_updated.eq(&now_str),
                rmc_dsl::expires_at.eq(&expires_str),
            ))
            .execute(&mut conn)?;

        Ok(())
    }

    async fn save_versions_to_cache(
        &self,
        platform: SourcePlatform,
        id: &str,
        versions: &[ResourceVersion],
    ) -> Result<()> {
        let platform_str = format!("{:?}", platform).to_lowercase();
        let versions_json = serde_json::to_string(versions)?;
        let mut conn = get_vesta_conn()?;

        let now = chrono::Utc::now();
        let expires = now + chrono::Duration::hours(24);
        let now_str = now.to_rfc3339();
        let expires_str = expires.to_rfc3339();

        let affected = diesel::update(
            rmc_dsl::resource_metadata_cache
                .filter(rmc_dsl::source.eq(&platform_str))
                .filter(rmc_dsl::remote_id.eq(id)),
        )
        .set((
            rmc_dsl::versions_data.eq(versions_json),
            rmc_dsl::last_updated.eq(now_str),
            rmc_dsl::expires_at.eq(expires_str),
        ))
        .execute(&mut conn)?;

        if affected == 0 {
            log::warn!(
                "Tried to cache versions for {}/{} but no project record exists",
                platform_str,
                id
            );
        }

        Ok(())
    }

    async fn get_source(&self, platform: SourcePlatform) -> Result<Arc<dyn ResourceSource>> {
        let sources = self.sources.lock().await;
        sources
            .iter()
            .find(|s| s.platform() == platform)
            .cloned()
            .ok_or_else(|| anyhow!("Source platform not supported: {:?}", platform))
    }

    pub async fn cache_project_metadata(
        &self,
        platform: SourcePlatform,
        project: &ResourceProject,
    ) -> Result<()> {
        let mut conn = get_vesta_conn()?;
        let now = chrono::Utc::now().to_rfc3339();

        // 1. Check if we have an existing record with icon_data
        let existing: Option<ResourceProjectRecord> = rp_dsl::resource_project
            .filter(rp_dsl::id.eq(&project.id))
            .first(&mut conn)
            .optional()?;

        let mut icon_data = existing.as_ref().and_then(|e| e.icon_data.clone());

        // 2. If we have a URL but no data, download it
        if icon_data.is_none() {
            if let Some(url) = &project.icon_url {
                if !url.is_empty() {
                    match reqwest::get(url).await {
                        Ok(resp) => {
                            if let Ok(bytes) = resp.bytes().await {
                                icon_data = Some(bytes.to_vec());
                            }
                        }
                        Err(e) => log::warn!("Failed to download icon for {}: {}", project.id, e),
                    }
                }
            }
        }

        let record = ResourceProjectRecord {
            id: project.id.clone(),
            source: format!("{:?}", platform).to_lowercase(),
            name: project.name.clone(),
            summary: project.summary.clone(),
            icon_url: project.icon_url.clone(),
            icon_data,
            project_type: format!("{:?}", project.resource_type).to_lowercase(),
            last_updated: now,
        };

        diesel::insert_into(rp_dsl::resource_project)
            .values(&record)
            .on_conflict(rp_dsl::id)
            .do_update()
            .set(&record)
            .execute(&mut conn)?;

        Ok(())
    }

    pub async fn get_project_record(&self, id: &str) -> Result<Option<ResourceProjectRecord>> {
        let mut conn = get_vesta_conn()?;
        let record = rp_dsl::resource_project
            .filter(rp_dsl::id.eq(id))
            .first::<ResourceProjectRecord>(&mut conn)
            .optional()?;
        Ok(record)
    }

    pub fn get_project_records(&self, ids: &[String]) -> Result<Vec<ResourceProjectRecord>> {
        let mut conn = get_vesta_conn()?;
        let records = rp_dsl::resource_project
            .filter(rp_dsl::id.eq_any(ids))
            .load::<ResourceProjectRecord>(&mut conn)?;
        Ok(records)
    }
}

pub fn normalize_mc_version(v: &str) -> String {
    if v.ends_with(".0") {
        v[..v.len() - 2].to_string()
    } else {
        v.to_string()
    }
}

pub fn is_game_version_compatible(supported: &[String], target: &str) -> bool {
    let n_target = normalize_mc_version(target);

    if supported
        .iter()
        .any(|v| normalize_mc_version(v) == n_target)
    {
        return true;
    }

    let target_parts: Vec<&str> = n_target.split('.').collect();
    if target_parts.len() >= 2 {
        let major_minor = format!("{}.{}", target_parts[0], target_parts[1]);

        for v in supported {
            let sv = normalize_mc_version(v);
            if sv == major_minor || sv == format!("{}.x", major_minor) {
                return true;
            }
        }
    }

    false
}

pub fn is_loader_compatible(supported: &[String], target: &str) -> bool {
    let t = target.to_lowercase();
    let is_vanilla = t == "vanilla" || t.is_empty();

    if is_vanilla {
        return false;
    }

    if t == "quilt" {
        supported.iter().any(|l| {
            let sl = l.to_lowercase();
            sl == "quilt" || sl == "fabric"
        })
    } else if t == "neoforge" {
        supported.iter().any(|l| {
            let sl = l.to_lowercase();
            sl == "neoforge" || sl == "forge"
        })
    } else {
        supported.iter().any(|l| l.to_lowercase() == t)
    }
}
