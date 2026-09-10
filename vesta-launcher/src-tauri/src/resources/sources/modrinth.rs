use crate::models::resource::{
    DependencyType, ReleaseType, ResourceAuthor, ResourceCategory, ResourceChangelogFormat,
    ResourceChangelogStatus, ResourceDependency, ResourceOrganization, ResourceProject,
    ResourceType, ResourceVersion, ResourceVersionDetails, SearchQuery, SearchResponse,
    SourcePlatform,
};
use crate::resources::sources::ResourceSource;
use anyhow::anyhow;
use anyhow::Result;
use async_trait::async_trait;
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

const MODRINTH_API_V3: &str = "https://api.modrinth.com/v3";
// v3 does not currently expose hash lookup endpoints. Keep these calls visibly
// isolated so the remaining v2 dependency can be removed independently.
const MODRINTH_LEGACY_API_V2: &str = "https://api.modrinth.com/v2";

#[derive(Deserialize)]
struct ModrinthCategory {
    icon: String,
    name: String,
    project_type: String,
    header: String,
}

#[derive(Deserialize)]
struct ModrinthSearchResult {
    hits: Vec<ModrinthProjectHit>,
    total_hits: u64,
}

#[derive(Deserialize)]
struct ModrinthProjectHit {
    project_id: String,
    name: String,
    #[serde(default)]
    summary: String,
    icon_url: Option<String>,
    #[serde(default)]
    author: String,
    #[serde(default)]
    author_id: String,
    organization: Option<String>,
    organization_id: Option<String>,
    downloads: u64,
    categories: Option<Vec<String>>,
    project_types: Vec<String>,
    slug: String,
    #[serde(rename = "date_created")]
    published: Option<String>,
    #[serde(rename = "date_modified")]
    updated: Option<String>,
    #[serde(default)]
    follows: u64,
    gallery: Option<Vec<String>>,
    featured_gallery: Option<String>,
}

#[derive(Deserialize)]
struct ModrinthProject {
    id: String,
    name: String,
    summary: String,
    description: String,
    icon_url: Option<String>,
    downloads: u64,
    categories: Vec<String>,
    project_types: Vec<String>,
    slug: String,
    gallery: Option<Vec<ModrinthGalleryItem>>,
    published: String,
    updated: String,
    followers: u64,
    team_id: String,
    organization: Option<String>,
}

#[derive(Deserialize)]
struct ModrinthTeamMember {
    team_id: String,
    user: ModrinthUser,
    role: String,
    #[serde(default)]
    is_owner: bool,
    #[serde(default)]
    accepted: bool,
    #[serde(default)]
    ordering: i64,
}

#[derive(Deserialize)]
struct ModrinthUser {
    id: String,
    username: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct ModrinthOrganization {
    id: String,
    slug: String,
    name: String,
    icon_url: Option<String>,
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
    #[serde(default)]
    downloads: Option<u64>,
    changelog: Option<String>,
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
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Deserialize)]
struct ModrinthHashes {
    sha1: String,
}

pub struct ModrinthSource {
    client: Client,
}

fn project_type_filter(resource_type: ResourceType) -> &'static str {
    if resource_type == ResourceType::DataPack {
        "all_project_types"
    } else {
        "project_types"
    }
}

fn resource_type(value: &str) -> ResourceType {
    match value {
        "resourcepack" => ResourceType::ResourcePack,
        "shader" => ResourceType::Shader,
        "datapack" => ResourceType::DataPack,
        "modpack" => ResourceType::Modpack,
        "world" => ResourceType::World,
        _ => ResourceType::Mod,
    }
}

fn primary_project_type(project_types: &[String]) -> &str {
    project_types.first().map(String::as_str).unwrap_or("mod")
}

fn map_project_types(project_types: &[String]) -> Vec<ResourceType> {
    project_types
        .iter()
        .map(|value| resource_type(value))
        .collect()
}

fn map_authors(mut members: Vec<ModrinthTeamMember>) -> Vec<ResourceAuthor> {
    members.retain(|member| member.accepted);
    members.sort_by_key(|member| (member.ordering, !member.is_owner));
    members
        .into_iter()
        .map(|member| ResourceAuthor {
            id: member.user.id,
            username: member.user.username,
            avatar_url: member.user.avatar_url,
            role: member.role,
            ordering: member.ordering,
        })
        .collect()
}

