use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, ReleaseType, SearchResponse, ResourceDependency, DependencyType, ResourceCategory};
use crate::resources::sources::ResourceSource;
use async_trait::async_trait;
use anyhow::{Result, anyhow};
use serde::Deserialize;
use reqwest::{Client, header};

// Include generated obfuscated key
include!(concat!(env!("OUT_DIR"), "/curseforge_key.rs"));

fn get_deobfuscated_key() -> String {
    CURSEFORGE_API_KEY_OBFUSCATED.iter().map(|b| (b ^ CURSEFORGE_SEED) as char).collect()
}

pub struct CurseForgeSource {
    client: Client,
}

#[derive(Deserialize)]
struct CFSearchResult {
    data: Vec<CFMod>,
    pagination: CFPagination,
}

#[derive(Deserialize)]
struct CFModResponse {
    data: CFMod,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct CFMod {
    id: i64,
    name: String,
    summary: String,
    description: Option<String>,
    links: CFLinks,
    logo: Option<CFLogo>,
    authors: Vec<CFAuthor>,
    download_count: f64,
    categories: Vec<CFCategory>,
    class_id: Option<i64>,
    gallery: Option<Vec<CFGallery>>,
    date_created: String,
    date_modified: String,
}

#[derive(Deserialize)]
struct CFGallery {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CFLinks {
    website_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CFLogo {
    thumbnail_url: String,
}

#[derive(Deserialize)]
struct CFAuthor {
    name: String,
}

#[derive(Deserialize)]
struct CFCategory {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CFCategoryFull {
    id: i64,
    name: String,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    class_id: Option<i64>,
    #[serde(default)]
    parent_category_id: Option<i64>,
    #[serde(default)]
    is_class: Option<bool>,
    #[serde(default)]
    display_index: Option<i32>,
}

#[derive(Deserialize)]
struct CFAllCategoriesResponse {
    data: Vec<CFCategoryFull>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct CFPagination {
    index: u32,
    page_size: u32,
    total_count: u32,
}

#[derive(Deserialize)]
struct CFFilesResponse {
    data: Vec<CFFile>,
    pagination: CFPagination,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CFFile {
    id: i64,
    mod_id: i64,
    display_name: String,
    file_name: String,
    release_type: u8,
    game_versions: Vec<String>,
    hashes: Vec<CFHash>,
    file_date: String,
    download_url: Option<String>,
    dependencies: Vec<CFDependency>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CFDependency {
    mod_id: i64,
    relation_type: u8,
}

#[derive(Deserialize)]
struct CFHash {
    value: String,
    algo: u8, // 1 = Sha1, 2 = Md5
}

#[derive(Deserialize)]
struct CFFileResponse {
    data: CFFile,
}

#[derive(Deserialize)]
struct CFDescriptionResponse {
    data: String,
}

#[derive(Deserialize)]
struct CFFingerprintResponse {
    data: CFFingerprintData,
}

#[derive(Deserialize)]
struct CFFingerprintData {
    #[serde(rename = "exactMatches")]
    exact_matches: Vec<CFExactMatch>,
}

#[derive(Deserialize)]
struct CFExactMatch {
    id: u32,
    file: CFFile,
}

impl CurseForgeSource {
    pub fn new() -> Self {
        let key = get_deobfuscated_key();
        log::info!("CurseForgeSource initializing with key (len: {})", key.len());
        
        let mut headers = header::HeaderMap::new();
        headers.insert("x-api-key", header::HeaderValue::from_str(&key).unwrap_or_else(|_| {
            log::error!("Failed to create header value from CurseForge key");
            header::HeaderValue::from_static("")
        }));
        headers.insert(header::ACCEPT, header::HeaderValue::from_static("application/json"));
        
        Self {
            client: Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .default_headers(headers)
                .build()
                .unwrap(),
        }
    }

    pub fn map_class_id_to_type(class_id: i64) -> ResourceType {
        match class_id {
            6 => ResourceType::Mod,
            12 => ResourceType::ResourcePack,
            6552 => ResourceType::Shader,
            17 => ResourceType::World,
            4471 => ResourceType::Modpack,
            6945 => ResourceType::DataPack,
            4546 => ResourceType::DataPack, // Customization often contains datapacks/scripts
            _ => ResourceType::Mod,
        }
    }

    pub fn map_type_to_class_id(res_type: ResourceType) -> i64 {
        match res_type {
            ResourceType::Mod => 6,
            ResourceType::ResourcePack => 12,
            ResourceType::Shader => 6552,
            ResourceType::DataPack => 6945,
            ResourceType::World => 17,
            ResourceType::Modpack => 4471,
        }
    }

    pub async fn fetch_categories_direct(&self) -> Result<Vec<CFCategoryFull>> {
        let url = "https://api.curseforge.com/v1/categories?gameId=432";
        let response = self.client.get(url).send().await?;
        
        let status = response.status();
        if !status.is_success() {
             let body = response.text().await.unwrap_or_default();
             return Err(anyhow!("CurseForge API error fetching categories ({}): {}", status, body));
        }

        let body = response.text().await?;
        match serde_json::from_str::<CFAllCategoriesResponse>(&body) {
            Ok(res) => Ok(res.data),
            Err(e) => {
                log::error!("Failed to decode CurseForge categories JSON: {}. Body length: {}", e, body.len());
                // If it's too large, don't log the whole thing, but maybe the start
                if body.len() > 500 {
                    log::error!("Body start: {}", &body[..500]);
                } else {
                    log::error!("Body: {}", body);
                }
                Err(anyhow!("CurseForge categories decode error: {}", e))
            }
        }
    }
}

#[async_trait]
impl ResourceSource for CurseForgeSource {
    async fn get_categories(&self) -> Result<Vec<ResourceCategory>> {
        let categories = self.fetch_categories_direct().await?;

        Ok(categories.into_iter()
            .filter(|c| {
                // Filter out the root category and specific categories we handle via resource_type
                if c.id == c.class_id.unwrap_or(0) {
                    return false;
                }

                // Filter out Bukkit Plugins (Class ID 5), Shaders (6552), and Data Packs (6945)
                if c.class_id == Some(5) || c.id == 6552 || c.id == 6945 {
                    return false;
                }

                // Filter out Customization (4550, 4547, 4552) for Data Packs
                // These are often incorrectly tagged or refer to a type we don't support as Datapacks
                if c.class_id == Some(6945) && (c.id == 4550 || c.id == 4547 || c.id == 4552 || c.parent_category_id == Some(4550) || c.parent_category_id == Some(4547) || c.parent_category_id == Some(4552)) {
                    return false;
                }

                // Also filter by name for safety
                let name = c.name.to_lowercase();
                if name.contains("bukkit") || name.contains("spigot") || name.contains("paper") {
                    return false;
                }
                
                !matches!(name.as_str(), "mods" | "worlds" | "resource packs" | "modpacks" | "customization" | "addons")
            })
            .map(|c| ResourceCategory {
                id: c.id.to_string(),
                name: c.name,
                icon_url: c.icon_url,
                parent_id: match c.parent_category_id {
                    Some(0) | None => None,
                    Some(id) => Some(id.to_string()),
                },
                display_index: Some(c.display_index.unwrap_or(0)),
                project_type: match c.class_id {
                    Some(0) | None => None,
                    Some(id) => Some(Self::map_class_id_to_type(id)),
                },
            }).collect())
    }

    async fn search(&self, query: SearchQuery) -> Result<SearchResponse> {
        let class_id = Self::map_type_to_class_id(query.resource_type);
        let mut url = format!("https://api.curseforge.com/v1/mods/search?gameId=432&classId={}&index={}&pageSize={}", 
            class_id,
            query.offset,
            query.limit
        );

        if let Some(text) = query.text {
            url.push_str(&format!("&searchFilter={}", urlencoding::encode(&text)));
        }

        if let Some(version) = query.game_version {
            url.push_str(&format!("&gameVersion={}", version));
        }

        let sort_field = if let Some(sort) = &query.sort_by {
            match sort.to_lowercase().as_str() {
                "featured" => Some(1),
                "popularity" | "downloads" => Some(2),
                "last_updated" | "updated" => Some(3),
                "name" => Some(4),
                "author" => Some(5),
                "total_downloads" => Some(6),
                "category" => Some(7),
                "game_version" => Some(8),
                "early_access" => Some(9),
                "featured_released" => Some(10),
                "released_date" | "newest" => Some(11),
                "rating" => Some(12),
                _ => Some(1), 
            }
        } else {
            // Favor popularity (2) for modpacks to find primary packs, 
            // otherwise featured (1) for general browsing.
            if query.resource_type == ResourceType::Modpack {
                Some(2) 
            } else {
                Some(1)
            }
        };

        if let Some(field) = sort_field {
            let order = query.sort_order.as_deref().unwrap_or("desc");
            url.push_str(&format!("&sortField={}&sortOrder={}", field, order));
        }

        if let Some(categories) = &query.categories {
            if let Some(category) = categories.first() {
                // Try to parse as ID first (preferred for dynamic categories)
                if let Ok(category_id) = category.parse::<u32>() {
                    url.push_str(&format!("&categoryId={}", category_id));
                }
            }
        }

        // Loader mapping for CF (1=Forge, 4=Fabric, 5=Quilt, 6=NeoForge)
        if let Some(loader) = query.loader {
            // Apply loader filter for mods and modpacks
            if query.resource_type == ResourceType::Mod || query.resource_type == ResourceType::Modpack {
                let mod_loader_type = match loader.to_lowercase().as_str() {
                    "forge" => 1,
                    "fabric" => 4,
                    "quilt" => 5,
                    "neoforge" => 6,
                    _ => 0,
                };
                if mod_loader_type > 0 {
                    url.push_str(&format!("&modLoaderType={}", mod_loader_type));
                }
            }
        }

        log::debug!("[CurseForge] Search URL: {}", url);

        let response = self.client.get(&url).send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("CurseForge API error ({}): {}", status, body));
        }

        let response: CFSearchResult = response.json().await.map_err(|e| {
            anyhow!("CurseForge search JSON decode error: {}. URL: {}", e, url)
        })?;

        let hits = response.data.into_iter().map(|item| ResourceProject {
            id: item.id.to_string(),
            source: SourcePlatform::CurseForge,
            resource_type: query.resource_type,
            name: item.name,
            summary: item.summary,
            description: None,
            icon_url: item.logo.map(|l| l.thumbnail_url),
            author: item.authors.first().map(|a| a.name.clone()).unwrap_or_else(|| "Unknown".to_string()),
            download_count: item.download_count as u64,
            follower_count: 0,
            categories: item.categories.into_iter().map(|c| c.name).collect(),
            web_url: item.links.website_url,
            external_ids: None,
            gallery: item.gallery.unwrap_or_default().into_iter().map(|s| s.url).collect(),
            published_at: Some(item.date_created),
            updated_at: Some(item.date_modified),
        }).collect();

        Ok(SearchResponse {
            hits,
            total_hits: response.pagination.total_count as u64,
        })
    }

