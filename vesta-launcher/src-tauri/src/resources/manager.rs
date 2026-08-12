use anyhow::{anyhow, Result};
use chrono::NaiveDateTime;
use diesel::prelude::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::models::installed_resource::InstalledResource;
use crate::models::resource::{
    CachedResourceProjectRef, DependencyType, ReleaseType, ResourceCategory, ResourceDependency,
    ResourceMetadataCacheRecord, ResourceProject, ResourceProjectRecord, ResourceProjectRef,
    ResourceType, ResourceVersion, ResourceVersionDetails, SearchQuery, SearchResponse,
    SourcePlatform,
};
use crate::resources::sources::curseforge::CurseForgeSource;
use crate::resources::sources::modrinth::ModrinthSource;
use crate::resources::sources::smithed::SmithedSource;
use crate::resources::sources::{ResourceSource, SourceCapabilities};
use crate::resources::update_cache::{now_datetime_str, VERSION_CACHE_TTL_MINUTES};
use crate::schema::vesta::installed_resource::dsl as ir_dsl;
use crate::schema::vesta::resource_metadata_cache::dsl as rmc_dsl;
use crate::schema::vesta::resource_project::dsl as rp_dsl;
use crate::utils::db::get_vesta_conn;

fn is_record_incomplete(record: &ResourceProjectRecord) -> bool {
    record.metadata_synced_at.is_none() || record.summary.trim().is_empty()
}

async fn download_icon_with_timeout(url: &str) -> Result<Vec<u8>> {
    let client = piston_lib::client::shared_client();
    let response = client.get(url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "Icon download failed with HTTP {} for {}",
            response.status(),
            url
        ));
    }

    let bytes = response.bytes().await?;
    if bytes.is_empty() {
        return Err(anyhow!("Downloaded icon is empty for {}", url));
    }

    Ok(bytes.to_vec())
}

#[derive(Clone)]
pub struct ResourceManager {
    sources: Arc<RwLock<Vec<Arc<dyn ResourceSource>>>>,
    project_cache: Arc<RwLock<HashMap<(SourcePlatform, String), ResourceProject>>>,
    version_cache: Arc<RwLock<HashMap<(SourcePlatform, String), Vec<ResourceVersion>>>>,
    hash_cache: Arc<RwLock<HashMap<(SourcePlatform, String), (ResourceProject, ResourceVersion)>>>,
    search_cache: Arc<RwLock<HashMap<String, (SearchResponse, NaiveDateTime)>>>,
    category_cache: Arc<RwLock<HashMap<SourcePlatform, (Vec<ResourceCategory>, NaiveDateTime)>>>,
    pub image_cache: Arc<RwLock<HashMap<String, String>>>,
}

