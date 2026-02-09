/// Simplified Forge installer following Modrinth's pattern
/// This replaces the overcomplicated common.rs (1142 lines) and processor.rs (787 lines)
/// with a streamlined approach that trusts the Forge manifests.
use crate::game::launcher::unified_manifest::{UnifiedManifest, Processor, SidedDataEntry};
use super::parser::{
    extract_main_class_from_jar, extract_maven_libraries_sync, parse_install_profile,
    parse_version_json,
};
use crate::utils::process::PistonCommandExt;
use crate::game::installer::core::library::LibraryDownloader;
use crate::game::installer::types::{InstallSpec, ProgressReporter, OsType};
use crate::game::installer::vanilla::install_vanilla;
use crate::game::launcher::version_parser::{
    resolve_version_chain, VersionManifest, Library,
};
use crate::game::metadata::{load_or_fetch_metadata, ModloaderType as MetadataModloaderType};
use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

/// Forge library definition
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ForgeLibrary {
    pub name: String,
    #[serde(default)]
    pub downloads: Option<LibraryDownloads>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub checksums: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Artifact {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub sha1: String,
    #[serde(default)]
    pub path: Option<String>,
}

/// Forge install profile (from install_profile.json)
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProfile {
    pub spec: i32,
    pub version: String,
    #[serde(default)]
    pub data: HashMap<String, SidedDataEntry>,
    #[serde(default)]
    pub processors: Vec<Processor>,
    #[serde(default)]
    pub libraries: Vec<ForgeLibrary>,
}

/// Forge version.json
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeVersionInfo {
    pub id: String,
    pub inherits_from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<serde_json::Value>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "minecraftArguments"
    )]
    pub minecraft_arguments: Option<String>,
    #[serde(default)]
    pub libraries: Vec<ForgeLibrary>,
}

/// Legacy Forge install profile (1.12.2 and older)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LegacyInstallProfile {
    pub install: LegacyInstallSection,
    #[serde(rename = "versionInfo")]
    pub version_info: ForgeVersionInfo,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LegacyInstallSection {
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub path: Option<String>,
}

fn forge_info_to_manifest(info: &ForgeVersionInfo) -> VersionManifest {
    let mut libraries = Vec::new();
    for lib in &info.libraries {
        libraries.push(Library {
            name: lib.name.clone(),
            downloads: lib.downloads.as_ref().map(|d| crate::game::launcher::version_parser::LibraryDownloads {
                artifact: d.artifact.as_ref().map(|a| crate::game::launcher::version_parser::Artifact {
                    path: a.path.clone(),
                    sha1: Some(a.sha1.clone()),
                    size: Some(0), // Size not always available in Forge manifest
                    url: Some(a.url.clone()),
                }),
                classifiers: None,
            }),
            url: None,
            natives: None,
            rules: None,
            extract: None,
        });
    }

    let arguments = if let Some(ref args_val) = info.arguments {
        serde_json::from_value(args_val.clone()).ok()
    } else {
        None
    };

    VersionManifest {
        id: info.id.clone(),
        main_class: info.main_class.clone(),
        inherits_from: Some(info.inherits_from.clone()),
        arguments,
        minecraft_arguments: info.minecraft_arguments.clone(),
        libraries,
        asset_index: None,
        assets: None,
        java_version: None,
        version_type: Some("release".to_string()),
        release_time: None,
        time: None,
        ..Default::default()
    }
}