    async fn get_project(&self, id: &str) -> Result<ResourceProject> {
        let url = format!("https://api.curseforge.com/v1/mods/{}", id);
        let response = self.client.get(&url).send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("CurseForge API error fetching project ({}): {}", status, body));
        }

        let mod_response: CFModResponse = response.json().await.map_err(|e| {
            anyhow!("CurseForge project JSON decode error: {}. ID: {}", e, id)
        })?;

        let item = mod_response.data;

        // Fetch description separately as it's not included in the main mod object
        let desc_url = format!("https://api.curseforge.com/v1/mods/{}/description", id);
        let desc_response = self.client.get(&desc_url).send().await?;
        let description = if desc_response.status().is_success() {
            let desc_data: CFDescriptionResponse = desc_response.json().await.map_err(|e| {
                anyhow!("CurseForge description JSON decode error: {}. ID: {}", e, id)
            })?;
            Some(desc_data.data)
        } else {
            None
        };

        // Fetch all categories for this game to find parent names if needed
        let all_categories = self.fetch_categories_direct().await.unwrap_or_default();

        Ok(ResourceProject {
            id: item.id.to_string(),
            source: SourcePlatform::CurseForge,
            resource_type: Self::map_class_id_to_type(item.class_id.unwrap_or(6)),
            name: item.name,
            summary: item.summary,
            description,
            icon_url: item.logo.map(|l| l.thumbnail_url),
            author: item.authors.first().map(|a| a.name.clone()).unwrap_or_else(|| "Unknown".to_string()),
            download_count: item.download_count as u64,
            follower_count: 0,
            categories: item.categories.into_iter().map(|c| {
                if let Some(cat_full) = all_categories.iter().find(|cf| cf.name == c.name) {
                    cat_full.id.to_string()
                } else {
                    c.name
                }
            }).collect(),
            web_url: item.links.website_url,
            external_ids: None,
            gallery: item.gallery.unwrap_or_default().into_iter().map(|s| s.url).collect(),
            published_at: Some(item.date_created),
            updated_at: Some(item.date_modified),
        })
    }

