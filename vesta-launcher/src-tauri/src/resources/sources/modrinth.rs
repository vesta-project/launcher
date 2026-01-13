use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, ReleaseType, SearchResponse};
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
}

#[derive(Deserialize)]
struct ModrinthFile {
    url: String,
    filename: String,
    hashes: ModrinthHashes,
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
            query.text.as_deref().unwrap_or(""),
            query.limit,
            query.offset
        );

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
            facets.push(format!("[\"categories:{}\"]", loader));
        }

        if !facets.is_empty() {
            url.push_str(&format!("&facets=[{}]", facets.join(",")));
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

        let hits = result.hits.into_iter().map(|hit| ResourceProject {
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
            screenshots: Vec::new(),
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
            screenshots: project.gallery.unwrap_or_default().into_iter().map(|i| i.raw_url.unwrap_or(i.url)).collect(),
            published_at: Some(project.published),
            updated_at: Some(project.updated),
        })
    }

    async fn get_versions(&self, project_id: &str) -> Result<Vec<ResourceVersion>> {
        let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Modrinth API error fetching versions ({}): {}", status, body));
        }

        let versions: Vec<ModrinthVersion> = response.json().await.map_err(|e| {
            anyhow!("Modrinth versions JSON decode error: {}. Project: {}", e, project_id)
        })?;

        Ok(versions.into_iter().map(|v| {
            let primary_file = v.files.iter().find(|f| f.url.ends_with(".jar") || f.url.ends_with(".zip")).unwrap_or(&v.files[0]);
            
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
            }
        }).collect())
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
        
        let primary_file = v.files.iter().find(|f| f.url.ends_with(".jar") || f.url.ends_with(".zip")).unwrap_or(&v.files[0]);
        
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
        };

        Ok((project, version))
    }

    fn platform(&self) -> SourcePlatform {
        SourcePlatform::Modrinth
    }
}
