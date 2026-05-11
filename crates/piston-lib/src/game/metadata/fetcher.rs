use super::types::*;
use crate::game::java_policy::{preferred_java_major, LEGACY_JAVA_MAJOR};
use anyhow::{Context, Result};
use chrono::{Datelike, Utc};
use std::collections::{HashMap, HashSet};

const MODRINTH_MC_MANIFEST_URL: &str =
    "https://launcher-meta.modrinth.com/minecraft/v0/manifest.json";
/// Kept for Java version resolution (fallback)
const MOJANG_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const JAVA_RUNTIME_ALL_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const JAVA_METADATA_REQUIRED_YEAR: i32 = 2014;
const FALLBACK_RUNTIME_JAVA_MAJORS: [u32; 4] = [25, 21, 17, LEGACY_JAVA_MAJOR];

/// Format versions for Modrinth endpoints (same as daedalus CURRENT_*_FORMAT_VERSION)
const MODRINTH_FABRIC_FORMAT: usize = 0;
const MODRINTH_QUILT_FORMAT: usize = 0;
const MODRINTH_FORGE_FORMAT: usize = 0;
const MODRINTH_NEO_FORMAT: usize = 0;

#[derive(Debug, serde::Deserialize)]
struct RuntimeAllJavaEntry {
    version: RuntimeVersionInfo,
}

#[derive(Debug, serde::Deserialize)]
struct RuntimeVersionInfo {
    name: String,
}

/// Fetch and build complete PistonMetadata from Modrinth + Mojang
pub async fn fetch_metadata() -> Result<PistonMetadata> {
    log::info!("Fetching PistonMetadata from Modrinth + Mojang...");

    let http_client = build_http_client()?;

    // Fetch Minecraft versions from Modrinth (patched version URLs/SHA1)
    log::info!("Fetching Minecraft manifest from Modrinth...");
    let mc_manifest = fetch_modrinth_mc_manifest(&http_client)
        .await
        .context("Failed to fetch Modrinth Minecraft manifest")?;

    let mut game_versions = build_initial_game_versions(&mc_manifest);

    // Fetch all modloader manifests from Modrinth in parallel
    log::info!("Fetching modloader metadata from Modrinth...");
    let fabric_fut = fetch_modrinth_manifest(&http_client, "fabric", MODRINTH_FABRIC_FORMAT);
    let quilt_fut = fetch_modrinth_manifest(&http_client, "quilt", MODRINTH_QUILT_FORMAT);
    let forge_fut = fetch_modrinth_manifest(&http_client, "forge", MODRINTH_FORGE_FORMAT);
    let neo_fut = fetch_modrinth_manifest(&http_client, "neo", MODRINTH_NEO_FORMAT);

    let (fabric_res, quilt_res, forge_res, neo_res) =
        tokio::join!(fabric_fut, quilt_fut, forge_fut, neo_fut);

    // Apply Fabric (Fabric-style manifest — single dummy entry with all loaders)
    match fabric_res {
        Ok(manifest) => {
            let count = apply_fabric_style_from_modrinth(
                &mut game_versions,
                ModloaderType::Fabric,
                &manifest,
            );
            log::info!("Fabric: applied {} loader versions", count);
        }
        Err(e) => log::error!("Failed to fetch Fabric metadata: {}", e),
    }

    // Apply Quilt (same Fabric-style manifest)
    match quilt_res {
        Ok(manifest) => {
            let count = apply_fabric_style_from_modrinth(
                &mut game_versions,
                ModloaderType::Quilt,
                &manifest,
            );
            log::info!("Quilt: applied {} loader versions", count);
        }
        Err(e) => log::error!("Failed to fetch Quilt metadata: {}", e),
    }

    // Apply Forge (per-version entries)
    match forge_res {
        Ok(manifest) => {
            let count = apply_forge_style_from_modrinth(
                &mut game_versions,
                ModloaderType::Forge,
                &manifest,
            );
            log::info!("Forge: applied {} loaders across all versions", count);
        }
        Err(e) => log::error!("Failed to fetch Forge metadata: {}", e),
    }

    // Apply NeoForge (per-version entries)
    match neo_res {
        Ok(manifest) => {
            let count = apply_forge_style_from_modrinth(
                &mut game_versions,
                ModloaderType::NeoForge,
                &manifest,
            );
            log::info!("NeoForge: applied {} loaders across all versions", count);
        }
        Err(e) => log::error!("Failed to fetch NeoForge metadata: {}", e),
    }

    let mut metadata = PistonMetadata {
        last_updated: Utc::now(),
        game_versions,
        latest: LatestVersions {
            release: mc_manifest.latest.release.clone(),
            snapshot: mc_manifest.latest.snapshot.clone(),
        },
        required_java_major_versions: fetch_runtime_java_majors(&http_client)
            .await
            .unwrap_or_else(|e| {
                log::warn!(
                    "Failed to fetch Java runtimes from launchermeta: {}. Using fallback majors {:?}",
                    e,
                    FALLBACK_RUNTIME_JAVA_MAJORS
                );
                FALLBACK_RUNTIME_JAVA_MAJORS.to_vec()
            }),
        java_major_version_by_game_version: HashMap::new(),
    };

    metadata.sort_all_versions();

    log::info!(
        "PistonMetadata fetched successfully: {} game versions, {} total loader combinations",
        metadata.game_versions.len(),
        metadata
            .game_versions
            .iter()
            .map(|gv| gv.loaders.values().map(|v| v.len()).sum::<usize>())
            .sum::<usize>()
    );

    Ok(metadata)
}

