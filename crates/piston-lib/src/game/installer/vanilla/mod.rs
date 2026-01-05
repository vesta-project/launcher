use crate::game::installer::config::VANILLA_MANIFEST_URL;
use crate::game::installer::core::batch::{BatchArtifact, BatchDownloader};
use crate::game::installer::core::downloader::{
    download_json_with_client, download_to_path,
};
use crate::game::installer::core::jre_manager::{get_or_install_jre, JavaVersion};
use crate::game::installer::core::traits::ModloaderInstaller;
use crate::game::installer::types::{InstallSpec, OsType, ProgressReporter};
use crate::game::installer::{track_artifact_from_path, try_restore_artifact};
use anyhow::{Context, Result};
use futures::future::BoxFuture;
use futures::stream::{self, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Check if a file is locked by another process (e.g., game is running)
/// Returns true if the file appears to be locked/in-use
fn is_file_locked(path: &std::path::Path) -> bool {
    use std::fs::OpenOptions;

    if !path.exists() {
        return false;
    }

    match OpenOptions::new().read(true).open(path) {
        Ok(_) => false,
        Err(e) => matches!(e.kind(), std::io::ErrorKind::PermissionDenied),
    }
}

pub struct VanillaInstaller;

impl ModloaderInstaller for VanillaInstaller {
    fn install<'a>(
        &'a self,
        spec: &'a InstallSpec,
        reporter: Arc<dyn ProgressReporter>,
    ) -> BoxFuture<'a, anyhow::Result<()>> {
        Box::pin(install_vanilla(spec, reporter))
    }
}

#[derive(Deserialize, Serialize, Debug)]
struct VersionManifest {
    versions: Vec<VersionEntry>,
}

