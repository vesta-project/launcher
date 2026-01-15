use std::sync::Arc;
use crate::models::resource::{
    ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, 
    SearchResponse, ResourceMetadataCacheRecord, DependencyType, ReleaseType
};
use crate::resources::sources::ResourceSource;
use crate::resources::sources::modrinth::ModrinthSource;
use crate::resources::sources::curseforge::CurseForgeSource;
use anyhow::{Result, anyhow};
use tokio::sync::Mutex;
use std::collections::{HashMap, HashSet};
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use crate::schema::vesta::resource_metadata_cache::dsl as rmc_dsl;

pub struct ResourceManager {
    sources: Vec<Arc<dyn ResourceSource>>,
    project_cache: Mutex<HashMap<(SourcePlatform, String), ResourceProject>>,
    version_cache: Mutex<HashMap<(SourcePlatform, String), Vec<ResourceVersion>>>,
    hash_cache: Mutex<HashMap<(SourcePlatform, String), (ResourceProject, ResourceVersion)>>,
    search_cache: Mutex<HashMap<String, (SearchResponse, chrono::NaiveDateTime)>>,
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
            search_cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn resolve_dependencies(
        &self, 
        platform: SourcePlatform, 
        version: &ResourceVersion, 
        mc_version: &str, 
        loader: &str
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
            let projects_map: HashMap<String, ResourceProject> = projects.into_iter()
                .map(|p| (p.id.clone(), p))
                .collect();

            for dep in unique_deps_to_process {
                let project = match projects_map.get(&dep.project_id) {
                    Some(p) => p.clone(),
                    None => continue,
                };

                // 2. Find best version for environment
                // Use API filters to get target versions directly
                let versions = match self.get_versions(platform, &dep.project_id, false, Some(mc_version), Some(loader)).await {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("Failed to fetch versions for dependency {}: {}", dep.project_id, e);
                        continue;
                    }
                };
                
                // 3. Find compatible version
                // We PRIORITIZE the pinned version ID IF it is compatible.
                // If it's NOT compatible with our environment (loader/MC), we fallback to search.
                let mut best_version = None;
                if let Some(vid) = &dep.version_id {
                    if let Some(v) = versions.iter().find(|v| &v.id == vid) {
                        if is_game_version_compatible(&v.game_versions, mc_version) && 
                           is_loader_compatible(&v.loaders, loader) {
                            best_version = Some(v.clone());
                        } else {
                            log::info!("Pinned version {} for {} is incompatible with current environment ({}, {}). Finding better alternative...", 
                                vid, dep.project_id, mc_version, loader);
                        }
                    }
                }

                // Otherwise find best compatible version
                if best_version.is_none() {
                    // Filter compatible ones
                    let mut compatible: Vec<ResourceVersion> = versions.into_iter()
                        .filter(|v| {
                            is_game_version_compatible(&v.game_versions, mc_version) && 
                            is_loader_compatible(&v.loaders, loader)
                        })
                        .collect();

                    // Sorting Strategy:
                    // 1. Exact Minecraft version match (e.g. 1.21.4 instance vs 1.21.4 tagged file)
                    // 2. Stability (Release > Beta > Alpha)
                    // 3. Recency (Newest first)
                    compatible.sort_by(|a, b| {
                        // 1. Exactness match
                        let target_norm = normalize_mc_version(mc_version);
                        let a_exact = a.game_versions.iter().any(|gv| normalize_mc_version(gv) == target_norm);
                        let b_exact = b.game_versions.iter().any(|gv| normalize_mc_version(gv) == target_norm);
                        if a_exact != b_exact {
                            return b_exact.cmp(&a_exact); // true (1) > false (0)
                        }

                        // 2. Stability match (Release=0, Beta=1, Alpha=2)
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

                        // 3. Recency (published_at descending)
                        match (&b.published_at, &a.published_at) {
                            (Some(pb), Some(pa)) => pb.cmp(pa),
                            _ => std::cmp::Ordering::Equal,
                        }
                    });

                    best_version = compatible.into_iter().next();
                }

                if let Some(v) = best_version {
                    log::info!("[DependencyResolution] Resolved {:?}/{} to version {}", platform, dep.project_id, v.version_number);
                    // Collect dependencies for next level
                    next_level_deps.extend(v.dependencies.clone());
                    resolved.push((project, v));
                } else {
                    log::warn!("[DependencyResolution] Could not find compatible version for dependency {} (MC: {}, Loader: {})", 
                        dep.project_id, mc_version, loader);
                }
            }

