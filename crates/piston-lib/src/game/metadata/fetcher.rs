use super::types::*;
use anyhow::{Context, Result};
use chrono::Utc;
use futures::future::join_all;
use std::collections::HashMap;

const MOJANG_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META_URL: &str = "https://meta.fabricmc.net/v2/versions";
const QUILT_META_URL: &str = "https://meta.quiltmc.org/v3/versions";
const FORGE_MAVEN_URL: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_MAVEN_URL: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const NEOFORGE_API_VERSIONS: &str = "https://maven.neoforged.net/api/maven/versions/releases/";
const NEOFORGE_API_FALLBACK_VERSIONS: &str =
    "https://maven.creeperhost.net/api/maven/versions/releases/";
const NEOFORGE_GAV: &str = "net/neoforged/neoforge";

#[derive(Debug, serde::Deserialize)]
struct VersionStruct {
    version: String,
}

#[derive(Debug, serde::Deserialize)]
struct FabricGameMetaVersionInfo {
    loader: FabricLoaderMeta,
}

#[derive(Debug, serde::Deserialize)]
struct FabricLoaderMeta {
    version: String,
    stable: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
struct ForgeVersionsXml {
    versioning: ForgeVersioning,
}

#[derive(Debug, serde::Deserialize)]
struct ForgeVersioning {
    versions: ForgeVersionList,
}

#[derive(Debug, serde::Deserialize)]
struct ForgeVersionList {
    version: Vec<String>,
}

/// Fetch and build complete PistonMetadata
pub async fn fetch_metadata() -> Result<PistonMetadata> {
    log::info!("Fetching PistonMetadata from all sources...");

    // Create HTTP client with timeout to prevent hanging requests
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .context("Failed to create HTTP client")?;

    // Fetch Mojang vanilla versions (required - fail fast if this fails)
    log::info!("Vanilla");
    let mojang_manifest = fetch_mojang_manifest_with_client(&http_client)
        .await
        .context("Failed to fetch Mojang version manifest")?;

    let mut game_versions = build_initial_game_versions(&mojang_manifest);

    // Fetch loader versions sequentially (following Nexus pattern)
    log::info!("Fabric");
    add_fabric_modloader(&http_client, "Fabric", FABRIC_META_URL, &mut game_versions).await;

    log::info!("Quilt");
    add_fabric_modloader(&http_client, "Quilt", QUILT_META_URL, &mut game_versions).await;

    log::info!("Forge");
    add_forge_modloader(&http_client, "Forge", FORGE_MAVEN_URL, &mut game_versions).await;

    log::info!("NeoForge");
    add_neoforge_api_then_maven(
        &http_client,
        "NeoForge",
        NEOFORGE_API_VERSIONS,
        NEOFORGE_API_FALLBACK_VERSIONS,
        NEOFORGE_MAVEN_URL,
        &mut game_versions,
    )
    .await;

    let metadata = PistonMetadata {
        last_updated: Utc::now(),
        game_versions,
        latest: LatestVersions {
            release: mojang_manifest.latest.release.clone(),
            snapshot: mojang_manifest.latest.snapshot.clone(),
        },
    };

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

fn build_initial_game_versions(
    mojang_manifest: &MojangVersionManifest,
) -> Vec<GameVersionMetadata> {
    mojang_manifest
        .versions
        .iter()
        .map(|mojang_version| {
            let mut loaders = HashMap::new();

            // Vanilla is always available
            let vanilla_loader = LoaderVersionInfo {
                version: mojang_version.id.clone(),
                stable: mojang_version.version_type == "release",
                metadata: None,
            };

            loaders.insert(ModloaderType::Vanilla, vec![vanilla_loader]);

            let release_time = chrono::DateTime::parse_from_rfc3339(&mojang_version.release_time)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            GameVersionMetadata {
                id: mojang_version.id.clone(),
                version_type: mojang_version.version_type.clone(),
                release_time,
                stable: mojang_version.version_type == "release",
                loaders,
            }
        })
        .collect()
}

/// Fetch Mojang version manifest with retry logic
async fn fetch_mojang_manifest_with_client(client: &reqwest::Client) -> Result<MojangVersionManifest> {
    const MAX_RETRIES: u32 = 3;
    const INITIAL_BACKOFF_MS: u64 = 1000;

    let mut last_error = None;

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            let backoff = INITIAL_BACKOFF_MS * 2u64.pow(attempt - 1);
            log::info!(
                "Retrying Mojang manifest fetch (attempt {}/{}) after {}ms...",
                attempt + 1,
                MAX_RETRIES,
                backoff
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(backoff)).await;
        }

        match client.get(MOJANG_MANIFEST_URL).send().await {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let error_msg = format!("HTTP {} from Mojang manifest URL", status);
                    log::warn!("{}", error_msg);
                    last_error = Some(anyhow::anyhow!(error_msg));
                    continue;
                }

                match response.json::<MojangVersionManifest>().await {
                    Ok(manifest) => {
                        log::info!("Fetched {} Mojang versions", manifest.versions.len());
                        return Ok(manifest);
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to parse Mojang manifest JSON: {}", e);
                        log::warn!("{}", error_msg);
                        last_error = Some(anyhow::anyhow!(error_msg));
                        continue;
                    }
                }
            }
            Err(e) => {
                let error_msg = format!("Failed to GET Mojang manifest: {}", e);
                log::warn!("{}", error_msg);
                last_error = Some(anyhow::anyhow!(error_msg));
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        anyhow::anyhow!(
            "Failed to fetch Mojang manifest after {} retries",
            MAX_RETRIES
        )
    }))
}