impl ResourceManager {
    pub fn new() -> Self {
        let sources: Vec<Arc<dyn ResourceSource>> = vec![
            Arc::new(ModrinthSource::new()),
            Arc::new(CurseForgeSource::new()),
            Arc::new(SmithedSource::new()),
        ];

        Self {
            sources: Arc::new(RwLock::new(sources)),
            project_cache: Arc::new(RwLock::new(HashMap::new())),
            version_cache: Arc::new(RwLock::new(HashMap::new())),
            hash_cache: Arc::new(RwLock::new(HashMap::new())),
            search_cache: Arc::new(RwLock::new(HashMap::new())),
            category_cache: Arc::new(RwLock::new(HashMap::new())),
            image_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn clear_cache(&self) -> Result<()> {
        log::info!("[ResourceManager] Clearing all caches (in-memory and database)");

        // 1. Clear in-memory caches
        self.project_cache.write().await.clear();
        self.version_cache.write().await.clear();
        self.hash_cache.write().await.clear();
        self.search_cache.write().await.clear();
        self.category_cache.write().await.clear();
        self.image_cache.write().await.clear();

        // 2. Clear database tables
        let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;

        diesel::delete(rmc_dsl::resource_metadata_cache)
            .execute(&mut conn)
            .map_err(|e| anyhow!("Failed to clear resource_metadata_cache: {}", e))?;

        diesel::delete(rp_dsl::resource_project)
            .execute(&mut conn)
            .map_err(|e| anyhow!("Failed to clear resource_project table: {}", e))?;

        crate::resources::update_cache::clear_all_instance_update_snapshots()?;

        Ok(())
    }

    fn platform_to_source_str(platform: SourcePlatform) -> &'static str {
        platform.as_str()
    }

    pub async fn list_source_capabilities(&self) -> Vec<SourceCapabilities> {
        let sources = self.sources.read().await;
        sources.iter().map(|source| source.capabilities()).collect()
    }

    fn parse_cache_datetime(value: &str) -> Option<NaiveDateTime> {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
            .ok()
            .or_else(|| {
                chrono::DateTime::parse_from_rfc3339(value)
                    .ok()
                    .map(|dt| dt.naive_utc())
            })
    }

    fn read_versions_from_db(
        &self,
        platform: SourcePlatform,
        project_id: &str,
    ) -> Result<Option<Vec<ResourceVersion>>> {
        let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;
        let source = Self::platform_to_source_str(platform);
        let now = chrono::Utc::now().naive_utc();

        let record = rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(source))
            .filter(rmc_dsl::remote_id.eq(project_id))
            .first::<ResourceMetadataCacheRecord>(&mut conn)
            .optional()
            .map_err(|e| anyhow!("Failed to read resource metadata cache: {}", e))?;

        let Some(record) = record else {
            return Ok(None);
        };

        let expires_at = Self::parse_cache_datetime(&record.expires_at);
        if expires_at.is_none_or(|expires| expires <= now) {
            return Ok(None);
        }

        let versions_json = record
            .versions_data
            .ok_or_else(|| anyhow!("Cached resource metadata is missing versions_data"))?;
        let versions: Vec<ResourceVersion> = serde_json::from_str(&versions_json)
            .map_err(|e| anyhow!("Failed to deserialize cached versions: {}", e))?;

        Ok(Some(versions))
    }

    fn write_versions_to_db(
        &self,
        platform: SourcePlatform,
        project_id: &str,
        versions: &[ResourceVersion],
    ) -> Result<()> {
        let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;
        let source = Self::platform_to_source_str(platform).to_string();
        let versions_data = serde_json::to_string(versions)
            .map_err(|e| anyhow!("Failed to serialize versions for cache: {}", e))?;
        let last_updated = now_datetime_str();
        let expires_at = (chrono::Utc::now().naive_utc()
            + chrono::Duration::minutes(VERSION_CACHE_TTL_MINUTES))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

        let existing_project_data = rmc_dsl::resource_metadata_cache
            .filter(rmc_dsl::source.eq(&source))
            .filter(rmc_dsl::remote_id.eq(project_id))
            .select(rmc_dsl::project_data)
            .first::<String>(&mut conn)
            .optional()
            .unwrap_or(None)
            // project_data is NOT NULL; preserve existing payload or use a minimal placeholder.
            .unwrap_or_else(|| "{}".to_string());

        let record = ResourceMetadataCacheRecord {
            id: None,
            source,
            remote_id: project_id.to_string(),
            project_data: existing_project_data,
            versions_data: Some(versions_data),
            last_updated,
            expires_at,
        };

        diesel::insert_into(rmc_dsl::resource_metadata_cache)
            .values(&record)
            .on_conflict((rmc_dsl::source, rmc_dsl::remote_id))
            .do_update()
            .set((
                rmc_dsl::versions_data.eq(&record.versions_data),
                rmc_dsl::last_updated.eq(&record.last_updated),
                rmc_dsl::expires_at.eq(&record.expires_at),
            ))
            .execute(&mut conn)
            .map_err(|e| anyhow!("Failed to write resource metadata cache: {}", e))?;

        Ok(())
    }