/// Main simplified Forge installer
pub async fn install_forge_modloader(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
    loader_type: MetadataModloaderType,
    loader_name: &str,
    installer_path: PathBuf,
) -> Result<()> {
    log::info!(
        "Starting {} installation for version {}",
        loader_name,
        spec.version_id
    );

    // Step 1: Validate version using metadata
    reporter.set_message(&format!("Validating {} version...", loader_name));
    reporter.set_percent(5);

    let metadata = load_or_fetch_metadata(&spec.data_dir()).await?;
    let loader_version = if let Some(ref version) = spec.modloader_version {
        if !metadata.is_loader_available(&spec.version_id, loader_type, Some(version)) {
            log::warn!(
                "{} version {} may not be officially available for Minecraft {}",
                loader_name,
                version,
                spec.version_id
            );
        }
        version.clone()
    } else {
        metadata
            .get_latest_loader_version(&spec.version_id, loader_type)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "No {} versions available for Minecraft {}",
                    loader_name,
                    spec.version_id
                )
            })?
    };

    log::info!("Using {} version: {}", loader_name, loader_version);

    // Step 2: Install vanilla Minecraft first (like Modrinth does)
    reporter.set_message("Installing vanilla Minecraft...");
    reporter.set_percent(10);

    let vanilla_spec = InstallSpec {
        version_id: spec.version_id.clone(),
        modloader: Some(crate::game::installer::types::ModloaderType::Vanilla),
        modloader_version: None,
        data_dir: spec.data_dir.clone(),
        game_dir: spec.game_dir.clone(),
        java_path: spec.java_path.clone(),
        dry_run: spec.dry_run,
        concurrency: spec.concurrency,
    };

    install_vanilla(&vanilla_spec, reporter.clone())
        .await
        .context("Failed to install vanilla Minecraft")?;

    // Step 3: Parse install profile and version info
    reporter.set_message(&format!("Parsing {} installer...", loader_name));
    reporter.set_percent(30);

    // Try to parse install_profile.json (Modern Forge)
    let install_profile_result = parse_install_profile(&installer_path).await;

    if let Ok(install_profile) = install_profile_result {
        // --- Modern Forge Installation (1.13+) ---
        let version_info = parse_version_json(&installer_path).await?;

        log::info!(
            "{} profile spec version: {}",
            loader_name,
            install_profile.spec
        );
        log::info!("{} version ID: {}", loader_name, version_info.id);

        // Step 4: Extract embedded Maven libraries
        reporter.set_message(&format!("Extracting {} libraries...", loader_name));
        reporter.set_percent(40);

        let installer_path_clone = installer_path.clone();
        let libraries_dir_clone = spec.libraries_dir();
        tokio::task::spawn_blocking(move || {
            extract_maven_libraries_sync(&installer_path_clone, &libraries_dir_clone)
        })
        .await??;

        // Step 5: Download libraries (concurrent)
        reporter.set_message(&format!("Downloading {} libraries...", loader_name));
        reporter.set_percent(50);

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let libraries_dir = spec.libraries_dir();
        let lib_downloader = LibraryDownloader::new(&client, &libraries_dir, reporter.clone());

        // Collect all library specs for concurrent download
        let mut library_specs: Vec<crate::game::installer::core::library::LibrarySpec> = Vec::new();
        let mut seen_libs = std::collections::HashSet::new();

        // Add install profile libraries
        for lib in &install_profile.libraries {
            if let Some(spec) = forge_library_to_spec(lib) {
                if seen_libs.insert(spec.name.clone()) {
                    library_specs.push(spec);
                }
            }
        }

        // Add version info libraries
        for lib in &version_info.libraries {
            if let Some(spec) = forge_library_to_spec(lib) {
                if seen_libs.insert(spec.name.clone()) {
                    library_specs.push(spec);
                }
            }
        }

        let total_libs = library_specs.len();
        log::info!(
            "Downloading {} {} libraries concurrently",
            total_libs,
            loader_name
        );

        lib_downloader
            .download_libraries_concurrent(library_specs, 8, 50, 20)
            .await?;

        log::info!("All {} libraries downloaded", total_libs);

        // Step 6: Execute processors
        reporter.set_message(&format!("Running {} processors...", loader_name));
        reporter.set_percent(70);

        execute_processors(&install_profile, &version_info, spec, reporter.clone(), &installer_path, loader_type).await?;

        // Step 7: Save (merged) version JSON
        reporter.set_message(&format!("Saving {} version info...", loader_name));
        reporter.set_percent(90);

        let installed_id = format!(
            "{}-loader-{}-{}",
            loader_name.to_lowercase(),
            loader_version,
            spec.version_id
        );
        // Ensure installed jar exists
        crate::game::installer::core::downloader::ensure_installed_client(
            spec,
            &installed_id,
            Some(&*reporter),
        )
        .await?;
        let version_dir = spec.versions_dir().join(&installed_id);
        tokio::fs::create_dir_all(&version_dir).await?;

        let version_json_path = version_dir.join(format!("{}.json", installed_id));
        
        // Build parent manifest from vanilla
        let parent_manifest = resolve_version_chain(&spec.version_id, &spec.data_dir()).await?;
        let child_manifest = forge_info_to_manifest(&version_info);

        let mut unified = UnifiedManifest::merge(parent_manifest, Some(child_manifest), OsType::current());
        unified = unified.with_forge_profile(install_profile.processors.clone(), install_profile.data.clone());
        unified.id = installed_id.clone();

        let version_json = serde_json::to_string_pretty(&unified)?;
        tokio::fs::write(&version_json_path, version_json).await?;

        log::info!("Saved unified version JSON to {:?}", version_json_path);
    } else {
        // --- Legacy Forge Installation (1.12.2 and older) ---
        log::info!("Modern install_profile.json not found, checking for legacy format...");

        // Try to parse as LegacyInstallProfile
        // We need to read the file content manually here since we don't have a helper for it
        let installer_path_clone = installer_path.clone();
        let legacy_profile_result: Option<String> = tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(&installer_path_clone).ok()?;
            let mut archive = zip::ZipArchive::new(file).ok()?;
            let mut profile_file = archive.by_name("install_profile.json").ok()?;
            let mut profile_json = String::new();
            profile_file.read_to_string(&mut profile_json).ok()?;
            Some(profile_json)
        })
        .await
        .ok()
        .flatten();

        let (version_info, legacy_install) = if let Some(json) = legacy_profile_result {
            if let Ok(legacy_profile) = serde_json::from_str::<LegacyInstallProfile>(&json) {
                log::info!("Found legacy install_profile.json");
                (legacy_profile.version_info, Some(legacy_profile.install))
            } else {
                // Fallback to version.json if legacy parsing fails
                log::info!(
                    "Failed to parse legacy install_profile.json, falling back to version.json"
                );
                let info = parse_version_json(&installer_path).await?;
                (info, None)
            }
        } else {
            // No install_profile.json at all, try version.json
            log::info!("install_profile.json not found, falling back to version.json");
            let info = parse_version_json(&installer_path).await?;
            (info, None)
        };

        log::info!("Legacy {} version ID: {}", loader_name, version_info.id);

        // Step 4: Extract/Download libraries
        reporter.set_message(&format!("Installing {} libraries...", loader_name));
        reporter.set_percent(40);

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let libraries_dir = spec.libraries_dir();
        let lib_downloader = LibraryDownloader::new(&client, &libraries_dir, reporter.clone());

        // If we have legacy install info, extract the universal jar if needed
        if let Some(install) = legacy_install {
            if let (Some(file_path), Some(path)) = (install.file_path, install.path) {
                // Convert maven path to file path
                if let Ok(dest_path) = maven_to_path(&path, &libraries_dir) {
                    log::info!("Extracting universal jar {} to {:?}", file_path, dest_path);
                    extract_legacy_library(&installer_path, &file_path, &libraries_dir).await?;

                    // Rename/Move if the extracted name doesn't match maven convention?
                    // extract_legacy_library extracts to libraries_dir/internal_path.
                    // We need to move it to dest_path.
                    let extracted_path = libraries_dir.join(&file_path);
                    if extracted_path.exists() && extracted_path != dest_path {
                        if let Some(parent) = dest_path.parent() {
                            tokio::fs::create_dir_all(parent).await?;
                        }
                        tokio::fs::rename(&extracted_path, &dest_path).await?;
                    }
                }
            }
        }

        // Separate libraries into those needing extraction vs download
        let mut libs_to_extract: Vec<&ForgeLibrary> = Vec::new();
        let mut libs_to_download: Vec<crate::game::installer::core::library::LibrarySpec> =
            Vec::new();

        for lib in &version_info.libraries {
            let needs_extraction = lib
                .downloads
                .as_ref()
                .and_then(|d| d.artifact.as_ref())
                .map(|a| a.url.is_empty())
                .unwrap_or(false);

            if needs_extraction {
                libs_to_extract.push(lib);
            } else if let Some(spec) = forge_library_to_spec(lib) {
                libs_to_download.push(spec);
            }
        }

        // Extract embedded libraries first (sequential, I/O bound)
        for lib in &libs_to_extract {
            if let Some(path) = lib
                .downloads
                .as_ref()
                .and_then(|d| d.artifact.as_ref())
                .and_then(|a| a.path.as_ref())
            {
                log::info!("Extracting legacy library: {}", path);
                extract_legacy_library(&installer_path, path, &libraries_dir).await?;
            }
        }

        // Download remaining libraries concurrently
        if !libs_to_download.is_empty() {
            log::info!(
                "Downloading {} legacy {} libraries concurrently",
                libs_to_download.len(),
                loader_name
            );
            lib_downloader
                .download_libraries_concurrent(libs_to_download, 8, 40, 50)
                .await?;
        }

        log::info!(
            "Legacy libraries complete: {} extracted, {} downloaded",
            libs_to_extract.len(),
            version_info.libraries.len() - libs_to_extract.len()
        );

        // Step 7: Save version JSON (Legacy)
        reporter.set_message(&format!("Saving {} version info...", loader_name));
        reporter.set_percent(90);

        let installed_id = format!(
            "{}-loader-{}-{}",
            loader_name.to_lowercase(),
            loader_version,
            spec.version_id
        );
        // Ensure installed jar exists
        crate::game::installer::core::downloader::ensure_installed_client(
            spec,
            &installed_id,
            Some(&*reporter),
        )
        .await?;
        let version_dir = spec.versions_dir().join(&installed_id);
        tokio::fs::create_dir_all(&version_dir).await?;

        let version_json_path = version_dir.join(format!("{}.json", installed_id));
        // Build parent manifest from vanilla
        let parent_manifest = resolve_version_chain(&spec.version_id, &spec.data_dir()).await?;

        let child_manifest = forge_info_to_manifest(&version_info);

        let mut unified = UnifiedManifest::merge(parent_manifest, Some(child_manifest), OsType::current());
        unified.id = installed_id.clone();

        let version_json = serde_json::to_string_pretty(&unified)?;
        tokio::fs::write(&version_json_path, version_json).await?;
    }

    reporter.set_message(&format!("{} installation complete!", loader_name));
    reporter.set_percent(100);

    log::info!("{} installation completed successfully", loader_name);
    Ok(())
}