    async fn get_projects(&self, ids: &[String]) -> Result<Vec<ResourceProject>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let url = "https://api.curseforge.com/v1/mods";
        let mod_ids: Vec<u32> = ids.iter().filter_map(|id| id.parse::<u32>().ok()).collect();
        
        if mod_ids.is_empty() {
            return Ok(Vec::new());
        }

        let body = serde_json::json!({
            "modIds": mod_ids
        });

        let response = self.client.post(url)
            .json(&body)
            .send().await?;

        if !response.status().is_success() {
            return Err(anyhow!("CurseForge batch project fetch failed: {}", response.status()));
        }

        #[derive(Deserialize)]
        struct CFBatchResponse {
            data: Vec<CFMod>,
        }

        let response: CFBatchResponse = response.json().await?;
        
        Ok(response.data.into_iter().map(|item| ResourceProject {
            id: item.id.to_string(),
            source: SourcePlatform::CurseForge,
            resource_type: Self::map_class_id_to_type(item.class_id.unwrap_or(6)),
            name: item.name,
            summary: item.summary,
            description: None, // Batch fetch doesn't include full description
            icon_url: item.logo.map(|l| l.thumbnail_url),
            author: item.authors.first().map(|a| a.name.clone()).unwrap_or_else(|| "Unknown".to_string()),
            download_count: item.download_count as u64,
            follower_count: 0,
            categories: item.categories.into_iter().map(|c| c.name).collect(),
            web_url: item.links.website_url,
            external_ids: None,
            gallery: item.gallery.unwrap_or_default().into_iter().map(|s| s.url).collect(),
            published_at: Some(item.date_created),
            updated_at: Some(item.date_modified),
        }).collect())
    }

