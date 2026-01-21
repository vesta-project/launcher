use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, ReleaseType, SearchResponse, ResourceDependency, DependencyType};
use crate::resources::sources::ResourceSource;
use async_trait::async_trait;
use anyhow::Result;
use anyhow::anyhow;
use serde::Deserialize;
use reqwest::Client;

#[derive(Deserialize)]
struct ModrinthSearchResult {
    hits: Vec<ModrinthProjectHit>,
    total_hits: u64,
}

#[derive(Deserialize)]
struct ModrinthProjectHit {
    project_id: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    author: String,
    downloads: u64,
    categories: Option<Vec<String>>,
    project_type: String,
    slug: String,
    #[serde(rename = "date_created")]
    published: String,
    #[serde(rename = "date_modified")]
    updated: String,
    follows: u64,
}

#[derive(Deserialize)]
struct ModrinthProject {
    id: String,
    title: String,
    description: String,
    body: String,
    icon_url: Option<String>,
    downloads: u64,
    categories: Vec<String>,
    project_type: String,
    slug: String,
    gallery: Option<Vec<ModrinthGalleryItem>>,
    published: String,
    updated: String,
    followers: u64,
    team: String,
    curseforge_id: Option<String>,
}

#[derive(Deserialize)]
struct ModrinthTeamMember {
    user: ModrinthUser,
    role: String,
}

#[derive(Deserialize)]
struct ModrinthUser {
    username: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct ModrinthGalleryItem {
    url: String,
    featured: Option<bool>,
    title: Option<String>,
    description: Option<String>,
    raw_url: Option<String>,
}

#[derive(Deserialize)]
struct ModrinthVersion {
    id: String,
    project_id: String,
    version_number: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    files: Vec<ModrinthFile>,
    version_type: String,
    dependencies: Vec<ModrinthDependency>,
    date_published: String,
}

#[derive(Deserialize)]
struct ModrinthDependency {
    version_id: Option<String>,
    project_id: Option<String>,
    file_name: Option<String>,
    dependency_type: String,
}

#[derive(Deserialize)]
struct ModrinthFile {
    url: String,
    filename: String,
    hashes: ModrinthHashes,
    primary: bool,
}

#[derive(Deserialize)]
struct ModrinthHashes {
    sha1: String,
}

pub struct ModrinthSource {
    client: Client,
}

impl ModrinthSource {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent("VestaLauncher/0.1.0")
                .build()
                .unwrap(),
        }
    }
}

#[async_trait]
impl ResourceSource for ModrinthSource {
    async fn search(&self, query: SearchQuery) -> Result<SearchResponse> {
        let mut url = format!("https://api.modrinth.com/v2/search?query={}&limit={}&offset={}", 
            urlencoding::encode(query.text.as_deref().unwrap_or("")),
            query.limit,
            query.offset
        );

        if let Some(sort) = &query.sort_by {
            url.push_str(&format!("&index={}", sort));
        }

        // Add facets for filtering
        let mut facets = Vec::new();
        
        // Resource Type
        let mr_type = match query.resource_type {
            ResourceType::Mod => "mod",
            ResourceType::ResourcePack => "resourcepack",
            ResourceType::Shader => "shader",
            ResourceType::DataPack => "datapack",
            ResourceType::Modpack => "modpack",
        };
        facets.push(format!("[\"project_type:{}\"]", mr_type));

        if let Some(version) = query.game_version {
            facets.push(format!("[\"versions:{}\"]", version));
        }

        if let Some(loader) = query.loader {
            // Only apply loader filter for mods
            if query.resource_type == ResourceType::Mod {
                if loader.to_lowercase() == "quilt" {
                    facets.push("[\"categories:quilt\", \"categories:fabric\"]".to_string());
                } else {
                    facets.push(format!("[\"categories:{}\"]", loader.to_lowercase()));
                }
            }
        }

        if let Some(categories) = &query.categories {
            for category in categories {
                facets.push(format!("[\"categories:{}\"]", category));
            }
        }

        if let Some(q_facets) = &query.facets {
            for facet in q_facets {
                facets.push(format!("[\"{}\"]", facet));
            }
        }

        if !facets.is_empty() {
            let facets_json = format!("[{}]", facets.join(","));
            url.push_str(&format!("&facets={}", urlencoding::encode(&facets_json)));
        }

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Modrinth API error during search ({}): {}", status, body));
        }

