use crate::models::instance::{Instance, NewInstance};
use crate::models::java::GlobalJavaPath;
use crate::models::resource::SourcePlatform;
use crate::schema::global_java_paths::dsl::{global_java_paths, major_version};
use crate::schema::vesta::instance::dsl::*;
use crate::tasks::installers::modpack::InstallModpackTask;
use crate::tasks::manager::TaskManager;
use crate::tasks::modpack_export::ModpackExportTask;
use crate::utils::config::get_app_config;
use crate::utils::db::{get_config_conn, get_vesta_conn};
use crate::utils::db_manager::get_app_config_dir;
use crate::utils::hash::{calculate_curseforge_fingerprint, calculate_murmur2_raw, calculate_sha1};
use crate::utils::instance_helpers::{compute_unique_name, compute_unique_slug};
use crate::utils::url::normalize_url;
use anyhow::Result;
use diesel::prelude::*;
use piston_lib::game::modpack::exporter::{ExportEntry, ExportSpec};
use piston_lib::game::modpack::parser::get_modpack_metadata;
use piston_lib::game::modpack::types::ModpackFormat;
use serde_json;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, State};
use tempfile::NamedTempFile;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInfo {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub minecraft_version: String,
    pub modloader: String,
    pub modloader_version: Option<String>,
    pub mod_count: usize,
    pub recommended_ram_mb: Option<u32>,
    pub format: String,
    pub modpack_id: Option<String>,
    pub modpack_version_id: Option<String>,
    pub modpack_platform: Option<String>,
    pub full_metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
}

