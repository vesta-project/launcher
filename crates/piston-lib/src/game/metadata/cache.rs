use super::types::PistonMetadata;
use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::game::installer::{track_artifact_from_path, try_restore_artifact};

const METADATA_FILENAME: &str = "metadata.json";
const CACHE_DURATION_HOURS: i64 = 24; // Refresh metadata every 24 hours
const METADATA_LABEL: &str = "metadata/piston_metadata.json";

pub fn metadata_cache_path(data_dir: &Path) -> PathBuf {
    data_dir.join(METADATA_FILENAME)
}

/// Load cached metadata from disk, or fetch fresh if cache is stale/missing
pub async fn load_or_fetch_metadata(data_dir: &PathBuf) -> Result<PistonMetadata> {
    let metadata_path = metadata_cache_path(data_dir);

    if !metadata_path.exists() && try_restore_artifact(METADATA_LABEL, &metadata_path).await? {
        log::info!("Restored cached piston metadata file from artifact cache");
    }

    // Try to load from cache first
    if metadata_path.exists() {
        match load_cached_metadata(&metadata_path).await {
            Ok(mut metadata) => {
                track_metadata_file(&metadata_path).await.ok();

                // Ensure versions are sorted (latest first)
                metadata
                    .game_versions
                    .sort_by(|a, b| b.release_time.cmp(&a.release_time));

                // Check if cache is still fresh
                let age = Utc::now() - metadata.last_updated;

                if age < Duration::hours(CACHE_DURATION_HOURS) {
                    log::info!(
                        "Using cached PistonMetadata (age: {} hours)",
                        age.num_hours()
                    );
                    return Ok(metadata);
                } else {
                    log::info!(
                        "Cached PistonMetadata is stale (age: {} hours), refreshing...",
                        age.num_hours()
                    );
                }
            }
            Err(e) => {
                log::warn!("Failed to load cached metadata: {}, fetching fresh...", e);
            }
        }
    } else {
        log::info!("No cached metadata found, fetching fresh...");
    }

    // Try to fetch fresh metadata
    match super::fetcher::fetch_metadata().await {
        Ok(metadata) => {
            // Save to cache
            if let Err(e) = save_metadata(&metadata_path, &metadata).await {
                log::warn!("Failed to save metadata to cache: {}", e);
            }
            track_metadata_file(&metadata_path).await.ok();
            Ok(metadata)
        }
        Err(e) => {
            log::error!("Failed to fetch fresh metadata: {}", e);

            // Try to fall back to stale cache if it exists
            if metadata_path.exists() {
                log::warn!("Falling back to stale cached metadata due to fetch failure");
                match load_cached_metadata(&metadata_path).await {
                    Ok(mut metadata) => {
                        track_metadata_file(&metadata_path).await.ok();

                        // Ensure versions are sorted (latest first)
                        metadata
                            .game_versions
                            .sort_by(|a, b| b.release_time.cmp(&a.release_time));

                        log::info!(
                            "Using stale cached metadata (age: {} hours)",
                            (Utc::now() - metadata.last_updated).num_hours()
                        );
                        Ok(metadata)
                    }
                    Err(cache_err) => {
                        log::error!("Failed to load stale cache: {}", cache_err);
                        Err(e).context("Failed to fetch metadata and no valid cache available")
                    }
                }
            } else {
                Err(e).context("Failed to fetch metadata and no cache exists")
            }
        }
    }
}

/// Force refresh metadata from all sources
pub async fn refresh_metadata(data_dir: &PathBuf) -> Result<PistonMetadata> {
    log::info!("Force refreshing PistonMetadata...");

    let metadata = super::fetcher::fetch_metadata().await?;

    let metadata_path = metadata_cache_path(data_dir);
    save_metadata(&metadata_path, &metadata)
        .await
        .context("Failed to save refreshed metadata")?;
    track_metadata_file(&metadata_path).await.ok();

    Ok(metadata)
}

/// Load metadata from cache file
async fn load_cached_metadata(path: &PathBuf) -> Result<PistonMetadata> {
    let contents = fs::read_to_string(path)
        .await
        .context("Failed to read metadata file")?;

    let metadata: PistonMetadata =
        serde_json::from_str(&contents).context("Failed to parse metadata JSON")?;

    Ok(metadata)
}

/// Save metadata to cache file
async fn save_metadata(path: &PathBuf, metadata: &PistonMetadata) -> Result<()> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .context("Failed to create metadata directory")?;
    }

    let json =
        serde_json::to_string_pretty(metadata).context("Failed to serialize metadata to JSON")?;

    fs::write(path, json)
        .await
        .context("Failed to write metadata file")?;

    log::debug!("Saved PistonMetadata to {:?}", path);
    Ok(())
}

async fn track_metadata_file(path: &PathBuf) -> Result<()> {
    track_artifact_from_path(METADATA_LABEL.to_string(), path, None, None).await
}

/// Query helpers for metadata
impl PistonMetadata {
    /// Get metadata for a specific game version
    pub fn get_game_version(
        &self,
        version_id: &str,
    ) -> Option<&crate::game::metadata::GameVersionMetadata> {
        self.game_versions.iter().find(|gv| gv.id == version_id)
    }

    /// Check if a modloader version is available for a game version
    pub fn is_loader_available(
        &self,
        game_version: &str,
        loader_type: crate::game::metadata::ModloaderType,
        loader_version: Option<&str>,
    ) -> bool {
        if let Some(game_meta) = self.get_game_version(game_version) {
            if let Some(loaders) = game_meta.loaders.get(&loader_type) {
                if let Some(version) = loader_version {
                    // Check for specific loader version
                    loaders.iter().any(|l| l.version == version)
                } else {
                    // Just check if loader type is available
                    !loaders.is_empty()
                }
            } else {
                false
            }
        } else {
            false
        }
    }

    /// Get the latest stable loader version for a game version
    pub fn get_latest_loader_version(
        &self,
        game_version: &str,
        loader_type: crate::game::metadata::ModloaderType,
    ) -> Option<String> {
        self.get_game_version(game_version)?
            .loaders
            .get(&loader_type)?
            .iter()
            .find(|l| l.stable)
            .or_else(|| {
                // Fallback to first version if no stable found
                self.get_game_version(game_version)?
                    .loaders
                    .get(&loader_type)?
                    .first()
            })
            .map(|l| l.version.clone())
    }

    /// Get all game versions that support a specific loader
    pub fn get_game_versions_for_loader(
        &self,
        loader_type: crate::game::metadata::ModloaderType,
    ) -> Vec<String> {
        self.game_versions
            .iter()
            .filter(|gv| gv.loaders.contains_key(&loader_type))
            .map(|gv| gv.id.clone())
            .collect()
    }
}