            current_level_deps = next_level_deps;
        }

        log::info!("[DependencyResolution] Finished resolution. Found {} unique dependencies.", resolved.len());
        Ok(resolved)
    }

    pub async fn search(&self, platform: SourcePlatform, query: SearchQuery) -> Result<SearchResponse> {
        let cache_key = format!("{:?}_{:?}", platform, query);
        
        {
            let cache = self.search_cache.lock().await;
            if let Some((resp, expiry)) = cache.get(&cache_key) {
                if expiry > &chrono::Utc::now().naive_utc() {
                    return Ok(resp.clone());
                }
            }
        }

        let source = self.get_source(platform)?;
        let response = source.search(query).await?;

        {
            let mut cache = self.search_cache.lock().await;
            let expiry = chrono::Utc::now().naive_utc() + chrono::Duration::minutes(10);
            cache.insert(cache_key, (response.clone(), expiry));
        }

        Ok(response)
    }

    pub async fn get_projects(&self, platform: SourcePlatform, ids: &[String]) -> Result<Vec<ResourceProject>> {
        let mut results = Vec::new();
        let mut missing_ids = Vec::new();

        // 1. Check caches
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

        // 2. Fetch missing from source in bulk
        let source = self.get_source(platform)?;
        let fetched = source.get_projects(&missing_ids).await?;

        for project in fetched {
            // Update caches
            {
                let mut cache = self.project_cache.lock().await;
                cache.insert((platform, project.id.clone()), project.clone());
            }
            let _ = self.save_project_to_cache(platform, &project.id, &project).await;
            results.push(project);
        }

        Ok(results)
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

    pub async fn get_versions(
        &self, 
        platform: SourcePlatform, 
        project_id: &str, 
        ignore_cache: bool,
        mc_version: Option<&str>,
        loader: Option<&str>
    ) -> Result<Vec<ResourceVersion>> {
        // 1. Check in-memory cache if not ignoring AND no specific filters are applied
        // (Filters bypass cache to ensure fresh results for that environment)
        if !ignore_cache && mc_version.is_none() && loader.is_none() {
            let cache = self.version_cache.lock().await;
            if let Some(versions) = cache.get(&(platform, project_id.to_string())) {
                return Ok(versions.clone());
            }
        }

        // 2. Check DB cache if not ignoring AND no specific filters
        if !ignore_cache && mc_version.is_none() && loader.is_none() {
            if let Ok(Some(versions)) = self.get_cached_versions(platform, project_id).await {
                // Update in-memory cache
                let mut cache = self.version_cache.lock().await;
                cache.insert((platform, project_id.to_string()), versions.clone());
                return Ok(versions);
            }
        }

        // 3. Fetch from source
        let source = self.get_source(platform)?;
        let versions = source.get_versions(project_id, mc_version, loader).await?;

        // 4. Update caches only if no filters were applied (to keep general cache clean)
        if mc_version.is_none() && loader.is_none() {
            {
                let mut cache = self.version_cache.lock().await;
                cache.insert((platform, project_id.to_string()), versions.clone());
            }

            let _ = self.save_versions_to_cache(platform, project_id, &versions).await;
        }

        Ok(versions)
    }

    pub async fn find_peer_project(&self, current: &ResourceProject) -> Result<Option<ResourceProject>> {
        let other_platform = match current.source {
            SourcePlatform::Modrinth => SourcePlatform::CurseForge,
            SourcePlatform::CurseForge => SourcePlatform::Modrinth,
        };

        // 1. Check external_ids (Direct Link)
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

        // 2. Source-specific specialized lookups
        if current.source == SourcePlatform::CurseForge && other_platform == SourcePlatform::Modrinth {
            // Try to find Modrinth project using CurseForge ID
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

        // 3. Fuzzy search by name
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

                let name_match = h_name == c_name || h_name.contains(&c_name) || c_name.contains(&h_name);
                
                // Authors often differ significantly between platforms (Slug vs Name vs Team)
                // So let's be more lenient if the name is an exact match
                let exact_name = h_name == c_name;
                let author_match = h_author.contains(&c_author) || c_author.contains(&h_author) || 
                                 (c_author.starts_with("yung") && h_author.starts_with("yung"));

                if exact_name || (name_match && author_match) {
                    return Ok(Some(hit));
                }
            }
        }

        // 3. Hash matching (Expensive but accurate)
        if other_platform == SourcePlatform::Modrinth {
            // Modrinth supports SHA1 lookup. We can use hashes from CurseForge versions.
            if let Ok(versions) = self.get_versions(current.source, &current.id, false, None, None).await {
                // Try the 3 most recent versions
                for v in versions.iter().take(3) {
                    if v.hash.len() == 40 { // Likely SHA1
                        if let Ok((project, _)) = self.get_by_hash(SourcePlatform::Modrinth, &v.hash).await {
                            return Ok(Some(project));
                        }
                    }
                }
            }
        } else {
            // CurseForge to Modrinth is handled above.
            // Modrinth to CurseForge using hashes is harder because CF needs Murmur2.
            // But we can check if CF has a SHA1 search? (They don't officially via fingerprints)
        }

        Ok(None)
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

    fn get_source(&self, platform: SourcePlatform) -> Result<Arc<dyn ResourceSource>> {
        self.sources.iter()
            .find(|s| s.platform() == platform)
            .cloned()
            .ok_or_else(|| anyhow!("Source platform not supported: {:?}", platform))
    }
}