fn map_organization(organization: ModrinthOrganization) -> ResourceOrganization {
    ResourceOrganization {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        icon_url: organization.icon_url,
    }
}

impl Default for ModrinthSource {
    fn default() -> Self {
        Self::new()
    }
}

impl ModrinthSource {
    pub fn new() -> Self {
        Self {
            client: piston_lib::client::shared_client().clone(),
        }
    }

    async fn request_json<T: DeserializeOwned>(
        &self,
        request: RequestBuilder,
        operation: &str,
    ) -> Result<T> {
        let retry = request.try_clone();
        let mut response = request.send().await?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            if let Some(retry) = retry {
                let retry_after = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(1)
                    .min(30);
                tokio::time::sleep(Duration::from_secs(retry_after)).await;
                response = retry.send().await?;
            }
        }

        if !response.status().is_success() {
            let status = response.status();
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let body = response.text().await.unwrap_or_default();
            let description = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|value| {
                    value
                        .get("description")
                        .or_else(|| value.get("error"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .filter(|value| !value.is_empty())
                .unwrap_or(body);
            let retry_hint = retry_after
                .map(|seconds| format!("; retry after {seconds}s"))
                .unwrap_or_default();
            return Err(anyhow!(
                "Modrinth API {operation} failed ({status}{retry_hint}): {description}"
            ));
        }

        response
            .json()
            .await
            .map_err(|error| anyhow!("Modrinth API {operation} response was invalid: {error}"))
    }

    async fn fetch_search_url(&self, url: &str) -> Result<ModrinthSearchResult> {
        self.request_json(self.client.get(url), "search").await
    }

    fn map_version(v: ModrinthVersion, preferred_hash: Option<&str>) -> Result<ResourceVersion> {
        let selected_file = preferred_hash
            .and_then(|hash| v.files.iter().find(|file| file.hashes.sha1 == hash))
            .or_else(|| v.files.iter().find(|file| file.primary))
            .or_else(|| {
                v.files.iter().find(|file| {
                    let url = file.url.to_lowercase();
                    (url.ends_with(".mrpack") || url.ends_with(".jar") || url.ends_with(".zip"))
                        && !url.ends_with(".cosign-bundle.json")
                })
            })
            .or_else(|| v.files.first())
            .ok_or_else(|| anyhow!("Modrinth version {} has no files", v.id))?;

        Ok(ResourceVersion {
            id: v.id,
            project_id: v.project_id,
            version_number: v.version_number,
            game_versions: v.game_versions,
            loaders: v.loaders,
            download_url: selected_file.url.clone(),
            file_name: selected_file.filename.clone(),
            release_type: match v.version_type.as_str() {
                "release" => ReleaseType::Release,
                "beta" => ReleaseType::Beta,
                "alpha" => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            hash: selected_file.hashes.sha1.clone(),
            dependencies: v
                .dependencies
                .into_iter()
                .filter_map(|dependency| {
                    dependency.project_id.map(|project_id| ResourceDependency {
                        project_id,
                        version_id: dependency.version_id,
                        file_name: dependency.file_name,
                        dependency_type: match dependency.dependency_type.as_str() {
                            "required" => DependencyType::Required,
                            "optional" => DependencyType::Optional,
                            "incompatible" => DependencyType::Incompatible,
                            "embedded" => DependencyType::Embedded,
                            _ => DependencyType::Optional,
                        },
                    })
                })
                .collect(),
            published_at: Some(v.date_published),
            download_count: v.downloads,
            file_size: selected_file.size,
            // Modrinth files are alternatives, not companion artifacts. Keep
            // installation on the selected file represented above.
            files: Vec::new(),
        })
    }

    fn map_version_details(mut version: ModrinthVersion) -> Result<ResourceVersionDetails> {
        let changelog = version
            .changelog
            .take()
            .filter(|value| !value.trim().is_empty());
        let changelog_status = if changelog.is_some() {
            ResourceChangelogStatus::Available
        } else {
            ResourceChangelogStatus::Empty
        };

        Ok(ResourceVersionDetails {
            version: Self::map_version(version, None)?,
            changelog,
            changelog_format: ResourceChangelogFormat::Markdown,
            changelog_status,
        })
    }
}

#[async_trait]
impl ResourceSource for ModrinthSource {
    async fn search(&self, query: SearchQuery) -> Result<SearchResponse> {
        let mut url = format!(
            "{MODRINTH_API_V3}/search?query={}&limit={}&offset={}",
            urlencoding::encode(query.text.as_deref().unwrap_or("")),
            query.limit,
            query.offset
        );

        if let Some(sort) = &query.sort_by {
            url.push_str(&format!("&index={}", sort));
        }

        let mut filters = Vec::new();

        // Resource Type
        let mr_type = match query.resource_type {
            ResourceType::Mod => "mod",
            ResourceType::ResourcePack => "resourcepack",
            ResourceType::Shader => "shader",
            ResourceType::DataPack => "datapack",
            ResourceType::Modpack => "modpack",
            ResourceType::World => "world",
        };
        // A Modrinth project can publish mod, plugin, and datapack versions
        // under one project. `all_project_types` searches those version-level
        // distributions while `project_type` only describes the project shell.
        let project_type_filter = project_type_filter(query.resource_type);
        filters.push(format!("{project_type_filter} IN [\"{mr_type}\"]"));

        let has_optional_filters = query.game_version.is_some()
            || query.loader.is_some()
            || query
                .categories
                .as_ref()
                .is_some_and(|categories| !categories.is_empty())
            || query
                .facets
                .as_ref()
                .is_some_and(|facets| !facets.is_empty());
        let is_blank_query = query
            .text
            .as_deref()
            .map(|text| text.trim().is_empty())
            .unwrap_or(true);

        if let Some(version) = query.game_version {
            filters.push(format!(
                "game_versions IN [\"{}\"]",
                version.replace('"', "\\\"")
            ));
        }

        if let Some(loader) = query.loader {
            // Apply loader filter for mods and modpacks
            if query.resource_type == ResourceType::Mod
                || query.resource_type == ResourceType::Modpack
            {
                if loader.to_lowercase() == "quilt" {
                    filters.push("(loaders IN [\"quilt\"] OR loaders IN [\"fabric\"])".to_string());
                } else {
                    filters.push(format!("loaders IN [\"{}\"]", loader.to_lowercase()));
                }
            }
        }

        if let Some(categories) = &query.categories {
            for category in categories {
                filters.push(format!(
                    "categories IN [\"{}\"]",
                    category.replace('"', "\\\"")
                ));
            }
        }

        if let Some(q_facets) = &query.facets {
            for facet in q_facets {
                filters.push(facet.clone());
            }
        }

        if !filters.is_empty() {
            url.push_str(&format!(
                "&new_filters={}",
                urlencoding::encode(&filters.join(" AND "))
            ));
        }

        let mut result = self.fetch_search_url(&url).await?;

        if result.hits.is_empty() && is_blank_query && has_optional_filters && query.offset == 0 {
            let fallback_filter = format!("{project_type_filter} IN [\"{mr_type}\"]");
            let mut fallback_url = format!(
                "{MODRINTH_API_V3}/search?query=&limit={}&offset=0",
                query.limit
            );
            if let Some(sort) = &query.sort_by {
                fallback_url.push_str(&format!("&index={}", sort));
            }
            fallback_url.push_str(&format!(
                "&new_filters={}",
                urlencoding::encode(&fallback_filter)
            ));

            log::warn!(
                "[Modrinth] Blank search returned no hits with optional filters. Retrying default browse without compatibility/category filters. resource_type={}, limit={}, original_url={}, fallback_url={}",
                mr_type,
                query.limit,
                url,
                fallback_url
            );
            let fallback_result = self.fetch_search_url(&fallback_url).await?;
            log::info!(
                "[Modrinth] Blank search fallback returned {} hits (total_hits={}) for resource_type={}",
                fallback_result.hits.len(),
                fallback_result.total_hits,
                mr_type
            );
            result = fallback_result;
        }

        let hits: Vec<ResourceProject> = result
            .hits
            .into_iter()
            .map(|hit| {
                let author = if hit.author.is_empty() {
                    "Unknown".to_string()
                } else {
                    hit.author.clone()
                };
                ResourceProject {
                    id: hit.project_id,
                    source: SourcePlatform::Modrinth,
                    resource_type: query.resource_type,
                    name: hit.name,
                    summary: hit.summary,
                    description: None,
                    icon_url: hit.icon_url,
                    author: author.clone(),
                    authors: vec![author],
                    author_details: if hit.author_id.is_empty() {
                        Vec::new()
                    } else {
                        vec![ResourceAuthor {
                            id: hit.author_id,
                            username: hit.author,
                            avatar_url: None,
                            role: "Owner".to_string(),
                            ordering: 0,
                        }]
                    },
                    organization: match (hit.organization_id, hit.organization) {
                        (Some(id), Some(name)) => Some(ResourceOrganization {
                            id,
                            slug: String::new(),
                            name,
                            icon_url: None,
                        }),
                        _ => None,
                    },
                    project_types: map_project_types(&hit.project_types),
                    download_count: hit.downloads,
                    follower_count: hit.follows,
                    categories: hit.categories.unwrap_or_default(),
                    web_url: format!(
                        "https://modrinth.com/{}/{}",
                        primary_project_type(&hit.project_types),
                        hit.slug
                    ),
                    external_ids: None,
                    gallery: hit.gallery.unwrap_or_default(),
                    featured_gallery: hit.featured_gallery,
                    published_at: hit.published,
                    updated_at: hit.updated,
                }
            })
            .collect();

        Ok(SearchResponse {
            hits,
            total_hits: result.total_hits,
        })
    }

    async fn get_project(&self, id: &str) -> Result<ResourceProject> {
        let url = format!("{MODRINTH_API_V3}/project/{id}");
        let project: ModrinthProject = self
            .request_json(self.client.get(&url), "fetch project")
            .await?;

        // Attribution is enrichment: a temporary team/organization failure must
        // not make an otherwise installable project disappear.
        let team_url = format!("{MODRINTH_API_V3}/project/{}/members", project.id);
        let author_details = self
            .request_json(self.client.get(&team_url), "fetch project members")
            .await
            .map(map_authors)
            .unwrap_or_default();

        let author_name = author_details
            .first()
            .map(|author| author.username.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        let authors_list = if author_details.is_empty() {
            vec!["Unknown".to_string()]
        } else {
            author_details
                .iter()
                .map(|author| author.username.clone())
                .collect()
        };

        let organization = if let Some(organization_id) = project.organization.as_deref() {
            let url = format!("{MODRINTH_API_V3}/organization/{organization_id}");
            self.request_json(self.client.get(url), "fetch organization")
                .await
                .ok()
                .map(map_organization)
        } else {
            None
        };

        let primary_type = primary_project_type(&project.project_types).to_string();

        let featured_gallery = project
            .gallery
            .as_ref()
            .and_then(|items| items.iter().find(|i| i.featured == Some(true)))
            .and_then(|item| item.raw_url.clone().or_else(|| Some(item.url.clone())));

        Ok(ResourceProject {
            id: project.id,
            source: SourcePlatform::Modrinth,
            resource_type: resource_type(&primary_type),
            name: project.name,
            summary: project.summary,
            description: Some(project.description),
            icon_url: project.icon_url,
            author: author_name,
            authors: authors_list,
            author_details,
            organization,
            project_types: map_project_types(&project.project_types),
            download_count: project.downloads,
            follower_count: project.followers,
            categories: project.categories,
            web_url: format!("https://modrinth.com/{}/{}", primary_type, project.slug),
            external_ids: None,
            gallery: project
                .gallery
                .unwrap_or_default()
                .into_iter()
                .map(|i| i.raw_url.unwrap_or(i.url))
                .collect(),
            featured_gallery,
            published_at: Some(project.published),
            updated_at: Some(project.updated),
        })
    }

    async fn get_projects(&self, ids: &[String]) -> Result<Vec<ResourceProject>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let ids_json = serde_json::to_string(ids)?;
        let projects: Vec<ModrinthProject> = self
            .request_json(
                self.client
                    .get(format!("{MODRINTH_API_V3}/projects"))
                    .query(&[("ids", &ids_json)]),
                "fetch projects",
            )
            .await?;

        let mut team_ids = projects
            .iter()
            .map(|project| project.team_id.clone())
            .collect::<Vec<_>>();
        team_ids.sort();
        team_ids.dedup();
        let members_by_team = if team_ids.is_empty() {
            HashMap::new()
        } else {
            let team_ids_json = serde_json::to_string(&team_ids)?;
            match self
                .request_json::<Vec<Vec<ModrinthTeamMember>>>(
                    self.client
                        .get(format!("{MODRINTH_API_V3}/teams"))
                        .query(&[("ids", &team_ids_json)]),
                    "fetch project teams",
                )
                .await
            {
                Ok(groups) => groups
                    .into_iter()
                    .filter_map(|members| {
                        let team_id = members.first()?.team_id.clone();
                        Some((team_id, map_authors(members)))
                    })
                    .collect(),
                Err(error) => {
                    log::warn!("[Modrinth] Team enrichment failed: {error}");
                    HashMap::new()
                }
            }
        };

        let mut organization_ids = projects
            .iter()
            .filter_map(|project| project.organization.clone())
            .collect::<Vec<_>>();
        organization_ids.sort();
        organization_ids.dedup();
        let organizations_by_id = if organization_ids.is_empty() {
            HashMap::new()
        } else {
            let organization_ids_json = serde_json::to_string(&organization_ids)?;
            match self
                .request_json::<Vec<ModrinthOrganization>>(
                    self.client
                        .get(format!("{MODRINTH_API_V3}/organizations"))
                        .query(&[("ids", &organization_ids_json)]),
                    "fetch organizations",
                )
                .await
            {
                Ok(organizations) => organizations
                    .into_iter()
                    .map(|organization| (organization.id.clone(), map_organization(organization)))
                    .collect(),
                Err(error) => {
                    log::warn!("[Modrinth] Organization enrichment failed: {error}");
                    HashMap::new()
                }
            }
        };

        Ok(projects
            .into_iter()
            .map(|p| {
                let primary_type = primary_project_type(&p.project_types).to_string();
                let author_details = members_by_team.get(&p.team_id).cloned().unwrap_or_default();
                let authors = author_details
                    .iter()
                    .map(|author| author.username.clone())
                    .collect::<Vec<_>>();
                let author = authors
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "Unknown".to_string());
                let organization = p
                    .organization
                    .as_ref()
                    .and_then(|id| organizations_by_id.get(id))
                    .cloned();

                let featured_gallery = p
                    .gallery
                    .as_ref()
                    .and_then(|items| items.iter().find(|i| i.featured == Some(true)))
                    .and_then(|item| item.raw_url.clone().or_else(|| Some(item.url.clone())));

                ResourceProject {
                    id: p.id,
                    source: SourcePlatform::Modrinth,
                    resource_type: resource_type(&primary_type),
                    name: p.name,
                    summary: p.summary,
                    description: Some(p.description),
                    icon_url: p.icon_url,
                    author,
                    authors,
                    author_details,
                    organization,
                    project_types: map_project_types(&p.project_types),
                    download_count: p.downloads,
                    follower_count: p.followers,
                    categories: p.categories,
                    web_url: format!("https://modrinth.com/{}/{}", primary_type, p.slug),
                    external_ids: None,
                    gallery: p
                        .gallery
                        .unwrap_or_default()
                        .into_iter()
                        .map(|i| i.raw_url.unwrap_or(i.url))
                        .collect(),
                    featured_gallery,
                    published_at: Some(p.published),
                    updated_at: Some(p.updated),
                }
            })
            .collect())
    }

    async fn get_versions(
        &self,
        project_id: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<ResourceVersion>> {
        let url = format!("{MODRINTH_API_V3}/project/{project_id}/version");

        let mut params = Vec::new();
        if let Some(gv) = game_version {
            params.push((
                "loader_fields",
                serde_json::json!({ "game_versions": [gv] }).to_string(),
            ));
        }
        if let Some(l) = loader {
            params.push(("loaders", format!("[\"{}\"]", l.to_lowercase())));
        }

        let versions: Vec<ModrinthVersion> = self
            .request_json(
                self.client.get(&url).query(&params),
                "fetch project versions",
            )
            .await?;

        versions
            .into_iter()
            .map(|version| Self::map_version(version, None))
            .collect()
    }

    async fn get_version(&self, _project_id: &str, version_id: &str) -> Result<ResourceVersion> {
        let url = format!("{MODRINTH_API_V3}/version/{version_id}");
        let v: ModrinthVersion = self
            .request_json(self.client.get(&url), "fetch version")
            .await?;
        Self::map_version(v, None)
    }

    async fn get_version_details(
        &self,
        _project_id: &str,
        version_id: &str,
    ) -> Result<ResourceVersionDetails> {
        let url = format!("{MODRINTH_API_V3}/version/{version_id}");
        let version = self
            .request_json(self.client.get(&url), "fetch version details")
            .await?;
        Self::map_version_details(version)
    }

    async fn get_by_hash(&self, hash: &str) -> Result<(ResourceProject, ResourceVersion)> {
        let url = format!("{MODRINTH_LEGACY_API_V2}/version_file/{hash}?algorithm=sha1");
        let v: ModrinthVersion = self
            .request_json(self.client.get(&url), "look up version by hash")
            .await?;

        let project = self.get_project(&v.project_id).await?;
        let version = Self::map_version(v, Some(hash))?;

        log::info!(
            "[Modrinth] get_by_hash: Selected project {} version {}, file: {}",
            project.name,
            version.version_number,
            version.file_name
        );

        Ok((project, version))
    }

    async fn get_by_hashes(
        &self,
        hashes: &[String],
    ) -> Result<HashMap<String, (ResourceProject, ResourceVersion)>> {
        if hashes.is_empty() {
            return Ok(HashMap::new());
        }

        let versions: HashMap<String, ModrinthVersion> = self
            .request_json(
                self.client
                    .post(format!("{MODRINTH_LEGACY_API_V2}/version_files"))
                    .json(&serde_json::json!({
                        "hashes": hashes,
                        "algorithm": "sha1"
                    })),
                "look up versions by hash",
            )
            .await?;
        let project_ids = versions
            .values()
            .map(|version| version.project_id.clone())
            .collect::<Vec<_>>();
        let projects = self.get_projects(&project_ids).await?;
        let projects_by_id = projects
            .into_iter()
            .map(|project| (project.id.clone(), project))
            .collect::<HashMap<_, _>>();

        let mut matches = HashMap::new();
        for (hash, version) in versions {
            let project_id = version.project_id.clone();
            let Some(project) = projects_by_id.get(&project_id).cloned() else {
                continue;
            };
            matches.insert(
                hash.clone(),
                (project, Self::map_version(version, Some(&hash))?),
            );
        }
        Ok(matches)
    }

    fn identification_batch_size(&self) -> usize {
        100
    }

    fn identification_concurrency(&self) -> usize {
        3
    }

    async fn get_categories(&self) -> Result<Vec<ResourceCategory>> {
        let url = format!("{MODRINTH_API_V3}/tag/category");
        let cats: Vec<ModrinthCategory> = self
            .request_json(self.client.get(url), "fetch categories")
            .await?;
        Ok(cats
            .into_iter()
            .filter(|c| {
                let name = c.name.to_lowercase();
                // Filter out loader types and categories that are served as loaders
                if matches!(
                    name.as_str(),
                    "fabric"
                        | "forge"
                        | "quilt"
                        | "neoforge"
                        | "liteloader"
                        | "rift"
                        | "categories"
                ) {
                    return false;
                }

                // Only include categories that match our supported project types
                matches!(
                    c.project_type.as_str(),
                    "mod" | "modpack" | "resourcepack" | "shader" | "datapack"
                )
            })
            .map(|c| ResourceCategory {
                id: c.name.to_lowercase(),
                name: c.name,
                icon_url: Some(c.icon), // Modrinth icon is SVG string (raw SVG)
                parent_id: Some(c.header),
                display_index: None,
                project_type: match c.project_type.as_str() {
                    "mod" => Some(ResourceType::Mod),
                    "modpack" => Some(ResourceType::Modpack),
                    "resourcepack" => Some(ResourceType::ResourcePack),
                    "shader" => Some(ResourceType::Shader),
                    "datapack" => Some(ResourceType::DataPack),
                    _ => None,
                },
            })
            .collect())
    }

    fn platform(&self) -> SourcePlatform {
        SourcePlatform::Modrinth
    }
}

#[cfg(test)]
mod tests {
    use super::{
        map_authors, project_type_filter, ModrinthSource, ModrinthTeamMember, ModrinthVersion,
    };
    use crate::models::resource::{
        DependencyType, ResourceChangelogFormat, ResourceChangelogStatus, ResourceType,
    };

    #[test]
    fn datapack_searches_include_mixed_modrinth_projects() {
        assert_eq!(
            project_type_filter(ResourceType::DataPack),
            "all_project_types"
        );
        assert_eq!(project_type_filter(ResourceType::Mod), "project_types");
    }

    #[test]
    fn accepted_authors_are_ordered_with_owner_first_on_ties() {
        let members: Vec<ModrinthTeamMember> = serde_json::from_value(serde_json::json!([
            {"team_id":"team","user":{"id":"member","username":"Member","avatar_url":null},"role":"Developer","is_owner":false,"accepted":true,"ordering":0},
            {"team_id":"team","user":{"id":"pending","username":"Pending","avatar_url":null},"role":"Member","is_owner":false,"accepted":false,"ordering":-1},
            {"team_id":"team","user":{"id":"owner","username":"Owner","avatar_url":null},"role":"Owner","is_owner":true,"accepted":true,"ordering":0}
        ])).unwrap();

        let authors = map_authors(members);

        assert_eq!(authors.len(), 2);
        assert_eq!(authors[0].username, "Owner");
        assert_eq!(authors[1].username, "Member");
    }

    #[test]
    fn maps_version_details_fixture() {
        let payload: ModrinthVersion = serde_json::from_value(serde_json::json!({
            "id": "version-1",
            "project_id": "project-1",
            "version_number": "1.2.3",
            "game_versions": ["1.21.1"],
            "loaders": ["fabric"],
            "files": [
                {
                    "url": "https://example.invalid/file.jar",
                    "filename": "file.jar",
                    "hashes": { "sha1": "abc123" },
                    "primary": true,
                    "size": 4096
                },
                {
                    "url": "https://example.invalid/file-sources.jar",
                    "filename": "file-sources.jar",
                    "hashes": { "sha1": "def456" },
                    "primary": false,
                    "size": 2048
                }
            ],
            "version_type": "release",
            "dependencies": [{
                "version_id": "dependency-version",
                "project_id": "dependency-project",
                "file_name": null,
                "dependency_type": "required"
            }],
            "date_published": "2026-08-01T00:00:00Z",
            "downloads": 42,
            "changelog": "## Changes\n\n- Faster"
        }))
        .unwrap();

        let details = ModrinthSource::map_version_details(payload).unwrap();

        assert_eq!(
            details.version.published_at.as_deref(),
            Some("2026-08-01T00:00:00Z")
        );
        assert_eq!(details.version.download_count, Some(42));
        assert_eq!(details.version.file_size, Some(4096));
        assert!(details.version.files.is_empty());
        assert_eq!(
            details.version.dependencies[0].dependency_type,
            DependencyType::Required
        );
        assert_eq!(details.changelog.as_deref(), Some("## Changes\n\n- Faster"));
        assert_eq!(details.changelog_format, ResourceChangelogFormat::Markdown);
        assert_eq!(details.changelog_status, ResourceChangelogStatus::Available);
    }

    #[test]
    fn version_without_files_returns_an_error() {
        let payload: ModrinthVersion = serde_json::from_value(serde_json::json!({
            "id": "empty-version",
            "project_id": "project-1",
            "version_number": "1.0.0",
            "game_versions": [],
            "loaders": [],
            "files": [],
            "version_type": "release",
            "dependencies": [],
            "date_published": "2026-08-01T00:00:00Z",
            "downloads": 0,
            "changelog": null
        }))
        .unwrap();

        let error = ModrinthSource::map_version(payload, None).unwrap_err();

        assert!(error.to_string().contains("has no files"));
    }
}
