use anyhow::Result;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::game::metadata::types::{
    GameVersionMetadata, LatestVersions, LoaderVersionInfo, ModloaderType, MojangVersionManifest,
    PistonMetadata,
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
/// Each manifest is cached separately on disk at `MANIFESTS_DIR/{slug}.json`.
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
            client: reqwest::Client::builder()
                .user_agent("VestaLauncher/1.0")
                .build()
                .expect("Failed to build HTTP client"),
            offline: false,
        }
    }

    /// Create a ManifestCache that only reads from disk — no network requests.
    /// Used by load_cached_metadata_if_present for offline warmup.
    pub fn new_offline(cache_dir: PathBuf) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            cache_dir,
            client: reqwest::Client::builder()
                .user_agent("VestaLauncher/1.0")
                .build()
                .expect("Failed to build HTTP client"),
            offline: true,
        }
    }

    /// Get a manifest by slug, fetching if not cached or stale.
    /// On cache hit + fresh, returns immediately from memory.
    /// On cache miss, fetches, saves to disk, stores in memory.
    /// On stale, does an ETag revalidation (304 = fast refresh).
    pub async fn get_or_fetch(&self, slug: &str) -> Result<Arc<serde_json::Value>> {
        // Offline mode: read from disk only, fail if not cached
        if self.offline {
            let disk_path = self.cache_dir.join(format!("{slug}.json"));
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
        let disk_path = self.cache_dir.join(format!("{slug}.json"));
        let _from_disk = if disk_path.exists() {
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
                                            etag: etag,
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
        self.fetch_and_cache(slug, &disk_path).await
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
        let resp = self.client.get(&url).send().await?;
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

        let fabric = self.get_or_fetch("fabric").await.ok();
        let quilt = self.get_or_fetch("quilt").await.ok();
        let forge = self.get_or_fetch("forge").await.ok();
        let neo = self.get_or_fetch("neo").await.ok();

        // Pre-parse each loader manifest ONCE — avoids re-parsing for every version.
        struct LoaderInfo {
            /// Map of version_id → loader versions (Forge/NeoForge style)
            per_version: HashMap<String, Vec<LoaderVersionInfo>>,
            /// Set of version IDs that this loader supports (Fabric/Quilt style)
            supported_versions: std::collections::HashSet<String>,
            /// Dummy entry loaders (Fabric/Quilt style)
            dummy_loaders: Vec<LoaderVersionInfo>,
        }

        fn parse_loader(manifest: &Option<Arc<serde_json::Value>>) -> Option<LoaderInfo> {
            let parsed: crate::game::metadata::types::ModrinthManifest =
                match serde_json::from_value((**manifest.as_ref()?).clone()) {
                    Ok(m) => m,
                    Err(_) => return None,
                };

            let mut per_version = HashMap::new();
            let mut supported_versions = std::collections::HashSet::new();
            let mut dummy_loaders = Vec::new();

            for gv in &parsed.game_versions {
                if crate::game::metadata::types::is_dummy_game_version(&gv.id) {
                    // Fabric/Quilt: dummy entry holds all loader versions
                    dummy_loaders = gv
                        .loaders
                        .iter()
                        .map(|lv| LoaderVersionInfo {
                            version: lv.id.clone(),
                            stable: lv.stable,
                            url: Some(lv.url.clone()),
                            sha1: None,
                            metadata: None,
                        })
                        .collect();
                } else if !gv.loaders.is_empty() {
                    // Forge/NeoForge: each version has its own non‑empty loader list
                    per_version.insert(
                        gv.id.clone(),
                        gv.loaders
                            .iter()
                            .map(|lv| LoaderVersionInfo {
                                version: lv.id.clone(),
                                stable: lv.stable,
                                url: Some(lv.url.clone()),
                                sha1: None,
                                metadata: None,
                            })
                            .collect(),
                    );
                } else {
                    // Fabric/Quilt: named entry with empty loaders — marks support
                    supported_versions.insert(gv.id.clone());
                }
            }

            Some(LoaderInfo {
                per_version,
                supported_versions,
                dummy_loaders,
            })
        }

        let loader_infos = [
            (ModloaderType::Fabric, parse_loader(&fabric)),
            (ModloaderType::Quilt, parse_loader(&quilt)),
            (ModloaderType::Forge, parse_loader(&forge)),
            (ModloaderType::NeoForge, parse_loader(&neo)),
        ];

        let mut game_versions = Vec::new();
        for mv in &mc_manifest.versions {
            let mut loaders = HashMap::new();

            for (loader_type, info) in &loader_infos {
                let Some(info) = info else {
                    continue;
                };
                if let Some(versions) = info.per_version.get(&mv.id) {
                    loaders.insert(*loader_type, versions.clone());
                } else if info.supported_versions.contains(&mv.id) {
                    loaders.insert(*loader_type, info.dummy_loaders.clone());
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
        game_versions.sort_by(|a, b| b.release_time.cmp(&a.release_time));

        // Fetch available Java runtimes from Mojang's runtime manifest (1 HTTP request).
        // This replaces the old hardcoded [8, 17, 21] with real data.
        let required_java_major_versions =
            crate::game::java_policy::fetch_available_runtimes(&self.client)
                .await
                .unwrap_or_else(|e| {
                    log::warn!("Failed to fetch Java runtimes: {e}. Falling back to [21, 17, 8]");
                    vec![21u32, 17, 8]
                });

        // Fetch Java version for latest release + snapshot so onboarding works.
        // Other versions resolve lazily when the user tries to install them.
        let mut java_versions = HashMap::new();
        for v in [&mc_manifest.latest.release, &mc_manifest.latest.snapshot] {
            if let Ok(major) =
                crate::game::java_policy::fetch_java_major_for_version(v, &self.client).await
            {
                java_versions.insert(v.clone(), major);
            }
        }

        Ok(PistonMetadata {
            last_updated: Utc::now(),
            game_versions,
            latest: LatestVersions {
                release: mc_manifest.latest.release.clone(),
                snapshot: mc_manifest.latest.snapshot.clone(),
            },
            required_java_major_versions,
            java_major_version_by_game_version: java_versions,
        })
    }
}

fn manifest_url(slug: &str) -> String {
    match slug {
        "minecraft" => {
            "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json".to_string()
        }
        "fabric" => "https://launcher-meta.modrinth.com/fabric/v0/manifest.json".to_string(),
        "quilt" => "https://launcher-meta.modrinth.com/quilt/v0/manifest.json".to_string(),
        "forge" => "https://launcher-meta.modrinth.com/forge/v0/manifest.json".to_string(),
        "neo" => "https://launcher-meta.modrinth.com/neo/v0/manifest.json".to_string(),
        _ => format!("https://launcher-meta.modrinth.com/{slug}/v0/manifest.json"),
    }
}
