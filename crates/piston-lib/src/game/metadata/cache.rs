use super::types::PistonMetadata;
use crate::game::manifest_cache::ManifestCache;
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Legacy metadata cache path — kept for backward compatibility.
/// The new ManifestCache stores individual manifests at `data/manifests/{slug}.json`.
pub fn metadata_cache_path(data_dir: &Path) -> PathBuf {
    data_dir.join("piston_manifest.json")
}

/// Load or fetch metadata, delegating to ManifestCache.
/// ETag revalidation is handled internally by ManifestCache (5-min freshness window).
pub async fn load_or_fetch_metadata_ext(data_dir: &PathBuf) -> Result<PistonMetadata> {
    let cache = ManifestCache::new(data_dir.join("manifests"));
    cache.build_piston_metadata().await
}

/// Load or fetch metadata with default settings.
pub async fn load_or_fetch_metadata(data_dir: &PathBuf) -> Result<PistonMetadata> {
    load_or_fetch_metadata_ext(data_dir).await
}

/// Load cached metadata only, without triggering any network fetch.
/// Uses disk-only reads — no ETag revalidation. Returns `None` if not available.
pub async fn load_cached_metadata_if_present(data_dir: &PathBuf) -> Result<Option<PistonMetadata>> {
    // Check if all manifests are cached on disk
    let all_cached = crate::game::manifest_cache::MANIFEST_SLUGS
        .iter()
        .all(|slug| {
            data_dir
                .join("manifests")
                .join(format!("{slug}.json"))
                .exists()
        });
    if !all_cached {
        return Ok(None);
    }
    // Use disk-only reads — skip ETag revalidation
    let cache = ManifestCache::new_offline(data_dir.join("manifests"));
    Ok(Some(cache.build_piston_metadata().await?))
}

/// Force refresh all metadata from sources.
pub async fn refresh_metadata(data_dir: &PathBuf) -> Result<PistonMetadata> {
    let cache = ManifestCache::new(data_dir.join("manifests"));
    // For a force refresh, we skip the cache by clearing it first
    // and then building fresh metadata.
    for slug in crate::game::manifest_cache::MANIFEST_SLUGS {
        let disk_path = data_dir.join("manifests").join(format!("{slug}.json"));
        if disk_path.exists() {
            tokio::fs::remove_file(&disk_path).await.ok();
        }
    }
    cache.build_piston_metadata().await
}
