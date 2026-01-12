use crate::models::resource::{ResourceProject, ResourceVersion, SearchQuery, SourcePlatform, ResourceType, ReleaseType, SearchResponse};
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
struct CFMod {
    id: u32,
    name: String,
    summary: String,
    description: Option<String>,
    links: CFLinks,
    logo: Option<CFLogo>,
    authors: Vec<CFAuthor>,
    download_count: f64,
    categories: Vec<CFCategory>,
    class_id: Option<u32>,
    screenshots: Option<Vec<CFScreenshot>>,
    date_created: String,
}

#[derive(Deserialize)]
struct CFScreenshot {
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
struct CFPagination {
    index: u32,
    page_size: u32,
    total_count: u32,
}

#[derive(Deserialize)]
struct CFFilesResponse {
    data: Vec<CFFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CFFile {
    id: u32,
    display_name: String,
    file_name: String,
    release_type: u8,
    game_versions: Vec<String>,
    hashes: Vec<CFHash>,
    download_url: Option<String>,
}

#[derive(Deserialize)]
struct CFHash {
    value: String,
    algo: u8, // 1 = Sha1, 2 = Md5
}

#[derive(Deserialize)]
struct CFDescriptionResponse {
    data: String,
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
                .user_agent("VestaLauncher/0.1.0")
                .default_headers(headers)
                .build()
                .unwrap(),
        }
    }

    fn map_class_id_to_type(class_id: u32) -> ResourceType {
        match class_id {
            6 => ResourceType::Mod,
            12 => ResourceType::ResourcePack,
            6552 => ResourceType::Shader,
            17 => ResourceType::DataPack, // This might vary or be under custom classes
            4471 => ResourceType::Modpack,
            _ => ResourceType::Mod,
        }
    }

    fn map_type_to_class_id(res_type: ResourceType) -> u32 {
        match res_type {
            ResourceType::Mod => 6,
            ResourceType::ResourcePack => 12,
            ResourceType::Shader => 6552,
            ResourceType::DataPack => 17,
            ResourceType::Modpack => 4471,
        }
    }
}

#[async_trait]
impl ResourceSource for CurseForgeSource {
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

        // Loader mapping for CF (1=Forge, 4=Fabric, 5=Quilt, 6=NeoForge)
        if let Some(loader) = query.loader {
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
            categories: item.categories.into_iter().map(|c| c.name).collect(),
            web_url: item.links.website_url,
            screenshots: item.screenshots.unwrap_or_default().into_iter().map(|s| s.url).collect(),
            published_at: Some(item.date_created),
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
            categories: item.categories.into_iter().map(|c| c.name).collect(),
            web_url: item.links.website_url,
            screenshots: item.screenshots.unwrap_or_default().into_iter().map(|s| s.url).collect(),
            published_at: Some(item.date_created),
        })
    }

    async fn get_versions(&self, project_id: &str) -> Result<Vec<ResourceVersion>> {
        let url = format!("https://api.curseforge.com/v1/mods/{}/files", project_id);
        let response = self.client.get(&url).send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("CurseForge API error fetching versions ({}): {}", status, body));
        }

        let response: CFFilesResponse = response.json().await.map_err(|e| {
            anyhow!("CurseForge versions JSON decode error: {}. Project: {}", e, project_id)
        })?;

        Ok(response.data.into_iter().map(|file| {
            let sha1 = file.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.clone()).unwrap_or_default();
            
            // Extract loaders from gameVersions
            let mut loaders = Vec::new();
            let mut game_versions = Vec::new();
            
            for v in &file.game_versions {
                match v.to_lowercase().as_str() {
                    "forge" | "fabric" | "quilt" | "neoforge" => loaders.push(v.clone()),
                    _ => game_versions.push(v.clone()),
                }
            }
            
            ResourceVersion {
                id: file.id.to_string(),
                project_id: project_id.to_string(),
                version_number: file.display_name,
                game_versions,
                loaders,
                download_url: file.download_url.unwrap_or_default(),
                file_name: file.file_name,
                release_type: match file.release_type {
                    1 => ReleaseType::Release,
                    2 => ReleaseType::Beta,
                    3 => ReleaseType::Alpha,
                    _ => ReleaseType::Release,
                },
                hash: sha1,
            }
        }).collect())
    }

    fn platform(&self) -> SourcePlatform {
        SourcePlatform::CurseForge
    }
}
