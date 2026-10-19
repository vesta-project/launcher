use super::types::*;
use crate::game::java_policy::{
    is_legacy_minecraft_version, preferred_java_major, LEGACY_JAVA_MAJOR,
};
use anyhow::{Context, Result};
use chrono::Utc;
use std::collections::HashMap;

const MODRINTH_MC_MANIFEST_URL: &str =
    "https://launcher-meta.modrinth.com/minecraft/v0/manifest.json";
/// Kept for Java version resolution (fallback)
const MOJANG_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const JAVA_RUNTIME_ALL_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

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

    let http_client = crate::client::shared_client();

    // Fetch Minecraft versions from Modrinth (patched version URLs/SHA1)
    log::info!("Fetching Minecraft manifest from Modrinth...");
    let mc_manifest = fetch_modrinth_mc_manifest(http_client)
        .await
        .context("Failed to fetch Modrinth Minecraft manifest")?;

    let mut game_versions = build_initial_game_versions(&mc_manifest);

    // Fetch all modloader manifests from Modrinth in parallel
    log::info!("Fetching modloader metadata from Modrinth...");
    let fabric_fut = fetch_modrinth_manifest(http_client, "fabric");
    let quilt_fut = fetch_modrinth_manifest(http_client, "quilt");
    let forge_fut = fetch_modrinth_manifest(http_client, "forge");
    let neo_fut = fetch_modrinth_manifest(http_client, "neo");

    let (fabric_res, quilt_res, forge_res, neo_res) =
        tokio::join!(fabric_fut, quilt_fut, forge_fut, neo_fut);

    // Apply Fabric (universal loader list)
    match fabric_res {
        Ok(manifest) => {
            let count =
                apply_modrinth_manifest(&mut game_versions, ModloaderType::Fabric, &manifest);
            log::info!("Fabric: applied {} loader versions", count);
        }
        Err(e) => log::error!("Failed to fetch Fabric metadata: {}", e),
    }

    // Apply Quilt (Minecraft versions reference profile groups)
    match quilt_res {
        Ok(manifest) => {
            let count =
                apply_modrinth_manifest(&mut game_versions, ModloaderType::Quilt, &manifest);
            log::info!("Quilt: applied {} loader versions", count);
        }
        Err(e) => log::error!("Failed to fetch Quilt metadata: {}", e),
    }

    // Apply Forge (per-version entries)
    match forge_res {
        Ok(manifest) => {
            let count =
                apply_modrinth_manifest(&mut game_versions, ModloaderType::Forge, &manifest);
            log::info!("Forge: applied {} loaders across all versions", count);
        }
        Err(e) => log::error!("Failed to fetch Forge metadata: {}", e),
    }

    // Apply NeoForge (per-version entries)
    match neo_res {
        Ok(manifest) => {
            let count =
                apply_modrinth_manifest(&mut game_versions, ModloaderType::NeoForge, &manifest);
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
        required_java_major_versions: fetch_runtime_java_majors(http_client)
            .await
            .context("Failed to fetch Java runtimes from launchermeta")?,
        java_major_version_by_game_version: HashMap::new(),
    };

    // Sort game versions by release date (latest first)
    metadata
        .game_versions
        .sort_by_key(|b| std::cmp::Reverse(b.release_time));

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
) -> Result<ModrinthManifest> {
    let url = modrinth_manifest_url(loader);

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
        .chain(
            manifest
                .version_groups
                .iter()
                .map(|group| group.loaders.len()),
        )
        .sum();
    log::info!(
        "Modrinth {}: {} game version entries, {} loader versions total",
        loader,
        manifest.game_versions.len(),
        total_loaders
    );

    Ok(manifest)
}

/// Resolve grouped Quilt, universal Fabric and per-game Forge/NeoForge metadata.
fn apply_modrinth_manifest(
    game_versions: &mut [GameVersionMetadata],
    loader_type: ModloaderType,
    manifest: &ModrinthManifest,
) -> usize {
    let index = match manifest.loaders_by_game() {
        Ok(index) => index,
        Err(error) => {
            log::error!("Invalid {loader_type} metadata: {error:#}");
            return 0;
        }
    };
    let mut total_applied = 0;
    for game in game_versions {
        if let Some(versions) = index.get(game.id.as_str()).filter(|v| !v.is_empty()) {
            total_applied += versions.len();
            game.loaders.insert(
                loader_type,
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
    total_applied
}

// ============================================================================
// Mojang API (kept for vanilla version list + Java resolution)
// ============================================================================

/// Fetch Java major version for a single Minecraft version directly from Mojang metadata.
pub async fn fetch_java_major_for_version(version_id: &str) -> Result<u32> {
    let client = crate::client::shared_client();
    let manifest = fetch_mojang_manifest_with_client(client).await?;

    let version = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .context(format!(
            "Minecraft version '{}' not found in Mojang manifest",
            version_id
        ))?;

    let detail = fetch_version_detail(client, &version.url).await?;
    java_major_from_version_detail(
        &version.id,
        &version.version_type,
        &version.release_time,
        detail.java_version,
    )
}

/// Fetch only latest release/snapshot identifiers from Mojang manifest.
pub async fn fetch_latest_versions() -> Result<LatestVersions> {
    let client = crate::client::shared_client();
    let manifest = fetch_mojang_manifest_with_client(client).await?;
    Ok(LatestVersions {
        release: manifest.latest.release,
        snapshot: manifest.latest.snapshot,
    })
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

    if is_legacy_minecraft_version(version_type, release_time) {
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
    use crate::client::shared_client;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    use wiremock::{Request, Respond};

    struct FailThenOkResponder {
        first_status: u16,
        retry_after: Option<&'static str>,
        calls: AtomicUsize,
    }

    impl Respond for FailThenOkResponder {
        fn respond(&self, _request: &Request) -> ResponseTemplate {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call == 0 {
                let mut resp = ResponseTemplate::new(self.first_status).set_body_string("retry");
                if let Some(value) = self.retry_after {
                    resp = resp.insert_header("Retry-After", value);
                }
                resp
            } else {
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"versions": []}))
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

        let client = shared_client();

        let url = format!("{}/test", &mock_server.uri());
        let result = send_with_retry(client, &url, 3, 100).await;

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

        let client = shared_client();

        let url = format!("{}/test", &mock_server.uri());
        let start = Instant::now();
        let result = send_with_retry(client, &url, 3, 100).await;
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

        let client = shared_client();

        let url = format!("{}/test", &mock_server.uri());
        let result = send_with_retry(client, &url, 3, 100).await;

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

        let client = shared_client();

        let url = format!("{}/test", &mock_server.uri());
        let result = send_with_retry(client, &url, 3, 100).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("after 3 retries"));
    }
}
