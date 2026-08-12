use crate::models::resource::{
    DependencyType, ReleaseType, ResourceCategory, ResourceChangelogFormat,
    ResourceChangelogStatus, ResourceDependency, ResourceProject, ResourceType, ResourceVersion,
    ResourceVersionDetails, ResourceVersionFile, SearchQuery, SearchResponse, SourcePlatform,
};
use crate::resources::sources::ResourceSource;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

const API_BASE: &str = "https://api.smithed.dev/v2";
const WEB_BASE: &str = "https://smithed.dev/packs";
const MODRINTH_API: &str = "https://api.modrinth.com/v2";
/// Public Firebase Storage bucket used by Smithed for uploaded gallery files.
const GALLERY_CDN_BASE: &str =
    "https://firebasestorage.googleapis.com/v0/b/mc-smithed.appspot.com/o";

const PACK_CATEGORIES: &[&str] = &[
    "Extensive",
    "Lightweight",
    "QoL",
    "Vanilla+",
    "Tech",
    "Magic",
    "Exploration",
    "World Overhaul",
    "Library",
    "No Resource Pack",
];

#[derive(Debug, Deserialize)]
struct SmithedSearchHit {
    id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    data: Option<SmithedSearchData>,
    meta: Option<SmithedPackMeta>,
    /// Denormalized Typesense owner (via `scope=owner` / `owner.displayName`).
    owner: Option<SmithedSearchOwner>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SmithedSearchOwner {
    display_name: Option<String>,
    clean_name: Option<String>,
    #[allow(dead_code)]
    id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct SmithedSearchData {
    display: Option<SmithedDisplay>,
    categories: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct SmithedDisplay {
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    #[serde(default)]
    hidden: bool,
    #[serde(rename = "webPage")]
    web_page: Option<String>,
    gallery: Option<SmithedGallery>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
enum SmithedGallery {
    Urls(Vec<String>),
    Items(Vec<SmithedGalleryItem>),
}

#[derive(Debug, Deserialize, Clone)]
struct SmithedGalleryItem {
    #[serde(rename = "type")]
    item_type: Option<String>,
    content: Option<String>,
    uid: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SmithedPackMeta {
    doc_id: Option<String>,
    raw_id: Option<String>,
    stats: Option<SmithedStats>,
    owner: Option<String>,
    contributors: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct SmithedStats {
    updated: Option<u64>,
    added: Option<u64>,
    downloads: Option<SmithedDownloadStats>,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct SmithedDownloadStats {
    total: Option<u64>,
    #[allow(dead_code)]
    today: Option<u64>,
    #[serde(rename = "pastWeek")]
    #[allow(dead_code)]
    past_week: Option<u64>,
    #[serde(rename = "pastMonth")]
    #[allow(dead_code)]
    past_month: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SmithedPackData {
    id: Option<String>,
    display: SmithedDisplay,
    #[serde(default)]
    versions: Vec<SmithedPackVersion>,
    #[serde(default)]
    categories: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct SmithedPackVersion {
    name: String,
    #[serde(default)]
    supports: Vec<String>,
    #[serde(default)]
    downloads: SmithedDownloads,
    #[serde(default)]
    dependencies: Vec<SmithedPackReference>,
    #[serde(default)]
    breaking: bool,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct SmithedDownloads {
    datapack: Option<String>,
    resourcepack: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct SmithedPackReference {
    id: String,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmithedUser {
    #[allow(dead_code)]
    uid: Option<String>,
    clean_name: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionFile {
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersion {
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    files: Vec<ModrinthVersionFile>,
}

pub struct SmithedSource {
    client: Client,
    user_names: Arc<RwLock<HashMap<String, String>>>,
}

impl SmithedSource {
    pub fn new() -> Self {
        Self {
            client: piston_lib::client::shared_client().clone(),
            user_names: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn map_sort(sort_by: Option<&str>) -> &'static str {
        match sort_by.map(|s| s.to_ascii_lowercase()).as_deref() {
            Some("downloads") | Some("totaldownloads") | Some("popularity") => "downloads",
            Some("alphabetically") | Some("name") => "alphabetically",
            Some("newest") | Some("updated") | Some("lastupdated") | Some("datecreated") => {
                "newest"
            }
            Some("trending") | Some("relevance") | Some("featured") | Some("follows") | _ => {
                "trending"
            }
        }
    }

    fn non_empty(url: Option<&String>) -> Option<&str> {
        url.map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn file_name_from_url(url: &str) -> String {
        url::Url::parse(url)
            .ok()
            .and_then(|parsed| {
                parsed
                    .path_segments()
                    .and_then(|mut segments| segments.next_back())
                    .map(|segment| {
                        urlencoding::decode(segment)
                            .map(|decoded| decoded.into_owned())
                            .unwrap_or_else(|_| segment.to_string())
                    })
            })
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "pack.zip".to_string())
    }

    fn looks_like_direct_file_url(url: &str) -> bool {
        let lower = url.to_ascii_lowercase();
        lower.contains("cdn.modrinth.com/")
            || lower.contains("mediafilez.forgecdn.net/")
            || lower.contains("edge.forgecdn.net/")
            || lower.contains("/releases/download/")
            || lower.contains("raw.githubusercontent.com/")
            || lower.contains(".zip?")
            || lower.contains(".jar?")
            || lower.ends_with(".zip")
            || lower.ends_with(".jar")
    }

    fn modrinth_slug_from_url(url: &str) -> Option<String> {
        let parsed = url::Url::parse(url).ok()?;
        let host = parsed.host_str()?.to_ascii_lowercase();
        if !host.ends_with("modrinth.com") {
            return None;
        }
        let mut segments = parsed.path_segments()?;
        let _project_type = segments.next()?;
        let slug = segments.next()?.trim();
        if slug.is_empty() {
            return None;
        }
        Some(slug.to_string())
    }

    fn score_modrinth_file(role: &str, file_name: &str) -> i32 {
        let lower = file_name.to_ascii_lowercase();
        let mut score = 0;
        match role {
            "datapack" => {
                if lower.contains("datapack") || lower.contains("data pack") {
                    score += 40;
                }
                if lower.ends_with(".zip") {
                    score += 20;
                }
                if lower.ends_with(".jar") {
                    score -= 30;
                }
            }
            "resourcepack" => {
                if lower.contains("resource") || lower.contains("assets") {
                    score += 40;
                }
                if lower.ends_with(".zip") {
                    score += 20;
                }
                if lower.ends_with(".jar") {
                    score -= 30;
                }
            }
            _ => {
                if lower.ends_with(".zip") || lower.ends_with(".jar") {
                    score += 10;
                }
            }
        }
        score
    }

    async fn resolve_modrinth_file(
        &self,
        slug: &str,
        role: &str,
        supports: &[String],
    ) -> Option<(String, String)> {
        let url = format!("{MODRINTH_API}/project/{}/version", urlencoding::encode(slug));
        let response = self.client.get(&url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let versions: Vec<ModrinthVersion> = response.json().await.ok()?;
        let support_set: HashSet<&str> = supports.iter().map(String::as_str).collect();

        let mut best: Option<(i32, String, String)> = None;
        for version in versions {
            let game_overlap = if support_set.is_empty() {
                1
            } else {
                version
                    .game_versions
                    .iter()
                    .filter(|gv| {
                        support_set.contains(gv.as_str())
                            || supports.iter().any(|s| gv.contains(s) || s.contains(gv.as_str()))
                    })
                    .count()
            };
            if game_overlap == 0 && !supports.is_empty() {
                continue;
            }

            for file in version.files {
                let mut score = Self::score_modrinth_file(role, &file.filename);
                score += (game_overlap as i32) * 10;
                if file.primary {
                    score += 5;
                }
                match &best {
                    Some((best_score, _, _)) if *best_score >= score => {}
                    _ => best = Some((score, file.url, file.filename)),
                }
            }
        }

        best.map(|(_, url, name)| (url, name))
    }

    async fn resolve_download_url(
        &self,
        url: &str,
        role: &str,
        supports: &[String],
    ) -> Option<(String, String)> {
        if Self::looks_like_direct_file_url(url) {
            return Some((url.to_string(), Self::file_name_from_url(url)));
        }
        if let Some(slug) = Self::modrinth_slug_from_url(url) {
            if let Some(resolved) = self.resolve_modrinth_file(&slug, role, supports).await {
                return Some(resolved);
            }
            log::warn!(
                "[Smithed] Could not resolve Modrinth page URL to a file for role {}: {}",
                role,
                url
            );
            return None;
        }
        // Unknown host / likely HTML page — refuse rather than downloading a website.
        if url.contains("://") {
            log::warn!(
                "[Smithed] Skipping non-direct download URL for role {}: {}",
                role,
                url
            );
            return None;
        }
        None
    }

    fn millis_to_rfc3339(ms: Option<u64>) -> Option<String> {
        ms.and_then(|value| {
            chrono::DateTime::from_timestamp_millis(value as i64).map(|dt| dt.to_rfc3339())
        })
    }

    /// Build gallery image URLs without calling `/packs/{id}/gallery/{index}` when possible.
    ///
    /// Typesense only returns `{type, uid, caption}` (no Firebase URL). For `type: "file"`,
    /// Smithed's API would redirect to Firebase Storage as
    /// `gallery_images/{docId}-{uid}.webp` — construct that CDN URL directly.
    /// `type: "bucket"` stores opaque blob content that only the API turns into an image,
    /// so those still use the indexed pack gallery endpoint.
    fn gallery_urls(
        pack_id: &str,
        doc_id: Option<&str>,
        gallery: Option<&SmithedGallery>,
    ) -> Vec<String> {
        match gallery {
            Some(SmithedGallery::Urls(urls)) => urls
                .iter()
                .filter(|url| !url.trim().is_empty())
                .cloned()
                .collect(),
            Some(SmithedGallery::Items(items)) => items
                .iter()
                .enumerate()
                .filter_map(|(index, item)| {
                    if let Some(content) = item
                        .content
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        return Some(content.to_string());
                    }

                    let uid = item
                        .uid
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())?;
                    let item_type = item
                        .item_type
                        .as_deref()
                        .map(str::trim)
                        .unwrap_or_default();

                    match item_type {
                        "file" => {
                            let doc = doc_id
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .unwrap_or(pack_id);
                            Some(format!(
                                "{GALLERY_CDN_BASE}/gallery_images%2F{doc}-{uid}.webp?alt=media"
                            ))
                        }
                        // Bucket blobs need the API to decode/serve an image.
                        _ => Some(format!("{API_BASE}/packs/{pack_id}/gallery/{index}")),
                    }
                })
                .collect(),
            None => Vec::new(),
        }
    }

    fn version_has_role(version: &SmithedPackVersion, role: &str) -> bool {
        match role {
            "datapack" => Self::non_empty(version.downloads.datapack.as_ref()).is_some(),
            "resourcepack" => Self::non_empty(version.downloads.resourcepack.as_ref()).is_some(),
            _ => false,
        }
    }

    fn infer_resource_type(versions: &[SmithedPackVersion]) -> ResourceType {
        let has_datapack = versions.iter().any(|v| Self::version_has_role(v, "datapack"));
        let has_resourcepack = versions
            .iter()
            .any(|v| Self::version_has_role(v, "resourcepack"));
        match (has_datapack, has_resourcepack) {
            (true, _) => ResourceType::DataPack,
            (false, true) => ResourceType::ResourcePack,
            _ => ResourceType::DataPack,
        }
    }

    fn preferred_role_for_query(resource_type: ResourceType) -> &'static str {
        match resource_type {
            ResourceType::ResourcePack => "resourcepack",
            // Smithed is datapack-first; companion RPs still land in version.files.
            _ => "datapack",
        }
    }

    fn map_version(
        project_id: &str,
        version: &SmithedPackVersion,
        preferred_role: &str,
        files: Vec<ResourceVersionFile>,
    ) -> Option<ResourceVersion> {
        if files.is_empty() {
            return None;
        }

        let primary = files
            .iter()
            .find(|file| file.role == preferred_role)
            .or_else(|| files.first())
            .cloned()?;

        Some(ResourceVersion {
            id: version.name.clone(),
            project_id: project_id.to_string(),
            version_number: version.name.clone(),
            game_versions: version.supports.clone(),
            loaders: Vec::new(),
            download_url: primary.url.clone(),
            file_name: primary.file_name.clone(),
            release_type: if version.breaking {
                ReleaseType::Beta
            } else {
                ReleaseType::Release
            },
            hash: String::new(),
            dependencies: version
                .dependencies
                .iter()
                .map(|dep| ResourceDependency {
                    project_id: dep.id.clone(),
                    version_id: dep.version.clone(),
                    file_name: None,
                    dependency_type: DependencyType::Required,
                })
                .collect(),
            published_at: None,
            download_count: None,
            file_size: None,
            files,
        })
    }

    async fn map_version_resolved(
        &self,
        project_id: &str,
        version: &SmithedPackVersion,
        preferred_role: &str,
    ) -> Option<ResourceVersion> {
        let mut files = Vec::new();
        if let Some(url) = Self::non_empty(version.downloads.datapack.as_ref()) {
            if let Some((resolved_url, file_name)) = self
                .resolve_download_url(url, "datapack", &version.supports)
                .await
            {
                files.push(ResourceVersionFile {
                    url: resolved_url,
                    file_name,
                    hash: String::new(),
                    file_size: None,
                    role: "datapack".to_string(),
                });
            }
        }
        if let Some(url) = Self::non_empty(version.downloads.resourcepack.as_ref()) {
            if let Some((resolved_url, file_name)) = self
                .resolve_download_url(url, "resourcepack", &version.supports)
                .await
            {
                files.push(ResourceVersionFile {
                    url: resolved_url,
                    file_name,
                    hash: String::new(),
                    file_size: None,
                    role: "resourcepack".to_string(),
                });
            }
        }

        // Authors sometimes paste the same project page into both slots. If both
        // resolve to one file, keep a single artifact instead of installing twice.
        if files.len() > 1 {
            let first_url = files[0].url.clone();
            if files.iter().all(|file| file.url == first_url) {
                let preferred = files
                    .iter()
                    .find(|file| file.role == preferred_role)
                    .cloned()
                    .or_else(|| files.first().cloned());
                files = preferred.into_iter().collect();
            }
        }

        Self::map_version(project_id, version, preferred_role, files)
    }

    fn artifact_roles_for_versions(versions: &[SmithedPackVersion]) -> Vec<String> {
        let mut roles = Vec::new();
        if versions
            .iter()
            .any(|version| Self::version_has_role(version, "datapack"))
        {
            roles.push("datapack".to_string());
        }
        if versions
            .iter()
            .any(|version| Self::version_has_role(version, "resourcepack"))
        {
            roles.push("resourcepack".to_string());
        }
        roles
    }

    fn map_search_hit(hit: SmithedSearchHit, resource_type: ResourceType) -> Option<ResourceProject> {
        let meta = hit.meta.unwrap_or(SmithedPackMeta {
            doc_id: None,
            raw_id: None,
            stats: None,
            owner: None,
            contributors: None,
        });
        let data = hit.data.unwrap_or_default();
        let display = data.display.unwrap_or_default();
        if display.hidden {
            return None;
        }

        let raw_id = meta
            .raw_id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| hit.id.clone());
        let name = display
            .name
            .or(hit.display_name)
            .unwrap_or_else(|| raw_id.clone());
        let summary = display.description.unwrap_or_default();
        let downloads = meta
            .stats
            .as_ref()
            .and_then(|stats| stats.downloads.as_ref())
            .and_then(|downloads| downloads.total)
            .unwrap_or(0);
        // Typesense hit `id` is the Firebase doc id when `meta.docId` is omitted.
        let gallery_doc_id = meta
            .doc_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(hit.id.as_str());
        let mut gallery =
            Self::gallery_urls(&raw_id, Some(gallery_doc_id), display.gallery.as_ref());
        let featured_gallery = gallery.first().cloned();
        gallery.truncate(1);

        // Prefer Typesense-denormalized owner names from `scope=owner` so browse
        // does not need N× /users/{id} round-trips (those payloads embed pfps).
        let author = hit
            .owner
            .as_ref()
            .and_then(|owner| {
                owner
                    .display_name
                    .as_deref()
                    .or(owner.clean_name.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .or_else(|| meta.owner.clone().filter(|value| !value.is_empty()))
            .unwrap_or_else(|| "Unknown".to_string());

        Some(ResourceProject {
            id: raw_id.clone(),
            source: SourcePlatform::Smithed,
            resource_type,
            name,
            summary,
            description: None,
            icon_url: display.icon,
            author: author.clone(),
            authors: if author == "Unknown" {
                Vec::new()
            } else {
                vec![author]
            },
            download_count: downloads,
            follower_count: 0,
            categories: data.categories.unwrap_or_default(),
            web_url: format!("{}/{}", WEB_BASE, raw_id),
            external_ids: Some(HashMap::from([(
                "smithed_doc_id".to_string(),
                meta.doc_id.unwrap_or(hit.id),
            )])),
            // Search only needs the banner candidate; full gallery loads on get_project.
            gallery,
            featured_gallery,
            published_at: Self::millis_to_rfc3339(meta.stats.as_ref().and_then(|s| s.added)),
            updated_at: Self::millis_to_rfc3339(meta.stats.as_ref().and_then(|s| s.updated)),
        })
    }

    async fn fetch_user_display_name(&self, owner_id: &str) -> String {
        if owner_id.is_empty() {
            return "Unknown".to_string();
        }
        {
            let cache = self.user_names.read().await;
            if let Some(cached) = cache.get(owner_id) {
                return cached.clone();
            }
        }

        let url = format!("{}/users/{}", API_BASE, urlencoding::encode(owner_id));
        let display = match self.client.get(&url).send().await {
            Ok(response) if response.status().is_success() => response
                .json::<SmithedUser>()
                .await
                .ok()
                .and_then(|user| user.display_name.or(user.clean_name))
                .unwrap_or_else(|| owner_id.to_string()),
            _ => owner_id.to_string(),
        };

        let mut cache = self.user_names.write().await;
        cache.insert(owner_id.to_string(), display.clone());
        display
    }

    async fn fetch_pack_data(&self, id: &str) -> Result<(SmithedPackData, SmithedPackMeta)> {
        let pack_url = format!("{}/packs/{}", API_BASE, urlencoding::encode(id));
        let meta_url = format!("{}/packs/{}/meta", API_BASE, urlencoding::encode(id));

        let pack_response = self.client.get(&pack_url).send().await?;
        if !pack_response.status().is_success() {
            let status = pack_response.status();
            let body = pack_response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Smithed API error fetching pack ({}): {}",
                status,
                body
            ));
        }
        let pack: SmithedPackData = pack_response
            .json()
            .await
            .map_err(|e| anyhow!("Smithed pack JSON decode error: {}. ID: {}", e, id))?;

        let meta = match self.client.get(&meta_url).send().await {
            Ok(response) if response.status().is_success() => response
                .json::<SmithedPackMeta>()
                .await
                .unwrap_or(SmithedPackMeta {
                    doc_id: None,
                    raw_id: Some(id.to_string()),
                    stats: None,
                    owner: None,
                    contributors: None,
                }),
            _ => SmithedPackMeta {
                doc_id: None,
                raw_id: Some(id.to_string()),
                stats: None,
                owner: None,
                contributors: None,
            },
        };

        Ok((pack, meta))
    }

    async fn fetch_text(&self, url: &str) -> Result<String> {
        let response = self.client.get(url).send().await?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "Failed to fetch description page ({}): {}",
                response.status(),
                url
            ));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let body = response.text().await?;
        if content_type.contains("text/html")
            || body.trim_start().to_ascii_lowercase().starts_with("<!doctype html")
            || body.trim_start().to_ascii_lowercase().starts_with("<html")
        {
            // Author pages are usually raw markdown/README; avoid dumping raw HTML into the viewer.
            return Err(anyhow!("Description URL returned HTML rather than markdown"));
        }
        Ok(body)
    }

    fn looks_like_url(value: &str) -> bool {
        let lower = value.trim().to_ascii_lowercase();
        lower.starts_with("https://") || lower.starts_with("http://")
    }

    async fn resolve_description(&self, display: &SmithedDisplay) -> Option<String> {
        let summary = display
            .description
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let web_page = display
            .web_page
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        match web_page {
            Some(url) if Self::looks_like_url(url) => match self.fetch_text(url).await {
                Ok(body) => {
                    let body = body.trim();
                    if body.is_empty() {
                        summary.or_else(|| Some(format!("[Read full description]({url})")))
                    } else if summary
                        .as_ref()
                        .is_some_and(|text| body.starts_with(text) || body.contains(text))
                    {
                        Some(body.to_string())
                    } else if let Some(summary) = summary {
                        Some(format!("{summary}\n\n{body}"))
                    } else {
                        Some(body.to_string())
                    }
                }
                Err(err) => {
                    log::debug!(
                        "[Smithed] Could not fetch author description from {}: {}",
                        url,
                        err
                    );
                    match summary {
                        Some(summary) => Some(format!(
                            "{summary}\n\n[Read full description]({url})"
                        )),
                        None => Some(format!("[Read full description]({url})")),
                    }
                }
            },
            Some(inline) => Some(inline.to_string()),
            None => summary,
        }
    }

    async fn map_pack_project(
        &self,
        id: &str,
        pack: SmithedPackData,
        meta: SmithedPackMeta,
        preferred_type: Option<ResourceType>,
    ) -> Result<ResourceProject> {
        let raw_id = meta
            .raw_id
            .clone()
            .or(pack.id.clone())
            .unwrap_or_else(|| id.to_string());
        let resource_type =
            preferred_type.unwrap_or_else(|| Self::infer_resource_type(&pack.versions));

        let owner_id = meta.owner.clone().unwrap_or_default();
        let mut authors = Vec::new();
        let author = if owner_id.is_empty() {
            "Unknown".to_string()
        } else {
            let display = self.fetch_user_display_name(&owner_id).await;
            authors.push(display.clone());
            for contributor in meta.contributors.unwrap_or_default() {
                if contributor != owner_id {
                    authors.push(self.fetch_user_display_name(&contributor).await);
                }
            }
            display
        };

        let downloads = meta
            .stats
            .as_ref()
            .and_then(|stats| stats.downloads.as_ref())
            .and_then(|downloads| downloads.total)
            .unwrap_or(0);

        let summary = pack
            .display
            .description
            .clone()
            .unwrap_or_default();
        let description = self.resolve_description(&pack.display).await;
        let gallery_doc_id = meta
            .doc_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        let gallery =
            Self::gallery_urls(&raw_id, Some(gallery_doc_id), pack.display.gallery.as_ref());
        let icon_url = pack.display.icon.clone();
        let featured_gallery = gallery.first().cloned();

        Ok(ResourceProject {
            id: raw_id.clone(),
            source: SourcePlatform::Smithed,
            resource_type,
            name: pack
                .display
                .name
                .unwrap_or_else(|| raw_id.clone()),
            summary,
            description,
            icon_url,
            author,
            authors,
            download_count: downloads,
            follower_count: 0,
            categories: pack.categories,
            web_url: format!("{}/{}", WEB_BASE, raw_id),
            external_ids: Some({
                let mut ids = HashMap::from([(
                    "smithed_doc_id".to_string(),
                    meta.doc_id.unwrap_or_else(|| id.to_string()),
                )]);
                let roles = Self::artifact_roles_for_versions(&pack.versions);
                if roles.len() > 1 {
                    ids.insert("artifact_roles".to_string(), roles.join(","));
                }
                ids
            }),
            gallery,
            featured_gallery,
            published_at: Self::millis_to_rfc3339(meta.stats.as_ref().and_then(|s| s.added)),
            updated_at: Self::millis_to_rfc3339(meta.stats.as_ref().and_then(|s| s.updated)),
        })
    }
}

#[async_trait]
impl ResourceSource for SmithedSource {
    async fn search(&self, query: SearchQuery) -> Result<SearchResponse> {
        match query.resource_type {
            ResourceType::DataPack => {}
            _ => {
                return Ok(SearchResponse {
                    hits: Vec::new(),
                    total_hits: 0,
                });
            }
        }

        let limit = query.limit.clamp(1, 100);
        // Docs mention `start`, but the live API paginates with 1-indexed `page`.
        let page = (query.offset / limit) + 1;
        let mut url = format!(
            "{}/packs?limit={}&page={}&sort={}&hidden=false",
            API_BASE,
            limit,
            page,
            Self::map_sort(query.sort_by.as_deref())
        );

        if let Some(text) = query.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            url.push_str(&format!("&search={}", urlencoding::encode(text)));
        }
        if let Some(version) = query.game_version.as_deref() {
            url.push_str(&format!("&version={}", urlencoding::encode(version)));
        }
        if let Some(categories) = &query.categories {
            for category in categories {
                url.push_str(&format!("&category={}", urlencoding::encode(category)));
            }
        }

        // Pull display + meta fields needed for ResourceProject mapping.
        // `owner` is Typesense-denormalized (displayName/cleanName/id) — avoids
        // a /users fan-out on browse. Docs only mention data.*/meta.*, but
        // include_fields accepts owner.* as well.
        for scope in [
            "data.display.name",
            "data.display.description",
            "data.display.icon",
            "data.display.hidden",
            "data.display.gallery",
            "data.categories",
            "meta.rawId",
            "meta.docId",
            "meta.stats.downloads",
            "meta.stats.added",
            "meta.stats.updated",
            "owner",
        ] {
            url.push_str(&format!("&scope={}", urlencoding::encode(scope)));
        }

        let count_url = {
            let mut count = format!("{}/packs/count?hidden=false", API_BASE);
            if let Some(text) = query.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                count.push_str(&format!("&search={}", urlencoding::encode(text)));
            }
            if let Some(version) = query.game_version.as_deref() {
                count.push_str(&format!("&version={}", urlencoding::encode(version)));
            }
            if let Some(categories) = &query.categories {
                for category in categories {
                    count.push_str(&format!("&category={}", urlencoding::encode(category)));
                }
            }
            count
        };

        let packs_request = self.client.get(&url);
        let count_request = self.client.get(&count_url);
        let (packs_result, count_result) = tokio::join!(packs_request.send(), count_request.send());

        let response = packs_result?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Smithed API error during search ({}): {}",
                status,
                body
            ));
        }

        let hits_raw: Vec<SmithedSearchHit> = response
            .json()
            .await
            .map_err(|e| anyhow!("Smithed search JSON decode error: {}. URL: {}", e, url))?;

        let total_hits = match count_result {
            Ok(count_response) if count_response.status().is_success() => count_response
                .json::<u64>()
                .await
                .unwrap_or(hits_raw.len() as u64),
            _ => hits_raw.len() as u64,
        };

        let hits = hits_raw
            .into_iter()
            .filter_map(|hit| Self::map_search_hit(hit, query.resource_type))
            .collect();

        Ok(SearchResponse { hits, total_hits })
    }

    async fn get_project(&self, id: &str) -> Result<ResourceProject> {
        let (pack, meta) = self.fetch_pack_data(id).await?;
        self.map_pack_project(id, pack, meta, None).await
    }

    async fn get_projects(&self, ids: &[String]) -> Result<Vec<ResourceProject>> {
        let mut projects = Vec::with_capacity(ids.len());
        for id in ids {
            match self.get_project(id).await {
                Ok(project) => projects.push(project),
                Err(err) => {
                    log::warn!("[Smithed] Failed to fetch project {}: {}", id, err);
                }
            }
        }
        Ok(projects)
    }

    async fn get_versions(
        &self,
        project_id: &str,
        game_version: Option<&str>,
        _loader: Option<&str>,
    ) -> Result<Vec<ResourceVersion>> {
        let (pack, meta) = self.fetch_pack_data(project_id).await?;
        let raw_id = meta
            .raw_id
            .or(pack.id)
            .unwrap_or_else(|| project_id.to_string());
        let preferred = Self::preferred_role_for_query(Self::infer_resource_type(&pack.versions));

        let mut versions = Vec::new();
        for version in &pack.versions {
            if let Some(mapped) = self
                .map_version_resolved(&raw_id, version, preferred)
                .await
            {
                versions.push(mapped);
            }
        }

        if let Some(game_version) = game_version {
            versions.retain(|version| {
                version.game_versions.is_empty()
                    || version
                        .game_versions
                        .iter()
                        .any(|supported| supported == game_version)
            });
        }

        // Newest first (API order is typically oldest-first).
        versions.reverse();
        Ok(versions)
    }

    async fn get_version(&self, project_id: &str, version_id: &str) -> Result<ResourceVersion> {
        let versions = self.get_versions(project_id, None, None).await?;
        versions
            .into_iter()
            .find(|version| version.id == version_id || version.version_number == version_id)
            .ok_or_else(|| {
                anyhow!(
                    "Smithed version {} not found for pack {}",
                    version_id,
                    project_id
                )
            })
    }

    async fn get_version_details(
        &self,
        project_id: &str,
        version_id: &str,
    ) -> Result<ResourceVersionDetails> {
        let version = self.get_version(project_id, version_id).await?;
        Ok(ResourceVersionDetails {
            version,
            changelog: None,
            changelog_format: ResourceChangelogFormat::Markdown,
            changelog_status: ResourceChangelogStatus::Unavailable,
        })
    }

    async fn get_by_hash(&self, _hash: &str) -> Result<(ResourceProject, ResourceVersion)> {
        Err(anyhow!("Smithed does not support hash lookup"))
    }

    async fn get_by_hashes(
        &self,
        _hashes: &[String],
    ) -> Result<HashMap<String, (ResourceProject, ResourceVersion)>> {
        Ok(HashMap::new())
    }

    async fn get_categories(&self) -> Result<Vec<ResourceCategory>> {
        Ok(PACK_CATEGORIES
            .iter()
            .enumerate()
            .map(|(index, name)| ResourceCategory {
                id: name.to_string(),
                name: name.to_string(),
                icon_url: None,
                project_type: None,
                parent_id: None,
                display_index: Some(index as i32),
            })
            .collect())
    }

    fn platform(&self) -> SourcePlatform {
        SourcePlatform::Smithed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_version_both() -> SmithedPackVersion {
        SmithedPackVersion {
            name: "0.0.5".to_string(),
            supports: vec!["1.19".to_string()],
            downloads: SmithedDownloads {
                datapack: Some(
                    "https://github.com/example/pack/releases/download/0.0.5/pack-dp.zip"
                        .to_string(),
                ),
                resourcepack: Some(
                    "https://github.com/example/pack/releases/download/0.0.5/pack-rp.zip"
                        .to_string(),
                ),
            },
            dependencies: vec![SmithedPackReference {
                id: "lib".to_string(),
                version: Some("1.0.0".to_string()),
            }],
            breaking: false,
        }
    }

    #[test]
    fn map_version_keeps_both_artifacts_and_prefers_requested_role() {
        let version = sample_version_both();
        let files = vec![
            ResourceVersionFile {
                url: version.downloads.datapack.clone().unwrap(),
                file_name: "pack-dp.zip".to_string(),
                hash: String::new(),
                file_size: None,
                role: "datapack".to_string(),
            },
            ResourceVersionFile {
                url: version.downloads.resourcepack.clone().unwrap(),
                file_name: "pack-rp.zip".to_string(),
                hash: String::new(),
                file_size: None,
                role: "resourcepack".to_string(),
            },
        ];
        let mapped = SmithedSource::map_version("coc", &version, "resourcepack", files).unwrap();

        assert_eq!(mapped.id, "0.0.5");
        assert_eq!(mapped.files.len(), 2);
        assert!(mapped.file_for_role("datapack").is_some());
        assert!(mapped.file_for_role("resourcepack").is_some());
        assert!(mapped.download_url.ends_with("pack-rp.zip"));
        assert_eq!(mapped.file_name, "pack-rp.zip");
        assert_eq!(mapped.dependencies.len(), 1);
        assert_eq!(mapped.dependencies[0].project_id, "lib");
    }

    #[test]
    fn map_version_falls_back_when_preferred_role_missing() {
        let version = SmithedPackVersion {
            name: "1.0.0".to_string(),
            supports: vec!["1.20".to_string()],
            downloads: SmithedDownloads {
                datapack: None,
                resourcepack: Some("https://example.invalid/rp.zip".to_string()),
            },
            dependencies: vec![],
            breaking: true,
        };

        let files = vec![ResourceVersionFile {
            url: "https://example.invalid/rp.zip".to_string(),
            file_name: "rp.zip".to_string(),
            hash: String::new(),
            file_size: None,
            role: "resourcepack".to_string(),
        }];
        let mapped = SmithedSource::map_version("shaders", &version, "datapack", files).unwrap();
        assert!(mapped.download_url.ends_with("rp.zip"));
        assert_eq!(mapped.release_type, ReleaseType::Beta);
        assert_eq!(mapped.files.len(), 1);
        assert_eq!(mapped.files[0].role, "resourcepack");
    }

    #[test]
    fn map_version_skips_empty_download_strings() {
        let version = SmithedPackVersion {
            name: "1.0.0".to_string(),
            supports: vec![],
            downloads: SmithedDownloads {
                datapack: Some("".to_string()),
                resourcepack: Some("   ".to_string()),
            },
            dependencies: vec![],
            breaking: false,
        };
        assert!(SmithedSource::map_version("x", &version, "datapack", Vec::new()).is_none());
    }

    #[test]
    fn modrinth_project_page_urls_extract_slug() {
        assert_eq!(
            SmithedSource::modrinth_slug_from_url(
                "https://modrinth.com/datapack/ancient-artifacts-2/versions"
            )
            .as_deref(),
            Some("ancient-artifacts-2")
        );
        assert!(!SmithedSource::looks_like_direct_file_url(
            "https://modrinth.com/datapack/ancient-artifacts-2/versions"
        ));
        assert!(SmithedSource::looks_like_direct_file_url(
            "https://cdn.modrinth.com/data/RO3LwIqV/versions/x/file.zip"
        ));
    }

    #[test]
    fn map_search_hit_prefers_raw_id() {
        let hit = SmithedSearchHit {
            id: "doc123".to_string(),
            display_name: Some("Call of Chaos".to_string()),
            data: Some(SmithedSearchData {
                display: Some(SmithedDisplay {
                    name: Some("Call of Chaos".to_string()),
                    description: Some("desc".to_string()),
                    icon: Some("https://example.invalid/icon.png".to_string()),
                    hidden: false,
                    web_page: None,
                    gallery: None,
                }),
                categories: Some(vec!["Magic".to_string()]),
            }),
            meta: Some(SmithedPackMeta {
                doc_id: Some("doc123".to_string()),
                raw_id: Some("coc".to_string()),
                stats: Some(SmithedStats {
                    updated: Some(1_726_248_136_000),
                    added: Some(1_659_814_345_029),
                    downloads: Some(SmithedDownloadStats {
                        total: Some(429),
                        today: Some(0),
                        past_week: Some(2),
                        past_month: Some(1),
                    }),
                }),
                owner: Some("uid-should-not-win".to_string()),
                contributors: None,
            }),
            owner: Some(SmithedSearchOwner {
                display_name: Some("TheNuclearNexus".to_string()),
                clean_name: Some("thenuclearnexus".to_string()),
                id: Some("uid-should-not-win".to_string()),
            }),
        };

        let project = SmithedSource::map_search_hit(hit, ResourceType::DataPack).unwrap();
        assert_eq!(project.id, "coc");
        assert_eq!(project.download_count, 429);
        assert_eq!(project.web_url, "https://smithed.dev/packs/coc");
        assert_eq!(project.author, "TheNuclearNexus");
        assert_eq!(project.authors, vec!["TheNuclearNexus".to_string()]);
        assert_eq!(project.featured_gallery, None);
        assert!(project.gallery.is_empty());
        assert_eq!(
            project
                .external_ids
                .as_ref()
                .and_then(|ids| ids.get("smithed_doc_id"))
                .map(String::as_str),
            Some("doc123")
        );
    }

    #[test]
    fn map_search_hit_falls_back_to_meta_owner_uid() {
        let hit = SmithedSearchHit {
            id: "doc123".to_string(),
            display_name: Some("Call of Chaos".to_string()),
            data: Some(SmithedSearchData {
                display: Some(SmithedDisplay {
                    name: Some("Call of Chaos".to_string()),
                    description: None,
                    icon: None,
                    hidden: false,
                    web_page: None,
                    gallery: None,
                }),
                categories: None,
            }),
            meta: Some(SmithedPackMeta {
                doc_id: None,
                raw_id: Some("coc".to_string()),
                stats: None,
                owner: Some("firebase-uid".to_string()),
                contributors: None,
            }),
            owner: None,
        };

        let project = SmithedSource::map_search_hit(hit, ResourceType::DataPack).unwrap();
        assert_eq!(project.author, "firebase-uid");
    }

    #[test]
    fn map_search_hit_keeps_banner_gallery_candidate() {
        let hit = SmithedSearchHit {
            id: "doc123".to_string(),
            display_name: Some("Myriad".to_string()),
            data: Some(SmithedSearchData {
                display: Some(SmithedDisplay {
                    name: Some("Myriad".to_string()),
                    description: Some("desc".to_string()),
                    icon: None,
                    hidden: false,
                    web_page: None,
                    gallery: Some(SmithedGallery::Items(vec![
                        SmithedGalleryItem {
                            item_type: Some("file".to_string()),
                            content: None,
                            uid: Some("abc".to_string()),
                        },
                        SmithedGalleryItem {
                            item_type: Some("file".to_string()),
                            content: None,
                            uid: Some("def".to_string()),
                        },
                    ])),
                }),
                categories: None,
            }),
            meta: Some(SmithedPackMeta {
                doc_id: Some("doc123".to_string()),
                raw_id: Some("myriad".to_string()),
                stats: None,
                owner: Some("owner".to_string()),
                contributors: None,
            }),
            owner: None,
        };

        let project = SmithedSource::map_search_hit(hit, ResourceType::DataPack).unwrap();
        let expected = "https://firebasestorage.googleapis.com/v0/b/mc-smithed.appspot.com/o/gallery_images%2Fdoc123-abc.webp?alt=media";
        assert_eq!(project.featured_gallery.as_deref(), Some(expected));
        assert_eq!(project.gallery, vec![expected.to_string()]);
    }

    #[test]
    fn gallery_items_resolve_file_cdn_and_bucket_api_urls() {
        let gallery = SmithedGallery::Items(vec![
            SmithedGalleryItem {
                item_type: Some("file".to_string()),
                content: None,
                uid: Some("abc123".to_string()),
            },
            SmithedGalleryItem {
                item_type: Some("bucket".to_string()),
                content: None,
                uid: Some("bucket-uid".to_string()),
            },
            SmithedGalleryItem {
                item_type: Some("bucket".to_string()),
                content: Some("https://example.invalid/custom.png".to_string()),
                uid: Some("ignored-when-content-present".to_string()),
            },
        ]);

        let urls = SmithedSource::gallery_urls("myriad", Some("doc123"), Some(&gallery));
        assert_eq!(
            urls,
            vec![
                "https://firebasestorage.googleapis.com/v0/b/mc-smithed.appspot.com/o/gallery_images%2Fdoc123-abc123.webp?alt=media".to_string(),
                "https://api.smithed.dev/v2/packs/myriad/gallery/1".to_string(),
                "https://example.invalid/custom.png".to_string(),
            ]
        );
    }

    #[test]
    fn looks_like_url_detects_http_endpoints() {
        assert!(SmithedSource::looks_like_url(
            "https://raw.githubusercontent.com/example/README.md"
        ));
        assert!(!SmithedSource::looks_like_url("Just some markdown text"));
    }

    #[test]
    fn sort_mapping_accepts_vesta_aliases() {
        assert_eq!(SmithedSource::map_sort(Some("relevance")), "trending");
        assert_eq!(SmithedSource::map_sort(Some("featured")), "trending");
        assert_eq!(SmithedSource::map_sort(Some("totalDownloads")), "downloads");
        assert_eq!(SmithedSource::map_sort(Some("name")), "alphabetically");
        assert_eq!(SmithedSource::map_sort(Some("updated")), "newest");
    }

    #[tokio::test]
    async fn categories_are_static_pack_categories() {
        let source = SmithedSource::new();
        let categories = source.get_categories().await.unwrap();
        assert!(categories.iter().any(|c| c.id == "Library"));
        assert!(categories.iter().any(|c| c.id == "No Resource Pack"));
    }

    #[tokio::test]
    async fn unsupported_resource_types_return_empty_search() {
        let source = SmithedSource::new();
        for resource_type in [
            ResourceType::Mod,
            ResourceType::ResourcePack,
            ResourceType::Shader,
            ResourceType::Modpack,
            ResourceType::World,
        ] {
            let response = source
                .search(SearchQuery {
                    text: Some("sodium".to_string()),
                    resource_type,
                    limit: 10,
                    ..Default::default()
                })
                .await
                .unwrap();
            assert!(response.hits.is_empty());
            assert_eq!(response.total_hits, 0);
        }
    }

    #[tokio::test]
    #[ignore = "live Smithed API test; run explicitly when checking provider integration"]
    async fn live_smithed_search_and_versions() {
        let source = SmithedSource::new();
        let response = source
            .search(SearchQuery {
                text: Some("chaos".to_string()),
                resource_type: ResourceType::DataPack,
                limit: 5,
                ..Default::default()
            })
            .await
            .expect("search");
        assert!(!response.hits.is_empty());

        let pack_id = response
            .hits
            .iter()
            .find(|hit| hit.id == "coc")
            .map(|hit| hit.id.clone())
            .unwrap_or_else(|| response.hits[0].id.clone());

        let project = source.get_project(&pack_id).await.expect("project");
        assert_eq!(project.source, SourcePlatform::Smithed);
        assert!(!project.name.is_empty());

        let versions = source
            .get_versions(&pack_id, None, None)
            .await
            .expect("versions");
        assert!(!versions.is_empty());
        let latest = &versions[0];
        assert!(
            !latest.download_url.is_empty(),
            "expected download url on latest version"
        );
        assert!(
            latest.files.len() >= 1,
            "expected at least one version file"
        );
    }
}
