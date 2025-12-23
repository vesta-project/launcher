use crate::game::installer::types::{InstallSpec, ProgressReporter};
use crate::game::installer::vanilla::install_vanilla;
use crate::game::installer::{track_artifact_from_path, try_restore_artifact};
use crate::game::metadata::{load_or_fetch_metadata, ModloaderType};
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::game::installer::config::{FABRIC_MAVEN_URL, FABRIC_META_URL};
use crate::game::installer::core::traits::ModloaderInstaller;
use futures::future::BoxFuture;
use std::sync::Arc;
use tokio::fs;

pub struct FabricInstaller;

impl ModloaderInstaller for FabricInstaller {
    fn install<'a>(
        &'a self,
        spec: &'a InstallSpec,
        reporter: Arc<dyn ProgressReporter>,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(install_fabric(spec, reporter))
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct FabricLoaderVersion {
    separator: String,
    build: u32,
    maven: String,
    version: String,
    stable: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct FabricProfileLibrary {
    name: String,
    url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FabricProfile {
    id: String,
    inherits_from: String,
    release_time: String,
    time: String,
    #[serde(rename = "type")]
    version_type: String,
    main_class: String,
    arguments: Option<serde_json::Value>,
    libraries: Vec<FabricProfileLibrary>,
}

/// Install Fabric modloader
pub async fn install_fabric(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
) -> Result<()> {
    log::info!(
        "Installing Fabric {} for Minecraft {}",
        spec.modloader_version
            .as_ref()
            .unwrap_or(&"latest".to_string()),
        spec.version_id
    );

    install_loader(
        spec,
        reporter.clone(),
        "Fabric",
        "https://meta.fabricmc.net/v2/versions",
        FABRIC_META_URL,
        FABRIC_MAVEN_URL,
    )
    .await
}

/// Generic loader installation for Fabric/Quilt-compatible loaders
pub async fn install_loader(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
    loader_name: &str,
    _versions_url: &str,
    profile_base_url: &str,
    maven_url: &str,
) -> Result<()> {
    // Step 1: Install vanilla base
    reporter.start_step("Installing vanilla base", Some(5));
    install_vanilla(spec, reporter.clone()).await?;

    // (deferred until loader_version is known)

    // Step 2: Determine loader version
    reporter.start_step(&format!("Fetching {} loader version", loader_name), Some(5));

    // Load metadata to verify version compatibility
    let metadata = load_or_fetch_metadata(&spec.data_dir()).await?;

    let loader_version = if let Some(ref version) = spec.modloader_version {
        // Verify the specified version exists
        let loader_type = match loader_name {
            "Fabric" => ModloaderType::Fabric,
            "Quilt" => ModloaderType::Quilt,
            _ => return Err(anyhow!("Unknown loader: {}", loader_name)),
        };

        if !metadata.is_loader_available(&spec.version_id, loader_type, Some(version)) {
            log::warn!(
                "{} {} may not be officially supported for Minecraft {}",
                loader_name,
                version,
                spec.version_id
            );
        }

        version.clone()
    } else {
        // Get latest stable loader from metadata
        let loader_type = match loader_name {
            "Fabric" => ModloaderType::Fabric,
            "Quilt" => ModloaderType::Quilt,
            _ => return Err(anyhow!("Unknown loader: {}", loader_name)),
        };

        metadata
            .get_latest_loader_version(&spec.version_id, loader_type)
            .ok_or_else(|| {
                anyhow!(
                    "No {} loader versions available for {}",
                    loader_name,
                    spec.version_id
                )
            })?
    };

    log::info!("Using {} loader version: {}", loader_name, loader_version);
    reporter.set_message(&format!("Using {} loader {}", loader_name, loader_version));

    // Prepare client jar in the installed-version folder for processors.
    let installed_id_temp = format!(
        "{}-loader-{}-{}",
        loader_name.to_lowercase(),
        loader_version,
        spec.version_id
    );
    log::debug!(
        "Ensuring installed client jar exists for: {}",
        installed_id_temp
    );
    crate::game::installer::core::downloader::ensure_installed_client(
        spec,
        &installed_id_temp,
        Some(&*reporter),
    )
    .await
    .context("Failed to prepare installed client jar for loader")?;

    // create shared client for loader install
    let client = Client::builder()
        .pool_max_idle_per_host(8)
        .tcp_keepalive(Some(std::time::Duration::from_secs(30)))
        .timeout(std::time::Duration::from_secs(120)) // TODO: Restore config value
        .build()?;

    // Step 3: Download profile JSON
    reporter.start_step(&format!("Downloading {} profile", loader_name), Some(5));
    let profile_url = format!(
        "{}/{}/{}/profile/json",
        profile_base_url, spec.version_id, loader_version
    );

    let profile =
        load_or_fetch_loader_profile(&client, spec, loader_name, &loader_version, &profile_url)
            .await
            .with_context(|| format!("Failed to download {} profile", loader_name))?;

    log::debug!(
        "{} profile ID: {}, inherits: {}",
        loader_name,
        profile.id,
        profile.inherits_from
    );

    // Step 4: Download libraries (concurrent)
    reporter.start_step(&format!("Downloading {} libraries", loader_name), Some(5));

    let libraries_dir = spec.libraries_dir();
    let lib_downloader = crate::game::installer::core::library::LibraryDownloader::new(
        &client,
        &libraries_dir,
        reporter.clone(),
    );

    // Collect library specs for concurrent download
    let library_specs: Vec<crate::game::installer::core::library::LibrarySpec> = profile
        .libraries
        .iter()
        .map(
            |library| crate::game::installer::core::library::LibrarySpec {
                name: library.name.clone(),
                maven_url: library.url.clone().or_else(|| Some(maven_url.to_string())),
                explicit_url: None,
                sha1: None, // Fabric libraries don't provide SHA1 in profile
            },
        )
        .collect();

    let total_libs = library_specs.len();
    log::info!(
        "Downloading {} {} libraries concurrently",
        total_libs,
        loader_name
    );

    lib_downloader
        .download_libraries_concurrent(library_specs, 8, 0, 100)
        .await?;

    log::info!("All {} {} libraries downloaded", total_libs, loader_name);

    // Step 5: Write merged version JSON
    reporter.start_step(&format!("Finalizing {} installation", loader_name), Some(5));
    // Write merged JSON into a new installed-version directory so loader variants
    // live under versions/<installed_id> (e.g. fabric-loader-0.38.2-1.20.1)
    let installed_id = spec.installed_version_id();
    let installed_dir = spec.versions_dir().join(&installed_id);
    std::fs::create_dir_all(&installed_dir)?;

    // Vanilla base JSON is still stored under the vanilla version folder
    let version_dir = spec.versions_dir().join(&spec.version_id);

    // Read vanilla version JSON
    let vanilla_json_path = version_dir.join(format!("{}.json", spec.version_id));
    let vanilla_json: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&vanilla_json_path)
            .context("Failed to read vanilla version JSON")?,
    )?;

    // Create loader version JSON (merge profile with vanilla)
    let loader_id = format!(
        "{}-loader-{}-{}",
        loader_name.to_lowercase(),
        loader_version,
        spec.version_id
    );
    let loader_json_path = installed_dir.join(format!("{}.json", loader_id));

    let mut merged_json = vanilla_json
        .as_object()
        .ok_or_else(|| anyhow!("Invalid vanilla JSON"))?
        .clone();

    // Update ID and main class
    merged_json.insert("id".to_string(), serde_json::json!(loader_id));
    merged_json.insert(
        "mainClass".to_string(),
        serde_json::json!(profile.main_class),
    );

    // Merge libraries
    if let Some(vanilla_libs) = merged_json.get("libraries").and_then(|v| v.as_array()) {
        // Use a map to deduplicate libraries by "group:artifact"
        // Key: "group:artifact", Value: (version, library_json)
        let mut lib_map: std::collections::HashMap<String, (String, serde_json::Value)> =
            std::collections::HashMap::new();

        // Helper to parse "group:artifact:version[:classifier]"
        let parse_maven = |name: &str| -> Option<(String, String)> {
            let parts: Vec<&str> = name.split(':').collect();
            if parts.len() >= 3 {
                let group = parts[0];
                let artifact = parts[1];
                let version = parts[2];
                let classifier = if parts.len() > 3 {
                    Some(parts[3])
                } else {
                    None
                };

                let key = if let Some(c) = classifier {
                    format!("{}:{}:{}", group, artifact, c)
                } else {
                    format!("{}:{}", group, artifact)
                };

                Some((key, version.to_string()))
            } else {
                None
            }
        };

        // Process vanilla libraries first
        for lib in vanilla_libs {
            if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                if let Some((key, version)) = parse_maven(name) {
                    lib_map.insert(key, (version, lib.clone()));
                } else {
                    // If we can't parse the name, just add it with the full name as key to avoid losing it
                    // (though this shouldn't happen for valid maven coords)
                    lib_map.insert(name.to_string(), ("".to_string(), lib.clone()));
                }
            }
        }

        // Process Fabric libraries (override vanilla if same artifact)
        // TODO: Should we compare versions? Usually loader knows best, so we let loader override.
        // But for ASM, we want to avoid duplicates.
        for lib in &profile.libraries {
            let lib_json = serde_json::json!({
                "name": lib.name,
                "url": lib.url.as_deref().unwrap_or(maven_url)
            });

            if let Some((key, version)) = parse_maven(&lib.name) {
                // Check if we already have this artifact
                if let Some((existing_ver, _)) = lib_map.get(&key) {
                    // If versions differ, we need to decide.
                    // For ASM (org.ow2.asm), duplicates are fatal.
                    // We'll prefer the one from Fabric profile as it's likely what the loader expects.
                    log::debug!(
                        "Overriding library {} version {} with {}",
                        key,
                        existing_ver,
                        version
                    );
                }
                lib_map.insert(key, (version, lib_json));
            } else {
                lib_map.insert(lib.name.clone(), ("".to_string(), lib_json));
            }
        }

        // Convert map back to list
        let all_libraries: Vec<serde_json::Value> = lib_map.into_values().map(|(_, v)| v).collect();
        merged_json.insert("libraries".to_string(), serde_json::json!(all_libraries));
    }