/// Extract a file from the installer JAR to the libraries directory
async fn extract_legacy_library(
    installer_path: &Path,
    internal_path: &str,
    libraries_dir: &Path,
) -> Result<()> {
    let installer_path = installer_path.to_path_buf();
    let internal_path = internal_path.to_string();
    let dest_path = libraries_dir.join(&internal_path);

    if let Some(parent) = dest_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    tokio::task::spawn_blocking(move || -> Result<()> {
        let file = std::fs::File::open(&installer_path)?;
        let mut archive = zip::ZipArchive::new(file)?;

        // Check if exact path exists
        let exact_exists = archive.by_name(&internal_path).is_ok();

        if exact_exists {
            let mut zip_file = archive.by_name(&internal_path)?;
            let mut out_file = std::fs::File::create(&dest_path)?;
            std::io::copy(&mut zip_file, &mut out_file)?;
        } else {
            // Try finding by filename if exact path fails
            let filename = std::path::Path::new(&internal_path)
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow::anyhow!("Invalid internal path"))?;

            let mut found_index = None;
            for i in 0..archive.len() {
                let file = archive.by_index(i)?;
                if file.name().ends_with(filename) {
                    found_index = Some(i);
                    break;
                }
            }

            if let Some(i) = found_index {
                let mut zip_file = archive.by_index(i)?;
                let mut out_file = std::fs::File::create(&dest_path)?;
                std::io::copy(&mut zip_file, &mut out_file)?;
            } else {
                anyhow::bail!("File not found in installer JAR: {}", internal_path);
            }
        }

        Ok(())
    })
    .await??;

    Ok(())
}

