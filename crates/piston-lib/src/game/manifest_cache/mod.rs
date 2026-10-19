use anyhow::Result;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::game::metadata::types::{
    manifest_cache_key, modrinth_manifest_url, GameVersionMetadata, LatestVersions,
    LoaderVersionInfo, ModloaderType, ModrinthManifest, MojangVersionManifest, PistonMetadata,
};
use serde::{Deserialize, Serialize};

/// A single cached manifest entry on disk
#[derive(Debug, Serialize, Deserialize)]
pub struct CachedManifest {
    /// ETag from the server (for conditional requests)
    pub etag: Option<String>,
    /// Last-Modified header from the server
    pub last_modified: Option<String>,
    /// When this was fetched
    pub fetched_at: DateTime<Utc>,
    /// The raw manifest data
    pub data: serde_json::Value,
}

/// Cached Java runtime info — persists between sessions for offline use.
#[derive(Debug, Default, Serialize, Deserialize)]
struct JavaInfoCache {
    required_java_major_versions: Vec<u32>,
    #[serde(default)]
    java_major_version_by_game_version: HashMap<String, u32>,
}

/// In-memory state for a cached manifest
struct MemEntry {
    data: Arc<serde_json::Value>,
    _etag: Option<String>,
    _last_modified: Option<String>,
    fetched_at: Instant,
}

/// The loader slugs we cache
pub const MANIFEST_SLUGS: &[&str] = &["minecraft", "fabric", "quilt", "forge", "neo"];

/// A cache for individual loader/Minecraft version manifests.
///
/// Each manifest is cached separately on disk at `MANIFESTS_DIR/{cache_key}.json`.
/// In-memory entries are kept for fast access. Background ETag revalidation
/// keeps things fresh without re-downloading unchanged manifests.
pub struct ManifestCache {
    entries: RwLock<HashMap<String, MemEntry>>,
    cache_dir: PathBuf,
    client: reqwest::Client,
    offline: bool,
}