    // Merge arguments if present
    if let Some(loader_args) = profile.arguments {
        // Get existing vanilla arguments
        let mut merged_args = if let Some(vanilla_args) = merged_json.get("arguments").cloned() {
            vanilla_args
        } else {
            serde_json::json!({
                "game": [],
                "jvm": []
            })
        };

        // Merge game args
        if let Some(loader_game) = loader_args.get("game").and_then(|v| v.as_array()) {
            if let Some(merged_game) = merged_args.get_mut("game").and_then(|v| v.as_array_mut()) {
                merged_game.extend(loader_game.clone());
            } else {
                merged_args["game"] = serde_json::json!(loader_game);
            }
        }

        // Merge JVM args
        if let Some(loader_jvm) = loader_args.get("jvm").and_then(|v| v.as_array()) {
            if let Some(merged_jvm) = merged_args.get_mut("jvm").and_then(|v| v.as_array_mut()) {
                merged_jvm.extend(loader_jvm.clone());
            } else {
                merged_args["jvm"] = serde_json::json!(loader_jvm);
            }
        }

        merged_json.insert("arguments".to_string(), merged_args);
    }

    // Write loader version JSON into the installed dir
    std::fs::write(
        loader_json_path,
        serde_json::to_string_pretty(&merged_json)?,
    )?;