/// Convert a ForgeLibrary to a LibrarySpec for concurrent downloads
fn forge_library_to_spec(lib: &ForgeLibrary) -> Option<crate::game::installer::core::library::LibrarySpec> {
    // Extract maven_url from library.url field
    let mut maven_url = lib.url.clone();
    
    // Extract explicit download URL and SHA1 from downloads.artifact
    let (explicit_url, sha1) = if let Some(downloads) = &lib.downloads {
        if let Some(artifact) = &downloads.artifact {
            // If artifact.url is empty, this library is either:
            // 1. Embedded in the installer (will be extracted)
            // 2. Created by processors
            // In either case, skip downloading
            if artifact.url.is_empty() {
                log::debug!("Skipping library {} (empty URL - embedded or processor output)", lib.name);
                return None;
            }
            
            (
                Some(artifact.url.clone()),
                if artifact.sha1.is_empty() {
                    None
                } else {
                    Some(artifact.sha1.clone())
                },
            )
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Use checksums as fallback SHA1
    let sha1 = sha1.or_else(|| lib.checksums.as_ref().and_then(|c| c.first().cloned()));

    // Priority 1: Minecraft standard libraries should ALWAYS come from Mojang
    // regardless of what the modloader manifest says.
    if lib.name.starts_with("org.lwjgl") || lib.name.starts_with("com.mojang") || lib.name.starts_with("net.minecraft") {
        maven_url = Some("https://libraries.minecraft.net/".to_string());
    }

    // If no maven_url is specified at the library level, infer based on artifact coordinates
    if maven_url.is_none() {
        maven_url = Some(if lib.name.starts_with("net.minecraftforge") {
            "https://maven.minecraftforge.net/".to_string()
        } else if lib.name.starts_with("net.neoforged") {
            "https://maven.neoforged.net/releases/".to_string()
        } else if lib.name.starts_with("de.oceanlabs") {
            "https://maven.minecraftforge.net/".to_string()
        } else {
            // Default to Minecraft libraries for everything else
            "https://libraries.minecraft.net/".to_string()
        });
    }

    Some(crate::game::installer::core::library::LibrarySpec {
        name: lib.name.clone(),
        maven_url,
        explicit_url,
        sha1,
    })
}

/// Execute processors for client-side installation
async fn execute_processors(
    install_profile: &InstallProfile,
    version_info: &ForgeVersionInfo,
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
    installer_path: &Path,
    loader_type: MetadataModloaderType,
) -> Result<()> {
    let client_processors: Vec<&Processor> = install_profile
        .processors
        .iter()
        .filter(|p| should_run_processor(p))
        .collect();

    if client_processors.is_empty() {
        log::info!("No processors to execute");
        return Ok(());
    }

    log::info!("Executing {} processors...", client_processors.len());

    // Build data variables
    let mut data_variables = HashMap::new();

    // Default variables
    data_variables.insert("SIDE".to_string(), "client".to_string());
    data_variables.insert("MINECRAFT_VERSION".to_string(), spec.version_id.clone());
    data_variables.insert(
        "ROOT".to_string(),
        spec.data_dir().to_string_lossy().to_string(),
    );
    data_variables.insert(
        "LIBRARY_DIR".to_string(),
        spec.libraries_dir().to_string_lossy().to_string(),
    );

    let client_jar_path = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.jar", spec.version_id));

    data_variables.insert(
        "MINECRAFT_JAR".to_string(),
        client_jar_path.to_string_lossy().to_string(),
    );

    // Extract data files from installer JAR and populate data variables
    let installer_data_dir = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(".installer-data");
    if installer_data_dir.exists() {
        tokio::fs::remove_dir_all(&installer_data_dir).await?;
    }
    tokio::fs::create_dir_all(&installer_data_dir).await?;

    // Collect Maven-coordinated data entries that need downloading
    let mut maven_data_libs: Vec<crate::game::installer::core::library::LibrarySpec> = Vec::new();

    for (key, entry) in &install_profile.data {
        let client_val = &entry.client;
        if client_val.starts_with('/') {
            // It's a file path inside the JAR, extract it
            let internal_path = &client_val[1..]; // Remove leading /
            let dest_path = installer_data_dir.join(internal_path);

            if let Some(parent) = dest_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            // We need to use a blocking task for zip extraction as zip crate is synchronous
            let installer_path_clone = installer_path.to_path_buf();
            let internal_path_string = internal_path.to_string();
            let dest_path_clone = dest_path.clone();

            tokio::task::spawn_blocking(move || -> Result<()> {
                let file = std::fs::File::open(&installer_path_clone)
                    .context("Failed to open installer JAR")?;
                let mut archive =
                    zip::ZipArchive::new(file).context("Failed to read installer JAR")?;

                let mut zip_file = archive.by_name(&internal_path_string).context(format!(
                    "File {} not found in installer JAR",
                    internal_path_string
                ))?;

                let mut out_file = std::fs::File::create(&dest_path_clone)
                    .context("Failed to create output file")?;

                std::io::copy(&mut zip_file, &mut out_file)?;
                Ok(())
            })
            .await??;

            // Update variable with absolute path
            data_variables.insert(key.clone(), dest_path.to_string_lossy().to_string());
            log::debug!("Extracted data file: {} -> {:?}", client_val, dest_path);
        } else if client_val.starts_with('[') && client_val.ends_with(']') {
            // It's a Maven coordinate - resolve to path
            // NOTE: Not all Maven coordinates are downloadable! Some are processor OUTPUTS.
            // Only coordinates that appear in install_profile.libraries are downloadable.
            let coords = &client_val[1..client_val.len() - 1];
            let resolved_path = maven_to_path(coords, &spec.libraries_dir())?;
            data_variables.insert(key.clone(), resolved_path.to_string_lossy().to_string());
            log::debug!(
                "Data entry {} references Maven artifact: {} -> {:?}",
                key,
                coords,
                resolved_path
            );

            // Check if this coordinate is downloadable:
            // 1. Must be in install_profile.libraries OR version_info.libraries
            // 2. If in version_info.libraries, must have a non-empty URL
            let has_empty_url_in_version_libs = version_info.libraries.iter().any(|lib| {
                lib.name == coords && 
                lib.downloads.as_ref()
                    .and_then(|d| d.artifact.as_ref())
                    .map(|a| a.url.is_empty())
                    .unwrap_or(false)
            });
            
            let is_in_install_libraries = install_profile.libraries.iter().any(|lib| {
                lib.name == coords
            });
            
            // Skip if it has an empty URL in version libs (means it's a processor output)
            let should_skip = has_empty_url_in_version_libs || (!is_in_install_libraries && !resolved_path.exists());
            
            log::debug!(
                "Data entry {} ({}) - in install libs: {}, has empty URL: {}, exists: {}, skip: {}",
                key,
                coords,
                is_in_install_libraries,
                has_empty_url_in_version_libs,
                resolved_path.exists(),
                should_skip
            );

            // Only try to download if:
            // 1. File doesn't exist
            // 2. Not flagged to skip (has URL and is in libraries)
            if !resolved_path.exists() && !should_skip {
                log::info!("Maven data artifact needs download: {}", coords);
                
                // Smart Maven URL selection based on artifact coordinates
                let maven_url = if coords.starts_with("net.neoforged") {
                    "https://maven.neoforged.net/releases/"
                } else if coords.starts_with("net.minecraftforge") {
                    "https://maven.minecraftforge.net/"
                } else if coords.starts_with("de.oceanlabs") {
                    // MCPConfig and related tools
                    "https://maven.minecraftforge.net/"
                } else if coords.starts_with("net.minecraft") || coords.starts_with("com.mojang") {
                    "https://libraries.minecraft.net/"
                } else {
                    // Default based on loader type
                    match loader_type {
                        MetadataModloaderType::NeoForge => "https://maven.neoforged.net/releases/",
                        MetadataModloaderType::Forge => "https://maven.minecraftforge.net/",
                        _ => "https://maven.minecraftforge.net/",
                    }
                };
                
                maven_data_libs.push(crate::game::installer::core::library::LibrarySpec {
                    name: coords.to_string(),
                    maven_url: Some(maven_url.to_string()),
                    explicit_url: None,
                    sha1: None,
                });
            } else if !resolved_path.exists() {
                log::info!(
                    "Data entry {} ({}) will be created by processor (not in libraries list)",
                    key,
                    coords
                );
            } else {
                log::debug!(
                    "Data entry {} ({}) already exists at {:?}",
                    key,
                    coords,
                    resolved_path
                );
            }
        } else {
            data_variables.insert(key.clone(), client_val.clone());
        }
    }

    // Download any Maven-coordinated data artifacts that are missing
    if !maven_data_libs.is_empty() {
        log::info!(
            "Downloading {} Maven data artifacts for processors...",
            maven_data_libs.len()
        );
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;
        let libraries_dir = spec.libraries_dir();
        let lib_downloader = LibraryDownloader::new(&client, &libraries_dir, reporter.clone());
        lib_downloader
            .download_libraries_concurrent(maven_data_libs, 4, 65, 5)
            .await?;
    }

    let mut skipped = 0;
    for (idx, processor) in client_processors.iter().enumerate() {
        if reporter.is_cancelled() {
            anyhow::bail!("Installation cancelled by user");
        }

        // Check if outputs are already valid - skip if so (HMCL pattern)
        if check_processor_outputs_valid(processor, &data_variables, &spec.libraries_dir())? {
            log::info!(
                "Skipping processor {}/{}: {} (outputs already valid)",
                idx + 1,
                client_processors.len(),
                processor.jar
            );
            skipped += 1;
            continue;
        }

        log::info!(
            "Executing processor {}/{}: {}",
            idx + 1,
            client_processors.len(),
            processor.jar
        );

        execute_single_processor(processor, spec, &data_variables).await?;

        // Verify outputs after execution
        verify_processor_outputs(processor, &data_variables, &spec.libraries_dir())?;

        // Update progress AFTER processor completes
        let progress = 70 + (((idx + 1) as f32 / client_processors.len() as f32) * 20.0) as i32;
        reporter.set_percent(progress);
    }

    if skipped > 0 {
        log::info!(
            "Skipped {}/{} processors with valid outputs",
            skipped,
            client_processors.len()
        );
    }

    Ok(())
}

/// Check if processor should run on client side
fn should_run_processor(processor: &Processor) -> bool {
    if let Some(sides) = &processor.sides {
        sides.iter().any(|s| s == "client" || s == "extract")
    } else {
        true
    }
}

/// Check if processor outputs are valid - returns true if processor can be skipped
fn check_processor_outputs_valid(
    processor: &Processor,
    data_variables: &HashMap<String, String>,
    libraries_dir: &Path,
) -> Result<bool> {
    let outputs = match &processor.outputs {
        Some(o) if !o.is_empty() => o,
        _ => return Ok(false), // No outputs to check, must run processor
    };

    for (key, value) in outputs {
        // Parse key - can be [artifact] or {variable}
        let output_path = if key.starts_with('[') && key.ends_with(']') {
            let coords = &key[1..key.len() - 1];
            maven_to_path(coords, libraries_dir)?
        } else if key.starts_with('{') && key.ends_with('}') {
            let var_name = &key[1..key.len() - 1];
            let path_str = data_variables.get(var_name).ok_or_else(|| {
                anyhow::anyhow!("Missing data variable for output key: {}", var_name)
            })?;
            std::path::PathBuf::from(path_str)
        } else {
            std::path::PathBuf::from(key)
        };

        if !output_path.exists() {
            log::debug!(
                "Processor output missing: {} -> {:?}",
                key,
                output_path
            );
            return Ok(false); // Output file missing, must run processor
        }

        // Parse expected SHA1 - can be {variable} or 'literal'
        let expected_sha1 = if value.starts_with('{') && value.ends_with('}') {
            let var_name = &value[1..value.len() - 1];
            data_variables.get(var_name).cloned()
        } else if value.starts_with('\'') && value.ends_with('\'') {
            Some(value[1..value.len() - 1].to_string())
        } else {
            Some(value.clone())
        };

        if let Some(expected) = expected_sha1 {
            use sha1::{Digest, Sha1};
            let bytes = std::fs::read(&output_path)?;
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            let computed = format!("{:x}", hasher.finalize());

            if computed.to_lowercase() != expected.to_lowercase() {
                log::debug!(
                    "Processor output SHA1 mismatch for {:?}: expected {}, got {}",
                    output_path,
                    expected,
                    computed
                );
                // Remove invalid file and mark as needing rebuild
                let _ = std::fs::remove_file(&output_path);
                return Ok(false);
            }
        }
    }

    log::info!(
        "Processor {} outputs already valid, skipping",
        processor.jar
    );
    Ok(true) // All outputs valid
}

/// Verify processor outputs after execution
fn verify_processor_outputs(
    processor: &Processor,
    data_variables: &HashMap<String, String>,
    libraries_dir: &Path,
) -> Result<()> {
    let outputs = match &processor.outputs {
        Some(o) if !o.is_empty() => o,
        _ => return Ok(()), // No outputs to verify
    };

    for (key, value) in outputs {
        let output_path = if key.starts_with('[') && key.ends_with(']') {
            let coords = &key[1..key.len() - 1];
            maven_to_path(coords, libraries_dir)?
        } else if key.starts_with('{') && key.ends_with('}') {
            let var_name = &key[1..key.len() - 1];
            let path_str = data_variables.get(var_name).ok_or_else(|| {
                anyhow::anyhow!("Missing data variable for output key: {}", var_name)
            })?;
            std::path::PathBuf::from(path_str)
        } else {
            std::path::PathBuf::from(key)
        };

        if !output_path.exists() {
            anyhow::bail!(
                "Processor {} failed to create expected output: {:?}",
                processor.jar,
                output_path
            );
        }

        let expected_sha1 = if value.starts_with('{') && value.ends_with('}') {
            let var_name = &value[1..value.len() - 1];
            data_variables.get(var_name).map(|v| {
                // Strip quotes from variable value if present
                if v.starts_with('\'') && v.ends_with('\'') && v.len() > 2 {
                    v[1..v.len() - 1].to_string()
                } else {
                    v.clone()
                }
            })
        } else if value.starts_with('\'') && value.ends_with('\'') && value.len() > 2 {
            Some(value[1..value.len() - 1].to_string())
        } else {
            Some(value.clone())
        };

        if let Some(expected) = expected_sha1 {
            use sha1::{Digest, Sha1};
            let bytes = std::fs::read(&output_path)?;
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            let computed = format!("{:x}", hasher.finalize());

            if computed.to_lowercase() != expected.to_lowercase() {
                anyhow::bail!(
                    "Processor {} output {:?} has wrong SHA1: expected {}, got {}",
                    processor.jar,
                    output_path,
                    expected,
                    computed
                );
            }
        }
    }

    Ok(())
}

/// Execute a single processor
async fn execute_single_processor(
    processor: &Processor,
    spec: &InstallSpec,
    data_variables: &HashMap<String, String>,
) -> Result<()> {
    let java_program = spec
        .java_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "java".to_string());

    // Verify Java is available before proceeding
    let java_check = Command::new(&java_program)
        .arg("-version")
        .output()
        .await;
    
    if java_check.is_err() || !java_check.as_ref().unwrap().status.success() {
        anyhow::bail!(
            "Java executable not found or not working: {}. Please ensure Java is installed and accessible.",
            java_program
        );
    }

    // Build classpath
    let mut classpath_entries = Vec::new();
    classpath_entries.push(maven_to_path(&processor.jar, &spec.libraries_dir())?);
    for lib_coords in &processor.classpath {
        classpath_entries.push(maven_to_path(lib_coords, &spec.libraries_dir())?);
    }

    let classpath = classpath_entries
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(if cfg!(windows) { ";" } else { ":" });

    // Substitute variables and resolve Maven coordinates in arguments
    let mut args = Vec::new();
    for arg in &processor.args {
        let substituted = substitute_variables(arg, data_variables);
        if substituted.starts_with('[') && substituted.ends_with(']') {
            let coords = &substituted[1..substituted.len() - 1];
            let path = maven_to_path(coords, &spec.libraries_dir())?;
            args.push(path.to_string_lossy().to_string());
        } else {
            args.push(substituted);
        }
    }

    // Extract main class from the processor JAR
    let processor_jar_path = maven_to_path(&processor.jar, &spec.libraries_dir())?;
    let main_class = extract_main_class_from_jar(&processor_jar_path).context(
        format!("Failed to extract Main-Class from {}", processor.jar),
    )?;

    log::debug!("Processor classpath: {}", classpath);
    log::debug!("Processor main class: {}", main_class);
    log::debug!("Processor args: {:?}", args);

    // Execute Java process: java -Xmx2G -cp <classpath> <main_class> <args...>
    let mut command = Command::new(&java_program);
    command
        .arg("-Xmx2G")  // Set max heap to 2GB for processor execution
        .arg("-Xms512M") // Set initial heap to 512MB
        .arg("-cp")
        .arg(&classpath)
        .arg(&main_class)
        .args(&args)
        .suppress_console()
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    log::debug!("Executing: {:?}", command);

    // Execute with timeout (5 minutes should be enough for most processors)
    let timeout_duration = std::time::Duration::from_secs(300);
    let output = tokio::time::timeout(timeout_duration, command.output())
        .await
        .context("Processor execution timed out after 5 minutes")?
        .context("Failed to spawn processor Java process")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::error!("Processor failed:");
        log::error!("  Main class: {}", main_class);
        log::error!("  Args: {:?}", args);
        log::error!("  stdout: {}", stdout);
        log::error!("  stderr: {}", stderr);
        anyhow::bail!("Processor exited with code: {:?}", output.status.code());
    }

    Ok(())
}