// ============================================================================
// Modrinth manifest fetching
// ============================================================================

/// Fetch a Modrinth modloader manifest
async fn fetch_modrinth_manifest(
    client: &reqwest::Client,
    loader: &str,
    format_version: usize,
) -> Result<ModrinthManifest> {
    let url = format!(
        "{}/{}/v{}/manifest.json",
        MODRINTH_BASE_URL, loader, format_version
    );

    log::debug!("Fetching Modrinth manifest: {}", url);
    let resp = send_with_retry(client, &url, 3, 1000).await?;
    let manifest: ModrinthManifest = resp
        .json()
        .await
        .context(format!("Failed to parse {} manifest JSON", loader))?;

    let total_loaders: usize = manifest
        .game_versions
        .iter()
        .map(|gv| gv.loaders.len())
        .sum();
    log::info!(
        "Modrinth {}: {} game version entries, {} loader versions total",
        loader,
        manifest.game_versions.len(),
        total_loaders
    );

    Ok(manifest)
}

/// Apply Fabric/Quilt-style manifest to game versions.
///
/// These manifests have one dummy entry (id = "modrinth.gameVersion placeholder") that contains ALL loader
/// versions, plus additional entries with real MC version IDs and empty loader lists.
/// The loader versions from the dummy entry get applied to every MC version that appears
/// as a non-dummy entry in the manifest.
///
/// Returns the number of loader versions applied.
fn apply_fabric_style_from_modrinth(
    game_versions: &mut [GameVersionMetadata],
    loader_type: ModloaderType,
    manifest: &ModrinthManifest,
) -> usize {
    // Find the dummy entry that holds all loader versions
    let dummy_entry = manifest
        .game_versions
        .iter()
        .find(|gv| is_dummy_game_version(&gv.id));

    // Build the set of supported MC version IDs (non-dummy entries)
    let supported_versions: HashSet<&str> = manifest
        .game_versions
        .iter()
        .filter(|gv| !is_dummy_game_version(&gv.id))
        .map(|gv| gv.id.as_str())
        .collect();

    let Some(dummy) = dummy_entry else {
        log::warn!("{} manifest has no dummy entry", loader_type.as_str());
        return 0;
    };

    // Build loader version infos from the dummy entry
    let loader_infos: Vec<LoaderVersionInfo> = dummy
        .loaders
        .iter()
        
        .map(|l| LoaderVersionInfo {
            version: l.id.clone(),
            stable: l.stable,
            url: Some(l.url.clone()),
            sha1: None,
            metadata: None,
        })
        .collect();

    let loader_count = loader_infos.len();
    if loader_infos.is_empty() {
        return 0;
    }

    // Apply to every supported MC version
    for version in game_versions.iter_mut() {
        if supported_versions.contains(version.id.as_str()) {
            // Deduplicate: Modrinth may already have loaders for this version from a previous
            // (fallback) run. Overwrite with the full Modrinth set.
            version.loaders.insert(loader_type, loader_infos.clone());
        }
    }

    loader_count
}