/// Add Fabric-style modloader (Fabric or Quilt) using parallel requests
async fn add_fabric_modloader(
    client: &reqwest::Client,
    loader_name: &str,
    repo: &str,
    game_versions: &mut Vec<GameVersionMetadata>,
) {
    // Get list of game versions that support this loader
    let loader_version_list: Vec<String> = match client.get(format!("{}/game", repo)).send().await {
        Ok(result) => match result.json::<Vec<VersionStruct>>().await {
            Ok(versions) => versions.iter().map(|v| v.version.clone()).collect(),
            Err(e) => {
                log::error!("Error parsing {} versions: {}", loader_name, e);
                return;
            }
        },
        Err(e) => {
            log::error!("Error requesting {} versions: {}", loader_name, e);
            return;
        }
    };

    log::info!(
        "{}: Found {} supported game versions",
        loader_name,
        loader_version_list.len()
    );

    // Filter to only game versions that support this loader
    let supported_versions: Vec<&mut GameVersionMetadata> = game_versions
        .iter_mut()
        .filter(|v| loader_version_list.contains(&v.id))
        .collect();

    log::info!(
        "{}: Processing {} game versions in parallel",
        loader_name,
        supported_versions.len()
    );

    // Fetch loader versions in parallel
    let futures: Vec<_> = supported_versions
        .into_iter()
        .map(|version| {
            let url = format!("{}/loader/{}", repo, version.id);
            let version_id = version.id.clone();
            let loader_name_owned = loader_name.to_string();
            let client_clone = client.clone();

            async move {
                match client_clone.get(&url).send().await {
                    Ok(response) if response.status().is_success() => {
                        match response.json::<Vec<FabricGameMetaVersionInfo>>().await {
                            Ok(loader_versions) => {
                                let loader_infos: Vec<LoaderVersionInfo> = loader_versions
                                    .into_iter()
                                    .map(|l| LoaderVersionInfo {
                                        version: l.loader.version.clone(),
                                        stable: l
                                            .loader
                                            .stable
                                            .unwrap_or_else(|| !l.loader.version.contains("beta")),
                                        metadata: None,
                                    })
                                    .collect();

                                log::info!(
                                    "{}: {} - {} loaders",
                                    loader_name_owned,
                                    version_id,
                                    loader_infos.len()
                                );
                                Some((version_id, loader_infos))
                            }
                            Err(e) => {
                                log::warn!(
                                    "{}: Error parsing loaders for {}: {}",
                                    loader_name_owned,
                                    version_id,
                                    e
                                );
                                None
                            }
                        }
                    }
                    Ok(response) => {
                        log::warn!(
                            "{}: HTTP {} for {}",
                            loader_name_owned,
                            response.status(),
                            version_id
                        );
                        None
                    }
                    Err(e) => {
                        log::warn!(
                            "{}: Request error for {}: {}",
                            loader_name_owned,
                            version_id,
                            e
                        );
                        None
                    }
                }
            }
        })
        .collect();

    let results = join_all(futures).await;

    // Apply results back to game_versions
    let loader_type = match loader_name {
        "Fabric" => ModloaderType::Fabric,
        "Quilt" => ModloaderType::Quilt,
        _ => return,
    };

    for result in results.into_iter().flatten() {
        if let Some(version) = game_versions.iter_mut().find(|v| v.id == result.0) {
            version.loaders.insert(loader_type.clone(), result.1);
        }
    }

    log::info!("{}: Complete", loader_name);
}