    pub async fn get_categories(&self, platform: SourcePlatform) -> Result<Vec<ResourceCategory>> {
        // 1. Check cache (cache for 1 hour)
        {
            let cache = self.category_cache.read().await;
            if let Some((categories, timestamp)) = cache.get(&platform) {
                let now = chrono::Utc::now().naive_utc();
                if (now - *timestamp).num_hours() < 1 {
                    return Ok(categories.clone());
                }
            }
        }

        // 2. Fetch from source
        let sources = self.sources.read().await;
        for source in sources.iter() {
            if source.platform() == platform {
                let categories = source.get_categories().await?;

                // 3. Update cache
                {
                    let mut cache = self.category_cache.write().await;
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
        resource_type: ResourceType,
        version: &ResourceVersion,
        datapack_mc_version: &str,
        instance_mc_version: &str,
        loader: &str,
        allow_inexact_datapacks: bool,
    ) -> Result<Vec<(ResourceProject, ResourceVersion)>> {
        let mut resolved = Vec::new();
        let mut visited = HashSet::new();
        let mut current_level_deps = version.dependencies.clone();

        // Synthetic Dependency Injection for Shaders
        if resource_type == ResourceType::Shader {
            let loader_lower = loader.to_lowercase();
            let is_cf = platform == SourcePlatform::CurseForge;

            let engine_id = if loader_lower == "forge" {
                if is_cf {
                    Some("581495") // Oculus (CurseForge)
                } else {
                    Some("oculus") // Oculus (Modrinth)
                }
            } else if loader_lower == "fabric" || loader_lower == "quilt" {
                if is_cf {
                    Some("445996") // Iris (CurseForge)
                } else {
                    Some("iris") // Iris (Modrinth)
                }
            } else if loader_lower == "neoforge" {
                // For NeoForge, default to Iris (similar to frontend)
                if is_cf {
                    Some("445996")
                } else {
                    Some("iris")
                }
            } else {
                None
            };

            if let Some(id) = engine_id {
                current_level_deps.push(ResourceDependency {
                    project_id: id.to_string(),
                    version_id: None,
                    file_name: None,
                    dependency_type: DependencyType::Required,
                });
            }
        }

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
                    Some(p) => Some(p.clone()),
                    None => {
                        // If not found by primary ID, try matching against slugs in web_url
                        // (Modrinth often returns numerical IDs even if requested by slug)
                        projects_map
                            .values()
                            .find(|p| {
                                p.id == dep.project_id
                                    || p.web_url.ends_with(&format!("/{}", dep.project_id))
                            })
                            .cloned()
                    }
                };

                let mut project = match project {
                    Some(p) => p,
                    None => {
                        log::warn!("[DependencyResolution] Could not find project metadata for {} in fetched results", dep.project_id);
                        continue;
                    }
                };

                // 2. Find best version for environment
                let pinned_datapack = dep.version_id.as_ref().is_some_and(|version_id| {
                    // The cached list is fetched below; this flag is refined after
                    // fetching. Dedicated datapack projects are known up front.
                    !version_id.is_empty() && project.resource_type == ResourceType::DataPack
                });
                let dependency_type = if pinned_datapack {
                    ResourceType::DataPack
                } else {
                    project.resource_type
                };
                let version_loader = if dependency_type == ResourceType::DataPack
                    && platform == SourcePlatform::CurseForge
                {
                    None
                } else if dependency_type == ResourceType::DataPack {
                    Some("datapack")
                } else {
                    Some(loader)
                };
                let dependency_mc_version = if dependency_type == ResourceType::DataPack {
                    datapack_mc_version
                } else {
                    instance_mc_version
                };
                let version_mc =
                    if dependency_type == ResourceType::DataPack && allow_inexact_datapacks {
                        None
                    } else {
                        Some(dependency_mc_version)
                    };
                let mut versions = match self
                    .get_versions(platform, &dep.project_id, false, version_mc, version_loader)
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
                if let Some(version_id) = &dep.version_id {
                    if !versions.iter().any(|version| &version.id == version_id) {
                        if let Ok(pinned) = self
                            .get_version(platform, &dep.project_id, version_id)
                            .await
                        {
                            versions.push(pinned);
                        }
                    }
                }

                // A pinned Modrinth dependency can point at a datapack release
                // even when the provider classifies the project itself as a mod.
                let dependency_type = dep
                    .version_id
                    .as_ref()
                    .and_then(|version_id| versions.iter().find(|v| &v.id == version_id))
                    .filter(|version| {
                        platform == SourcePlatform::Modrinth
                            && version
                                .loaders
                                .iter()
                                .any(|loader| loader.eq_ignore_ascii_case("datapack"))
                    })
                    .map(|_| ResourceType::DataPack)
                    .unwrap_or(dependency_type);
                if dependency_type == ResourceType::DataPack {
                    project.resource_type = ResourceType::DataPack;
                }

                // 3. Find compatible version
                let mut best_version = None;
                if let Some(vid) = &dep.version_id {
                    if let Some(v) = versions.iter().find(|v| &v.id == vid) {
                        let game_matches = if dependency_type == ResourceType::DataPack {
                            let exact = v.game_versions.iter().any(|listed| {
                                normalize_mc_version(listed)
                                    == normalize_mc_version(dependency_mc_version)
                            });
                            exact
                                || (allow_inexact_datapacks
                                    && is_game_version_compatible(
                                        &v.game_versions,
                                        dependency_mc_version,
                                    ))
                        } else {
                            is_game_version_compatible(&v.game_versions, dependency_mc_version)
                        };
                        let loader_matches = if dependency_type == ResourceType::DataPack {
                            platform == SourcePlatform::CurseForge
                                || v.loaders
                                    .iter()
                                    .any(|candidate| candidate.eq_ignore_ascii_case("datapack"))
                        } else {
                            is_loader_compatible(&v.loaders, loader)
                        };
                        if game_matches && loader_matches {
                            best_version = Some(v.clone());
                        } else {
                            log::info!("Pinned version {} for {} is incompatible with current environment ({}, {}). Finding better alternative...",
                                vid, dep.project_id, dependency_mc_version, loader);
                        }
                    }
                }

                // Otherwise find best compatible version
                if best_version.is_none() {
                    let mut compatible: Vec<ResourceVersion> = versions
                        .into_iter()
                        .filter(|v| {
                            let game_matches = if dependency_type == ResourceType::DataPack {
                                let exact = v.game_versions.iter().any(|listed| {
                                    normalize_mc_version(listed)
                                        == normalize_mc_version(dependency_mc_version)
                                });
                                exact
                                    || (allow_inexact_datapacks
                                        && is_game_version_compatible(
                                            &v.game_versions,
                                            dependency_mc_version,
                                        ))
                            } else {
                                is_game_version_compatible(&v.game_versions, dependency_mc_version)
                            };
                            let loader_matches = if dependency_type == ResourceType::DataPack {
                                platform == SourcePlatform::CurseForge
                                    || v.loaders
                                        .iter()
                                        .any(|candidate| candidate.eq_ignore_ascii_case("datapack"))
                            } else {
                                is_loader_compatible(&v.loaders, loader)
                            };
                            game_matches && loader_matches
                        })
                        .collect();

                    compatible.sort_by(|a, b| {
                        let target_norm = normalize_mc_version(dependency_mc_version);
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
                    if dependency_type == ResourceType::DataPack && !allow_inexact_datapacks {
                        return Err(anyhow!(
                            "Required datapack dependency {} has no exact release for Minecraft {}. Its compatibility must be acknowledged before installation.",
                            project.name,
                            dependency_mc_version
                        ));
                    }
                    log::warn!("[DependencyResolution] Could not find compatible version for dependency {} (MC: {}, Loader: {})",
                        dep.project_id, dependency_mc_version, loader);
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
            let cache = self.search_cache.read().await;
            if let Some((resp, expiry)) = cache.get(&cache_key) {
                if expiry > &chrono::Utc::now().naive_utc() {
                    return Ok(resp.clone());
                }
            }
        }

        let source = self.get_source(platform).await?;
        let response = source.search(query).await?;

        {
            let mut cache = self.search_cache.write().await;
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

        {
            let cache = self.project_cache.read().await;
            for id in ids {
                if let Some(cached) = cache.get(&(platform, id.clone())) {
                    results.push(cached.clone());
                } else {
                    missing_ids.push(id.clone());
                }
            }
        }

        if missing_ids.is_empty() {
            return Ok(results);
        }

        let source = self.get_source(platform).await?;
        let fetched = source.get_projects(&missing_ids).await?;

        for project in &fetched {
            {
                let mut cache = self.project_cache.write().await;
                cache.insert((platform, project.id.clone()), project.clone());
            }
        }
        let _ = self.cache_project_metadata_many(platform, &fetched).await;
        results.extend(fetched);

        Ok(results)
    }

    pub async fn get_project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject> {
        {
            let cache = self.project_cache.read().await;
            if let Some(project) = cache.get(&(platform, id.to_string())) {
                return Ok(project.clone());
            }
        }

        let source = self.get_source(platform).await?;
        let project = source.get_project(id).await?;

        {
            let mut cache = self.project_cache.write().await;
            cache.insert((platform, id.to_string()), project.clone());
            if id != project.id {
                cache.insert((platform, project.id.clone()), project.clone());
            }
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
        let can_use_memory_cache = !ignore_cache && mc_version.is_none() && loader.is_none();

        if can_use_memory_cache {
            {
                let cache = self.version_cache.read().await;
                if let Some(versions) = cache.get(&(platform, project_id.to_string())) {
                    return Ok(versions.clone());
                }
            }

            if let Some(versions) = self.read_versions_from_db(platform, project_id)? {
                let mut cache = self.version_cache.write().await;
                cache.insert((platform, project_id.to_string()), versions.clone());
                return Ok(versions);
            }
        }

        let source = self.get_source(platform).await?;
        let versions = source.get_versions(project_id, mc_version, loader).await?;

        if can_use_memory_cache {
            {
                let mut cache = self.version_cache.write().await;
                cache.insert((platform, project_id.to_string()), versions.clone());
            }
            if let Err(e) = self.write_versions_to_db(platform, project_id, &versions) {
                log::warn!(
                    "[ResourceManager] Failed to persist version cache for {:?}/{}: {}",
                    platform,
                    project_id,
                    e
                );
            }
        }

        Ok(versions)
    }

    pub async fn find_peer_project(
        &self,
        current: &ResourceProject,
    ) -> Result<Option<ResourceProject>> {
        let peer_platforms = SourceCapabilities::for_platform(current.source).peer_platforms;
        if peer_platforms.is_empty() {
            return Ok(None);
        }

        for &other_platform in &peer_platforms {
            if let Some((platform, project_id)) =
                crate::resources::reconciliation::find_persisted_peer(current.source, &current.id)?
            {
                if platform == other_platform {
                    if let Ok(project) = self.get_project(platform, &project_id).await {
                        return Ok(Some(project));
                    }
                }
            }

            if let Some(ref external_ids) = current.external_ids {
                if let Some(id) = external_ids.get(other_platform.as_str()) {
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

    pub async fn get_version_details(
        &self,
        platform: SourcePlatform,
        project_id: &str,
        version_id: &str,
    ) -> Result<ResourceVersionDetails> {
        let source = self.get_source(platform).await?;
        source.get_version_details(project_id, version_id).await
    }

    pub async fn get_by_hash(
        &self,
        platform: SourcePlatform,
        hash: &str,
    ) -> Result<(ResourceProject, ResourceVersion)> {
        {
            let cache = self.hash_cache.read().await;
            if let Some(result) = cache.get(&(platform, hash.to_string())) {
                return Ok(result.clone());
            }
        }

        let source = self.get_source(platform).await?;
        let (project, version) = source.get_by_hash(hash).await?;

        {
            let mut h_cache = self.hash_cache.write().await;
            h_cache.insert(
                (platform, hash.to_string()),
                (project.clone(), version.clone()),
            );

            let mut p_cache = self.project_cache.write().await;
            p_cache.insert((platform, project.id.clone()), project.clone());
        }
        let _ = self.cache_project_metadata(platform, &project).await;

        Ok((project, version))
    }

    pub async fn get_by_hashes(
        &self,
        platform: SourcePlatform,
        hashes: &[String],
    ) -> Result<HashMap<String, (ResourceProject, ResourceVersion)>> {
        let mut matches = HashMap::new();
        let mut missing = Vec::new();
        let mut missing_seen = HashSet::new();

        {
            let cache = self.hash_cache.read().await;
            for hash in hashes {
                if let Some(found) = cache.get(&(platform, hash.clone())) {
                    matches.insert(hash.clone(), found.clone());
                } else if missing_seen.insert(hash.clone()) {
                    missing.push(hash.clone());
                }
            }
        }

        if missing.is_empty() {
            return Ok(matches);
        }

        let source = self.get_source(platform).await?;
        let batch_size = source.identification_batch_size().max(1);
        let concurrency = source.identification_concurrency().max(1);
        use futures::stream::{self, StreamExt};
        let chunks = missing
            .chunks(batch_size)
            .map(<[String]>::to_vec)
            .collect::<Vec<_>>();
        let batches = stream::iter(chunks.into_iter().map(|hashes| {
            let source = source.clone();
            async move {
                let result = source.get_by_hashes(&hashes).await;
                (hashes.len(), result)
            }
        }))
        .buffer_unordered(concurrency)
        .collect::<Vec<_>>()
        .await;
        let mut projects_to_cache = HashMap::new();
        for (batch_len, result) in batches {
            let fetched = match result {
                Ok(fetched) => fetched,
                Err(error) => {
                    log::warn!(
                        "[ResourceManager] {:?} identification batch failed ({} hashes): {}",
                        platform,
                        batch_len,
                        error
                    );
                    continue;
                }
            };
            for (hash, (project, version)) in fetched {
                {
                    let mut hash_cache = self.hash_cache.write().await;
                    hash_cache.insert((platform, hash.clone()), (project.clone(), version.clone()));
                }
                {
                    let mut project_cache = self.project_cache.write().await;
                    project_cache.insert((platform, project.id.clone()), project.clone());
                }
                projects_to_cache.insert(project.id.clone(), project.clone());
                matches.insert(hash, (project, version));
            }
        }
        let projects = projects_to_cache.into_values().collect::<Vec<_>>();
        let _ = self.cache_project_metadata_many(platform, &projects).await;
        Ok(matches)
    }

    pub async fn get_or_hydrate_project_records(
        &self,
        refs: &[ResourceProjectRef],
        allow_network: bool,
        refresh_stale: bool,
    ) -> Result<Vec<ResourceProjectRecord>> {
        if refs.is_empty() {
            return Ok(vec![]);
        }

        let mut seen = HashSet::new();
        let mut unique_refs = Vec::new();

        for project_ref in refs {
            let key = (project_ref.platform, project_ref.id.clone());
            if seen.insert(key) {
                unique_refs.push(project_ref.clone());
            }
        }

        let existing_records = self.get_project_records(&unique_refs)?;
        let existing_by_key = existing_records
            .into_iter()
            .map(|record| ((record.source.clone(), record.id.clone()), record))
            .collect::<HashMap<_, _>>();
        let mut refs_to_hydrate = Vec::new();
        for project_ref in &unique_refs {
            let source = format!("{:?}", project_ref.platform).to_lowercase();
            let record = existing_by_key.get(&(source, project_ref.id.clone()));

            match record {
                Some(existing) if is_record_incomplete(existing) || refresh_stale => {
                    refs_to_hydrate.push(project_ref.clone());
                }
                Some(_) => {}
                None => refs_to_hydrate.push(project_ref.clone()),
            }
        }

        if allow_network && !refs_to_hydrate.is_empty() {
            let mut grouped: HashMap<SourcePlatform, Vec<String>> = HashMap::new();
            for project_ref in refs_to_hydrate {
                grouped
                    .entry(project_ref.platform)
                    .or_default()
                    .push(project_ref.id);
            }

            for (platform, ids) in grouped {
                const PROJECT_BATCH_SIZE: usize = 100;
                for chunk in ids.chunks(PROJECT_BATCH_SIZE) {
                    if let Err(error) = self.get_projects(platform, chunk).await {
                        log::warn!(
                            "[ResourceManager] Failed to hydrate {} {:?} projects: {}",
                            chunk.len(),
                            platform,
                            error
                        );
                    }
                }
            }
        }

        self.get_project_records(refs)
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
            if res.source_kind == "modpack" {
                continue;
            }

            let Some(platform) = SourcePlatform::from_str_id(&res.platform) else {
                continue;
            };

            let _ = self.get_project(platform, &res.remote_id).await;
            let _ = self
                .get_versions(platform, &res.remote_id, false, None, None)
                .await;
        }

        Ok(())
    }

    async fn get_source(&self, platform: SourcePlatform) -> Result<Arc<dyn ResourceSource>> {
        let sources = self.sources.read().await;
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
        self.cache_project_metadata_many(platform, std::slice::from_ref(project))
            .await
    }

    pub async fn cache_project_metadata_many(
        &self,
        platform: SourcePlatform,
        projects: &[ResourceProject],
    ) -> Result<()> {
        if projects.is_empty() {
            return Ok(());
        }
        let mut conn = get_vesta_conn()?;
        let now = chrono::Utc::now().to_rfc3339();
        let platform_str = platform.as_str().to_string();
        let ids = projects
            .iter()
            .map(|project| &project.id)
            .collect::<Vec<_>>();
        let existing = rp_dsl::resource_project
            .filter(rp_dsl::source.eq(&platform_str))
            .filter(rp_dsl::id.eq_any(ids))
            .load::<ResourceProjectRecord>(&mut conn)?
            .into_iter()
            .map(|record| (record.id.clone(), record))
            .collect::<HashMap<_, _>>();
        let records = projects
            .iter()
            .map(|project| {
                let previous = existing.get(&project.id);
                let icon_url_changed = previous.and_then(|record| record.icon_url.as_ref())
                    != project.icon_url.as_ref();
                let icon_data = if icon_url_changed {
                    None
                } else {
                    previous.and_then(|record| record.icon_data.clone())
                };
                let icon_synced_at = if icon_url_changed {
                    None
                } else {
                    previous.and_then(|record| record.icon_synced_at.clone())
                };
                let description = project
                    .description
                    .as_ref()
                    .map(|description| description.trim())
                    .filter(|description| !description.is_empty())
                    .map(str::to_string)
                    .or_else(|| previous.and_then(|record| record.description.clone()))
                    .or_else(|| {
                        (!project.summary.trim().is_empty()).then(|| project.summary.clone())
                    });
                let summary = if project.summary.trim().is_empty() {
                    previous
                        .map(|record| record.summary.clone())
                        .unwrap_or_default()
                } else {
                    project.summary.clone()
                };
                ResourceProjectRecord {
                    id: project.id.clone(),
                    source: platform_str.clone(),
                    name: project.name.clone(),
                    summary,
                    description,
                    icon_url: project.icon_url.clone(),
                    icon_data,
                    project_type: format!("{:?}", project.resource_type).to_lowercase(),
                    last_updated: now.clone(),
                    metadata_synced_at: Some(now.clone()),
                    icon_synced_at,
                }
            })
            .collect::<Vec<_>>();
        conn.transaction::<(), anyhow::Error, _>(|conn| {
            for record in &records {
                diesel::insert_into(rp_dsl::resource_project)
                    .values(record)
                    .on_conflict((rp_dsl::source, rp_dsl::id))
                    .do_update()
                    .set(record)
                    .execute(conn)?;
            }
            Ok(())
        })
    }

    pub async fn get_project_record(
        &self,
        platform: SourcePlatform,
        id: &str,
    ) -> Result<Option<ResourceProjectRecord>> {
        let mut conn = get_vesta_conn()?;
        let source = format!("{:?}", platform).to_lowercase();
        let record = rp_dsl::resource_project
            .filter(rp_dsl::id.eq(id))
            .filter(rp_dsl::source.eq(source))
            .first::<ResourceProjectRecord>(&mut conn)
            .optional()?;
        Ok(record)
    }

    pub fn get_project_records(
        &self,
        refs: &[ResourceProjectRef],
    ) -> Result<Vec<ResourceProjectRecord>> {
        let refs = refs
            .iter()
            .map(|project_ref| CachedResourceProjectRef {
                platform: project_ref.platform.as_str().to_string(),
                id: project_ref.id.clone(),
            })
            .collect::<Vec<_>>();
        self.get_cached_project_records(&refs)
    }

    pub fn get_cached_project_records(
        &self,
        refs: &[CachedResourceProjectRef],
    ) -> Result<Vec<ResourceProjectRecord>> {
        if refs.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = get_vesta_conn()?;
        let keys = refs
            .iter()
            .map(|project_ref| {
                (
                    project_ref.platform.trim().to_ascii_lowercase(),
                    project_ref.id.clone(),
                )
            })
            .collect::<HashSet<_>>();
        let ids = refs
            .iter()
            .map(|project_ref| &project_ref.id)
            .collect::<Vec<_>>();
        let mut records = rp_dsl::resource_project
            .filter(rp_dsl::id.eq_any(ids))
            .load::<ResourceProjectRecord>(&mut conn)?;
        records.retain(|record| keys.contains(&(record.source.clone(), record.id.clone())));
        Ok(records)
    }

    pub async fn hydrate_project_icons(
        &self,
        refs: &[ResourceProjectRef],
    ) -> Result<Vec<ResourceProjectRecord>> {
        let refs = refs
            .iter()
            .map(|project_ref| CachedResourceProjectRef {
                platform: project_ref.platform.as_str().to_string(),
                id: project_ref.id.clone(),
            })
            .collect::<Vec<_>>();
        self.hydrate_cached_project_icons(&refs).await
    }

    pub async fn hydrate_cached_project_icons(
        &self,
        refs: &[CachedResourceProjectRef],
    ) -> Result<Vec<ResourceProjectRecord>> {
        use futures::stream::{self, StreamExt};

        let records = self.get_cached_project_records(refs)?;
        let downloads = records
            .iter()
            .filter_map(|record| {
                let needs_icon = record
                    .icon_data
                    .as_ref()
                    .is_none_or(|bytes| bytes.is_empty());
                needs_icon
                    .then(|| record.icon_url.clone())
                    .flatten()
                    .map(|url| (record.source.clone(), record.id.clone(), url))
            })
            .collect::<Vec<_>>();

        let downloaded = stream::iter(downloads.into_iter().map(|(source, id, url)| async move {
            let bytes = download_icon_with_timeout(&url).await;
            (source, id, bytes)
        }))
        .buffer_unordered(8)
        .collect::<Vec<_>>()
        .await;

        if !downloaded.is_empty() {
            let mut conn = get_vesta_conn()?;
            let now = chrono::Utc::now().to_rfc3339();
            for (source, id, result) in downloaded {
                match result {
                    Ok(bytes) => {
                        diesel::update(
                            rp_dsl::resource_project
                                .filter(rp_dsl::source.eq(source))
                                .filter(rp_dsl::id.eq(id)),
                        )
                        .set((
                            rp_dsl::icon_data.eq(Some(bytes)),
                            rp_dsl::icon_synced_at.eq(Some(now.clone())),
                        ))
                        .execute(&mut conn)?;
                    }
                    Err(error) => {
                        log::warn!("[ResourceManager] Failed to hydrate resource icon: {error}");
                    }
                }
            }
        }

        self.get_cached_project_records(refs)
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