#[command]
pub async fn get_modpack_info(
    path: String,
    target_id: Option<String>,
    target_platform: Option<String>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
    nm: State<'_, crate::utils::network::NetworkManager>,
) -> Result<ModpackInfo, String> {
    let start = std::time::Instant::now();
    let res = (async {
        let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err("File does not exist".to_string());
    }

    let metadata =
        get_modpack_metadata(&path_buf).map_err(|e| format!("Failed to parse modpack: {}", e))?;

    log::info!("[get_modpack_info] Parsed metadata: name={}, version={}, mc={}, loader={:?}, loader_ver={:?}", 
        metadata.name, metadata.version, metadata.minecraft_version, metadata.modloader_type, metadata.modloader_version);

    let mut info = ModpackInfo {
        name: metadata.name.clone(),
        version: metadata.version.clone(),
        author: metadata.author.clone(),
        description: metadata.description.clone(),
        icon_url: None,
        minecraft_version: metadata.minecraft_version.clone(),
        modloader: metadata.modloader_type.clone(),
        modloader_version: metadata.modloader_version.clone(),
        mod_count: metadata.mods.len(),
        recommended_ram_mb: metadata.recommended_ram_mb,
        format: format!("{:?}", metadata.format),
        modpack_id: target_id.clone(),
        modpack_version_id: Some(metadata.version.clone()),
        modpack_platform: target_platform.clone(),
        full_metadata: Some(metadata.clone()),
    };

    // If we already know the platform and ID, we can skip the heavy identification logic
    if let (Some(tid), Some(tplatform)) = (&target_id, &target_platform) {
        log::info!(
            "[get_modpack_info] Using provided platform info, skipping fingerprinting: {}/{}",
            tplatform,
            tid
        );

        // However, we still might want to fetch project details (icon, summary) if they are missing
        let platform_enum = match tplatform.to_lowercase().as_str() {
            "curseforge" => Some(SourcePlatform::CurseForge),
            "modrinth" => Some(SourcePlatform::Modrinth),
            _ => None,
        };

        if let Some(p) = platform_enum {
            if let Ok(proj) = resource_manager.get_project(p, tid).await {
                if info.icon_url.is_none() {
                    info.icon_url = proj.icon_url;
                }
                if info.description.is_none() {
                    info.description = Some(proj.summary);
                }
            }
        }
        return Ok(info);
    }

    // Try to link to a platform by searching for the name
    use crate::models::resource::{ResourceType, SearchQuery, SourcePlatform};

    let platforms = match metadata.format {
        ModpackFormat::Modrinth => vec![SourcePlatform::Modrinth, SourcePlatform::CurseForge],
        ModpackFormat::CurseForge => vec![SourcePlatform::CurseForge, SourcePlatform::Modrinth],
    };

    // 1. Try Exact Hash Lookup (Fingerprinting)
    // This is the most accurate way to detect the project
    log::info!("[get_modpack_info] Attempting fingerprint lookup for modpack identification...");
    for platform in &platforms {
        let result = match platform {
            SourcePlatform::CurseForge => {
                let mut found = None;
                // Try standard CF fingerprint (skipped whitespace)
                if let Ok(fp) = calculate_curseforge_fingerprint(&path_buf) {
                    log::info!(
                        "[get_modpack_info] CurseForge fingerprint calculated: {}",
                        fp
                    );
                    found = resource_manager
                        .get_by_hash(*platform, &fp.to_string())
                        .await
                        .ok();
                }

                // Try raw Murmur2 if first one fails
                if found.is_none() {
                    if let Ok(raw_fp) = calculate_murmur2_raw(&path_buf) {
                        log::info!(
                            "[get_modpack_info] CurseForge RAW Murmur2 calculated: {}",
                            raw_fp
                        );
                        found = resource_manager
                            .get_by_hash(*platform, &raw_fp.to_string())
                            .await
                            .ok();
                    }
                }
                found
            }
            SourcePlatform::Modrinth => {
                if let Ok(hash) = calculate_sha1(&path_buf) {
                    log::info!("[get_modpack_info] Modrinth SHA1 calculated: {}", hash);
                    resource_manager.get_by_hash(*platform, &hash).await.ok()
                } else {
                    log::warn!("[get_modpack_info] Failed to calculate Modrinth SHA1");
                    None
                }
            }
        };

        if let Some((proj, ver)) = result {
            log::info!(
                "[get_modpack_info] SUCCESS: Exact match found on {:?}! Project: '{}' ({}), Version: '{}' ({})",
                platform,
                proj.name,
                proj.id,
                ver.version_number,
                ver.id
            );
            info.modpack_id = Some(proj.id);
            info.modpack_platform = Some(format!("{:?}", platform).to_lowercase());
            info.modpack_version_id = Some(ver.id);
            info.version = ver.version_number;
            if info.icon_url.is_none() {
                info.icon_url = proj.icon_url;
            }
            if info.description.is_none() {
                info.description = Some(proj.summary);
            }
            return Ok(info);
        }
    }

    // Only attempt fuzzy search matching if we were unable to find an exact hash match
    // and we really need to identify the project (e.g. for a browser install that somehow failed hash check).
    // For manual local uploads, we should be strictly hash-based to avoid false positives.
    if target_id.is_none() {
        log::info!("[get_modpack_info] No hash match found. Skipping fuzzy identification to avoid false positives on custom packs.");
        return Ok(info);
    }

    log::info!("[get_modpack_info] No hash match found. Falling back to search matching...");

    // 2. Fallback to Search/Fuzzy Match if hash lookup yields nothing
    for platform in platforms {
        log::info!(
            "[get_modpack_info] Searching for modpack '{}' on {:?}",
            info.name,
            platform
        );
        let query = SearchQuery {
            text: Some(info.name.clone()),
            resource_type: ResourceType::Modpack,
            limit: 20,
            ..Default::default()
        };

        if let Ok(response) = resource_manager.search(platform, query).await {
            log::info!(
                "[get_modpack_info] Found {} potential matches on {:?}",
                response.hits.len(),
                platform
            );

            let mut best_hit = None;
            let mut max_score = -1000;

            for hit in response.hits {
                let hit_name_low = hit.name.to_lowercase();
                let info_name_low = info.name.to_lowercase();

                let mut score = 0;

                // 1. Exact Name Match (Huge Bonus)
                if hit_name_low == info_name_low {
                    score += 1000;
                }

                // 2. Author Match
                let author_match = if let Some(ref author) = info.author {
                    hit.author.to_lowercase() == author.to_lowercase()
                } else {
                    false
                };

                if author_match {
                    score += 500;
                }

                // 3. Substring match
                if hit_name_low.contains(&info_name_low) || info_name_low.contains(&hit_name_low) {
                    score += 100;

                    // Length similarity bonus
                    let len_diff = (hit_name_low.len() as i32 - info_name_low.len() as i32).abs();
                    score += (30 - len_diff).max(0);
                }

                // 4. Variant Penalties (The "To the Sky" problem)
                // If hit has specialized keywords but manifest doesn't, penalize heavily.
                let variant_keywords = ["sky", "block", "expert", "lite", "hardcore"];
                for kw in variant_keywords {
                    if hit_name_low.contains(kw) && !info_name_low.contains(kw) {
                        score -= 400;
                    }
                }

                log::debug!(
                    "[get_modpack_info] [{:?}] Score {} for hit '{}' by '{}' ({})",
                    platform,
                    score,
                    hit.name,
                    hit.author,
                    hit.id
                );

                if score > max_score {
                    max_score = score;
                    best_hit = Some(hit);
                }
            }

            if let Some(hit) = best_hit {
                // Require a minimum confidence score or exact name match
                if max_score < 400 && !hit.name.to_lowercase().eq(&info.name.to_lowercase()) {
                    log::warn!("[get_modpack_info] Best match '{}' has low confidence score ({}), skipping", hit.name, max_score);
                    continue;
                }

                log::info!(
                    "[get_modpack_info] Picked best match: '{}' ({}) with score {}",
                    hit.name,
                    hit.id,
                    max_score
                );

                info.modpack_id = Some(hit.id.clone());
                info.modpack_platform = Some(format!("{:?}", platform).to_lowercase());
                if info.icon_url.is_none() {
                    info.icon_url = hit.icon_url;
                }
                if info.description.is_none() {
                    info.description = Some(hit.summary);
                }

                log::info!(
                    "[get_modpack_info] Searching for version '{}' on platform {:?} (ID: {})",
                    info.version,
                    platform,
                    hit.id
                );

                // Try to find matching version ID
                if let Ok(versions) = resource_manager
                    .get_versions(
                        platform,
                        &hit.id,
                        false,
                        Some(&info.minecraft_version),
                        Some(&info.modloader),
                    )
                    .await
                {
                    let search_v = info.version.to_lowercase();

                    if let Some(v) = versions.into_iter().find(|v| {
                        let v_num = v.version_number.to_lowercase();
                        // 1. Exact match
                        if v_num == search_v {
                            return true;
                        }
                        // 2. Contains (be careful with overlaps, but good for "Release x.y")
                        if v_num.contains(&search_v) {
                            // verify it's a "clean" submatch to avoid 5.4 matching 1.5.4
                            let idx = v_num.find(&search_v).unwrap();
                            let prev_char = if idx > 0 {
                                v_num.as_bytes()[idx - 1] as char
                            } else {
                                ' '
                            };
                            let next_char = if idx + search_v.len() < v_num.len() {
                                v_num.as_bytes()[idx + search_v.len()] as char
                            } else {
                                ' '
                            };

                            if !prev_char.is_alphanumeric() && !next_char.is_alphanumeric() {
                                return true;
                            }
                        }
                        false
                    }) {
                        info.modpack_version_id = Some(v.id);
                        log::info!(
                            "[get_modpack_info] Found likely version match on {:?}: {}",
                            platform,
                            info.modpack_version_id.as_ref().unwrap()
                        );
                    } else {
                        log::info!("[get_modpack_info] No platform version match found for '{}'. Using manifest version.", info.version);
                    }
                }

                log::info!(
                    "[get_modpack_info] Linked modpack to {:?} project: {}",
                    platform,
                    hit.id
                );
                break;
            }
        }
    }
    Ok(info)
}).await;

    nm.report_request_result(start.elapsed().as_millis(), res.is_ok());

    let info_val = res.map_err(|e| e.to_string())?;
    Ok(info_val)
}