    reporter.set_percent(100);
    log::info!("{} installation completed successfully", loader_name);

    Ok(())
}

fn loader_profile_path(spec: &InstallSpec, loader_name: &str, loader_version: &str) -> PathBuf {
    spec.data_dir()
        .join("metadata")
        .join("loader_profiles")
        .join(loader_name.to_lowercase())
        .join(&spec.version_id)
        .join(format!("{}.json", loader_version))
}

fn loader_profile_label(loader_name: &str, spec: &InstallSpec, loader_version: &str) -> String {
    format!(
        "metadata/loader_profiles/{}/{}/{}.json",
        loader_name.to_lowercase(),
        spec.version_id,
        loader_version
    )
}

async fn load_or_fetch_loader_profile(
    client: &Client,
    spec: &InstallSpec,
    loader_name: &str,
    loader_version: &str,
    profile_url: &str,
) -> Result<FabricProfile> {
    let path = loader_profile_path(spec, loader_name, loader_version);
    let label = loader_profile_label(loader_name, spec, loader_version);

    if !path.exists() && try_restore_artifact(&label, &path).await? {
        log::info!(
            "Restored {} loader profile for {} {}",
            loader_name,
            spec.version_id,
            loader_version
        );
    }

    if path.exists() {
        return load_profile_from_disk(&path, &label).await;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let response = client.get(profile_url).send().await?;
    if !response.status().is_success() {
        anyhow::bail!(
            "HTTP {} when fetching {} profile {}",
            response.status(),
            loader_name,
            profile_url
        );
    }
    let body = response.text().await?;
    fs::write(&path, &body).await?;
    track_artifact_from_path(label.clone(), &path, None, Some(profile_url.to_string())).await?;
    Ok(serde_json::from_str(&body)?)
}

async fn load_profile_from_disk(path: &Path, label: &str) -> Result<FabricProfile> {
    let contents = fs::read_to_string(path)
        .await
        .with_context(|| format!("Failed to read loader profile at {:?}", path))?;
    track_artifact_from_path(label.to_string(), path, None, None).await?;
    Ok(serde_json::from_str(&contents)?)
}