/// Convert Maven coordinates to filesystem path
fn maven_to_path(coords: &str, libraries_dir: &Path) -> Result<PathBuf> {
    let parts: Vec<&str> = coords.split(':').collect();
    if parts.len() < 3 {
        anyhow::bail!("Invalid Maven coordinates: {}", coords);
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let mut version = parts[2];
    let mut classifier = None;
    let mut extension = "jar";

    if parts.len() == 3 {
        // group:artifact:version@extension
        if let Some((v, ext)) = version.split_once('@') {
            version = v;
            extension = ext;
        }
    } else if parts.len() >= 4 {
        // group:artifact:version:classifier[@extension]
        let classifier_ext = parts[3];
        if let Some((clf, ext)) = classifier_ext.split_once('@') {
            classifier = Some(clf);
            extension = ext;
        } else {
            classifier = Some(classifier_ext);
        }
    }

    let filename = if let Some(clf) = classifier {
        format!("{}-{}-{}.{}", artifact, version, clf, extension)
    } else {
        format!("{}-{}.{}", artifact, version, extension)
    };

    Ok(libraries_dir.join(format!("{}/{}/{}/{}", group, artifact, version, filename)))
}

/// Substitute data variables in a string
fn substitute_variables(text: &str, data_variables: &HashMap<String, String>) -> String {
    let mut result = text.to_string();
    for (key, value) in data_variables {
        let placeholder = format!("{{{}}}", key);
        result = result.replace(&placeholder, value);
    }
    result
}