    async fn get_versions(&self, project_id: &str, game_version: Option<&str>, loader: Option<&str>) -> Result<Vec<ResourceVersion>> {
        let mut all_files = Vec::new();
        let mut index = 0;
        let page_size = 50;

        // CF uses specific IDs for loaders
        let mod_loader_type = loader.map(|l| match l.to_lowercase().as_str() {
            "forge" => 1,
            "fabric" => 4,
            "quilt" => 5,
            "neoforge" => 6,
            _ => 0,
        });

        // Fetch pages until we have all files
        // We use a reasonable limit of 20 pages (1000 files) to avoid extreme cases, 
        // but this is much higher than the previous 200.
        for page_idx in 0..20 {
            let mut url = format!("https://api.curseforge.com/v1/mods/{}/files?index={}&pageSize={}", project_id, index, page_size);
            
            if let Some(gv) = game_version {
                url.push_str(&format!("&gameVersion={}", gv));
            }
            if let Some(lt) = mod_loader_type {
                if lt > 0 {
                    url.push_str(&format!("&modLoaderType={}", lt));
                }
            }

            let response = self.client.get(&url).send().await?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(anyhow!("CurseForge API error fetching versions ({}): {}", status, body));
            }

            let res_data: CFFilesResponse = response.json().await.map_err(|e| {
                anyhow!("CurseForge versions JSON decode error: {}. Project: {}", e, project_id)
            })?;

            let count = res_data.data.len();
            all_files.extend(res_data.data);

            // Optimization: if we are filtering for a specific environment and got results, we likely don't need more
            if (game_version.is_some() || loader.is_some()) && count > 0 {
                break;
            }

            if count < page_size || (index + count as u32) >= res_data.pagination.total_count {
                break;
            }
            index += page_size as u32;

            // Small delay to be nice to the API if fetching many pages
            if page_idx > 5 {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }

        Ok(all_files.into_iter().map(|file| {
            let sha1 = file.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.clone()).unwrap_or_default();
            
            // Extract loaders from gameVersions
            let mut loaders = Vec::new();
            let mut game_versions = Vec::new();
            
            for v in &file.game_versions {
                match v.to_lowercase().as_str() {
                    "forge" | "fabric" | "quilt" | "neoforge" | "optifine" | "iris" => loaders.push(v.clone()),
                    _ => game_versions.push(v.clone()),
                }
            }
            
            ResourceVersion {
                id: file.id.to_string(),
                project_id: project_id.to_string(),
                version_number: file.display_name,
                game_versions,
                loaders,
                download_url: file.download_url.unwrap_or_else(|| {
                    // Fallback for hidden CF files (CDN pattern: id/1000/id%1000/filename)
                    let id = file.id;
                    let major = id / 1000;
                    let minor = id % 1000;
                    format!("https://edge.forgecdn.net/files/{}/{:03}/{}", major, minor, file.file_name)
                }),
                file_name: file.file_name,
                release_type: match file.release_type {
                    1 => ReleaseType::Release,
                    2 => ReleaseType::Beta,
                    3 => ReleaseType::Alpha,
                    _ => ReleaseType::Release,
                },
                hash: sha1,
                dependencies: file.dependencies.into_iter()
                    .map(|d| ResourceDependency {
                        project_id: d.mod_id.to_string(),
                        version_id: None,
                        file_name: None,
                        dependency_type: match d.relation_type {
                            2 => DependencyType::Optional,
                            3 => DependencyType::Required,
                            5 => DependencyType::Incompatible,
                            _ => DependencyType::Embedded, // Map 1 (Embedded), 4 (Tool), 6 (Include) to Embedded to skip resolution
                        },
                    }).collect(),
                published_at: Some(file.file_date),
            }
        }).collect())
    }