/// Apply Forge/NeoForge-style manifest to game versions.
///
/// These manifests have per-game-version entries where each entry carries its own loader versions.
/// Different MC versions support different Forge/NeoForge versions.
///
/// Returns the total number of loader versions applied across all game versions.
fn apply_forge_style_from_modrinth(
    game_versions: &mut [GameVersionMetadata],
    loader_type: ModloaderType,
    manifest: &ModrinthManifest,
) -> usize {
    // Build a map from MC version id → loader infos (skip dummy entries if any)
    let version_map: HashMap<&str, Vec<LoaderVersionInfo>> = manifest
        .game_versions
        .iter()
        .filter(|gv| !is_dummy_game_version(&gv.id) && !gv.loaders.is_empty())
        .map(|gv| {
            let loaders: Vec<LoaderVersionInfo> = gv
                .loaders
                .iter()
                
                .map(|l| LoaderVersionInfo {
                    version: l.id.clone(),
                    stable: l.stable,
                    url: Some(l.url.clone()),
                    sha1: None,
                    metadata: None,
                })
                .collect();
            (gv.id.as_str(), loaders)
        })
        .collect();

    let mut total_applied = 0;

    for version in game_versions.iter_mut() {
        if let Some(loaders) = version_map.get(version.id.as_str()) {
            if !loaders.is_empty() {
                total_applied += loaders.len();
                version.loaders.insert(loader_type, loaders.clone());
            }
        }
    }

    total_applied
}

// ============================================================================
// Mojang API (kept for vanilla version list + Java resolution)
// ============================================================================

/// Fetch Java major version for a single Minecraft version directly from Mojang metadata.
pub async fn fetch_java_major_for_version(version_id: &str) -> Result<u32> {
    let client = build_http_client()?;
    let manifest = fetch_mojang_manifest_with_client(&client).await?;

    let version = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .context(format!(
            "Minecraft version '{}' not found in Mojang manifest",
            version_id
        ))?;

    let detail = fetch_version_detail(&client, &version.url).await?;
    java_major_from_version_detail(
        &version.id,
        &version.version_type,
        &version.release_time,
        detail.java_version,
    )
}

/// Fetch only latest release/snapshot identifiers from Mojang manifest.
pub async fn fetch_latest_versions() -> Result<LatestVersions> {
    let client = build_http_client()?;
    let manifest = fetch_mojang_manifest_with_client(&client).await?;
    Ok(LatestVersions {
        release: manifest.latest.release,
        snapshot: manifest.latest.snapshot,
    })
}

fn build_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VestaLauncher/1.0")
        .build()
        .context("Failed to create HTTP client")
}

async fn fetch_runtime_java_majors(client: &reqwest::Client) -> Result<Vec<u32>> {
    let response = send_with_retry(client, JAVA_RUNTIME_ALL_URL, 3, 1000).await?;
    let data: HashMap<String, HashMap<String, Vec<RuntimeAllJavaEntry>>> = response
        .json()
        .await
        .context("Failed to parse java-runtime all.json")?;

    let mut majors = std::collections::BTreeSet::new();

    for (_platform, components) in data {
        for (component, entries) in components {
            if !component.starts_with("java-runtime-") && component != "jre-legacy" {
                continue;
            }

            for entry in entries {
                if let Some(major) = parse_runtime_java_major(&entry.version.name) {
                    majors.insert(preferred_java_major(major));
                } else {
                    log::warn!(
                        "Could not parse Java major from runtime version name '{}' (component '{}')",
                        entry.version.name,
                        component
                    );
                }
            }
        }
    }

    if majors.is_empty() {
        anyhow::bail!("java-runtime all.json did not yield any runtime Java majors")
    }

    let out: Vec<u32> = majors.into_iter().rev().collect();
    log::info!("Resolved runtime Java majors from launchermeta: {:?}", out);
    Ok(out)
}