#[command]
pub async fn get_system_memory_mb() -> Result<u64, String> {
    Ok(piston_lib::utils::hardware::get_total_memory_mb())
}

#[command]
pub async fn get_hardware_info() -> Result<u64, String> {
    Ok(piston_lib::utils::hardware::get_total_memory_mb())
}

async fn resolve_modpack_resource(client: &reqwest::Client, url: &str) -> (String, Option<String>) {
    let mut final_url = url.to_string();
    let mut icon_url = None;

    // Modrinth Support
    if url.contains("modrinth.com/") {
        let mut target_version_id = None;
        let mut slug = None;

        // 1. Try to extract Version ID or Slug from various Modrinth URL patterns
        if url.contains("api.modrinth.com/v2/version/") {
            target_version_id = url
                .split("api.modrinth.com/v2/version/")
                .nth(1)
                .and_then(|s| s.split('?').next())
                .map(|s| s.to_string());
        } else if url.contains("cdn.modrinth.com/data/") {
            target_version_id = url
                .split("/versions/")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());
            log::info!(
                "[resolve_modpack_resource] Detected direct CDN link, extracted version ID: {:?}",
                target_version_id
            );
        } else {
            let pattern = if url.contains("modrinth.com/modpack/") {
                "modrinth.com/modpack/"
            } else {
                "modrinth.com/project/"
            };
            slug = url
                .split(pattern)
                .nth(1)
                .and_then(|s| s.split('?').next())
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());

            if url.contains("/version/") {
                target_version_id = url
                    .split("/version/")
                    .nth(1)
                    .and_then(|s| s.split('?').next())
                    .map(|s| s.to_string());
            } else if let Some(q) = url.split('?').nth(1) {
                target_version_id = q
                    .split('&')
                    .find(|p| p.starts_with("version="))
                    .map(|p| p.replace("version=", ""));
            }
        }

        // 2. Obtain Version Data
        let version_json = if let Some(vid) = target_version_id {
            let ver_api_url = format!("https://api.modrinth.com/v2/version/{}", vid);
            client.get(&ver_api_url).send().await.ok().and_then(|r| {
                if r.status().is_success() {
                    Some(r)
                } else {
                    None
                }
            })
        } else if let Some(slug_str) = slug {
            let versions_url = format!("https://api.modrinth.com/v2/project/{}/version", slug_str);
            client.get(&versions_url).send().await.ok().and_then(|r| {
                if r.status().is_success() {
                    Some(r)
                } else {
                    None
                }
            })
        } else {
            None
        };

        if let Some(resp) = version_json {
            if let Ok(json_val) = resp.json::<serde_json::Value>().await {
                // Handle both single version response (from /version/{id}) and array response (from /project/{slug}/version)
                let version = if json_val.is_array() {
                    json_val.as_array().and_then(|arr| arr.first().cloned())
                } else {
                    Some(json_val)
                };

                if let Some(v) = version {
                    // Try to get icon_url if we don't have it (needed for direct version links)
                    if icon_url.is_none() {
                        if let Some(project_id) = v["project_id"].as_str() {
                            let project_url =
                                format!("https://api.modrinth.com/v2/project/{}", project_id);
                            if let Ok(p_resp) = client.get(&project_url).send().await {
                                if let Ok(p_json) = p_resp.json::<serde_json::Value>().await {
                                    icon_url = p_json["icon_url"].as_str().map(|s| s.to_string());
                                }
                            }
                        }
                    }

                    if let Some(files) = v["files"].as_array() {
                        log::debug!(
                            "[resolve_modpack_resource] Version {} has {} files",
                            v["id"].as_str().unwrap_or("?"),
                            files.len()
                        );

                        let filtered: Vec<&serde_json::Value> = files
                            .iter()
                            .filter(|f| {
                                let fname = f["filename"].as_str().unwrap_or("").to_lowercase();
                                !fname.contains("cosign-bundle")
                                    && !fname.ends_with(".asc")
                                    && !fname.ends_with(".sha1")
                                    && !fname.ends_with(".sha512")
                            })
                            .collect();

                        let selected = filtered
                            .iter()
                            .find(|f| f["primary"].as_bool() == Some(true))
                            .or_else(|| filtered.first())
                            .copied();

                        if let Some(file) = selected {
                            if let Some(u) = file["url"].as_str() {
                                final_url = u.to_string();
                                log::info!(
                                    "[resolve_modpack_resource] Selected file: {} (primary: {:?})",
                                    file["filename"].as_str().unwrap_or("?"),
                                    file["primary"].as_bool()
                                );
                            }
                        }
                    }
                }
            }
        }
    } else if url.contains("curseforge.com/") {
        // Attempt to find /files/{id}
        if let Some(file_id_str) = url
            .split("/files/")
            .nth(1)
            .and_then(|s| s.split('?').next())
        {
            if let Ok(file_id) = file_id_str.parse::<u32>() {
                // Typical CurseForge CDN pattern: https://edge.forgecdn.net/files/ID/STR/FILE.zip
                // But since we don't know the filename, it's safer to just return our URL and hope the redirect works,
                // or use the API if we had a key here.
                // For now, we just ensure we have the cleanest possible direct link URL.
                log::info!(
                    "[resolve_modpack_resource] Detected CurseForge file ID: {}",
                    file_id
                );
            }
        }
    }

    log::info!(
        "[resolve_modpack_resource] Final result for {}: {}",
        url,
        final_url
    );
    (final_url, icon_url)
}