impl ManifestCache {
    /// Create a new ManifestCache. Does not load anything — call `warm_up` or `get_or_fetch`.
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            cache_dir,
            client: crate::client::shared_client().clone(),
            offline: false,
        }
    }

    /// Create a ManifestCache that only reads from disk — no network requests.
    /// Used by load_cached_metadata_if_present for offline warmup.
    pub fn new_offline(cache_dir: PathBuf) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            cache_dir,
            client: crate::client::shared_client().clone(),
            offline: true,
        }
    }

    fn java_info_path(&self) -> PathBuf {
        self.cache_dir.join("java_info.json")
    }

    async fn read_java_info_cache(&self) -> Result<JavaInfoCache> {
        let content = tokio::fs::read_to_string(self.java_info_path()).await?;
        Ok(serde_json::from_str(&content)?)
    }

    async fn write_java_info_cache(&self, cache: &JavaInfoCache) -> Result<()> {
        tokio::fs::create_dir_all(&self.cache_dir).await?;
        let json = serde_json::to_string(cache)?;
        tokio::fs::write(self.java_info_path(), json).await?;
        Ok(())
    }

    /// Resolve and persist the Java major required by a Minecraft version.
    /// Uses the on-disk Java info cache first, then fetches the version detail
    /// JSON when online.
    pub async fn resolve_java_major_for_version(&self, version_id: &str) -> Result<u32> {
        let mut cache = self.read_java_info_cache().await.unwrap_or_default();

        if let Some(major) = cache.java_major_version_by_game_version.get(version_id) {
            return Ok(crate::game::java_policy::preferred_java_major(*major));
        }

        if self.offline {
            anyhow::bail!(
                "Java requirement for Minecraft version '{}' is not cached",
                version_id
            );
        }

        let requirement =
            crate::game::java_policy::fetch_java_requirement_for_version(version_id, &self.client)
                .await?;
        let major = requirement.major_version;

        cache
            .java_major_version_by_game_version
            .insert(version_id.to_string(), major);
        if !cache.required_java_major_versions.contains(&major) {
            cache.required_java_major_versions.push(major);
            cache
                .required_java_major_versions
                .sort_unstable_by(|a, b| b.cmp(a));
            cache.required_java_major_versions.dedup();
        }
        self.write_java_info_cache(&cache).await?;

        Ok(major)
    }

    /// Persist a Java requirement from an already-fetched version detail JSON.
    /// This avoids a second network request during installs, where the version
    /// detail is already loaded for client/assets/libraries.
    pub async fn cache_java_requirement_from_version_detail(
        &self,
        version_id: &str,
        detail: serde_json::Value,
    ) -> Result<u32> {
        let requirement = crate::game::java_policy::java_requirement_from_version_detail_value(
            version_id, detail,
        )?;
        let major = requirement.major_version;
        let mut cache = self.read_java_info_cache().await.unwrap_or_default();

        cache
            .java_major_version_by_game_version
            .insert(version_id.to_string(), major);
        if !cache.required_java_major_versions.contains(&major) {
            cache.required_java_major_versions.push(major);
            cache
                .required_java_major_versions
                .sort_unstable_by(|a, b| b.cmp(a));
            cache.required_java_major_versions.dedup();
        }

        self.write_java_info_cache(&cache).await?;
        Ok(major)
    }

    /// Get a manifest by slug, fetching if not cached or stale.
    /// On cache hit + fresh, returns immediately from memory.
    /// On cache miss, fetches, saves to disk, stores in memory.
    /// On stale, does an ETag revalidation (304 = fast refresh).
    pub async fn get_or_fetch(&self, slug: &str) -> Result<Arc<serde_json::Value>> {
        // Offline mode: read from disk only, fail if not cached
        if self.offline {
            let disk_path = self
                .cache_dir
                .join(format!("{}.json", manifest_cache_key(slug)));
            let content = tokio::fs::read_to_string(&disk_path)
                .await
                .map_err(|e| anyhow::anyhow!("Manifest '{}' not cached on disk: {}", slug, e))?;
            let cached: CachedManifest = serde_json::from_str(&content)?;
            return Ok(Arc::new(cached.data));
        }

        // Check in-memory
        {
            let entries = self.entries.read().await;
            if let Some(entry) = entries.get(slug) {
                // Fresh enough? (5 min since last check)
                if entry.fetched_at.elapsed().as_secs() < 300 {
                    return Ok(Arc::clone(&entry.data));
                }
            }
        }

        // Try disk cache
        let disk_path = self
            .cache_dir
            .join(format!("{}.json", manifest_cache_key(slug)));
        let from_disk = if disk_path.exists() {
            match tokio::fs::read_to_string(&disk_path).await {
                Ok(content) => {
                    match serde_json::from_str::<CachedManifest>(&content) {
                        Ok(cached) => {
                            // Try ETag revalidation
                            if let Some(etag) = &cached.etag {
                                match self
                                    .try_revalidate(slug, etag, cached.last_modified.as_deref())
                                    .await
                                {
                                    Ok(Some((fresh_data, new_etag, new_lm))) => {
                                        // 200 — data changed, use fresh headers + body
                                        let data = Arc::new(fresh_data);
                                        let etag = new_etag.or_else(|| cached.etag.clone());
                                        let lm = new_lm.or_else(|| cached.last_modified.clone());
                                        self.store_in_memory(
                                            slug,
                                            Arc::clone(&data),
                                            etag.clone(),
                                            lm.clone(),
                                        )
                                        .await;
                                        // Also persist to disk with new headers
                                        let disk_cached = CachedManifest {
                                            etag,
                                            last_modified: lm,
                                            fetched_at: Utc::now(),
                                            data: (*data).clone(),
                                        };
                                        if let Ok(json) = serde_json::to_string(&disk_cached) {
                                            let _ = tokio::fs::write(&disk_path, json).await;
                                        }
                                        return Ok(data);
                                    }
                                    Ok(None) => {
                                        // 304 — not modified, use cached
                                        let data = Arc::new(cached.data);
                                        self.store_in_memory(
                                            slug,
                                            Arc::clone(&data),
                                            cached.etag,
                                            cached.last_modified,
                                        )
                                        .await;
                                        return Ok(data);
                                    }
                                    Err(_) => {
                                        // Revalidation failed, fall through to fresh fetch
                                        Some(cached)
                                    }
                                }
                            } else {
                                Some(cached)
                            }
                        }
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };

        // Fetch fresh
        match self.fetch_and_cache(slug, &disk_path).await {
            Ok(data) => Ok(data),
            Err(error) => {
                if let Some(cached) = from_disk {
                    log::warn!(
                        "Failed to refresh {slug} manifest; using cached metadata: {error:#}"
                    );
                    let data = Arc::new(cached.data);
                    self.store_in_memory(
                        slug,
                        Arc::clone(&data),
                        cached.etag,
                        cached.last_modified,
                    )
                    .await;
                    Ok(data)
                } else {
                    Err(error)
                }
            }
        }
    }

    /// Lightweight ETag revalidation — sends `If-None-Match`.
    /// Returns `Ok(Some((data, new_etag, new_last_modified)))` if data changed (200),
    /// `Ok(None)` if 304 Not Modified.
    async fn try_revalidate(
        &self,
        slug: &str,
        etag: &str,
        _last_modified: Option<&str>,
    ) -> Result<Option<(serde_json::Value, Option<String>, Option<String>)>> {
        let url = manifest_url(slug);
        // Use a single GET with If-None-Match: 304 = not modified, 200 = body + new headers
        let resp = self
            .client
            .get(&url)
            .header("If-None-Match", etag)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(None);
        }
        let resp = resp.error_for_status()?;
        // Capture new headers from the 200 response
        let new_etag = resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let new_last_modified = resp
            .headers()
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let body = resp.bytes().await?;
        let data: serde_json::Value = serde_json::from_slice(&body)?;
        Ok(Some((data, new_etag, new_last_modified)))
    }

    /// Fetch a manifest fresh from the API and cache it.
    async fn fetch_and_cache(
        &self,
        slug: &str,
        disk_path: &Path,
    ) -> Result<Arc<serde_json::Value>> {
        let url = manifest_url(slug);
        let resp = self.client.get(&url).send().await?.error_for_status()?;
        let etag = resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let last_modified = resp
            .headers()
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let body = resp.bytes().await?;
        let data: serde_json::Value = serde_json::from_slice(&body)?;
        let data_arc = Arc::new(data);

        // Save to disk
        let cached = CachedManifest {
            etag: etag.clone(),
            last_modified: last_modified.clone(),
            fetched_at: Utc::now(),
            data: (*data_arc).clone(),
        };
        if let Some(parent) = disk_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_string(&cached)?;
        tokio::fs::write(disk_path, json).await?;

        // Store in memory
        self.store_in_memory(
            slug,
            Arc::clone(&data_arc),
            etag.clone(),
            last_modified.clone(),
        )
        .await;

        Ok(data_arc)
    }

    async fn store_in_memory(
        &self,
        slug: &str,
        data: Arc<serde_json::Value>,
        etag: Option<String>,
        last_modified: Option<String>,
    ) {
        let mut entries = self.entries.write().await;
        entries.insert(
            slug.to_string(),
            MemEntry {
                data,
                _etag: etag,
                _last_modified: last_modified,
                fetched_at: Instant::now(),
            },
        );
    }

    /// Pre-warm the cache on boot — does a lightweight ETag check for all manifests.
    pub async fn warm_up(&self) {
        log::info!("Warming manifest cache...");
        for slug in MANIFEST_SLUGS {
            if let Err(e) = self.get_or_fetch(slug).await {
                log::warn!("Failed to warm cache for {slug}: {e}");
            }
        }
        log::info!("Manifest cache warmed.");
    }

    /// Build the combined PistonMetadata response from individual cached manifests.
    /// This is what the frontend expects.
    pub async fn build_piston_metadata(&self) -> Result<PistonMetadata> {
        let mc_data = self.get_or_fetch("minecraft").await?;
        let mc_manifest: MojangVersionManifest = serde_json::from_value((*mc_data).clone())?;

        let mut manifests = Vec::new();
        for (loader, slug) in [
            (ModloaderType::Fabric, "fabric"),
            (ModloaderType::Quilt, "quilt"),
            (ModloaderType::Forge, "forge"),
            (ModloaderType::NeoForge, "neo"),
        ] {
            let parsed = match self.get_or_fetch(slug).await {
                Ok(data) => serde_json::from_value::<ModrinthManifest>((*data).clone())
                    .map_err(anyhow::Error::from),
                Err(error) => Err(error),
            };
            match parsed {
                Ok(manifest) => manifests.push((loader, manifest)),
                Err(error) => log::warn!("Failed to load {slug} metadata: {error:#}"),
            }
        }
        // Index once, borrowing each group's loader list instead of cloning it per game.
        let mut loader_infos = Vec::new();
        for (loader, manifest) in &manifests {
            match manifest.loaders_by_game() {
                Ok(index) => loader_infos.push((*loader, index)),
                Err(error) => log::warn!("Invalid {loader} metadata: {error:#}"),
            }
        }

        let mut game_versions = Vec::new();
        for mv in &mc_manifest.versions {
            let mut loaders = HashMap::new();

            for (loader_type, index) in &loader_infos {
                if let Some(versions) = index.get(mv.id.as_str()).filter(|v| !v.is_empty()) {
                    loaders.insert(
                        *loader_type,
                        versions
                            .iter()
                            .map(|loader| LoaderVersionInfo {
                                version: loader.id.clone(),
                                stable: loader.stable,
                                url: Some(loader.url.clone()),
                                sha1: None,
                                metadata: None,
                            })
                            .collect(),
                    );
                }
            }

            game_versions.push(GameVersionMetadata {
                id: mv.id.clone(),
                version_type: mv.version_type.clone(),
                release_time: mv
                    .release_time
                    .parse::<DateTime<Utc>>()
                    .unwrap_or_else(|_| Utc::now()),
                stable: mv.version_type == "release",
                loaders,
            });
        }

        // Sort: latest first
        game_versions.sort_by_key(|b| std::cmp::Reverse(b.release_time));

        // Java data: from cache when offline, from network otherwise.
        let (required_java_major_versions, java_major_version_by_game_version) = if self.offline {
            let path = self.java_info_path();
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| anyhow::anyhow!("Java info cache not available: {e}"))?;
            let cache: JavaInfoCache = serde_json::from_str(&content)?;
            (
                cache.required_java_major_versions,
                cache.java_major_version_by_game_version,
            )
        } else {
            let cached_java_info = self.read_java_info_cache().await.ok();
            let required = match crate::game::java_policy::fetch_available_runtimes(&self.client)
                .await
            {
                Ok(required) => required,
                Err(e) => {
                    if let Some(cached) = cached_java_info
                        .as_ref()
                        .filter(|c| !c.required_java_major_versions.is_empty())
                    {
                        log::warn!(
                                "Failed to fetch Java runtimes: {e}. Using cached Java runtime majors {:?}",
                                cached.required_java_major_versions
                            );
                        cached.required_java_major_versions.clone()
                    } else {
                        return Err(anyhow::anyhow!(
                                "Failed to fetch Java runtimes and no cached Java runtime info is available: {e}"
                            ));
                    }
                }
            };

            let mut java_versions = cached_java_info
                .map(|cache| cache.java_major_version_by_game_version)
                .unwrap_or_default();
            for v in [&mc_manifest.latest.release, &mc_manifest.latest.snapshot] {
                if let Ok(major) =
                    crate::game::java_policy::fetch_java_major_for_version(v, &self.client).await
                {
                    java_versions.insert(v.clone(), major);
                }
            }

            // Persist to disk for offline use
            let cache = JavaInfoCache {
                required_java_major_versions: required.clone(),
                java_major_version_by_game_version: java_versions.clone(),
            };
            if let Err(e) = self.write_java_info_cache(&cache).await {
                log::warn!("Failed to persist Java info cache: {e}");
            }

            (required, java_versions)
        };

        Ok(PistonMetadata {
            last_updated: Utc::now(),
            game_versions,
            latest: LatestVersions {
                release: mc_manifest.latest.release.clone(),
                snapshot: mc_manifest.latest.snapshot.clone(),
            },
            required_java_major_versions,
            java_major_version_by_game_version,
        })
    }
}