fn parse_runtime_java_major(version_name: &str) -> Option<u32> {
    if let Some(rest) = version_name.strip_prefix("1.") {
        let second = rest
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>();
        if !second.is_empty() {
            return second.parse::<u32>().ok();
        }
    }

    let leading = version_name
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>();
    if leading.is_empty() {
        return None;
    }

    leading.parse::<u32>().ok()
}

fn java_major_from_version_detail(
    version_id: &str,
    version_type: &str,
    release_time: &str,
    java_version: Option<MojangJavaVersion>,
) -> Result<u32> {
    if let Some(java) = java_version {
        return Ok(java.major_version);
    }

    if is_legacy_mojang_version(version_type, release_time) {
        log::warn!(
            "Missing javaVersion for legacy/pre-metadata version '{}' (type '{}', release '{}'), defaulting to Java {}",
            version_id,
            version_type,
            release_time,
            LEGACY_JAVA_MAJOR
        );
        return Ok(LEGACY_JAVA_MAJOR);
    }

    anyhow::bail!(
        "Missing javaVersion.majorVersion for non-legacy Minecraft version '{}' (type '{}', release '{}')",
        version_id,
        version_type,
        release_time
    )
}

fn is_legacy_mojang_version(version_type: &str, release_time: &str) -> bool {
    if matches!(version_type, "old_alpha" | "old_beta") {
        return true;
    }

    chrono::DateTime::parse_from_rfc3339(release_time)
        .map(|dt| dt.year() < JAVA_METADATA_REQUIRED_YEAR)
        .unwrap_or(false)
}

fn build_initial_game_versions(manifest: &MojangVersionManifest) -> Vec<GameVersionMetadata> {
    manifest
        .versions
        .iter()
        .map(|version| {
            let mut loaders = HashMap::new();

            let vanilla_url = format!(
                "{}/minecraft/v0/versions/{}.json",
                MODRINTH_BASE_URL, version.id
            );

            let vanilla_sha1 = if version.sha1.is_empty() {
                None
            } else {
                Some(version.sha1.clone())
            };

            let vanilla_loader = LoaderVersionInfo {
                version: version.id.clone(),
                stable: version.version_type == "release",
                url: Some(vanilla_url),
                sha1: vanilla_sha1,
                metadata: None,
            };

            loaders.insert(ModloaderType::Vanilla, vec![vanilla_loader]);

            let release_time = chrono::DateTime::parse_from_rfc3339(&version.release_time)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            GameVersionMetadata {
                id: version.id.clone(),
                version_type: version.version_type.clone(),
                release_time,
                stable: version.version_type == "release",
                loaders,
            }
        })
        .collect()
}

// ============================================================================
// HTTP utilities
// ============================================================================

/// Generic HTTP GET with retry logic, backoff, and 429 handling
pub(crate) async fn send_with_retry(
    client: &reqwest::Client,
    url: &str,
    max_retries: u32,
    initial_backoff_ms: u64,
) -> Result<reqwest::Response> {
    let mut last_error = None;

    for attempt in 0..max_retries {
        if attempt > 0 {
            let backoff = initial_backoff_ms * 2u64.pow(attempt - 1);
            let jitter = rand::random::<u64>() % 100;
            let total_backoff = backoff + jitter;

            log::info!(
                "Retrying request (attempt {}/{}) for {} after {}ms...",
                attempt + 1,
                max_retries,
                url,
                total_backoff
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(total_backoff)).await;
        }

        match client.get(url).send().await {
            Ok(response) => {
                let status = response.status();

                if status.is_success() {
                    return Ok(response);
                }

                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let mut retry_after_ms = 5000;

                    if let Some(retry_after) = response.headers().get(reqwest::header::RETRY_AFTER)
                    {
                        if let Ok(s) = retry_after.to_str() {
                            if let Ok(seconds) = s.parse::<u64>() {
                                retry_after_ms = seconds * 1000;
                            }
                        }
                    }

                    log::warn!(
                        "Rate limited (429) for {}. Waiting {}ms before retry...",
                        url,
                        retry_after_ms
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(retry_after_ms)).await;
                    continue;
                }

                if status.is_server_error() {
                    let error_msg = format!("Server error {} from {}", status, url);
                    log::warn!("{}", error_msg);
                    last_error = Some(anyhow::anyhow!(error_msg));
                    continue;
                }

                let error_msg = format!("Request failed with status {} for {}", status, url);
                return Err(anyhow::anyhow!(error_msg));
            }
            Err(e) => {
                let error_msg = format!("Network error for {}: {}", url, e);
                log::warn!("{}", error_msg);
                last_error = Some(anyhow::anyhow!(error_msg));
                continue;
            }
        }
    }

    let detail = last_error
        .map(|e| e.to_string())
        .unwrap_or_else(|| "unknown error".to_string());
    Err(anyhow::anyhow!(
        "Failed to fetch {} after {} retries: {}",
        url,
        max_retries,
        detail
    ))
}