#[derive(Deserialize, Serialize, Debug)]
struct VersionEntry {
    id: String,
    url: String,
    sha1: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct VersionInfo {
    id: String,
    asset_index: AssetIndex,
    downloads: HashMap<String, Download>,
    libraries: Vec<Library>,
    #[serde(default)]
    java_version: Option<JavaVersionInfo>,
    main_class: String,
    minecraft_arguments: Option<String>,
    arguments: Option<Arguments>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct AssetIndex {
    id: String,
    url: String,
    sha1: String,
    #[serde(default)]
    total_size: u64,
    size: u64,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct Download {
    url: String,
    sha1: String,
    size: u64,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct Library {
    name: String,
    downloads: Option<LibraryDownloads>,
    #[serde(default)]
    rules: Vec<Rule>,
    #[serde(default)]
    natives: Option<HashMap<String, String>>,
    extract: Option<ExtractRules>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct LibraryDownloads {
    artifact: Option<Artifact>,
    classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct Artifact {
    url: String,
    sha1: String,
    size: u64,
    path: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct Rule {
    action: String,
    os: Option<OsRule>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct OsRule {
    name: Option<String>,
    arch: Option<String>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct ExtractRules {
    exclude: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct JavaVersionInfo {
    major_version: u32,
    component: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct Arguments {
    game: Option<Vec<serde_json::Value>>,
    jvm: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize, Serialize, Debug)]
struct AssetIndexFile {
    objects: HashMap<String, AssetObject>,
}

#[derive(Deserialize, Serialize, Debug)]
struct AssetObject {
    hash: String,
    size: u64,
}

/// Install vanilla Minecraft
pub async fn install_vanilla(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
) -> Result<()> {
    log::info!("Installing vanilla Minecraft {}", spec.version_id);

    reporter.start_step("Fetching version manifest", Some(8));
    reporter.set_percent(5);

    // create a shared HTTP client for the whole install run
    let client = Client::builder()
        .pool_max_idle_per_host(8)
        .tcp_keepalive(Some(std::time::Duration::from_secs(30)))
        .timeout(std::time::Duration::from_secs(120)) // TODO: Restore config value
        .build()?;

    // 1. Check if we already have the version JSON locally
    let version_json_path = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.json", spec.version_id));
    let version_json_label = format!("versions/{}/{}.json", spec.version_id, spec.version_id);

    if !version_json_path.exists()
        && try_restore_artifact(&version_json_label, &version_json_path).await?
    {
        log::info!("Restored cached version metadata for {}", spec.version_id);
    }

    let mut tracked_version_json = false;

    let version_info: VersionInfo = if version_json_path.exists() {
        log::info!("Found local version JSON at {:?}", version_json_path);
        match tokio::fs::read(&version_json_path).await {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(info) => {
                    log::info!(
                        "Successfully loaded local version info for {}",
                        spec.version_id
                    );
                    track_artifact_from_path(
                        version_json_label.clone(),
                        &version_json_path,
                        None,
                        None,
                    )
                    .await?;
                    tracked_version_json = true;
                    info
                }
                Err(e) => {
                    log::warn!("Failed to parse local version JSON: {}", e);
                    fetch_and_download_version_info(
                        &client,
                        spec,
                        reporter.clone(),
                        &version_json_path,
                        &version_json_label,
                    )
                    .await?
                }
            },
            Err(e) => {
                log::warn!("Failed to read local version JSON: {}", e);
                fetch_and_download_version_info(
                    &client,
                    spec,
                    reporter.clone(),
                    &version_json_path,
                    &version_json_label,
                )
                .await?
            }
        }
    } else {
        fetch_and_download_version_info(
            &client,
            spec,
            reporter.clone(),
            &version_json_path,
            &version_json_label,
        )
        .await?
    };

    if !tracked_version_json && version_json_path.exists() {
        track_artifact_from_path(version_json_label.clone(), &version_json_path, None, None)
            .await?;
    }

    log::info!("Version info loaded: {}", version_info.id);

    // 3. Download client jar
    reporter.start_step("Downloading game client", None);
    reporter.set_percent(20);

    let client_jar_path = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.jar", spec.version_id));

    if let Some(client_download) = version_info.downloads.get("client") {
        // Skip if already exists and valid
        let mut needs_download = true;
        if client_jar_path.exists() {
            if let Ok(metadata) = tokio::fs::metadata(&client_jar_path).await {
                if metadata.len() == client_download.size {
                    log::info!("Client jar already cached: {:?}", client_jar_path);
                    needs_download = false;
                }
            }
        }

        if needs_download {
            let jar_label = format!("versions/{}/{}.jar", spec.version_id, spec.version_id);
            if try_restore_artifact(&jar_label, &client_jar_path).await? {
                log::info!("Restored client jar from cache: {:?}", client_jar_path);
                needs_download = false;
            }
        }

        if needs_download {
            log::info!(
                "Starting client jar download: {} -> {:?} ({} bytes)",
                &client_download.url,
                client_jar_path,
                client_download.size
            );
            download_to_path(
                &client,
                &client_download.url,
                &client_jar_path,
                Some(&client_download.sha1),
                &*reporter,
            )
            .await?;
            log::info!("Client jar downloaded to {:?}", client_jar_path);
        }
    } else {
        anyhow::bail!("No client download found in version info");
    }

    // 4. Download asset index
    reporter.start_step("Downloading asset index", None);
    reporter.set_percent(30);

    let asset_index_path = spec
        .assets_dir()
        .join("indexes")
        .join(format!("{}.json", version_info.asset_index.id));

    let asset_index_label = format!("assets/indexes/{}.json", version_info.asset_index.id);
    let mut needs_asset_index = true;
    if asset_index_path.exists() {
        needs_asset_index = false;
        track_artifact_from_path(asset_index_label.clone(), &asset_index_path, None, None).await?;
    } else if try_restore_artifact(&asset_index_label, &asset_index_path).await? {
        log::info!("Restored asset index from cache: {:?}", asset_index_path);
        needs_asset_index = false;
    }

    let asset_index_file: AssetIndexFile = if reporter.is_dry_run() {
        download_json_with_client(&client, &version_info.asset_index.url).await?
    } else {
        if needs_asset_index {
            log::info!(
                "Downloading asset index {} -> {:?}",
                version_info.asset_index.url,
                asset_index_path
            );
            download_to_path(
                &client,
                &version_info.asset_index.url,
                &asset_index_path,
                Some(&version_info.asset_index.sha1),
                &*reporter,
            )
            .await?;
            track_artifact_from_path(
                asset_index_label,
                &asset_index_path,
                None,
                Some(version_info.asset_index.url.clone()),
            )
            .await?;
        }
        serde_json::from_slice(&tokio::fs::read(&asset_index_path).await?)?
    };
    let total_assets = asset_index_file.objects.len();
    log::info!(
        "Downloading {} assets with parallel downloads",
        total_assets
    );

    // Prepare asset downloads and track cached entries
    let mut assets_to_download = Vec::new();
    let mut cached_assets = 0usize;

    for (asset_name, asset_obj) in asset_index_file.objects.into_iter() {
        let hash_prefix = asset_obj.hash[0..2].to_string();
        let asset_url = format!(
            "https://resources.download.minecraft.net/{}/{}",
            hash_prefix, asset_obj.hash
        );
        let asset_path = spec
            .assets_dir()
            .join("objects")
            .join(&hash_prefix)
            .join(&asset_obj.hash);
        let label = format!("assets/objects/{}/{}", hash_prefix, asset_obj.hash);

        let mut needs_download = true;
        if asset_path.exists() {
            if is_file_locked(&asset_path) {
                log::info!(
                    "Asset file is locked (game may be running), assuming valid and skipping: {:?}",
                    asset_path
                );
                needs_download = false;
            } else if let Ok(metadata) = std::fs::metadata(&asset_path) {
                if metadata.len() == asset_obj.size {
                    needs_download = false;
                }
            }
        }

        if needs_download {
            if try_restore_artifact(&label, &asset_path).await? {
                cached_assets += 1;
                continue;
            }

            assets_to_download.push((
                asset_name,
                asset_url,
                asset_path,
                asset_obj.hash,
                asset_obj.size,
                label,
            ));
        } else {
            cached_assets += 1;
            if !is_file_locked(&asset_path) {
                track_artifact_from_path(label, &asset_path, None, Some(asset_url))
                    .await
                    .context("Track cached asset")?;
            }
        }
    }

    let downloads_needed = assets_to_download.len();
    log::info!(
        "Need to download {} assets ({} already cached)",
        downloads_needed,
        cached_assets
    );

    // Download assets in parallel with BatchDownloader
    let batch_downloader = BatchDownloader::new(client.clone(), spec.concurrency);
    let artifacts = assets_to_download
        .into_iter()
        .map(|(name, url, path, hash, _size, label)| BatchArtifact {
            name,
            url,
            path,
            sha1: Some(hash),
            label,
        })
        .collect();

    batch_downloader
        .download_all(artifacts, reporter.clone(), 40, 20.0)
        .await?;

    // 6. Download libraries (concurrent)
    reporter.start_step("Downloading libraries", None);
    reporter.set_percent(60);

    let os = OsType::current();

    // Collect library download tasks
    struct LibraryTask {
        name: String,
        url: String,
        sha1: String,
        path: PathBuf,
        label: String,
    }

    struct NativeTask {
        name: String,
        url: String,
        sha1: String,
        path: PathBuf,
        label: String,
        extract: Option<ExtractRules>,
    }

    let mut library_tasks: Vec<LibraryTask> = Vec::new();
    let mut native_tasks: Vec<NativeTask> = Vec::new();

    for library in &version_info.libraries {
        // Check rules
        if !check_rules(&library.rules, &os) {
            log::debug!("Skipping library due to rules: {}", library.name);
            continue;
        }

        if let Some(downloads) = &library.downloads {
            // Collect main artifact
            if let Some(artifact) = &downloads.artifact {
                let artifact_path = std::path::Path::new(&artifact.path);
                if artifact_path.is_absolute()
                    || artifact_path
                        .components()
                        .any(|c| matches!(c, std::path::Component::ParentDir))
                {
                    log::error!("Invalid artifact path from metadata: {}", artifact.path);
                    continue;
                }

                library_tasks.push(LibraryTask {
                    name: library.name.clone(),
                    url: artifact.url.clone(),
                    sha1: artifact.sha1.clone(),
                    path: spec.libraries_dir().join(artifact_path),
                    label: format!("libraries/{}", artifact.path),
                });
            }

            // Collect native artifacts
            if library.natives.is_some() {
                if let Some(classifiers) = &downloads.classifiers {
                    if let Some(key) = crate::game::launcher::classifier::resolve_classifier_string(
                        &library.name,
                        library.natives.as_ref(),
                        library
                            .downloads
                            .as_ref()
                            .and_then(|d| d.classifiers.as_ref()),
                        os_name(&os),
                        arch_bits(&os),
                    ) {
                        if let Some(native_artifact) = classifiers.get(&key) {
                            native_tasks.push(NativeTask {
                                name: library.name.clone(),
                                url: native_artifact.url.clone(),
                                sha1: native_artifact.sha1.clone(),
                                path: spec.libraries_dir().join(&native_artifact.path),
                                label: format!("libraries/{}", native_artifact.path),
                                extract: library.extract.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    let total_libs = library_tasks.len();
    let total_natives = native_tasks.len();
    log::info!(
        "Downloading {} libraries and {} natives",
        total_libs,
        total_natives
    );

    // Download libraries concurrently with BatchDownloader
    let batch_downloader = BatchDownloader::new(client.clone(), spec.concurrency);
    let artifacts = library_tasks
        .into_iter()
        .map(|task| BatchArtifact {
            name: task.name,
            url: task.url,
            path: task.path,
            sha1: Some(task.sha1),
            label: task.label,
        })
        .collect();

    batch_downloader
        .download_all(artifacts, reporter.clone(), 60, 15.0)
        .await?;

    log::info!("Libraries downloaded: {}", total_libs);

    // Download and extract natives (lower concurrency due to extraction I/O)
    if !native_tasks.is_empty() {
        reporter.start_step("Extracting natives", None);
        reporter.set_percent(75);

        let natives_dir = spec.natives_dir();
        let downloaded_natives = Arc::new(AtomicUsize::new(0));

        stream::iter(native_tasks)
            .map(|task| {
                let reporter = reporter.clone();
                let downloaded_natives = Arc::clone(&downloaded_natives);
                let client = client.clone();
                let natives_dir = natives_dir.clone();

                async move {
                    if reporter.is_cancelled() {
                        return Err(anyhow::anyhow!("Installation cancelled by user"));
                    }

                    while reporter.is_paused() {
                        if reporter.is_cancelled() {
                            return Err(anyhow::anyhow!("Installation cancelled by user"));
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }

                    log::debug!("Processing native: {}", task.name);

                    // Try to restore from cache
                    let mut restored = false;
                    if try_restore_artifact(&task.label, &task.path).await? {
                        log::debug!("Restored native jar from cache: {}", task.label);
                        restored = true;
                    }

                    if !restored && !reporter.is_dry_run() {
                        download_to_path(
                            &client,
                            &task.url,
                            &task.path,
                            Some(&task.sha1),
                            &*reporter,
                        )
                        .await?;

                        // Track it in cache
                        track_artifact_from_path(
                            task.label.clone(),
                            &task.path,
                            None,
                            Some(task.url.clone()),
                        )
                        .await?;
                    }

                    // Extract it (skip if dry_run)
                    if !reporter.is_dry_run() {
                        let native_bytes = std::fs::read(&task.path)?;
                        let natives_dir = natives_dir.clone();
                        let extract_rules = task.extract.clone();
                        
                        tokio::task::spawn_blocking(move || {
                            extract_natives_sync(&native_bytes, &natives_dir, &extract_rules)
                        }).await??;
                    }

                    let count = downloaded_natives.fetch_add(1, Ordering::SeqCst) + 1;
                    let progress = 75 + ((count as f32 / total_natives as f32) * 5.0) as i32;
                    reporter.set_percent(progress);

                    log::debug!(
                        "Extracted native: {} ({}/{})",
                        task.name,
                        count,
                        total_natives
                    );

                    Ok::<(), anyhow::Error>(())
                }
            })
            .buffer_unordered(spec.concurrency)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>>>()?;

        log::info!("Natives extracted: {}", total_natives);
    }

    log::info!("Libraries and natives downloaded");

    // 7. Ensure JRE is available
    reporter.start_step("Setting up Java runtime", None);
    reporter.set_percent(85);

    let java_version = if let Some(java_info) = &version_info.java_version {
        JavaVersion::new(java_info.major_version)
    } else {
        JavaVersion::new(8) // Default to Java 8 for old versions
    };

    log::info!("Ensuring Java runtime is available: {}", java_version.major);
    let _java_path = get_or_install_jre(&spec.jre_dir(), &java_version, &*reporter)
        .await
        .context("Failed to install JRE")?;

    log::info!("JRE ready");

    // 8. Finalize
    reporter.set_percent(100);
    log::info!("Vanilla installation complete");

    Ok(())
}

/// Check if rules allow this library on the current OS
fn check_rules(rules: &[Rule], os: &OsType) -> bool {
    if rules.is_empty() {
        return true; // No rules means allowed
    }

    let mut allowed = false;

    for rule in rules {
        let matches = if let Some(os_rule) = &rule.os {
            let name_matches = os_rule
                .name
                .as_ref()
                .map(|n| n == os_name(os))
                .unwrap_or(true);
            let arch_matches = os_rule
                .arch
                .as_ref()
                .map(|a| a == arch_bits(os))
                .unwrap_or(true);
            name_matches && arch_matches
        } else {
            true // No OS restriction
        };

        if matches {
            allowed = rule.action == "allow";
        }
    }

    allowed
}

fn os_name(os: &OsType) -> &'static str {
    match os {
        OsType::Windows | OsType::WindowsArm64 => "windows",
        OsType::MacOS | OsType::MacOSArm64 => "osx",
        OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
    }
}

fn arch_bits(os: &OsType) -> &'static str {
    match os {
        OsType::WindowsArm64 | OsType::MacOSArm64 | OsType::LinuxArm64 => "64",
        OsType::LinuxArm32 => "32",
        _ => "64",
    }
}

fn extract_natives_sync(
    zip_bytes: &[u8],
    dest: &PathBuf,
    extract_rules: &Option<ExtractRules>,
) -> Result<()> {
    use std::io::Cursor;

    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;

    let excluded: Vec<String> = extract_rules
        .as_ref()
        .and_then(|r| r.exclude.clone())
        .unwrap_or_default();

    std::fs::create_dir_all(dest)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let file_name = file.name().to_string();

        // Skip excluded paths (usually META-INF/)
        if excluded.iter().any(|e| file_name.starts_with(e)) {
            continue;
        }

        if !file.is_dir() {
            let outpath = dest.join(&file_name);

            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p)?;
            }

            let mut outfile = std::fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }

    Ok(())
}

async fn fetch_and_download_version_info(
    client: &Client,
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
    version_json_path: &std::path::Path,
    version_json_label: &str,
) -> Result<VersionInfo> {
    // Download version manifest
    log::info!("Downloading version manifest from {}", VANILLA_MANIFEST_URL);
    let manifest: VersionManifest = download_json_with_client(client, VANILLA_MANIFEST_URL)
        .await
        .context("Failed to download version manifest")?;

    let version_entry = manifest
        .versions
        .iter()
        .find(|v| v.id == spec.version_id)
        .context(format!("Version {} not found", spec.version_id))?;

    log::debug!("Found version entry: {}", version_entry.id);

    // Download version JSON
    reporter.start_step("Downloading version metadata", None);
    reporter.set_percent(10);

    log::info!(
        "Downloading version JSON {} -> {:?}",
        version_entry.url,
        version_json_path
    );

    if reporter.is_dry_run() {
        return download_json_with_client(client, &version_entry.url).await;
    }

    download_to_path(
        client,
        &version_entry.url,
        version_json_path,
        Some(&version_entry.sha1),
        &*reporter,
    )
    .await?;

    track_artifact_from_path(
        version_json_label.to_string(),
        version_json_path,
        None,
        Some(version_entry.url.clone()),
    )
    .await?;

    let version_info: VersionInfo =
        serde_json::from_slice(&tokio::fs::read(version_json_path).await?)?;

    Ok(version_info)
}