fn process_forge_versions(
    loader_name: &str,
    forge_xml: &ForgeVersionsXml,
    game_versions: &mut Vec<GameVersionMetadata>,
) {
    let loader_type = match loader_name {
        "Forge" => ModloaderType::Forge,
        "NeoForge" => ModloaderType::NeoForge,
        _ => return,
    };

    for version in game_versions.iter_mut() {
        // Get existing loader info (in case NeoForge has multiple repos)
        let mut loader_info: HashMap<String, LoaderVersionInfo> = version
            .loaders
            .get(&loader_type)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|l| (l.version.clone(), l))
            .collect();

        // Find all forge versions that start with this game version
        let matching_versions: Vec<&String> = forge_xml
            .versioning
            .versions
            .version
            .iter()
            .filter(|v| v.starts_with(&version.id))
            .collect();

        for forge_version in matching_versions {
            // Extract a candidate loader version.
            // - If the maven version contains a dash (Forge style), take the last segment
            // - Otherwise (NeoForge style) take the whole string
            // Use nexus semantics: split on '-' and take the last segment
            let l_version = forge_version.split('-').last().unwrap().to_string();

            loader_info.insert(
                l_version.clone(),
                LoaderVersionInfo {
                    version: l_version.clone(),
                    // Nexus uses stable=false here (as in supplied example)
                    stable: false,
                    metadata: None,
                },
            );
        }

        // NeoForge variant matching: NeoForge sometimes publishes versions without the
        // Minecraft-version prefix (e.g., "20.2.16" for MC 1.20.2). If no matching
        // loaders were discovered above for NeoForge, try a heuristic match using a
        // derived NeoForge prefix such as converting "1.20.2" -> "20.2" and include
        // any maven entries that start with that prefix.
        // No heuristic extensions — keep behavior consistent with the working code sample.

        if loader_info.is_empty() {
            log::debug!(
                "{}: No loaders found for {} via XML – loader_info empty",
                loader_name,
                version.id
            );
        }

        if !loader_info.is_empty() {
            let loader_list: Vec<LoaderVersionInfo> = loader_info.into_values().collect();
            log::info!(
                "{}: {} - {} loaders",
                loader_name,
                version.id,
                loader_list.len()
            );
            version.loaders.insert(loader_type.clone(), loader_list);
        }
    }
}

/// Try to fetch NeoForge releases from the JSON API, normalize it and return
/// a mapping from Minecraft version (e.g., "1.20.2") -> list of releases
async fn fetch_neoforge_api_index(
    client: &reqwest::Client,
    api_base: &str,
    gav: &str,
) -> Result<HashMap<String, Vec<serde_json::Value>>> {
    let url = format!("{}{}", api_base, gav);

    let resp = client.get(&url).send().await?.text().await?;

    // Be forgiving: accept either an object with `versions` or a bare array.
    // We will normalize into a HashMap keyed by minecraft-version string.
    let json_val: serde_json::Value =
        serde_json::from_str(&resp).context("Parsing neoForge API JSON")?;

    let out = normalize_neoforge_json(json_val);

    Ok(out)
}