fn normalize_mc_version(v: &str) -> String {
    if v.ends_with(".0") {
        v[..v.len() - 2].to_string()
    } else {
        v.to_string()
    }
}

fn is_game_version_compatible(supported: &[String], target: &str) -> bool {
    let n_target = normalize_mc_version(target);
    
    // 1. Exact or normalized match (e.g. 1.21.0 == 1.21)
    if supported.iter().any(|v| normalize_mc_version(v) == n_target) {
        return true;
    }

    // 2. Fuzzy match logic
    let target_parts: Vec<&str> = n_target.split('.').collect();
    if target_parts.len() >= 2 {
        let major_minor = format!("{}.{}", target_parts[0], target_parts[1]);
        
        for v in supported {
            let sv = normalize_mc_version(v);
            
            // Match major_minor exact (e.g. mod says "1.21" but instance is "1.21.4")
            // This is generally safe.
            if sv == major_minor {
                return true;
            }

            // Wildcard matching (e.g. "1.21.x")
            if sv == format!("{}.x", major_minor) {
                return true;
            }

            // DANGER AREA: prevent patch-version drift.
            // If instance is 1.21.4, do NOT match 1.21.1 or 1.21.2.
            // Only allow matching if the mod's patch version is LESS THAN OR EQUAL 
            // to target if it's a very simple mod, but for now we'll be strict.
            // If the mod specifies a DIFFERENT patch version, it's likely incompatible.
        }
    }

    false
}

fn is_loader_compatible(supported: &[String], target: &str) -> bool {
    let t = target.to_lowercase();
    let is_vanilla = t == "vanilla" || t == "";
    
    // Mods are never compatible with vanilla
    // (In the future we might handle datapacks/resourcepacks here, but they skip resolve_dependencies for now)
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