#[command]
pub async fn get_modpack_info_from_url(
    url: String,
    target_id: Option<String>,
    target_platform: Option<String>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
    nm: State<'_, crate::utils::network::NetworkManager>,
) -> Result<ModpackInfo, String> {
    let start = std::time::Instant::now();
    let res = (async {
        log::info!(
            "[get_modpack_info_from_url] Fetching info for: {} (id override: {:?})",
            url,
            target_id
        );
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Optimization: Try to get metadata from Modrinth API first to avoid downloading large ZIPs
    if url.contains("modrinth.com/") {
        let mut version_id = None;
        let mut slug = None;

        if url.contains("api.modrinth.com/v2/version/") {
            version_id = url
                .split("v2/version/")
                .nth(1)
                .and_then(|s| s.split('?').next())
                .map(|s| s.to_string());
        } else if url.contains("cdn.modrinth.com/data/") {
            version_id = url
                .split("/versions/")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());
        } else {
            let pattern = if url.contains("modrinth.com/modpack/") {
                "modrinth.com/modpack/"
            } else {
                "modrinth.com/project/"
            };
            slug = url
                .split(pattern)
                .nth(1)
                .and_then(|s| s.split('?').next())
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string());

            if url.contains("/version/") {
                version_id = url
                    .split("/version/")
                    .nth(1)
                    .and_then(|s| s.split('?').next())
                    .map(|s| s.to_string());
            } else if let Some(q) = url.split('?').nth(1) {
                version_id = q
                    .split('&')
                    .find(|p| p.starts_with("version="))
                    .map(|p| p.replace("version=", ""));
            }
        }

        if version_id.is_some() || slug.is_some() {
            let version_obj = if let Some(vid) = version_id {
                let v_url = format!("https://api.modrinth.com/v2/version/{}", vid);
                if let Ok(r) = client.get(&v_url).send().await {
                    r.json::<serde_json::Value>().await.ok()
                } else {
                    None
                }
            } else if let Some(s) = slug {
                let v_url = format!("https://api.modrinth.com/v2/project/{}/version", s);
                if let Ok(r) = client.get(&v_url).send().await {
                    if let Ok(arr) = r.json::<Vec<serde_json::Value>>().await {
                        arr.first().cloned()
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(v) = version_obj {
                if let Some(pid) = v["project_id"].as_str() {
                    let p_url = format!("https://api.modrinth.com/v2/project/{}", pid);
                    if let Ok(p_resp) = client.get(&p_url).send().await {
                        if let Ok(p) = p_resp.json::<serde_json::Value>().await {
                            return Ok(ModpackInfo {
                                name: p["title"].as_str().unwrap_or("Unknown Modpack").to_string(),
                                description: Some(
                                    p["description"].as_str().unwrap_or("").to_string(),
                                ),
                                version: v["version_number"]
                                    .as_str()
                                    .unwrap_or("1.0.0")
                                    .to_string(),
                                icon_url: p["icon_url"].as_str().map(|s| s.to_string()),
                                author: None,
                                minecraft_version: v["game_versions"]
                                    .as_array()
                                    .and_then(|a| a.first())
                                    .and_then(|g| g.as_str())
                                    .unwrap_or("unknown")
                                    .to_string(),
                                modloader: v["loaders"]
                                    .as_array()
                                    .and_then(|a| a.first())
                                    .and_then(|l| l.as_str())
                                    .unwrap_or("fabric")
                                    .to_string(),
                                modloader_version: None,
                                mod_count: 0,
                                recommended_ram_mb: None,
                                format: "Modrinth".to_string(),
                                modpack_id: Some(pid.to_string()),
                                modpack_version_id: Some(
                                    v["id"].as_str().unwrap_or("").to_string(),
                                ),
                                modpack_platform: Some("modrinth".to_string()),
                                full_metadata: None,
                            });
                        }
                    }
                }
            }
        }
    } else if url.contains("curseforge.com/") {
        log::info!(
            "[get_modpack_info_from_url] Detected CurseForge URL: {}",
            url
        );

        let mut project_id = None;
        let mut version_id = None;

        // Determine resource type from URL
        let mut res_type = crate::models::resource::ResourceType::Modpack;
        if url.contains("/mc-mods/") {
            res_type = crate::models::resource::ResourceType::Mod;
        } else if url.contains("/texture-packs/") || url.contains("/resource-packs/") {
            res_type = crate::models::resource::ResourceType::ResourcePack;
        } else if url.contains("/shaders/") {
            res_type = crate::models::resource::ResourceType::Shader;
        } else if url.contains("/worlds/") {
            res_type = crate::models::resource::ResourceType::World;
        }

        // Extract IDs from URL if possible
        if let Some(vid_str) = url
            .split("/files/")
            .nth(1)
            .and_then(|s| s.split('?').next())
        {
            version_id = vid_str.parse::<i64>().ok();
        }

        // Extract slug more robustly from /minecraft/<class>/<slug>
        let slug = if let Some(parts) = url.split("curseforge.com/minecraft/").nth(1) {
            parts
                .split('/')
                .nth(1) // Skip class segment (e.g. "mc-mods")
                .and_then(|s| s.split('?').next())
                .and_then(|s| s.split('/').next())
                .map(|s| s.to_string())
        } else {
            None
        };

        if let Some(ref slug_str) = slug {
            log::info!(
                "[get_modpack_info_from_url] Search for slug: {} (type: {:?})",
                slug_str,
                res_type
            );
            // Search for project by slug
            let query = crate::models::resource::SearchQuery {
                text: Some(slug_str.clone()),
                resource_type: res_type,
                limit: 10,
                ..Default::default()
            };

            if let Ok(res) = resource_manager
                .search(SourcePlatform::CurseForge, query)
                .await
            {
                let slug_lower = slug_str.to_lowercase();
                if let Some(hit) = res.hits.iter().find(|h| {
                    let web_lower = h.web_url.to_lowercase();
                    // Normalize and compare final path segment
                    let normalized_web = normalize_url(&web_lower);
                    if let Some(pos) = normalized_web.rfind('/') {
                        let last = &normalized_web[pos + 1..];
                        return last == slug_lower || last.ends_with(&format!("-{}", slug_lower));
                    }
                    normalized_web == slug_lower || normalized_web.ends_with(&format!("-{}", slug_lower))
                })
                {
                    project_id = Some(hit.id.clone());
                    log::info!(
                        "[get_modpack_info_from_url] Found project match: {} ({})",
                        hit.name,
                        hit.id
                    );
                    if version_id.is_none() {
                        // Get latest version if not specified
                        if let Ok(versions) = resource_manager
                            .get_versions(SourcePlatform::CurseForge, &hit.id, false, None, None)
                            .await
                        {
                            if let Some(v) = versions.first() {
                                version_id = v.id.parse::<i64>().ok();
                            }
                        }
                    }
                } else {
                    log::warn!("[get_modpack_info_from_url] No project match found in search results for slug '{}'", slug_str);
                    for h in &res.hits {
                        log::debug!("  Hit: {} (link: {})", h.name, h.web_url);
                    }
                }
            }
        }

        if let (Some(pid), Some(vid)) = (project_id, version_id) {
            log::info!(
                "[get_modpack_info_from_url] Identified as PID={}, VID={}",
                pid,
                vid
            );
            if let Ok(proj) = resource_manager
                .get_project(SourcePlatform::CurseForge, &pid)
                .await
            {
                if let Ok(ver) = resource_manager
                    .get_version(SourcePlatform::CurseForge, &pid, &vid.to_string())
                    .await
                {
                    log::info!("[get_modpack_info_from_url] Success! Returning ModpackInfo for '{}' version '{}'", proj.name, ver.version_number);
                    return Ok(ModpackInfo {
                        name: proj.name,
                        description: Some(proj.summary),
                        version: ver.version_number,
                        icon_url: proj.icon_url,
                        author: Some(proj.author),
                        minecraft_version: ver.game_versions.first().cloned().unwrap_or_default(),
                        modloader: ver
                            .loaders
                            .first()
                            .cloned()
                            .unwrap_or_default()
                            .to_lowercase(),
                        modloader_version: None,
                        mod_count: 0,
                        recommended_ram_mb: None,
                        format: "CurseForge".to_string(),
                        modpack_id: Some(pid),
                        modpack_version_id: Some(vid.to_string()),
                        modpack_platform: Some("curseforge".to_string()),
                        full_metadata: None,
                    });
                } else {
                    log::error!(
                        "[get_modpack_info_from_url] Failed to fetch version {} for project {}",
                        vid,
                        pid
                    );
                }
            } else {
                log::error!(
                    "[get_modpack_info_from_url] Failed to fetch project {}",
                    pid
                );
            }
        }
    }

    // Fallback: Download and parse physical ZIP
    let (final_url, icon_url) = resolve_modpack_resource(&client, &url).await;
    log::info!(
        "[get_modpack_info_from_url] Falling back to ZIP download. Resolved: {} -> {}",
        url,
        final_url
    );

    let response = client
        .get(&final_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let (mut temp_file, temp_path) = NamedTempFile::new()
        .map_err(|e| e.to_string())?
        .into_parts();

    // Stream body using async chunks to avoid blocking
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut downloaded = 0;
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        std::io::Write::write_all(&mut temp_file, &chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len();
        if downloaded % (1024 * 1024) == 0 {
            log::debug!(
                "[get_modpack_info_from_url] Downloaded {} MB...",
                downloaded / (1024 * 1024)
            );
        }
    }

    log::info!(
        "[get_modpack_info_from_url] Download complete ({} bytes). Parsing ZIP...",
        downloaded
    );
    let mut info = get_modpack_info(
        temp_path.to_string_lossy().to_string(),
        target_id,
        target_platform,
        resource_manager,
        nm.clone(),
    )
    .await?;
    if icon_url.is_some() {
        info.icon_url = icon_url;
    }

    Ok(info)
}).await;

    nm.report_request_result(start.elapsed().as_millis(), res.is_ok());
    res
}

fn get_recommended_java_version(mc_version: &str) -> i32 {
    let parts: Vec<&str> = mc_version.split('.').collect();
    if parts.len() >= 2 {
        if let Ok(minor) = parts[1].parse::<i32>() {
            if minor >= 20 {
                // Check for 1.20.5+
                if parts.len() >= 3 {
                    if let Ok(patch) = parts[2].parse::<i32>() {
                        if minor == 20 && patch >= 5 {
                            return 21;
                        }
                    }
                }
                if minor > 20 {
                    return 21;
                }
                return 17;
            }
            if minor >= 18 {
                return 17;
            }
            if minor >= 17 {
                return 16;
            }
        }
    }
    8
}

async fn prepare_instance(
    conn: &mut SqliteConnection,
    instance_data: &Instance,
) -> Result<NewInstance, String> {
    log::info!(
        "[prepare_instance] Incoming instance data: name={}, mc={}, pack_id={:?}, version_id={:?}",
        instance_data.name,
        instance_data.minecraft_version,
        instance_data.modpack_id,
        instance_data.modpack_version_id
    );
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Determine instances root
    let config = get_app_config().map_err(|e| e.to_string())?;
    let app_config_dir = get_app_config_dir().map_err(|e| e.to_string())?;

    let instances_root = if let Some(ref dir) = config.default_game_dir {
        if !dir.is_empty() && dir != "/" {
            PathBuf::from(dir)
        } else {
            app_config_dir.join("instances")
        }
    } else {
        app_config_dir.join("instances")
    };

    // 2. Load existing names/slugs for uniqueness
    let existing: Vec<(String, Option<String>)> = instance
        .select((name, game_directory))
        .load::<(String, Option<String>)>(conn)
        .map_err(|e| format!("DB Error: {}", e))?;

    let mut seen_names = std::collections::HashSet::new();
    let mut seen_slugs = std::collections::HashSet::new();

    for (existing_name, existing_gd) in existing {
        seen_names.insert(existing_name.to_lowercase());
        if let Some(gd) = existing_gd {
            if let Some(s) = Path::new(&gd).file_name().and_then(|f| f.to_str()) {
                seen_slugs.insert(s.to_string());
            }
        }
    }

    // 3. Compute unique name and slug
    let unique_name = compute_unique_name(&instance_data.name, &seen_names);
    let slug = compute_unique_slug(&unique_name, &seen_slugs, &instances_root);
    let gd_str = instances_root.join(&slug).to_string_lossy().to_string();

    // Ensure the game directory exists
    if let Err(e) = std::fs::create_dir_all(&gd_str) {
        log::error!("[prepare_instance] Failed to create game directory: {}", e);
    }

    let mut current_java_path = instance_data.java_path.clone();

    // If no Java path provided, try to find a recommended one from global config
    if current_java_path.is_none() {
        if let Ok(mut config_conn) = get_config_conn() {
            let reco_version = get_recommended_java_version(&instance_data.minecraft_version);
            let global_path = global_java_paths
                .filter(major_version.eq(reco_version))
                .first::<GlobalJavaPath>(&mut config_conn)
                .ok();

            if let Some(gp) = global_path {
                log::info!(
                    "[prepare_instance] Found recommended Java {} path: {}",
                    gp.major_version,
                    gp.path
                );
                current_java_path = Some(gp.path);
            } else {
                // Fallback to any Java version if the specific one isn't found?
                // Or just let it be None and have the installer download Zulu
                log::info!(
                    "[prepare_instance] No recommended Java {} found in global config",
                    reco_version
                );
            }
        }
    }

    // Handle icon downloading if we have a URL but no data
    let mut final_icon_data = instance_data.icon_data.clone();
    let mut final_icon_path = instance_data.icon_path.clone();

    if let Some(ref path) = final_icon_path {
        if path.starts_with("data:image/") {
            log::info!("[prepare_instance] Converting base64 icon to binary data");
            if let Some(base64_part) = path.split(",").collect::<Vec<&str>>().get(1) {
                use base64::{engine::general_purpose, Engine as _};
                if let Ok(bytes) = general_purpose::STANDARD.decode(base64_part) {
                    final_icon_data = Some(bytes);
                    final_icon_path = Some("internal://icon".to_string());
                }
            }
        }
    }

    if instance_data.modpack_icon_url.is_some() && final_icon_data.is_none() {
        if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(
            instance_data.modpack_icon_url.as_ref().unwrap(),
        )
        .await
        {
            log::info!(
                "[prepare_instance] Successfully downloaded icon for offline use ({} bytes)",
                bytes.len()
            );
            final_icon_data = Some(bytes);
        }
    }

    Ok(NewInstance {
        name: unique_name,
        minecraft_version: instance_data.minecraft_version.clone(),
        modloader: instance_data.modloader.clone(),
        modloader_version: instance_data.modloader_version.clone(),
        java_path: current_java_path,
        java_args: instance_data.java_args.clone(),
        game_directory: Some(gd_str),
        width: instance_data.width,
        height: instance_data.height,
        min_memory: instance_data.min_memory,
        max_memory: instance_data.max_memory,
        icon_path: final_icon_path,
        last_played: None,
        total_playtime_minutes: 0,
        created_at: Some(now.clone()),
        updated_at: Some(now),
        installation_status: Some("installing".to_string()),
        crashed: Some(false),
        crash_details: None,
        modpack_id: instance_data.modpack_id.clone(),
        modpack_version_id: instance_data.modpack_version_id.clone(),
        modpack_platform: instance_data.modpack_platform.clone(),
        modpack_icon_url: instance_data.modpack_icon_url.clone(),
        icon_data: final_icon_data,
        last_operation: Some("install".to_string()),
    })
}

#[command]
pub async fn install_modpack_from_zip(
    _app: AppHandle,
    zip_path: String,
    instance_data: Instance,
    metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
    task_manager: State<'_, TaskManager>,
) -> Result<i32, String> {
    log::info!(
        "[install_modpack_from_zip] Requested for: {}",
        instance_data.name
    );
    log::info!(
        "[install_modpack_from_zip] Data: MC={}, Loader={:?}, LoaderVersion={:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    let zip_path = PathBuf::from(zip_path);
    if !zip_path.exists() {
        return Err("Modpack ZIP does not exist".to_string());
    }

    let mut conn = get_vesta_conn().map_err(|e| format!("DB Error: {}", e))?;

    let new_inst = prepare_instance(&mut conn, &instance_data).await?;

    diesel::insert_into(instance)
        .values(&new_inst)
        .execute(&mut conn)
        .map_err(|e| format!("Failed to save instance: {}", e))?;

    let saved_instance = instance
        .order(id.desc())
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to fetch saved instance: {}", e))?;

    // Emit created event so UI home page updates immediately
    use tauri::Emitter;
    let _ = _app.emit("core://instance-created", &saved_instance);

    // 2. Queue Task
    use crate::tasks::installers::modpack::ModpackSource;
    let task = InstallModpackTask::new(
        saved_instance.clone(),
        ModpackSource::Path(zip_path),
        metadata,
    );
    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| e.to_string())?;

    Ok(saved_instance.id)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCandidate {
    pub path: String, // Relative
    pub is_mod: bool,
    pub size: u64,
    pub platform: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub hash: Option<String>,
    pub download_url: Option<String>,
}

#[command]
pub async fn list_export_candidates(instance_id: i32) -> Result<Vec<ExportCandidate>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst = instance
        .filter(id.eq(instance_id))
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let game_dir = PathBuf::from(inst.game_directory.as_ref().ok_or("No game directory")?);
    if !game_dir.exists() {
        return Err("Game directory does not exist".to_string());
    }

    let mut candidates = Vec::new();

    // 1. Scan installed resources (mods, resource packs, shaders, etc.)
    use crate::models::InstalledResource;
    use crate::schema::installed_resource::dsl as res_dsl;

    let installed_resources = res_dsl::installed_resource
        .filter(res_dsl::instance_id.eq(instance_id))
        .load::<InstalledResource>(&mut conn)
        .map_err(|e| e.to_string())?;

    for m in installed_resources {
        let mut rel_path = m.local_path.clone().replace("\\", "/");

        // Ensure path is relative to game_dir
        if let Some(game_dir_str) = game_dir.to_str() {
            let normalized_game_dir = game_dir_str.replace("\\", "/");
            if rel_path.starts_with(&normalized_game_dir) {
                rel_path = rel_path
                    .strip_prefix(&normalized_game_dir)
                    .unwrap_or(&rel_path)
                    .trim_start_matches('/')
                    .to_string();
            }
        }

        candidates.push(ExportCandidate {
            path: rel_path,
            is_mod: true, // "Resource" in modpack terms
            size: m.file_size as u64,
            platform: Some(m.platform),
            project_id: Some(m.remote_id),
            version_id: Some(m.remote_version_id),
            hash: m.hash,
            download_url: None,
        });
    }

    // 2. Scan all folders in game_dir except standard Minecraft internals
    if let Ok(entries) = std::fs::read_dir(&game_dir) {
        let skip_folders = [
            "logs",
            "backups",
            "crash-reports",
            "temp",
            "bin",
            "natives",
            "assets",
            "libraries",
            "versions",
            ".mixin.out",
            "runtime",
            "cache",
            "mod-cache",
            "web-cache",
            "patchy",
            ".vesta",
        ];

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();

                // Skip blacklisted folders
                if skip_folders.contains(&dir_name.as_ref()) {
                    continue;
                }

                // Recursively add files
                let mut stack = vec![path];
                while let Some(current) = stack.pop() {
                    if let Ok(sub_entries) = std::fs::read_dir(&current) {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if sub_path.is_dir() {
                                let sub_dir_name =
                                    sub_path.file_name().unwrap_or_default().to_string_lossy();
                                if !skip_folders.contains(&sub_dir_name.as_ref()) {
                                    stack.push(sub_path.clone());
                                }
                            } else {
                                if let Ok(rel_path) = sub_path.strip_prefix(&game_dir) {
                                    let rel_str =
                                        rel_path.to_string_lossy().to_string().replace("\\", "/");
                                    let size = sub_path.metadata().map(|m| m.len()).unwrap_or(0);

                                    // Avoid duplicates from resources scan
                                    if !candidates.iter().any(|c| c.path == rel_str) {
                                        candidates.push(ExportCandidate {
                                            path: rel_str,
                                            is_mod: false,
                                            size,
                                            platform: None,
                                            project_id: None,
                                            version_id: None,
                                            hash: None,
                                            download_url: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            } else if path.is_file() {
                // Add files in the root (options.txt, servers.dat, etc.)
                if let Ok(rel_path) = path.strip_prefix(&game_dir) {
                    let rel_str = rel_path.to_string_lossy().to_string().replace("\\", "/");
                    let size = path.metadata().map(|m| m.len()).unwrap_or(0);

                    if !candidates.iter().any(|c| c.path == rel_str) {
                        candidates.push(ExportCandidate {
                            path: rel_str,
                            is_mod: false,
                            size,
                            platform: None,
                            project_id: None,
                            version_id: None,
                            hash: None,
                            download_url: None,
                        });
                    }
                }
            }
        }
    }

    Ok(candidates)
}

#[command]
pub async fn export_instance_to_modpack(
    instance_id: i32,
    output_path: String,
    format_str: String,
    selections: Vec<ExportCandidate>,
    modpack_name: String,
    version: String,
    author: String,
    description: String,
    task_manager: State<'_, TaskManager>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst = crate::schema::vesta::instance::table
        .filter(id.eq(instance_id))
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let format = match format_str.to_lowercase().as_str() {
        "modrinth" => ModpackFormat::Modrinth,
        _ => ModpackFormat::CurseForge,
    };

    // Group mods by platform for batch metadata fetching
    let mut mr_ids = Vec::new();
    let mut cf_ids = Vec::new();

    for s in &selections {
        if s.is_mod {
            if let Some(ref pid) = s.project_id {
                match s.platform.as_deref() {
                    Some("modrinth") => mr_ids.push(pid.clone()),
                    Some("curseforge") => cf_ids.push(pid.clone()),
                    _ => {}
                }
            }
        }
    }

    let mr_projects = if !mr_ids.is_empty() {
        resource_manager
            .get_projects(SourcePlatform::Modrinth, &mr_ids)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let cf_projects = if !cf_ids.is_empty() {
        resource_manager
            .get_projects(SourcePlatform::CurseForge, &cf_ids)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut project_meta = std::collections::HashMap::new();
    for p in mr_projects {
        project_meta.insert((SourcePlatform::Modrinth, p.id.clone()), p);
    }
    for p in cf_projects {
        project_meta.insert((SourcePlatform::CurseForge, p.id.clone()), p);
    }

    let entries = selections
        .into_iter()
        .map(|s| {
            let has_ids = s.project_id.is_some() && s.version_id.is_some();
            let has_hash = s.hash.is_some();

            if s.is_mod && (has_ids || has_hash) {
                let mut ext_ids = None;
                if let (Some(ref platform_str), Some(ref pid)) = (&s.platform, &s.project_id) {
                    let platform = match platform_str.as_str() {
                        "modrinth" => Some(SourcePlatform::Modrinth),
                        "curseforge" => Some(SourcePlatform::CurseForge),
                        _ => None,
                    };

                    if let Some(p) = platform {
                        if let Some(meta) = project_meta.get(&(p, pid.clone())) {
                            ext_ids = meta.external_ids.clone();
                        }
                    }
                }

                ExportEntry::Mod {
                    path: PathBuf::from(s.path),
                    source_id: s.project_id.unwrap_or_default(),
                    version_id: s.version_id.unwrap_or_default(),
                    platform: match s.platform.as_deref() {
                        Some("modrinth") => Some(ModpackFormat::Modrinth),
                        Some("curseforge") => Some(ModpackFormat::CurseForge),
                        _ => None,
                    },
                    download_url: s.download_url,
                    external_ids: ext_ids,
                }
            } else {
                ExportEntry::Override {
                    path: PathBuf::from(s.path),
                }
            }
        })
        .collect();

    let spec = ExportSpec {
        name: modpack_name.clone(),
        version: version.clone(),
        author: author.clone(),
        description: if description.is_empty() {
            None
        } else {
            Some(description)
        },
        minecraft_version: inst.minecraft_version.clone(),
        modloader_type: inst.modloader.clone().unwrap_or("vanilla".to_string()),
        modloader_version: inst.modloader_version.clone().unwrap_or_default(),
        entries,
    };

    let game_dir = inst
        .game_directory
        .as_ref()
        .ok_or("No game directory")?
        .clone();

    let task = ModpackExportTask {
        instance_name: modpack_name,
        game_dir,
        output_path,
        modpack_format: format,
        spec,
        resource_manager: resource_manager.inner().clone(),
    };

    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| format!("Failed to submit export task: {}", e))?;

    Ok(())
}

#[command]
pub async fn install_modpack_from_url(
    _app: AppHandle,
    url: String,
    instance_data: Instance,
    metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
    task_manager: State<'_, TaskManager>,
) -> Result<i32, String> {
    let client = reqwest::Client::builder()
        .user_agent("VestaLauncher/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let (final_url, _) = resolve_modpack_resource(&client, &url).await;
    log::info!(
        "[install_modpack_from_url] Resolved URL: {} -> {}",
        url,
        final_url
    );

    let mut conn = get_vesta_conn().map_err(|e| format!("DB Error: {}", e))?;

    let new_inst = prepare_instance(&mut conn, &instance_data).await?;
    log::info!(
        "[install_modpack_from_url] Prepared instance: {} (dir: {:?})",
        new_inst.name,
        new_inst.game_directory
    );

    diesel::insert_into(instance)
        .values(&new_inst)
        .execute(&mut conn)
        .map_err(|e| format!("Failed to save instance: {}", e))?;

    let saved_instance = instance
        .order(id.desc())
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to fetch saved instance: {}", e))?;

    log::info!(
        "[install_modpack_from_url] Saved instance into DB. ID={}, name={}, version_id={:?}",
        saved_instance.id,
        saved_instance.name,
        saved_instance.modpack_version_id
    );

    // Emit created event so UI home page updates immediately
    use tauri::Emitter;
    let _ = _app.emit("core://instance-created", &saved_instance);

    // Queue Task with the URL directly - the task now handles the download
    use crate::tasks::installers::modpack::ModpackSource;
    let task = InstallModpackTask::new(
        saved_instance.clone(),
        ModpackSource::Url(final_url),
        metadata,
    );
    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| e.to_string())?;

    Ok(saved_instance.id)
}