/// Normalizes several NeoForge JSON shapes into a map from MC version -> list of entries.
fn normalize_neoforge_json(json_val: serde_json::Value) -> HashMap<String, Vec<serde_json::Value>> {
    let mut out: HashMap<String, Vec<serde_json::Value>> = HashMap::new();

    match json_val {
        serde_json::Value::Object(mut obj) => {
            // If there is a `versions` key it may be an array of strings or objects
            if let Some(versions_val) = obj.remove("versions") {
                if let serde_json::Value::Array(arr) = versions_val {
                    for item in arr.into_iter() {
                        match &item {
                            serde_json::Value::String(s) => {
                                // string form: "20.2.16" -> assemble MC version "1.<first two>"
                                if let Some(prefix) = s
                                    .split('.')
                                    .take(2)
                                    .collect::<Vec<&str>>()
                                    .as_slice()
                                    .get(0..2)
                                {
                                    let mc = format!("1.{}.{}", prefix[0], prefix[1]);
                                    out.entry(mc)
                                        .or_default()
                                        .push(serde_json::Value::String(s.clone()));
                                }
                            }
                            serde_json::Value::Object(_) => {
                                // If this object carries an explicit MC version, use it. Otherwise try to compute.
                                let mc = item
                                    .get("mc_version")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                                    .or_else(|| {
                                        // try artifact_version like "1.20.2-20.2.16"
                                        item.get("artifact_version")
                                            .and_then(|v| v.as_str())
                                            .and_then(|s| s.split('-').next())
                                            .map(|s| s.to_string())
                                    })
                                    .or_else(|| {
                                        // try neo version field
                                        item.get("version")
                                            .or_else(|| item.get("neo_version"))
                                            .and_then(|v| v.as_str())
                                            .and_then(|s| {
                                                let parts: Vec<&str> =
                                                    s.split('.').take(2).collect();
                                                if parts.len() == 2 {
                                                    Some(format!("1.{}.{}", parts[0], parts[1]))
                                                } else {
                                                    None
                                                }
                                            })
                                    });

                                if let Some(mc_version) = mc {
                                    out.entry(mc_version).or_default().push(item.clone());
                                }
                            }
                            _ => {}
                        }
                    }
                }
            } else {
                // No "versions" key - attempt to interpret available keys or treat as single object
                // If it's a flat object with a version field, attempt to extract
                if let Some(_) = obj.get("version") {
                    // treat as single release
                    let item = serde_json::Value::Object(obj);
                    if let Some(mc) = item
                        .get("mc_version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                    {
                        out.entry(mc).or_default().push(item);
                    }
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.into_iter() {
                match &item {
                    serde_json::Value::String(s) => {
                        if let Some(parts) = s
                            .split('.')
                            .take(2)
                            .collect::<Vec<&str>>()
                            .as_slice()
                            .get(0..2)
                        {
                            let mc = format!("1.{}.{}", parts[0], parts[1]);
                            out.entry(mc)
                                .or_default()
                                .push(serde_json::Value::String(s.clone()));
                        }
                    }
                    serde_json::Value::Object(_) => {
                        let mc = item
                            .get("mc_version")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| {
                                item.get("artifact_version")
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.split('-').next())
                                    .map(|s| s.to_string())
                            })
                            .or_else(|| {
                                item.get("version")
                                    .or_else(|| item.get("neo_version"))
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| {
                                        let parts: Vec<&str> = s.split('.').take(2).collect();
                                        if parts.len() == 2 {
                                            Some(format!("1.{}.{}", parts[0], parts[1]))
                                        } else {
                                            None
                                        }
                                    })
                            });

                        if let Some(mc_version) = mc {
                            out.entry(mc_version).or_default().push(item.clone());
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    out
}

fn process_neoforge_api_versions(
    loader_name: &str,
    api_index: &HashMap<String, Vec<serde_json::Value>>,
    game_versions: &mut Vec<GameVersionMetadata>,
) {
    let loader_type = match loader_name {
        "NeoForge" => ModloaderType::NeoForge,
        _ => return,
    };

    for (mc_version, list) in api_index.iter() {
        if let Some(game_ver) = game_versions.iter_mut().find(|v| &v.id == mc_version) {
            let mut loader_info: HashMap<String, LoaderVersionInfo> = game_ver
                .loaders
                .get(&loader_type)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|l| (l.version.clone(), l))
                .collect();

            for entry in list.iter() {
                // Accept either String entries ("20.2.16") or Object entries
                let neo_version_opt = match entry {
                    serde_json::Value::String(s) => Some(s.clone()),
                    serde_json::Value::Object(map) => {
                        // try several possible fields
                        map.get("version")
                            .or_else(|| map.get("neo_version"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| {
                                map.get("artifact_version")
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.split('-').last().map(|s| s.to_string()))
                            })
                    }
                    _ => None,
                };

                if let Some(neo_version) = neo_version_opt {
                    // TODO: Persist metadata fields like artifact_url/published_at into LoaderVersionInfo.metadata in the future
                    loader_info.insert(
                        neo_version.clone(),
                        LoaderVersionInfo {
                            version: neo_version.clone(),
                            stable: false, // be conservative; NeoForge API might provide a more accurate field later
                            metadata: None,
                        },
                    );
                }
            }

            if !loader_info.is_empty() {
                let loader_list: Vec<LoaderVersionInfo> = loader_info.into_values().collect();
                log::info!(
                    "{}: {} - {} loaders (api)",
                    loader_name,
                    mc_version,
                    loader_list.len()
                );
                game_ver.loaders.insert(loader_type.clone(), loader_list);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mk_forge_xml(versions: Vec<&str>) -> ForgeVersionsXml {
        ForgeVersionsXml {
            versioning: ForgeVersioning {
                versions: ForgeVersionList {
                    version: versions.into_iter().map(|s| s.to_string()).collect(),
                },
            },
        }
    }

    #[test]
    fn test_process_forge_versions_for_forge_style() {
        let mut game_versions = vec![GameVersionMetadata {
            id: "1.20.2".to_string(),
            version_type: "release".to_string(),
            release_time: Utc::now(),
            stable: true,
            loaders: HashMap::new(),
        }];
        let xml = mk_forge_xml(vec!["1.20.2-47.2.0".into()]);
        process_forge_versions("Forge", &xml, &mut game_versions);

        let loaders = &game_versions[0].loaders;
        assert!(loaders.contains_key(&ModloaderType::Forge));
        let list = loaders.get(&ModloaderType::Forge).unwrap();
        assert!(list.iter().any(|l| l.version == "47.2.0"));
    }

    #[test]
    fn test_process_forge_versions_for_neoforge_style() {
        let mut game_versions = vec![GameVersionMetadata {
            id: "1.20.2".to_string(),
            version_type: "release".to_string(),
            release_time: Utc::now(),
            stable: true,
            loaders: HashMap::new(),
        }];
        // Nexus-style maven entries commonly look like "1.20.2-20.2.16" so
        // we simulate that here to match the starts_with(&version.id) filter.
        let xml = mk_forge_xml(vec!["1.20.2-20.2.16".into(), "1.20.2-20.2.17".into()]);
        process_forge_versions("NeoForge", &xml, &mut game_versions);

        let loaders = &game_versions[0].loaders;
        assert!(loaders.contains_key(&ModloaderType::NeoForge));
        let list = loaders.get(&ModloaderType::NeoForge).unwrap();
        assert!(list.iter().any(|l| l.version == "20.2.16"));
        assert!(list.iter().any(|l| l.version == "20.2.17"));
    }

    #[test]
    fn test_normalize_grouped_json() {
        // grouped JSON with strings and objects
        let raw = json!({
            "versions": [
                "20.2.16",
                {"version": "20.2.17", "mc_version": "1.20.2", "artifact_version": "1.20.2-20.2.17"}
            ]
        });

        let map = normalize_neoforge_json(raw);
        assert!(map.contains_key("1.20.2"));
        let vec = map.get("1.20.2").unwrap();
        // One entry is a string, one is an object
        assert_eq!(vec.len(), 2);
        assert!(vec.iter().any(|v| v.is_string()));
    }

    #[test]
    fn test_normalize_flat_array() {
        // flat array containing strings and objects
        let raw = json!([
            "20.2.16",
            {"version":"20.2.18","artifact_version":"1.20.2-20.2.18"}
        ]);

        let map = normalize_neoforge_json(raw);
        assert!(map.contains_key("1.20.2"));
        let vec = map.get("1.20.2").unwrap();
        assert_eq!(vec.len(), 2);
    }

    #[test]
    fn test_process_neoforge_api_versions_exact_mc_match() {
        let mut game_versions = vec![GameVersionMetadata {
            id: "1.20.2".to_string(),
            version_type: "release".to_string(),
            release_time: Utc::now(),
            stable: true,
            loaders: HashMap::new(),
        }];

        let mut map: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        map.insert("1.20.2".to_string(), vec![json!("20.2.16")]);

        process_neoforge_api_versions("NeoForge", &map, &mut game_versions);

        let loaders = &game_versions[0].loaders;
        assert!(loaders.contains_key(&ModloaderType::NeoForge));
        let list = loaders.get(&ModloaderType::NeoForge).unwrap();
        assert!(list.iter().any(|l| l.version == "20.2.16"));
    }

    #[test]
    fn test_process_neoforge_api_versions_artifact_version_match() {
        let mut game_versions = vec![GameVersionMetadata {
            id: "1.20.2".to_string(),
            version_type: "release".to_string(),
            release_time: Utc::now(),
            stable: true,
            loaders: HashMap::new(),
        }];

        let mut map: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        // entry object doesn't have mc_version key — only artifact_version
        map.insert(
            "1.20.2".to_string(),
            vec![json!({"artifact_version":"1.20.2-20.2.19"})],
        );

        process_neoforge_api_versions("NeoForge", &map, &mut game_versions);

        let loaders = &game_versions[0].loaders;
        assert!(loaders.contains_key(&ModloaderType::NeoForge));
        let list = loaders.get(&ModloaderType::NeoForge).unwrap();
        assert!(list.iter().any(|l| l.version == "20.2.19"));
    }
}

/// Add Forge-style modloader (Forge or NeoForge)
async fn add_forge_modloader(
    client: &reqwest::Client,
    loader_name: &str,
    repo: &str,
    game_versions: &mut Vec<GameVersionMetadata>,
) {
    let xml = match client.get(format!("{}/maven-metadata.xml", repo)).send().await {
        Ok(result) => match result.text().await {
            Ok(text) => text,
            Err(e) => {
                log::error!("Error reading {} XML response: {}", loader_name, e);
                return;
            }
        },
        Err(e) => {
            log::error!("Error requesting {} versions: {}", loader_name, e);
            return;
        }
    };

    let forge_xml: ForgeVersionsXml = match serde_xml_rs::from_str(&xml) {
        Ok(r) => r,
        Err(e) => {
            log::error!("Error parsing {} XML: {}", loader_name, e);
            return;
        }
    };

    let _loader_type = match loader_name {
        "Forge" => ModloaderType::Forge,
        "NeoForge" => ModloaderType::NeoForge,
        _ => return,
    };

    log::info!(
        "{}: Processing {} total versions",
        loader_name,
        forge_xml.versioning.versions.version.len()
    );

    process_forge_versions(loader_name, &forge_xml, game_versions);

    log::info!("{}: Complete", loader_name);
}

/// API-first NeoForge fetcher (with API fallback then maven fallback)
async fn add_neoforge_api_then_maven(
    client: &reqwest::Client,
    loader_name: &str,
    api_base: &str,
    fallback_api_base: &str,
    maven_repo: &str,
    game_versions: &mut Vec<GameVersionMetadata>,
) {
    // Try primary API
    match fetch_neoforge_api_index(client, api_base, NEOFORGE_GAV).await {
        Ok(index) if !index.is_empty() => {
            log::info!(
                "{}: Using API (primary): {} entries",
                loader_name,
                index.iter().map(|(_, v)| v.len()).sum::<usize>()
            );
            process_neoforge_api_versions(loader_name, &index, game_versions);
            return;
        }
        Ok(_) => {
            log::warn!(
                "{}: API returned no entries, trying fallback API...",
                loader_name
            );
        }
        Err(e) => {
            log::warn!(
                "{}: API request failed (primary): {} — trying fallback API...",
                loader_name,
                e
            );
        }
    }

    // Try fallback API
    match fetch_neoforge_api_index(client, fallback_api_base, NEOFORGE_GAV).await {
        Ok(index) if !index.is_empty() => {
            log::info!(
                "{}: Using API (fallback): {} entries",
                loader_name,
                index.iter().map(|(_, v)| v.len()).sum::<usize>()
            );
            process_neoforge_api_versions(loader_name, &index, game_versions);
            return;
        }
        Ok(_) => log::warn!(
            "{}: fallback API returned no entries; falling back to maven XML",
            loader_name
        ),
        Err(e) => log::warn!(
            "{}: fallback API request failed: {} — falling back to maven XML",
            loader_name,
            e
        ),
    }

    // Last resort: parse maven metadata XML like Forge does
    log::info!("{}: Falling back to maven XML parsing", loader_name);
    add_forge_modloader(client, loader_name, maven_repo, game_versions).await;
}