async fn fetch_modrinth_mc_manifest(client: &reqwest::Client) -> Result<MojangVersionManifest> {
    let resp = send_with_retry(client, MODRINTH_MC_MANIFEST_URL, 3, 1000).await?;
    let manifest = resp
        .json::<MojangVersionManifest>()
        .await
        .context("Failed to parse Modrinth Minecraft manifest JSON")?;
    log::info!(
        "Fetched {} Minecraft versions from Modrinth",
        manifest.versions.len()
    );
    Ok(manifest)
}

async fn fetch_mojang_manifest_with_client(
    client: &reqwest::Client,
) -> Result<MojangVersionManifest> {
    let resp = send_with_retry(client, MOJANG_MANIFEST_URL, 3, 1000).await?;
    let manifest = resp
        .json::<MojangVersionManifest>()
        .await
        .context("Failed to parse Mojang manifest JSON")?;
    log::info!("Fetched {} Mojang versions", manifest.versions.len());
    Ok(manifest)
}

async fn fetch_version_detail(client: &reqwest::Client, url: &str) -> Result<MojangVersionDetail> {
    let resp = send_with_retry(client, url, 2, 500).await?;
    let detail = resp.json::<MojangVersionDetail>().await?;
    Ok(detail)
}

// ============================================================================
// Blacklist re-export helper
// ============================================================================



#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;
    use wiremock::{Request, Respond};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    struct FailThenOkResponder {
        first_status: u16,
        retry_after: Option<&'static str>,
        calls: AtomicUsize,
    }

    impl Respond for FailThenOkResponder {
        fn respond(&self, _request: &Request) -> ResponseTemplate {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call == 0 {
                let mut resp =
                    ResponseTemplate::new(self.first_status).set_body_string("retry");
                if let Some(value) = self.retry_after {
                    resp = resp.insert_header("Retry-After", value);
                }
                resp
            } else {
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"versions": []}))
            }
        }
    }

    #[tokio::test]
    async fn test_send_with_retry_retries_on_5xx() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/test"))
            .respond_with(FailThenOkResponder {
                first_status: 500,
                retry_after: None,
                calls: AtomicUsize::new(0),
            })
            .expect(2)
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();

        let url = format!("{}/test", &mock_server.uri());
        let result = send_with_retry(&client, &url, 3, 100).await;

        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.status(), 200);
    }

    #[tokio::test]
    async fn test_send_with_retry_429_honors_retry_after() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/test"))
            .respond_with(FailThenOkResponder {
                first_status: 429,
                retry_after: Some("1"),
                calls: AtomicUsize::new(0),
            })
            .expect(2)
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let url = format!("{}/test", &mock_server.uri());
        let start = Instant::now();
        let result = send_with_retry(&client, &url, 3, 100).await;
        let elapsed = start.elapsed();

        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.status(), 200);
        assert!(elapsed.as_millis() >= 1000);
    }

    #[tokio::test]
    async fn test_send_with_retry_4xx_fails_fast() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/test"))
            .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
            .expect(1)
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();

        let url = format!("{}/test", &mock_server.uri());
        let result = send_with_retry(&client, &url, 3, 100).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("404"));
    }

    #[tokio::test]
    async fn test_send_with_retry_exhausts_retries() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/test"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Server Error"))
            .expect(3)
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();

        let url = format!("{}/test", &mock_server.uri());
        let result = send_with_retry(&client, &url, 3, 100).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("after 3 retries"));
    }
}