        let result: ModrinthSearchResult = response.json().await.map_err(|e| {
            anyhow!("Modrinth search JSON decode error: {}. URL: {}", e, url)
        })?;

        let hits: Vec<ResourceProject> = result.hits.into_iter().map(|hit| ResourceProject {
            id: hit.project_id,
            source: SourcePlatform::Modrinth,
            resource_type: query.resource_type,
            name: hit.title,
            summary: hit.description,
            description: None,
            icon_url: hit.icon_url,
            author: hit.author,
            download_count: hit.downloads,
            follower_count: hit.follows,
            categories: hit.categories.unwrap_or_default(),
            web_url: format!("https://modrinth.com/{}/{}", hit.project_type, hit.slug),
            external_ids: None,
            gallery: Vec::new(),
            published_at: Some(hit.published),
            updated_at: Some(hit.updated),
        }).collect();

        Ok(SearchResponse {
            hits,
            total_hits: result.total_hits,
        })
    }

    async fn get_project(&self, id: &str) -> Result<ResourceProject> {
        let url = format!("https://api.modrinth.com/v2/project/{}", id);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Modrinth API error fetching project ({}): {}", status, body));
        }

        let project: ModrinthProject = response.json().await.map_err(|e| {
            anyhow!("Modrinth project JSON decode error: {}. ID: {}", e, id)
        })?;

        // Fetch team members to find author
        let team_url = format!("https://api.modrinth.com/v2/team/{}/members", project.team);
        let team_response = self.client.get(&team_url).send().await?;

        let members: Vec<ModrinthTeamMember> = if team_response.status().is_success() {
            team_response.json().await.unwrap_or_else(|_| Vec::new())
        } else {
            Vec::new()
        };
        
        // Use the first "Owner" or just first member
        let author_name = if members.is_empty() {
            "Unknown".to_string()
        } else {
            members.iter()
                .find(|m| m.role.to_lowercase() == "owner")
                .map(|m| m.user.username.clone())
                .unwrap_or_else(|| {
                    members.first().map(|m| m.user.username.clone()).unwrap_or_else(|| "Unknown".to_string())
                })
        };

        let res_type = match project.project_type.as_str() {
            "mod" => ResourceType::Mod,
            "resourcepack" => ResourceType::ResourcePack,
            "shader" => ResourceType::Shader,
            "datapack" => ResourceType::DataPack,
            "modpack" => ResourceType::Modpack,
            _ => ResourceType::Mod,
        };

        let mut external_ids = std::collections::HashMap::new();
        if let Some(cf_id) = project.curseforge_id {
            external_ids.insert("curseforge".to_string(), cf_id);
        }

        Ok(ResourceProject {
            id: project.id,
            source: SourcePlatform::Modrinth,
            resource_type: res_type,
            name: project.title,
            summary: project.description,
            description: Some(project.body),
            icon_url: project.icon_url,
            author: author_name,
            download_count: project.downloads,
            follower_count: project.followers,
            categories: project.categories,
            web_url: format!("https://modrinth.com/{}/{}", project.project_type, project.slug),
            external_ids: if external_ids.is_empty() { None } else { Some(external_ids) },
            gallery: project.gallery.unwrap_or_default().into_iter().map(|i| i.raw_url.unwrap_or(i.url)).collect(),
            published_at: Some(project.published),
            updated_at: Some(project.updated),
        })
    }

    async fn get_projects(&self, ids: &[String]) -> Result<Vec<ResourceProject>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let ids_json = serde_json::to_string(ids)?;
        let response = self.client.get("https://api.modrinth.com/v2/projects")
            .query(&[("ids", &ids_json)])
            .send().await?;
        
        if !response.status().is_success() {
            return Err(anyhow!("Modrinth batch project fetch failed: {}", response.status()));
        }

        let projects: Vec<ModrinthProject> = response.json().await.map_err(|e| {
            anyhow!("Modrinth batch projects JSON decode error: {}. IDs: {}", e, ids_json)
        })?;
        
        Ok(projects.into_iter().map(|p| {
            let res_type = match p.project_type.as_str() {
                "mod" => ResourceType::Mod,
                "resourcepack" => ResourceType::ResourcePack,
                "shader" => ResourceType::Shader,
                "datapack" => ResourceType::DataPack,
                "modpack" => ResourceType::Modpack,
                _ => ResourceType::Mod,
            };

            let mut external_ids = std::collections::HashMap::new();
            if let Some(cf_id) = p.curseforge_id {
                external_ids.insert("curseforge".to_string(), cf_id);
            }

            ResourceProject {
                id: p.id,
                source: SourcePlatform::Modrinth,
                resource_type: res_type,
                name: p.title,
                summary: p.description,
                description: Some(p.body),
                icon_url: p.icon_url,
                author: "Unknown".to_string(), // Batch doesn't provide authors in a simple way
                download_count: p.downloads,
                follower_count: p.followers,
                categories: p.categories,
                web_url: format!("https://modrinth.com/{}/{}", p.project_type, p.slug),
                external_ids: if external_ids.is_empty() { None } else { Some(external_ids) },
                gallery: p.gallery.unwrap_or_default().into_iter().map(|i| i.raw_url.unwrap_or(i.url)).collect(),
                published_at: Some(p.published),
                updated_at: Some(p.updated),
            }
        }).collect())
    }

    async fn get_versions(&self, project_id: &str, game_version: Option<&str>, loader: Option<&str>) -> Result<Vec<ResourceVersion>> {
        let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
        
        let mut params = Vec::new();
        if let Some(gv) = game_version {
            params.push(("game_versions", format!("[\"{}\"]", gv)));
        }
        if let Some(l) = loader {
            params.push(("loaders", format!("[\"{}\"]", l.to_lowercase())));
        }

        let response = self.client.get(&url)
            .query(&params)
            .send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Modrinth API error fetching versions ({}): {}", status, body));
        }

        let versions: Vec<ModrinthVersion> = response.json().await.map_err(|e| {
            anyhow!("Modrinth versions JSON decode error: {}. Project: {}", e, project_id)
        })?;

        Ok(versions.into_iter().map(|v| {
            let primary_file = v.files.iter().find(|f| f.primary)
                .or_else(|| v.files.iter().find(|f| {
                    let url = f.url.to_lowercase();
                    // Prioritize actual game files and exclude metadata/signatures
                    (url.ends_with(".mrpack") || url.ends_with(".jar") || url.ends_with(".zip")) 
                    && !url.contains("cosign-bundle")
                    && !url.ends_with(".asc")
                }))
                .unwrap_or(&v.files[0]);

            log::debug!("[Modrinth] Selected version file: {} (primary: {}) for version {}", 
                primary_file.filename, primary_file.primary, v.version_number);
            
            ResourceVersion {
                id: v.id,
                project_id: v.project_id,
                version_number: v.version_number,
                game_versions: v.game_versions,
                loaders: v.loaders,
                download_url: primary_file.url.clone(),
                file_name: primary_file.filename.clone(),
                release_type: match v.version_type.as_str() {
                    "release" => ReleaseType::Release,
                    "beta" => ReleaseType::Beta,
                    "alpha" => ReleaseType::Alpha,
                    _ => ReleaseType::Release,
                },
                hash: primary_file.hashes.sha1.clone(),
                dependencies: v.dependencies.into_iter()
                    .filter(|d| d.project_id.is_some())
                    .map(|d| ResourceDependency {
                        project_id: d.project_id.unwrap(),
                        version_id: d.version_id,
                        file_name: d.file_name,
                        dependency_type: match d.dependency_type.as_str() {
                            "required" => DependencyType::Required,
                            "optional" => DependencyType::Optional,
                            "incompatible" => DependencyType::Incompatible,
                            "embedded" => DependencyType::Embedded,
                            _ => DependencyType::Optional,
                        },
                    }).collect(),
                published_at: Some(v.date_published),
            }
        }).collect())
    }

    async fn get_version(&self, _project_id: &str, version_id: &str) -> Result<ResourceVersion> {
        let url = format!("https://api.modrinth.com/v2/version/{}", version_id);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow!("Modrinth version fetch failed: {}", response.status()));
        }

        let v: ModrinthVersion = response.json().await?;
        let primary_file = v.files.iter().find(|f| f.primary)
            .or_else(|| v.files.iter().find(|f| {
                let url = f.url.to_lowercase();
                (url.ends_with(".mrpack") || url.ends_with(".jar") || url.ends_with(".zip")) 
                && !url.ends_with(".cosign-bundle.json")
            }))
            .unwrap_or_else(|| v.files.first().expect("No files in version"));

        log::info!("[Modrinth] get_version: Selected {} (primary: {})", primary_file.filename, primary_file.primary);

        Ok(ResourceVersion {
            id: v.id,
            project_id: v.project_id,
            version_number: v.version_number,
            game_versions: v.game_versions,
            loaders: v.loaders,
            download_url: primary_file.url.clone(),
            file_name: primary_file.filename.clone(),
            release_type: match v.version_type.as_str() {
                "release" => ReleaseType::Release,
                "beta" => ReleaseType::Beta,
                "alpha" => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            hash: primary_file.hashes.sha1.clone(),
            dependencies: v.dependencies.into_iter().map(|d| ResourceDependency {
                project_id: d.project_id.unwrap_or_default(),
                version_id: d.version_id,
                file_name: d.file_name,
                dependency_type: match d.dependency_type.as_str() {
                    "required" => DependencyType::Required,
                    "optional" => DependencyType::Optional,
                    "incompatible" => DependencyType::Incompatible,
                    _ => DependencyType::Embedded,
                },
            }).collect(),
            published_at: Some(v.date_published),
        })
    }

    async fn get_by_hash(&self, hash: &str) -> Result<(ResourceProject, ResourceVersion)> {
        let url = format!("https://api.modrinth.com/v2/version_file/{}?algorithm=sha1", hash);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Modrinth hash lookup failed ({}): {}", status, body));
        }

        let v: ModrinthVersion = response.json().await.map_err(|e| {
            anyhow!("Modrinth hash lookup JSON decode error: {}. Hash: {}", e, hash)
        })?;

        let project = self.get_project(&v.project_id).await?;
        
        let primary_file = v.files.iter().find(|f| f.primary)
            .or_else(|| v.files.iter().find(|f| {
                let url = f.url.to_lowercase();
                (url.ends_with(".mrpack") || url.ends_with(".jar") || url.ends_with(".zip")) 
                && !url.ends_with(".cosign-bundle.json")
            }))
            .unwrap_or(&v.files[0]);

        log::info!("[Modrinth] get_by_hash: Selected project {} version {}, file: {} (primary: {})", 
            project.name, v.version_number, primary_file.filename, primary_file.primary);
        
        let version = ResourceVersion {
            id: v.id,
            project_id: v.project_id,
            version_number: v.version_number,
            game_versions: v.game_versions,
            loaders: v.loaders,
            download_url: primary_file.url.clone(),
            file_name: primary_file.filename.clone(),
            release_type: match v.version_type.as_str() {
                "release" => ReleaseType::Release,
                "beta" => ReleaseType::Beta,
                "alpha" => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            hash: primary_file.hashes.sha1.clone(),
            dependencies: v.dependencies.into_iter()
                .filter(|d| d.project_id.is_some())
                .map(|d| ResourceDependency {
                    project_id: d.project_id.unwrap(),
                    version_id: d.version_id,
                    file_name: d.file_name,
                    dependency_type: match d.dependency_type.as_str() {
                        "required" => DependencyType::Required,
                        "optional" => DependencyType::Optional,
                        "incompatible" => DependencyType::Incompatible,
                        "embedded" => DependencyType::Embedded,
                        _ => DependencyType::Optional,
                    },
                }).collect(),
            published_at: Some(v.date_published),
        };

        Ok((project, version))
    }

    fn platform(&self) -> SourcePlatform {
        SourcePlatform::Modrinth
    }
}