    async fn get_version(&self, project_id: &str, version_id: &str) -> Result<ResourceVersion> {
        let url = if project_id.is_empty() {
            format!("https://api.curseforge.com/v1/mods/files/{}", version_id)
        } else {
            format!("https://api.curseforge.com/v1/mods/{}/files/{}", project_id, version_id)
        };
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow!("CurseForge version fetch failed: {}. URL: {}", response.status(), url));
        }

        let res_data: CFFileResponse = response.json().await?;
        let file = res_data.data;
        let sha1 = file.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.clone()).unwrap_or_default();
        
        let mut loaders = Vec::new();
        let mut game_versions = Vec::new();
        for v in &file.game_versions {
            match v.to_lowercase().as_str() {
                "forge" | "fabric" | "quilt" | "neoforge" | "optifine" | "iris" => loaders.push(v.clone()),
                _ => game_versions.push(v.clone()),
            }
        }

        let resolved_project_id = if project_id.is_empty() {
            file.mod_id.to_string()
        } else {
            project_id.to_string()
        };

        Ok(ResourceVersion {
            id: file.id.to_string(),
            project_id: resolved_project_id,
            version_number: file.display_name,
            game_versions,
            loaders,
            download_url: file.download_url.unwrap_or_else(|| {
                let id = file.id;
                let major = id / 1000;
                let minor = id % 1000;
                format!("https://edge.forgecdn.net/files/{}/{:03}/{}", major, minor, file.file_name)
            }),
            file_name: file.file_name,
            release_type: match file.release_type {
                1 => ReleaseType::Release,
                2 => ReleaseType::Beta,
                3 => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            hash: sha1,
            dependencies: file.dependencies.into_iter()
                .map(|d| ResourceDependency {
                    project_id: d.mod_id.to_string(),
                    version_id: None,
                    file_name: None,
                    dependency_type: match d.relation_type {
                        2 => DependencyType::Optional,
                        3 => DependencyType::Required,
                        5 => DependencyType::Incompatible,
                        _ => DependencyType::Embedded,
                    },
                }).collect(),
            published_at: Some(file.file_date),
        })
    }

    async fn get_by_hash(&self, hash: &str) -> Result<(ResourceProject, ResourceVersion)> {
        let fingerprint = hash.parse::<u32>().map_err(|_| anyhow!("Invalid fingerprint: {}", hash))?;
        
        let url = "https://api.curseforge.com/v1/fingerprints";
        let body = serde_json::json!({
            "fingerprints": [fingerprint]
        });

        let response = self.client.post(url)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("CurseForge fingerprint lookup failed ({}): {}", status, body));
        }

        let result: CFFingerprintResponse = response.json().await.map_err(|e| {
            anyhow!("CurseForge fingerprint JSON decode error: {}. Hash: {}", e, hash)
        })?;

        let match_item = result.data.exact_matches.first()
            .ok_or_else(|| anyhow!("No match found for fingerprint"))?;

        let project = self.get_project(&match_item.id.to_string()).await?;
        
        // Map CFFile to ResourceVersion
        let file = &match_item.file;
        let sha1 = file.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.clone()).unwrap_or_default();
        let mut loaders = Vec::new();
        let mut game_versions = Vec::new();
        for v in &file.game_versions {
            match v.to_lowercase().as_str() {
                "forge" | "fabric" | "quilt" | "neoforge" | "optifine" | "iris" => loaders.push(v.clone()),
                _ => game_versions.push(v.clone()),
            }
        }

        let version = ResourceVersion {
            id: file.id.to_string(),
            project_id: project.id.clone(),
            version_number: file.display_name.clone(),
            game_versions,
            loaders,
            download_url: file.download_url.clone().unwrap_or_else(|| {
                // Fallback for hidden CF files
                let id = file.id;
                let major = id / 1000;
                let minor = id % 1000;
                format!("https://edge.forgecdn.net/files/{}/{:03}/{}", major, minor, file.file_name)
            }),
            file_name: file.file_name.clone(),
            release_type: match file.release_type {
                1 => ReleaseType::Release,
                2 => ReleaseType::Beta,
                3 => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            hash: sha1,
            dependencies: file.dependencies.iter().map(|d| ResourceDependency {
                project_id: d.mod_id.to_string(),
                version_id: None,
                file_name: None,
                dependency_type: match d.relation_type {
                    2 => DependencyType::Optional,
                    3 => DependencyType::Required,
                    5 => DependencyType::Incompatible,
                    _ => DependencyType::Embedded,
                },
            }).collect(),
            published_at: Some(file.file_date.clone()),
        };

        Ok((project, version))
    }

    fn platform(&self) -> SourcePlatform {
        SourcePlatform::CurseForge
    }
}