fn manifest_url(slug: &str) -> String {
    if slug == "minecraft" {
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json".to_string()
    } else {
        modrinth_manifest_url(slug)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn resolves_cached_java_major_without_network() {
        let tmp = tempdir().unwrap();
        let cache_dir = tmp.path().join("manifests");
        tokio::fs::create_dir_all(&cache_dir).await.unwrap();
        tokio::fs::write(
            cache_dir.join("java_info.json"),
            serde_json::json!({
                "required_java_major_versions": [21, 17, 8],
                "java_major_version_by_game_version": {
                    "1.21.1": 21
                }
            })
            .to_string(),
        )
        .await
        .unwrap();

        let cache = ManifestCache::new_offline(cache_dir);
        assert_eq!(
            cache
                .resolve_java_major_for_version("1.21.1")
                .await
                .unwrap(),
            21
        );
    }

    #[tokio::test]
    async fn missing_offline_java_major_errors() {
        let tmp = tempdir().unwrap();
        let cache_dir = tmp.path().join("manifests");
        tokio::fs::create_dir_all(&cache_dir).await.unwrap();
        tokio::fs::write(
            cache_dir.join("java_info.json"),
            serde_json::json!({
                "required_java_major_versions": [21, 17, 8],
                "java_major_version_by_game_version": {}
            })
            .to_string(),
        )
        .await
        .unwrap();

        let cache = ManifestCache::new_offline(cache_dir);
        let err = cache
            .resolve_java_major_for_version("1.21.1")
            .await
            .expect_err("offline cache miss should not fetch");
        assert!(err.to_string().contains("is not cached"));
    }

    #[tokio::test]
    async fn caches_java_requirement_from_existing_detail_json() {
        let tmp = tempdir().unwrap();
        let cache_dir = tmp.path().join("manifests");
        let cache = ManifestCache::new(cache_dir.clone());

        let major = cache
            .cache_java_requirement_from_version_detail(
                "1.21.1",
                serde_json::json!({
                    "id": "1.21.1",
                    "type": "release",
                    "releaseTime": "2024-08-08T12:24:45+00:00",
                    "javaVersion": {
                        "component": "java-runtime-delta",
                        "majorVersion": 21
                    }
                }),
            )
            .await
            .unwrap();
        assert_eq!(major, 21);

        let offline = ManifestCache::new_offline(cache_dir);
        assert_eq!(
            offline
                .resolve_java_major_for_version("1.21.1")
                .await
                .unwrap(),
            21
        );
    }
}
